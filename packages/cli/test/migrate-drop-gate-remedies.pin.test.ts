// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — for every drop `os migrate apply` refuses on a database, `os migrate
 * plan` and `apply`'s own listing and skip lines name the command that moves
 * that database on, and never offer `--allow-destructive` for it (#24958).
 *
 * ## The defect
 *
 * Measured at the public door on `62bc12930`, the CLI binary against copies of
 * a SQLite database a `create-objectstack@17.7.0` app had booted once:
 *
 *     os migrate apply --yes
 *     → each organization_id drop listed with `"os migrate apply --allow-destructive" to drop it.`
 *       ⚠ 22 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).
 *       ⚠ Skipped 22 destructive change(s) (re-run with --allow-destructive to include them).
 *     os migrate apply --allow-destructive --yes
 *     → ✗ Refusing to drop sys_comment.reactions: … Run "os migrate comment-reactions" to preview …   exit 1
 *
 * The plan offered `--allow-destructive` for `sys_comment.reactions` before
 * the conversion had run, and for `sys_account.issuer` while its retirement
 * pre-flight found colliding keys; `apply --allow-destructive` refused both,
 * exit 1, naming `os migrate comment-reactions` and `os migrate account-issuer`.
 *
 * ## The population is discovered from `apply.ts`
 *
 * Each of `apply`'s drop gates answers its `--json` refusal with a
 * `message: 'refused_…'`. The first case reads those from `apply.ts`'s source
 * and requires every one to be claimed by a row of {@link GATES} (or by
 * {@link NOT_A_DROP_GATE}), and the rows to be the gates
 * `utils/apply-drop-gates.ts` reads, in the same order.
 *
 * ⛔ A NEW DROP GATE IN `apply.ts` ADDS A ROW TO {@link GATES}: the drift entry
 * it guards, a database state it holds that entry on, one it releases it on,
 * and the commands its refusal names. The discovery case fails, naming its
 * refusal, until the row exists; the row's cases then fail until
 * `APPLY_DROP_GATES` reads that gate for the doors.
 *
 * ## Per gate, both doors, each state
 *
 * - held, `plan`: the entry is still listed and counted, its line names what
 *   it waits for and never `--allow-destructive`, and the footer names every
 *   command of the gate's remedy and offers `--allow-destructive` for nothing;
 * - held, `apply --yes`: the same listing line and footer, and no line offers
 *   a re-run with `--allow-destructive`, before the prompt or after the apply;
 * - held, `apply --allow-destructive --yes`: the same listing line, then the
 *   gate's own refusal, exit 1, nothing written, naming the same commands —
 *   and the gate's read was made once, shared by the listing and the gate;
 * - CONTROL, released: both doors print what they always printed — the
 *   differ's `--allow-destructive` remedy and the re-run offer.
 *
 * ## What runs for real
 *
 * Both commands' parse, listing and footer, `apply`'s gates, and every gate's
 * own predicate and read: the reads go to a fake `objectql` service holding the
 * database state (`sys_migration` rows, `sys_account` rows). Replaced: the boot,
 * the occupancy probe and the one-shot exit. `unit` tier: nothing spawns and no
 * kernel boots (`vitest-tiers.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@oclif/core';
import { isExitSignal } from '../src/utils/format.js';
import { APPLY_DROP_GATES } from '../src/utils/apply-drop-gates.js';

// ⛔ `vi.hoisted`, never a value import of `bootSchemaStack`: a value import of
// that symbol files a test in the integration tier (`vitest-tiers.ts`).
const seams = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  exitOneShotCommand: vi.fn(async (_code: number) => {}),
}));
vi.mock('../src/utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootSchemaStack: seams.bootSchemaStack,
}));
vi.mock('../src/utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'not_applicable' })),
}));
vi.mock('../src/utils/one-shot-exit.js', () => ({ exitOneShotCommand: seams.exitOneShotCommand }));

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const APPLY_SOURCE = resolve(HERE, '../src/commands/migrate/apply.ts');

