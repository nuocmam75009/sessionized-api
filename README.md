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
├── .env.example
├── Dockerfile
└── docker-compose.yml
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

---

## Paiement

Modèle marketplace via **Stripe Connect** :

- Le coach crée un compte Stripe Express lors de son onboarding
- L'athlète souscrit un abonnement mensuel au tarif fixé par le coach
- Stripe répartit automatiquement : **95% coach / 5% plateforme**
- Un webhook `invoice.paid` active l'accès de l'athlète côté backend

---

## Variables d'environnement

Copie `.env.example` en `.env` et remplis les valeurs :

```env
# Base de données
DATABASE_URL="postgresql://user:password@localhost:5432/sessionized"

# JWT
JWT_SECRET="ton_secret_jwt_tres_long"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Coros (si accordé)
COROS_CLIENT_ID=""
COROS_CLIENT_SECRET=""
```

---

## Lancer en développement

```bash
# Installer les dépendances
npm install

# Lancer PostgreSQL (Docker)
docker compose up -d postgres

# Appliquer les migrations Prisma
npx prisma migrate dev

# Lancer la BDD
npx prisma dev --detach

# Lancer le serveur
npm run start:dev
```

L'API est disponible sur `http://localhost:3001`.

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