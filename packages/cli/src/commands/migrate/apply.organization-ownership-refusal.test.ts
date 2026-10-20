// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D10 item 5] What `os migrate apply --allow-destructive` tells the
 * operator when it holds back an `organization_id` drop the organization-ownership
 * ceremony owns.
 *
 * The ceremony is the way on (18.x step 6 opened it), so the human face names
 * its steps — the plan, then the reviewed apply with the backup acknowledged —
 * as the boot refusal does (`organizationOwnershipRefusalMessage`,
 * `@objectstack/runtime`), and names no release line to stay on. The `--json`
 * `detail` names the ceremony and states the marker it read.
 *
 * ## What is real here
 *
 * The command's own parse, its drift handling and the gate run for real. The
 * boot, the occupancy probe, the process exit and the ceremony's marker read
 * are replaced: the subject is the text the gate hands the operator, for each
 * marker state it can read, and a control proves the harness reaches the
 * writes once the marker is verified. The real command on a v17-shape SQLite
 * table is `apply-organization-ownership-gate.integration.test.ts`.
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
  readOrganizationOwnershipMarker: vi.fn(),
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
vi.mock('../../utils/organization-ownership-drop-gate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOrganizationOwnershipMarker: mocks.readOrganizationOwnershipMarker,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/**
 * The drift a v17-shape table offers: a physical `organization_id` on a table
 * whose v18 object declares none.
 */
const ORGANIZATION_DROP = {
  category: 'destructive',
  table: 'sys_platform_setting',
  column: 'organization_id',
  op: { type: 'drop_column', column: 'organization_id' },
  description: 'sys_platform_setting.organization_id: column exists in the database but not in metadata (orphaned)',
};

/** A step of `os migrate organization-ownership`, which 18.0 refuses on every database. */
/** The ceremony's two steps, as the refusal prescribes them. */
const CEREMONY_STEPS = [
  'os migrate organization-ownership --out PLAN',
  'os migrate organization-ownership --apply --plan-file PLAN --backup-taken',
];

const UNVERIFIED = { id: 'adr-0131-organization-ownership', last_run_at: '2026-10-01T00:00:00.000Z', verified_at: null, blocking: 2 };
const VERIFIED = { ...UNVERIFIED, verified_at: '2026-10-01T00:00:00.000Z', blocking: 0 };

let flushSchemaDdl: ReturnType<typeof vi.fn>;
let applyMigrationEntries: ReturnType<typeof vi.fn>;

function bootWithOrganizationDrop(): void {
  flushSchemaDdl = vi.fn(async () => []);
  applyMigrationEntries = vi.fn(async () => ({ applied: [ORGANIZATION_DROP], skipped: [] }));
  mocks.bootSchemaStack.mockResolvedValue({
    driver: {},
    drivers: [],
    dbLabel: 'file:v17.db',
    dbSource: { kind: 'flag' },
    telemetryDatabase: null,
    composition: { plugins: [], hostConfigPath: null, hostConfigLoaded: false, hostConfigError: null, notes: [] },
    detectManagedDrift: async () => [ORGANIZATION_DROP],
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
  mocks.readOrganizationOwnershipMarker.mockReset();
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
 * Run the command; answer the status it ends the process with, the JSON
 * document it emitted, and the refusal line the human face printed.
 */
async function runApply(argv: string[]) {
  const err = await MigrateApply.run(argv, { root: CLI_ROOT }).then(() => null, (e: unknown) => e);
  if (err !== null && !isExitSignal(err)) throw err;
  const exit = err !== null
    ? (err as { oclif?: { exit?: number } }).oclif?.exit
    : mocks.exitOneShotCommand.mock.calls.at(-1)?.[0];
  const out = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join('').trim();
  const refusal = log.mock.calls.map((c: unknown[]) => c.map(String).join(' ')).find((line: string) => line.includes('Refusing this --allow-destructive run'));
  return { exit, payload: out ? JSON.parse(out) : null, refusal };
}

const ARGV = ['--database-url', 'file:v17.db', '--allow-destructive', '--yes'];

describe('os migrate apply --allow-destructive: the organization-ownership refusal names no command 18.0 refuses', () => {
  for (const [state, flag] of [['no ceremony run recorded', null], ['an unverified run recorded', UNVERIFIED]] as const) {
    it(`${state}: the human face refuses, exit 1, naming the ceremony's steps, and nothing is written`, async () => {
      bootWithOrganizationDrop();
      mocks.readOrganizationOwnershipMarker.mockResolvedValue({ verified: false, flag });

      const { exit, refusal } = await runApply(ARGV);

      expect(exit).toBe(1);
      expect(refusal, 'the gate printed its refusal').toBeDefined();
      expect(refusal).toContain('sys_platform_setting');
      for (const step of CEREMONY_STEPS) expect(refusal).toContain(step);
      expect(refusal).not.toMatch(/17\.x|18\.0 supports/);
      if (flag) expect(refusal).toContain('2 blocking');
      expect(flushSchemaDdl).not.toHaveBeenCalled();
      expect(applyMigrationEntries).not.toHaveBeenCalled();
    }, RUN_TIMEOUT);

    it(`${state}: under --json the refusal's detail names the ceremony and the marker it read`, async () => {
      bootWithOrganizationDrop();
      mocks.readOrganizationOwnershipMarker.mockResolvedValue({ verified: false, flag });

      const { exit, payload } = await runApply([...ARGV, '--json']);

      expect(exit).toBe(1);
      expect(payload).toMatchObject({
        message: 'refused_organization_ownership_unmigrated',
        tables: ['sys_platform_setting'],
        applied: [],
        created: [],
        marker: flag,
      });
      expect(payload.detail).toMatch(/organization-ownership ceremony/);
      expect(applyMigrationEntries).not.toHaveBeenCalled();
    }, RUN_TIMEOUT);
  }
});

describe('control', () => {
  it('a verified marker lets the drop through and exits 0, so the harness can tell a refusal from a run', async () => {
    bootWithOrganizationDrop();
    mocks.readOrganizationOwnershipMarker.mockResolvedValue({ verified: true, flag: VERIFIED });

    const { exit, payload } = await runApply([...ARGV, '--json']);

    expect(exit).toBe(0);
    expect(applyMigrationEntries).toHaveBeenCalledTimes(1);
    expect(payload.applied).toEqual([ORGANIZATION_DROP]);
  }, RUN_TIMEOUT);
});
