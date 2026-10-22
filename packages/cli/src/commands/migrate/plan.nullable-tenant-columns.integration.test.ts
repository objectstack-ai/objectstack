// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * [ADR-0131 D1; ruling record 6328195425, letter A, item 2] `os migrate plan`
 * lists the tenant columns a database still holds nullable, in an advisory
 * section of its own that names `os migrate organization-ownership`.
 *
 * A database the published 18.0.0 created is certified with its tenant columns
 * nullable; this one is brought to that shape by rebuilding a table a fresh
 * boot created with its `organization_id` nullable — the 18.0.0 DDL — keeping
 * its rows and indexes.
 *
 * What is pinned, through the public door (`serve`'s provision-and-exit, then
 * the command, from the source entry):
 *
 *  - a fresh store lists nothing (`columns: []`, read — not unreadable);
 *  - the 18.0.0-shaped store lists the nullable tenant column as one the
 *    ceremony tightens, and a rotation shard created nullable as one it leaves;
 *  - ⭐ it is advisory: the plan's `changes` and `total` are the fresh store's,
 *    byte for byte — no drift entry and no op is added — and the exit code is
 *    0 in both faces;
 *  - the human face prints the section and the ceremony's two commands.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const RUN_DEV = resolve(CLI_ROOT, 'bin', 'run-dev.js');
const TSX = resolve(CLI_ROOT, '..', '..', 'node_modules', '.bin', 'tsx');
const CASE_TIMEOUT_MS = 300_000;

const APP_OBJECT = 'os25134_deal';
const SHARD = `${APP_OBJECT}__r20261019`;

const CONFIG = [
  'export default {',
  "  manifest: { id: 'com.example.os25134advisory', name: 'advisory', version: '0.0.0', type: 'app' },",
  "  requires: ['auth'],",
  `  objects: [{ name: '${APP_OBJECT}', fields: { title: { type: 'text' } } }],`,
  '};',
  '',
].join('\n');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

interface Fixture {
  dir: string;
  db: string;
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'os-25134-advisory-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  return { dir, db: join(dir, 'boot.db') };
}

/** The child's environment: the fixture's database, one file, nothing inherited that retargets it. */
function childEnv(f: Fixture, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME',
    'OS_TELEMETRY_DB', 'AUTH_SECRET', 'BETTER_AUTH_SECRET', 'NO_COLOR',
  ]) {
    delete env[key];
  }
  return {
    ...env,
    OS_DATABASE_URL: `file:${f.db}`,
    OS_ARTIFACT_PATH: join(f.dir, 'dist', 'objectstack.json'),
    OS_CLOUD_URL: 'off',
    OS_TELEMETRY_DISABLED: '1',
    OS_TELEMETRY_DB: '0',
    OS_AUTH_SECRET: 'os25134-advisory-secret-at-least-32-characters',
    OS_LOG_LEVEL: 'warn',
    NO_COLOR: '1',
    ...extra,
  };
}

/** `os serve`'s own provision-and-exit: a fresh store, the full composition schema-synced into it. */
function serveBoot(f: Fixture): void {
  const boot = spawnSync(TSX, [RUN_DEV, 'serve', '--no-server', '--no-ui', '--no-console', '--port', '0'], {
    cwd: f.dir, env: childEnv(f, { OS_MIGRATE_AND_EXIT: '1' }), encoding: 'utf8', timeout: 240_000,
  });
  expect(boot.status, `the serving boot did not provision the database:\n${(boot.stderr ?? '').slice(-6000)}`).toBe(0);
}

function plan(f: Fixture, json: boolean): { exit: number | null; payload: any; text: string } {
  const run = spawnSync(TSX, [RUN_DEV, 'migrate', 'plan', ...(json ? ['--json'] : [])], {
    cwd: f.dir, env: childEnv(f), encoding: 'utf8', timeout: 240_000,
  });
  let payload: any;
  if (json) {
    try { payload = JSON.parse(run.stdout); } catch { payload = { unparsed: `${run.stdout}\n${run.stderr}`.slice(-800) }; }
  }
  return { exit: run.status, payload, text: `${run.stdout}\n${run.stderr}` };
}

