// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os doctor`'s tenancy-posture report (#5382).
 *
 * `resolveTenancyPosture()` in `@objectstack/types` refuses an unrecognized
 * `OS_TENANCY_POSTURE` by throwing. Doctor read the posture in two places — the
 * ADR-0120 D5e unique-scope gate and `findUnscopedGlobalUniques()` — and BOTH
 * sat inside the wide `try` that guards config analysis, whose `catch` prints
 *
 *     ⚠ Could not load config for analysis (config checks skipped)
 *
 * and records a WARNING. So an environment `os serve` flatly refuses to boot
 * was reported by `os doctor` as:
 *
 *     ⚠️  Environment is functional but has some warnings.     EXIT=0
 *
 * with the string `OS_TENANCY_POSTURE` appearing nowhere in the run. Two
 * separate defects in one line: the attribution was wrong (the config was
 * fine), and the severity was wrong (exit 0 keeps every CI health check green
 * on an environment that cannot start).
 *
 * ── Sibling, not a copy ──────────────────────────────────────────────────
 *
 * #5359 / PR #5381 fixed the same shape in `serve`, and the two verdicts differ
 * on purpose: serve REFUSES (FATAL + `process.exit(1)` before any boot work),
 * doctor REPORTS (an `error` health check flowing through doctor's own error
 * summary, after the rest of the report has printed). Doctor's semantics are
 * "tell me everything that is wrong", not "stop".
 *
 * ── What `packages/cli` pinned before this file ──────────────────────────
 *
 * Nothing, for doctor. `git grep -n OS_TENANCY_POSTURE packages/cli/src` matched
 * serve's prose, `verify`'s back-compat tests, and PR #5381's serve gate test —
 * no assertion of any kind on `doctor`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANCY_POSTURES } from '@objectstack/spec/security';

import Doctor, { resolveTenancyPostureOrFinding } from './doctor.js';

