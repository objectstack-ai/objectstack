// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every `os migrate` subcommand that writes behind a confirmation
 * answers a run that did not give it with exit 1, applies nothing, and names
 * the flag that gives it (#24949).
 *
 * ## The defect
 *
 * Measured at the public door on `e4d604efd3`, the CLI binary against a SQLite
 * file whose plan lists one destructive change, stdin from `/dev/null`:
 *
 *     os migrate apply --allow-destructive
 *     → ⚠ Confirmation required. Re-run with --yes to apply, or use "os migrate plan" to preview.
 *       exit 0, and the column the plan would drop still there
 *
 * `--json` printed its `confirmation_required` document beside exit 0 too.
 * Every other subcommand with a `--yes` gate already answered the same
 * situation with exit 1 (`comment-reactions --apply` among them), so a deploy
 * script or an agent reading `$?` took the one run that applied nothing for
 * an applied one.
 *
 * ## The population is discovered, not listed
 *
 * Every module under `src/commands/migrate`, imported, whose command class
 * declares a `yes` flag or an `apply` flag: a mode that writes behind a
 * confirmation. Membership reads the flags oclif parses, never the source
 * text. {@link ROSTER} must equal that population, so a subcommand added later
 * with such a mode fails the first case, by id, until its row says how to
 * reach its gate — and then the per-member cases hold it to the family's code.
 *
 * `organization-ownership` is the one member whose confirmation is not
 * `--yes`: its `--apply` asks whether a backup was taken, and `--backup-taken`
 * answers it. Its row names that flag.
 *
 * ## What runs for real, and what is replaced
 *
 * Each command runs through oclif in-process: its parse, its gate, its
 * `emitJson` and `this.exit`. Replaced: the occupancy probe, the stack boot,
 * the journal runner and its reads, the sentinel scan, the one-shot exit, and
 * the prompt's readline. Most gates sit before the boot, so "nothing applied"
 * there is "the boot never ran"; `apply`, `recorded-by` and `resume` gate
 * after it, and their rows name the write seams a refused run must not reach.
 * `process.stdin.isTTY` is set by each run, never inherited from the runner.
 *
 * ## Controls
 *
 * - `apply --yes`, non-interactive: the writes run and the exit is 0, so the
 *   harness tells a refusal from a run.
 * - `apply` on a terminal, answered `n`: the prompt was asked, nothing was
 *   written, exit 0. An operator's decline is a choice, not a failed run, and
 *   keeps its code.
 *
 * ## Tier
 *
 * `unit` (`vitest-tiers.ts`): nothing is spawned and no kernel boots;
 * `bootSchemaStack` is replaced through `vi.mock` and never value-imported
 * here. The public-door form — the CLI binary against a real SQLite file, a
 * pseudo-terminal for the decline — was measured before and after the fix
 * and is recorded on the pull request rather than re-run per CI shard.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { isExitSignal } from '../src/utils/format.js';

// ---------------------------------------------------------------------------
// Seams. Replaced, never value-imported: the commands' own control flow runs.
// ---------------------------------------------------------------------------

const seams = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  exitOneShotCommand: vi.fn(async (_code: number) => {}),
  runMigrationJournal: vi.fn(),
  resumeMigrationJournal: vi.fn(),
  findInterruptedRuns: vi.fn(),
  readRunJournal: vi.fn(),
  findSentinelHistoryRows: vi.fn(),
  flushSchemaDdl: vi.fn(),
  applyMigrationEntries: vi.fn(),
  /** Every question the prompt asked, and the answer it is given. */
  prompts: [] as string[],
  answer: { value: 'n' },
}));