/**
 * Rebuild `table` with its `organization_id` nullable — the shape the 18.0.0
 * driver created — keeping its rows and its indexes.
 */
function relaxTenantColumn(file: string, table: string): void {
  const db = new Database(file);
  try {
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string };
    const relaxed = sql.replace(/([`"]organization_id[`"][^,]*?)\s+not null/i, '$1');
    if (relaxed === sql) throw new Error(`${table}.organization_id is not NOT NULL in ${sql}`);
    const indexes = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table) as Array<{ sql: string }>)
      .map((i) => i.sql);
    db.exec('PRAGMA foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`ALTER TABLE "${table}" RENAME TO "${table}__pre"`);
      db.exec(relaxed);
      db.exec(`INSERT INTO "${table}" SELECT * FROM "${table}__pre"`);
      db.exec(`DROP TABLE "${table}__pre"`);
      for (const index of indexes) db.exec(index);
    })();
  } finally {
    db.close();
  }
}

function notNull(file: string, table: string): boolean {
  const db = new Database(file, { readonly: true });
  try {
    const col = (db.prepare(`SELECT "notnull" AS nn FROM pragma_table_info(?) WHERE name = 'organization_id'`).get(table)) as { nn: number } | undefined;
    if (!col) throw new Error(`${table} carries no organization_id`);
    return col.nn === 1;
  } finally {
    db.close();
  }
}

describe('os migrate plan lists the nullable tenant columns as an advisory (ADR-0131 D1)', () => {
  it('a fresh store lists nothing; an 18.0.0-shaped one lists them, and neither the drift nor the exit code moves', () => {
    const f = fixture();
    serveBoot(f);
    expect(notNull(f.db, APP_OBJECT), 'a table this release creates carries its tenant column NOT NULL').toBe(true);

    const fresh = plan(f, true);
    expect(fresh.exit, JSON.stringify(fresh.payload).slice(0, 800)).toBe(0);
    expect(fresh.payload.nullableTenantColumns).toEqual({
      status: 'read', adr: 'ADR-0131 D1', remedy: 'os migrate organization-ownership', columns: [],
    });

    // The 18.0.0 shape: the app's tenant column nullable, and a shard rotated in nullable.
    relaxTenantColumn(f.db, APP_OBJECT);
    expect(notNull(f.db, APP_OBJECT)).toBe(false);
    const db = new Database(f.db);
    try { db.exec(`CREATE TABLE "${SHARD}" ("id" varchar(255) PRIMARY KEY, "organization_id" varchar(255))`); } finally { db.close(); }

    const shaped = plan(f, true);
    expect(shaped.exit, JSON.stringify(shaped.payload).slice(0, 800)).toBe(0);
    expect(shaped.payload.nullableTenantColumns).toEqual({
      status: 'read',
      adr: 'ADR-0131 D1',
      remedy: 'os migrate organization-ownership',
      columns: [
        { table: APP_OBJECT, column: 'organization_id', ceremony: 'tightens' },
        { table: SHARD, column: 'organization_id', ceremony: 'leaves', reason: expect.stringMatching(/^a rotation shard of os25134_deal/) },
      ],
    });
    // ⭐ Advisory, not drift: the plan's changes are the fresh store's, and no
    // entry names a tenant column.
    expect(shaped.payload.changes).toEqual(fresh.payload.changes);
    expect(shaped.payload.total).toBe(fresh.payload.total);
    expect(shaped.payload.changes.filter((c: any) => c.column === 'organization_id')).toEqual([]);

    const human = plan(f, false);
    expect(human.exit, human.text.slice(-2000)).toBe(0);
    expect(human.text).toContain('2 tenant column(s) are still nullable (ADR-0131 D1). This is advisory: it is not drift');
    expect(human.text).toContain(`• ${APP_OBJECT}.organization_id\n`);
    expect(human.text).toContain(`• ${SHARD}.organization_id — the ceremony leaves it nullable: a rotation shard of ${APP_OBJECT}`);
    expect(human.text).toContain('tightens 1 of them: run "os migrate organization-ownership --out PLAN"');
  }, CASE_TIMEOUT_MS);
});
