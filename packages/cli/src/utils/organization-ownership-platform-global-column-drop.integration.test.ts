// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply`, column drops: a `column-drop`
 * fate on an object the HOST declares platform-global is honoured (ADR-0131
 * D7, D10 fate 1).
 *
 * ## The shape
 *
 * ADR-0131 D7: "an object a deployment declares platform-global gets no
 * organization column on that deployment (the injected-columns plan reads the
 * declaration)". The declaration is the `org-scoping` service's
 * `platformGlobalObjects` (`OrgScopingEntitlement`), which a host supplies by
 * composing its own organizations runtime — the way a commercial host
 * subclasses `OrganizationsPlugin`. The engine installs it at the top of
 * `ObjectQLPlugin.start()`.
 *
 * The ceremony drops a column only through the schema-drift ceremony, so only
 * when its boot plans the object without the column. A host that brings its
 * OWN `ObjectQLPlugin`, behind a lazy wrapper under the framework's plugin name
 * (the shape `schema-migrate.host-composition.integration.test.ts` reproduces
 * for #13028), displaces the standalone engine, and the declaration boot
 * suppresses that wrapper's `start()` — so nothing installed the declaration,
 * the boot planned `organization_id` on the declared object, the differ
 * proposed no drop, and the step blocked with `not-proposed`.
 *
 * ## The fixture
 *
 * A host config (no artifact) composing that lazy engine, an `org-scoping`
 * provider declaring two objects platform-global, and a plugin declaring three
 * host objects. ⛔ The objects, the provider and the supplement are test data,
 * not any host's declaration. The database is the v17 shape: a served boot of
 * the same objects with no declaration, so all three carry `organization_id`.
 *
 *  - `sys_osgc_ledger` — declared, fate `column-drop`: the column is dropped.
 *  - `sys_osgc_audit` — NOT declared, fate `column-drop`: the release still
 *    declares the column, so the drop is not proposed (the control: unchanged).
 *  - `sys_osgc_held` — declared, fate `column-drop` with a category that still
 *    holds a row: blocked before any drop (the control: unchanged).
 *
 * Every case runs the real command, plan then apply, over a fresh copy of the
 * database; each fate the case does not exercise is `report`. SQLite only.
 *
 * ## `os migrate apply --allow-destructive` on the same composition
 *
 * The schema-drift report of this composition offers the two declared
 * objects' `organization_id` for the destructive apply. Its drop gate
 * (`organization-ownership-drop-gate.ts`, ADR-0131 D10 item 5) holds that drop
 * back until the ceremony's marker is verified — on these host-declared
 * objects as on the platform's inventory, since the ceremony plans every
 * table that carries the column. The real `os migrate apply` command, over a
 * fresh copy of the same v17 database:
 *
 *  - no marker: refused, naming the ceremony; nothing dropped;
 *  - CONTROL: a verified marker: the drop applies;
 *  - CONTROL: a destructive drop of another column is unchanged.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ORGANIZATION_OWNERSHIP_MIGRATION_ID } from '@objectstack/spec/system';
import { isExitSignal } from './format.js';
import MigrateApply from '../commands/migrate/apply.js';
import MigrateOrganizationOwnership from '../commands/migrate/organization-ownership.js';

// Paid at module load, not inside a clocked case (`check:test-source-alias`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..');
const CASE_TIMEOUT_MS = 180_000;
const require_ = createRequire(import.meta.url);

/** Env that would point the boot somewhere other than the fixture, or change what it composes. */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME', 'OS_ARTIFACT_PATH',
  'OS_TELEMETRY_DB', 'OS_AUTH_SECRET', 'OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED',
] as const;

const LEDGER = 'sys_osgc_ledger';
const AUDIT = 'sys_osgc_audit';
const HELD = 'sys_osgc_held';
const HOST_OBJECTS = [LEDGER, AUDIT, HELD] as const;
/** What the fixture's `org-scoping` provider declares platform-global. */
const DECLARED = [LEDGER, HELD] as const;
const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';

/**
 * The host plugin that declares the three objects, as a module the config and
 * the v17 boot both import, so the two cannot describe different objects.
 */
