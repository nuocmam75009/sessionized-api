import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ActivitiesService } from '../activities/activities.service';
import { ActivitySource } from '../../generated/prisma/enums';
import type { ImportStravaActivityDto } from './dto/import-strava-activity.dto';

const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_SCOPE = 'activity:read_all';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface StravaSummaryActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
}

interface StravaDetailedActivity extends StravaSummaryActivity {
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  calories?: number;
}

interface StravaLap {
  lap_index: number;
  distance: number;
  moving_time: number;
  average_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
}

interface StravaStreamSet {
  time?: { data: number[] };
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  heartrate?: { data: number[] };
  cadence?: { data: number[] };
  watts?: { data: number[] };
  velocity_smooth?: { data: number[] };
  distance?: { data: number[] };
}

@Injectable()
export class StravaService {
  private readonly logger = new Logger(StravaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly activitiesService: ActivitiesService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async getAuthorizeUrl(athleteUserId: string): Promise<string> {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const state = this.jwtService.sign(
      { athleteId: athlete.id },
      { expiresIn: '10m' },
    );

    const params = new URLSearchParams({
      client_id: this.configService.getOrThrow<string>('STRAVA_CLIENT_ID'),
      redirect_uri: this.configService.getOrThrow<string>(
        'STRAVA_REDIRECT_URI',
      ),
      response_type: 'code',
      approval_prompt: 'auto',
      scope: STRAVA_SCOPE,
      state,
    });

    return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`;
  }

  async getStatus(athleteUserId: string): Promise<{ connected: boolean }> {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const token = await this.prisma.stravaToken.findUnique({
      where: { athleteId: athlete.id },
    });
    return { connected: !!token };
  }

  async disconnect(athleteUserId: string): Promise<void> {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    await this.prisma.stravaToken.deleteMany({
      where: { athleteId: athlete.id },
    });
    this.logger.log(`Compte Strava déconnecté pour l'athlète ${athlete.id}`);
  }

  async handleCallback(code: string, state: string) {
    let athleteId: string;
    try {
      ({ athleteId } = this.jwtService.verify<{ athleteId: string }>(state));
    } catch {
      throw new BadRequestException(
        'État OAuth invalide ou expiré, relancez la connexion Strava',
      );
    }

    const token = await this.exchangeToken({
      grant_type: 'authorization_code',
      code,
    });

    await this.prisma.stravaToken.upsert({
      where: { athleteId },
      create: {
        athleteId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      },
      update: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: new Date(token.expires_at * 1000),
      },
    });
    this.logger.log(`Compte Strava connecté pour l'athlète ${athleteId}`);

    return { connected: true };
  }

  async listActivities(athleteUserId: string, perPage = 30) {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const accessToken = await this.getValidAccessToken(athlete.id);
    const activities = await this.stravaGet<StravaSummaryActivity[]>(
      `/athlete/activities?per_page=${perPage}`,
      accessToken,
    );

    const alreadyImported = await this.prisma.activity.findMany({
      where: {
        athleteId: athlete.id,
        source: ActivitySource.STRAVA,
        stravaActivityId: { in: activities.map((a) => String(a.id)) },
      },
      select: { stravaActivityId: true },
    });
    const importedIds = new Set(alreadyImported.map((a) => a.stravaActivityId));

    return activities.map((activity) => ({
      stravaActivityId: String(activity.id),
      name: activity.name,
      sportType: activity.sport_type,
      startedAt: activity.start_date,
      distanceM: activity.distance,
      durationSec: activity.elapsed_time,
      elevationGainM: activity.total_elevation_gain,
      alreadyImported: importedIds.has(String(activity.id)),
    }));
  }

  async importActivity(
    athleteUserId: string,
    stravaActivityId: string,
    dto: ImportStravaActivityDto,
  ) {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    return this.persistStravaActivity(athlete.id, stravaActivityId, dto);
  }

  // Synchronisation automatique : importe toute nouvelle activité Strava
  // récente (déclenchée à chaque chargement du dashboard côté frontend), et
  // la lie au workout du jour si un seul existe et n'est pas déjà pris —
  // plus besoin de choisir manuellement laquelle importer ni à quel workout
  // l'associer.
  async syncActivities(
    athleteUserId: string,
  ): Promise<{ importedCount: number }> {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const accessToken = await this.getValidAccessToken(athlete.id);
    const activities = await this.stravaGet<StravaSummaryActivity[]>(
      '/athlete/activities?per_page=30',
      accessToken,
    );

    const alreadyImported = await this.prisma.activity.findMany({
      where: {
        athleteId: athlete.id,
        source: ActivitySource.STRAVA,
        stravaActivityId: { in: activities.map((a) => String(a.id)) },
      },
      select: { stravaActivityId: true },
    });
    const importedIds = new Set(alreadyImported.map((a) => a.stravaActivityId));
    const newActivities = activities.filter(
      (a) => !importedIds.has(String(a.id)),
    );

    let importedCount = 0;
    for (const activity of newActivities) {
      try {
        const workoutId =
          await this.activitiesService.findUnlinkedWorkoutIdForDate(
            athlete.id,
            new Date(activity.start_date),
          );
        await this.persistStravaActivity(athlete.id, String(activity.id), {
          workoutId,
        });
        importedCount++;
      } catch (err) {
        this.logger.warn(
          `Sync Strava : échec import activité ${activity.id} (athlète=${athlete.id}) : ${String(err)}`,
        );
      }
    }

    this.logger.log(
      `Sync Strava terminé : ${importedCount} nouvelle(s) activité(s) importée(s) (athlète=${athlete.id})`,
    );
    return { importedCount };
  }

