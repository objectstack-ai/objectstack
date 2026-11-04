// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate recompute-home-amounts` command shape (ADR-0144 D5, D7
 * parameter 1, Open item 8).
 *
 * The recompute itself is proven in `@objectstack/objectql`'s
 * `engine-home-amount-projection.test.ts` (in memory) and in
 * `packages/qa/dogfood/test/home-amount-projection.test.ts` (SQLite and
 * PostgreSQL). What is pinned here is what those cannot see: the command is a
 * dry run by default, its flags reach `recomputeHomeAmounts` as given, a
 * malformed `--since` is refused before the probe, the prompt and the boot,
 * the boot carries the settings service and the audit ledger, a listed and
 * skipped row keeps the exit code at 1 on a dry run as on an apply run, and a
 * refusal reaches the `--json` envelope with its code. The seams that would
 * boot a database or walk a real engine are replaced; the command's own parse
 * and control flow run for real, and the report's formatter is the real one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateRecomputeHomeAmounts from './recompute-home-amounts.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { isExitSignal } from '../../utils/format.js';
import { recomputeHomeAmounts } from '@objectstack/objectql';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
vi.mock('@objectstack/objectql', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/objectql')>();
  return {
    recomputeHomeAmounts: vi.fn(),
    // The `--since` check is the recompute's own, called by the command before its probe.
    assertHomeAmountRecomputeSince: real.assertHomeAmountRecomputeSince,
    formatHomeAmountRecomputeReport: real.formatHomeAmountRecomputeReport,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

const engine = {
  getObject: () => ({ fields: {} }),
  find: async () => [],
  update: async (data: Record<string, unknown>, options?: Record<string, unknown>) => {
    assertEngineUpdateDispatch(data, options);
    return {};
  },
  insert: async () => ({}),
  homeAmountReadsFor: () => ({}),
  getConfigs: () => ({ invoice: {}, sys_user: {} }),
};

const zero = { rate_missing: 0, code_blank: 0, document_date_blank: 0, home_currency_unset: 0, unconvertible: 0 };
const report = (over: Record<string, unknown> = {}) => ({
  object: 'invoice',
  fields: [{ field: 'amount', codeField: 'currency_code', homeField: 'amount_home', rateField: 'amount_rate', rateDateField: 'invoice_date' }],
  since: null, applied: false, scannedRecords: 2, amounts: 2, unchanged: 1, changed: 1, written: 0, outsideSince: 0,
  skippedTotal: 0, skippedByReason: { ...zero },
  organizations: [{ organizationId: 'org_a', homeCurrency: 'CNY', amounts: 2, unchanged: 1, changed: 1, written: 0, skipped: { ...zero }, outsideSince: 0 }],
  changes: [{ recordId: 'i1', organizationId: 'org_a', field: 'amount', from: { home: 71994.24, rate: 0.1389 }, to: { home: 80000, rate: 0.125 } }],
  changesTruncated: false, skipped: [], skippedTruncated: false, failures: [], truncated: false,
  audit: { written: false, reason: 'dry_run' },
  ...over,
});
const SKIPPED = {
  skippedTotal: 1,
  skippedByReason: { ...zero, code_blank: 1 },
  skipped: [{ recordId: 'i2', organizationId: 'org_a', field: 'amount', reason: 'code_blank' }],
};

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(probeMigrationTarget).mockReset();
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as any);
  vi.mocked(bootSchemaStack).mockReset();
  vi.mocked(bootSchemaStack).mockResolvedValue({
    kernel: { getService: () => engine },
    dbLabel: 'test database',
    shutdown: vi.fn(async () => {}),
  } as any);
  vi.mocked(buildDataMigrationPlugins).mockClear();
  vi.mocked(recomputeHomeAmounts).mockReset();
  vi.mocked(recomputeHomeAmounts).mockResolvedValue(report() as any);
  // `emitJson` awaits the write's drain callback, so the double invokes it.
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

const json = () => JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
const exitOf = (err: unknown) => (err as { oclif?: { exit?: number } } | undefined)?.oclif?.exit;
const printed = () => log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n');

describe('os migrate recompute-home-amounts', () => {
  it('is a dry run by default, --yes is opt-in, and only --object is required', () => {
    expect(MigrateRecomputeHomeAmounts.flags.apply.default).toBe(false);
    expect(MigrateRecomputeHomeAmounts.flags.yes.default).toBe(false);
    expect(MigrateRecomputeHomeAmounts.flags.object.required).toBe(true);
    expect(MigrateRecomputeHomeAmounts.flags.field.required).toBeFalsy();
    expect(MigrateRecomputeHomeAmounts.flags.since.required).toBeFalsy();
  });

  it('hands the flags to recomputeHomeAmounts as given, and boots the settings service and the audit ledger', async () => {
    await MigrateRecomputeHomeAmounts.run(
      ['--json', '--object', 'invoice', '--field', 'amount', '--since', '2026-01-01'],
      { root: CLI_ROOT },
    );
    expect(vi.mocked(recomputeHomeAmounts).mock.calls[0]![2]).toEqual({
      object: 'invoice', field: 'amount', since: '2026-01-01', apply: false, maxRecords: undefined,
      source: 'os migrate recompute-home-amounts',
    });
    expect(vi.mocked(buildDataMigrationPlugins)).toHaveBeenCalledWith({ settings: true, audit: true });
    expect(vi.mocked(bootSchemaStack).mock.calls[0]![0]).toMatchObject({ deferSchemaDdl: true, readOnlyProbe: true });
    expect(json()).toMatchObject({ apply: false, report: { changed: 1, written: 0 } });
  }, RUN_TIMEOUT);

  it('--apply --yes writes, on the plain boot', async () => {
    await MigrateRecomputeHomeAmounts.run(['--json', '--apply', '--yes', '--object', 'invoice'], { root: CLI_ROOT });
    expect(vi.mocked(recomputeHomeAmounts).mock.calls[0]![2]).toMatchObject({ apply: true });
    expect(vi.mocked(bootSchemaStack).mock.calls[0]![0]).not.toHaveProperty('deferSchemaDdl');
  }, RUN_TIMEOUT);

  it('a malformed --since is refused VALIDATION_FAILED / 400 before the probe, the prompt and the boot', async () => {
    const err = await MigrateRecomputeHomeAmounts.run(
      ['--json', '--apply', '--object', 'invoice', '--since', '2026-02-30'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);
    expect(exitOf(err)).toBe(1);
    expect(json()).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    expect(json().error).toContain("since '2026-02-30' is not a calendar date");
    expect(vi.mocked(probeMigrationTarget)).not.toHaveBeenCalled();
    expect(vi.mocked(bootSchemaStack)).not.toHaveBeenCalled();
    expect(vi.mocked(recomputeHomeAmounts)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('an object the deployment does not declare is refused before the recompute is called', async () => {
    const err = await MigrateRecomputeHomeAmounts.run(['--json', '--object', 'nope'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitOf(err)).toBe(1);
    expect(vi.mocked(recomputeHomeAmounts)).not.toHaveBeenCalled();
    // The shared refusal's envelope carries the code alone (its key set is pinned in
    // object-scope.integration.test.ts); the exit code is asserted above.
    expect(json()).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  }, RUN_TIMEOUT);

  it('a listed and skipped row keeps the exit code at 1, on a dry run and on an apply run (Open item 8)', async () => {
    vi.mocked(recomputeHomeAmounts).mockResolvedValue(report(SKIPPED) as any);
    const dry = await MigrateRecomputeHomeAmounts.run(['--object', 'invoice'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(isExitSignal(dry)).toBe(true);
    expect(exitOf(dry)).toBe(1);
    expect(printed()).toContain('os migrate record-currency-codes --object invoice');
    vi.mocked(recomputeHomeAmounts).mockResolvedValue(report({ ...SKIPPED, applied: true, audit: { written: true } }) as any);
    const applied = await MigrateRecomputeHomeAmounts.run(['--json', '--apply', '--yes', '--object', 'invoice'], { root: CLI_ROOT })
      .catch((e: unknown) => e);
    expect(exitOf(applied)).toBe(1);
    expect(json()).toMatchObject({ report: { skippedTotal: 1 } });
  }, RUN_TIMEOUT);

  it('a walk --max-records cut short exits 1: rows past the bound were not looked at', async () => {
    vi.mocked(recomputeHomeAmounts).mockResolvedValue(report({ truncated: true }) as any);
    const dry = await MigrateRecomputeHomeAmounts.run(['--object', 'invoice', '--max-records', '2'], { root: CLI_ROOT })
      .catch((e: unknown) => e);
    expect(exitOf(dry)).toBe(1);
    expect(printed()).toContain('--max-records');
    expect(vi.mocked(recomputeHomeAmounts).mock.calls[0]![2]).toMatchObject({ maxRecords: 2 });
    vi.mocked(recomputeHomeAmounts).mockResolvedValue(report({ truncated: true, applied: true, written: 1 }) as any);
    const applied = await MigrateRecomputeHomeAmounts.run(['--json', '--apply', '--yes', '--object', 'invoice'], { root: CLI_ROOT })
      .catch((e: unknown) => e);
    expect(exitOf(applied)).toBe(1);
    expect(json()).toMatchObject({ report: { truncated: true } });
  }, RUN_TIMEOUT);

  it('a run with nothing skipped exits 0', async () => {
    await expect(MigrateRecomputeHomeAmounts.run(['--object', 'invoice'], { root: CLI_ROOT })).resolves.toBeUndefined();
    expect(printed()).toContain('i1 amount: 71994.24 @ 0.1389 → 80000 @ 0.125');
  }, RUN_TIMEOUT);

  it('a refusal from the recompute reaches the --json envelope with its code and httpStatus', async () => {
    const real = await vi.importActual<typeof import('@objectstack/objectql')>('@objectstack/objectql');
    const refusal = await real.recomputeHomeAmounts(engine as never, { info() {}, warn() {} }, { object: 'invoice' })
      .then(() => { throw new Error('expected the object to be refused'); }, (e: unknown) => e as Error);
    vi.mocked(recomputeHomeAmounts).mockRejectedValue(refusal);
    const err = await MigrateRecomputeHomeAmounts.run(['--json', '--object', 'invoice'], { root: CLI_ROOT }).catch((e: unknown) => e);
    expect(exitOf(err)).toBe(1);
    expect(json()).toMatchObject({ code: 'INVALID_FIELD', httpStatus: 400, error: refusal.message });
  }, RUN_TIMEOUT);
});
