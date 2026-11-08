## Objet

<!-- Ce que change la PR, et pourquoi. Lien vers l'issue : Closes #… -->

## Type

- [ ] Fonctionnalité (`feat`)
- [ ] Correction (`fix`)
- [ ] Sécurité
- [ ] Refactorisation, documentation, outillage (`refactor`, `docs`, `chore`, `ci`)

## Vérifications

- [ ] `npm run lint:check`, `npm run build` et `npm test` passent en local
- [ ] Tests ajoutés ou mis à jour (unitaires, e2e si une route change)
- [ ] Migration Prisma livrée si `schema.prisma` change, rétrocompatible (voir README, « Retour arrière »)
- [ ] Aucun secret, aucune donnée personnelle réelle (traces GPS, fichiers `.fit`) dans le diff
- [ ] Contrôle d'accès vérifié pour toute nouvelle route (rôle, propriété de la ressource)
- [ ] README ou Swagger à jour si le contrat de l'API change

## Comment tester

<!-- Étapes, requêtes ou comptes du seed (npm run db:seed) pour vérifier à la main. -->
