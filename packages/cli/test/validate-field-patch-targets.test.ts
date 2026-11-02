// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] `os validate` asks the field-patch target check —
 * the install door's own judge (`fieldPatchTargetRefusals`), over the walk
 * `utils/field-patch-targets.ts` takes, whose own file pins which targets it
 * reads. What is pinned here is the command: a stack whose object extension
 * patches a field or option value its in-stack target lacks exits 1, each
 * refusal located on `errors`; the same stack patching what exists validates
 * clean.
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

const stack = (fieldPatches: string) => `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.acme.fpt', name: 'fpt', version: '1.0.0', type: 'app', namespace: 'fpt' },
  objects: [{
    name: 'fpt_account',
    label: 'Account',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name' },
      industry: { type: 'select', label: 'Industry', options: [{ value: 'tech', label: 'Tech' }, { value: 'retail', label: 'Retail' }] },
    },
  }],
  objectExtensions: [{ extend: 'fpt_account', fieldPatches: ${fieldPatches} }],
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

let missingDir: string;
let matchingDir: string;

beforeAll(() => {
  missingDir = mkdtempSync(join(tmpdir(), 'os-validate-fpt-missing-'));
  writeFileSync(join(missingDir, 'objectstack.config.ts'),
    stack(`{ sector: { label: 'Sector' }, industry: { options: { finance: { label: 'Finance' } } } }`));
  linkSpec(missingDir);
  matchingDir = mkdtempSync(join(tmpdir(), 'os-validate-fpt-matching-'));
  writeFileSync(join(matchingDir, 'objectstack.config.ts'),
    stack(`{ industry: { label: 'Sector', options: { tech: { label: 'Technology' } } } }`));
  linkSpec(matchingDir);
});

afterAll(() => {
  rmSync(missingDir, { recursive: true, force: true });
  rmSync(matchingDir, { recursive: true, force: true });
});

describe('os validate — the field-patch target check (ADR-0146 D10)', () => {
  it('exits 1 with each patch naming a missing field or option value located on errors', async () => {
    const run = await runValidate(missingDir);
    expect(run.code, run.stderr).toBe(1);
    const report = JSON.parse(run.stdout);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e: { path: string }) => e.path)).toEqual([
      'objectExtensions[0].fieldPatches.sector',
      'objectExtensions[0].fieldPatches.industry.options.finance',
    ]);
    expect(report.errors.map((e: { reason: string }) => e.reason)).toEqual(['field', 'option']);
  }, 120_000);

  it('validates clean when the patch names a field and option value the target has', async () => {
    const run = await runValidate(matchingDir);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout).valid).toBe(true);
  }, 120_000);
});