// Paid at module scope — collection is unclocked; every case below only runs.
const config = await Config.load({ root: PKG_ROOT });
const { default: MigratePlan } = await import('../src/commands/migrate/plan.js');
const { default: MigrateApply } = await import('../src/commands/migrate/apply.js');
// What the commands import at the point of use — the issuer gate's pre-flight
// (plugin-auth), the differ's remedy stripper (driver-sql), the plan's row
// normaliser and the flag reads — has its first load paid here, not inside a
// clocked case.
await Promise.all([
  import('@objectstack/plugin-auth'),
  import('@objectstack/driver-sql'),
  import('@objectstack/metadata-protocol'),
  import('@objectstack/platform-objects/system'),
]);

// ---------------------------------------------------------------------------
// The database a gate reads, behind a fake `objectql` service
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
interface DatabaseState {
  /** `sys_migration` rows by id. */
  flags?: Record<string, Row>;
  /** `sys_account` rows, or an error its read throws. */
  accounts?: Row[] | Error;
}

const AT = '2026-10-21T00:00:00.000Z';
const verifiedFlag = (id: string): Row => ({ id, last_run_at: AT, verified_at: AT, blocking: 0 });
const unverifiedFlag = (id: string): Row => ({ id, last_run_at: AT, verified_at: null, blocking: 3 });
const REACTIONS_FLAG = 'sys-comment-reactions-to-records';
const CEREMONY_FLAG = 'adr-0131-organization-ownership';
const account = (id: string, issuer: string): Row => ({
  id, provider_id: 'oidc', account_id: 'sub_1', issuer, user_id: `usr_${id}`,
});

/** The `objectql` service the gates' reads meet; counts each read. */
function engineOver(state: DatabaseState) {
  return {
    getObject: (name: string) => ({ name }),
    findOne: vi.fn(async (object: string, options: { where?: { id?: string } }) => {
      expect(object).toBe('sys_migration');
      return state.flags?.[options.where?.id ?? ''] ?? null;
    }),
    find: vi.fn(async (object: string, query: { where?: { id?: { $gt?: string } } }) => {
      expect(object).toBe('sys_account');
      if (state.accounts instanceof Error) throw state.accounts;
      const after = query.where?.id?.$gt;
      return (state.accounts ?? []).filter((r) => after === undefined || String(r.id) > after);
    }),
  };
}
type Engine = ReturnType<typeof engineOver>;

// ---------------------------------------------------------------------------
// The drift, as the shared differ reports it
// ---------------------------------------------------------------------------

type Entry = {
  kind: string; remoteName: string; table: string; column?: string; severity: string;
  category: 'safe' | 'needs_confirm' | 'destructive'; op: Record<string, unknown> & { type: string }; message: string;
};

const ALLOW_DESTRUCTIVE_REMEDY = ' — "os migrate apply --allow-destructive" to drop it.';

function orphan(table: string, column: string): Entry {
  return {
    kind: 'unmapped_column', remoteName: table, table, column, severity: 'warning', category: 'destructive',
    op: { type: 'drop_column', table, column },
    message: `${table}.${column}: column exists in the database but not in metadata (orphaned)${ALLOW_DESTRUCTIVE_REMEDY}`,
  };
}
/** A destructive drop no gate guards. */
const UNGATED = orphan('sys_sso_provider', 'created_by');
/** A safe entry, which `apply` performs without --allow-destructive. */
const INDEX: Entry = {
  kind: 'missing_index', remoteName: 'sys_job', table: 'sys_job', severity: 'info', category: 'safe',
  op: { type: 'create_index', table: 'sys_job', createIndexName: 'idx_sys_job_created_at' },
  message: `sys_job: metadata declares index 'idx_sys_job_created_at' (created_at) but the database has no such index — run "os migrate apply" to create it.`,
};

// ---------------------------------------------------------------------------
// The roster — one row per drop gate `os migrate apply` has
// ---------------------------------------------------------------------------

