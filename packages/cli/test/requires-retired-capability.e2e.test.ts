// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A RETIRED `requires` token reads as its retirement prescription at the
 * `os validate` / `os build` door — never as "check for a typo".
 *
 * [#20367 ruling B] Re-judged. This pin used to hold the PLAIN-OBJECT posture:
 * `export default { … }` skipped `defineStack`, so the vocabulary check never
 * ran and an unknown token was an ADVISORY at the door (exit 0, a
 * `{ token, message }` record in `warnings`). Both doors now refuse a default
 * export no stack producer built (`STACK_PROVENANCE_MISSING`), so the config is
 * authored in the one legal shape — `defineStack({ … })` — and an unknown token
 * is the producer's refusal at load: `STACK_CAPABILITY_UNKNOWN`, exit 1, on
 * both doors, through the same `--json` envelope (`error` + `code`).
 *
 * What stays pinned is the TEXT the author reads, now in that refusal: the
 * retired token carries the spec-owned prescription verbatim (the same string
 * `os serve` warns with), and only the misspelled token carries the typo
 * advice. The misspelled token rides in the same fixture as the control, so
 * "the prescription is shown" cannot pass against a renderer that shows it for
 * every unknown token.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_PLATFORM_CAPABILITY_GUIDANCE } from '@objectstack/spec/kernel';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

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

interface Refusal {
  valid?: unknown;
  success?: unknown;
  error?: unknown;
  code?: unknown;
}

function refusalPayload(run: Run, label: string): Refusal {
  try {
    return JSON.parse(run.stdout) as Refusal;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

const RETIRED_TOKEN = 'reports';
const TYPO_TOKEN = 'reportz';

/** The one legal shape: `defineStack` runs the vocabulary check at load. */
const CONFIG = `
import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.retiredcap', name: 'retiredcap', version: '1.0.0', type: 'app', namespace: 'retiredcap' },
  requires: ['${RETIRED_TOKEN}', '${TYPO_TOKEN}'],
  objects: [
    {
      name: 'rc_thing',
      label: 'Thing',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
});
`;

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-retired-cap-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  linkSpec(dir);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('a retired `requires` token at the `os validate` / `os build` door (defineStack config)', () => {
  const prescription = RETIRED_PLATFORM_CAPABILITY_GUIDANCE[RETIRED_TOKEN];

  it('the spec carries a prescription for the token under test', () => {
    expect(prescription, 'RETIRED_PLATFORM_CAPABILITY_GUIDANCE lost its `reports` row').toBeTruthy();
  });

  for (const command of ['validate', 'build'] as const) {
    it(`os ${command} --json: STACK_CAPABILITY_UNKNOWN, exit 1 — the retired token carries the prescription, the typo keeps the typo hint`, async () => {
      const run = await runCli([command, '--json'], dir);
      const payload = refusalPayload(run, `os ${command} --json`);
      expect(run.code, `os ${command} --json:\n${run.stdout}${run.stderr}`).toBe(1);
      expect(payload.code).toBe('STACK_CAPABILITY_UNKNOWN');
      expect(command === 'validate' ? payload.valid : payload.success).toBe(false);
      const message = String(payload.error);
      // The retired token: its prescription, verbatim — and it is not typo advice.
      expect(message).toContain(prescription);
      expect(prescription).not.toContain('check for a typo');
      // The misspelled token: the typo advice, naming it — and only it.
      expect(message).toContain(`requires: '${TYPO_TOKEN}' is not a known platform capability — check for a typo`);
      expect(message.split('check for a typo').length - 1).toBe(1);
    }, 180_000);
  }
});
