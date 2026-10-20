// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D10 item 5] The v18 boot refusal must not deadlock the upgrade.
//
// The ceremony (`os migrate organization-ownership --apply --plan-file FILE`) refuses to name a
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
//  1. the v18 boot is refused, saying what 18.0 supports for a v17 database and
//     naming no step of the command 18.0 refuses — and the refused boot has
//     ALREADY added the column the ceremony waits for: the guard judges in its
//     own `start()`, after the engine's `start()`, which is where the schema
//     sync runs (and before every plugin that writes rows at start, so the
//     refusal arrives as the `cause` of the kernel's start-failure error);
//  2. `os migrate organization-ownership` writes its plan, and
//     `--apply --plan-file PLAN` completes with no boot in between, and
//     verifies its marker;
//  3. the next v18 boot succeeds.
//
// 18.0 ships for fresh installs only (ruling record 6259608309 on the v18
// epic): the registered `os migrate organization-ownership` refuses, and
// step 2a pins that through the real CLI binary, reading and writing nothing.
// Step 2 runs the ceremony class the command keeps for 18.x
// (`OrganizationOwnershipCeremony`), from the CLI's built module in its own
// process, with the same arguments, working directory and environment an
// operator's run has. The 18.x release that re-registers the ceremony puts
// step 2 back on the binary and drops 2a.
//
// ⚠ Needs the `sys_metadata` family's no-column schema beside the refusal:
// against a release whose family still declares the column, step 2 stops at
// `column-drops` (the declaration keeps it). The two land together.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import {
  OrganizationOwnershipBootGuardPlugin,
  isOrganizationOwnershipBootRefusal,
} from '@objectstack/runtime';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');
const CEREMONY_MODULE = pathToFileURL(join(CLI_ROOT, 'dist', 'commands', 'migrate', 'organization-ownership.js')).href;

const columnsOf = (file: string, table: string): string[] => {
  const db = new DatabaseSync(file);
  try {
    return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
};

/** The guard's refusal down a failed boot's `cause` chain (the kernel reports a failed `start()` as its own error). */
function refusalIn(error: unknown): unknown {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e;
  }
  return undefined;
}

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

  it('1. a v17-shape database is refused, saying what 18.0 supports and naming no step of the refused command', async () => {
    const seed = new DatabaseSync(file);
    seed.exec(`
      CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, user_id TEXT, permission_set_id TEXT, organization_id TEXT);
      CREATE TABLE sys_migration_journal (id TEXT PRIMARY KEY, organization_id TEXT);
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT);
    `);
    seed.close();
    expect(columnsOf(file, 'sys_user_permission_set')).not.toContain('permission_set');

    refusal = refusalIn(await boot(file));
    expect(refusal, 'the boot was refused for the v17 shape').toBeDefined();
    expect(String((refusal as Error).message)).toContain('18.0 supports fresh installs only and does not upgrade a v17 database');
    expect(String((refusal as Error).message)).not.toMatch(/os migrate organization-ownership|--plan-file|--out PLAN|--backup-taken/);
    expect((refusal as { tables?: string[] }).tables).toEqual(expect.arrayContaining(['sys_metadata', 'sys_migration_journal']));
  }, 240_000);

  it('⭐ 1b. the refused boot has already run the additive schema sync: the column the ceremony waits for exists', () => {
    expect(refusal).toBeDefined();
    expect(columnsOf(file, 'sys_user_permission_set')).toContain('permission_set');
  });

  it('⭐ 2a. in 18.0 the real command refuses with NOT_IMPLEMENTED, and the database is untouched', () => {
    const before = columnsOf(file, 'sys_metadata');
    const refused = spawnSync(process.execPath, [
      CLI_BIN, 'migrate', 'organization-ownership', '--database-url', `file:${file}`, '--out', join(dir, 'refused-plan.json'), '--json',
    ], { cwd: SHOWCASE_DIR, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1' } });
    expect(refused.status, `${refused.stdout}\n${refused.stderr}`).toBe(1);
    expect(JSON.parse(refused.stdout.trim())).toMatchObject({ error: 'plan_refused', code: 'NOT_IMPLEMENTED' });
    expect(existsSync(join(dir, 'refused-plan.json'))).toBe(false);
    expect(columnsOf(file, 'sys_metadata')).toEqual(before);
  }, 320_000);

  it('⭐ 2. the ceremony completes with no boot in between, and verifies its marker', () => {
    // As an operator's run has it (S4, #23437): the plan first, then the apply
    // of that reviewed plan file — through the ceremony class (see the header).
    const ceremony = (args: string[]) => spawnSync(process.execPath, [
      '--input-type=module', '-e',
      // The built module, as `bin/run.js` runs it: oclif's auto-transpile off,
      // so an inherited NODE_ENV=test cannot send it to `src/` under tsx.
      'const [root, url, ...argv] = process.argv.slice(1);' +
        " const { createRequire } = await import('node:module');" +
        " const { pathToFileURL } = await import('node:url');" +
        " const oclif = await import(pathToFileURL(createRequire(root + '/package.json').resolve('@oclif/core')).href);" +
        ' (oclif.settings ?? oclif.default.settings).enableAutoTranspile = false;' +
        ' const { OrganizationOwnershipCeremony } = await import(url);' +
        ' await OrganizationOwnershipCeremony.run(argv, { root });',
      CLI_ROOT, CEREMONY_MODULE, '--database-url', `file:${file}`, ...args,
    ], { cwd: SHOWCASE_DIR, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1' } });
    const planFile = join(dir, 'plan.json');
    const plan = ceremony(['--out', planFile]);
    expect(plan.status, `${plan.stdout}\n${plan.stderr}`).toBe(0);
    const run = ceremony(['--apply', '--plan-file', planFile, '--backup-taken', '--out', join(dir, 'apply.json')]);
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
