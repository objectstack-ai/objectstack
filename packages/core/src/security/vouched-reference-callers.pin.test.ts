// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The call-site census of the vouched-reference mark (`vouchForReference`,
 * `./vouched-reference.ts`), run where `Test Core` runs it: the gate's own
 * self-test (its red and green cases, with the battery floor and the verdict
 * handshake), then the scan of this tree, which must be green — every
 * production file that sets the mark is in the gate's `ALLOWED_CALLERS` with
 * its exact call-site count. The gate's header is the authority on the rule.
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const GATE = resolve(HERE, '../../../../scripts/check-vouch-for-reference-callers.mjs');

const run = (...args: string[]) =>
  spawnSync(process.execPath, [GATE, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });

describe('check:vouch-for-reference-callers', () => {
  it('its self-test reaches its verdict: every red and green case holds, and no battery fell below its floor', () => {
    const out = run('--self-test');
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/self-test: \d+ cases pass/);
  });

  it('this tree is green: the only production caller is the file-attachments writer, at its pinned count', () => {
    const out = run();
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('packages/services/service-storage/src/file-attachment-service.ts (2)');
  });
});
