// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A RETIRED `requires` token reads as its retirement prescription at the
 * `os validate` / `os build` door — never as "check for a typo".
 *
 * Both commands accept a PLAIN-OBJECT config (`export default { … }`, no
 * `defineStack` call). That config is parsed with
 * `ObjectStackDefinitionSchema.safeParse`, whose `requires` is a bare string
 * array — the `defineStack` vocabulary check never runs — and the only text
 * the author sees for a `requires` token is the capability preflight's
 * `renderCapabilityMessage`. For a word that USED to be a capability (the
 * saved-report stack's `reports`), the typo advice is wrong in a way that
 * sends the author hunting for a spelling instead of deleting the token.
 *
 * Posture is unchanged: an unknown token is an ADVISORY at this door (exit 0,
 * a `{ token, message }` record in `warnings`); only its TEXT is asserted
 * here, and it is asserted EQUAL to the spec-owned prescription — the same
 * string `defineStack` refuses the token with and `os serve` warns with.
 *
 * A misspelled token rides in the same fixture as the control, so "the
 * prescription is shown" cannot pass against a renderer that shows it for
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

function capabilityHints(run: Run, label: string): Map<string, string> {
  let payload: { warnings?: unknown };
  try {
    payload = JSON.parse(run.stdout) as { warnings?: unknown };
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
  const hints = new Map<string, string>();
  for (const w of Array.isArray(payload.warnings) ? payload.warnings : []) {
    if (typeof w === 'object' && w !== null && 'token' in w) {
      const r = w as { token: unknown; message: unknown };
      hints.set(String(r.token), String(r.message));
    }
  }
  return hints;
}

const RETIRED_TOKEN = 'reports';
const TYPO_TOKEN = 'reportz';

/** A plain-object config: no `defineStack`, so no parse-time vocabulary check. */
const CONFIG = `
export default {
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
};
`;

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-retired-cap-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('a retired `requires` token at the `os validate` / `os build` door (plain-object config)', () => {
  const prescription = RETIRED_PLATFORM_CAPABILITY_GUIDANCE[RETIRED_TOKEN];

  it('the spec carries a prescription for the token under test', () => {
    expect(prescription, 'RETIRED_PLATFORM_CAPABILITY_GUIDANCE lost its `reports` row').toBeTruthy();
  });

  for (const command of ['validate', 'build'] as const) {
    it(`os ${command} --json: advisory posture, the retired token carries the prescription, the typo keeps the typo hint`, async () => {
      const run = await runCli([command, '--json'], dir);
      expect(run.code, `os ${command} --json failed:\n${run.stdout}${run.stderr}`).toBe(0);
      const hints = capabilityHints(run, `os ${command} --json`);
      expect([...hints.keys()].sort()).toEqual([RETIRED_TOKEN, TYPO_TOKEN].sort());
      expect(hints.get(RETIRED_TOKEN)).toBe(prescription);
      expect(hints.get(RETIRED_TOKEN)).not.toContain('check for a typo');
      expect(hints.get(TYPO_TOKEN)).toContain('check for a typo');
    }, 180_000);
  }
});
