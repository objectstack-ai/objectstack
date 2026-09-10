// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os i18n check --strict --threshold` can gate an application package — driven
 * through the published command, not through the functions behind it.
 *
 * `i18n-platform-bucket.test.ts` pins the decision at the seam that makes it.
 * This file exists because the card is about a COMMAND: the two flags whose
 * entire purpose is CI gating exited 1 on an app whose own surface was fully
 * translated, and nothing short of running the command proves that they no
 * longer do. It also settles the one thing a unit test structurally cannot —
 * that `--include-platform` and `--no-include-platform` PARSE, and that the
 * absent flag is a third state rather than a `false`.
 *
 * Both fixtures translate their own surface completely. The variable is
 * ownership of the `metadataForms.*` baseline and nothing else:
 *
 *   app       ships no `metadataForms` bundle       → not its debt      → 100%
 *   platform  ships one (as platform-objects does)  → its own work      → gated
 *
 * ## Fixture placement
 *
 * The stack configs go under this package's git-ignored `tmp/`, for the reason
 * `i18n-extract-key-count.e2e` records: `bundle-require` writes its bundled
 * module next to the config, so Node resolves the bare `@objectstack/spec`
 * specifier from THAT directory, and only under `packages/cli/tmp/` does that
 * lookup reach this package's real `node_modules`. `afterAll` removes only this
 * suite's own `mkdtemp` directory — several suites share that root and run
 * concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
const CLI_PACKAGE_ROOT = resolve(HERE, '..');

/** An app that translates everything it owns and ships no platform bundle. */
const APP_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },",
  '  objects: [',
  "    { name: 'inquiry', label: 'Inquiry', fields: { name: { type: 'text', label: 'Name' } } },",
  '  ],',
  '  translations: [',
  "    { 'zh-CN': { objects: { inquiry: { label: '咨询', fields: { name: { label: '姓名' } } } } } },",
  '  ],',
  '});',
  '',
].join('\n');

/**
 * The same app, plus a `metadataForms` bundle — the shape
 * `packages/platform-objects/scripts/i18n-extract.config.ts` has. Deliberately
 * a partial baseline: shipping the family is the claim of ownership, finishing
 * it is the work the gate then asks for.
 */
const PLATFORM_CONFIG = [
  "import { defineStack } from '@objectstack/spec';",
  '',
  'export default defineStack({',
  "  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },",
  '  objects: [',
  "    { name: 'sys_user', label: 'User', fields: { name: { type: 'text', label: 'Name' } } },",
  '  ],',
  '  translations: [',
  "    { en: { metadataForms: { object: { label: 'Object' } } } },",
  "    { 'zh-CN': {",
  "        objects: { sys_user: { label: '用户', fields: { name: { label: '姓名' } } } },",
  "        metadataForms: { object: { label: '对象' } },",
  '    } },',
  '  ],',
  '});',
  '',
].join('\n');

let fixtureRoot: string;
let APP: string;
let PLATFORM: string;

beforeAll(() => {
  const sharedRoot = join(CLI_PACKAGE_ROOT, 'tmp');
  mkdirSync(sharedRoot, { recursive: true });
  fixtureRoot = mkdtempSync(join(sharedRoot, 'os-i18n-16681-'));
  APP = join(fixtureRoot, 'app.config.ts');
  PLATFORM = join(fixtureRoot, 'platform.config.ts');
  writeFileSync(APP, APP_CONFIG, 'utf8');
  writeFileSync(PLATFORM, PLATFORM_CONFIG, 'utf8');
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

interface Run {
  stdout: string;
  status: number | null;
}

function runCheck(args: readonly string[]): Run {
  const child = spawnSync(TSX, [CLI, 'i18n', 'check', ...args], {
    cwd: CLI_PACKAGE_ROOT,
    encoding: 'utf8',
    env: childEnv(),
    timeout: 180_000,
  });
  return { stdout: `${child.stdout ?? ''}${child.stderr ?? ''}`, status: child.status };
}

/** The one JSON document `--json` is contracted to print. */
function json(run: Run): any {
  const start = run.stdout.indexOf('{');
  if (start === -1) throw new Error(`no JSON in:\n${run.stdout}`);
  return JSON.parse(run.stdout.slice(start));
}

const zhCN = (report: any) => report.stats.find((s: any) => s.locale === 'zh-CN');

describe('os i18n check — an app package can gate on its own coverage (#16681)', () => {
  it('reports 100% and exits 0 under --strict --threshold=100', () => {
    const run = runCheck([APP, '--json', '--strict', '--threshold=100']);
    const report = json(run);
    expect(report.platformMetadataForms.mode).toBe('excluded');
    expect(report.platformMetadataForms.excludedKeys).toBeGreaterThan(0);
    expect(zhCN(report).coveragePercent).toBe(100);
    expect(report.thresholdViolations).toEqual([]);
    expect(run.status).toBe(0);
  }, 120_000);

  it('is the SAME invocation that failed before — the control is --include-platform', () => {
    // The firing control for the case above: identical argv plus the opt-in,
    // on the identical fixture. This is what the command did unconditionally,
    // and it must still be reachable — an app that wants to audit the baseline
    // asks for it, and gets exactly the old numbers back.
    const run = runCheck([APP, '--json', '--strict', '--threshold=100', '--include-platform']);
    const report = json(run);
    expect(report.platformMetadataForms).toEqual({ mode: 'included', excludedKeys: 0 });
    expect(zhCN(report).coveragePercent).toBeLessThan(100);
    expect(report.thresholdViolations.length).toBeGreaterThan(0);
    expect(run.status).toBe(1);
  }, 120_000);

  it('prints the hidden-bucket hint on the console face', () => {
    const run = runCheck([APP]);
    expect(run.stdout).toContain('platform built-ins:');
    expect(run.stdout).toContain('--include-platform');
  }, 120_000);

  it('⛔ still gates the package that SHIPS the baseline, with no flag at all', () => {
    // Triage's negative control, end to end. `--threshold=100` on a stack that
    // owns the baseline and has translated one key of it must FAIL.
    const run = runCheck([PLATFORM, '--json', '--strict', '--threshold=100']);
    const report = json(run);
    expect(report.platformMetadataForms).toEqual({ mode: 'included', excludedKeys: 0 });
    expect(report.issues.some((i: any) => i.source === 'metadataForm')).toBe(true);
    expect(run.status).toBe(1);
  }, 120_000);

  it('accepts --no-include-platform, so the third state really is three states', () => {
    // Proves the absent flag is not a parsed `false`: the same fixture answers
    // `included` with the flag absent and `excluded` with it negated.
    const negated = json(runCheck([PLATFORM, '--json', '--no-include-platform']));
    expect(negated.platformMetadataForms.mode).toBe('excluded');
    expect(negated.platformMetadataForms.excludedKeys).toBeGreaterThan(0);
    expect(negated.issues.some((i: any) => i.source === 'metadataForm')).toBe(false);
  }, 120_000);
});
