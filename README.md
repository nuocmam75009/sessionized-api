# Sessionized API

Backend NestJS de la plateforme **Sessionized** — application de coaching sportif permettant à un coach de planifier des séances et à un athlète d'analyser ses performances via l'upload de fichiers `.fit`.

---

## Concept

Sessionized met en relation des coachs et des athlètes autour de l'analyse de séances d'entraînement. L'athlète uploade son fichier `.fit` directement depuis sa montre (Garmin, Coros, Polar), le backend parse les données lap par lap et les compare au plan prescrit par le coach. Un **Warning Engine** génère automatiquement des alertes en cas d'écart significatif.

---

## Stack technique

| Couche | Technologie |
|---|---|
| Framework | NestJS (Node.js + TypeScript) |
| Base de données | PostgreSQL |
| Base clé-valeur | Redis (ioredis) — limitation des tentatives de connexion |
| ORM | Prisma |
| Authentification | JWT maison (Passport.js + bcrypt) |
| Upload fichiers | Multer |
| Parser FIT | fit-file-parser |
| Paiement | Stripe Connect |
| Temps réel | WebSockets (NestJS Gateway) |
| Tâches planifiées | NestJS Scheduler (cron) |

---

## Architecture

```
sessionized-api/
├── src/
│   ├── auth/              # JWT, stratégies Passport, guards, décorateurs
│   ├── users/             # Gestion des utilisateurs (ATHLETE / COACH)
│   ├── activities/        # Upload FIT, parsing, persistance
│   ├── plans/             # Séances planifiées et laps cibles
│   ├── analysis/          # Calcul CTL / ATL / TSB (formule Banister)
│   ├── warnings/          # Warning Engine — 4 familles de règles
│   ├── notifications/     # WebSocket Gateway — push temps réel
│   ├── stripe/            # Stripe Connect — abonnements et commission
│   └── prisma/            # Schema, migrations, PrismaService
├── prisma/
│   └── schema.prisma
├── scripts/
│   └── migrate.js         # bascule sur DATABASE_URL_UNPOOLED avant `prisma migrate`
└── .env.example
```

---

## Modèle de données principal

```
User (ATHLETE | COACH)
  ├── AthleteProfile       → coaché par un CoachProfile
  ├── CoachProfile         → gère N AthleteProfiles
  ├── CorosToken           → token API Coros (si accès accordé)
  └── Subscription         → abonnement Stripe actif

Activity (source : FIT | COROS)
  ├── Lap[]                → données lap par lap (allure, FC, cadence, puissance)
  ├── Warning[]            → alertes générées automatiquement
  └── PlannedSession?      → séance prescrite associée (optionnel)

TrainingLoad
  └── CTL / ATL / TSB      → calculé quotidiennement par cron
```

---

## Warning Engine

C'est le cœur métier de l'application. Déclenché automatiquement après chaque upload de fichier `.fit`, il analyse l'activité selon 4 familles de règles :

| Famille | Déclencheur | Exemple |
|---|---|---|
| **Intensité** | Lap trop rapide ou trop lent vs prescrit | Réalisé 1'33"/400m, prescrit 1'50" → critique |
| **Charge** | TSB < -25 ou pic ATL > 130% CTL | Surcharge chronique → récupération recommandée |
| **Pattern** | Même erreur sur 3 séances consécutives | Systématiquement trop rapide → revoir allures |
| **Récupération** | Moins de 18h entre deux séances intensives | Risque de blessure → délai insuffisant |

Chaque warning a une sévérité (`INFO`, `WARNING`, `CRITICAL`) et une suggestion concrète. Les warnings `CRITICAL` déclenchent une notification WebSocket en temps réel vers l'app coach.

---

## Authentification

JWT maison — pas d'IDP externe (pas d'Auth0).

