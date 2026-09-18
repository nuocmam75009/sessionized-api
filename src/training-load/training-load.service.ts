import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { Prisma } from '../../generated/prisma/client';
import { Role } from '../../generated/prisma/enums';
import {
  buildHeartRateSamplesCte,
  zoneIndexExpression,
} from '../activities/heart-rate-samples';
import {
  buildTrainingLoadSeries,
  sessionLoad,
  type TrainingLoadPoint,
  type TrainingLoadSource,
} from './training-load';
import type { TrainingLoadQueryDto } from './dto/training-load-query.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 90;

// Arrondi d'affichage : la charge est une estimation, publier quinze décimales
// lui donnerait une précision qu'elle n'a pas — et alourdirait la réponse d'un
// facteur trois sur une série de plusieurs centaines de jours.
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

@Injectable()
export class TrainingLoadService {
  private readonly logger = new Logger(TrainingLoadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Série CTL / ATL / TSB de l'athlète sur la fenêtre demandée.
   *
   * La série est toujours calculée depuis la première activité connue, quelle
   * que soit la fenêtre affichée : les moyennes exponentielles sont
   * cumulatives, les démarrer à la borne basse demandée donnerait une CTL
   * repartie de zéro à chaque changement de période.
   */
  async getSeries(userId: string, role: Role, query: TrainingLoadQueryDto) {
    const athlete = await this.resolveAthlete(userId, role, query.athleteId);

    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);

    if (from > to) {
      throw new BadRequestException('`from` doit précéder `to`');
    }

    const activities = await this.prisma.activity.findMany({
      where: { athleteId: athlete.id, startedAt: { lte: to } },
      select: {
        id: true,
        startedAt: true,
        totalDurationSec: true,
        difficultyNote: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    if (activities.length === 0) {
      return this.emptySeries(from, to);
    }

    // Dernière valeur de heartRateZonesBpm = borne haute inexploitable (zone
    // ouverte Strava), cf. AthleteProfile : elle ne sert qu'à compter les
    // zones. Tableau vide = athlète sans zones synchronisées, la charge
    // retombera alors sur le ressenti ou la durée.
    const highBounds = athlete.heartRateZonesBpm.slice(0, -1);
    const zoneSecondsByActivity =
      highBounds.length > 0
        ? await this.queryZoneSecondsByActivity(
            athlete.id,
            activities[0].startedAt,
            to,
            highBounds,
          )
        : new Map<string, number[]>();

    const dailyLoads = new Map<string, number>();
    const sourceCounts: Record<TrainingLoadSource, number> = {
      HEART_RATE: 0,
      PERCEIVED: 0,
      DURATION: 0,
    };

    for (const activity of activities) {
      const { load, source } = sessionLoad({
        durationSec: activity.totalDurationSec,
        secondsByZone: zoneSecondsByActivity.get(activity.id),
        difficultyNote: activity.difficultyNote,
      });

      sourceCounts[source] += 1;
      const day = activity.startedAt.toISOString().slice(0, 10);
      dailyLoads.set(day, (dailyLoads.get(day) ?? 0) + load);
    }

    const series = buildTrainingLoadSeries(
      dailyLoads,
      activities[0].startedAt,
      to,
    );
    await this.cacheSeries(athlete.id, series);

    const fromDay = from.toISOString().slice(0, 10);
    const points = series
      .filter((point) => point.date >= fromDay)
      .map((point) => ({
        date: point.date,
        load: round1(point.load),
        ctl: round1(point.ctl),
        atl: round1(point.atl),
        tsb: round1(point.tsb),
        settled: point.settled,
      }));

    const last = series[series.length - 1];

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      points,
      current: {
        date: last.date,
        ctl: round1(last.ctl),
        atl: round1(last.atl),
        tsb: round1(last.tsb),
        settled: last.settled,
      },
      // Charge cumulée des sept derniers jours de la série, et variation de
      // CTL sur la même durée : c'est le « ramp rate », la vitesse à laquelle
      // l'athlète monte en charge.
      weeklyLoad: round1(sumLastDays(series, 7)),
      rampRate: round1(last.ctl - (series[series.length - 8]?.ctl ?? 0)),
      // De quoi la charge est faite : une série majoritairement estimée sur la
      // durée seule ne se lit pas comme une série mesurée à la FC.
      sourceCounts,
      activityCount: activities.length,
    };
  }

  private emptySeries(from: Date, to: Date) {
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      points: [],
      current: {
        date: to.toISOString().slice(0, 10),
        ctl: 0,
        atl: 0,
        tsb: 0,
        settled: false,
      },
      weeklyLoad: 0,
      rampRate: 0,
      sourceCounts: { HEART_RATE: 0, PERCEIVED: 0, DURATION: 0 },
      activityCount: 0,
    };
  }

  /**
   * Secondes passées dans chaque zone FC, par activité.
   *
   * Même agrégation SQL que GET /activities/hr-zones, mais groupée par
   * activité : la charge est un coût par séance, pas un cumul de période.
   */
  private async queryZoneSecondsByActivity(
    athleteId: string,
    from: Date,
    to: Date,
    highBounds: number[],
  ): Promise<Map<string, number[]>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ activityId: string; zoneIndex: number; seconds: number }>
    >(Prisma.sql`
      WITH ${buildHeartRateSamplesCte(athleteId, from, to)}
      SELECT
        "activityId",
        ${zoneIndexExpression(highBounds)} AS "zoneIndex",
        SUM(dt)::float AS seconds
      FROM samples
      WHERE hr IS NOT NULL
      GROUP BY 1, 2
    `);

