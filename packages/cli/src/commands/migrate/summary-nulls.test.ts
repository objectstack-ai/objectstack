// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate summary-nulls` command shape, and the #15064 scope it surfaces.
 *
 * The backfill itself is proven in `@objectstack/objectql`'s
 * `summary-backfill.test.ts`. What is pinned here is what a unit test of the
 * backfill cannot see: that the command is dry-run-by-default (#2186), and
 * that `--recompute-undefined-on-empty object.field` reaches
 * `backfillSummaryNulls` as `recomputeUndefinedOnEmpty` — every entry, in
 * order — while a run without the flag hands the option through as `undefined`
 * (the unscoped run the ruling keeps byte-for-byte). The seams that would boot
 * a database or walk a real engine are replaced; the command's own parse and
 * control flow run for real.
 *
 * And what the human face says about the database: the dry run's read-only
 * boot can still switch a SQLite file's journal mode, which rewrites its
 * header and no row, so the report's dry-run line claims no row or table and,
 * on a SQLite target only, is followed by the note naming the switch. The
 * report's formatter is the real one from `@objectstack/objectql`. A refused
 * `--recompute-undefined-on-empty` name, thrown after the boot in either mode,
 * vouches for the walk only and is followed by the same note on a SQLite
 * target; its refusal is the engine's real one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import MigrateSummaryNulls from './summary-nulls.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { isExitSignal } from '../../utils/format.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { backfillSummaryNulls } from '@objectstack/objectql';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
// The walk is replaced; the formatter is the real one, so the human-face pins
// below read the report's own dry-run line.
vi.mock('@objectstack/objectql', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/objectql')>();
  return {
    backfillSummaryNulls: vi.fn(),
    formatSummaryBackfillReport: real.formatSummaryBackfillReport,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/** The engine surface the command checks before it runs: the roll-up index
 *  verb, and at least one loaded app object (a `sys_`-only stack is refused). */
const engine = {
  getOwnedSummaryDescriptors: () => [],
  getConfigs: () => ({ customer: {}, sys_user: {} }),
};

const EMPTY_REPORT = {
  scannedObjects: [], scannedRecords: 0, fields: [], nullRows: 0, filled: 0,
  skippedUndefinedOnEmpty: [], recomputedUndefinedOnEmpty: [], applied: false,
  truncated: false, unreadableObjects: [], failures: [],
};

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as any);
  vi.mocked(bootSchemaStack).mockResolvedValue({
    kernel: { getService: () => engine },
    dbLabel: 'file:test.db',
    shutdown: vi.fn(async () => {}),
  } as any);
  vi.mocked(backfillSummaryNulls).mockReset();
  vi.mocked(backfillSummaryNulls).mockResolvedValue(EMPTY_REPORT as any);
  // `emitJson` awaits the write's DRAIN callback (a `--json` payload must be
  // fully written before the process can exit), so the double has to invoke
  // it — a bare `() => true` hangs the command forever.
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, enc?: unknown, cb?: unknown) => {
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  stdout.mockRestore();
  log.mockRestore();
});

const optionsHandedToBackfill = () => {
  expect(vi.mocked(backfillSummaryNulls)).toHaveBeenCalledTimes(1);
  const options = vi.mocked(backfillSummaryNulls).mock.calls[0][2];
  expect(options).toBeDefined();
  return options!;
};

