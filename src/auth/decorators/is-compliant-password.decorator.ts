import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import {
  PASSWORD_ISSUE_MESSAGES,
  evaluatePassword,
  type PasswordIssue,
} from '../password-policy';

/**
 * Applique la politique de mots de passe (password-policy.ts) à un champ de
 * DTO. Les données personnelles comparées au mot de passe (nom, prénom,
 * partie locale de l'e-mail) sont lues sur le même objet. Le message d'erreur
 * donne chaque raison du refus, comme le demande la CNIL (§ 36).
 */
export function IsCompliantPassword(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isCompliantPassword',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown, args: ValidationArguments) =>
          issuesOf(value, args).length === 0,
        defaultMessage: (args: ValidationArguments) =>
          issuesOf(args.value, args)
            .map((issue) => PASSWORD_ISSUE_MESSAGES[issue])
            .join(' '),
      },
    });
  };
}

function issuesOf(value: unknown, args: ValidationArguments): PasswordIssue[] {
  if (typeof value !== 'string') return ['TOO_WEAK'];

  const { email, firstName, lastName } = args.object as Record<string, unknown>;
  const personalWords = [
    typeof email === 'string' ? email.split('@')[0] : undefined,
    firstName,
    lastName,
  ].filter((word): word is string => typeof word === 'string');

  return evaluatePassword(value, personalWords);
}
