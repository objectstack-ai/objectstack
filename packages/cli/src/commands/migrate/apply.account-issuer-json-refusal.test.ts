// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23281] `os migrate apply --json` exits 1 when the `sys_account.issuer`
 * retirement pre-flight refuses the drop, as its human face does.
 *
 * ## The defect this pins closed
 *
 * Both `--json` refusals of the pre-flight emitted their document with exit
 * code 0 and returned: `refused_account_issuer_collisions` and
 * `refused_account_issuer_preflight_unreadable`. The human face exits 1 on the
 * same input. Measured at the public door before the change, on SQLite
 * databases holding the legacy `sys_account` shape (the `issuer` column and
 * the issuer-scoped unique key), with an auth secret so the drop is planned:
 * two rows sharing `(provider_id, account_id)` answered
 * `refused_account_issuer_collisions` with exit 0 under `--json` and exit 1
 * without it; 200 001 rows, past the probe's 200 000-row cap, answered
 * `refused_account_issuer_preflight_unreadable` with exit 0 and exit 1 the
 * same way. A caller gating on the status read a refused apply as a
 * successful one. The `sys_comment.reactions` sibling refusal beside them
 * exits 1, and the three now agree.
 *
 * ## What is real here
 *
 * The command's own parse, its drift handling and its refusal branches run
 * for real. The boot, the occupancy probe, the process exit and the pre-flight
 * probe are replaced: the subject is the exit status the command hands the
 * process for each refusal, and a control proves the harness reaches the
 * writes when the pre-flight is clean.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateApply from './apply.js';
import { isExitSignal } from '../../utils/format.js';

// ⛔ `vi.hoisted`, never a value import of `bootSchemaStack`: this suite boots
// nothing, and a value import of that symbol files a test in the integration
// tier (`vitest-tiers.ts`).
const mocks = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  exitOneShotCommand: vi.fn(async (_code: number) => {}),
  probeAccountIdentityCollisions: vi.fn(),
}));