interface GateRow {
  /** `APPLY_DROP_GATES[i].id`, in `apply`'s order. */
  id: string;
  /** The `--json` refusal messages this gate answers with (discovered from `apply.ts`). */
  refusals: string[];
  /** The drift entry it guards. */
  entry: Entry;
  /**
   * Database states it holds that entry on, and the line its refusal starts
   * with there. `names` is false for a refusal that names no command (the
   * issuer pre-flight's unreadable table: its detail is the remedy).
   */
  held: Array<{ state: string; db: DatabaseState; refusal: string; names?: false }>;
  /** A database state it releases it on. */
  released: DatabaseState;
  /** The commands its refusal names, which every door names for a held entry. */
  remedy: string[];
  /** How many reads of its verdict a held run makes, per the fake engine. */
  readsOf: (engine: Engine) => number;
}

const flagReads = (id: string) => (engine: Engine) => engine.findOne.mock.calls.filter(([, o]) => o.where?.id === id).length;

/**
 * ⛔ A NEW DROP GATE IN `apply.ts` ADDS ITS ROW HERE (see this file's header).
 */
const GATES: GateRow[] = [
  {
    id: 'sys_account.issuer',
    refusals: ['refused_account_issuer_preflight_unreadable', 'refused_account_issuer_collisions'],
    entry: orphan('sys_account', 'issuer'),
    held: [
      {
        state: 'two rows share one (provider_id, account_id) key',
        db: { accounts: [account('a1', 'https://idp-a'), account('a2', 'https://idp-b')] },
        refusal: 'Refusing to drop sys_account.issuer: dropping it would make the rows above indistinguishable',
      },
      {
        state: 'sys_account cannot be read',
        db: { accounts: new Error('SQLITE_ERROR: no such column: provider_id') },
        refusal: 'Refusing to drop sys_account.issuer: the retirement pre-flight could not read the table.',
        names: false,
      },
    ],
    released: { accounts: [account('a1', 'https://idp-a')] },
    remedy: ['os migrate account-issuer'],
    // The walk's first page carries no cursor: one per pre-flight.
    readsOf: (engine) => engine.find.mock.calls.filter(([, q]) => q.where?.id?.$gt === undefined).length,
  },
  {
    id: 'sys_comment.reactions',
    refusals: ['refused_comment_reactions_unconverted'],
    entry: orphan('sys_comment', 'reactions'),
    held: [
      { state: 'no conversion run recorded', db: {}, refusal: 'Refusing to drop sys_comment.reactions:' },
      {
        state: 'an unverified conversion run recorded',
        db: { flags: { [REACTIONS_FLAG]: unverifiedFlag(REACTIONS_FLAG) } },
        refusal: 'Refusing to drop sys_comment.reactions:',
      },
    ],
    released: { flags: { [REACTIONS_FLAG]: verifiedFlag(REACTIONS_FLAG) } },
    remedy: ['os migrate comment-reactions', 'os migrate comment-reactions --apply'],
    readsOf: flagReads(REACTIONS_FLAG),
  },
  {
    id: 'organization_id',
    refusals: ['refused_organization_ownership_unmigrated'],
    entry: orphan('sys_job', 'organization_id'),
    held: [
      { state: 'no ceremony run recorded', db: {}, refusal: 'Refusing this --allow-destructive run: it would drop organization_id' },
      {
        state: 'an unverified ceremony run recorded',
        db: { flags: { [CEREMONY_FLAG]: unverifiedFlag(CEREMONY_FLAG) } },
        refusal: 'Refusing this --allow-destructive run: it would drop organization_id',
      },
    ],
    released: { flags: { [CEREMONY_FLAG]: verifiedFlag(CEREMONY_FLAG) } },
    remedy: [
      'os migrate organization-ownership --out PLAN',
      'os migrate organization-ownership --apply --plan-file PLAN --backup-taken',
    ],
    readsOf: flagReads(CEREMONY_FLAG),
  },
];

