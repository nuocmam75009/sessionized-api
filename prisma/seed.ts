// Jeu de données de démonstration et de recette : `npm run db:seed`.
//
// Un coach, deux athlètes qu'il suit, un plan de dix semaines avec ses
// séances prescrites, et six semaines de séances réalisées (laps et points
// de mesure toutes les 5 s) : de quoi faire vivre chaque écran des deux
// applications, et calculer zones de FC et charge d'entraînement.
//
// - Idempotent : les comptes de démonstration (@demo.test) sont supprimés
//   puis recréés, avec tout ce qui s'y rattache (cascade). Rien d'autre
//   n'est touché.
// - Dates relatives au jour d'exécution : le calendrier montre toujours
//   six semaines passées et quatre à venir.
// - Déterministe : même générateur pseudo-aléatoire, mêmes valeurs.
// - Refusé si NODE_ENV=production.
// - Aucune donnée réelle : noms inventés, trace GPS synthétique.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  ActivityLabel,
  ActivitySource,
  AthleteSpecialty,
  HeartRateZone,
  LapIntensity,
  LapIntensitySource,
  PlanStatus,
  Role,
} from '../generated/prisma/enums';
import { resolveConnectionString } from '../src/prisma/prisma.service';

export const SEED_EMAIL_DOMAIN = 'demo.test';
// Conforme à la politique de mots de passe (src/auth/password-policy.ts).
export const SEED_PASSWORD = 'Tempo-Fartlek-2026';

const DAY_MS = 24 * 60 * 60 * 1000;
const SAMPLE_SEC = 5;

// --- Générateur pseudo-aléatoire déterministe (mulberry32) -----------------

let state = 20261108;
function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const jitter = (amplitude: number) => (random() * 2 - 1) * amplitude;

// --- Calendrier ------------------------------------------------------------

function mondayOfCurrentWeek(): Date {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const weekday = (new Date(today).getUTCDay() + 6) % 7; // lundi = 0
  return new Date(today - weekday * DAY_MS);
}
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);
const atHourUtc = (date: Date, hour: number) =>
  new Date(date.getTime() + hour * 60 * 60 * 1000);

// --- Séances : segments → laps et points de mesure -------------------------

interface Segment {
  intensity: LapIntensity;
  distanceM: number;
  paceSecPerKm: number;
  heartRate: number;
}

const warmup = (distanceM = 2000): Segment => ({
  intensity: LapIntensity.WARMUP,
  distanceM,
  paceSecPerKm: 330,
  heartRate: 138,
});
const cooldown = (distanceM = 1500): Segment => ({
  intensity: LapIntensity.COOLDOWN,
  distanceM,
  paceSecPerKm: 345,
  heartRate: 135,
});

function intervals(
  reps: number,
  distanceM: number,
  paceSecPerKm: number,
  recoveryM: number,
): Segment[] {
  const segments: Segment[] = [warmup()];
  for (let i = 0; i < reps; i++) {
    segments.push({
      intensity: LapIntensity.INTERVAL,
      distanceM,
      paceSecPerKm,
      heartRate: distanceM >= 1000 ? 172 : 176,
    });
    if (i < reps - 1) {
      segments.push({
        intensity: LapIntensity.RECOVERY,
        distanceM: recoveryM,
        paceSecPerKm: 420,
        heartRate: 148,
      });
    }
  }
  segments.push(cooldown());
  return segments;
}

const steady = (
  durationSec: number,
  paceSecPerKm: number,
  heartRate: number,
): Segment[] => {
  // Laps automatiques de 1 km, comme une montre.
  const totalM = (durationSec / paceSecPerKm) * 1000;
  const segments: Segment[] = [];
  for (let done = 0; done < totalM; done += 1000) {
    segments.push({
      intensity: LapIntensity.ACTIVE,
      distanceM: Math.min(1000, totalM - done),
      paceSecPerKm,
      heartRate,
    });
  }
  return segments;
};