vi.mock('../src/utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootSchemaStack: seams.bootSchemaStack,
}));
vi.mock('../src/utils/data-migration-plugins.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildDataMigrationPlugins: async () => [],
}));
vi.mock('../src/utils/migrate-occupancy-gate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeMigrationTarget: async () => ({ status: 'not_applicable' }),
}));
vi.mock('../src/utils/one-shot-exit.js', () => ({ exitOneShotCommand: seams.exitOneShotCommand }));
vi.mock('@objectstack/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runMigrationJournal: seams.runMigrationJournal,
  resumeMigrationJournal: seams.resumeMigrationJournal,
  findInterruptedRuns: seams.findInterruptedRuns,
  readRunJournal: seams.readRunJournal,
}));
vi.mock('@objectstack/metadata-protocol', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findSentinelHistoryRows: seams.findSentinelHistoryRows,
}));
// The `[y/N]` prompt. Reached only on a terminal: every `confirm()` in the
// family answers `false` before it builds an interface when stdin is no TTY.
vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const createInterface = () => ({
    question: (q: string, cb: (answer: string) => void) => {
      seams.prompts.push(q);
      cb(seams.answer.value);
    },
    close: () => {},
  });
  return { ...actual, createInterface };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const MIGRATE_DIR = resolve(HERE, '../src/commands/migrate');

// ---------------------------------------------------------------------------
// The population, read off the command classes
// ---------------------------------------------------------------------------

type Runnable = { flags?: Record<string, { type?: unknown }>; run(argv: string[], opts?: Config): Promise<unknown> };

// Paid at module scope — collection is unclocked; every case below only reads.
const COMMANDS = new Map<string, Runnable>();
for (const name of readdirSync(MIGRATE_DIR).sort()) {
  if (!name.endsWith('.ts') || /\.(test|spec)\.ts$/.test(name) || name.endsWith('.d.ts')) continue;
  const mod = (await import(join(MIGRATE_DIR, name))) as { default?: unknown };
  if (typeof mod.default === 'function') COMMANDS.set(basename(name, '.ts'), mod.default as unknown as Runnable);
}

/** A mode that writes behind a confirmation: a `yes` flag, or an `apply` mode. */
function writesBehindConfirmation(cls: Runnable): boolean {
  const flags = cls.flags ?? {};
  return flags.yes?.type === 'boolean' || flags.apply?.type === 'boolean';
}

const POPULATION = [...COMMANDS].filter(([, cls]) => writesBehindConfirmation(cls)).map(([id]) => id).sort();

