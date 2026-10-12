// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate meta --stored` — who a rewritten row records (#23068).
 *
 * The command calls `migrateStoredMetadata`, whose `actor` becomes
 * `PutOptions.actor`: it lands in `sys_metadata_history.recorded_by` and in the
 * rewritten row's `updated_by`, both `lookup('sys_user')` columns. That is the
 * acting user's id or nothing (#4556). This command has no user to name — it
 * opens the deployment's database directly, with no session — so it passes no
 * actor, and the rows record `null`, the "system-initiated" spelling. The pass
 * names itself on `source: 'migrate-stored'`; the command's name is never an
 * actor (it used to be: `'os migrate meta --stored'` landed in both columns as
 * a reference to no user).
 *
 * The boot is replaced, so no database is opened; the command's own parse and
 * control flow run for real, up to and including the protocol call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MigrateMeta from './meta.js';

const boot = vi.hoisted(() => vi.fn());
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));
vi.mock('../../utils/data-migration-plugins.js', () => ({ buildDataMigrationPlugins: vi.fn(async () => []) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
/** oclif builds its whole command table on the first `run()` in a process. */
const RUN_TIMEOUT = 60_000;

/** A clean report: the command exits 0 and never calls `this.exit()`. */
const CLEAN_REPORT = {
  apply: true,
  protocol: '17.0.0',
  scanned: 1,
  canonical: 0,
  pending: 0,
  rewritten: 1,
  skipped: 0,
  failed: 0,
  rows: [],
  decisionModeReview: [],
};

const migrateStoredMetadata = vi.fn();
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  migrateStoredMetadata.mockReset();
  migrateStoredMetadata.mockImplementation(async (req: { apply?: boolean }) => ({
    ...CLEAN_REPORT,
    apply: req.apply === true,
    rewritten: req.apply === true ? 1 : 0,
    canonical: req.apply === true ? 0 : 1,
  }));
  boot.mockReset();
  boot.mockResolvedValue({
    kernel: { getService: (name: string) => (name === 'protocol' ? { migrateStoredMetadata } : undefined) },
    dbLabel: 'file:test.db',
    tableAbsent: () => false,
    shutdown: vi.fn(async () => {}),
  });
  // `emitJson` awaits the write's DRAIN callback, so the double invokes it.
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, enc?: unknown, cb?: unknown) => {
    const done = typeof enc === 'function' ? enc : cb;
    if (typeof done === 'function') done();
    return true;
  }) as typeof process.stdout.write);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  log.mockRestore();
});

describe('os migrate meta --stored — the rewrite records nobody, never the command (#23068)', () => {
  it('--apply hands the pass no actor, so recorded_by and updated_by store null', async () => {
    await MigrateMeta.run(['--stored', '--apply', '--yes', '--json'], { root: CLI_ROOT });

    expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
    const request = migrateStoredMetadata.mock.calls[0][0];
    expect(request.apply).toBe(true);
    expect(request).not.toHaveProperty('actor');
  }, RUN_TIMEOUT);

  it('the preview hands it no actor either', async () => {
    await MigrateMeta.run(['--stored', '--json'], { root: CLI_ROOT });

    expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
    const request = migrateStoredMetadata.mock.calls[0][0];
    expect(request.apply).toBe(false);
    expect(request).not.toHaveProperty('actor');
  }, RUN_TIMEOUT);
});