const OBJECTS_MODULE = `
const objects = ${JSON.stringify(HOST_OBJECTS)}.map((name) => ({
  name,
  label: name,
  fields: { note: { type: 'text', label: 'Note' } },
}));
export function osgcObjectsPlugin() {
  return {
    name: 'com.example.osgc',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx) {
      ctx.getService('manifest').register({
        id: 'com.example.osgc', namespace: 'sys', version: '1.0.0', type: 'plugin', scope: 'system',
        name: 'OSGC fixture', objects,
      });
    },
  };
}
`;

/**
 * The deployment's composition: the lazy engine (cloud's control-plane preset
 * in shape — construction deferred to init(), start() forwarded), an
 * `org-scoping` provider registering itself in init() as `OrganizationsPlugin`
 * does, with a declaration, and the objects plugin.
 */
const CONFIG_MODULE = `
import { ObjectQLPlugin } from '@objectstack/objectql';
import { osgcObjectsPlugin } from './osgc-objects.mjs';

function lazyPlugin(name, factory) {
  let impl = null;
  return {
    name,
    async init(ctx) { impl = await factory(); if (impl?.init) await impl.init(ctx); },
    async start(ctx) { if (impl?.start) await impl.start(ctx); },
    async stop(ctx) { if (impl?.stop) await impl.stop(ctx); },
  };
}

class HostOrganizations {
  name = 'com.objectstack.organizations';
  version = '1.0.0';
  dependencies = ['com.objectstack.engine.objectql'];
  providesServices = ['org-scoping'];
  supportedPostures = ['group', 'isolated'];
  platformGlobalObjects = ${JSON.stringify(DECLARED)};
  async init(ctx) { ctx.registerService('org-scoping', this); }
}

export default {
  plugins: [
    lazyPlugin('com.objectstack.engine.objectql', async () => new ObjectQLPlugin()),
    new HostOrganizations(),
    osgcObjectsPlugin(),
  ],
};
`;

let dir: string;
let projectDir: string;
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

/** The v17 database: a served boot of the same objects with NO declaration, so each carries the column. */
async function bootV17(dbFile: string): Promise<void> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const { osgcObjectsPlugin } = (await import(pathToFileURL(join(projectDir, 'osgc-objects.mjs')).href)) as {
    osgcObjectsPlugin: () => unknown;
  };
  const v17 = join(dir, 'v17');
  mkdirSync(v17, { recursive: true });
  const stack = await createStandaloneStack({
    projectRoot: v17,
    databaseUrl: `file:${dbFile}`,
    skipSeedData: true,
    armLifecycleSweep: false,
  });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) await kernel.use(plugin as any);
  await kernel.use(new PlatformObjectsPlugin() as any);
  await kernel.use(osgcObjectsPlugin() as any);
  await runtime.start();
  await kernel.shutdown();
}

/** A supplement row: `column-drop` for `drop`, `report` for every other host object. */
function supplement(drop: string): Array<Record<string, unknown>> {
  return HOST_OBJECTS.map((object) => {
    if (object !== drop) return { object, fate: 'report', citation: CITE };
    return object === HELD
      ? {
          object,
          fate: 'column-drop',
          citation: CITE,
          categories: [{ id: 'held-for-review', label: 'rows held for review', citation: CITE, where: [{ column: 'note', equals: 'held' }] }],
        }
      : { object, fate: 'column-drop', citation: CITE };
  });
}

interface Run {
  dbFile: string;
  plan: any;
  report: any;
  exitCode: number;
}

