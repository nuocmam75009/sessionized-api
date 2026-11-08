# Contribuer à Sessionized API

## Branches

- `master` : branche de production, protégée. On n'y pousse jamais directement : tout passe par une pull request dont la CI est verte.
- Une branche par sujet, nommée d'après son type et l'issue : `feat/#21-strava`, `fix/#30-upload-doublon`, `chore/rncp-ci-tests-securite`.

### Protection de `master` (réglage GitHub)

*Settings → Branches → Branch protection rules* sur `master` :

- exiger une pull request avant de fusionner ;
- exiger le succès du job **Qualité et tests** (`.github/workflows/ci.yml`) ;
- exiger une branche à jour avec `master` avant de fusionner ;
- interdire les *force push* et la suppression de la branche.

## Messages de commit

Format [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/), en français :

```
<type>(<portée>): <résumé à l'impératif, sans point final>

<corps : le pourquoi, le contexte, ce qui a été vérifié>
```

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug ou de faille |
| `refactor` | Restructuration sans changement de comportement |
| `test` | Ajout ou correction de tests |
| `docs` | Documentation seule |
| `ci` | Pipeline d'intégration continue |
| `chore` | Outillage, dépendances, configuration |
| `style` | Formatage, lint |

La portée est le module concerné : `auth`, `activities`, `strava`, `users`, `db`, `deps`…

Exemples tirés de l'historique :

```
fix(activities): import atomique et doublon simultané en 409
feat(auth): révocation des jetons à la déconnexion
ci: pipeline GitHub Actions et Dependabot
```

## Avant d'ouvrir une pull request

```bash
npm run lint:check
npm run build
npm test
docker compose up -d redis postgres-test && npm run test:e2e
```

Puis remplir le modèle de pull request ([.github/pull_request_template.md](.github/pull_request_template.md)).
