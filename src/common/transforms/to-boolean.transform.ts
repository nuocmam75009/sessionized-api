import { Transform } from 'class-transformer';

// Query string et multipart/form-data ne transportent que des chaînes : sans
// conversion, `?training=false` arriverait comme "false", et `@Type(() => Boolean)`
// en ferait `true` (toute chaîne non vide est vraie). Seuls "true" et "false"
// sont convertis ; toute autre valeur passe telle quelle pour que `@IsBoolean()`
// la refuse au lieu de la deviner.
export const ToBoolean = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