    const zoneCount = highBounds.length + 1;
    const byActivity = new Map<string, number[]>();

    for (const row of rows) {
      const seconds =
        byActivity.get(row.activityId) ?? new Array<number>(zoneCount).fill(0);
      // zoneIndex est 1-based côté SQL.
      seconds[row.zoneIndex - 1] = row.seconds;
      byActivity.set(row.activityId, seconds);
    }

    return byActivity;
  }

  /**
   * Écrit la série dans TrainingLoad.
   *
   * La table est un cache : la source de vérité reste Activity, et la série
   * est recalculée intégralement à chaque lecture. Elle existe pour que
   * d'autres consommateurs (app coach, futur moteur de warnings) puissent lire
   * la condition d'un athlète sans refaire l'agrégation. L'écriture est donc
   * sautée quand rien n'a bougé depuis la dernière fois — le cas de loin le
   * plus fréquent, un athlète ouvrant son tableau de bord plusieurs fois par
   * jour sans avoir couru entre-temps.
   */
  private async cacheSeries(athleteId: string, series: TrainingLoadPoint[]) {
    const last = series[series.length - 1];
    const stored = await this.prisma.trainingLoad.findFirst({
      where: { athleteId },
      orderBy: { date: 'desc' },
    });

    const unchanged =
      stored != null &&
      stored.date.toISOString().slice(0, 10) === last.date &&
      round1(stored.ctl) === round1(last.ctl) &&
      round1(stored.atl) === round1(last.atl);
    if (unchanged) return;

    try {
      await this.prisma.$transaction([
        this.prisma.trainingLoad.deleteMany({ where: { athleteId } }),
        this.prisma.trainingLoad.createMany({
          data: series.map((point) => ({
            athleteId,
            date: new Date(`${point.date}T00:00:00.000Z`),
            ctl: point.ctl,
            atl: point.atl,
            tsb: point.tsb,
          })),
        }),
      ]);
    } catch (error) {
      // Le cache n'est pas le produit : s'il ne s'écrit pas, la série calculée
      // reste juste et part quand même au client.
      this.logger.warn(
        `Cache de charge non écrit pour l'athlète ${athleteId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async resolveAthlete(
    userId: string,
    role: Role,
    athleteId: string | undefined,
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }
      if (!athleteId) {
        throw new BadRequestException(
          'athleteId requis pour un coach : la charge est propre à chaque athlète',
        );
      }

      const athlete = await this.prisma.athleteProfile.findUnique({
        where: { id: athleteId },
      });
      if (!athlete || athlete.coachId !== coach.id) {
        throw new ForbiddenException('Cet athlète ne vous est pas rattaché');
      }
      return athlete;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }
    return athlete;
  }
}

function sumLastDays(series: TrainingLoadPoint[], days: number): number {
  return series.slice(-days).reduce((total, point) => total + point.load, 0);
}
