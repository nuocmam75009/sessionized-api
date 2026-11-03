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

EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js deploy && node dist/src/main.js"]
