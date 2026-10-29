// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate record-currency-codes` command shape (ADR-0144, ruling
 * 6492000994).
 *
 * The backfill itself is proven in `@objectstack/objectql`'s
 * `record-currency-backfill.test.ts`. What is pinned here is what a unit test
 * of the backfill cannot see: the command is dry-run-by-default, its three
 * naming flags are required, they reach `backfillRecordCurrencyCodes` as given,
 * a refusal reaches the `--json` envelope with its code, and the human face's
 * dry-run line is followed by the journal-mode note on a SQLite target only.
 * The seams that would boot a database or walk a real engine are replaced; the
 * command's own parse and control flow run for real, and the report's formatter
 * and the refusal are the real ones.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateRecordCurrencyCodes from './record-currency-codes.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { isExitSignal } from '../../utils/format.js';
import { JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { backfillRecordCurrencyCodes } from '@objectstack/objectql';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
vi.mock('@objectstack/objectql', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/objectql')>();
  return {
    backfillRecordCurrencyCodes: vi.fn(),
    formatRecordCurrencyBackfillReport: real.formatRecordCurrencyBackfillReport,
  };
});

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

const engine = {
  getObject: () => ({ fields: {} }),
  find: async () => [],
  update: async () => ({}),
  getConfigs: () => ({ opportunity: {}, sys_user: {} }),
};

const REPORT = {
  object: 'opportunity', field: 'amount', codeField: 'currency_code', code: 'USD',
  scannedRecords: 3, codeless: 2, written: 0, skippedCodePresent: 1, skippedAmountBlank: 0,
  sampleRecordIds: ['o1', 'o2'], applied: false, truncated: false, failures: [],
};
const NAMING = ['--object', 'opportunity', '--field', 'amount', '--code', 'USD'];
const SQLITE_CONFIG = { client: 'better-sqlite3', connection: { filename: '/srv/app/.objectstack/data/objectstack.db' } };
const POSTGRES_CONFIG = { client: 'pg', connection: 'postgres://db.example.com:5432/app' };
const DRY_RUN_LINE = 'Dry run — no row or table was written. Re-run with --apply to backfill.';

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
const boot = (config?: Record<string, unknown>) => vi.mocked(bootSchemaStack).mockResolvedValue({
  ...(config ? { driver: { config } } : {}),
  kernel: { getService: () => engine },
  dbLabel: 'test database',
  shutdown: vi.fn(async () => {}),
} as any);
beforeEach(() => {
  vi.mocked(probeMigrationTarget).mockResolvedValue({ status: 'free' } as any);
  boot();
  vi.mocked(backfillRecordCurrencyCodes).mockReset();
  vi.mocked(backfillRecordCurrencyCodes).mockResolvedValue(REPORT as any);
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

const printedLines = (): string[] => log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).join('\n').split('\n');

describe('os migrate record-currency-codes', () => {
  it('is a dry run by default, and --yes is opt-in', () => {
    expect(MigrateRecordCurrencyCodes.flags.apply.default).toBe(false);
    expect(MigrateRecordCurrencyCodes.flags.yes.default).toBe(false);
  });

  it('requires --object, --field and --code: the code is the operator\'s, never derived', () => {
    expect(MigrateRecordCurrencyCodes.flags.object.required).toBe(true);
    expect(MigrateRecordCurrencyCodes.flags.field.required).toBe(true);
    expect(MigrateRecordCurrencyCodes.flags.code.required).toBe(true);
  });

  it('refuses to run without --code', async () => {
    const err = await MigrateRecordCurrencyCodes.run(['--object', 'opportunity', '--field', 'amount'], { root: CLI_ROOT })
      .catch((e: unknown) => e);
    expect(String((err as Error)?.message)).toMatch(/code/);
    expect(vi.mocked(backfillRecordCurrencyCodes)).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('hands the three names to backfillRecordCurrencyCodes as given, dry run by default', async () => {
    await MigrateRecordCurrencyCodes.run(['--json', ...NAMING], { root: CLI_ROOT });
    expect(vi.mocked(backfillRecordCurrencyCodes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backfillRecordCurrencyCodes).mock.calls[0][2]).toEqual({
      object: 'opportunity', field: 'amount', code: 'USD', apply: false, maxRecords: undefined,
    });
    const payload = JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
    expect(payload).toMatchObject({ apply: false, report: { codeless: 2, written: 0 } });
  }, RUN_TIMEOUT);

  it('--apply --yes writes', async () => {
    await MigrateRecordCurrencyCodes.run(['--json', '--apply', '--yes', ...NAMING], { root: CLI_ROOT });
    expect(vi.mocked(backfillRecordCurrencyCodes).mock.calls[0][2]).toMatchObject({ apply: true });
  }, RUN_TIMEOUT);

  it('an object the deployment does not declare is refused before the backfill is called', async () => {
    const err = await MigrateRecordCurrencyCodes.run(
      ['--json', '--object', 'nope', '--field', 'amount', '--code', 'USD'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);
    expect((err as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    expect(vi.mocked(backfillRecordCurrencyCodes)).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
    expect(payload).toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  }, RUN_TIMEOUT);

  it('a refused code reaches the --json envelope with its code and httpStatus, and exits 1', async () => {
    const real = await vi.importActual<typeof import('@objectstack/objectql')>('@objectstack/objectql');
    const recordEngine = {
      ...engine,
      getObject: () => ({
        fields: { amount: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } } },
      }),
    };
    const refusal = await real.backfillRecordCurrencyCodes(recordEngine, { info() {}, warn() {} }, {
      object: 'opportunity', field: 'amount', code: 'usd',
    }).then(() => { throw new Error('expected the code to be refused'); }, (e: unknown) => e as Error);
    vi.mocked(backfillRecordCurrencyCodes).mockRejectedValue(refusal);

    const err = await MigrateRecordCurrencyCodes.run(
      ['--json', '--object', 'opportunity', '--field', 'amount', '--code', 'usd'],
      { root: CLI_ROOT },
    ).catch((e: unknown) => e);
    expect(isExitSignal(err)).toBe(true);
    expect((err as { oclif?: { exit?: number } }).oclif?.exit).toBe(1);
    const payload = JSON.parse(stdout.mock.calls.map((c: unknown[]) => String(c[0])).join(''));
    expect(payload).toMatchObject({ code: 'INVALID_FIELD', httpStatus: 400, error: refusal.message });
  }, RUN_TIMEOUT);

  it('on a SQLite file the dry-run line claims no row or table and names the journal-mode switch', async () => {
    boot(SQLITE_CONFIG);
    await MigrateRecordCurrencyCodes.run(NAMING, { root: CLI_ROOT });
    const lines = printedLines();
    expect(lines).toContain('Would write USD into currency_code on 2 codeless row(s).');
    expect(lines.find((line) => line.startsWith('Dry run —'))).toBe(`${DRY_RUN_LINE} ${JOURNAL_MODE_SWITCH_NOTE}`);
  }, RUN_TIMEOUT);

  it('on PostgreSQL the dry-run line names no switch', async () => {
    boot(POSTGRES_CONFIG);
    await MigrateRecordCurrencyCodes.run(NAMING, { root: CLI_ROOT });
    const lines = printedLines();
    expect(lines.find((line) => line.startsWith('Dry run —'))).toBe(DRY_RUN_LINE);
    expect(lines.join('\n')).not.toContain(JOURNAL_MODE_SWITCH_NOTE);
  }, RUN_TIMEOUT);
});
