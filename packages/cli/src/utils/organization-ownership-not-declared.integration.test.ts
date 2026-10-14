// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply`, column drops: a table the
 * booted composition declares no object for is answered `not-declared`, never
 * blamed on the release (ADR-0131 D10, fate 1).
 *
 * The ceremony drops a column only through the schema-drift ceremony, so only
 * for an object its boot declares, and its boot declares the composition it is
 * run in. `sys_flow_dispatch`'s provider (`service-automation`) is composed
 * only when that composition's `requires` names `automation`. So run in a
 * composition that does not, the v17 column is kept and the step says why
 * (`summary.notDeclared`, a blocker naming the table). The control is the same
 * database run in a composition that does: the column is dropped.
 *
 * The fixture is a database a served boot of this tree left behind, shaped
 * like v17: `organization_id` added to `sys_flow_dispatch`, and to
 * `sys_migration_journal`, whose provider is composed on every boot, as the
 * in-run control.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from './format.js';
import MigrateOrganizationOwnership from '../commands/migrate/organization-ownership.js';

import '@objectstack/runtime';
import '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AutomationServicePlugin } from '@objectstack/service-automation';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..');
const CASE_TIMEOUT_MS = 120_000;

/** Env that would point the boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET',
] as const;

const OBJECT = { name: 'osnd_note', label: 'Note', fields: { body: { type: 'text', label: 'Body' } } };
const MANIFEST = { id: 'com.example.not-declared', name: 'Not Declared', version: '0.0.0', type: 'app' };

const FLOW_DISPATCH = 'sys_flow_dispatch';
const CONTROL = 'sys_migration_journal';

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

const hasOrganizationColumn = (dbFile: string, table: string): boolean => {
  const db = new Database(dbFile, { readonly: true });
  try {
    return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some((c) => c.name === 'organization_id');
  } finally {
    db.close();
  }
};

/** A served boot of this tree over `dbFile`: every table these plugins declare. */
async function bootServed(projectDir: string, dbFile: string): Promise<void> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const stack = await createStandaloneStack({
    projectRoot: projectDir,
    databaseUrl: `file:${dbFile}`,
    skipSeedData: true,
    armLifecycleSweep: false,
  });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) await kernel.use(plugin as any);
  await kernel.use(new PlatformObjectsPlugin() as any);
  // The default store, so `sys_flow_dispatch` is declared and created.
  await kernel.use(new AutomationServicePlugin({ armRuntime: false }) as any);
  await runtime.start();
  await kernel.shutdown();
}

/** A project directory whose config is `config` (no artifact). */
function projectFor(name: string, config: Record<string, unknown>): string {
  const projectDir = join(dir, 'projects', name);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'objectstack.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);
  return projectDir;
}

/**
 * The real command from `projectDir`, over a fresh copy of the fixture: the plan
 * run first (its file is the reviewed plan `--apply` executes), then `--apply`.
 */
async function applyIn(projectDir: string): Promise<{ dbFile: string; report: any; exitCode: number }> {
  const dbFile = join(projectDir, 'v17.db');
  copyFileSync(templateDb, dbFile);
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
  process.chdir(projectDir);
  let exitCode: number | undefined;
  try {
    const planFile = join(projectDir, 'plan.json');
    await MigrateOrganizationOwnership.run(['--out', planFile, '--database-url', `file:${dbFile}`, '--json'], { root: CLI_ROOT });
    stdout.mockClear();
    try {
      await MigrateOrganizationOwnership.run(
        [
          '--apply', '--backup-taken', '--plan-file', planFile,
          '--out', join(projectDir, 'apply.json'), '--database-url', `file:${dbFile}`, '--json',
        ],
        { root: CLI_ROOT },
      );
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    return { dbFile, report: payload.report, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

const columnDrops = (report: any): { status: string; summary: Record<string, number>; blockers: string[] } =>
  report.steps.find((s: { step: string }) => s.step === 'column-drops');
const blockersFor = (report: any, table: string): string[] =>
  columnDrops(report).blockers.filter((b) => b.includes(`${table}.organization_id`));

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  // The deployed posture: no telemetry sibling, and the crypto provider's key.
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-ceremony-not-declared-'));
  const served = join(dir, 'served');
  mkdirSync(served, { recursive: true });
  templateDb = join(dir, 'template.db');
  await bootServed(served, templateDb);
  // The v17 shape: the injected tenant column both objects carried before
  // they declared `systemFields: { tenant: false }`.
  const db = new Database(templateDb);
  try {
    for (const table of [FLOW_DISPATCH, CONTROL]) db.exec(`ALTER TABLE "${table}" ADD COLUMN "organization_id" varchar(255)`);
  } finally {
    db.close();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('organization-ownership --apply: a column-drop table the booted composition does not declare', () => {
  it('(i) a config that requests no automation: sys_flow_dispatch is not-declared, kept, and named', async () => {
    const { dbFile, report, exitCode } = await applyIn(projectFor('no-automation', { manifest: MANIFEST, objects: [OBJECT] }));

    const step = columnDrops(report);
    expect(step.status).toBe('blocked');
    expect(step.summary.notDeclared).toBe(1);
    expect(blockersFor(report, FLOW_DISPATCH)).toHaveLength(1);
    expect(hasOrganizationColumn(dbFile, FLOW_DISPATCH)).toBe(true);
    // The in-run control: a declared column-drop table is dropped by the same run.
    expect(blockersFor(report, CONTROL)).toEqual([]);
    expect(hasOrganizationColumn(dbFile, CONTROL)).toBe(false);
    expect(exitCode).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('(ii) the control — a config with requires: [automation]: the same column is proposed and dropped', async () => {
    const { dbFile, report } = await applyIn(
      projectFor('automation', { manifest: MANIFEST, objects: [OBJECT], requires: ['automation'] }),
    );

    expect(columnDrops(report).summary.notDeclared).toBe(0);
    expect(blockersFor(report, FLOW_DISPATCH)).toEqual([]);
    expect(report.tables.find((t: { object: string }) => t.object === FLOW_DISPATCH)).toMatchObject({ columnDropped: true });
    expect(hasOrganizationColumn(dbFile, FLOW_DISPATCH)).toBe(false);
  }, CASE_TIMEOUT_MS);
});
