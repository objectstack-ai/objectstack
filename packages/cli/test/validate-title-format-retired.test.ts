// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29007] `os validate` refuses an object definition that declares the retired
 * `titleFormat` — the ruling of record (6574393684, letter B). The verdict is
 * the registry's `validateTitleFormatRetired` (`@objectstack/lint`), the same
 * entry the metadata save gate runs; what is pinned here is the command: the
 * card's reproduction exits 1 with `title-format-retired` and its prescription,
 * and the same object pointing `nameField` at the field validates clean.
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

/** The card's object, with either the retired template or the pointer. */
const stack = (title: string) => `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.acme.titles', name: 'titles', version: '1.0.0', type: 'app' },
  objects: [
    {
      name: 'qar8_tf2',
      label: 'Title Format',
      sharingModel: 'public_read_write',
      ${title},
      fields: {
        code: { type: 'text', label: 'Code' },
        city: { type: 'text', label: 'City' },
      },
    },
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

const dirs: Record<'templated' | 'pointed', string> = { templated: '', pointed: '' };

beforeAll(() => {
  const make = (key: keyof typeof dirs, source: string) => {
    dirs[key] = mkdtempSync(join(tmpdir(), `os-validate-title-format-${key}-`));
    writeFileSync(join(dirs[key], 'objectstack.config.ts'), source);
    linkSpec(dirs[key]);
  };
  make('templated', stack(`titleFormat: '{code} @ {city}'`));
  make('pointed', stack(`nameField: 'code'`));
});

afterAll(() => {
  for (const dir of Object.values(dirs)) if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('#29007 — `os validate` refuses the retired titleFormat', () => {
  it('an object declaring titleFormat exits 1 with title-format-retired and its prescription', async () => {
    const run = await runValidate(dirs.templated);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    const payload = JSON.parse(run.stdout) as { valid: boolean; errors: Array<Record<string, unknown>> };
    expect(payload.valid).toBe(false);
    const refusal = payload.errors.find((e) => JSON.stringify(e).includes('title-format-retired'));
    expect(refusal, JSON.stringify(payload.errors)).toBeDefined();
    expect(JSON.stringify(refusal)).toContain('migrate to nameField');
  }, 120_000);

  it('CONTROL — the same object pointing nameField at the field validates clean', async () => {
    const run = await runValidate(dirs.pointed);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect((JSON.parse(run.stdout) as { valid: boolean }).valid).toBe(true);
  }, 120_000);
});
