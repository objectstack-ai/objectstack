// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D10 item 5] The v18 boot refusal must not deadlock the upgrade.
//
// The ceremony (`os migrate organization-ownership --apply`) refuses to name a
// grant's set until `sys_user_permission_set.permission_set` exists, and says
// "Boot this release once against the database (its schema sync adds the
// column)". The boot refusal refuses a v17-shape database until the ceremony's
// marker is verified. If the refusal fired BEFORE the boot's additive schema
// sync, the refused boot would add nothing, the ceremony would keep refusing,
// and a 17.x database could never upgrade.
//
// Measured here end to end, on the showcase composition over a SQLite file a
// v17 runtime could have left — `sys_user_permission_set` without its
// `permission_set` column; `sys_migration_journal` and `sys_metadata` (objects
// that declare no organization column) still carrying a physical
// `organization_id`:
//
//  1. the v18 boot is refused, naming the command — and the refused boot has
//     ALREADY added the column the ceremony waits for: the guard runs at
//     `kernel:ready`, after every plugin's `start()`, which is where the schema
//     sync runs;
//  2. `os migrate organization-ownership --apply` (the real CLI, as an
//     operator runs it) completes with no boot in between, and verifies its
//     marker;
//  3. the next v18 boot succeeds.
//
// ⚠ Needs the `sys_metadata` family's no-column schema beside the refusal:
// against a release whose family still declares the column, step 2 stops at
// `column-drops` (the declaration keeps it). The two land together.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import {
  OrganizationOwnershipBootGuardPlugin,
  isOrganizationOwnershipBootRefusal,
} from '@objectstack/runtime';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const CLI_BIN = join(dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json')), 'bin', 'run.js');

const columnsOf = (file: string, table: string): string[] => {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
};

/** A v18 boot of the showcase over `file`, the guard composed as `os serve` composes it; the refusal, or null. */
async function boot(file: string): Promise<unknown> {
  try {
    const stack = await bootShowcase({
      databaseFile: file,
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }),
      extraPlugins: [new OrganizationOwnershipBootGuardPlugin()],
    });
    await stack.stop();
    return null;
  } catch (error) {
    return error;
  }
}

describe('[ADR-0131 D10 item 5] a 17.x database upgrades through the boot refusal, never around it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-ownership-order-'));
  const file = join(dir, 'showcase.db');
  /**
   * The ceremony's output, copied the moment it is verified. An operator's
   * refused `os serve` process has exited before the ceremony runs; the
   * refused boot here lives on in this process, its SQLite driver never torn
   * down (bootstrap failed before any handle came back), and a later boot over
   * the SAME path met its stale image — measured: the columns back and no
   * marker. Booting the copied bytes is the operator's sequence.
   */
  const migrated = join(dir, 'showcase.migrated.db');
  let refusal: unknown;

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('1. a v17-shape database is refused, naming the command', async () => {
    const seed = new DatabaseSync(file);
    seed.exec(`
      CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, user_id TEXT, permission_set_id TEXT, organization_id TEXT);
      CREATE TABLE sys_migration_journal (id TEXT PRIMARY KEY, organization_id TEXT);
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT);
    `);
    seed.close();
    expect(columnsOf(file, 'sys_user_permission_set')).not.toContain('permission_set');

    refusal = await boot(file);
    expect(isOrganizationOwnershipBootRefusal(refusal), String(refusal)).toBe(true);
    expect(String((refusal as Error).message)).toContain('os migrate organization-ownership');
    expect((refusal as { tables?: string[] }).tables).toEqual(expect.arrayContaining(['sys_metadata', 'sys_migration_journal']));
  }, 240_000);

  it('⭐ 1b. the refused boot has already run the additive schema sync: the column the ceremony waits for exists', () => {
    expect(isOrganizationOwnershipBootRefusal(refusal)).toBe(true);
    expect(columnsOf(file, 'sys_user_permission_set')).toContain('permission_set');
  });

  it('⭐ 2. the ceremony completes with no boot in between, and verifies its marker', () => {
    const run = spawnSync(process.execPath, [
      CLI_BIN, 'migrate', 'organization-ownership',
      '--apply', '--backup-taken', '--database-url', `file:${file}`, '--out', join(dir, 'apply.json'),
    ], { cwd: SHOWCASE_DIR, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1' } });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const db = new DatabaseSync(file);
    try {
      const marker = db.prepare('SELECT verified_at, blocking FROM sys_migration WHERE id = ?')
        .get('adr-0131-organization-ownership') as { verified_at: unknown; blocking: unknown } | undefined;
      expect(marker?.verified_at, 'the ceremony verified its marker').toBeTruthy();
      expect(Number(marker?.blocking)).toBe(0);
    } finally {
      db.close();
    }
    expect(columnsOf(file, 'sys_migration_journal')).not.toContain('organization_id');
    expect(columnsOf(file, 'sys_metadata')).not.toContain('organization_id');
    copyFileSync(file, migrated);
  }, 320_000);

  it('⭐ 3. the next boot succeeds', async () => {
    expect(await boot(migrated)).toBeNull();
  }, 240_000);
});