const config = await Config.load({ root: PKG_ROOT });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCRATCH = mkdtempSync(join(tmpdir(), 'os-24949-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A plan file `organization-ownership --apply` accepts as reviewed: it reads it before the backup question. */
const PLAN_FILE = join(SCRATCH, 'organization-ownership-plan.json');
writeFileSync(PLAN_FILE, JSON.stringify({
  kind: 'organization-ownership-plan',
  ceremony: 'ADR-0131 D10',
  inventoryDigest: 'pin',
  database: 'file:pin.db',
  generatedAt: '2026-10-20T00:00:00.000Z',
  posture: 'single',
  tables: [],
}));

/** The destructive change the defect was measured on: a column metadata no longer declares. */
const DROP = {
  category: 'destructive',
  table: 'os24949_thing',
  column: 'legacy_note',
  op: { type: 'drop_column', table: 'os24949_thing', column: 'legacy_note' },
  description: 'os24949_thing.legacy_note: column exists in the database but not in metadata (orphaned)',
};

const engine = { find: vi.fn(async () => []) };

function stackWith(services: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    kernel: {
      getService: (name: string): unknown => {
        if (name in services) return services[name];
        throw new Error(`service '${name}' is not composed in this fixture`);
      },
    },
    dbLabel: 'file:pin.db',
    shutdown: vi.fn(async () => {}),
    ...extra,
  };
}

/** `os migrate apply`'s boot: one destructive drift entry, its two writes observed. */
function arrangeApply(): void {
  seams.flushSchemaDdl.mockResolvedValue([]);
  seams.applyMigrationEntries.mockResolvedValue({ applied: [DROP], skipped: [] });
  seams.bootSchemaStack.mockResolvedValue(stackWith({ objectql: {} }, {
    driver: {},
    drivers: [],
    dbSource: { kind: 'flag' },
    telemetryDatabase: null,
    composition: { plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null, notes: [] },
    detectManagedDrift: async () => [DROP],
    driftApplyLimit: () => null,
    pendingSchemaWork: [],
    flushSchemaDdl: seams.flushSchemaDdl,
    applyMigrationEntries: seams.applyMigrationEntries,
  }));
}

// ---------------------------------------------------------------------------
// The roster: how each member reaches its gate, and what a refused run must not reach
// ---------------------------------------------------------------------------

interface Member {
  /** The writing mode, without its confirmation. */
  argv: string[];
  /** The flag that gives the confirmation this mode asks for. */
  confirm: '--yes' | '--backup-taken';
  /** The seams a run past the gate reaches; a refused run reaches none of them. */
  writes: () => ReadonlyArray<ReturnType<typeof vi.fn>>;
  /** Members that gate after the boot: arrange the boot and the reads that lead to the gate. */
  arrange?: () => void;
}

/** The gate sits before the boot: a run that never booted wrote nothing. */
const BOOT = (): ReadonlyArray<ReturnType<typeof vi.fn>> => [seams.bootSchemaStack];

const ROSTER: Record<string, Member> = {
  'activity-changed-fields': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  apply: {
    argv: ['--allow-destructive'],
    confirm: '--yes',
    arrange: arrangeApply,
    writes: () => [seams.flushSchemaDdl, seams.applyMigrationEntries],
  },
  'audit-key-material': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'audit-mail-bodies': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'audit-metadata-bodies': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'comment-parent-pair': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'comment-reactions': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'files-to-references': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  // `--yes` belongs to the stored-row pass; without `--stored` the command converts source files.
  meta: { argv: ['--stored', '--apply'], confirm: '--yes', writes: BOOT },
  'multi-value-columns': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'organization-ownership': { argv: ['--apply', '--plan-file', PLAN_FILE], confirm: '--backup-taken', writes: BOOT },
  'recorded-by': {
    argv: ['--apply'],
    confirm: '--yes',
    arrange: () => {
      seams.bootSchemaStack.mockResolvedValue(stackWith({ objectql: engine }));
      seams.findSentinelHistoryRows.mockResolvedValue([{ id: 'history-1' }]);
    },
    writes: () => [seams.runMigrationJournal],
  },
  resume: {
    argv: ['--run', 'run-1'],
    confirm: '--yes',
    arrange: () => {
      const plan = { id: 'plan-1', onCrash: 'resume' };
      seams.bootSchemaStack.mockResolvedValue(stackWith({
        objectql: engine,
        'migration-plans': { get: (id: string) => (id === plan.id ? plan : undefined) },
      }));
      seams.findInterruptedRuns.mockResolvedValue([{
        runId: 'run-1', planId: 'plan-1', planHash: 'hash', committedChunks: [], unknownChunks: [0], compensatedChunks: [],
      }]);
    },
    writes: () => [seams.resumeMigrationJournal],
  },
  'security-catalog-overlays': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'summary-nulls': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
  'value-shapes': { argv: ['--apply'], confirm: '--yes', writes: BOOT },
};

// ---------------------------------------------------------------------------
// Driving one run
// ---------------------------------------------------------------------------

const OUTER_EXIT_CODE = process.exitCode;
/** The colour codes chalk adds, stripped so the output reads as the operator sees it. */
const SGR = /\u001b\[[0-9;]*m/g;

interface Driven {
  /** The status the shell would see: the signal's code, else the one-shot exit's, else `process.exitCode`, else 0. */
  exit: number;
  /** Everything the run printed, on either stream. */
  output: string;
}

async function drive(id: string, argv: string[], opts: { tty: boolean }): Promise<Driven> {
  const cls = COMMANDS.get(id);
  if (!cls) throw new Error(`no command module named ${id} under src/commands/migrate`);
  const chunks: string[] = [];
  const capture = (...args: unknown[]): void => { chunks.push(args.map(String).join(' ')); };
  const write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
    capture(String(chunk));
    // `emitJson` awaits the write's drain callback, so the double must call it.
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write;
  const spies: Array<{ mockRestore(): void }> = [
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
    vi.spyOn(process.stdout, 'write').mockImplementation(write),
    vi.spyOn(process.stderr, 'write').mockImplementation(write),
  ];
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: opts.tty, configurable: true, writable: true });
  process.exitCode = undefined;
  let exit: number;
  try {
    await cls.run(argv, config);
    const oneShot = seams.exitOneShotCommand.mock.calls.at(-1)?.[0];
    exit = typeof oneShot === 'number' ? oneShot : typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    if (!isExitSignal(error)) throw error;
    exit = (error as { oclif: { exit: number } }).oclif.exit;
  } finally {
    for (const spy of spies) spy.mockRestore();
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    process.exitCode = OUTER_EXIT_CODE;
  }
  return { exit, output: chunks.join('\n').replace(SGR, '') };
}