/** The real command over a fresh copy of the v17 database: plan, then `--apply` of that plan. */
async function ceremony(name: string, drop: string): Promise<Run> {
  const caseDir = join(dir, 'cases', name);
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'v17.db');
  copyFileSync(templateDb, dbFile);
  const fates = join(caseDir, 'host-fates.json');
  writeFileSync(fates, JSON.stringify(supplement(drop)));
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
    const planFile = join(caseDir, 'plan.json');
    const common = ['--database-url', `file:${dbFile}`, '--fate-supplement', fates, '--json'];
    await MigrateOrganizationOwnership.run(['--out', planFile, ...common], { root: CLI_ROOT });
    const planned = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    expect(planned.error, JSON.stringify(planned).slice(0, 600)).toBeUndefined();
    stdout.mockClear();
    try {
      await MigrateOrganizationOwnership.run(
        ['--apply', '--backup-taken', '--plan-file', planFile, '--out', join(caseDir, 'apply.json'), ...common],
        { root: CLI_ROOT },
      );
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const payload = JSON.parse(stdout.mock.calls.map((c) => String(c[0])).join('').trim());
    expect(payload.error, JSON.stringify(payload).slice(0, 600)).toBeUndefined();
    return { dbFile, plan: planned.plan, report: payload.report, exitCode: exitCode ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** A fresh copy of the v17 database for one `os migrate apply` case, with `prepare` run on it raw. */
function applyCase(name: string, prepare?: (db: Database.Database) => void): string {
  const caseDir = join(dir, 'apply-cases', name);
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'v17.db');
  copyFileSync(templateDb, dbFile);
  if (prepare) {
    const db = new Database(dbFile);
    try {
      prepare(db);
    } finally {
      db.close();
    }
  }
  return dbFile;
}

/** The real `os migrate apply --allow-destructive --yes --json` over `dbFile`, from the host's project. */
async function migrateApply(dbFile: string): Promise<{ payload: any; exitCode: number }> {
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
  // `run()` ends the one-shot process itself once the document is written.
  let processExit: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    processExit = code ?? 0;
    throw new Error(`__PROCESS_EXIT__:${processExit}`);
  }) as never);
  process.chdir(projectDir);
  let thrownExit: number | undefined;
  try {
    try {
      await MigrateApply.run(['--database-url', `file:${dbFile}`, '--allow-destructive', '--yes', '--json'], { root: CLI_ROOT });
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
      payload = { unparsed: out.slice(-600) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.chdir(savedCwd);
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

/** The `organization_id` drops among an apply payload's entries, by table, sorted. */
const organizationDropsIn = (entries: any[] | undefined): string[] =>
  (entries ?? [])
    .filter((d) => d?.op?.type === 'drop_column' && d.op.column === 'organization_id')
    .map((d) => String(d.table))
    .sort();

const columnDrops = (report: any): { status: string; summary: Record<string, number>; blockers: string[] } =>
  report.steps.find((s: { step: string }) => s.step === 'column-drops');
const blockersFor = (report: any, table: string): string[] =>
  columnDrops(report).blockers.filter((b) => b.includes(`${table}.organization_id`));
const tableOf = (doc: any, object: string): any => doc.tables.find((t: { object: string }) => t.object === object);

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
  for (const key of OVERRIDING_ENV) delete process.env[key];
  // The deployed posture: no telemetry sibling, and the crypto provider's key.
  process.env.NODE_ENV = 'production';
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-ceremony-platform-global-'));
  projectDir = join(dir, 'host');
  mkdirSync(join(projectDir, 'node_modules', '@objectstack'), { recursive: true });
  // The host's own engine import, resolved as a dependency is: a node_modules read.
  symlinkSync(
    resolve(dirname(require_.resolve('@objectstack/objectql')), '..'),
    join(projectDir, 'node_modules', '@objectstack', 'objectql'),
    'dir',
  );
  writeFileSync(join(projectDir, 'osgc-objects.mjs'), OBJECTS_MODULE);
  writeFileSync(join(projectDir, 'objectstack.config.ts'), CONFIG_MODULE);

  templateDb = join(dir, 'template.db');
  await bootV17(templateDb);
  const db = new Database(templateDb);
  try {
    for (const table of HOST_OBJECTS) {
      db.prepare(`INSERT INTO "${table}" (id, note, organization_id) VALUES (?, ?, NULL)`).run(`${table}_1`, 'held');
    }
  } finally {
    db.close();
  }
  for (const table of HOST_OBJECTS) expect(hasOrganizationColumn(templateDb, table), table).toBe(true);
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('organization-ownership --apply: column-drop on an object the host declares platform-global', () => {
  it('drops the declared object\'s organization_id through the schema-drift ceremony', async () => {
    const { dbFile, plan, report } = await ceremony('declared', LEDGER);

    // The plan's view: the fate, and a column it will drop.
    expect(tableOf(plan, LEDGER)).toMatchObject({ fate: 'column-drop', physical: 'present', organizationColumn: 'present' });

    const step = columnDrops(report);
    expect(step.status).toBe('done');
    expect(step.summary).toEqual({ dropped: 1, due: 1, notDeclared: 0 });
    expect(step.blockers).toEqual([]);
    expect(tableOf(report, LEDGER)).toMatchObject({ columnDropped: true });
    expect(hasOrganizationColumn(dbFile, LEDGER)).toBe(false);
    // Only the fated column: the other host objects keep theirs.
    expect(hasOrganizationColumn(dbFile, AUDIT)).toBe(true);
    expect(hasOrganizationColumn(dbFile, HELD)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: an object the host does NOT declare platform-global is not proposed, and keeps its column', async () => {
    const { dbFile, report, exitCode } = await ceremony('undeclared', AUDIT);

    const step = columnDrops(report);
    expect(step.status).toBe('blocked');
    expect(step.summary).toEqual({ dropped: 0, due: 1, notDeclared: 0 });
    expect(blockersFor(report, AUDIT)).toHaveLength(1);
    expect(tableOf(report, AUDIT)).toMatchObject({ columnDropped: false });
    expect(hasOrganizationColumn(dbFile, AUDIT)).toBe(true);
    expect(exitCode).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: a declared object whose column still holds a category\'s rows is blocked before any drop', async () => {
    const { dbFile, report, exitCode } = await ceremony('held', HELD);

    const step = columnDrops(report);
    expect(step.status).toBe('blocked');
    expect(step.summary).toEqual({ dropped: 0, due: 0, notDeclared: 0 });
    expect(blockersFor(report, HELD)).toHaveLength(1);
    expect(tableOf(report, HELD)).toMatchObject({ columnDropped: false });
    expect(hasOrganizationColumn(dbFile, HELD)).toBe(true);
    expect(exitCode).toBe(1);
  }, CASE_TIMEOUT_MS);
});

describe('os migrate apply --allow-destructive: the organization_id drop on a host-declared platform-global object waits for the ceremony', () => {
  it('holds the drop back until the marker is verified, naming the ceremony, and drops nothing', async () => {
    const dbFile = applyCase('no-marker');
    const { payload, exitCode } = await migrateApply(dbFile);

    expect(exitCode, JSON.stringify(payload).slice(0, 600)).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_organization_ownership_unmigrated',
      tables: [...DECLARED].sort(),
      applied: [],
      created: [],
      marker: null,
    });
    expect(payload.detail).toMatch(/os migrate organization-ownership --apply/);
    // The drops the refusal held back are the ones the drift offered.
    expect(organizationDropsIn(payload.skipped)).toEqual([...DECLARED].sort());
    for (const table of HOST_OBJECTS) expect(hasOrganizationColumn(dbFile, table), table).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: once the ceremony\'s marker is verified, the drop applies', async () => {
    const dbFile = applyCase('verified-marker', (db) => {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO sys_migration (id, last_run_at, verified_at, blocking) VALUES (?, ?, ?, 0)').run(
        ORGANIZATION_OWNERSHIP_MIGRATION_ID,
        now,
        now,
      );
    });
    const { payload, exitCode } = await migrateApply(dbFile);

    expect(exitCode, JSON.stringify(payload).slice(0, 600)).toBe(0);
    expect(payload.message).toBeUndefined();
    expect(organizationDropsIn(payload.applied)).toEqual([...DECLARED].sort());
    for (const table of DECLARED) expect(hasOrganizationColumn(dbFile, table), table).toBe(false);
    // The undeclared object's column is the release's, and stays.
    expect(hasOrganizationColumn(dbFile, AUDIT)).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('CONTROL: a destructive drop of another column is unchanged', async () => {
    // The declared objects' organization_id already gone, and a column no
    // object declares on one of them: the run's one destructive change.
    const dbFile = applyCase('other-column', (db) => {
      for (const table of DECLARED) db.exec(`ALTER TABLE "${table}" DROP COLUMN organization_id`);
      db.exec(`ALTER TABLE "${LEDGER}" ADD COLUMN legacy_23684_note TEXT`);
    });
    const { payload, exitCode } = await migrateApply(dbFile);

    expect(exitCode, JSON.stringify(payload).slice(0, 600)).toBe(0);
    expect(payload.message).toBeUndefined();
    expect(
      (payload.applied as any[]).filter((d) => d?.op?.type === 'drop_column').map((d) => `${d.table}.${d.op.column}`),
    ).toEqual([`${LEDGER}.legacy_23684_note`]);
    const db = new Database(dbFile, { readonly: true });
    try {
      const columns = (db.prepare(`PRAGMA table_info("${LEDGER}")`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(columns).not.toContain('legacy_23684_note');
    } finally {
      db.close();
    }
  }, CASE_TIMEOUT_MS);
});
