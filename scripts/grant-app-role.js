#!/usr/bin/env node
// Crée ou met à jour le rôle PostgreSQL de l'application, aux droits
// restreints (principe du moindre privilège) :
//
//   - lecture et écriture des données (SELECT, INSERT, UPDATE, DELETE) ;
//   - aucune modification du schéma (ni CREATE, ni ALTER, ni DROP) : seul le
//     rôle propriétaire, utilisé par les migrations, en a le droit ;
//   - lecture seule de _prisma_migrations, que l'API consulte au démarrage
//     pour vérifier qu'aucune migration ne manque.
//
// Une injection SQL qui passerait malgré Prisma ne pourrait donc ni supprimer
// une table ni en créer une. L'application se connecte avec ce rôle
// (DATABASE_URL), les migrations avec le propriétaire (DATABASE_URL_UNPOOLED).
//
// Usage, avec la connexion du propriétaire :
//   APP_DB_PASSWORD=... node scripts/grant-app-role.js
// Variables : APP_DB_ROLE (défaut sessionized_app), APP_DB_PASSWORD
// (obligatoire), DATABASE_URL_UNPOOLED ou, à défaut, DATABASE_URL.
//
// Idempotent : à relancer sans risque. Les tables créées par les migrations
// suivantes héritent des mêmes droits (ALTER DEFAULT PRIVILEGES), à condition
// que les migrations tournent avec le même rôle propriétaire.
require('dotenv/config');

const { Client } = require('pg');

async function grantAppRole({ ownerUrl, role, password }) {
  if (!ownerUrl)
    throw new Error('DATABASE_URL_UNPOOLED ou DATABASE_URL requis');
  if (!password) throw new Error('APP_DB_PASSWORD requis');

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const r = client.escapeIdentifier(role);
    const { rows } = await client.query(
      'SELECT current_database() AS db, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
      [role],
    );
    const db = client.escapeIdentifier(rows[0].db);
    const verb = rows[0].exists ? 'ALTER' : 'CREATE';

    await client.query('BEGIN');
    // NOSUPERUSER… : explicites, pour qu'un ALTER corrige un rôle trop large.
    await client.query(
      `${verb} ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${client.escapeLiteral(password)}`,
    );
    // PostgreSQL < 15 laisse tout utilisateur créer des tables dans public.
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${r}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
    );
    // Historique des migrations : consultable, jamais modifiable par l'API.
    await client.query(
      `REVOKE INSERT, UPDATE, DELETE ON TABLE "_prisma_migrations" FROM ${r}`,
    );
    await client.query('COMMIT');
    return verb === 'CREATE' ? 'créé' : 'mis à jour';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

module.exports = { grantAppRole };

if (require.main === module) {
  const role = process.env.APP_DB_ROLE || 'sessionized_app';
  grantAppRole({
    ownerUrl: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    role,
    password: process.env.APP_DB_PASSWORD,
  })
    .then((result) => console.log(`Rôle ${role} ${result}.`))
    .catch((error) => {
      console.error(`Rôle ${role} : ${error.message}`);
      process.exit(1);
    });
}