- L'utilisateur s'inscrit avec email + mot de passe
- Le token JWT contient `{ sub, role, email }`
- Le rôle (`ATHLETE` ou `COACH`) est vérifié par un `RolesGuard` sur chaque endpoint
- Un athlète ne peut jamais accéder aux routes coach et vice versa
- Emails normalisés en minuscules (inscription, connexion, recherche)
- `POST /auth/login` et `POST /auth/register` limités à 10 requêtes/minute par IP (le reste de l'API à 300/minute)

### Sécurité HTTP

- En-têtes de sécurité via `helmet` (CSP, HSTS, `nosniff`…)
- CORS limité aux frontends listés dans `CORS_ORIGINS`, pour l'API REST comme pour le WebSocket du chat
- Payloads WebSocket du chat validés avec les mêmes règles que les DTO REST ; l'événement `typing` n'est relayé qu'à l'autre participant de la conversation
- Tokens Strava chiffrés en base (AES-256-GCM, clé `STRAVA_TOKEN_ENCRYPTION_KEY`)
- Variables d'environnement validées au démarrage (`src/config/env.validation.ts`) : l'API refuse de démarrer si la config est incomplète
- Swagger (`/docs`) masqué par défaut en production
- Quota de l'API Strava (partagé par tous les athlètes) : un 429 de Strava renvoie un 503 `STRAVA_RATE_LIMITED` avec `retryAfterSec`, et suspend les appels jusqu'à la réinitialisation de la fenêtre (quart d'heure suivant, ou minuit UTC si le quota du jour est épuisé)

---

## Source de données

L'athlète uploade manuellement son fichier `.fit` depuis son interface. Le backend :

1. Reçoit le fichier via `POST /activities/upload`
2. Calcule un hash SHA-256 pour détecter les doublons
3. Parse les laps avec `fit-file-parser`
4. Persiste l'activité et ses laps en base
5. Déclenche le Warning Engine
6. Notifie en temps réel via WebSocket

> Si l'API Coros est accordée, un second provider viendra brancher ses données sur le même pipeline sans modifier la logique métier.

### Import Strava (alternative à l'upload manuel)

Plutôt que d'uploader `.fit` + `.gpx` à la main, un athlète peut connecter son compte Strava et importer directement une activité :

1. `GET /strava/authorize` → génère l'URL OAuth Strava (le `state` est un JWT signé courte durée contenant l'`athleteId`, vérifié au retour)
2. L'athlète autorise l'accès sur strava.com, redirigé vers `GET /strava/callback` qui échange le `code` contre un token et le stocke chiffré (`StravaToken`, même pattern que `CorosToken`)
3. `GET /strava/activities` → liste les activités Strava récentes (pour un sélecteur côté front), avec un flag `alreadyImported`
4. `POST /strava/activities/:id/import` → récupère laps (`/activities/:id/laps`) + trace GPS et capteurs (`/activities/:id/streams`) auprès de l'API Strava, et alimente les mêmes tables `Activity`/`Lap`/`TrackPoint` que le pipeline `.fit` — aucun fichier `.gpx` séparé n'est nécessaire, Strava fournit position + FC/cadence/puissance dans un seul stream synchronisé.

---

## Paiement

Modèle marketplace via **Stripe Connect** :

- Le coach crée un compte Stripe Express lors de son onboarding
- L'athlète souscrit un abonnement mensuel au tarif fixé par le coach
- Stripe répartit automatiquement : **95% coach / 5% plateforme**
- Un webhook `invoice.paid` active l'accès de l'athlète côté backend

---

## Variables d'environnement

Copie `.env.example` en `.env` et remplis les valeurs (le détail de chacune est commenté dans le fichier) :

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | Oui | Connexion Postgres utilisée par l'app (connexion **poolée** si Neon) |
| `DATABASE_URL_UNPOOLED` | Non | Connexion **directe**, utilisée uniquement par `npm run migrate:*` (nécessaire avec Neon, inutile avec `prisma dev` en local) |
| `JWT_SECRET` | Oui | Secret de signature des tokens JWT — génère-en un avec `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Non (défaut `7d`) | Durée de validité des tokens |
| `REDIS_URL` | Oui | Redis qui compte les tentatives de connexion (5 par compte et par 15 min). En local : `redis://localhost:6379` avec `docker compose up -d redis` ; en prod : Redis managé, URL en `rediss://` (TLS). Si Redis tombe, l'API continue de fonctionner sans cette limitation |
| `PORT` | Non (défaut `3000`) | Mets `3001` pour matcher les frontends (voir plus bas) |
| `NODE_ENV` | Prod : `production` | Active les contrôles de config stricts, masque Swagger, fait confiance au proxy de l'hébergeur |
| `CORS_ORIGINS` | Prod : oui (dev : frontends locaux) | URLs des frontends autorisés, séparées par des virgules |
| `SWAGGER_ENABLED` | Non (défaut : `true` en dev, `false` en prod) | Force l'affichage de `/docs` |
| `TRUST_PROXY` | Non (défaut : `1` en prod, `0` en dev) | Nombre de reverse proxies devant l'API (IP réelle du client pour le rate limiting) |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` | Non | Uniquement pour tester les routes `/strava/*` — créer une app sur https://www.strava.com/settings/api |
| `STRAVA_TOKEN_ENCRYPTION_KEY` | Oui si Strava est utilisé | Clé AES-256 (32 octets en base64) qui chiffre les tokens Strava en base — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Même clé pour tous ceux qui partagent une base** : sinon les tokens des autres ne se déchiffrent plus |
| `ATHLETE_APP_URL` | Non (défaut `http://localhost:3000`) | URL de redirection après le callback OAuth Strava |

> Stripe et Coros sont mentionnés dans la stack technique cible du projet mais **pas encore implémentés** dans le code — aucune variable d'environnement associée n'est donc requise pour l'instant.

### D'où vient `DATABASE_URL` ?

Le projet utilise une base **PostgreSQL hébergée sur Neon**, partagée entre les contributeurs (projet `Sessionized`), plutôt qu'une base par machine.

**Si tu rejoins le projet** :
1. Demande à un membre de l'équipe de t'inviter sur l'organisation Neon `Sessionized` (organization ID `org-patient-unit-17777478`).
2. Installe et authentifie le CLI Neon, puis lie le projet et récupère les variables :
   ```bash
   npx neon@latest auth
   npx neon@latest link          # sélectionne l'org "Sessionized" / projet "Sessionized"
   npx neon@latest env pull      # écrit DATABASE_URL et DATABASE_URL_UNPOOLED dans .env
   ```
   (Un fichier `.neon` déjà présent dans le repo pointe vers le bon projet — `link` devrait le détecter automatiquement.)

**Si tu veux juste bosser en local sans toucher à la base partagée** (ex. pour un test destructif) :
```bash
npx prisma dev --detach   # affiche directement l'URL prisma+postgres://... à coller dans DATABASE_URL
```
Dans ce cas, laisse `DATABASE_URL_UNPOOLED` vide — inutile en local.

---

## Lancer en développement

```bash
# Installer les dépendances (régénère aussi automatiquement le client Prisma via postinstall)
npm install

# Configurer .env (voir section précédente)
cp .env.example .env

# Démarrer Redis (Docker requis)
docker compose up -d redis

# Appliquer les migrations Prisma (bascule automatiquement sur la connexion directe)
npm run migrate:deploy

# Lancer le serveur
npm run start:dev
```

L'API est disponible sur `http://localhost:3001`, la doc Swagger sur `http://localhost:3001/docs`.

> Pour créer une nouvelle migration après avoir modifié `prisma/schema.prisma`, utilise `npm run migrate:dev` (équivalent de `prisma migrate dev`, mais avec la bonne connexion).

---

## Tests

```bash
# Tests unitaires (aucun service requis)
npm test
npm run test:cov        # avec rapport de couverture dans coverage/

# Tests e2e et de sécurité : vraie application, vrai PostgreSQL, vrai Redis
docker compose up -d redis postgres-test
npm run test:e2e
```

- Les tests e2e tournent sur le conteneur `postgres-test` (port 5433, données en mémoire), **jamais sur la base Neon du `.env`** : `test/e2e-env.ts` refuse toute base non locale. Les migrations y sont appliquées automatiquement avant les tests. `E2E_DATABASE_URL` et `E2E_REDIS_URL` permettent de viser d'autres services locaux.
- [test/security.e2e-spec.ts](test/security.e2e-spec.ts) couvre le contrôle d'accès (IDOR, rôles, élévation de privilège), les jetons JWT (expiré, modifié, mal signé, `alg: none`, `state` OAuth réutilisé), la force brute sur la connexion, la validation des entrées et des uploads, les en-têtes de sécurité et le CORS.
- `test:e2e` lance Jest avec `--experimental-vm-modules` : le client Prisma 7 charge son moteur de requêtes (WASM) par un `import()` dynamique, que Jest refuse sans ce drapeau.

### Intégration continue

[.github/workflows/ci.yml](.github/workflows/ci.yml) s'exécute sur chaque PR et chaque push sur `master` : `npm ci`, lint (`npm run lint:check`, sans correction automatique), build, tests unitaires avec couverture, tests e2e sur des services PostgreSQL et Redis jetables, audit des dépendances de production (`npm audit --omit=dev --audit-level=high`), puis construction de l'image Docker. Dependabot ([.github/dependabot.yml](.github/dependabot.yml)) propose chaque semaine les mises à jour npm, GitHub Actions et de l'image Node.

---

## Déploiement

L'API a besoin d'un process Node persistant (WebSocket du chat) : Render, Railway, Fly… — pas d'hébergement serverless type Vercel. Garder **une seule instance** (socket.io sans adapter Redis ne se partage pas entre instances).

| Étape | Commande |
|---|---|
| Build | `npm ci --include=dev && npm run build` |
| Migrations (avant chaque démarrage) | `npm run migrate:deploy` |
| Démarrage | `npm run start:prod` |
| Health check | `GET /health` : 200 si la base répond (`status` `ok`, ou `degraded` si Redis est en panne), 503 sinon |

- `--include=dev` est nécessaire : avec `NODE_ENV=production`, npm n'installe pas les devDependencies, dont `@nestjs/cli` qui sert au build.
- Utiliser une base (ou branche) Neon **dédiée** à la prod, avec `DATABASE_URL` (poolée) et `DATABASE_URL_UNPOOLED` (directe, pour les migrations).
- Variables minimales : `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_SECRET` (nouveau, ≥ 32 caractères), `CORS_ORIGINS`, `REDIS_URL`. Avec Strava : `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI=https://<api>/strava/callback`, `STRAVA_TOKEN_ENCRYPTION_KEY`, `ATHLETE_APP_URL` — et mettre à jour l'« Authorization Callback Domain » de l'app Strava.
- Redis sur Render : créer un **Key Value** dans la même région que l'API, sans IP autorisée en externe, et copier son URL **interne** dans `REDIS_URL`.

### Avec Docker

Un `Dockerfile` multi-stage est fourni à la racine :

```bash
docker build -t sessionized-api .
docker run -p 3000:3000 --env-file .env sessionized-api
```

Au démarrage, le conteneur applique automatiquement les migrations Prisma (`migrate:deploy`) avant de lancer le serveur. L'image définit `NODE_ENV=production` : il faut donc les mêmes variables que ci-dessus.

Le process tourne sous l'utilisateur non privilégié `node` (uid 1000), et un `HEALTHCHECK` interroge `GET /health` toutes les 30 secondes : `docker ps` affiche `healthy`, ou `unhealthy` après trois échecs.

> Dans un conteneur, `localhost` désigne le conteneur lui-même : pour joindre le Redis de `docker compose` depuis `docker run`, utilise `REDIS_URL=redis://host.docker.internal:6379`.

---

## Frontends associés

| App | Repo | URL de dev |
|---|---|---|
| Athlète | `sessionized-athlete` | `http://localhost:3000` |
| Coach | `sessionized-coach` | `http://localhost:3002` |

Les deux frontends consomment cette API via la variable d'environnement `NEXT_PUBLIC_API_URL`.

---

## Projet académique

Développé dans le cadre du projet de fin d'année **Holberton School** (décembre 2026).