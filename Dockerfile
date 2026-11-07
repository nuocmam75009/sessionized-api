# ---- Dépendances + génération du client Prisma ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# tsconfig.json avant `npm ci` : le postinstall lance `prisma generate`, qui en
# déduit l'extension des imports du client (".js" en nodenext). Sans lui, le
# client importe "./internal/class.ts" et l'API plante au démarrage.
COPY prisma.config.ts tsconfig.json ./
RUN npm ci

# ---- Build (compilation TypeScript) ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Dépendances de production uniquement ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npm ci --omit=dev

# ---- Image finale ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/generated ./generated
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY --from=build /app/dist ./dist

# Utilisateur non privilégié fourni par l'image Node (uid 1000) : une faille
# exploitée dans l'API ne donne pas les droits root dans le conteneur. Les
# fichiers copiés restent à root, donc non modifiables par le process.
USER node

EXPOSE 3000
# Sonde Docker sur GET /health (503 si la base est injoignable). `wget` est
# fourni par BusyBox dans l'image Alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Le conteneur ne lance que l'API. Les migrations sont une étape de
# déploiement distincte, exécutée une fois avec la même image avant de
# démarrer la nouvelle version (cf. README, « Déploiement ») :
#   docker run --rm --env-file .env.production <image> node scripts/migrate.js deploy
# Au démarrage, l'API vérifie qu'aucune migration livrée ne manque en base.
# Forme exec : node est le PID 1 et reçoit directement le SIGTERM de
# `docker stop`, donc l'arrêt propre (enableShutdownHooks) a bien lieu.
CMD ["node", "dist/src/main.js"]
