// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, #28564] `os validate` asks the `__c` extension-field
 * reservation — the save and install doors' own judge
 * (`judgeExtensionFieldSuffix`), over the walk `utils/extension-field-suffix.ts`
 * takes, whose own file pins which packages it judges. What is pinned here is
 * the command: case (a) and case (b) each exit 1 with the field's path on
 * `errors` (and printed without `--json`); the base's paired `.custom`
 * declaring `region__c` in its extension validates clean.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** A stack under `id` extending the base's `crm_account` with one field named `field`. */
const stack = (id: string, namespace: string, field: string) => `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: {
    id: '${id}', name: 'ext', version: '1.0.0', type: 'app', namespace: '${namespace}',
    dependencies: { 'com.acme.crm': '^1.0.0' },
  },
  objectExtensions: [
    { extend: 'crm_account', fields: { ${field}: { type: 'text', label: 'Region' } } },
  ],
}, { strict: false });
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runValidate(cwd: string, json = true): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'validate', ...(json ? ['--json'] : [])],
      // `childEnv()`, never a bulk `process.env` copy (check:cli-test-child-env).
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

const dirs: Record<'vendor' | 'pairPlain' | 'pairSuffixed', string> = { vendor: '', pairPlain: '', pairSuffixed: '' };

beforeAll(() => {
  const make = (key: keyof typeof dirs, source: string) => {
    dirs[key] = mkdtempSync(join(tmpdir(), `os-validate-ext-suffix-${key}-`));
    writeFileSync(join(dirs[key], 'objectstack.config.ts'), source);
    linkSpec(dirs[key]);
  };
  make('vendor', stack('com.acme.partner', 'partner', 'region__c'));
  make('pairPlain', stack('com.acme.crm.custom', 'crm_custom', 'region'));
  make('pairSuffixed', stack('com.acme.crm.custom', 'crm_custom', 'region__c'));
});

afterAll(() => {
  for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('#28564 — `os validate` refuses a field the `__c` reservation refuses', () => {
  it('(a) a plain package extending with `region__c` exits 1, the field\'s path on `errors`', async () => {
    const run = await runValidate(dirs.vendor);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors: Array<Record<string, unknown>> };
    expect(payload.valid).toBe(false);
    expect(payload.errors.map((e) => [e.path, e.code, e.rule, e.packageId])).toEqual([
      ['objectExtensions[0].fields.region__c', 'VALIDATION_ERROR', 'reserved_outside_pair', 'com.acme.partner'],
    ]);
    expect(String(payload.errors[0]!.message)).toContain('the `__c` suffix is reserved to a base\'s paired `.custom` package');
  }, 120_000);

  it('(b) the `.custom` pair extending with a plain `region` exits 1, the path printed without `--json`', async () => {
    const run = await runValidate(dirs.pairPlain, false);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    expect(run.stdout + run.stderr).toContain('objectExtensions[0].fields.region [VALIDATION_ERROR]');
    expect(run.stdout + run.stderr).toContain('name it `region__c`');
  }, 120_000);

  it('CONTROL — the `.custom` pair extending with `region__c` validates clean', async () => {
    const run = await runValidate(dirs.pairSuffixed);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect((JSON.parse(run.stdout) as { valid: boolean }).valid).toBe(true);
  }, 120_000);
});