vi.mock('../../utils/schema-migrate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootSchemaStack: mocks.bootSchemaStack,
}));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));
vi.mock('../../utils/one-shot-exit.js', () => ({ exitOneShotCommand: mocks.exitOneShotCommand }));
vi.mock('@objectstack/plugin-auth', () => ({
  probeAccountIdentityCollisions: mocks.probeAccountIdentityCollisions,
  formatAccountIdentityPreflightReport: () => 'PREFLIGHT-REPORT',
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/** The one drift entry the pre-flight guards: the retired column's drop. */
const ISSUER_DROP = {
  category: 'destructive',
  table: 'sys_account',
  column: 'issuer',
  op: { type: 'drop_column', column: 'issuer' },
  description: 'sys_account.issuer: column exists in the database but not in metadata (orphaned)',
};

const COLLISIONS = {
  ok: false,
  scanned: 2,
  keys: 1,
  crossUser: 1,
  collisions: [{ providerId: 'oidc', accountId: 'sub_1', rows: 2 }],
};

let flushSchemaDdl: ReturnType<typeof vi.fn>;
let applyMigrationEntries: ReturnType<typeof vi.fn>;

function bootWithIssuerDrop(): void {
  flushSchemaDdl = vi.fn(async () => []);
  applyMigrationEntries = vi.fn(async () => ({ applied: [ISSUER_DROP], skipped: [] }));
  mocks.bootSchemaStack.mockResolvedValue({
    driver: {},
    drivers: [],
    dbLabel: 'file:issuer.db',
    dbSource: { kind: 'flag' },
    telemetryDatabase: null,
    composition: { plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null, notes: [] },
    detectManagedDrift: async () => [ISSUER_DROP],
    // [#23925] The SchemaStack member the listing reads: this driver declares no apply limit.
    driftApplyLimit: () => null,
    pendingSchemaWork: [],
    kernel: { getService: () => ({}) },
    flushSchemaDdl,
    applyMigrationEntries,
    shutdown: vi.fn(async () => {}),
  });
}

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let savedExitCode: typeof process.exitCode;
beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  mocks.bootSchemaStack.mockReset();
  mocks.exitOneShotCommand.mockClear();
  mocks.probeAccountIdentityCollisions.mockReset();
  // `emitJson` awaits the write's DRAIN callback, so the double must invoke it.
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, enc?: unknown, cb?: unknown) => {
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  stdout.mockRestore();
  log.mockRestore();
  stderr.mockRestore();
  process.exitCode = savedExitCode;
});

/**
 * Run the command; answer the status it ends the process with — oclif's exit
 * signal on the human face, the code handed to `exitOneShotCommand` on a
 * completed run — and the JSON document it emitted.
 */
async function runApply(argv: string[]) {
  const err = await MigrateApply.run(argv, { root: CLI_ROOT }).then(() => null, (e: unknown) => e);
  if (err !== null && !isExitSignal(err)) throw err;
  const exit = err !== null
    ? (err as { oclif?: { exit?: number } }).oclif?.exit
    : mocks.exitOneShotCommand.mock.calls.at(-1)?.[0];
  const out = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join('').trim();
  return { exit, payload: out ? JSON.parse(out) : null };
}

const ARGV = ['--database-url', 'file:issuer.db', '--allow-destructive', '--yes'];

describe('the sys_account.issuer pre-flight refusals exit 1 under --json (#23281)', () => {
  it('refused_account_issuer_collisions: exit 1, and nothing is written', async () => {
    bootWithIssuerDrop();
    mocks.probeAccountIdentityCollisions.mockResolvedValue(COLLISIONS);

    const { exit, payload } = await runApply([...ARGV, '--json']);

    expect(exit).toBe(1);
    expect(payload).toMatchObject({ message: 'refused_account_issuer_collisions', preflight: COLLISIONS, applied: [], created: [] });
    expect(flushSchemaDdl).not.toHaveBeenCalled();
    expect(applyMigrationEntries).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('refused_account_issuer_preflight_unreadable: exit 1, the probe\'s reason as `detail`, and nothing is written', async () => {
    bootWithIssuerDrop();
    mocks.probeAccountIdentityCollisions.mockRejectedValue(
      new Error('Scan of sys_account stopped at 200000 row(s) without reaching the end of the table'),
    );

    const { exit, payload } = await runApply([...ARGV, '--json']);

    expect(exit).toBe(1);
    expect(payload).toMatchObject({
      message: 'refused_account_issuer_preflight_unreadable',
      detail: 'Scan of sys_account stopped at 200000 row(s) without reaching the end of the table',
      applied: [],
      created: [],
    });
    expect(flushSchemaDdl).not.toHaveBeenCalled();
    expect(applyMigrationEntries).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);
});

describe('controls', () => {
  it('the human face of the same refusal exits 1, as it always did', async () => {
    bootWithIssuerDrop();
    mocks.probeAccountIdentityCollisions.mockResolvedValue(COLLISIONS);

    const { exit } = await runApply(ARGV);

    expect(exit).toBe(1);
    // Refused by the pre-flight, not by anything earlier on the human face.
    expect(mocks.probeAccountIdentityCollisions).toHaveBeenCalledTimes(1);
    expect(applyMigrationEntries).not.toHaveBeenCalled();
  }, RUN_TIMEOUT);

  it('a clean pre-flight reaches the writes and exits 0, so the harness can tell a refusal from a run', async () => {
    bootWithIssuerDrop();
    mocks.probeAccountIdentityCollisions.mockResolvedValue({ ok: true, scanned: 1, keys: 1, crossUser: 0, collisions: [] });

    const { exit, payload } = await runApply([...ARGV, '--json']);

    expect(exit).toBe(0);
    expect(applyMigrationEntries).toHaveBeenCalledTimes(1);
    expect(payload.applied).toEqual([ISSUER_DROP]);
  }, RUN_TIMEOUT);
});
