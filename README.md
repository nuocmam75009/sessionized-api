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
2. L'athlète autorise l'accès sur strava.com, redirigé vers `GET /strava/callback` qui échange le `code` contre un token et le stocke (`StravaToken`, même pattern que `CorosToken`)
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
| `PORT` | Non (défaut `3000`) | Mets `3001` pour matcher les frontends (voir plus bas) |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` / `STRAVA_REDIRECT_URI` | Non | Uniquement pour tester les routes `/strava/*` — créer une app sur https://www.strava.com/settings/api |
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

# Appliquer les migrations Prisma (bascule automatiquement sur la connexion directe)
npm run migrate:deploy

# Lancer le serveur
npm run start:dev
```

L'API est disponible sur `http://localhost:3001`, la doc Swagger sur `http://localhost:3001/docs`.

> Pour créer une nouvelle migration après avoir modifié `prisma/schema.prisma`, utilise `npm run migrate:dev` (équivalent de `prisma migrate dev`, mais avec la bonne connexion).

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