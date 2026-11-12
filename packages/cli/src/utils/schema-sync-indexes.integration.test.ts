// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32460] `collectSchemaSyncIndexes` / `renderSchemaSyncIndexes`: what
 * `os migrate plan` lists of the runtime-owned indexes `os migrate apply` builds
 * beside its DDL, over a real SQLite file reached through the guard's own seam
 * resolution (an engine whose `getDriverForObject` answers a `SqlDriver`).
 *
 * The rule each case pins is the module doc's "When apply builds it": a step
 * only where apply's build would send DDL, and nothing where the guard stands
 * (the build reads the catalog first and sends nothing), where its table is not
 * there, or where apply performs nothing. The full one-shot boot face lives in
 * `schema-migrate.grant-guard.integration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { SqlDriver } from '@objectstack/driver-sql';
// [#10126] Pay the dist-resolved dependency's first transform at module load:
// the module under test reaches it through a dynamic `import()`.
import {
  buildUserPermissionSetPackagelessIndexSql,
  runtimeIndexProbes,
  USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME,
} from '@objectstack/metadata-protocol';
import {
  collectSchemaSyncIndexes,
  renderSchemaSyncIndexes,
  SCHEMA_SYNC_INDEX_MIGRATIONS,
  type CollectSchemaSyncIndexesInput,
  type SchemaSyncIndexStep,
} from './schema-sync-indexes.js';

const GRANTS = 'sys_user_permission_set';
const GUARD = USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME;

let dir: string;
let driver: SqlDriver;
let knex: any;

/** The engine surface the guard's seam resolution walks: the driver behind the grant table. */
const engineOf = (d: unknown) => ({ getDriverForObject: () => d });

function input(extra: Partial<CollectSchemaSyncIndexesInput> = {}): CollectSchemaSyncIndexesInput {
  return { schemaSync: 'deferred', applyPerformsWork: true, pending: [], engine: engineOf(driver), ...extra };
}

async function createGrantTable(): Promise<void> {
  await knex.raw(
    `CREATE TABLE ${GRANTS} (id TEXT PRIMARY KEY, user_id TEXT, permission_set TEXT, ` +
    'permission_set_package TEXT, organization_id TEXT)',
  );
}

async function grant(id: string, user: string, set: string, org: string): Promise<void> {
  await knex.raw(
    `INSERT INTO ${GRANTS} (id, user_id, permission_set, permission_set_package, organization_id) VALUES (?, ?, ?, NULL, ?)`,
    [id, user, set, org],
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-32460-'));
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'plan.db') }, useNullAsDefault: true });
  knex = (driver as any).knex;
});

afterEach(async () => {
  await driver.disconnect();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('[#32460] which indexes the plan reads: the ones apply builds', () => {
  it('lists the grant guard, which schema sync builds, and not the activation ledger guard, which only a serving boot builds', () => {
    expect(SCHEMA_SYNC_INDEX_MIGRATIONS).toEqual(['ensureUserPermissionSetPackagelessIndex']);
    // Each one is described by the preflight, which every other field is read from.
    const described = runtimeIndexProbes().map((p) => p.migration);
    for (const migration of SCHEMA_SYNC_INDEX_MIGRATIONS) expect(described).toContain(migration);
    // Built at `kernel:ready` behind `runPlatformMigrations`, which every one-shot
    // CLI boot declares off: apply never builds it, so the plan never lists it.
    expect(described).toContain('ensureActivationLedgerPackagelessIndex');
    expect(SCHEMA_SYNC_INDEX_MIGRATIONS).not.toContain('ensureActivationLedgerPackagelessIndex');
  });
});

describe('[#32460] collectSchemaSyncIndexes: a step only where apply would build', () => {
  it('a table missing the guard: one build step, described from the preflight', async () => {
    await createGrantTable();
    await grant('g1', 'u1', 'sales', 'org1');

    expect(await collectSchemaSyncIndexes(input())).toEqual([{
      migration: 'ensureUserPermissionSetPackagelessIndex',
      table: GRANTS,
      index: GUARD,
      keyParts: ['user_id', 'permission_set', 'organization_id'],
      rowScope: 'permission_set_package IS NULL',
      status: 'build',
    }]);
  });

  it('the guard already stands: no step, because the build sends no DDL', async () => {
    await createGrantTable();
    await knex.raw(buildUserPermissionSetPackagelessIndexSql('better-sqlite3'));

    expect(await collectSchemaSyncIndexes(input())).toEqual([]);
  });

  it('a table the same apply creates: a build step on it, with no read of the database', async () => {
    const pending = [{ table: GRANTS, kind: 'create_table' as const, columns: ['id', 'user_id'] }];
    // No such table here: had it been read, the preflight would answer `table-absent`.
    expect(await collectSchemaSyncIndexes(input({ pending }))).toEqual([
      expect.objectContaining({ table: GRANTS, index: GUARD, status: 'build', onCreatedTable: true }),
    ]);
  });

  it('no grant table and none created: no step, because the build finds no table', async () => {
    expect(await collectSchemaSyncIndexes(input())).toEqual([]);
  });

  it('colliding package-less grants: a blocked step with the key and row counts', async () => {
    await createGrantTable();
    await grant('g1', 'u1', 'sales', 'org1');
    await grant('g2', 'u1', 'sales', 'org1');
    await grant('g3', 'u1', 'sales', 'org1');
    await grant('g4', 'u2', 'ops', 'org1');
    await grant('g5', 'u2', 'ops', 'org1');
    await grant('g6', 'u3', 'ops', 'org1');

    expect(await collectSchemaSyncIndexes(input())).toEqual([
      expect.objectContaining({ index: GUARD, status: 'blocked', duplicateKeys: 2, duplicateRows: 5 }),
    ]);
  });

  it('a seam that answers nothing: unreadable, never read as "already stands"', async () => {
    const dead = { config: { client: 'better-sqlite3' }, execute: async () => { throw new Error('connection reset'); } };

    expect(await collectSchemaSyncIndexes(input({ engine: engineOf(dead) }))).toEqual([
      expect.objectContaining({ index: GUARD, status: 'unreadable', detail: expect.stringContaining('connection reset') }),
    ]);
  });

  it('nothing to apply, or a boot whose apply announces no pass: no step, whatever the database holds', async () => {
    await createGrantTable();
    expect((await collectSchemaSyncIndexes(input()))).toHaveLength(1);

    // Apply returns before its flush: it builds nothing.
    expect(await collectSchemaSyncIndexes(input({ applyPerformsWork: false }))).toEqual([]);
    // A skip-sync boot's flush announces no pass: its primary is left to its serving boot.
    expect(await collectSchemaSyncIndexes(input({ schemaSync: 'skipped' }))).toEqual([]);
  });
});

describe('[#32460] renderSchemaSyncIndexes', () => {
  const base: Omit<SchemaSyncIndexStep, 'status'> = {
    migration: 'ensureUserPermissionSetPackagelessIndex',
    table: GRANTS,
    index: GUARD,
    keyParts: ['user_id', 'permission_set', 'organization_id'],
    rowScope: 'permission_set_package IS NULL',
  };
  const plain = (steps: SchemaSyncIndexStep[]): string[] => {
    const level = chalk.level;
    chalk.level = 0;
    try {
      return renderSchemaSyncIndexes(steps);
    } finally {
      chalk.level = level;
    }
  };

  it('prints nothing when apply builds none', () => {
    expect(plain([])).toEqual([]);
  });

  it('a heading, then one line per index naming the table, the index and its key', () => {
    const lines = plain([{ ...base, status: 'build' }, { ...base, table: 'other_table', status: 'build' }]);
    expect(lines).toHaveLength(4);
    expect(lines[0]!.trim()).not.toBe('');
    expect(lines[1]).toContain(`+ ${GRANTS}.${GUARD}`);
    expect(lines[1]).toContain('(user_id, permission_set, organization_id)');
    expect(lines[1]).toContain('permission_set_package IS NULL');
    expect(lines[2]).toContain(`+ other_table.${GUARD}`);
    expect(lines.at(-1)).toBe('');
  });

  it('a blocked index is marked refused and names its counts and the command that lists the rows', () => {
    const [, line] = plain([{ ...base, status: 'blocked', duplicateKeys: 2, duplicateRows: 5 }]);
    expect(line).toContain(`✗ ${GRANTS}.${GUARD}`);
    expect(line).toMatch(/\b2\b.*\b5\b/);
    expect(line).toContain('os migrate duplicates');
  });

  it('an unreadable index is marked so and carries its detail', () => {
    const [, line] = plain([{ ...base, status: 'unreadable', detail: 'connection reset' }]);
    expect(line).toContain(`? ${GRANTS}.${GUARD}`);
    expect(line).toContain('connection reset');
  });
});
