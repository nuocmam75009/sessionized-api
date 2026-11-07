import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EXPORT_FORMAT, PersonalDataService } from './personal-data.service';

const PASSWORD = 'Course-matinale-2026';

describe('PersonalDataService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let service: PersonalDataService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new PersonalDataService(prisma as unknown as PrismaService);
  });

  describe('deleteAthleteAccount', () => {
    it('supprime le compte quand le mot de passe est le bon', async () => {
      prisma.user.findUnique.mockResolvedValue({ password: passwordHash });

      await service.deleteAthleteAccount('user-1', PASSWORD);

      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('mauvais mot de passe : 403 (pas 401) et rien n’est supprimé', async () => {
      prisma.user.findUnique.mockResolvedValue({ password: passwordHash });

      await expect(
        service.deleteAthleteAccount('user-1', 'mauvais'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it('compte déjà supprimé (jeton encore valide) : 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteAthleteAccount('user-1', PASSWORD),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recordHealthDataConsent', () => {
    it('ne date que le premier consentement : un accord déjà donné garde sa date', async () => {
      const firstConsent = new Date('2026-01-15T10:00:00Z');
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findUnique.mockResolvedValue({
        healthDataConsentAt: firstConsent,
      });

      const result = await service.recordHealthDataConsent('user-1');

      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', healthDataConsentAt: null },
        }),
      );
      expect(result.healthDataConsentAt).toBe(firstConsent);
    });
  });

  describe('exportAthleteData', () => {
    const fitBytes = Uint8Array.from([0x0e, 0x10, 0x2e, 0x46, 0x49, 0x54]);

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'camille@example.com',
        firstName: 'Camille',
        lastName: null,
        role: 'ATHLETE',
        createdAt: new Date('2026-01-15T10:00:00Z'),
        updatedAt: new Date('2026-01-15T10:00:00Z'),
        healthDataConsentAt: new Date('2026-01-15T10:00:00Z'),
        athleteProfile: {
          id: 'profile-1',
          weightKg: 64,
          stravaToken: { createdAt: new Date('2026-02-01T08:00:00Z') },
          coachRatings: [],
          trainingLoads: [],
          plans: [],
          conversations: [],
          activities: [
            {
              id: 'activity-1',
              totalDistanceM: 10000,
              fitFileData: fitBytes,
              gpxFileData: null,
              laps: [],
              trackPoints: [],
              routePoints: [],
              warnings: [],
            },
          ],
        },
      });
    });

    it('ne demande jamais le mot de passe haché ni les jetons Strava à la base', async () => {
      await service.exportAthleteData('user-1');

      const [[args]] = prisma.user.findUnique.mock.calls as [[unknown]];
      const query = JSON.stringify(args);
      expect(query).not.toContain('"password"');
      expect(query).not.toContain('accessToken');
      expect(query).not.toContain('refreshToken');
    });

    it('fichiers d’origine encodés en base64, connexion Strava réduite à sa date', async () => {
      const data = await service.exportAthleteData('user-1');

      expect(data.format).toBe(EXPORT_FORMAT);
      expect(data.account.email).toBe('camille@example.com');
      expect(data.athleteProfile).toMatchObject({ weightKg: 64 });
      expect(data.athleteProfile).not.toHaveProperty('activities');
      expect(data.strava).toEqual({
        connected: true,
        connectedAt: new Date('2026-02-01T08:00:00Z'),
      });
      expect(data.activities[0]).not.toHaveProperty('fitFileData');
      expect(data.activities[0].fitFile).toEqual({
        encoding: 'base64',
        data: Buffer.from(fitBytes).toString('base64'),
      });
      expect(data.activities[0].gpxFile).toBeNull();
    });

    it('compte sans profil athlète : 403', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'coach-1',
        athleteProfile: null,
      });

      await expect(service.exportAthleteData('coach-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
