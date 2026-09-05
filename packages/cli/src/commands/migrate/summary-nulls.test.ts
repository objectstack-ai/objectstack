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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateSummaryNulls from './summary-nulls.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { isExitSignal } from '../../utils/format.js';
import { backfillSummaryNulls } from '@objectstack/objectql';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
vi.mock('@objectstack/objectql', () => ({
  backfillSummaryNulls: vi.fn(),
  formatSummaryBackfillReport: vi.fn(() => []),
}));

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

  it('a refused scope entry (FIELD_NOT_FOUND) reaches the --json error envelope with its code, and the command exits 1', async () => {
    const refusal = Object.assign(new Error('[summary-backfill] recomputeUndefinedOnEmpty names 1 roll-up(s) this run cannot find: customer.nope.'), {
      code: 'FIELD_NOT_FOUND', status: 404, fields: ['customer.nope'],
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
    expect(payload).toMatchObject({ code: 'FIELD_NOT_FOUND' });
    expect(payload.error).toContain('customer.nope');
  }, RUN_TIMEOUT);
});
