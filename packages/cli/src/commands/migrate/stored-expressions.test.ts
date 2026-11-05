// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate stored-expressions` command shape (#29961).
 *
 * The backfill itself is proven in `@objectstack/objectql`'s
 * `stored-expression-backfill.test.ts`. What is pinned here is what a unit
 * test of the walk cannot see: the command is a dry run by default, every
 * flag reaches `backfillStoredExpressions` as its option, `--field` needs
 * `--object`, a run that leaves a row skipped or unwritten exits 1, and the
 * human face closes a dry run with the report's own line. The seams that
 * would boot a database are replaced; the command's own parse and control
 * flow, and the report's formatter, run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import MigrateStoredExpressions from './stored-expressions.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { isExitSignal } from '../../utils/format.js';
import { backfillStoredExpressions } from '@objectstack/objectql';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
// The walk is replaced; the formatter is the real one.
vi.mock('@objectstack/objectql', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/objectql')>();
  return {
    backfillStoredExpressions: vi.fn(),
    formatStoredExpressionBackfillReport: real.formatStoredExpressionBackfillReport,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/** The engine surface the command checks before it runs, and one loaded app object. */
const engine = {
  computeStoredExpressionsOver: async () => [],
  getConfigs: () => ({ contract: {}, sys_user: {} }),
};

const EMPTY_REPORT = {
  scannedObjects: [], scannedRecords: 0, fields: [], nullRows: 0, staleRows: 0, faultedRows: 0,
  skippedRows: 0, writtenRows: 0, changed: false, applied: false, truncated: false,
  unreadableObjects: [], faults: [], faultsTruncated: false, failures: [],
};

/** A dry run that found the hotclm shape: one field NULL on every row. */
const DRY_REPORT_WITH_HOLES = {
  ...EMPTY_REPORT,
  scannedObjects: ['contract'],
  scannedRecords: 2,
  fields: [{ object: 'contract', field: 'review_sla_days_offset', nullRows: 2, staleRows: 0, faultedRows: 0, written: 0, sampleRecordIds: ['c1', 'c2'] }],
  nullRows: 2,
};

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as any);
  vi.mocked(bootSchemaStack).mockResolvedValue({
    kernel: { getService: () => engine },
    dbLabel: 'postgres://db.example.com/app',
    driver: { config: { client: 'pg' } },
    shutdown: vi.fn(async () => {}),
  } as any);
  vi.mocked(backfillStoredExpressions).mockReset();
  vi.mocked(backfillStoredExpressions).mockResolvedValue(EMPTY_REPORT as any);
  // `emitJson` awaits the write's DRAIN callback, so the double has to invoke it.
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
  expect(vi.mocked(backfillStoredExpressions)).toHaveBeenCalledTimes(1);
  return vi.mocked(backfillStoredExpressions).mock.calls[0][2]!;
};
const exitCodeOf = (err: unknown) => (isExitSignal(err) ? (err as { oclif?: { exit?: number } }).oclif?.exit : undefined);

describe('os migrate stored-expressions', () => {
  it('is a dry run by default, and writing needs --yes', () => {
    expect(MigrateStoredExpressions.flags.apply.default).toBe(false);
    expect(MigrateStoredExpressions.flags.yes.default).toBe(false);
    expect(MigrateStoredExpressions.flags.changed.default).toBe(false);
  });

  it('a bare run walks every object, NULL holes only, without writing', async () => {
    await MigrateStoredExpressions.run(['--json'], { root: CLI_ROOT });
    expect(optionsHandedToBackfill()).toEqual({
      apply: false, objects: undefined, field: undefined, changed: false, maxRecordsPerObject: undefined,
    });
  }, RUN_TIMEOUT);

  it('hands --object, --field, --changed, --max-records and --apply --yes through', async () => {
    await MigrateStoredExpressions.run(
      ['--json', '--object', 'contract', '--field', 'review_sla_days_offset', '--changed', '--max-records', '50', '--apply', '--yes'],
      { root: CLI_ROOT },
    );
    expect(optionsHandedToBackfill()).toEqual({
      apply: true, objects: ['contract'], field: 'review_sla_days_offset', changed: true, maxRecordsPerObject: 50,
    });
  }, RUN_TIMEOUT);

  it('refuses --field without --object at parse time', async () => {
    const err = await MigrateStoredExpressions.run(['--json', '--field', 'x'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(String((err as Error)?.message)).toMatch(/--object/);
    expect(vi.mocked(backfillStoredExpressions)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('--apply without --yes in a non-interactive run writes nothing and exits 1', async () => {
    const err = await MigrateStoredExpressions.run(['--json', '--apply'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitCodeOf(err)).toBe(1);
    expect(vi.mocked(bootSchemaStack)).not.toHaveBeenCalled();
    expect(vi.mocked(backfillStoredExpressions)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('an object the deployment does not declare is refused before the walk', async () => {
    const err = await MigrateStoredExpressions.run(['--json', '--object', 'nope'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitCodeOf(err)).toBe(1);
    expect(vi.mocked(backfillStoredExpressions)).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
    expect(payload).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  }, RUN_TIMEOUT);

  it.each([
    ['a row skipped because a faulting field holds a value', { skippedRows: 1 }],
    ['a row the write refused', { failures: [{ object: 'contract', recordId: 'c1', error: 'refused' }] }],
    ['a walk --max-records cut short', { truncated: true }],
  ])('exits 1 on %s', async (_label, extra) => {
    vi.mocked(backfillStoredExpressions).mockResolvedValue({ ...EMPTY_REPORT, ...extra } as any);
    const err = await MigrateStoredExpressions.run(['--json'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitCodeOf(err)).toBe(1);
  }, RUN_TIMEOUT);

  it('a dry run that finds holes exits 0 and closes with the report\'s dry-run line', async () => {
    vi.mocked(backfillStoredExpressions).mockResolvedValue(DRY_REPORT_WITH_HOLES as any);
    await MigrateStoredExpressions.run([], { root: CLI_ROOT });
    const printed = log.mock.calls.map((c: unknown[]) => stripVTControlCharacters(String(c[0]))).join('\n');
    expect(printed).toContain('contract.review_sla_days_offset — 2 NULL row(s)');
    expect(printed).toContain('Dry run — no row or table was written. Re-run with --apply to write.');
  }, RUN_TIMEOUT);
});
