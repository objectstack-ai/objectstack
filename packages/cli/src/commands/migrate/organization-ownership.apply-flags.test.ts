// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` asks about the backup before it
 * opens the database (ADR-0131 D10 ceremony item 2): without `--backup-taken`
 * a non-interactive run is refused, and the boot never happens. The flag means
 * nothing without `--apply`, and is refused there too. Before the backup
 * question, `--apply` requires the plan file the operator reviewed
 * (`--plan-file`), readable as a plan; the digest comparison itself is pinned
 * in `organization-ownership-apply.test.ts`.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn(async () => {
  throw new Error('the database was opened');
}));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The occupancy gate is the siblings' stub: these cases are about the flags,
// never about whatever database the package's own directory resolves to. The
// gate itself is pinned in `organization-ownership.occupancy.integration.test.ts`.
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_STOP_HINT: 'occupancy hint',
  probeMigrationTarget: vi.fn(async () => ({ status: 'free' })),
}));

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the 5 s default (CASE_TIMEOUT_MS).
beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const PLAN_DIR = mkdtempSync(join(tmpdir(), 'os-c7b-plan-file-'));
/** A plan file as a plan run writes it (the fields the apply reads). */
const PLAN_FILE = join(PLAN_DIR, 'plan.json');
writeFileSync(PLAN_FILE, JSON.stringify({
  kind: 'organization-ownership-plan',
  ceremony: 'ADR-0131 D10',
  generatedAt: '2026-10-14T00:00:00Z',
  database: 'fixture.db',
  inventoryDigest: 'f'.repeat(64),
  posture: 'single',
}));
const NOT_A_PLAN = join(PLAN_DIR, 'report.json');
writeFileSync(NOT_A_PLAN, JSON.stringify({ kind: 'organization-ownership-apply' }));

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
  boot.mockClear();
});

describe('os migrate organization-ownership --apply — the reviewed plan file', () => {
  it('refuses --apply without --plan-file, before the backup question and the boot', async () => {
    const { payload, exitCode } = await runJson(['--apply', '--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'plan-file-required' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('refuses a --plan-file that is not a plan, naming it, before the boot', async () => {
    const { payload, exitCode } = await runJson(['--apply', '--plan-file', NOT_A_PLAN, '--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'plan-file-unusable', file: NOT_A_PLAN });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('refuses a --plan-file that does not exist, before the boot', async () => {
    const missing = join(PLAN_DIR, 'missing.json');
    const { payload } = await runJson(['--apply', '--plan-file', missing, '--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'plan-file-unusable', file: missing });
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('refuses --plan-file without --apply, before the boot', async () => {
    const { payload, exitCode } = await runJson(['--plan-file', PLAN_FILE, '--json']);
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'flag-without-apply' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);
});

describe('os migrate organization-ownership --apply — the backup precondition', () => {
  it('refuses a non-interactive --apply without --backup-taken, before the boot', async () => {
    const { payload, exitCode } = await runJson(['--apply', '--plan-file', PLAN_FILE, '--json']);
    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'backup-unacknowledged' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('refuses --backup-taken without --apply, before the boot', async () => {
    const { payload, exitCode } = await runJson(['--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'plan_refused', reason: 'flag-without-apply' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
  }, CASE_TIMEOUT_MS);

  it('with --backup-taken, goes on to the boot', async () => {
    const { payload } = await runJson(['--apply', '--plan-file', PLAN_FILE, '--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'boot_failed', reason: 'boot-failed' });
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]).toEqual([expect.objectContaining({ deferSchemaDdl: true, composeHostStack: true })]);
  }, CASE_TIMEOUT_MS);
});
