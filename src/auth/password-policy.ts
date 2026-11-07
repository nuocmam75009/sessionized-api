/**
 * Politique de mots de passe, d'après la recommandation de la CNIL
 * (délibération n° 2022-100 du 21 juillet 2022).
 *
 * Les tentatives de connexion sont limitées (5 par compte et par 15 minutes,
 * cf. LoginAttemptsService, et 10 requêtes par minute et par IP sur /auth) :
 * c'est le « cas n° 2, mot de passe et restriction d'accès au compte »
 * (§ 42-43), qui demande l'équivalent d'une entropie d'au moins 50 bits. Un
 * mot de passe est accepté s'il suit l'un des trois exemples que la CNIL donne
 * pour ce cas :
 *   1. au moins 8 caractères comportant 3 des 4 catégories (majuscules,
 *      minuscules, chiffres, caractères spéciaux) ;
 *   2. une phrase de passe d'au moins 5 mots ;
 *   3. au moins 16 chiffres.
 * Il est refusé dans tous les cas s'il est courant ou prévisible (§ 37), et
 * chaque refus en donne la raison (§ 36). La longueur maximale (72, limite de
 * bcrypt) respecte le minimum de 50 caractères du § 31.
 */

export const PASSWORD_MAX_LENGTH = 72;

export type PasswordIssue = 'TOO_WEAK' | 'TOO_COMMON' | 'PERSONAL';

export const PASSWORD_ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  TOO_WEAK:
    "Mot de passe trop faible : il faut au moins 8 caractères mêlant 3 types parmi majuscules, minuscules, chiffres et caractères spéciaux, ou une phrase d'au moins 5 mots, ou au moins 16 chiffres.",
  TOO_COMMON:
    'Mot de passe trop courant ou trop prévisible (mot courant suivi de chiffres, suite ou répétition de caractères) : choisissez-en un autre.',
  PERSONAL:
    'Le mot de passe ne doit contenir ni votre nom, ni votre adresse e-mail, ni le nom du service.',
};

const MIN_LENGTH = 8;
const MIN_CATEGORIES = 3;
const PASSPHRASE_MIN_WORDS = 5;
const DIGITS_ONLY_MIN_LENGTH = 16;
// En dessous, une donnée personnelle ou un mot courant est trop court pour
// être cherché dans le mot de passe sans refuser à tort (« al », « jo »).
const MIN_PERSONAL_WORD_LENGTH = 4;

const CATEGORIES = [
  /\p{Lu}/u, // majuscules, accentuées comprises
  /\p{Ll}/u, // minuscules, accentuées comprises
  /\p{Nd}/u, // chiffres
  /[^\p{L}\p{Nd}]/u, // caractères spéciaux, espace compris
];

// Mots de passe et radicaux parmi les plus répandus, plus les termes propres
// au service (§ 37 : « listes de mots de passe interdits spécifiques au
// service utilisé »). Comparés au radical du mot de passe, débarrassé des
// chiffres et symboles en tête et en fin et des substitutions usuelles
// (« P@ssw0rd1! » → « password »). Liste courte, proportionnée au risque
// d'un service de coaching sportif.
const COMMON_STEMS = new Set([
  'password',
  'passwd',
  'passe',
  'motdepasse',
  'motpasse',
  'azerty',
  'azertyuiop',
  'qwerty',
  'qwertyuiop',
  'qwertz',
  'abcdef',
  'admin',
  'administrateur',
  'root',
  'user',
  'utilisateur',
  'test',
  'welcome',
  'bienvenue',
  'bonjour',
  'hello',
  'salut',
  'coucou',
  'soleil',
  'iloveyou',
  'loveyou',
  'jetaime',
  'doudou',
  'chouchou',
  'loulou',
  'princesse',
  'football',
  'marseille',
  'paris',
  'france',
  'monkey',
  'dragon',
  'master',
  'letmein',
  'sunshine',
  'superman',
  'batman',
  'pokemon',
  'starwars',
  'secret',
  'changeme',
  'default',
  'login',
  // Propres à Sessionized et à son public.
  'session',
  'sessionized',
  'strava',
  'coros',
  'garmin',
  'coach',
  'athlete',
  'sport',
  'running',
  'marathon',
  'triathlon',
  'trail',
  'velo',
  'course',
  'entrainement',
  'training',
]);

const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
};

/**
 * Raisons du refus d'un mot de passe, vide s'il est accepté.
 * `personalWords` : nom, prénom, partie locale de l'adresse e-mail.
 */
export function evaluatePassword(
  password: string,
  personalWords: readonly string[] = [],
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (!followsCnilExample(password)) issues.push('TOO_WEAK');
  if (isPredictable(password)) issues.push('TOO_COMMON');
  if (containsPersonalWord(password, personalWords)) issues.push('PERSONAL');
  return issues;
}

function followsCnilExample(password: string): boolean {
  const categories = CATEGORIES.filter((category) =>
    category.test(password),
  ).length;
  const words = new Set(
    password
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length >= 2),
  );

  return (
    (password.length >= MIN_LENGTH && categories >= MIN_CATEGORIES) ||
    words.size >= PASSPHRASE_MIN_WORDS ||
    new RegExp(`^\\d{${DIGITS_ONLY_MIN_LENGTH},}$`).test(password)
  );
}

function isPredictable(password: string): boolean {
  const normalized = normalize(password);
  return (
    COMMON_STEMS.has(stem(normalized)) ||
    // « Aa123456 », « Abc12345! » : quelques lettres puis des chiffres.
    /^\p{L}{1,3}\p{Nd}+[^\p{L}\p{Nd}]*$/u.test(password) ||
    // « aaaaaaaa », « Aa1!Aa1! », « 123123123123 ».
    /^(.{1,4})\1+$/u.test(normalized) ||
    isSequence(normalized)
  );
}

function containsPersonalWord(
  password: string,
  personalWords: readonly string[],
): boolean {
  const compact = alphanumeric(normalize(password));
  // « jean.dupont » est cherché en entier et morceau par morceau.
  return ['sessionized', ...personalWords]
    .flatMap((word) => {
      const normalized = normalize(word);
      return [alphanumeric(normalized), ...normalized.split(/[^a-z0-9]+/)];
    })
    .some(
      (token) =>
        token.length >= MIN_PERSONAL_WORD_LENGTH && compact.includes(token),
    );
}

// Minuscules sans accents : « Élodie » et « elodie » se comparent.
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function alphanumeric(value: string): string {
  return value.replace(/[^a-z0-9]/g, '');
}

// Radical d'un mot de passe normalisé : sans chiffres ni symboles en tête et
// en fin, substitutions usuelles inversées, réduit à ses lettres.
function stem(normalized: string): string {
  return normalized
    .replace(/^[^a-z]+|[^a-z]+$/g, '')
    .replace(/[@4310!5$7]/g, (char) => LEET[char])
    .replace(/[^a-z]/g, '');
}

// Suite de caractères consécutifs, croissante ou décroissante : « abcdefgh »,
// « 87654321 », et « 1234567890123456 » (les chiffres bouclent après 9).
function isSequence(normalized: string): boolean {
  if (normalized.length < 3) return false;
  const digitsOnly = /^\d+$/.test(normalized);
  const steps = new Set<number>();
  for (let i = 1; i < normalized.length; i++) {
    const delta = normalized.charCodeAt(i) - normalized.charCodeAt(i - 1);
    steps.add(digitsOnly ? (delta + 10) % 10 : delta);
  }
  if (steps.size !== 1) return false;
  const [step] = steps;
  return digitsOnly ? step === 1 || step === 9 : step === 1 || step === -1;
}
