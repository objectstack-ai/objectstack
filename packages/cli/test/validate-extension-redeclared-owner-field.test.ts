// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] `os validate` asks the display-property
 * whitelist judge — the save and install doors' own
 * (`judgeRedeclaredOwnerFields`), over the walk
 * `utils/extension-redeclared-owner-fields.ts` takes. What is pinned here is
 * the command, on an assembled artifact (ADR-0130 D4) whose second package
 * extends the first package's object: an `objectExtensions[].fields` entry
 * that changes the owner field's `type` exits 1 with the entry located on
 * `errors` (`code: VALIDATION_ERROR`); the same entry changing only the
 * label validates clean.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** Two packages: the core owns `rof_deal`, the module re-declares its `amount` as `amount`. */
const assembled = (amount: Record<string, unknown>) => ({
  manifest: { id: 'com.example.rof', namespace: 'rof', version: '1.0.0', name: 'Rof', type: 'app' },
  packages: [
    {
      manifest: {
        id: 'com.example.rof', namespace: 'rof', version: '1.0.0', name: 'Rof', type: 'app',
        objects: [{
          name: 'rof_deal', label: 'Deal', sharingModel: 'private',
          fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
        }],
      },
    },
    {
      manifest: {
        id: 'com.example.rof.revenue', namespace: 'rof', version: '1.0.0', name: 'Revenue', type: 'module',
        dependencies: { 'com.example.rof': '^1.0.0' },
        objectExtensions: [{ extend: 'rof_deal', fields: { amount } }],
      },
    },
  ],
});

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

let typeChangeDir: string;
let relabelDir: string;

beforeAll(() => {
  typeChangeDir = mkdtempSync(join(tmpdir(), 'os-validate-rof-type-'));
  writeFileSync(join(typeChangeDir, 'objectstack.config.ts'),
    defineStackSource(assembled({ type: 'text', label: 'Amount' }), { strict: false }));
  linkSpec(typeChangeDir);
  relabelDir = mkdtempSync(join(tmpdir(), 'os-validate-rof-relabel-'));
  writeFileSync(join(relabelDir, 'objectstack.config.ts'),
    defineStackSource(assembled({ type: 'number', label: 'Deal size' }), { strict: false }));
  linkSpec(relabelDir);
});

afterAll(() => {
  rmSync(typeChangeDir, { recursive: true, force: true });
  rmSync(relabelDir, { recursive: true, force: true });
});

describe('os validate — an extension re-declaring an owner field beyond its display properties (ADR-0146 D10)', () => {
  it('exits 1 with the entry located on errors, VALIDATION_ERROR, naming what it changes', async () => {
    const run = await runValidate(typeChangeDir);
    expect(run.code, run.stderr).toBe(1);
    const report = JSON.parse(run.stdout);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e: { path: string; code: string; changed: string[] }) => ({ path: e.path, code: e.code, changed: e.changed })))
      .toEqual([{ path: 'packages[1].manifest.objectExtensions[0].fields.amount', code: 'VALIDATION_ERROR', changed: ['type'] }]);
    expect(report.errors[0].message).toContain('`fieldPatches`');
  }, 120_000);

  it('validates clean when the entry changes only the label', async () => {
    const run = await runValidate(relabelDir);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(JSON.parse(run.stdout).valid).toBe(true);
  }, 120_000);
});
