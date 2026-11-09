// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The call-site census of the vouched-reference mark (`vouchForReference`,
 * `./vouched-reference.ts`), run where `Test Core` runs it: the gate's own
 * self-test (its red and green cases, with the battery floor and the verdict
 * handshake), then the scan of this tree, which must be green — every
 * production file that sets the mark is in the gate's `ALLOWED_CALLERS` with
 * its exact call-site count. The gate's header is the authority on the rule.
 *
 * The scan here is `--ts-only`: the files this pin judges are the files whose
 * edits re-run it, the `packages/` glob ending in `.ts` of this package's
 * entry in scripts/cross-package-test-inputs.mjs. `examples/`, `apps/` and the
 * other source extensions are judged by the bare run in the lint step, on
 * every PR; the gate's header, "Two surfaces", says why the pin does not
 * judge them.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const GATE = resolve(HERE, '../../../../scripts/check-vouch-for-reference-callers.mjs');

/**
 * The budget of each test, which spawns the census once. The `--ts-only` scan
 * reads every `.ts` file under `packages/`, about a second on an idle machine;
 * a runner building the monorepo alongside the suite can push that past
 * vitest's default 5 s test timeout, and a timed-out test fails before any
 * assertion runs, so it says nothing about the mark it guards and reds every
 * batch it shares a shard with. The self-test is given the same budget because
 * it pays the same process start on the same runner. 60 s is the budget of the
 * sibling scan pin, `./operation-private-keys.pin.test.ts`.
 */
const SCAN_TIMEOUT_MS = 60_000;

const run = (...args: string[]) =>
  spawnSync(process.execPath, [GATE, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });

describe('check:vouch-for-reference-callers', () => {
  it('its self-test reaches its verdict: every red and green case holds, and no battery fell below its floor', () => {
    const out = run('--self-test');
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/self-test: \d+ cases pass/);
  }, SCAN_TIMEOUT_MS);

  it('this tree is green on the .ts surface: the only production caller is the file-attachments writer, at its pinned count', () => {
    const out = run('--ts-only');
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('(the .ts surface)');
    expect(out.stdout).toContain('packages/services/service-storage/src/file-attachment-service.ts (2)');
  }, SCAN_TIMEOUT_MS);
});
