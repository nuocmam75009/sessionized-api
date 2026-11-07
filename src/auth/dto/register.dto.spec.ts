import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

// Consentement explicite aux données de santé (art. 9 RGPD) : exigé pour un
// athlète, sans objet pour un coach.
describe('RegisterDto.healthDataConsent', () => {
  const consentErrorFor = async (fields: Record<string, unknown>) => {
    const dto = plainToInstance(RegisterDto, {
      email: 'camille@example.com',
      password: 'Course-matinale-2026',
      ...fields,
    });
    const errors = await validate(dto);
    return errors.find((error) => error.property === 'healthDataConsent');
  };

  it('athlète qui a coché la case : accepté', async () => {
    expect(
      await consentErrorFor({ role: 'ATHLETE', healthDataConsent: true }),
    ).toBeUndefined();
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    // Une chaîne n'est pas un consentement : seule la valeur true compte.
    ['la chaîne "true"', 'true'],
  ])('athlète, consentement %s : refusé', async (_label, healthDataConsent) => {
    const error = await consentErrorFor({ role: 'ATHLETE', healthDataConsent });

    expect(error?.constraints?.equals).toContain('données de santé');
  });

  it('coach sans consentement : accepté', async () => {
    expect(await consentErrorFor({ role: 'COACH' })).toBeUndefined();
  });
});
