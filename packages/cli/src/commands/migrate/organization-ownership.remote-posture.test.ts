// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23816 — `os migrate organization-ownership` declares, at both of its boots,
 * that a datasource whose transport cannot defer DDL (the Turso REMOTE
 * transport) boots with schema sync skipped instead
 * (`deferredDdlUnsupported: 'skip-schema-sync'`), and the apply reads the
 * ledger's presence from the catalog when its boot measured no table absent.
 *
 * Pinned on the command's own boot call, with `bootSchemaStack` stubbed: the
 * posture itself is `schema-migrate.remote-posture.test.ts`'s, and the
 * end-to-end run on a real `sqld` is
 * `organization-ownership.remote-face.integration.test.ts` (opt-in, through
 * `OS_TEST_SQLD_BIN`). Without these two opt-ins the plan stops at its boot on
 * every hosted tenant again, and nothing else in CI would say so.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn(async (_opts: Record<string, unknown>): Promise<unknown> => {
  throw new Error('the database was opened');
}));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The occupancy gate is the siblings' stub (`organization-ownership.apply-flags.test.ts`).
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_STOP_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const PLAN_DIR = mkdtempSync(join(tmpdir(), 'os-23816-posture-'));
const PLAN_FILE = join(PLAN_DIR, 'plan.json');
writeFileSync(PLAN_FILE, JSON.stringify({
  kind: 'organization-ownership-plan',
  ceremony: 'ADR-0131 D10',
  generatedAt: '2026-10-16T00:00:00Z',
  database: 'libsql://tenant.example.turso.io',
  inventoryDigest: 'f'.repeat(64),
  posture: 'single',
}));

async function runJson(argv: string[]): Promise<{ payload: Record<string, unknown>; exitCode: unknown }> {
  const chunks: string[] = [];
  const savedExit = process.exitCode;
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  try {
    await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
  } catch (error) {
    if ((error as { oclif?: unknown }).oclif === undefined) throw error;
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  vi.restoreAllMocks();
  return { payload: JSON.parse(chunks.join('').trim()) as Record<string, unknown>, exitCode };
}

afterEach(() => {
  boot.mockReset();
  boot.mockImplementation(async () => {
    throw new Error('the database was opened');
  });
});

const POSTURE = { deferSchemaDdl: true, deferredDdlUnsupported: 'skip-schema-sync' };

describe('both ceremony boots declare the skip-schema-sync posture', () => {
  it('the plan boot: deferred, read-only, and skip-schema-sync where deferral is refused', async () => {
    await runJson(['--json', '--out', join(PLAN_DIR, 'never-written.json')]);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]![0]).toEqual(expect.objectContaining({ ...POSTURE, readOnlyProbe: true }));
  }, CASE_TIMEOUT_MS);

  it('the apply boot: deferred, the served composition, and skip-schema-sync where deferral is refused', async () => {
    await runJson(['--apply', '--plan-file', PLAN_FILE, '--backup-taken', '--json', '--out', join(PLAN_DIR, 'never-report.json')]);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]![0]).toEqual(expect.objectContaining({ ...POSTURE, composeHostStack: true }));
  }, CASE_TIMEOUT_MS);
});

describe('the apply reads the ledger from the catalog when its boot skipped schema sync', () => {
  /** A booted stack as `bootSchemaStack` answers it, over a raw-SQL seam that answers `catalogRows`. */
  function stackWith(schemaSync: 'skipped' | 'deferred', opts: { catalogRows: unknown[]; tableAbsent: boolean }) {
    const execute = vi.fn(async (sql: string) => (/pragma_table_info/.test(sql) ? opts.catalogRows : []));
    return {
      execute,
      stack: {
        schemaSync,
        driver: { name: 'com.objectstack.driver.turso', dialectName: 'sqlite', config: { client: 'better-sqlite3' }, execute },
        dbLabel: 'libsql://tenant.example.turso.io',
        tableAbsent: vi.fn(() => opts.tableAbsent),
        kernel: { getService: () => { throw new Error('no kernel in this pin'); } },
        composition: { securityPlugin: false },
        allObjects: () => [],
        shutdown: async () => {},
      },
    };
  }
  const apply = () => runJson(['--apply', '--plan-file', PLAN_FILE, '--backup-taken', '--json', '--out', join(PLAN_DIR, 'never-report.json')]);

  it('skipped, and the catalog has no sys_migration: refused ledger-absent, whatever tableAbsent says', async () => {
    const { stack, execute } = stackWith('skipped', { catalogRows: [], tableAbsent: false });
    boot.mockImplementation(async () => stack);
    const { payload } = await apply();
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'ledger-absent', table: 'sys_migration' });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('pragma_table_info'), ['sys_migration']);
    expect(stack.tableAbsent).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('skipped, and the catalog has sys_migration: not refused for the ledger', async () => {
    const { stack } = stackWith('skipped', { catalogRows: [{ column_name: 'id' }], tableAbsent: true });
    boot.mockImplementation(async () => stack);
    const { payload } = await apply();
    expect(payload.reason).not.toBe('ledger-absent');
  }, CASE_TIMEOUT_MS);

  it('the control: a deferred boot answers from tableAbsent, without a catalog read', async () => {
    const { stack, execute } = stackWith('deferred', { catalogRows: [{ column_name: 'id' }], tableAbsent: true });
    boot.mockImplementation(async () => stack);
    const { payload } = await apply();
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'ledger-absent' });
    expect(execute).not.toHaveBeenCalledWith(expect.stringContaining('pragma_table_info'), ['sys_migration']);
  }, CASE_TIMEOUT_MS);
});
