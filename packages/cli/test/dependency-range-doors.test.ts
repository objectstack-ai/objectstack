// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns the real producer once per single-cause fixture: five spawns of the source CLI, each a distinct (command, fixture) pair (`os validate --json` and `os build --json` over the unreadable-range artifact, `os validate --json` and `os lint --json` over the unmet-range artifact, `os validate --json` over the met-range control); slowest CI reading 27.6 s (run 41199450735, over the five scheduled ci.yml runs 41199450735 to 41271604267) x 1.25, rounded up

/**
 * ADR-0141 D2, author side — `os validate`, `os build` and `os lint` report
 * `manifest.dependencies` ranges on an ADR-0130 artifact, run for real.
 *
 * Each fixture is a two-package `composeStacks(…, { manifest: 'preserve' })`
 * project, so the ranges live in `packages[]` bodies and nowhere at the top
 * level: a door that judged the top-level manifest alone would pass all three.
 * The predicate's own cases live in `src/utils/dependency-range-check.test.ts`;
 * this file pins what the shell sees — the exit status and the `--json` record.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/**
 * Spawned by this process's own `node`, not through the `tsx` binary: the entry, its
 * `src/` and its pinned `NODE_ENV=development` are the same either way, and the
 * `.bin/tsx` launcher only adds a second node process in front of the CLI, about half
 * of every spawn's wall (#23181).
 */
const CLI = resolve(HERE, '../bin/run-dev.js');

const pkg = (id: string, type: 'app' | 'module', version: string, dependencies?: Record<string, string>) => ({
  manifest: {
    id,
    name: id,
    namespace: 'crm',
    version,
    type,
    engines: { protocol: '^18' },
    ...(dependencies ? { dependencies } : {}),
  },
});

const FIXTURES = {
  /** A range outside the grammar on an entry the artifact does not deliver: every install refuses it. */
  unreadable: [
    pkg('com.acme.core', 'app', '1.0.0'),
    pkg('com.acme.orders', 'module', '1.0.0', { 'com.acme.core': '^1.0.0', 'com.vendor.billing': 'latest' }),
  ],
  /** Core bumped to 2.0.0 while the module still declares ^1.0.0: the install admits it. */
  mismatch: [
    pkg('com.acme.core', 'app', '2.0.0'),
    pkg('com.acme.orders', 'module', '1.0.0', { 'com.acme.core': '^1.0.0' }),
  ],
  /** The same artifact with the range met. */
  control: [
    pkg('com.acme.core', 'app', '1.4.0'),
    pkg('com.acme.orders', 'module', '1.0.0', { 'com.acme.core': '^1.0.0' }),
  ],
} as const;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface Diagnostic {
  code?: string;
  severity?: string;
  path?: string;
  rule?: string;
}

const dependencyCodes = (list: unknown): Array<[string | undefined, string | undefined]> =>
  ((list ?? []) as Diagnostic[])
    .filter((d) => typeof d.code === 'string' && d.code.startsWith('dependency-'))
    .map((d) => [d.code, d.path]);

const dirs = new Map<keyof typeof FIXTURES, string>();

beforeAll(() => {
  for (const [kind, packages] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, readonly unknown[]]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-dependency-range-door-${kind}-`));
    const stacks = packages.map((p) => `defineStack(${JSON.stringify(p)})`).join(',\n  ');
    writeFileSync(
      join(dir, 'objectstack.config.ts'),
      "import { composeStacks, defineStack } from '@objectstack/spec';\n\n"
        + `export default composeStacks([\n  ${stacks},\n], { manifest: 'preserve' });\n`,
    );
    linkSpec(dir);
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

const UNREADABLE_AT = 'packages[1].manifest.dependencies["com.vendor.billing"]';
const MISMATCH_AT = 'packages[1].manifest.dependencies["com.acme.core"]';

describe('an unreadable out-of-artifact range is refused at build', () => {
  it('os validate: exit 1, the entry in `errors`', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('unreadable')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const out = JSON.parse(run.stdout) as { valid?: boolean; errors?: unknown };
    expect(out.valid).toBe(false);
    expect(dependencyCodes(out.errors)).toEqual([['dependency-range-unreadable', UNREADABLE_AT]]);
  }, 180_000);

  it('os build: exit 1, the same entry in `errors`', async () => {
    const run = await runCli(['build', '--json'], dirs.get('unreadable')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const out = JSON.parse(run.stdout) as { success?: boolean; errors?: unknown };
    expect(out.success).toBe(false);
    expect(dependencyCodes(out.errors)).toEqual([['dependency-range-unreadable', UNREADABLE_AT]]);
  }, 180_000);
});

describe('an in-artifact range the sibling version does not meet is reported, never refused', () => {
  it('os validate: exit 0, the mismatch in `warnings`', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('mismatch')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    const out = JSON.parse(run.stdout) as { valid?: boolean; warnings?: unknown };
    expect(out.valid).toBe(true);
    expect(dependencyCodes(out.warnings)).toEqual([['dependency-range-unmet-in-artifact', MISMATCH_AT]]);
  }, 180_000);

  it('os lint: a warning-severity issue at the entry', async () => {
    const run = await runCli(['lint', '--json'], dirs.get('mismatch')!);
    const out = JSON.parse(run.stdout) as { issues?: Diagnostic[] };
    const found = (out.issues ?? []).filter((i) => i.rule?.startsWith('dependencies/'));
    expect(found.map((i) => [i.rule, i.severity, i.path])).toEqual([
      ['dependencies/dependency-range-unmet-in-artifact', 'warning', MISMATCH_AT],
    ]);
  }, 180_000);

  it('CONTROL: os validate on the same artifact with the range met reports no dependency finding', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('control')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect(dependencyCodes((JSON.parse(run.stdout) as { warnings?: unknown }).warnings)).toEqual([]);
  }, 180_000);
});
