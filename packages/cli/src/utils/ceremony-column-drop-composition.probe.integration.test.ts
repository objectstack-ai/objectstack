// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PROBE (measurement, not a pin): does `os migrate organization-ownership
 * --apply` propose the drop of a v17 `sys_flow_dispatch.organization_id`, per
 * composition?
 *
 * The fixture is a database a served boot of THIS tree left behind (the
 * standalone stack, `PlatformObjectsPlugin`, `AutomationServicePlugin` in its
 * default store, so `sys_flow_dispatch` exists), then shaped like v17: an
 * `organization_id` column added to `sys_flow_dispatch`, and to `sys_job` as
 * the control (both lost the injected column in the same commit, and
 * `sys_job`'s provider is composed on every boot).
 *
 * Each composition is read twice: the ceremony's own boot (the flags the
 * command passes) with its declared set and its managed drift, and the real
 * command end to end on a fresh copy of the fixture.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExitSignal } from './format.js';
import { bootSchemaStack } from './schema-migrate.js';
import MigrateOrganizationOwnership from '../commands/migrate/organization-ownership.js';

import '@objectstack/runtime';
import '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AutomationServicePlugin } from '@objectstack/service-automation';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..');
const CASE_TIMEOUT_MS = 180_000;
const OUT = process.env.OS_PROBE_OUT ?? '';

const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET',
] as const;

const PROBE_OBJECT = { name: 'probe_note', label: 'Probe Note', fields: { body: { type: 'text', label: 'Body' } } };
const MANIFEST = { id: 'com.example.probe', name: 'Probe', version: '0.0.0', type: 'app' };

/** The compositions measured. `null` config = a bare directory (no config, no artifact). */
const COMPOSITIONS: Array<{ id: string; config: Record<string, unknown> | null }> = [
  { id: 'bare (no config, no artifact)', config: null },
  { id: '(i) config, no connector, no requires', config: { manifest: MANIFEST, objects: [PROBE_OBJECT] } },
  { id: '(ii) config, requires: [automation]', config: { manifest: MANIFEST, objects: [PROBE_OBJECT], requires: ['automation'] } },
];

const TABLES = ['sys_flow_dispatch', 'sys_job'] as const;

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();
const readings: Record<string, unknown> = {};

function columns(dbFile: string, table: string): string[] {
  const db = new Database(dbFile, { readonly: true });
  try {
    return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name);
  } finally {
    db.close();
  }
}

function schemaOf(dbFile: string, table: string): unknown {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare('SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? ORDER BY type, name').all(table);
  } finally {
    db.close();
  }
}

/** A served boot of this tree over `dbFile`: creates every table these plugins declare. */
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
  await kernel.use(new AutomationServicePlugin({ armRuntime: false }) as any);
  await runtime.start();
  await kernel.shutdown();
}

function projectFor(id: string, config: Record<string, unknown> | null): string {
  const projectDir = join(dir, 'projects', id.replace(/[^a-z0-9]+/gi, '-'));
  mkdirSync(projectDir, { recursive: true });
  if (config) writeFileSync(join(projectDir, 'objectstack.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);
  return projectDir;
}

let caseSeq = 0;
function freshCopy(): string {
  caseSeq += 1;
  const caseDir = join(dir, 'cases', String(caseSeq));
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'v17.db');
  copyFileSync(templateDb, dbFile);
  return dbFile;
}

async function runCommand(argv: string[]): Promise<{ payload: any; exitCode: number }> {
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
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
    } catch (error) {
      const trapped = error instanceof Error && error.message.startsWith('__PROCESS_EXIT__');
      if (!trapped && !isExitSignal(error)) throw error;
      if (!trapped) thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const out = stdout.mock.calls.map((c) => String(c[0])).join('').trim();
    let payload: any;
    try {
      payload = JSON.parse(out);
    } catch {
      payload = { unparsed: out.slice(-2000) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-23399-probe-'));
  const servedProject = projectFor('served', null);
  templateDb = join(dir, 'template.db');
  await bootServed(servedProject, templateDb);

  readings.servedBoot = Object.fromEntries(TABLES.map((t) => [t, { columns: columns(templateDb, t), schema: schemaOf(templateDb, t) }]));
  // The v17 shape: the injected tenant column these two objects carried before
  // they declared `systemFields: { tenant: false }`.
  const db = new Database(templateDb);
  try {
    for (const t of TABLES) db.exec(`ALTER TABLE "${t}" ADD COLUMN "organization_id" varchar(255)`);
  } finally {
    db.close();
  }
  readings.v17Shape = Object.fromEntries(TABLES.map((t) => [t, columns(templateDb, t)]));
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (OUT) writeFileSync(OUT, `${JSON.stringify(readings, null, 2)}\n`);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#23399 probe: the ceremony boot per composition, against a v17-shaped database', () => {
  for (const composition of COMPOSITIONS) {
    it(`${composition.id}: the ceremony boot's declared set and managed drift`, async () => {
      const projectDir = projectFor(composition.id, composition.config);
      const dbFile = freshCopy();
      const stack = await bootSchemaStack({
        jsonOutput: false,
        databaseUrl: `file:${dbFile}`,
        projectRoot: projectDir,
        // The flags `organization-ownership --apply` passes (its runApply boot).
        deferSchemaDdl: true,
        composeHostStack: true,
        composeServedPlatform: true,
        composeAuthGatedSecurity: true,
      });
      try {
        const names = new Set((stack.allObjects() as Array<{ name?: string }>).map((o) => o?.name));
        const managed = (t: string) => stack.drivers.some((d) => (d as any).managedObjectFields?.has(t) === true);
        const drift = await stack.detectManagedDrift();
        const dropFor = (t: string) => drift
          .filter((d) => d.table === t && (d.op as { type?: string }).type === 'drop_column')
          .map((d) => (d.op as { column?: string }).column);
        readings[`boot: ${composition.id}`] = {
          composition: { notes: (stack as any).composition?.notes ?? null },
          perTable: Object.fromEntries(TABLES.map((t) => [t, {
            declared: names.has(t),
            managed: managed(t),
            dropColumnProposed: dropFor(t),
          }])),
          declaredCount: names.size,
          driftEntries: drift.length,
        };
      } finally {
        await stack.shutdown();
      }
      expect(true).toBe(true);
    }, CASE_TIMEOUT_MS);

    it(`${composition.id}: the real command, --apply, end to end`, async () => {
      const projectDir = projectFor(composition.id, composition.config);
      const dbFile = freshCopy();
      process.chdir(projectDir);
      let result: { payload: any; exitCode: number };
      try {
        result = await runCommand([
          '--apply', '--backup-taken', '--out', join(dirname(dbFile), 'apply.json'),
          '--database-url', `file:${dbFile}`, '--json',
        ]);
      } finally {
        process.chdir(savedCwd);
      }
      const report = result.payload?.report;
      const step = (report?.steps ?? []).find((s: { step: string }) => s.step === 'column-drops');
      readings[`command: ${composition.id}`] = {
        exitCode: result.exitCode,
        error: result.payload?.error ?? null,
        errorDetail: result.payload?.detail ?? result.payload?.unparsed ?? null,
        posture: report?.posture ?? null,
        steps: (report?.steps ?? []).map((s: { step: string; status: string; summary: unknown }) => ({ step: s.step, status: s.status, summary: s.summary })),
        columnDrops: step ? { status: step.status, summary: step.summary, blockers: step.blockers } : null,
        tables: (report?.tables ?? [])
          .filter((t: { object: string }) => (TABLES as readonly string[]).includes(t.object))
          .map((t: { object: string; fate: string; columnDropped: boolean; remaining: number }) => ({
            object: t.object, fate: t.fate, columnDropped: t.columnDropped, remaining: t.remaining,
          })),
        physicalAfter: Object.fromEntries(TABLES.map((t) => [t, columns(dbFile, t).includes('organization_id')])),
      };
      expect(true).toBe(true);
    }, CASE_TIMEOUT_MS);
  }
});
