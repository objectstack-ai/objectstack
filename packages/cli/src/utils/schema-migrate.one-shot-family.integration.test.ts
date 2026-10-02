// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21391] Every command that boots through `bootSchemaStack` keeps the two
 * promises a one-shot boot makes, pinned across the whole family.
 *
 *  1. **A no-write mode leaves the database byte-identical**: the schema and
 *     every row, read on a connection of our own. A dry run, a scan or a
 *     report never reaches schema sync, never runs the seed loader, and never
 *     brings a missing SQLite file into existence.
 *  2. **A write mode runs no seed write**: `--apply`, `--delete`, `--run`,
 *     `--yes` write what the command was asked to write, and the artifact's
 *     inline seed loader does not ride along. The operator never saw a seed
 *     write in the preview.
 *
 * ## Why one table, derived from source
 *
 * The defect was not in one command. Seven of the family booted the plain
 * stack in their no-write mode, one call site at a time, each one reasonable
 * on its own. So the family here is not a list someone remembered: it is every
 * module under `src/` that value-imports `bootSchemaStack`, read off the
 * source. A new caller fails the first case below, by file name, until its
 * modes are declared in {@link CALLERS} and so run through the other two.
 *
 * ## The fixture
 *
 * A database a SERVED boot left behind: the artifact's inline seed written,
 * then an operator's edit to the seeded row (`status: 'won'`). A seed replay
 * puts the edit back to the seed's value and bumps `updated_at`. The commands
 * then run against an artifact one step AHEAD of that database (one new
 * field, one new object), so a boot that schema-syncs leaves a different
 * schema behind. The same detection the card measured on `examples/app-crm`.
 *
 * SQLite only. The read-only boot is one code path for every dialect, and the
 * live PostgreSQL leg of its two original members is
 * `../commands/migrate/preview-read-only.integration.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { isExitSignal } from './format.js';
import { bootSchemaStack } from './schema-migrate.js';
import { buildDataMigrationPlugins } from './data-migration-plugins.js';
import MetaResync from '../commands/meta/resync.js';
import MigrateAccountIssuer from '../commands/migrate/account-issuer.js';
import MigrateApply from '../commands/migrate/apply.js';
import MigrateAuditMetadataBodies from '../commands/migrate/audit-metadata-bodies.js';
import MigrateDuplicates from '../commands/migrate/duplicates.js';
import MigrateFilesToReferences from '../commands/migrate/files-to-references.js';
import MigrateMeta from '../commands/migrate/meta.js';
import MigrateMultiValueColumns from '../commands/migrate/multi-value-columns.js';
import MigratePlan from '../commands/migrate/plan.js';
import MigrateRecordedBy from '../commands/migrate/recorded-by.js';
import MigrateResume from '../commands/migrate/resume.js';
import MigrateSummaryNulls from '../commands/migrate/summary-nulls.js';
import MigrateValueShapes from '../commands/migrate/value-shapes.js';
import SecretOrphans from '../commands/secret/orphans.js';
import StorageOrphans from '../commands/storage/orphans.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD: the commands reach them through dynamic `import()`s inside
// `run()`, which vitest clocks (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import '@objectstack/objectql';
import '@objectstack/platform-objects/plugin';
import '@objectstack/service-settings';
import '@objectstack/service-storage';
import '@objectstack/plugin-audit';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const CLI_ROOT = resolve(HERE, '..', '..');

/** A boot plus a command run — oclif builds its command table on the first run in a process. */
const CASE_TIMEOUT_MS = 120_000;

/** Elevated so the fixture's writes bypass RLS on system objects. */
const SYSTEM = { context: { isSystem: true } };

/** The app as the served boot ran it: one object and the inline seed it upserts on every start. */
const SERVED_ARTIFACT = {
  manifest: { id: 'com.example.one-shot-family', name: 'One Shot Family', version: '0.0.0', type: 'app' },
  objects: [{ name: 'osf_lead', fields: { name: { type: 'text' }, status: { type: 'text' } } }],
  data: [{ object: 'osf_lead', externalId: 'name', mode: 'upsert', records: [{ name: 'Acme', status: 'open' }] }],
};

/**
 * The same app one release later: a new field on the seeded object and a new
 * object. A boot that schema-syncs adds the column and creates the table.
 */
const NEXT_ARTIFACT = {
  ...SERVED_ARTIFACT,
  objects: [
    { name: 'osf_lead', fields: { name: { type: 'text' }, status: { type: 'text' }, phone: { type: 'text' } } },
    { name: 'osf_note', fields: { body: { type: 'text' } } },
  ],
};

/** Env that would point a command's boot somewhere other than the fixture. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

// ── The family, declared ─────────────────────────────────────────────────────

/** One command, run through oclif exactly as the binary runs it. */
type Invoke = (argv: string[]) => Promise<unknown>;

interface Mode {
  /** How the case is named in the report. */
  label: string;
  /** The argv after the command id. `@DB@` is the case's database URL, `@DIR@` the project directory. */
  argv: string[];
}

interface Caller {
  run: Invoke;
  /** Every mode of this command that writes nothing. `[]` only when the command has none. */
  noWrite: Mode[];
  /** Every mode that writes. `[]` when the command is report-only. */
  write: Mode[];
  /** Why `noWrite` or `write` is empty, when it is. */
  note?: string;
}

const invoke = (command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }): Invoke =>
  (argv) => command.run(argv, { root: CLI_ROOT });

/**
 * Every `bootSchemaStack` caller, keyed by its path under `src/`, and the
 * modes it has. The first case below holds this table equal to the source.
 */
const CALLERS: Record<string, Caller> = {
  'commands/meta/resync.ts': {
    run: invoke(MetaResync),
    noWrite: [{ label: 'meta resync (no --yes)', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'meta resync --yes', argv: ['--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/account-issuer.ts': {
    run: invoke(MigrateAccountIssuer),
    noWrite: [{ label: 'migrate account-issuer', argv: ['--database-url', '@DB@', '--json'] }],
    write: [],
    note: 'a pre-flight report: it has no writing mode',
  },
  'commands/migrate/apply.ts': {
    run: invoke(MigrateApply),
    noWrite: [],
    write: [{ label: 'migrate apply --yes', argv: ['--yes', '--database-url', '@DB@', '--json'] }],
    note: 'the apply step itself: its preview is `os migrate plan`',
  },
  'commands/migrate/audit-metadata-bodies.ts': {
    run: invoke(MigrateAuditMetadataBodies),
    noWrite: [{ label: 'migrate audit-metadata-bodies', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate audit-metadata-bodies --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/duplicates.ts': {
    run: invoke(MigrateDuplicates),
    // Always JSON: the command declares no `--json` flag.
    noWrite: [{ label: 'migrate duplicates', argv: ['--database-url', '@DB@'] }],
    write: [],
    note: 'a pre-flight report: it has no writing mode',
  },
  'commands/migrate/files-to-references.ts': {
    run: invoke(MigrateFilesToReferences),
    noWrite: [{ label: 'migrate files-to-references', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate files-to-references --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/meta.ts': {
    run: invoke(MigrateMeta),
    // Without `--stored` the command converts source files and boots nothing.
    noWrite: [{ label: 'migrate meta --stored', argv: ['--stored', '--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate meta --stored --apply', argv: ['--stored', '--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/multi-value-columns.ts': {
    run: invoke(MigrateMultiValueColumns),
    noWrite: [{ label: 'migrate multi-value-columns', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate multi-value-columns --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/plan.ts': {
    run: invoke(MigratePlan),
    noWrite: [{ label: 'migrate plan', argv: ['--database-url', '@DB@', '--json'] }],
    write: [],
    note: 'the preview of `os migrate apply`: it has no writing mode',
  },
  'commands/migrate/recorded-by.ts': {
    run: invoke(MigrateRecordedBy),
    noWrite: [{ label: 'migrate recorded-by', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate recorded-by --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/resume.ts': {
    run: invoke(MigrateResume),
    noWrite: [{ label: 'migrate resume', argv: ['--database-url', '@DB@', '--json'] }],
    // No run to resume: the boot happens and the command then reports the id
    // unknown. The boot is what this case is about.
    write: [{ label: 'migrate resume --run', argv: ['--run', 'run_absent_21391', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/summary-nulls.ts': {
    run: invoke(MigrateSummaryNulls),
    noWrite: [{ label: 'migrate summary-nulls', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate summary-nulls --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/migrate/value-shapes.ts': {
    run: invoke(MigrateValueShapes),
    noWrite: [{ label: 'migrate value-shapes', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{ label: 'migrate value-shapes --apply', argv: ['--apply', '--yes', '--database-url', '@DB@', '--json'] }],
  },
  'commands/secret/orphans.ts': {
    run: invoke(SecretOrphans),
    noWrite: [{ label: 'secret orphans', argv: ['--database-url', '@DB@', '--json'] }],
    write: [{
      label: 'secret orphans --delete',
      argv: ['--delete', '--export', '@DIR@/secret-export.json', '--no-declared-datasources', '--yes', '--database-url', '@DB@', '--json'],
    }],
  },
  'commands/storage/orphans.ts': {
    run: invoke(StorageOrphans),
    noWrite: [{ label: 'storage orphans', argv: ['--database-url', '@DB@', '--json'] }],
    write: [],
    note: 'report-only: it has no writing mode',
  },
};

// ── The family, read off the source ──────────────────────────────────────────

/** Every non-test TypeScript module under `src/`, as a path relative to it. */
function sourceModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceModules(abs));
    else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(relative(SRC, abs).split('\\').join('/'));
    }
  }
  return out;
}

/** A VALUE import of `bootSchemaStack` from the funnel's module. `import type` boots nothing. */
const VALUE_IMPORT = /import\s+(?!type\b)\{([^}]*)\}\s*from\s*['"][^'"]*schema-migrate\.js['"]/g;

function callsTheFunnel(source: string): boolean {
  for (const m of source.matchAll(VALUE_IMPORT)) {
    const names = m[1].split(',').map((s) => s.trim());
    if (names.some((n) => n === 'bootSchemaStack' || n.startsWith('bootSchemaStack '))) return true;
  }
  return false;
}

// ── Running the real command ─────────────────────────────────────────────────

interface RunResult {
  payload: any;
  exitCode: number;
}

/**
 * Run one command and capture its JSON document. `process.exitCode` is
 * process-global and `emitJson` sets it, so it is saved and restored. The
 * stdout spy is installed before the boot, because a `--json` boot reserves
 * stdout and keeps whatever `process.stdout.write` is at that moment.
 * `os meta resync` ends in `process.exit()`, so that is trapped too.
 */
async function runJson(command: Invoke, argv: string[]): Promise<RunResult> {
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
      await command(argv);
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
      payload = { unparsed: out.slice(-400) };
    }
    return { payload, exitCode: processExit ?? thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

// ── The fixture database ─────────────────────────────────────────────────────

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

function probe(dbFile: string): SqlDriver {
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
}

/**
 * The SERVING boot, `os dev` / `os serve`: the standalone stack plus the
 * platform plugins the family's commands read, started, so the seed loader
 * runs. Not `bootSchemaStack`, which is what is under test.
 */
async function bootServedStack(dbFile: string): Promise<void> {
  const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
  const { SettingsServicePlugin } = await import('@objectstack/service-settings');
  const stack = await createStandaloneStack({ projectRoot: dir, databaseUrl: `file:${dbFile}` });
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  for (const plugin of stack.plugins) await kernel.use(plugin as any);
  for (const plugin of await buildDataMigrationPlugins({ storage: true, automation: true, audit: true })) {
    await kernel.use(plugin as any);
  }
  await kernel.use(new SettingsServicePlugin({ registerRoutes: false }) as any);
  await runtime.start();
  try {
    const ql = kernel.getService('objectql') as IObjectQLEngine;
    const [acme] = await ql.find('osf_lead', { where: { name: 'Acme' } }, SYSTEM);
    expect(acme?.status, 'the served boot did not write the artifact seed: nothing to protect').toBe('open');
    // The operator's edit a seed replay would put back.
    await ql.update('osf_lead', { id: acme.id, status: 'won' }, SYSTEM);
  } finally {
    await kernel.shutdown();
  }
}

/** The schema plus every row of every table, ordered, as plain JSON. */
async function readState(dbFile: string): Promise<unknown> {
  const driver = probe(dbFile);
  const k = (driver as any).knex;
  try {
    const schema = await k.raw('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    const rows: Record<string, unknown> = {};
    for (const entry of schema as Array<{ type: string; name: string }>) {
      if (entry.type !== 'table' || entry.name.startsWith('sqlite_')) continue;
      rows[entry.name] = await k.raw(`SELECT * FROM "${entry.name}" ORDER BY rowid`);
    }
    return { schema, rows };
  } finally {
    await driver.disconnect();
  }
}

/**
 * The seeded row, projected onto the columns the served boot created. A write
 * mode is ALLOWED to schema-sync (it adds `phone`), so `SELECT *` would differ
 * for a reason that is not this pin's.
 */
async function readSeededRows(dbFile: string): Promise<unknown> {
  const driver = probe(dbFile);
  try {
    return await (driver as any).knex('osf_lead').select('id', 'name', 'status', 'updated_at', 'organization_id').orderBy('id');
  } finally {
    await driver.disconnect();
  }
}

let caseSeq = 0;

/** A fresh copy of the served database, and the argv with its placeholders filled. */
function prepareCase(argv: string[], opts: { absent?: boolean } = {}): { dbFile: string; argv: string[] } {
  caseSeq += 1;
  const caseDir = join(dir, 'cases', String(caseSeq));
  mkdirSync(caseDir, { recursive: true });
  const dbFile = join(caseDir, 'app.db');
  if (!opts.absent) copyFileSync(templateDb, dbFile);
  return {
    dbFile,
    argv: argv.map((a) => a.replace('@DB@', `file:${dbFile}`).replace('@DIR@', caseDir)),
  };
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'OS_ARTIFACT_PATH', 'NODE_ENV', 'OS_LIFECYCLE_DISABLED', 'OS_SECRET_KEY'] as const) {
    savedEnv[key] = process.env[key];
  }
  for (const key of OVERRIDING_ENV) delete process.env[key];
  delete process.env.OS_LIFECYCLE_DISABLED;
  process.env.NODE_ENV = 'production';
  // The key this production-posture file needs — the served boot and every
  // command that composes `SettingsServicePlugin` (`secret orphans`, and the
  // storage arm of `files-to-references` / `storage orphans`) construct a
  // `LocalCryptoProvider`, which refuses to start in production without one.
  // Declared here rather than inherited from a persisted
  // `$HOME/.objectstack/dev-crypto-key` (#16491): one fresh value for the
  // whole file, so every boot in it decrypts what the others wrote, and never
  // written to disk.
  process.env.OS_SECRET_KEY = randomBytes(32).toString('hex');

  dir = mkdtempSync(join(tmpdir(), 'os-21391-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  // The standalone stack reads `OS_ARTIFACT_PATH`, else `<cwd>/dist/objectstack.json`.
  process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(SERVED_ARTIFACT));
  templateDb = join(dir, 'data', 'served.db');
  await bootServedStack(templateDb);
  // The commands run against the next release of the app.
  writeFileSync(process.env.OS_ARTIFACT_PATH, JSON.stringify(NEXT_ARTIFACT));
}, 180_000);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// The commands take `process.cwd()` as the project root, as a real invocation
// from the project directory does.
beforeEach(() => { process.chdir(dir); });
afterEach(() => { process.chdir(savedCwd); });

// ── The cases ────────────────────────────────────────────────────────────────

describe('[#21391] the bootSchemaStack family is the table above', () => {
  it('every module that value-imports bootSchemaStack is declared, and nothing else is', () => {
    const found = sourceModules(SRC)
      .filter((rel) => rel !== 'utils/schema-migrate.ts')
      .filter((rel) => callsTheFunnel(readFileSync(join(SRC, rel), 'utf8')))
      .sort();
    // Non-vacuity: the detector finds the family's oldest member.
    expect(found).toContain('commands/migrate/plan.ts');
    expect(found, 'a bootSchemaStack caller is missing from CALLERS, or a declared one no longer boots')
      .toEqual(Object.keys(CALLERS).sort());
  });

  it('every caller declares at least one mode, and an empty side says why', () => {
    for (const [file, caller] of Object.entries(CALLERS)) {
      expect(caller.noWrite.length + caller.write.length, file).toBeGreaterThan(0);
      if (caller.noWrite.length === 0 || caller.write.length === 0) expect(caller.note, file).toBeTruthy();
    }
  });
});

const NO_WRITE = Object.entries(CALLERS).flatMap(([file, c]) => c.noWrite.map((m) => ({ file, run: c.run, ...m })));
const WRITE = Object.entries(CALLERS).flatMap(([file, c]) => c.write.map((m) => ({ file, run: c.run, ...m })));

describe('[#21391] a no-write mode leaves the database byte-identical, boot included', () => {
  it.each(NO_WRITE)('$label', async ({ run, argv }) => {
    const c = prepareCase(argv);
    const before = await readState(c.dbFile);
    const result = await runJson(run, c.argv);

    // The run reached its report or its refusal, never a failed boot.
    expect(result.payload?.error, JSON.stringify(result.payload).slice(0, 400)).not.toBe('boot_failed');
    expect(await readState(c.dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});

describe('[#21391] a no-write mode does not bring a missing SQLite file into existence', () => {
  it.each(NO_WRITE)('$label', async ({ run, argv }) => {
    const c = prepareCase(argv, { absent: true });
    const result = await runJson(run, c.argv);

    for (const path of [c.dbFile, `${c.dbFile}-wal`, `${c.dbFile}-shm`, `${c.dbFile}-journal`]) {
      expect(existsSync(path), `${path} was created by a no-write mode`).toBe(false);
    }
    // Nothing to read there: whether the mode reports or refuses, `--json`
    // still answers with one JSON document (the declared narrowing's face).
    expect(result.payload?.unparsed, 'no JSON document on stdout').toBeUndefined();
  }, CASE_TIMEOUT_MS);
});

describe('[#21391] a write mode runs no seed write', () => {
  it.each(WRITE)('$label', async ({ run, argv }) => {
    const c = prepareCase(argv);
    const before = await readSeededRows(c.dbFile);
    expect(before).toEqual([expect.objectContaining({ name: 'Acme', status: 'won' })]);

    await runJson(run, c.argv);

    // A seed replay puts `won` back to `open` and bumps `updated_at`.
    expect(await readSeededRows(c.dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});

describe('[#21391] a one-shot boot arms no lifecycle sweep', () => {
  /** The sweep's two timers, as `LifecycleService` holds them. Private, read on purpose: they ARE the arming. */
  const armed = (kernel: any): boolean => {
    const lifecycle = kernel.getService('lifecycle') as { initialTimer?: unknown; timer?: unknown };
    return lifecycle.initialTimer !== undefined || lifecycle.timer !== undefined;
  };

  it.each([
    ['the read-only boot', { deferSchemaDdl: true, readOnlyProbe: true }],
    ['the plain boot a write mode takes', {}],
  ] as Array<[string, Record<string, boolean>]>)('%s', async (_name, options) => {
    const c = prepareCase([]);
    const stack = await bootSchemaStack({ jsonOutput: false, databaseUrl: `file:${c.dbFile}`, projectRoot: dir, ...options });
    try {
      expect(armed(stack.kernel)).toBe(false);
    } finally {
      await stack.shutdown();
    }
  }, CASE_TIMEOUT_MS);

  it('the control: a served boot of the same stack arms it', async () => {
    const c = prepareCase([]);
    const { createStandaloneStack, Runtime } = await import('@objectstack/runtime');
    const stack = await createStandaloneStack({ projectRoot: dir, databaseUrl: `file:${c.dbFile}`, skipSeedData: true });
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    for (const plugin of stack.plugins) await kernel.use(plugin as any);
    await runtime.start();
    try {
      expect(armed(kernel)).toBe(true);
    } finally {
      await kernel.shutdown();
    }
  }, CASE_TIMEOUT_MS);
});
