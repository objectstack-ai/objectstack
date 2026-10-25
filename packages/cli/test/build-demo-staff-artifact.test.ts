// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25777 — `os build` never writes the stack's `demoStaff` into the artifact.
 *
 * Each entry declares an account that can SIGN IN with the development seed
 * password. The development boot creates them off the authored config, and a
 * deployment boots the artifact — so the artifact is where the list must not
 * be, whatever a later boot's own gates would decide. Measured on the file the
 * command actually puts on disk, by key and by text (an address surviving
 * under any other key would still be a leak).
 *
 * The control is the same build carrying the stack's other keys through: the
 * declared position the demo account names is in the artifact, so a green
 * here is "this one key was left out", not "the build wrote nothing".
 *
 * Runs the CLI from source (`bin/run-dev.js` through tsx), as the other build
 * suites do, so `compile.ts` is measured without a rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const STAFF_EMAIL = 'counsel1@legal.example';

const STACK = {
  manifest: { id: 'com.example.legal', name: 'legal', version: '1.0.0', type: 'app', namespace: 'legal' },
  objects: [
    {
      name: 'legal_matter',
      label: 'Matter',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
  positions: [{ name: 'legal_counsel', label: 'Legal Counsel' }],
  demoStaff: [{ name: 'Legal Counsel 1', email: STAFF_EMAIL, position: 'legal_counsel' }],
};

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-demo-staff-build-'));
  writeDefineStackConfig(dir, STACK);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function build(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      TSX,
      [CLI, 'build', '--json'],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) =>
        done({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

describe('`os build` leaves the demo accounts out of the artifact (#25777)', () => {
  it('writes no `demoStaff` key and no demo address, and keeps every other key it was given', async () => {
    const run = await build(dir);
    expect(run.code, `os build --json failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

    const payload = JSON.parse(run.stdout) as { output?: string };
    const text = readFileSync(String(payload.output), 'utf8');
    const artifact = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(artifact)).not.toContain('demoStaff');
    expect(text).not.toContain(STAFF_EMAIL);

    // Control: the position the demo account names survived the same build.
    expect((artifact.positions as Array<{ name: string }>).map((p) => p.name)).toEqual(['legal_counsel']);
  }, 180_000);
});