// Boucle synthétique de 2,5 km autour d'un point fixe (aucune trace réelle).
const LOOP_CENTER = { lat: 48.8336, lon: 2.4469 };
const LOOP_RADIUS_M = 2500 / (2 * Math.PI);
function positionAt(distanceM: number) {
  const angle = (distanceM / LOOP_RADIUS_M) % (2 * Math.PI);
  return {
    latitude: LOOP_CENTER.lat + (LOOP_RADIUS_M * Math.sin(angle)) / 111_320,
    longitude:
      LOOP_CENTER.lon +
      (LOOP_RADIUS_M * Math.cos(angle)) /
        (111_320 * Math.cos((LOOP_CENTER.lat * Math.PI) / 180)),
    altitudeM: 52 + 4 * Math.sin(angle * 2),
  };
}

function buildActivity(startedAt: Date, segments: Segment[]) {
  let elapsed = 0;
  let distance = 0;
  let heartRate = 105; // la FC part du repos et rattrape la cible
  const trackPoints: Array<Record<string, unknown>> = [];

  const laps = segments.map((segment, index) => {
    // Variation d'un jour à l'autre : ± 2 % d'allure.
    const pace = segment.paceSecPerKm * (1 + jitter(0.02));
    const speed = 1000 / pace;
    const durationSec = segment.distanceM / speed;
    const lapHeartRates: number[] = [];

    for (let t = 0; t < durationSec; t += SAMPLE_SEC) {
      const step = Math.min(SAMPLE_SEC, durationSec - t);
      elapsed += step;
      distance += speed * step;
      // Rattrapage de la cible (constante de temps ~30 s) + dérive cardiaque.
      const drift = elapsed / 600;
      heartRate +=
        (segment.heartRate + drift - heartRate) * (1 - Math.exp(-step / 30));
      const hr = Math.round(heartRate + jitter(2));
      lapHeartRates.push(hr);
      trackPoints.push({
        timestamp: new Date(startedAt.getTime() + elapsed * 1000),
        elapsedSec: Math.round(elapsed * 10) / 10,
        distanceM: Math.round(distance * 10) / 10,
        ...positionAt(distance),
        heartRate: hr,
        cadence: Math.round(150 + speed * 7 + jitter(2)),
        speedMPerSec: Math.round((speed + jitter(0.1)) * 1000) / 1000,
      });
    }

    return {
      index,
      intensity: segment.intensity,
      intensitySource: LapIntensitySource.DEVICE,
      distanceM: Math.round(segment.distanceM),
      durationSec: Math.round(durationSec),
      avgPaceSecPerKm: Math.round(pace * 10) / 10,
      avgHeartRate: Math.round(
        lapHeartRates.reduce((a, b) => a + b, 0) / lapHeartRates.length,
      ),
      maxHeartRate: Math.max(...lapHeartRates),
      avgCadence: Math.round(150 + speed * 7),
    };
  });

  const allHeartRates = trackPoints.map((p) => p.heartRate as number);
  return {
    totalDistanceM: Math.round(distance),
    totalDurationSec: Math.round(elapsed),
    avgHeartRate: Math.round(
      allHeartRates.reduce((a, b) => a + b, 0) / allHeartRates.length,
    ),
    maxHeartRate: Math.max(...allHeartRates),
    avgCadence: Math.round(
      laps.reduce((sum, lap) => sum + lap.avgCadence * lap.durationSec, 0) /
        Math.max(1, elapsed),
    ),
    totalCalories: Math.round((distance / 1000) * 62),
    elevationGainM: Math.round((distance / 2500) * 8),
    laps,
    trackPoints,
  };
}

// --- Plan : dix semaines de préparation d'un 10 km --------------------------