/** `packages/cli` — the oclif root the command is loaded against below. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes grep treat the whole file as binary, and a test file nobody's
 * `git grep` can find is a test file that stops being maintained (#4890/#5157).
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

const TOUCHED = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const k of TOUCHED) delete process.env[k];
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveTenancyPostureOrFinding — accepted values', () => {
  it('passes every posture the spec vocabulary declares', () => {
    for (const posture of TENANCY_POSTURES) {
      process.env.OS_TENANCY_POSTURE = posture;
      expect(resolveTenancyPostureOrFinding()).toEqual({ ok: true, posture });
    }
  });

  it("keeps the legacy 'multi' spelling normalizing to isolated", () => {
    process.env.OS_TENANCY_POSTURE = 'multi';
    expect(resolveTenancyPostureOrFinding()).toEqual({ ok: true, posture: 'isolated' });
  });

  it('unset falls back to the OS_MULTI_ORG_ENABLED derivation, not to a finding', () => {
    expect(resolveTenancyPostureOrFinding()).toEqual({ ok: true, posture: 'single' });

    process.env.OS_MULTI_ORG_ENABLED = 'true';
    expect(resolveTenancyPostureOrFinding()).toEqual({ ok: true, posture: 'isolated' });
  });

  it('treats a blank value as unset — reporting it would flag `OS_TENANCY_POSTURE=` in a .env', () => {
    process.env.OS_TENANCY_POSTURE = '   ';
    expect(resolveTenancyPostureOrFinding()).toEqual({ ok: true, posture: 'single' });
  });
});

describe('resolveTenancyPostureOrFinding — the finding', () => {
  it('REPORTS AS A VALUE, never as a throw — the property the config catch destroyed', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';

    // The point of the whole change. `resolveTenancyPosture()` throws here, and
    // doctor's posture reads lived inside the config-analysis `try`, so the
    // throw was caught by a `catch` that knows nothing about env vars and
    // downgraded "cannot start" to "config checks skipped". A verdict cannot be
    // caught by an unrelated catch.
    expect(() => resolveTenancyPostureOrFinding()).not.toThrow();

    const reading = resolveTenancyPostureOrFinding();
    expect(reading.ok).toBe(false);
  });

  it('is an ERROR health check — the severity that makes doctor exit non-zero', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding();
    if (reading.ok) throw new Error('expected a finding');

    // `status: 'error'` is load-bearing, not cosmetic: doctor's display loop
    // sets `hasErrors` from exactly this field, and `hasErrors` is what turns
    // the summary into `process.exit(1)`. A 'warning' here would reproduce the
    // defect — a correct sentence with exit code 0.
    expect(reading.result.status).toBe('error');
  });

  it('names the fact: the variable and the value the operator actually typed', () => {
    process.env.OS_TENANCY_POSTURE = 'islolated'; // a real transposition typo
    const reading = resolveTenancyPostureOrFinding();
    if (reading.ok) throw new Error('expected a finding');

    const text = plain(`${reading.result.message}\n${reading.result.fix ?? ''}`);
    expect(text).toContain('OS_TENANCY_POSTURE="islolated"');

    // The misattribution is the defect. Neither word may reappear in the text
    // that replaces it: this is not a config problem and no config check was
    // skipped because of it.
    expect(text).not.toContain('Could not load config');
    expect(text).not.toContain('config checks skipped');
  });

  it('prescribes a way out for EVERY posture the vocabulary declares (drift guard)', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding();
    if (reading.ok) throw new Error('expected a finding');

    const fix = plain(reading.result.fix ?? '');
    // Generated from TENANCY_POSTURES rather than restated, so a posture added
    // to the spec cannot leave this advice quietly incomplete.
    for (const posture of TENANCY_POSTURES) {
      expect(fix).toContain(`OS_TENANCY_POSTURE=${posture}`);
    }
    // …plus the escape the enumeration cannot express.
    expect(fix).toContain('unset OS_TENANCY_POSTURE');
    expect(fix).toContain('OS_MULTI_ORG_ENABLED');
  });

  it("carries the resolver's own sentence as `cause` rather than paraphrasing it", () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding();
    if (reading.ok) throw new Error('expected a finding');

    // `@objectstack/types` owns the vocabulary and its wording; doctor must not
    // maintain a second copy that can disagree with it.
    expect(plain(reading.result.fix ?? '')).toContain('cause: Invalid OS_TENANCY_POSTURE="bogus"');
  });

  it('says what it did NOT read — doctor loads no .env, so a green report is not a serve guarantee', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding();
    if (reading.ok) throw new Error('expected a finding');

    // Deliberately the OPPOSITE of serve's gate text, which says it checked
    // "every .env file dotenv-flow loaded". serve calls `dotenvFlow.config()`;
    // doctor does not load `.env*` at all, so claiming the same coverage here
    // would be false. Overclaiming by one sentence is how a diagnostic stops
    // being trustworthy — the same reason PR #5381 refused to write "no port
    // has been bound".
    expect(plain(reading.result.fix ?? '')).toContain('does not\n      load `.env*` files');
  });
});

describe('os doctor reports an unrecognized posture and exits non-zero', () => {
  /**
   * The end-to-end assertion, run against the real `doctor` command in-process.
   *
   * This is the one that would have caught #5382, and it is written as a
   * DIFFERENTIAL over one variable: the same cwd, the same checks, the same
   * everything, with only `OS_TENANCY_POSTURE` changing between the two cases.
   * The valid-posture case on its own would pass against the broken code too
   * (it asserts an absence) — it is the control half, not the evidence.
   *
   * The temp cwd is built so the pre-existing checks cannot manufacture the
   * result: `node_modules/` exists, so the `Dependencies` check is `ok` rather
   * than the `error` that would exit 1 on its own and make the interesting
   * assertion pass for a reason having nothing to do with the posture.
   */
  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5382-'));
    // `Dependencies … Installed` — see above. Without this the baseline run
    // already has an error and the differential proves nothing.
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    // Spying beats `process.chdir()`: doctor reads `process.cwd()` directly and
    // the spy works under every vitest pool, including worker threads where
    // `chdir` is not available at all.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Run the real command, capturing stdout and any `process.exit`. */
  async function runDoctor(): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code;
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    try {
      await Doctor.run([], { root: CLI_ROOT });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__PROCESS_EXIT__')) throw err;
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
    return { out: plain(logs.join('\n')), exitCode };
  }

  it('names OS_TENANCY_POSTURE, refuses to call the environment functional, and exits 1', async () => {
    // ── Control: the same environment with a posture that parses ──────────
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const healthy = await runDoctor();

    // Doctor completes normally. This is the sentence #5382 quoted, and here it
    // is CORRECT: this environment really can start.
    expect(healthy.exitCode).toBeUndefined();
    expect(healthy.out).toContain('Environment is functional');
    expect(healthy.out).not.toContain('Tenancy posture');

    // ── The case: one character changed ──────────────────────────────────
    process.env.OS_TENANCY_POSTURE = 'isolatd';
    const broken = await runDoctor();

    // Before this change every one of these four was the other way round: no
    // mention of the variable, "Environment is functional", exit 0.
    expect(broken.out).toContain('OS_TENANCY_POSTURE="isolatd"');
    expect(broken.out).toContain('is not a recognized tenancy posture');
    expect(broken.out).not.toContain('Environment is functional');
    expect(broken.exitCode).toBe(1);

    // The prescription reaches the operator without `--verbose`: doctor prints
    // an error's `fix` unconditionally, and a diagnostic that names a problem
    // it will not tell you how to solve is half a diagnostic.
    expect(broken.out).toContain('Set one of the accepted values');
    for (const posture of TENANCY_POSTURES) {
      expect(broken.out).toContain(`OS_TENANCY_POSTURE=${posture}`);
    }

    // And it is not blamed on the config. In this cwd there is no
    // `objectstack.config.ts` at all, so the config-analysis block never ran —
    // which is itself worth pinning: BEFORE the change, doctor's only posture
    // readers lived inside `if (configExists())`, so this environment produced
    // no posture diagnosis whatsoever, not even the misattributed one.
    expect(broken.out).not.toContain('Could not load config');
    // 60s, not the 5s default: this case imports and runs the REAL doctor
    // command in-process — twice — and each run shells out to `pnpm -v`,
    // `tsc -v` and `git --version`. On a loaded merge-queue shard that blew the
    // 5s default for PR #5381's equivalent case (queue run 30971902650), which
    // is what took that PR out of the queue. Same posture as the existing
    // `}, 60_000)` cases in this package (`utils/sqlite-occupancy.test.ts`,
    // `utils/schema-migrate.deferred-ddl.integration.test.ts`).
  }, 60_000);
});
