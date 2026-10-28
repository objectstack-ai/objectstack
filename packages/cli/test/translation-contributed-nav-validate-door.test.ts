// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` accepts a module stack whose translation bundle carries only
 * the navigation id it contributes into another package's app — no
 * `apps.APP.label` — run for real (#27086).
 *
 * The measured starting point (main 72629f38): the bundle
 * `{ 'zh-CN': { apps: { crm_enterprise: { navigation: { nav_case: … } } } } }`
 * failed with `translations.0.zh-CN.apps.crm_enterprise.label`, although
 * `translation-target-unknown` accepts exactly the contributed ids under an app
 * the stack only contributes into, and the runtime merge keeps the owner's
 * label. The exit status is what a CI pipeline reads, so this file spawns the
 * source CLI and asserts what the shell sees.
 *
 * Schema-layer and type pins live in
 * `packages/spec/src/system/translation-contributed-nav-bundle.test.ts`.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 * Two spawns, one per fixture. The CLI runs through `bin/run-dev.js` (source,
 * via tsx), and `@objectstack/spec` resolves through `exports` to `dist/`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** A service module contributing `nav_case` into an app another package owns. */
const stackOf = (navCase: Record<string, string>) => ({
  manifest: {
    id: 'com.example.svc',
    namespace: 'svc',
    name: 'Contributed navigation translation door probe',
    version: '1.0.0',
    type: 'module',
    engines: { protocol: '^18' },
    navigationContributions: [{
      app: 'crm_enterprise',
      items: [{ id: 'nav_case', type: 'object', objectName: 'svc_case', label: 'Cases' }],
    }],
  },
  objects: [
    {
      name: 'svc_case',
      label: 'Case',
      pluralLabel: 'Cases',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
  translations: [{ 'zh-CN': { apps: { crm_enterprise: { navigation: { nav_case: navCase } } } } }],
});

const FIXTURES = {
  /** The card's shape: the contributed id alone, no app label. */
  moduleOnly: { stack: stackOf({ label: '工单' }), strict: true },
  /** CONTROL: the navigation entry without its own label, judged by the door. */
  navLabelMissing: { stack: stackOf({}), strict: false },
} as const;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
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

interface ValidateError {
  path?: unknown[];
}

const dirs = new Map<keyof typeof FIXTURES, string>();

beforeAll(() => {
  for (const [kind, { stack, strict }] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, { stack: unknown; strict: boolean }]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-contributed-nav-door-${kind}-`));
    writeDefineStackConfig(dir, stack, strict ? {} : { strict: false });
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('os validate on a bundle that translates only contributed navigation', () => {
  it('exit 0: no `apps.APP.label` is owed under an app the stack only contributes into', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('moduleOnly')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect((JSON.parse(run.stdout) as { valid?: boolean }).valid).toBe(true);
  }, 180_000);

  it('CONTROL: exit 1 when the navigation entry itself has no label', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('navLabelMissing')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = (JSON.parse(run.stdout) as { errors?: ValidateError[] }).errors ?? [];
    expect(errors.map((e) => (e.path ?? []).join('.'))).toEqual([
      'translations.0.zh-CN.apps.crm_enterprise.navigation.nav_case.label',
    ]);
  }, 180_000);
});
