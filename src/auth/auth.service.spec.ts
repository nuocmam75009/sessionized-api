import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { LoginAttemptsService } from './login-attempts.service';
import { UsersService } from '../users/users.service';
import { Role } from '../../generated/prisma/enums';

const CREDENTIALS = { email: 'athlete@example.com', password: 'password123' };

describe('AuthService.login', () => {
  let usersService: { findByEmail: jest.Mock };
  let loginAttempts: { consumeAttempt: jest.Mock; reset: jest.Mock };
  let service: AuthService;

  beforeAll(async () => {
    const password = await bcrypt.hash(CREDENTIALS.password, 4);
    usersService = {
      findByEmail: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: CREDENTIALS.email,
        role: Role.ATHLETE,
        password,
      }),
    };
  });

  beforeEach(() => {
    usersService.findByEmail.mockClear();
    loginAttempts = {
      consumeAttempt: jest.fn().mockResolvedValue(0),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      { sign: jest.fn().mockReturnValue('jwt') } as unknown as JwtService,
      loginAttempts as unknown as LoginAttemptsService,
    );
  });

  it('renvoie un JWT et remet le compteur de tentatives à zéro', async () => {
    const result = await service.login(CREDENTIALS);

    expect(result.accessToken).toBe('jwt');
    expect(loginAttempts.consumeAttempt).toHaveBeenCalledWith(
      CREDENTIALS.email,
    );
    expect(loginAttempts.reset).toHaveBeenCalledWith(CREDENTIALS.email);
  });

  it('refuse un mauvais mot de passe sans remettre le compteur à zéro', async () => {
    await expect(
      service.login({ ...CREDENTIALS, password: 'mauvais' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(loginAttempts.consumeAttempt).toHaveBeenCalledTimes(1);
    expect(loginAttempts.reset).not.toHaveBeenCalled();
  });

  it('renvoie 429 sans interroger la base quand le compte est verrouillé', async () => {
    loginAttempts.consumeAttempt.mockResolvedValue(600);

    await expect(service.login(CREDENTIALS)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Trop de tentatives de connexion. Réessayez dans 10 min.',
    });

    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(loginAttempts.reset).not.toHaveBeenCalled();
  });

  it('refuse un compte verrouillé même avec le bon mot de passe', async () => {
    loginAttempts.consumeAttempt.mockResolvedValue(1);

    await expect(service.login(CREDENTIALS)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});

describe('AuthService.register', () => {
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn((input: { email: string; role: Role }) =>
        Promise.resolve({ id: 'user-1', email: input.email, role: input.role }),
      ),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      { sign: jest.fn().mockReturnValue('jwt') } as unknown as JwtService,
      {} as LoginAttemptsService,
    );
  });

  it('athlète : enregistre la date du consentement aux données de santé', async () => {
    const before = Date.now();

    await service.register({
      email: 'camille@example.com',
      password: 'Course-matinale-2026',
      role: Role.ATHLETE,
      healthDataConsent: true,
    });

    const [input] = usersService.create.mock.calls[0] as [
      { healthDataConsentAt?: Date },
    ];
    expect(input.healthDataConsentAt).toBeInstanceOf(Date);
    expect(input.healthDataConsentAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('coach : aucune date de consentement', async () => {
    await service.register({
      email: 'coach@example.com',
      password: 'Course-matinale-2026',
      role: Role.COACH,
    });

    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ healthDataConsentAt: undefined }),
    );
  });
});
