import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './dto/register.dto';
import { PASSWORD_ISSUE_MESSAGES, evaluatePassword } from './password-policy';

describe('evaluatePassword — exemples du cas n° 2 de la CNIL (§ 42)', () => {
  it.each([
    ['exemple 1 : 8 caractères, 3 catégories sur 4', 'Kx7mP2qL'],
    ['exemple 1 : les 4 catégories', 'Velo#Nuit42'],
    [
      'exemple 2 : phrase de 5 mots, accents compris',
      'le vélo double la péniche',
    ],
    ['exemple 3 : 16 chiffres', '8203917465028371'],
  ])('accepté — %s', (_, password) => {
    expect(evaluatePassword(password)).toEqual([]);
  });

  it.each([
    ['7 caractères', 'Kx7mP2q'],
    ['une seule catégorie, même long', 'motdepassetreslong'],
    ['2 catégories seulement', 'kx7mp2ql'],
    ['phrase de 4 mots', 'le chat de ma'],
    ['phrase de 5 mots dont un répété', 'le chat le chat dort'],
    ['15 chiffres', '820391746502837'],
  ])('trop faible — %s', (_, password) => {
    expect(evaluatePassword(password)).toContain('TOO_WEAK');
  });
});

describe('evaluatePassword — mots de passe courants ou prévisibles (§ 37)', () => {
  it.each([
    ['mot courant suivi de chiffres', 'Azerty123!'],
    ['substitutions usuelles', 'P@ssw0rd1!'],
    ['quelques lettres puis des chiffres', 'Aa123456'],
    ['répétition d’un motif', 'Aa1!Aa1!'],
    ['suite de chiffres, même sur 16 chiffres', '1234567890123456'],
    ['suite de lettres', 'Abcdefgh'],
    ['terme propre au service', 'Strava2026!'],
  ])('refusé — %s', (_, password) => {
    expect(evaluatePassword(password)).toContain('TOO_COMMON');
  });

  it('un mot courant au milieu d’une phrase n’est pas refusé pour autant', () => {
    expect(evaluatePassword('Soleil-sur-la-piste-9')).toEqual([]);
  });
});

describe('evaluatePassword — données personnelles', () => {
  it('nom du service : refusé', () => {
    expect(evaluatePassword('Mon-Sessionized-77')).toContain('PERSONAL');
  });

  it('morceau de l’adresse e-mail : refusé', () => {
    expect(evaluatePassword('Dupont-Course-77', ['jean.dupont'])).toContain(
      'PERSONAL',
    );
  });

  it('prénom, accents ignorés : refusé', () => {
    expect(evaluatePassword('elodie-Course-77', ['Élodie'])).toContain(
      'PERSONAL',
    );
  });

  it('donnée trop courte pour être cherchée : ignorée', () => {
    expect(evaluatePassword('Course-matinale-Al-77', ['Al'])).toEqual([]);
  });
});

describe('RegisterDto.password', () => {
  const errorsFor = async (password: string) => {
    const dto = plainToInstance(RegisterDto, {
      email: 'Camille.Martin@example.com',
      password,
      role: 'ATHLETE',
      firstName: 'Camille',
    });
    const errors = await validate(dto);
    return errors.find((error) => error.property === 'password');
  };

  it('mot de passe conforme : aucune erreur', async () => {
    expect(await errorsFor('Course-matinale-2026')).toBeUndefined();
  });

  it('chaque raison du refus figure dans le message (§ 36)', async () => {
    const error = await errorsFor('martin123');

    const message = error?.constraints?.isCompliantPassword;
    expect(message).toContain(PASSWORD_ISSUE_MESSAGES.TOO_WEAK);
    expect(message).toContain(PASSWORD_ISSUE_MESSAGES.PERSONAL);
  });

  it('plus de 72 caractères : refusé (limite de bcrypt)', async () => {
    const error = await errorsFor(`Course-matinale-${'x'.repeat(60)}`);

    expect(error?.constraints).toHaveProperty('maxLength');
  });
});