interface WorkoutTemplate {
  weekday: number; // lundi = 0
  title: string;
  coachNote: string;
  targetDurationSec?: number;
  targetDistanceM?: number;
  targetHeartRateZone?: HeartRateZone;
  laps?: Array<{
    targetDistanceM?: number;
    targetPaceSecPerKm?: number;
    targetDurationSec?: number;
    targetHeartRateZone?: HeartRateZone;
  }>;
  segments: () => Segment[];
  labels: ActivityLabel[];
}

const INTERVAL_BLOCKS = [
  { reps: 10, distanceM: 400, pace: 215, recoveryM: 200 },
  { reps: 6, distanceM: 1000, pace: 228, recoveryM: 400 },
  { reps: 3, distanceM: 2000, pace: 236, recoveryM: 600 },
];

function weekTemplates(week: number, isRaceWeek: boolean): WorkoutTemplate[] {
  const block = INTERVAL_BLOCKS[(week + 9) % INTERVAL_BLOCKS.length];
  const intervalTitle = `${block.reps} × ${block.distanceM >= 1000 ? `${block.distanceM / 1000} km` : `${block.distanceM} m`}`;
  const templates: WorkoutTemplate[] = [
    {
      weekday: 1,
      title: `Fractionné ${intervalTitle}`,
      coachNote: `Échauffement 2 km, puis ${intervalTitle} à ${Math.floor(block.pace / 60)}'${String(block.pace % 60).padStart(2, '0')}"/km, récupération ${block.recoveryM} m en trottinant. Retour au calme 1,5 km.`,
      targetHeartRateZone: HeartRateZone.Z4,
      laps: [
        { targetDistanceM: 2000, targetHeartRateZone: HeartRateZone.Z2 },
        ...Array.from({ length: block.reps }, () => ({
          targetDistanceM: block.distanceM,
          targetPaceSecPerKm: block.pace,
        })),
        { targetDistanceM: 1500, targetHeartRateZone: HeartRateZone.Z1 },
      ],
      segments: () =>
        intervals(block.reps, block.distanceM, block.pace, block.recoveryM),
      labels: [ActivityLabel.WORKOUT],
    },
    {
      weekday: 3,
      title: 'Footing 45 min',
      coachNote:
        'Allure facile, en aisance respiratoire : on doit pouvoir parler.',
      targetDurationSec: 45 * 60,
      targetHeartRateZone: HeartRateZone.Z2,
      segments: () => steady(45 * 60, 318, 146),
      labels: [],
    },
  ];
  if (!isRaceWeek) {
    const minutes = 65 + Math.min(week + 6, 4) * 5;
    templates.push({
      weekday: 6,
      title: `Sortie longue ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`,
      coachNote: 'Endurance fondamentale. Hydratation toutes les 20 minutes.',
      targetDurationSec: minutes * 60,
      targetHeartRateZone: HeartRateZone.Z2,
      segments: () => steady(minutes * 60, 325, 148),
      labels: [ActivityLabel.LONG_RUN],
    });
  }
  return templates;
}

// Séances prescrites non réalisées (semaine relative, jour) : un plan suivi
// à 100 % ne serait pas crédible.
const MISSED = new Set(['-4:3', '-2:6']);

