#!/usr/bin/env node
// Prisma Migrate doit passer par la connexion directe (non poolée) de Neon,
// sinon PgBouncer casse les migrations (`prepared statement "s0" already exists`).
// Ce script bascule DATABASE_URL sur DATABASE_URL_UNPOOLED avant d'appeler la CLI Prisma.
require('dotenv/config');

const { spawnSync } = require('child_process');

if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
}

const args = process.argv.slice(2);
const result = spawnSync('npx', ['--no', 'prisma', 'migrate', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
