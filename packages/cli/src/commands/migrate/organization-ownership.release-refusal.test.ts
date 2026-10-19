// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate organization-ownership` refuses in 18.0, plan and apply alike
 * (ruling record 6259608309 on the v18 epic, item 1). 18.0 supports fresh
 * installs only. Its ceremony is knowingly incomplete, and an incomplete
 * ceremony must never certify an old database.
 *
 * The refusal comes first, so it reads nothing. These cases set every input
 * the ceremony would judge before its boot to a value the ceremony refuses:
 * an unrecognised posture, a fate supplement that does not exist, a plan file
 * that does not exist. They also stub the occupancy probe and the boot so that
 * either one throws. Only the release refusal can answer.
 *
 * The ceremony itself (`OrganizationOwnershipCeremony`) is pinned by the
 * sibling `organization-ownership.*.test.ts` files, which run it directly.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const boot = vi.hoisted(() => vi.fn(async () => {
  throw new Error('the database was opened');
}));
const probe = vi.hoisted(() => vi.fn(async () => {
  throw new Error('the database was probed');
}));
vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: boot }));
vi.mock('../../utils/migrate-occupancy-gate.js', () => ({
  OCCUPANCY_STOP_HINT: 'occupancy hint',
  probeMigrationTarget: probe,
}));

type Module = typeof import('./organization-ownership.js');
let mod: Module;

// The command's module graph is large, and oclif reads the package's config on
// the first run: both are paid outside the 5 s default.
beforeAll(async () => {
  mod = await import('./organization-ownership.js');
}, 60_000);

const CASE_TIMEOUT_MS = 60_000;
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'os-ownership-release-refusal-'));
const DB_FILE = join(DIR, 'v17.db');
const OUT = join(DIR, 'out.json');
const MISSING_SUPPLEMENT = join(DIR, 'missing-supplement.json');
const MISSING_PLAN = join(DIR, 'missing-plan.json');

let savedPosture: string | undefined;
beforeEach(() => {
  savedPosture = process.env.OS_TENANCY_POSTURE;
  // The ceremony refuses an unrecognised posture before anything else; the release refusal never reads it.
  process.env.OS_TENANCY_POSTURE = 'not-a-posture';
});
afterEach(() => {
  if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = savedPosture;
  boot.mockClear();
  probe.mockClear();
  vi.restoreAllMocks();
});

async function run(argv: string[]): Promise<{ stdout: string; exitCode: unknown }> {
  const chunks: string[] = [];
  const savedExit = process.exitCode;
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    chunks.push(`${args.map(String).join(' ')}\n`);
  });
  let exitCode: unknown;
  try {
    await mod.default.run(argv, { root: CLI_ROOT });
    exitCode = process.exitCode;
  } catch (error) {
    const oclif = (error as { oclif?: { exit?: unknown } }).oclif;
    if (oclif === undefined) throw error;
    exitCode = oclif.exit;
  }
  process.exitCode = savedExit;
  vi.restoreAllMocks();
  return { stdout: chunks.join(''), exitCode };
}

function expectNothingTouched(): void {
  expect(boot).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
  expect(existsSync(DB_FILE), 'the database file was brought into existence').toBe(false);
  expect(existsSync(OUT), 'a plan or report file was written').toBe(false);
}

describe('os migrate organization-ownership — refused in 18.0', () => {
  it('the plan refuses with NOT_IMPLEMENTED, exit 1, reading and writing nothing', async () => {
    const { stdout, exitCode } = await run([
      '--database-url', `file:${DB_FILE}`, '--out', OUT, '--fate-supplement', MISSING_SUPPLEMENT, '--json',
    ]);
    expect(JSON.parse(stdout.trim())).toEqual({
      error: 'plan_refused',
      reason: 'upgrade-unavailable',
      code: 'NOT_IMPLEMENTED',
      detail: mod.ORGANIZATION_OWNERSHIP_UPGRADE_UNAVAILABLE,
    });
    expect(exitCode).toBe(1);
    expectNothingTouched();
  }, CASE_TIMEOUT_MS);

  it('the apply refuses with NOT_IMPLEMENTED, exit 1, reading and writing nothing', async () => {
    const { stdout, exitCode } = await run([
      '--apply', '--plan-file', MISSING_PLAN, '--backup-taken',
      '--database-url', `file:${DB_FILE}`, '--out', OUT, '--fate-supplement', MISSING_SUPPLEMENT, '--json',
    ]);
    expect(JSON.parse(stdout.trim())).toMatchObject({
      error: 'apply_refused',
      reason: 'upgrade-unavailable',
      code: 'NOT_IMPLEMENTED',
    });
    expect(exitCode).toBe(1);
    expectNothingTouched();
  }, CASE_TIMEOUT_MS);

  it('without --json it prints the refusal with its code and exits 1', async () => {
    const { stdout, exitCode } = await run(['--database-url', `file:${DB_FILE}`, '--out', OUT]);
    expect(stdout).toContain('✗');
    expect(stdout).toContain(mod.ORGANIZATION_OWNERSHIP_UPGRADE_UNAVAILABLE);
    expect(stdout).toContain('(NOT_IMPLEMENTED)');
    expect(exitCode).toBe(1);
    expectNothingTouched();
  }, CASE_TIMEOUT_MS);

  it('the refusal names the release that will carry the upgrade and what 18.0 supports', () => {
    expect(mod.ORGANIZATION_OWNERSHIP_UPGRADE_UNAVAILABLE).toMatch(/^os migrate organization-ownership is not available in 18\.0\./);
    expect(mod.ORGANIZATION_OWNERSHIP_UPGRADE_UNAVAILABLE).toContain('fresh installs only');
    expect(mod.ORGANIZATION_OWNERSHIP_UPGRADE_UNAVAILABLE).toContain('an 18.x release');
  });

  it('the registered command keeps the ceremony class whole underneath: same flags, its own run', () => {
    expect(Object.getPrototypeOf(mod.default)).toBe(mod.OrganizationOwnershipCeremony);
    expect(mod.default.flags).toBe(mod.OrganizationOwnershipCeremony.flags);
    expect(mod.default.prototype.run).not.toBe(mod.OrganizationOwnershipCeremony.prototype.run);
  });
});