// --- Exécution -------------------------------------------------------------

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed refusé en production (NODE_ENV=production).');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: resolveConnectionString(databaseUrl),
    }),
  });

  try {
    const removed = await prisma.user.deleteMany({
      where: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
    });
    if (removed.count > 0) {
      console.log(`${removed.count} compte(s) de démonstration supprimé(s).`);
    }

    const password = await bcrypt.hash(SEED_PASSWORD, 10);
    const consentAt = addDays(mondayOfCurrentWeek(), -49);

    const coach = await prisma.user.create({
      data: {
        email: `claire.martin@${SEED_EMAIL_DOMAIN}`,
        password,
        firstName: 'Claire',
        lastName: 'Martin',
        role: Role.COACH,
        coachProfile: {
          create: {
            age: 38,
            specialty: 'Demi-fond et 10 km sur route',
            description:
              'Entraîneure diplômée FFA, ancienne coureuse de 1 500 m. Plans construits sur la fréquence cardiaque et les sensations.',
            monthlyPriceCents: 4500,
          },
        },
      },
      include: { coachProfile: true },
    });
    const coachId = coach.coachProfile!.id;

    const camille = await prisma.user.create({
      data: {
        email: `camille.durand@${SEED_EMAIL_DOMAIN}`,
        password,
        firstName: 'Camille',
        lastName: 'Durand',
        role: Role.ATHLETE,
        healthDataConsentAt: consentAt,
        athleteProfile: {
          create: {
            coachId,
            age: 29,
            weightKg: 58,
            heightCm: 166,
            specialty: AthleteSpecialty.LONG_DISTANCE_ROAD,
            // Bornes hautes Z1 à Z4, puis borne basse de Z5 (cf. schéma).
            heartRateZonesBpm: [132, 151, 163, 175, 175],
            paceZonesSecPerKm: [360, 320, 290, 255, 255],
          },
        },
      },
      include: { athleteProfile: true },
    });
    const hugo = await prisma.user.create({
      data: {
        email: `hugo.lefevre@${SEED_EMAIL_DOMAIN}`,
        password,
        firstName: 'Hugo',
        lastName: 'Lefèvre',
        role: Role.ATHLETE,
        healthDataConsentAt: consentAt,
        athleteProfile: {
          create: {
            coachId,
            age: 34,
            weightKg: 71,
            specialty: AthleteSpecialty.TRAIL,
            heartRateZonesBpm: [128, 146, 158, 170, 170],
          },
        },
      },
      include: { athleteProfile: true },
    });
    const camilleId = camille.athleteProfile!.id;

    await prisma.coachRating.create({
      data: { coachId, athleteId: camilleId, value: 5 },
    });

    // Plan de Camille : six semaines passées, la semaine en cours, trois à
    // venir, puis la course.
    const monday = mondayOfCurrentWeek();
    const raceDate = addDays(monday, 3 * 7 + 6);
    const plan = await prisma.plan.create({
      data: {
        coachId,
        athleteId: camilleId,
        status: PlanStatus.ACTIVE,
        startDate: addDays(monday, -6 * 7),
        endDate: raceDate,
        objective1: '10 km sous 40 minutes',
        objective2: 'Trois séances par semaine, sans blessure',
        raceDays: { create: { title: '10 km de Vincennes', date: raceDate } },
      },
    });

    const today = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    let workouts = 0;
    let activities = 0;
    let points = 0;

    for (let week = -6; week <= 3; week++) {
      for (const template of weekTemplates(week, week === 3)) {
        const day = addDays(monday, week * 7 + template.weekday);
        const workout = await prisma.workout.create({
          data: {
            planId: plan.id,
            title: template.title,
            scheduledDate: day,
            coachNote: template.coachNote,
            targetDurationSec: template.targetDurationSec,
            targetDistanceM: template.targetDistanceM,
            targetHeartRateZone: template.targetHeartRateZone,
            laps: template.laps
              ? {
                  create: template.laps.map((lap, index) => ({
                    index,
                    ...lap,
                  })),
                }
              : undefined,
          },
        });
        workouts++;

        const done =
          day.getTime() < today && !MISSED.has(`${week}:${template.weekday}`);
        if (!done) continue;

        const startedAt = atHourUtc(day, 7);
        const built = buildActivity(startedAt, template.segments());
        const stravaActivityId = String(
          9_000_000_000 + Math.floor(startedAt.getTime() / 1000),
        );
        await prisma.activity.create({
          data: {
            athleteId: camilleId,
            // Comme un import Strava : pas de fichier d'origine à conserver.
            source: ActivitySource.STRAVA,
            stravaActivityId,
            fileHash: createHash('sha256')
              .update(`strava:${stravaActivityId}`)
              .digest('hex'),
            sport: 'Run',
            labels: template.labels,
            startedAt,
            totalDistanceM: built.totalDistanceM,
            totalDurationSec: built.totalDurationSec,
            avgHeartRate: built.avgHeartRate,
            maxHeartRate: built.maxHeartRate,
            avgCadence: built.avgCadence,
            totalCalories: built.totalCalories,
            elevationGainM: built.elevationGainM,
            difficultyNote: template.labels.includes(ActivityLabel.WORKOUT)
              ? 7 + Math.round(random() * 2)
              : 3 + Math.round(random() * 2),
            athleteNote:
              template.labels.includes(ActivityLabel.WORKOUT) && week === -1
                ? 'Dernières répétitions difficiles, jambes lourdes.'
                : undefined,
            workoutId: workout.id,
            laps: { create: built.laps },
            trackPoints: { createMany: { data: built.trackPoints as never } },
          },
        });
        activities++;
        points += built.trackPoints.length;
      }
    }

    // Deux footings de récupération hors plan, et trois sorties pour Hugo.
    const extras: Array<{
      athleteId: string;
      day: Date;
      segments: Segment[];
      labels: ActivityLabel[];
    }> = [
      {
        athleteId: camilleId,
        day: addDays(monday, -3 * 7 + 5),
        segments: steady(30 * 60, 345, 138),
        labels: [ActivityLabel.RECOVERY],
      },
      {
        athleteId: camilleId,
        day: addDays(monday, -1 * 7 + 5),
        segments: steady(30 * 60, 342, 139),
        labels: [ActivityLabel.RECOVERY],
      },
      {
        athleteId: hugo.athleteProfile!.id,
        day: addDays(monday, -9),
        segments: steady(60 * 60, 360, 145),
        labels: [ActivityLabel.LONG_RUN],
      },
      {
        athleteId: hugo.athleteProfile!.id,
        day: addDays(monday, -6),
        segments: intervals(5, 1000, 245, 400),
        labels: [ActivityLabel.WORKOUT],
      },
      {
        athleteId: hugo.athleteProfile!.id,
        day: addDays(monday, -2),
        segments: steady(40 * 60, 350, 142),
        labels: [],
      },
    ];
    for (const extra of extras) {
      if (extra.day.getTime() >= today) continue;
      const startedAt = atHourUtc(extra.day, 17);
      const built = buildActivity(startedAt, extra.segments);
      const stravaActivityId = String(
        9_000_000_000 + Math.floor(startedAt.getTime() / 1000),
      );
      await prisma.activity.create({
        data: {
          athleteId: extra.athleteId,
          source: ActivitySource.STRAVA,
          stravaActivityId,
          fileHash: createHash('sha256')
            .update(`strava:${stravaActivityId}`)
            .digest('hex'),
          sport: 'Run',
          labels: extra.labels,
          startedAt,
          totalDistanceM: built.totalDistanceM,
          totalDurationSec: built.totalDurationSec,
          avgHeartRate: built.avgHeartRate,
          maxHeartRate: built.maxHeartRate,
          avgCadence: built.avgCadence,
          totalCalories: built.totalCalories,
          elevationGainM: built.elevationGainM,
          laps: { create: built.laps },
          trackPoints: { createMany: { data: built.trackPoints as never } },
        },
      });
      activities++;
      points += built.trackPoints.length;
    }

    console.log(
      `Seed terminé : 3 comptes, 1 plan, ${workouts} séances prescrites, ${activities} activités, ${points} points de mesure.`,
    );
    console.log(
      `Connexion : claire.martin@${SEED_EMAIL_DOMAIN} (coach), camille.durand@${SEED_EMAIL_DOMAIN} ou hugo.lefevre@${SEED_EMAIL_DOMAIN} (athlètes), mot de passe ${SEED_PASSWORD}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
