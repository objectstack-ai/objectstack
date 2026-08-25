// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins the package-manager probe's VERDICT — both what it decides and why.
//
// The card this file answers is a flake, but the flake was a symptom. The old
// detector was `try { execSync('pnpm --version') } catch { return 'npm' }`, so
// `npm` in a transcript meant either "this machine has no pnpm" or "the probe
// threw" and nothing could tell which. `pnpm --version` resolves through
// Corepack and therefore depends on the cwd it runs in, so the second case is
// reachable on any machine with a slow or offline network — which is how a
// merge-queue job on a diff that could not reach this package went red.
//
// Every test here is hermetic by construction: both ambient reads (the probe
// and the PATH lookup) are injected, so nothing in this file can be decided by
// the runner. That is deliberate and it is the point of the card — a pin that
// asks the environment a question it cannot pin the answer to is measuring the
// runner, not the code.

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  detectPackageManager,
  probeFailureDetail,
  resolveOnPath,
} from './detect-package-manager.js';

/** A probe that fails the way a real `execSync` failure does. */
function throwingProbe(err: unknown): () => void {
  return () => {
    throw err;
  };
}

/** The shape `execSync` throws: a status, and stderr only if it was piped. */
function execError(over: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('Command failed: pnpm --version'), {
    status: 1,
    signal: null,
    stderr: Buffer.from(''),
    ...over,
  });
}

describe('detectPackageManager — the decision', () => {
  it('probe succeeds -> pnpm', () => {
    const out = detectPackageManager({ probe: () => {}, pnpmOnPath: () => true });
    expect(out).toEqual({ pm: 'pnpm', probe: 'ok' });
  });

  it('probe throws, pnpm absent from PATH -> npm', () => {
    const out = detectPackageManager({
      probe: throwingProbe(execError({ status: 127 })),
      pnpmOnPath: () => false,
    });
    expect(out).toEqual({ pm: 'npm', probe: 'absent' });
  });

  it('probe throws, pnpm present on PATH -> npm', () => {
    const out = detectPackageManager({
      probe: throwingProbe(execError({ stderr: Buffer.from('Error: getaddrinfo ENOTFOUND registry.npmjs.org\n') })),
      pnpmOnPath: () => true,
    });
    expect(out.pm).toBe('npm');
  });

  // Clause-② guard for this change: the change was allowed to move what the
  // tool REPORTS, never what it DOES. `pm` must still be a pure function of
  // "did the probe succeed", exactly as the collapsed version was — the PATH
  // lookup must not be able to move it. Green before and after the fix by
  // design; a regression guard, not evidence the fix was needed.
  it('regression guard: pm is pnpm if and only if the probe succeeded', () => {
    for (const pnpmOnPath of [true, false]) {
      expect(detectPackageManager({ probe: () => {}, pnpmOnPath: () => pnpmOnPath }).pm).toBe('pnpm');
      expect(
        detectPackageManager({ probe: throwingProbe(execError()), pnpmOnPath: () => pnpmOnPath }).pm,
      ).toBe('npm');
    }
  });
});

describe('detectPackageManager — the distinction that used to be collapsed', () => {
  // THE collapse guard. Both of these answer `npm`; if a future edit folds the
  // two failure modes back into one answer, these two objects become equal and
  // this test goes red. Asserting only `pm` cannot catch that — that is the
  // whole defect — so the assertion is on the reason.
  it('"probe threw" and "chose npm" are different verdicts, not one', () => {
    const absent = detectPackageManager({
      probe: throwingProbe(execError({ status: 127 })),
      pnpmOnPath: () => false,
    });
    const failed = detectPackageManager({
      probe: throwingProbe(execError({ stderr: Buffer.from('corepack: fetch failed\n') })),
      pnpmOnPath: () => true,
    });

    expect(absent.pm).toBe(failed.pm); // same decision...
    expect(absent.probe).not.toBe(failed.probe); // ...different reason
    expect(absent.probe).toBe('absent');
    expect(failed.probe).toBe('failed');
    expect(absent).not.toEqual(failed);
  });

  it('only the "probe threw" verdict carries a detail to report', () => {
    const failed = detectPackageManager({
      probe: throwingProbe(execError({ stderr: Buffer.from('corepack: fetch failed\n') })),
      pnpmOnPath: () => true,
    });
    expect(failed).toHaveProperty('detail', 'corepack: fetch failed');

    const absent = detectPackageManager({
      probe: throwingProbe(execError({ status: 127 })),
      pnpmOnPath: () => false,
    });
    expect(absent).not.toHaveProperty('detail');

    const ok = detectPackageManager({ probe: () => {}, pnpmOnPath: () => true });
    expect(ok).not.toHaveProperty('detail');
  });

  it('the PATH lookup is not consulted when the probe succeeds', () => {
    let consulted = false;
    detectPackageManager({
      probe: () => {},
      pnpmOnPath: () => {
        consulted = true;
        return true;
      },
    });
    expect(consulted).toBe(false);
  });
});

describe('probeFailureDetail — one bounded line, most specific evidence first', () => {
  it('names the signal when the child was killed', () => {
    expect(probeFailureDetail(execError({ signal: 'SIGTERM', stderr: Buffer.from('noise\n') })))
      .toBe('killed by SIGTERM');
  });

  it("uses stderr's first non-empty line when there is one", () => {
    expect(probeFailureDetail(execError({ stderr: Buffer.from('\n\n  corepack: fetch failed  \nmore\n') })))
      .toBe('corepack: fetch failed');
  });

  it('falls back to a libuv code, then to the exit status', () => {
    expect(probeFailureDetail(execError({ code: 'ENOENT', status: null }))).toBe('ENOENT');
    expect(probeFailureDetail(execError({ status: 127 }))).toBe('exited 127');
  });

  it('never returns a multi-line or unbounded string — it lands in a console warning', () => {
    const detail = probeFailureDetail(execError({ stderr: Buffer.from(`${'x'.repeat(5000)}\nsecond\n`) }));
    expect(detail).not.toContain('\n');
    expect(detail.length).toBeLessThanOrEqual(200);
  });

  it('degrades to a fixed string rather than throwing on a non-Error', () => {
    expect(probeFailureDetail(undefined)).toBe('unknown error');
    expect(probeFailureDetail(null)).toBe('unknown error');
  });
});

describe('resolveOnPath — the PATH read, without spawning', () => {
  it('finds an executable in an earlier PATH entry and returns its full path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-pathprobe-'));
    try {
      const bin = path.join(dir, 'pnpm');
      fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      expect(resolveOnPath('pnpm', { PATH: `${dir}${path.delimiter}/nonexistent` })).toBe(bin);
      expect(resolveOnPath('pnpm', { PATH: '/nonexistent' })).toBeNull();
      expect(resolveOnPath('pnpm', { PATH: '' })).toBeNull();
      expect(resolveOnPath('pnpm', {})).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mistake a directory of the same name for an executable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-objectstack-pathprobe-'));
    try {
      fs.mkdirSync(path.join(dir, 'pnpm'));
      expect(resolveOnPath('pnpm', { PATH: dir })).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
