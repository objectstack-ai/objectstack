// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership --apply` reserves its report file before
 * it boots (#23826): an `--out` the run cannot write is refused before the
 * database is opened, naming the file and the OS code, with the pre-write
 * refusal's `apply_refused`. A writable one (or the default name) is created
 * before the boot and released again when the run has nothing to report.
 *
 * The boot is a stub that fails, so these cases never open a database: whether
 * the ceremony itself is kept from executing is pinned on a real database in
 * `organization-ownership.report-file.integration.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn(async (): Promise<never> => {
  throw new Error('the database was opened');
}));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
// The occupancy gate is the siblings' stub (see `organization-ownership.apply-flags.test.ts`).
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

const DIR = mkdtempSync(join(tmpdir(), 'os-ceremony-report-reservation-'));
/** A plan file as a plan run writes it (the fields the apply reads). */
const PLAN_FILE = join(DIR, 'plan.json');
writeFileSync(PLAN_FILE, JSON.stringify({
  kind: 'organization-ownership-plan',
  ceremony: 'ADR-0131 D10',
  generatedAt: '2026-10-14T00:00:00Z',
  database: 'fixture.db',
  inventoryDigest: 'f'.repeat(64),
  posture: 'single',
}));

const RESERVATION_KIND = 'organization-ownership-apply-reservation';
const DEFAULT_NAME = /^organization-ownership-apply-.+\.json$/;

async function runJson(argv: string[], cwd?: string): Promise<{ payload: Record<string, unknown>; exitCode: unknown }> {
  const chunks: string[] = [];
  const savedExit = process.exitCode;
  const savedCwd = process.cwd();
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  if (cwd) process.chdir(cwd);
  try {
    await MigrateOrganizationOwnership.run(argv, { root: CLI_ROOT });
  } catch (error) {
    if ((error as { oclif?: unknown }).oclif === undefined) throw error;
  } finally {
    process.chdir(savedCwd);
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  vi.restoreAllMocks();
  return { payload: JSON.parse(chunks.join('').trim()) as Record<string, unknown>, exitCode };
}

const applyArgs = (...extra: string[]): string[] => ['--apply', '--plan-file', PLAN_FILE, '--backup-taken', '--json', ...extra];

afterEach(() => {
  boot.mockClear();
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe('os migrate organization-ownership --apply — the report file is reserved before the boot', () => {
  it('refuses an --out that already exists, before the boot, naming it and EEXIST; the file is untouched', async () => {
    const out = join(DIR, 'kept-report.json');
    const kept = '{"kind":"organization-ownership-apply","kept":"an earlier run"}\n';
    writeFileSync(out, kept);

    const { payload, exitCode } = await runJson(applyArgs('--out', out));

    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'report-file-unwritable', file: out, code: 'EEXIST' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
    expect(readFileSync(out, 'utf8')).toBe(kept);
  }, CASE_TIMEOUT_MS);

  it('refuses an --out in a directory that does not exist, before the boot, naming ENOENT', async () => {
    const out = join(DIR, 'no-such-directory', 'apply.json');

    const { payload, exitCode } = await runJson(applyArgs('--out', out));

    expect(payload).toMatchObject({ error: 'apply_refused', reason: 'report-file-unwritable', file: out, code: 'ENOENT' });
    expect(exitCode).toBe(1);
    expect(boot).not.toHaveBeenCalled();
    expect(existsSync(join(DIR, 'no-such-directory'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('the control — a new --out is reserved before the boot, and released when the run has nothing to report', async () => {
    const out = join(DIR, 'new-report.json');
    let atBoot: unknown;
    boot.mockImplementationOnce(async () => {
      atBoot = JSON.parse(readFileSync(out, 'utf8'));
      throw new Error('the database was opened');
    });

    const { payload, exitCode } = await runJson(applyArgs('--out', out));

    expect(payload).toMatchObject({ error: 'boot_failed', reason: 'boot-failed' });
    expect(exitCode).toBe(1);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(atBoot).toMatchObject({ kind: RESERVATION_KIND });
    expect(existsSync(out)).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('without --out, reserves the default name in the current directory before the boot, and releases it', async () => {
    const cwd = mkdtempSync(join(DIR, 'cwd-'));
    let atBoot: unknown[] = [];
    boot.mockImplementationOnce(async () => {
      atBoot = readdirSync(cwd)
        .filter((name) => DEFAULT_NAME.test(name))
        .map((name) => JSON.parse(readFileSync(join(cwd, name), 'utf8')));
      throw new Error('the database was opened');
    });

    const { payload } = await runJson(applyArgs(), cwd);

    expect(payload).toMatchObject({ error: 'boot_failed' });
    expect(atBoot).toEqual([expect.objectContaining({ kind: RESERVATION_KIND })]);
    expect(readdirSync(cwd).filter((name) => DEFAULT_NAME.test(name))).toEqual([]);
  }, CASE_TIMEOUT_MS);
});
