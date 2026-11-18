import { Logger } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import { Role } from '../../generated/prisma/enums';

type Row = Record<string, unknown>;

function firstArg(mock: jest.Mock): Row {
  const calls = mock.mock.calls as Array<[Row]>;
  return calls[0][0];
}

// Workout du coach 'coach-1' dans le plan de l'athlète 'ath-1', avec son flag
// actuel ; la transaction rejoue le callback sur le même client mocké.
function buildHarness(currentTraining: boolean) {
  const prisma = {
    workout: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'w-1',
        training: currentTraining,
        plan: { coachId: 'coach-1', athleteId: 'ath-1' },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'w-1', laps: [] }),
    },
    workoutLap: { deleteMany: jest.fn() },
    activity: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const usersService = {
    getCoachProfile: jest.fn().mockResolvedValue({ id: 'coach-1' }),
    getAthleteProfile: jest.fn().mockResolvedValue({ id: 'ath-1' }),
  };

  const service = new WorkoutsService(
    prisma as unknown as PrismaService,
    usersService as unknown as UsersService,
  );
  return { service, prisma };
}

describe('WorkoutsService — flag training', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  describe('update', () => {
    it("répercute le nouveau flag sur l'activité liée", async () => {
      const { service, prisma } = buildHarness(false);

      await service.update('user-1', 'w-1', { training: true });

      expect(firstArg(prisma.activity.updateMany)).toEqual({
        where: { workoutId: 'w-1' },
        data: { training: true },
      });
      expect(firstArg(prisma.workout.update)).toMatchObject({
        data: { training: true },
      });
    });

    it('répercute aussi le retrait du flag', async () => {
      const { service, prisma } = buildHarness(true);

      await service.update('user-1', 'w-1', { training: false });

      expect(firstArg(prisma.activity.updateMany)).toMatchObject({
        data: { training: false },
      });
    });

    it("même valeur : ne touche pas l'activité, dont l'athlète a pu changer le flag", async () => {
      const { service, prisma } = buildHarness(true);

      await service.update('user-1', 'w-1', { training: true });

      expect(prisma.activity.updateMany).not.toHaveBeenCalled();
    });

    it("flag absent : ne touche pas l'activité", async () => {
      const { service, prisma } = buildHarness(true);

      await service.update('user-1', 'w-1', { title: 'Séance seuil' });

      expect(prisma.activity.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filtre sur les séances de qualité', async () => {
      const { service, prisma } = buildHarness(false);

      await service.findAll('user-1', Role.ATHLETE, { training: true });

      expect(firstArg(prisma.workout.findMany)).toMatchObject({
        where: { plan: { athleteId: 'ath-1' }, training: true },
      });
    });

    it('côté coach, combine le filtre avec athleteId', async () => {
      const { service, prisma } = buildHarness(false);

      await service.findAll('user-1', Role.COACH, {
        athleteId: 'ath-1',
        training: false,
      });

      expect(firstArg(prisma.workout.findMany)).toMatchObject({
        where: {
          plan: { coachId: 'coach-1', athleteId: 'ath-1' },
          training: false,
        },
      });
    });
  });
});
