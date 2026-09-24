// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19894] `os migrate files-to-references` when the active driver REFUSES to
 * plan the ADR-0104 column step, the way the Turso REMOTE face does
 * (`NOT_IMPLEMENTED` / 501).
 *
 * ## The two wrong answers this replaces
 *
 * Before the driver refused, the remote face answered the planner with an
 * empty scan, and the command mapped that to `nothing_to_move`: "this
 * datastore declares no single-value media column", on a database whose media
 * columns were present. A driver refusal alone would have swapped that for a
 * second wrong report. The planner is called only after the backfill and its
 * self-check passed, and on an `--apply` run the deployment flag is already
 * recorded by then. A throw from the planner reached the command's outer
 * `catch`, which printed the refusal and exited 1 with no backfill report, no
 * verify report and no word about the flag it had just written. Measured on
 * this suite's own doubles before the command change: `--apply --yes --json`
 * emitted one line, `{"error": …, "code": "NOT_IMPLEMENTED"}`, and exit 1.
 *
 * ## What is pinned
 *
 * 1. A planner refusal is a stated, non-failing column-step outcome, which is
 *    the contract `runColumnStep` already keeps for a driver that cannot plan:
 *    the full backfill / verify / flag report is emitted, the refusal rides
 *    beside it as `columnMoveRefused` (the command's own error-envelope shape),
 *    nothing is stamped, and the exit code is the gate's.
 * 2. The text face says the step was not judged, carries the driver's reason,
 *    and never says "nothing to move".
 * 3. Controls: a genuinely empty scan still reads "nothing to move", and a
 *    throw that is NOT a capability refusal still fails the command through
 *    the outer `catch`, as before.
 *
 * The seams that would boot a database or walk a real engine are replaced;
 * the command's own parse and control flow run for real. The refusal fixture
 * is the driver's envelope shape, `code` + `status`; the driver-side pin is
 * `turso-remote-media-column-move-refusal.test.ts` in `@objectstack/driver-turso`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateFilesToReferences from './files-to-references.js';
import { isExitSignal } from '../../utils/format.js';

// ⛔ `vi.hoisted`, never a value import of `bootSchemaStack`: this suite boots
// nothing, and a value import of that symbol is what files a test in the
// integration tier (`vitest-tiers.ts`).
const mocks = vi.hoisted(() => ({
  bootSchemaStack: vi.fn(),
  runFilesToReferencesMigration: vi.fn(),
}));

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: mocks.bootSchemaStack }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));
vi.mock('@objectstack/service-storage', () => ({
  runFilesToReferencesMigration: mocks.runFilesToReferencesMigration,
  formatBackfillReport: () => 'BACKFILL-REPORT',
  formatFileReferenceReport: () => 'VERIFY-REPORT',
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/** The driver's refusal: the ADR-0112 envelope the Turso remote face throws. */
const REFUSAL_MESSAGE = 'Planning the media column move is not supported by this transport.';
const refusal = () => Object.assign(new Error(REFUSAL_MESSAGE), { code: 'NOT_IMPLEMENTED', status: 501 });

/** The flag row an `--apply` run has already recorded when the column step starts. */
const FLAG = { migrationId: 'adr-0104-file-references', passed: true };

const result = (apply: boolean) => ({
  backfill: {
    scannedObjects: ['product'], scannedRecords: 2, converted: 1, alreadyReferences: 1,
    externalUrls: 0, unresolvable: 0, truncated: false, actions: [],
  },
  verify: {
    scannedObjects: ['product'], scannedRecords: 2, heldReferences: 2, ownedFiles: 2,
    counts: {}, blocking: 0, ok: true, truncated: false, issues: [],
  },
  gatePassed: true,
  gateFailures: [],
  flag: apply ? FLAG : null,
});

/** The engine surface the command checks before it runs: `sys_file`, and one app object. */
const engine = {
  getObject: (name: string) => (name === 'sys_file' ? {} : undefined),
  getConfigs: () => ({ product: {}, sys_file: {} }),
};

function bootWith(planMediaColumnMove: () => Promise<unknown>) {
  mocks.bootSchemaStack.mockResolvedValue({
    driver: {
      detectManagedDrift: async () => [],
      applyMigrationEntries: async () => ({ applied: [], skipped: [] }),
      planMediaColumnMove: vi.fn(planMediaColumnMove),
    },
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : {}) },
    dbLabel: 'libsql://media.turso.io',
    shutdown: vi.fn(async () => {}),
  });
}

let stdout: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mocks.bootSchemaStack.mockReset();
  mocks.runFilesToReferencesMigration.mockReset();
  mocks.runFilesToReferencesMigration.mockImplementation(async (_e: unknown, _s: unknown, _l: unknown, o: { apply: boolean }) => result(o.apply));
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
});

