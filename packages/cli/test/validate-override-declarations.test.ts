// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D2, #28410] `os validate` asks the override write gate — the
 * publish door's own judge (`judgeOverrideWrite`), over the walk
 * `utils/override-declarations.ts` takes, whose own file pins which items it
 * judges. What is pinned here is the command: a stack whose `overrides`
 * declaration the gate does not admit exits 1, the refusal on `errors` with
 * the door's code; the base's paired `.custom` declaring the same override
 * validates clean.
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

const stack = (id: string) => `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: {
    id: '${id}', name: 'ovr', version: '1.0.0', type: 'app', namespace: 'ovr',
    dependencies: { 'com.acme.crm': '^1.0.0' },
  },
  dashboards: [
    { name: 'crm_board', label: 'Board', widgets: [], overrides: { package: 'com.acme.crm', basedOn: '1.0.0' } },
  ],
}, { strict: false });
`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runValidate(cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, 'validate', '--json'],
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

let partnerDir: string;
let pairDir: string;

beforeAll(() => {
  partnerDir = mkdtempSync(join(tmpdir(), 'os-validate-override-partner-'));
  writeFileSync(join(partnerDir, 'objectstack.config.ts'), stack('com.acme.partner'));
  linkSpec(partnerDir);
  pairDir = mkdtempSync(join(tmpdir(), 'os-validate-override-pair-'));
  writeFileSync(join(pairDir, 'objectstack.config.ts'), stack('com.acme.crm.custom'));
  linkSpec(pairDir);
});

afterAll(() => {
  rmSync(partnerDir, { recursive: true, force: true });
  rmSync(pairDir, { recursive: true, force: true });
});

describe('#28410 — `os validate` refuses an override declaration the publish door refuses', () => {
  it('a dependent carrying `overrides` exits 1, with the gate\'s refusal on `errors`', async () => {
    const run = await runValidate(partnerDir);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors: Array<Record<string, unknown>> };
    expect(payload.valid).toBe(false);
    expect(payload.errors.map((e) => [e.path, e.code, e.rule, e.packageId])).toEqual([
      ['dashboards[0]', 'NOT_OVERRIDABLE', 'declared_outside_pair', 'com.acme.partner'],
    ]);
    expect(String(payload.errors[0].message)).toContain("only 'com.acme.crm.custom' may declare an override of 'com.acme.crm'");
  }, 120_000);

  it('CONTROL — the base\'s paired .custom declaring the same override validates clean', async () => {
    const run = await runValidate(pairDir);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors?: unknown[] };
    expect(payload.valid).toBe(true);
  }, 120_000);
});
