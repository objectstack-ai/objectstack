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
 *
 * ── Amended by #5387 ─────────────────────────────────────────────────────
 *
 * `resolveTenancyPostureOrFinding()` now takes the `.env*` reading its verdict
 * is resolved against: doctor reads the cascade `os serve` reads instead of this
 * shell alone. Two things in this file legitimately changed premise and are
 * updated rather than deleted:
 *
 *   • every call site passes a reading — built by the REAL `readDotenvFiles()`
 *     over a real (empty) directory, so these cases keep testing shell-sourced
 *     values, which is what they were always about;
 *   • the case that pinned "doctor does not load `.env*`" pinned a sentence
 *     that is now false. It is replaced by its opposite — the finding must name
 *     what doctor DID read — with the anti-overclaim assertion kept, pointing at
 *     the retired sentence so it cannot come back.
 *
 * The `.env`-sourced half of the behaviour lives in `doctor-env-provenance.test.ts`.
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANCY_POSTURES } from '@objectstack/spec/security';

import Doctor, {
  resolveTenancyPostureOrFinding,
  readDotenvFiles,
  type DotenvReading,
} from './doctor.js';

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

/**
 * A real reading of a real directory that contains no `.env*` file (#5387).
 *
 * Not a hand-built literal: `readDotenvFiles()` is the code under test in the
 * sibling file, and a fake reading here would let these cases keep passing if
 * the real one started reporting files that do not exist.
 */
let emptyDir: string;
let shellOnly: DotenvReading;

beforeAll(() => {
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-doctor-5387-noenv-'));
  shellOnly = readDotenvFiles(emptyDir, 'production');
  expect(shellOnly.files).toEqual([]);
});

afterAll(() => {
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

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
      expect(resolveTenancyPostureOrFinding(shellOnly)).toEqual({ ok: true, posture });
    }
  });

  it("keeps the legacy 'multi' spelling normalizing to isolated", () => {
    process.env.OS_TENANCY_POSTURE = 'multi';
    expect(resolveTenancyPostureOrFinding(shellOnly)).toEqual({ ok: true, posture: 'isolated' });
  });

  it('unset falls back to the OS_MULTI_ORG_ENABLED derivation, not to a finding', () => {
    expect(resolveTenancyPostureOrFinding(shellOnly)).toEqual({ ok: true, posture: 'single' });

    process.env.OS_MULTI_ORG_ENABLED = 'true';
    expect(resolveTenancyPostureOrFinding(shellOnly)).toEqual({ ok: true, posture: 'isolated' });
  });

  it('treats a blank value as unset — reporting it would flag `OS_TENANCY_POSTURE=` in a .env', () => {
    process.env.OS_TENANCY_POSTURE = '   ';
    expect(resolveTenancyPostureOrFinding(shellOnly)).toEqual({ ok: true, posture: 'single' });
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
    expect(() => resolveTenancyPostureOrFinding(shellOnly)).not.toThrow();

    const reading = resolveTenancyPostureOrFinding(shellOnly);
    expect(reading.ok).toBe(false);
  });

  it('is an ERROR health check — the severity that makes doctor exit non-zero', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding(shellOnly);
    if (reading.ok) throw new Error('expected a finding');

    // `status: 'error'` is load-bearing, not cosmetic: doctor's display loop
    // sets `hasErrors` from exactly this field, and `hasErrors` is what turns
    // the summary into `process.exit(1)`. A 'warning' here would reproduce the
    // defect — a correct sentence with exit code 0.
    expect(reading.result.status).toBe('error');
  });

  it('names the fact: the variable and the value the operator actually typed', () => {
    process.env.OS_TENANCY_POSTURE = 'islolated'; // a real transposition typo
    const reading = resolveTenancyPostureOrFinding(shellOnly);
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
    const reading = resolveTenancyPostureOrFinding(shellOnly);
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
    const reading = resolveTenancyPostureOrFinding(shellOnly);
    if (reading.ok) throw new Error('expected a finding');

    // `@objectstack/types` owns the vocabulary and its wording; doctor must not
    // maintain a second copy that can disagree with it.
    expect(plain(reading.result.fix ?? '')).toContain('cause: Invalid OS_TENANCY_POSTURE="bogus"');
  });

  it('says WHERE it read the value — and no longer claims it skipped `.env*` (#5387)', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const reading = resolveTenancyPostureOrFinding(shellOnly);
    if (reading.ok) throw new Error('expected a finding');
    const fix = plain(reading.result.fix ?? '');

    // The premise of this case changed, it was not softened. Until #5387 doctor
    // read no `.env*` at all, and this text said so — the honest sentence for
    // the code as it stood, and the reason #5387 was filed. Doctor now reads
    // serve's cascade, so the same slot must carry the opposite fact: this
    // value came from THIS PROCESS's environment, and doctor looked in the
    // files too (here: none exist in the temp dir the reading was taken from).
    expect(fix).toContain("Read from this process's environment");
    expect(fix).toContain(`no \`.env*\` file exists in ${shellOnly.cwd}`);
    expect(fix).toContain('node_env=production');

    // Anti-overclaim, kept and pointed at the retired sentence: a diagnostic
    // that says it did not look somewhere it now looks is as untrustworthy as
    // one claiming coverage it never had. Both directions are failures.
    expect(fix).not.toContain('does not\n      load `.env*` files');
    expect(fix).not.toContain("Read from this process's environment only");
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
    //
    // #10679 — the matcher accepts either non-error summary. The control used
    // to pin `Environment is functional but has some warnings` literally, and
    // it held only because the temp cwd has no `packages/spec` and doctor
    // warned `@objectstack/spec Not built` about that absent workspace every
    // time. With that phantom warning gone this cwd has no findings, so the
    // summary is the healthy one. Either sentence proves the control's actual
    // claim; neither can be produced by the broken leg below, which prints
    // `Some critical issues found` and exits 1.
    expect(healthy.exitCode).toBeUndefined();
    expect(healthy.out).toMatch(
      /Environment is (healthy and ready for development|functional but has some warnings)/,
    );
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