  private async persistStravaActivity(
    athleteId: string,
    stravaActivityId: string,
    options: {
      workoutId?: string;
      athleteNote?: string;
      difficultyNote?: number;
    },
  ): Promise<{
    activityId: string;
    lapsCount: number;
    trackPointsCount: number;
  }> {
    const fileHash = createHash('sha256')
      .update(`strava:${stravaActivityId}`)
      .digest('hex');
    const existing = await this.prisma.activity.findUnique({
      where: { athleteId_fileHash: { athleteId, fileHash } },
    });
    if (existing) {
      throw new ConflictException('Cette activité Strava a déjà été importée');
    }

    if (options.workoutId) {
      await this.activitiesService.assertWorkoutIsAssignable(
        athleteId,
        options.workoutId,
      );
    }

    const accessToken = await this.getValidAccessToken(athleteId);

    const [detail, laps, streams] = await Promise.all([
      this.stravaGet<StravaDetailedActivity>(
        `/activities/${stravaActivityId}`,
        accessToken,
      ),
      this.stravaGet<StravaLap[]>(
        `/activities/${stravaActivityId}/laps`,
        accessToken,
      ),
      this.stravaGet<StravaStreamSet>(
        `/activities/${stravaActivityId}/streams?keys=time,latlng,altitude,heartrate,cadence,watts,velocity_smooth,distance&key_by_type=true`,
        accessToken,
      ),
    ]);

    const startedAt = new Date(detail.start_date);

    const activity = await this.prisma.activity.create({
      data: {
        athleteId,
        source: ActivitySource.STRAVA,
        fileHash,
        stravaActivityId,
        sport: detail.sport_type,
        startedAt,
        totalDistanceM: detail.distance,
        totalDurationSec: Math.round(detail.elapsed_time),
        avgHeartRate: roundOrUndefined(detail.average_heartrate),
        maxHeartRate: roundOrUndefined(detail.max_heartrate),
        avgCadence: roundOrUndefined(detail.average_cadence),
        avgPower: roundOrUndefined(detail.average_watts),
        totalCalories: roundOrUndefined(detail.calories),
        elevationGainM: detail.total_elevation_gain,
        athleteNote: options.athleteNote,
        difficultyNote: options.difficultyNote,
        workoutId: options.workoutId ?? undefined,
        laps: {
          create: laps.map((lap) => ({
            index: lap.lap_index,
            distanceM: lap.distance,
            durationSec: lap.moving_time,
            avgPaceSecPerKm: lap.average_speed
              ? 1000 / lap.average_speed
              : undefined,
            avgHeartRate: roundOrUndefined(lap.average_heartrate),
            maxHeartRate: roundOrUndefined(lap.max_heartrate),
            avgCadence: roundOrUndefined(lap.average_cadence),
            avgPower: roundOrUndefined(lap.average_watts),
          })),
        },
      },
      include: { laps: true },
    });

    const sampleCount = streams.time?.data.length ?? 0;
    if (sampleCount > 0) {
      const startedAtMs = startedAt.getTime();
      await this.prisma.trackPoint.createMany({
        data: Array.from({ length: sampleCount }, (_, i) => ({
          activityId: activity.id,
          timestamp: new Date(
            startedAtMs + (streams.time?.data[i] ?? 0) * 1000,
          ),
          elapsedSec: streams.time?.data[i] ?? 0,
          distanceM: streams.distance?.data[i],
          latitude: streams.latlng?.data[i]?.[0],
          longitude: streams.latlng?.data[i]?.[1],
          altitudeM: streams.altitude?.data[i],
          heartRate: roundOrUndefined(streams.heartrate?.data[i]),
          cadence: roundOrUndefined(streams.cadence?.data[i]),
          power: roundOrUndefined(streams.watts?.data[i]),
          speedMPerSec: streams.velocity_smooth?.data[i],
        })),
      });
    }

    this.logger.log(
      `Activité Strava importée : id=${activity.id} (strava=${stravaActivityId}), ${activity.laps.length} lap(s), ${sampleCount} point(s) (athlète=${athleteId})`,
    );

    return {
      activityId: activity.id,
      lapsCount: activity.laps.length,
      trackPointsCount: sampleCount,
    };
  }

  private async getValidAccessToken(athleteId: string): Promise<string> {
    const token = await this.prisma.stravaToken.findUnique({
      where: { athleteId },
    });
    if (!token) {
      throw new NotFoundException(
        'Aucun compte Strava connecté pour cet athlète',
      );
    }

    if (token.expiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return token.accessToken;
    }

    const refreshed = await this.exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    const updated = await this.prisma.stravaToken.update({
      where: { athleteId },
      data: {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: new Date(refreshed.expires_at * 1000),
      },
    });
    this.logger.log(`Token Strava rafraîchi pour l'athlète ${athleteId}`);

    return updated.accessToken;
  }

  private async exchangeToken(
    params: Record<string, string>,
  ): Promise<StravaTokenResponse> {
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.configService.getOrThrow<string>('STRAVA_CLIENT_ID'),
        client_secret: this.configService.getOrThrow<string>(
          'STRAVA_CLIENT_SECRET',
        ),
        ...params,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `Échec de l'échange de token Strava : ${response.status} ${await response.text()}`,
      );
      throw new BadGatewayException(
        "Échec de la communication avec l'API Strava",
      );
    }

    return (await response.json()) as StravaTokenResponse;
  }

  private async stravaGet<T>(path: string, accessToken: string): Promise<T> {
    const response = await fetch(`${STRAVA_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      this.logger.error(
        `Échec de l'appel Strava ${path} : ${response.status} ${await response.text()}`,
      );
      throw new BadGatewayException(
        "Échec de la communication avec l'API Strava",
      );
    }

    return (await response.json()) as T;
  }
}

function roundOrUndefined(value: number | undefined): number | undefined {
  return value != null ? Math.round(value) : undefined;
}
