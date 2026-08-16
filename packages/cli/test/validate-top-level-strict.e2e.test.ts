// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8687 — `os validate` fails OUTRIGHT on an unknown top-level stack key, over
 * the real CLI process.
 *
 * The card's measurement on 17.0.0 GA: three injected bogus top-level keys
 * added ZERO warnings and `os validate` exited 0 — even `--strict` could not
 * catch them, because the `defineStack:` naming diagnostic printed at load,
 * outside the warning tally. There was no flag that turned a dropped top-level
 * key into a non-zero exit.
 *
 * The maintainer-ruled fix (Shape B) closes `ObjectStackDefinitionSchema` at
 * the top level, so the refusal happens in the one parse every authoring path
 * shares — and a parse failure fails `validate` with exit 1 **without needing
 * `--strict` at all** (B subsumes Shape A's warning-accounting change). The
 * exit status is the whole point of the card — it is the only thing a CI
 * pipeline reads — so this test spawns the real CLI (the
 * `migrate-exit-code.e2e.test.ts` pattern: `bin/run-dev.js` + tsx, no
 * dependency on `packages/cli/dist`) and asserts what the SHELL sees.
 *
 * Schema-layer pins (issue code/path, near-miss guidance, curated
 * prescriptions, accept side) live in
 * `packages/spec/src/stack-top-level-strict.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** The card's failure shape: a valid stack plus ONE stray top-level key. */
const CONFIG_WITH_STRAY_KEY = `
export default {
  manifest: { id: 'com.example.straykey', name: 'straykey', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'sk_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  // One character off 'flows' — the family-dropping typo the card measured.
  flow: [],
};
`;

const CONFIG_CLEAN = `
export default {
  manifest: { id: 'com.example.straykey', name: 'straykey', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'sk_ticket',
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  flows: [],
};
`;

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
      { cwd, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
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

let strayDir: string;
let cleanDir: string;

beforeAll(() => {
  strayDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-e2e-stray-'));
  writeFileSync(join(strayDir, 'objectstack.config.ts'), CONFIG_WITH_STRAY_KEY);
  cleanDir = mkdtempSync(join(tmpdir(), 'os-validate-strict-e2e-clean-'));
  writeFileSync(join(cleanDir, 'objectstack.config.ts'), CONFIG_CLEAN);
});

afterAll(() => {
  rmSync(strayDir, { recursive: true, force: true });
  rmSync(cleanDir, { recursive: true, force: true });
});

describe('#8687 — os validate refuses an unknown top-level stack key', () => {
  it('exits non-zero WITHOUT --strict, naming the key and the near-miss', async () => {
    const run = await runCli(['validate'], strayDir);
    expect(run.code, `expected non-zero exit; stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).not.toBe(0);
    const out = run.stdout + run.stderr;
    expect(out).toContain('`flow`');
    expect(out).toContain('Did you mean `flow` → `flows`?');
  }, 120_000);

  it('control: the identical stack with the key spelled `flows` exits 0', async () => {
    const run = await runCli(['validate'], cleanDir);
    expect(run.code, `expected exit 0; stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
  }, 120_000);
});
