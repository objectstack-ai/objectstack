// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` never executes a ceremony whose
 * report it cannot keep, and never reports a report it lost after executing
 * with the refusal's code (#23826).
 *
 * The apply reserves its report file (an exclusive create, never an overwrite)
 * before it boots, so an `--out` that names an existing file is refused before
 * anything runs: `apply_refused`, `report-file-unwritable`, the OS code named,
 * the database untouched and the existing file byte-identical. The control is
 * the same run with a new `--out`: the ceremony executes and its report is
 * written there. A report that cannot be kept AFTER the ceremony executed — here
 * the reserved file removed while the run went on — carries its own code,
 * `apply_report_unwritable`, with `executed: true` and the report itself.
 *
 * The fixture is a database a served boot of this tree left behind, shaped like
 * v17 in one place: `organization_id` added to `sys_migration_journal`, whose
 * provider every boot composes. An executed ceremony drops that column and
 * records its marker row in `sys_migration`; a refused one does neither.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { isExitSignal } from '../../utils/format.js';

import '@objectstack/runtime';
import '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';

// The real boot, with one seam: a hook a case arms to run once the apply's boot
// has returned — after the report file was reserved and before the ceremony.
const bootHook = vi.hoisted(() => ({ once: undefined as undefined | (() => void) }));
vi.mock('../../utils/schema-migrate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/schema-migrate.js')>();
  return {
    ...actual,
    bootSchemaStack: async (...args: Parameters<typeof actual.bootSchemaStack>) => {
      const stack = await actual.bootSchemaStack(...args);
      const hook = bootHook.once;
      bootHook.once = undefined;
      hook?.();
      return stack;
    },
  };
});

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;

/** Env that would point the boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET',
] as const;

const OBJECT = { name: 'osrf_note', label: 'Note', fields: { body: { type: 'text', label: 'Body' } } };
const MANIFEST = { id: 'com.example.report-file', name: 'Report File', version: '0.0.0', type: 'app' };

/** The v17 column the ceremony drops: its provider is composed on every boot. */
const DROPPED = 'sys_migration_journal';

/** What an earlier run left at the path the operator hands in again. */
const KEPT_REPORT = `${JSON.stringify({ kind: 'organization-ownership-apply', kept: 'an earlier run' })}\n`;

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

/** Whether the ceremony's marker row exists in the deployment ledger. */
const hasCeremonyMarker = (dbFile: string): boolean => {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare('SELECT id FROM sys_migration WHERE id = ?').all(ORGANIZATION_OWNERSHIP_MIGRATION_ID).length > 0;
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
  await runtime.start();
  await kernel.shutdown();
}

interface Prepared {
  projectDir: string;
  dbFile: string;
  planFile: string;
}

interface Outcome {
  payload: Record<string, any>;
  exitCode: number;
}

/** Run the real command from `projectDir`, returning its `--json` payload and exit code. */
async function runCommand(projectDir: string, argv: string[]): Promise<Outcome> {
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
    try {
      await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim()) as Record<string, any>;
    return { payload, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** A project over a fresh copy of the fixture, and the plan file its plan run wrote (the reviewed plan). */
async function prepare(name: string): Promise<Prepared> {
  const projectDir = join(dir, 'projects', name);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, 'objectstack.config.mjs'),
    `export default ${JSON.stringify({ manifest: MANIFEST, objects: [OBJECT] }, null, 2)};\n`,
  );
  const dbFile = join(projectDir, 'v17.db');
  copyFileSync(templateDb, dbFile);
  const planFile = join(projectDir, 'plan.json');
  const plan = await runCommand(projectDir, ['--out', planFile, '--database-url', `file:${dbFile}`, '--json']);
  expect(plan.payload.error, JSON.stringify(plan.payload).slice(0, 600)).toBeUndefined();
  return { projectDir, dbFile, planFile };
}

/** `--apply` of the prepared plan, its report to `out`. */
const apply = (prepared: Prepared, out: string): Promise<Outcome> =>
  runCommand(prepared.projectDir, [
    '--apply', '--backup-taken', '--plan-file', prepared.planFile,
    '--out', out, '--database-url', `file:${prepared.dbFile}`, '--json',
  ]);

beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  // The deployed posture: no telemetry sibling, and the crypto provider's key.
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-ceremony-report-file-'));
  const served = join(dir, 'served');
  mkdirSync(served, { recursive: true });
  templateDb = join(dir, 'template.db');
  await bootServed(served, templateDb);
  const db = new Database(templateDb);
  try {
    db.exec(`ALTER TABLE "${DROPPED}" ADD COLUMN "organization_id" varchar(255)`);
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

describe('organization-ownership --apply: the report file', () => {
  it('(i) an --out that already exists is refused before the ceremony runs: nothing executed, the file untouched', async () => {
    const prepared = await prepare('existing-out');
    const out = join(prepared.projectDir, 'apply.json');
    writeFileSync(out, KEPT_REPORT);

    const { payload, exitCode } = await apply(prepared, out);

    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'report-file-unwritable', file: out, code: 'EEXIST' });
    expect(payload.executed).toBeUndefined();
    expect(exitCode).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe(KEPT_REPORT);
    expect(hasCeremonyMarker(prepared.dbFile)).toBe(false);
    expect(hasOrganizationColumn(prepared.dbFile, DROPPED)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('(ii) the control — a new --out: the ceremony executes and its report is written there', async () => {
    const prepared = await prepare('new-out');
    const out = join(prepared.projectDir, 'apply.json');

    const { payload } = await apply(prepared, out);

    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    expect(payload.file).toBe(out);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({
      kind: 'organization-ownership-apply',
      migrationId: ORGANIZATION_OWNERSHIP_MIGRATION_ID,
    });
    expect(hasCeremonyMarker(prepared.dbFile)).toBe(true);
    expect(hasOrganizationColumn(prepared.dbFile, DROPPED)).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('(iii) a report lost after the ceremony executed carries its own code, executed: true and the report', async () => {
    const prepared = await prepare('lost-report');
    const out = join(prepared.projectDir, 'apply.json');
    // The reserved file is removed while the run goes on (after the boot,
    // before the ceremony): the report has nowhere left to be kept.
    bootHook.once = () => rmSync(out, { force: true });

    const { payload, exitCode } = await apply(prepared, out);

    expect(payload).toMatchObject({
      error: 'apply_report_unwritable',
      reason: 'report-write-failed',
      file: out,
      executed: true,
    });
    expect(payload.report).toMatchObject({ kind: 'organization-ownership-apply', migrationId: ORGANIZATION_OWNERSHIP_MIGRATION_ID });
    expect(payload.report.steps.length).toBeGreaterThan(0);
    expect(exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
    // It did execute: the marker is recorded and the column is gone.
    expect(hasCeremonyMarker(prepared.dbFile)).toBe(true);
    expect(hasOrganizationColumn(prepared.dbFile, DROPPED)).toBe(false);
  }, CASE_TIMEOUT_MS);
});
