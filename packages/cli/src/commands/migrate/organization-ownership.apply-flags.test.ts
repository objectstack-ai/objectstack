// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` asks about the backup before it
 * opens the database (ADR-0131 D10 ceremony item 2): without `--backup-taken`
 * a non-interactive run is refused, and the boot never happens. The flag means
 * nothing without `--apply`, and is refused there too.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn(async () => {
  throw new Error('the database was opened');
}));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));

type Command = (typeof import('./organization-ownership.js'))['default'];
let MigrateOrganizationOwnership: Command;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the 5 s default (CASE_TIMEOUT_MS).
beforeAll(async () => {
  ({ default: MigrateOrganizationOwnership } = await import('./organization-ownership.js'));
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;

const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

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

describe('os migrate organization-ownership --apply — the backup precondition', () => {
  it('refuses a non-interactive --apply without --backup-taken, before the boot', async () => {
    const { payload, exitCode } = await runJson(['--apply', '--json']);
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
    const { payload } = await runJson(['--apply', '--backup-taken', '--json']);
    expect(payload).toMatchObject({ error: 'boot_failed', reason: 'boot-failed' });
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot.mock.calls[0]).toEqual([expect.objectContaining({ deferSchemaDdl: true, composeHostStack: true })]);
  }, CASE_TIMEOUT_MS);
});