beforeEach(() => {
  for (const seam of [
    seams.bootSchemaStack, seams.runMigrationJournal, seams.resumeMigrationJournal, seams.findInterruptedRuns,
    seams.readRunJournal, seams.findSentinelHistoryRows, seams.flushSchemaDdl, seams.applyMigrationEntries,
  ]) seam.mockReset();
  seams.exitOneShotCommand.mockClear();
  seams.prompts.length = 0;
  seams.answer.value = 'n';
});

/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

describe('the family: every os migrate mode that writes behind a confirmation', () => {
  it('is exactly the roster — a new member names how its gate is reached before it can pass', () => {
    expect(POPULATION, 'discovered from the command classes\' flags').toEqual(Object.keys(ROSTER).sort());
  });

  it('has a --json face on every member, so both faces below are pinned for each', () => {
    expect(POPULATION.filter((id) => COMMANDS.get(id)!.flags?.json?.type !== 'boolean')).toEqual([]);
  });
});

describe('a non-interactive run without its confirmation applies nothing and exits 1', () => {
  it.each(Object.entries(ROSTER))('%s — text face: exit 1, names its confirmation flag', async (id, member) => {
    member.arrange?.();

    const run = await drive(id, member.argv, { tty: false });

    expect(run.exit, run.output).toBe(1);
    expect(run.output).toContain(member.confirm);
    for (const seam of member.writes()) expect(seam).not.toHaveBeenCalled();
    expect(seams.prompts, 'a non-interactive run never prompts').toEqual([]);
  }, RUN_TIMEOUT);

  it.each(Object.entries(ROSTER))('%s — --json face: exit 1', async (id, member) => {
    member.arrange?.();

    const run = await drive(id, [...member.argv, '--json'], { tty: false });

    expect(run.exit, run.output).toBe(1);
    for (const seam of member.writes()) expect(seam).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);
});

describe('controls (os migrate apply)', () => {
  it('with --yes the run applies and exits 0, so the harness tells a refusal from a run', async () => {
    arrangeApply();

    const run = await drive('apply', ['--allow-destructive', '--yes'], { tty: false });

    expect(run.exit, run.output).toBe(0);
    expect(seams.applyMigrationEntries).toHaveBeenCalledTimes(1);
  }, RUN_TIMEOUT);

  it('a terminal answered n: the prompt was asked, nothing written, exit 0 — a decline keeps its code', async () => {
    arrangeApply();
    seams.answer.value = 'n';

    const run = await drive('apply', ['--allow-destructive'], { tty: true });

    expect(seams.prompts).toHaveLength(1);
    expect(run.exit, run.output).toBe(0);
    expect(seams.flushSchemaDdl).not.toHaveBeenCalled();
    expect(seams.applyMigrationEntries).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);
});
