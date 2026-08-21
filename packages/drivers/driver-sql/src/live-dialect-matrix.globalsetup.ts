// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9350 — create the per-file schemas before any test opens a connection.
 *
 * ## Why this runs here and not in a hook
 *
 * The isolation names each file's database in the CONNECTION (see
 * `mysqlUrlForSchema`), which is what keeps knex's `client.database()` and the
 * session the same value. The cost of that choice is an ordering constraint:
 * connecting to a MySQL database that does not exist fails at the handshake, so
 * the databases have to exist before the first pool opens.
 *
 * A `beforeAll` cannot do it. `cell.config()` is called from inside `beforeEach`
 * in most of the eleven consumers, which is too late to register a hook, and the
 * testkit module is cached PER WORKER rather than per file — so a hook
 * registered at its module scope would attach to whichever file that worker
 * collected first and to no other. `globalSetup` runs once, in the main process,
 * before any worker starts, and can await. That is exactly the shape of the
 * constraint.
 *
 * ## Deliberately total, and deliberately cheap
 *
 * It creates a schema for EVERY test file in the package rather than for the
 * live ones only. Deciding which files are live would mean parsing them, and a
 * wrong answer is a handshake failure in a required check. A schema costs one
 * dictionary row on both dialects (`create database` on MySQL is not a template
 * copy the way Postgres' `createdb` is), and the teardown removes them.
 *
 * Without either URL this does nothing at all: a developer running without
 * servers sees no connection attempt, exactly as before.
 */

import knex from 'knex';
import { liveSchemaLedger } from './live-dialect-matrix.testkit.js';

const PG_URL = process.env.OS_TEST_POSTGRES_URL;
const MYSQL_URL = process.env.OS_TEST_MYSQL_URL;

/**
 * Statements are built from the ledger's names, never from anything a caller
 * supplies, and `liveSchemaNameFor` refuses to emit a name outside
 * `/^[a-z][a-z0-9_]*$/` — so the interpolation below cannot carry a quote.
 */
async function withServer<T>(
  client: 'pg' | 'mysql2',
  connection: string,
  run: (db: ReturnType<typeof knex>) => Promise<T>,
): Promise<T> {
  const db = knex({ client, connection, pool: { min: 0, max: 1 } });
  try {
    return await run(db);
  } finally {
    await db.destroy();
  }
}

export async function setup(): Promise<void> {
  const ledger = liveSchemaLedger();
  if (PG_URL) {
    await withServer('pg', PG_URL, async (db) => {
      for (const { schema } of ledger) {
        await db.raw(`create schema if not exists "${schema}"`);
      }
    });
  }
  if (MYSQL_URL) {
    await withServer('mysql2', MYSQL_URL, async (db) => {
      for (const { schema } of ledger) {
        await db.raw(`create database if not exists \`${schema}\``);
      }
    });
  }
}

/**
 * Drop what the setup created.
 *
 * Best-effort by design: a failed drop must not turn a green run red — the
 * schemas are re-created idempotently next time, and CI's servers are thrown
 * away with the job. It exists for the developer running against a long-lived
 * local server, who would otherwise accumulate one schema per test file.
 */
export async function teardown(): Promise<void> {
  const ledger = liveSchemaLedger();
  if (PG_URL) {
    await withServer('pg', PG_URL, async (db) => {
      for (const { schema } of ledger) {
        await db.raw(`drop schema if exists "${schema}" cascade`).catch(() => {});
      }
    }).catch(() => {});
  }
  if (MYSQL_URL) {
    await withServer('mysql2', MYSQL_URL, async (db) => {
      for (const { schema } of ledger) {
        await db.raw(`drop database if exists \`${schema}\``).catch(() => {});
      }
    }).catch(() => {});
  }
}
