import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

// Version du format d'export : un outil qui relit le fichier sait ce qu'il lit
// si la structure évolue.
// v2 : plus de conversations, le chat ayant été retiré.
export const EXPORT_FORMAT = 'sessionized-export/2';

function encodeFile(data: Uint8Array | null) {
  return data
    ? {
        encoding: 'base64' as const,
        data: Buffer.from(data).toString('base64'),
      }
    : null;
}

/**
 * Droits de la personne sur ses données (RGPD) : preuve du consentement aux
 * données de santé (art. 7 et 9), accès et portabilité (art. 15 et 20),
 * effacement (art. 17). Réservé aux athlètes : ce sont eux qui confient des
 * données de santé à Sessionized.
 */
@Injectable()
export class PersonalDataService {
  private readonly logger = new Logger(PersonalDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Pour les comptes créés avant la case d'inscription. Un consentement déjà
  // donné garde sa date d'origine : c'est elle qui prouve que les données ont
  // été traitées après accord.
  async recordHealthDataConsent(userId: string) {
    await this.prisma.user.updateMany({
      where: { id: userId, healthDataConsentAt: null },
      data: { healthDataConsentAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { healthDataConsentAt: true },
    });
    if (!user) {
      throw new NotFoundException('Compte introuvable');
    }
    this.logger.log(`Consentement aux données de santé (id=${userId})`);
    return user;
  }

  /**
   * Tout ce que la base contient sur l'athlète, dans un format lisible par
   * une machine, fichiers .fit et .gpx d'origine compris : ce sont eux qu'un
   * autre service sait importer. Jamais le mot de passe haché ni les jetons
   * Strava : des secrets, pas des données sur la personne.
   *
   * Construit en mémoire, en une requête : suffisant à l'échelle actuelle.
   * Avec des milliers d'activités, il faudrait une archive générée en tâche
   * de fond et un lien de téléchargement.
   */
  async exportAthleteData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        healthDataConsentAt: true,
        athleteProfile: {
          include: {
            stravaToken: { select: { createdAt: true, updatedAt: true } },
            coachRatings: {
              select: {
                coachId: true,
                value: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            trainingLoads: {
              select: { date: true, ctl: true, atl: true, tsb: true },
              orderBy: { date: 'asc' },
            },
            plans: {
              omit: { athleteId: true },
              include: {
                raceDays: { omit: { planId: true }, orderBy: { date: 'asc' } },
                workouts: {
                  omit: { planId: true },
                  include: {
                    laps: {
                      omit: { workoutId: true },
                      orderBy: { index: 'asc' },
                    },
                  },
                  orderBy: { scheduledDate: 'asc' },
                },
              },
              orderBy: { startDate: 'asc' },
            },
            activities: {
              omit: { athleteId: true, fileHash: true, fitFileHash: true },
              include: {
                laps: { omit: { activityId: true }, orderBy: { index: 'asc' } },
                trackPoints: {
                  omit: { activityId: true },
                  orderBy: { elapsedSec: 'asc' },
                },
                routePoints: { omit: { activityId: true } },
                warnings: { omit: { activityId: true } },
              },
              orderBy: { startedAt: 'asc' },
            },
          },
        },
      },
    });
    if (!user?.athleteProfile) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const {
      athleteProfile: {
        stravaToken,
        coachRatings,
        trainingLoads,
        plans,
        activities,
        ...profile
      },
      ...account
    } = user;

    this.logger.log(`Export des données personnelles (id=${userId})`);
    return {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      account,
      athleteProfile: profile,
      strava: {
        connected: !!stravaToken,
        connectedAt: stravaToken?.createdAt ?? null,
      },
      coachRatings,
      plans,
      activities: activities.map(
        ({ fitFileData, gpxFileData, ...activity }) => ({
          ...activity,
          fitFile: encodeFile(fitFileData),
          gpxFile: encodeFile(gpxFileData),
        }),
      ),
      trainingLoads,
    };
  }

  /**
   * Efface le compte et tout ce qui s'y rattache : profil, activités, laps,
   * points GPS, fichiers bruts, plans, charge d'entraînement, jetons Strava,
   * et notes suivent par cascade (onDelete: Cascade du schéma).
   */
  async deleteAthleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user) {
      throw new NotFoundException('Compte introuvable');
    }

    if (!(await bcrypt.compare(password, user.password))) {
      this.logger.warn(
        `Suppression de compte refusée : mot de passe incorrect (id=${userId})`,
      );
      // 403 et non 401 : la session reste valide, seul le mot de passe de
      // confirmation est faux. Un 401 ferait croire au front que la session
      // a expiré, et le renverrait à l'écran de connexion.
      throw new ForbiddenException('Mot de passe incorrect');
    }

    // deleteMany : deux demandes simultanées ne finissent pas en 500 pour la
    // seconde, qui ne trouve plus rien à supprimer.
    await this.prisma.user.deleteMany({ where: { id: userId } });
    this.logger.log(
      `Compte supprimé à la demande de l'utilisateur (id=${userId})`,
    );
  }
}
