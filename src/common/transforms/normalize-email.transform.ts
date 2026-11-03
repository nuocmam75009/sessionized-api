import { Transform } from 'class-transformer';

// Emails stockés et recherchés en minuscules : "Lucas@x.com" et "lucas@x.com"
// désignent le même compte (et la majuscule auto des claviers mobiles ne casse
// plus la connexion).
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