describe('os migrate summary-nulls', () => {
  it('is a dry run by default — --apply is opt-in (#2186)', () => {
    expect(MigrateSummaryNulls.flags.apply.default).toBe(false);
  });

  it('requires explicit confirmation to write — --yes is opt-in', () => {
    expect(MigrateSummaryNulls.flags.yes.default).toBe(false);
  });

  it('declares --recompute-undefined-on-empty as a repeatable object.field list, and shows it in --help', () => {
    const flag = MigrateSummaryNulls.flags['recompute-undefined-on-empty'];
    expect(flag.multiple).toBe(true);
    expect(flag.description).toContain('object.field');
    expect(flag.description).toMatch(/min\/max\/avg/);
    expect(flag.description).toContain('never computed');
    expect(MigrateSummaryNulls.examples).toEqual(
      expect.arrayContaining([expect.stringContaining('--recompute-undefined-on-empty customer.last_follow_up_at')]),
    );
  });

  it('hands every --recompute-undefined-on-empty entry to backfillSummaryNulls as recomputeUndefinedOnEmpty, in order (#15064)', async () => {
    await MigrateSummaryNulls.run([
      '--json',
      '--object', 'customer',
      '--recompute-undefined-on-empty', 'customer.last_follow_up_at',
      '--recompute-undefined-on-empty', 'customer.first_follow_up_at',
    ], { root: CLI_ROOT });

    expect(optionsHandedToBackfill()).toEqual({
      apply: false,
      objects: ['customer'],
      recomputeUndefinedOnEmpty: ['customer.last_follow_up_at', 'customer.first_follow_up_at'],
      maxRecordsPerObject: undefined,
    });
  }, RUN_TIMEOUT);

  it('without the flag the option is absent — the unscoped run the ruling keeps as it was', async () => {
    await MigrateSummaryNulls.run(['--json'], { root: CLI_ROOT });

    const options = optionsHandedToBackfill();
    expect(options.recomputeUndefinedOnEmpty).toBeUndefined();
    expect(options).toEqual({ apply: false, objects: undefined, recomputeUndefinedOnEmpty: undefined, maxRecordsPerObject: undefined });
  }, RUN_TIMEOUT);

  it('a refused scope entry (INVALID_FIELD) reaches the --json error envelope with its code AND its httpStatus, and the command exits 1', async () => {
    // The fixture mirrors what `resolveRecomputeScope` really stamps
    // (`packages/objectql/src/summary-backfill.ts`): BOTH status spellings,
    // same number. `status` is what the HTTP doors read; `httpStatus` is what a
    // consumer holding the thrown error reads, and it is the one
    // `errorCodeFields` forwards. Asserting `code` alone was the fossil of the
    // gap this pin now covers — the envelope carried no status at all.
    const refusal = Object.assign(new Error('[summary-backfill] recomputeUndefinedOnEmpty names 1 roll-up(s) this run cannot find: customer.nope.'), {
      code: 'INVALID_FIELD', status: 400, httpStatus: 400, field: 'customer.nope', fields: ['customer.nope'],
    });
    vi.mocked(backfillSummaryNulls).mockRejectedValue(refusal);

    const err = await MigrateSummaryNulls.run(
      ['--json', '--recompute-undefined-on-empty', 'customer.nope'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);

    expect(isExitSignal(err)).toBe(true);
    expect((err as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    const emitted = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    const payload = JSON.parse(emitted);
    expect(payload).toMatchObject({ code: 'INVALID_FIELD', httpStatus: 400 });
    expect(payload.error).toContain('customer.nope');
  }, RUN_TIMEOUT);
});

// ───────────────────────────────────────────────────────────────────────────
// The human face: what the dry run says about the database
// ───────────────────────────────────────────────────────────────────────────

const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };
const DRY_RUN_LINE = 'Dry run — no row or table was written. Re-run with --apply to backfill.';

/** A dry run that found one NULL roll-up, so the report closes with its dry-run line. */
const DRY_REPORT_WITH_NULLS = {
  ...EMPTY_REPORT,
  scannedObjects: ['customer'],
  scannedRecords: 1,
  fields: [{
    object: 'customer', field: 'open_count', fn: 'count', childObject: 'case',
    nullRows: 1, nonEmpty: 0, filled: 0, sampleRecordIds: ['c_1'],
  }],
  nullRows: 1,
};

describe('os migrate summary-nulls — the dry run names no write it cannot vouch for', () => {
  /** Boot onto a primary driver with `config`; every report line the run printed. */
  async function runDry(config: Record<string, unknown>): Promise<string[]> {
    vi.mocked(bootSchemaStack).mockResolvedValue({
      // The primary datasource's driver, as `SchemaStack.driver` carries it.
      driver: { config },
      kernel: { getService: () => engine },
      dbLabel: 'test database',
      shutdown: vi.fn(async () => {}),
    } as any);
    vi.mocked(backfillSummaryNulls).mockResolvedValue(DRY_REPORT_WITH_NULLS as any);
    await MigrateSummaryNulls.run([], { root: CLI_ROOT });
    return log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n').split('\n');
  }

  it('on a SQLite file the dry-run line claims no row or table and names the journal-mode switch', async () => {
    const lines = await runDry(SQLITE_CONFIG);
    const dryRun = lines.find((line) => line.startsWith('Dry run —'));
    expect(dryRun, lines.join('\n')).toBe(`${DRY_RUN_LINE} ${JOURNAL_MODE_SWITCH_NOTE}`);
    expect(lines.join('\n')).not.toContain('nothing was written');
  }, RUN_TIMEOUT);

  it('on a target with no file header (PostgreSQL) the dry-run line claims no row or table and names no switch', async () => {
    const lines = await runDry(POSTGRES_CONFIG);
    const dryRun = lines.find((line) => line.startsWith('Dry run —'));
    expect(dryRun, lines.join('\n')).toBe(DRY_RUN_LINE);
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, RUN_TIMEOUT);
});

// ───────────────────────────────────────────────────────────────────────────
// The human face: what a refused --recompute-undefined-on-empty name says
// ───────────────────────────────────────────────────────────────────────────

describe('os migrate summary-nulls — a refused scope names no write it cannot vouch for', () => {
  /** The engine's own refusal of `customer.nope`, from the real `backfillSummaryNulls`. */
  async function realRefusal(): Promise<Error & { code: string }> {
    const real = await vi.importActual<typeof import('@objectstack/objectql')>('@objectstack/objectql');
    const quiet = { info: () => {}, warn: () => {} };
    return real.backfillSummaryNulls(engine as any, quiet, { recomputeUndefinedOnEmpty: ['customer.nope'] })
      .then(() => { throw new Error('expected the scope to be refused'); }, (e: unknown) => e as Error & { code: string });
  }

  /** Boot onto a primary driver with `config`, in either mode; every line the run printed, colour stripped. */
  async function runRefused(config: Record<string, unknown>, argv: string[]): Promise<{ lines: string[]; message: string }> {
    const refusal = await realRefusal();
    expect(refusal.code).toBe('INVALID_FIELD');
    vi.mocked(bootSchemaStack).mockResolvedValue({
      driver: { config },
      kernel: { getService: () => engine },
      dbLabel: 'test database',
      shutdown: vi.fn(async () => {}),
    } as any);
    vi.mocked(backfillSummaryNulls).mockRejectedValue(refusal);
    const err = await MigrateSummaryNulls.run(
      [...argv, '--recompute-undefined-on-empty', 'customer.nope'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);
    expect((err as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    const lines = log.mock.calls
      .map((c: unknown[]) => stripVTControlCharacters(c.map(String).join(' ')))
      .join('\n')
      .split('\n');
    return { lines, message: refusal.message };
  }

  for (const [mode, argv] of [['dry run', []], ['--apply', ['--apply', '--yes']]] as const) {
    it(`${mode}: on a SQLite file the refusal vouches for the walk and is followed by the journal-mode note`, async () => {
      const { lines, message } = await runRefused(SQLITE_CONFIG, [...argv]);
      expect(message).toMatch(/ Refused before the walk read or wrote any row\.$/);
      const refused = lines.filter((line) => line.includes('this run cannot find'));
      expect(refused, lines.join('\n')).toEqual([`  ✗ ${message} ${JOURNAL_MODE_SWITCH_NOTE}`]);
      expect(lines.join('\n')).not.toContain('nothing was written');
    }, RUN_TIMEOUT);

    it(`${mode}: on a target with no file header (PostgreSQL) the refusal names no switch`, async () => {
      const { lines, message } = await runRefused(POSTGRES_CONFIG, [...argv]);
      const refused = lines.filter((line) => line.includes('this run cannot find'));
      expect(refused, lines.join('\n')).toEqual([`  ✗ ${message}`]);
      expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
    }, RUN_TIMEOUT);
  }

  it('--json: the envelope carries the engine\'s message as it is, with no journal-mode note, on a SQLite file', async () => {
    const refusal = await realRefusal();
    vi.mocked(bootSchemaStack).mockResolvedValue({
      driver: { config: SQLITE_CONFIG },
      kernel: { getService: () => engine },
      dbLabel: 'test database',
      shutdown: vi.fn(async () => {}),
    } as any);
    vi.mocked(backfillSummaryNulls).mockRejectedValue(refusal);
    await MigrateSummaryNulls.run(
      ['--json', '--recompute-undefined-on-empty', 'customer.nope'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);
    const payload = JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
    expect(payload).toMatchObject({ code: 'INVALID_FIELD', httpStatus: 400, error: refusal.message });
  }, RUN_TIMEOUT);
});