/** `apply`'s refusals that are not a drop gate's. */
const NOT_A_DROP_GATE = ['refused_unloadable_host_config'];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let flushSchemaDdl: ReturnType<typeof vi.fn>;
let applyMigrationEntries: ReturnType<typeof vi.fn>;

/** Boot a stack whose drift is `drift` and whose `objectql` service reads `db`; answer the engine. */
function bootOver(drift: Entry[], db: DatabaseState): Engine {
  const engine = engineOver(db);
  flushSchemaDdl = vi.fn(async () => []);
  applyMigrationEntries = vi.fn(async (entries: Entry[], opts: { allowDestructive: boolean }) => ({
    applied: entries.filter((d) => d.category !== 'destructive' || opts.allowDestructive),
    skipped: entries.filter((d) => d.category === 'destructive' && !opts.allowDestructive),
  }));
  seams.bootSchemaStack.mockResolvedValue({
    driver: { config: { url: 'postgres://db.example/app' } },
    drivers: [],
    dbLabel: 'postgres://db.example/app',
    dbSource: { kind: 'flag' },
    telemetryDatabase: null,
    schemaSync: 'deferred',
    composition: {
      plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null,
      servedBoot: { mirrored: false, reason: 'not-composed' }, notes: [], coverage: null,
    },
    detectManagedDrift: async () => drift,
    driftApplyLimit: () => null,
    pendingSchemaWork: [],
    managedTableCount: 3,
    nonObjectTables: [],
    tableAbsent: () => false,
    allObjects: () => [],
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : undefined) },
    flushSchemaDdl,
    applyMigrationEntries,
    shutdown: async () => {},
  });
  return engine;
}

