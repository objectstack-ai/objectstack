// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 17 → 18 upgrade of a single-posture database whose seed ran before any
 * organization existed — through `os migrate organization-ownership`, over a
 * SQLite file, with the boot the ceremony prescribes in between (ADR-0131 D3,
 * D10 items 3 to 5).
 *
 * ## The database
 *
 * A served boot of THIS release (`@objectstack/verify`'s `bootStack`, plugin
 * starts included) of a package whose seed writes three rows of an
 * organization-owned object; then what a 17.x install left instead: no
 * organization, every row's `organization_id` NULL, no grant, `sys_job` still
 * carrying its retired organization column (the v17 shape the boot guard
 * reads), and `sys_user_permission_set` without its `permission_set` column —
 * so the ceremony's rewrite step asks for one boot of this release.
 *
 * ## The path, measured end to end on the release before this pin
 *
 *  1. the plan counted every seeded row unattributable ("no Default
 *     Organization exists to fall back to");
 *  2. `--apply` checkpointed attribution done at zero rows and stopped at the
 *     rewrite, asking for a boot;
 *  3. that boot created the Default Organization and let the inline seed stamp
 *     the rows with it, and only then refused;
 *  4. the second `--apply` did not run attribution again, dropped the columns
 *     and found discrepancies — marker applied, never verified;
 *  5. and the next boot served that database.
 *
 * ## What this pins instead
 *
 *  1. the plan says `--apply` creates the Default Organization and counts no
 *     row unattributable;
 *  2. `--apply` creates it (plugin-auth's boot invariant, through the apply's
 *     own boot) and gives it every seeded row, then stops at the rewrite;
 *  3. ⭐ the prescribed boot is refused, and wrote no row: every table's row
 *     count is what the apply left;
 *  4. the second `--apply` completes with zero discrepancies and verifies;
 *  5. the guarded boot starts.
 *
 * The guard's own ordering, on a bare kernel, is
 * `runtime/src/organization-ownership-boot-guard.kernel.test.ts`; the apply's
 * steps without a boot are `utils/organization-ownership-apply.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { bootStack } from '@objectstack/verify';
import { isOrganizationOwnershipBootRefusal, OrganizationOwnershipBootGuardPlugin } from '@objectstack/runtime';
import { isExitSignal } from '../../utils/format.js';

// Pay the first transform of the dist-resolved workspace deps the boots reach
// through dynamic `import()`s at MODULE LOAD, not inside a clocked case.
import '@objectstack/objectql';
import '@objectstack/metadata-protocol';
import '@objectstack/plugin-auth';

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CASE_TIMEOUT_MS = 180_000;

/** Env that would point a boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OS_DATABASE_AUTH_TOKEN',
  'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH', 'OS_TELEMETRY_DB', 'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED', 'OS_SKIP_SCHEMA_SYNC', 'NODE_ENV',
] as const;

const SUBJECTS = ['kick-off', 'review', 'sign-off'];

/** A package whose seed writes three rows of an organization-owned object; built anew per boot, as `bootStack` asks. */
const stackConfig = () => ({
  manifest: { id: 'com.test.ceremony_no_organization', name: 'Ceremony with no organization', type: 'app', version: '1.0.0' },
  objects: [{ name: 'crm_event', label: 'Event', fields: { subject: { type: 'text', label: 'Subject' } } }],
  data: [{ object: 'crm_event', mode: 'upsert', externalId: 'subject', records: SUBJECTS.map((subject) => ({ subject })) }],
});

let dir: string;
/** The file the ceremony runs over. */
let file: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** One statement against the file, through a connection of its own. */
function sql(statement: string, ...params: unknown[]): Record<string, unknown>[] {
  const db = new Database(file);
  try {
    const prepared = db.prepare(statement);
    return prepared.reader ? (prepared.all(...params) as Record<string, unknown>[]) : (prepared.run(...params), []);
  } finally {
    db.close();
  }
}

/** Every table's row count: what a refused boot must leave as it found it. */
function rowCounts(): Record<string, number> {
  const tables = sql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  return Object.fromEntries(tables.map(({ name }) => [String(name), Number(sql(`SELECT COUNT(*) AS n FROM "${String(name)}"`)[0]!.n)]));
}

/** The real command, its stdout parsed, and the exit it asked for. */
async function run(args: string[]): Promise<{ payload: any; exitCode: number }> {
  const savedExit = process.exitCode;
  const swallow = ((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(swallow);
  vi.spyOn(process.stderr, 'write').mockImplementation(swallow);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.chdir(dir);
  let exitCode: number | undefined;
  try {
    try {
      await MigrateOrganizationOwnership.run(args, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    return { payload, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** A served boot over the file with the v18 guard composed (`os serve`'s refusal); the error it failed with, or null once it started and stopped. */
async function guardedBoot(): Promise<unknown> {
  try {
    const stack = await bootStack(stackConfig(), { databaseFile: file, extraPlugins: [new OrganizationOwnershipBootGuardPlugin({ dev: true })] });
    await stack.stop();
    return null;
  } catch (error) {
    return error;
  }
}

/** The guard's refusal down a failed boot's `cause` chain (the kernel reports a failed `start()` as its own error). */
function refusalIn(error: unknown): { code: string; tables: readonly string[] } | undefined {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e;
  }
  return undefined;
}

describe('os migrate organization-ownership on a single-posture database that holds no organization', () => {
  beforeAll(async () => {
    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
    dir = mkdtempSync(join(tmpdir(), 'os-ceremony-no-organization-'));
    file = join(dir, 'fixture.db');

    const stack = await bootStack(stackConfig(), { databaseFile: file });
    await stack.stop();
    expect(sql('SELECT COUNT(*) AS n FROM crm_event')).toEqual([{ n: SUBJECTS.length }]);

    // What a 17.x install whose seed ran before any organization existed left.
    for (const { name } of sql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)) {
      const columns = sql(`SELECT name FROM pragma_table_info(?)`, name).map((c) => c.name);
      if (columns.includes('organization_id')) sql(`UPDATE "${String(name)}" SET organization_id = NULL`);
    }
    sql('DELETE FROM sys_organization');
    sql('DELETE FROM sys_member');
    sql('DELETE FROM sys_user_permission_set');
    sql(`DELETE FROM sys_migration WHERE id IN ('seed-tenancy-backfill', ?)`, ORGANIZATION_OWNERSHIP_MIGRATION_ID);
    sql('ALTER TABLE sys_job ADD COLUMN organization_id varchar(255)');
    for (const { name } of sql(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sys_user_permission_set' AND sql IS NOT NULL`)) {
      sql(`DROP INDEX "${String(name)}"`);
    }
    sql('ALTER TABLE sys_user_permission_set DROP COLUMN permission_set');
  }, CASE_TIMEOUT_MS);

  afterAll(() => {
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('⭐ the Default Organization the ceremony creates owns every seeded row, the boot it prescribes writes nothing before its refusal, and the marker verifies', async () => {
    const planFile = join(dir, 'plan.json');
    const plan = await run(['--dev', '--database-url', `file:${file}`, '--json', '--out', planFile]);
    expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 800)).toBeUndefined();
    expect(plan.payload.plan).toMatchObject({ posture: 'single', organizations: 0, defaultOrganization: null, defaultOrganizationCreatedByApply: true });
    expect(plan.payload.plan.warnings).toContainEqual(expect.stringMatching(/^This database holds no organization, and the tenancy posture is single: --apply creates the Default Organization/));
    expect(plan.payload.plan.tables.find((t: { object: string }) => t.object === 'crm_event')).toMatchObject({
      attribution: { 'default-organization': SUBJECTS.length },
      unattributable: [],
    });

    // The first apply: the Default Organization first, then every seeded row to it; the rewrite asks for a boot.
    const applyArgs = (out: string) => ['--dev', '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', `file:${file}`, '--json', '--out', join(dir, out)];
    const first = await run(applyArgs('apply-1.json'));
    expect(first.payload.error, JSON.stringify(first.payload).slice(0, 800)).toBeUndefined();
    const firstSteps = first.payload.report.steps as Array<{ step: string; status: string; summary: Record<string, number>; blockers: string[] }>;
    expect(firstSteps[0]).toMatchObject({ step: 'attribution', status: 'done' });
    expect(firstSteps.find((s) => s.step === 'rewrite')).toMatchObject({
      status: 'blocked',
      blockers: [expect.stringMatching(/Boot this release once against the database \(its schema sync adds the column\), then re-run/)],
    });
    expect(first.exitCode).toBe(1);
    const organizations = sql('SELECT id, slug FROM sys_organization');
    expect(organizations).toEqual([{ id: expect.any(String), slug: 'default' }]);
    expect(sql('SELECT DISTINCT organization_id FROM crm_event')).toEqual([{ organization_id: organizations[0]!.id }]);

    // ⭐ The boot it prescribes: refused, having written no row.
    const before = rowCounts();
    const refusal = refusalIn(await guardedBoot());
    expect(refusal?.code).toBe('ORGANIZATION_OWNERSHIP_MIGRATION_REQUIRED');
    expect(refusal?.tables).toContain('sys_job');
    expect(sql('SELECT name FROM pragma_table_info(?)', 'sys_user_permission_set').map((c) => c.name)).toContain('permission_set');
    const after = rowCounts();
    expect(Object.fromEntries(Object.keys(before).map((t) => [t, after[t]]))).toEqual(before);
    for (const table of Object.keys(after).filter((t) => !(t in before))) expect(after[table], table).toBe(0);

    const second = await run(['--dev', '--apply', '--backup-taken', '--plan-file', planFile, '--database-url', `file:${file}`, '--json', '--out', join(dir, 'apply-2.json')]);
    expect(second.payload.error, JSON.stringify(second.payload).slice(0, 800)).toBeUndefined();
    expect([second.exitCode, second.payload.report.complete, second.payload.report.blocking]).toEqual([0, true, 0]);
    expect(sql('SELECT verified_at IS NOT NULL AS verified, blocking FROM sys_migration WHERE id = ?', ORGANIZATION_OWNERSHIP_MIGRATION_ID))
      .toEqual([{ verified: 1, blocking: 0 }]);
    expect(sql('SELECT COUNT(*) AS n FROM crm_event WHERE organization_id IS NULL')).toEqual([{ n: 0 }]);

    // The verified database starts; its inline seed finds every row it owns, so it adds none.
    expect(await guardedBoot()).toBeNull();
    expect(sql('SELECT COUNT(*) AS n, COUNT(DISTINCT organization_id) AS owners FROM crm_event')).toEqual([{ n: SUBJECTS.length, owners: 1 }]);
  }, CASE_TIMEOUT_MS);
});