/** Run the command; answer its exit code (0 when `run` resolved) and what it emitted. */
async function runCommand(argv: string[]) {
  const err = await MigrateFilesToReferences.run(argv, { root: CLI_ROOT }).then(() => null, (e: unknown) => e);
  if (err !== null && !isExitSignal(err)) throw err;
  const exit = err === null ? 0 : (err as { oclif?: { exit?: number } }).oclif?.exit;
  const json: string = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join('');
  const lines: string[] = log.mock.calls.map((c: unknown[]) => c.map(String).join(' '));
  return { exit, json, lines };
}

describe('a planner refusal is a stated column-step outcome, never a failed run (#19894)', () => {
  it('--apply --yes --json: the full report, the flag already recorded, the refusal beside it, exit 0', async () => {
    bootWith(async () => { throw refusal(); });

    const { exit, json } = await runCommand(['--apply', '--yes', '--json']);

    expect(exit).toBe(0);
    const payload = JSON.parse(json);
    // The durable half of the run is reported: the flag this run wrote.
    expect(payload.gatePassed).toBe(true);
    expect(payload.flag).toEqual(FLAG);
    expect(payload.backfill.converted).toBe(1);
    expect(payload.verify.blocking).toBe(0);
    // The column step: nothing planned, nothing stamped, and why.
    expect(payload.columnMove).toBeNull();
    expect(payload.columnsMovedAt).toBeNull();
    expect(payload.columnMoveRefused).toEqual({ error: REFUSAL_MESSAGE, code: 'NOT_IMPLEMENTED' });
  }, RUN_TIMEOUT);

  it('dry run --json: the same shape, no flag, exit 0', async () => {
    bootWith(async () => { throw refusal(); });

    const { exit, json } = await runCommand(['--json']);

    expect(exit).toBe(0);
    const payload = JSON.parse(json);
    expect(payload.apply).toBe(false);
    expect(payload.flag).toBeNull();
    expect(payload.columnMove).toBeNull();
    expect(payload.columnsMovedAt).toBeNull();
    expect(payload.columnMoveRefused).toEqual({ error: REFUSAL_MESSAGE, code: 'NOT_IMPLEMENTED' });
  }, RUN_TIMEOUT);

  it('text face: both reports, the flag line, and a column step that says it was not judged', async () => {
    bootWith(async () => { throw refusal(); });

    const { exit, lines } = await runCommand(['--apply', '--yes']);

    expect(exit).toBe(0);
    expect(lines).toContain('BACKFILL-REPORT');
    expect(lines).toContain('VERIFY-REPORT');
    expect(lines.some((l) => l.includes('deployment flag recorded'))).toBe(true);
    const step = lines.filter((l) => l.includes('Column step'));
    expect(step).toHaveLength(1);
    expect(step[0]).toContain('NOT_IMPLEMENTED');
    expect(step[0]).toContain(REFUSAL_MESSAGE);
    expect(lines.some((l) => l.includes('nothing to move'))).toBe(false);
  }, RUN_TIMEOUT);
});

describe('controls — what the refusal branch must not absorb', () => {
  it('a genuinely empty scan still reads "nothing to move", with no refusal field set', async () => {
    bootWith(async () => ({ dialect: 'sqlite', plans: [], refusals: [] }));

    const text = await runCommand(['--apply', '--yes']);
    expect(text.exit).toBe(0);
    expect(text.lines.some((l) => l.includes('Column step: nothing to move'))).toBe(true);

    stdout.mockClear();
    const { exit, json } = await runCommand(['--apply', '--yes', '--json']);
    expect(exit).toBe(0);
    const payload = JSON.parse(json);
    expect(payload.columnMove).toBeNull();
    expect(payload.columnMoveRefused).toBeNull();
  }, RUN_TIMEOUT);

  it('a throw that is not a capability refusal still fails the command through the outer catch', async () => {
    bootWith(async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); });

    const { exit, json } = await runCommand(['--apply', '--yes', '--json']);

    expect(exit).toBe(1);
    expect(JSON.parse(json)).toEqual({ error: 'connection reset', code: 'ECONNRESET' });
  }, RUN_TIMEOUT);
});