let said: string[];
beforeEach(() => {
  said = [];
  seams.bootSchemaStack.mockReset();
  seams.exitOneShotCommand.mockClear();
  const capture = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(process.stdout, 'write').mockImplementation(((_chunk: unknown, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Run one command; answer every line it printed and the status it ends with. */
async function drive(
  command: { run(argv: string[], opts?: Config): Promise<unknown> },
  argv: string[],
): Promise<{ lines: string[]; exit: number | undefined }> {
  const savedExit = process.exitCode;
  process.exitCode = undefined;
  try {
    const err = await command.run([...argv, '--database-url', 'postgres://db.example/app'], config).then(() => null, (e: unknown) => e);
    if (err !== null && !isExitSignal(err)) throw err;
    const exit = err !== null
      ? (err as { oclif?: { exit?: number } }).oclif?.exit
      : seams.exitOneShotCommand.mock.calls.at(-1)?.[0];
    return { lines: said.join('\n').split('\n'), exit };
  } finally {
    process.exitCode = savedExit;
  }
}

/** The line printed under the entry acting on `e`: its finding and its remedy. */
function lineUnder(lines: string[], e: Entry): string {
  const at = lines.findIndex((l) => l.includes(` ${e.table}.${e.column} [`));
  expect(at, `no ${e.table}.${e.column} entry in:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0);
  return lines[at + 1]!;
}

/** Everything printed below the summary line. */
function below(lines: string[]): string[] {
  const at = lines.findIndex((l) => /\d+ change\(s\): \d+ safe/.test(l));
  expect(at, lines.join('\n')).toBeGreaterThanOrEqual(0);
  return lines.slice(at + 1);
}

/** A held entry's line: the finding, then what it waits for — never the differ's remedy. */
function expectHeldLine(line: string, e: Entry): void {
  expect(line).toContain(e.message.slice(0, -ALLOW_DESTRUCTIVE_REMEDY.length));
  expect(line).not.toContain('--allow-destructive');
  expect(line).toMatch(/\(see below\)\.$/);
}

const REMEDY_SENTENCE = /"os migrate apply --allow-destructive" to drop it/;
const RE_RUN_OFFER = /re-run with --allow-destructive to include them/;

// ---------------------------------------------------------------------------
// 1. The roster is apply's
// ---------------------------------------------------------------------------

describe('the roster is the drop gates apply has', () => {
  it("every `refused_…` message in apply.ts is claimed by a row — a new gate's refusal fails here until it has one", () => {
    const source = readFileSync(APPLY_SOURCE, 'utf8');
    const discovered = [...new Set([...source.matchAll(/message: '(refused_[a-z_]+)'/g)].map((m) => m[1]!))].sort();
    // Not vacuous: the scan reaches the refusals this was filed on.
    expect(discovered.length).toBeGreaterThanOrEqual(5);
    expect(discovered).toEqual([...GATES.flatMap((g) => g.refusals), ...NOT_A_DROP_GATE].sort());
  });

  it('the rows are the gates the doors read, in the order apply asks them', () => {
    expect(APPLY_DROP_GATES.map((g) => g.id)).toEqual(GATES.map((g) => g.id));
  });

  it.each(GATES.map((g) => [g.id, g] as const))('%s: its entry is judged by its gate and by no other', (_id, row) => {
    expect(APPLY_DROP_GATES.filter((g) => g.judges(row.entry)).map((g) => g.id)).toEqual([row.id]);
    expect(APPLY_DROP_GATES.some((g) => g.judges(UNGATED) || g.judges(INDEX))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Held: every door names the gate's command, never --allow-destructive
// ---------------------------------------------------------------------------

const HELD = GATES.flatMap((row) => row.held.map((h) => [row.id, h.state, row, h.db, h] as const));

describe('a drop apply refuses here', () => {
  it.each(HELD)('%s (%s): os migrate plan lists and counts it, names the remedy, and offers --allow-destructive for nothing', async (_id, _state, row, db) => {
    bootOver([INDEX, row.entry, UNGATED], db);
    const { lines, exit } = await drive(MigratePlan, []);
    expect(exit, lines.join('\n')).toBe(0);

    expectHeldLine(lineUnder(lines, row.entry), row.entry);
    // Still drift: listed and counted.
    expect(lines.join('\n')).toContain('3 change(s): 1 safe, 0 needs-confirm, 2 destructive');
    // The gate it does not guard keeps the differ's message.
    expect(lineUnder(lines, UNGATED)).toBe(`        ${UNGATED.message}`);

    const footer = below(lines).join('\n');
    expect(footer).toContain('Apply with: os migrate apply');
    expect(footer).not.toMatch(/add --allow-destructive/);
    for (const command of row.remedy) expect(footer).toContain(`"${command}"`);
  }, 60_000);

  it.each(HELD)('%s (%s): os migrate apply --yes lists it with the remedy, and offers no re-run with --allow-destructive', async (_id, _state, row, db) => {
    bootOver([INDEX, row.entry, UNGATED], db);
    const { lines, exit } = await drive(MigrateApply, ['--yes']);
    expect(exit, lines.join('\n')).toBe(0);

    expectHeldLine(lineUnder(lines, row.entry), row.entry);
    const after = below(lines).join('\n');
    expect(after).not.toMatch(RE_RUN_OFFER);
    for (const command of row.remedy) expect(after).toContain(`"${command}"`);
    expect(after).toContain('2 destructive change(s) will be SKIPPED, and a re-run with --allow-destructive cannot include them yet:');
    expect(after).toContain('Skipped 2 destructive change(s); a re-run with --allow-destructive cannot include them yet (see above).');
    // The safe work still runs: held drops hold back only the destructive half.
    expect(applyMigrationEntries).toHaveBeenCalledTimes(1);
    expect(applyMigrationEntries.mock.calls[0]![1]).toEqual({ allowDestructive: false });
  }, 60_000);

  it.each(HELD)('%s (%s): os migrate apply --allow-destructive --yes lists it with the remedy, then its gate refuses, reading the gate once', async (_id, _state, row, db, held) => {
    const engine = bootOver([INDEX, row.entry, UNGATED], db);
    const { lines, exit } = await drive(MigrateApply, ['--allow-destructive', '--yes']);
    expect(exit, lines.join('\n')).toBe(1);
    expect(flushSchemaDdl).not.toHaveBeenCalled();
    expect(applyMigrationEntries).not.toHaveBeenCalled();

    expectHeldLine(lineUnder(lines, row.entry), row.entry);
    // The gate's own refusal, as it always was: the doors above name the
    // commands it names.
    const refusal = lines.find((l) => l.includes('✗ Refusing'));
    expect(refusal, lines.join('\n')).toContain(`✗ ${held.refusal}`);
    if (held.names !== false) for (const command of row.remedy) expect(refusal).toContain(command);
    // The listing and the gate share one read of the gate's verdict.
    expect(row.readsOf(engine)).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. CONTROL — released: both doors print what they always printed
// ---------------------------------------------------------------------------

describe('CONTROL: a drop its gate releases', () => {
  it.each(GATES.map((g) => [g.id, g] as const))('%s: os migrate plan offers --allow-destructive for it, as it always did', async (_id, row) => {
    const engine = bootOver([INDEX, row.entry, UNGATED], row.released);
    const { lines, exit } = await drive(MigratePlan, []);
    expect(exit, lines.join('\n')).toBe(0);
    expect(lineUnder(lines, row.entry)).toBe(`        ${row.entry.message}`);
    expect(lineUnder(lines, row.entry)).toMatch(REMEDY_SENTENCE);
    expect(below(lines).filter((l) => l.trim() !== '' && !/^\s+\d+ms$/.test(l))).toEqual([
      '  Apply with: os migrate apply (add --allow-destructive for drops / tightenings)',
    ]);
    // …and the verdict WAS read: this control is not passing for want of a read.
    expect(row.readsOf(engine)).toBe(1);
  }, 60_000);

  it.each(GATES.map((g) => [g.id, g] as const))('%s: os migrate apply --yes offers the re-run, as it always did', async (_id, row) => {
    bootOver([INDEX, row.entry, UNGATED], row.released);
    const { lines, exit } = await drive(MigrateApply, ['--yes']);
    expect(exit, lines.join('\n')).toBe(0);
    expect(lineUnder(lines, row.entry)).toBe(`        ${row.entry.message}`);
    const after = below(lines).join('\n');
    expect(after).toContain('2 destructive change(s) will be SKIPPED (re-run with --allow-destructive to include them).');
    expect(after).toContain('Skipped 2 destructive change(s) (re-run with --allow-destructive to include them).');
  }, 60_000);

  it('no gated drop at all: neither door reads a gate', async () => {
    for (const command of [MigratePlan, MigrateApply]) {
      const engine = bootOver([INDEX, UNGATED], {});
      const { lines, exit } = await drive(command, command === MigrateApply ? ['--yes'] : []);
      expect(exit, lines.join('\n')).toBe(0);
      expect(engine.find).not.toHaveBeenCalled();
      expect(engine.findOne).not.toHaveBeenCalled();
      expect(lineUnder(lines, UNGATED)).toBe(`        ${UNGATED.message}`);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. --json reads nothing for the doors, and its document is the report
// ---------------------------------------------------------------------------

describe('--json', () => {
  it.each(GATES.map((g) => [g.id, g] as const))('%s held: os migrate plan --json reads no gate and carries the differ\'s message', async (_id, row) => {
    const engine = bootOver([INDEX, row.entry, UNGATED], row.held[0]!.db);
    const { exit } = await drive(MigratePlan, ['--json']);
    expect(exit).toBe(0);
    expect(row.readsOf(engine)).toBe(0);
    const out = (process.stdout.write as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join('');
    const doc = JSON.parse(out.trim());
    expect(doc.changes.map((c: Entry) => c.message)).toEqual([INDEX.message, row.entry.message, UNGATED.message]);
  }, 60_000);
});
