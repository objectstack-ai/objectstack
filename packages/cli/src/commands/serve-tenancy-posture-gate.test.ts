// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The tenancy-posture boot gate (#5359).
 *
 * `resolveTenancyPosture()` in `@objectstack/types` refuses an unrecognized
 * `OS_TENANCY_POSTURE` and says so in the error text — "Refusing to boot rather
 * than silently falling back to a posture with no organization wall". The
 * refusal itself was never the problem. HOW it travelled was:
 *
 *   • serve's first read sat inside the broad AuthPlugin `try`, whose catch
 *     prints `⚠ AuthPlugin failed to load: …` and carries on. So the first —
 *     and for a long stretch the only — thing an operator saw for a misspelled
 *     env var was a PLUGIN-LOADING failure.
 *   • Boot then continued, degraded and without plugin-auth, through the whole
 *     capability slate (generating and PERSISTING a dev crypto key on the way)
 *     before the next unguarded read aborted it with a bare `printError`.
 *
 * `packages/cli` had no test on any of this: before this file,
 * `git grep -n "OS_TENANCY_POSTURE" packages/cli/src` matched only the prose in
 * serve.ts and the sibling `verify` test's back-compat notes.
 *
 * ── On what these tests do and do not claim ──────────────────────────────
 *
 * The issue that prompted the fix (#5359) traced this statically and concluded
 * the process had "already listened" before refusing. It has not: the throw the
 * banner was blamed for actually escapes far earlier, from ObjectQL's
 * `SchemaRegistry` constructor during kernel bootstrap Phase 1, while the HTTP
 * socket only opens on the `kernel:listening` hook in Phase 4. So "the port
 * never binds" is TRUE BOTH BEFORE AND AFTER this change, and no assertion here
 * is written as if it were the fix's evidence — a test that passes because
 * nothing was produced proves nothing.
 *
 * What the change actually moves, and what these tests therefore pin:
 *   • the refusal is a VERDICT, not a throw — nothing downstream can demote it
 *     to a warning the way the AuthPlugin catch did;
 *   • it names OS_TENANCY_POSTURE and prescribes every way out (ADR-0093 D5's
 *     shape), instead of arriving bare through a generic error printer;
 *   • the fix list is generated from the posture vocabulary, so it cannot go
 *     stale when a posture is added.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANCY_POSTURES } from '@objectstack/spec/security';

import Serve, { resolveTenancyPostureOrRefusal } from './serve.js';

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

describe('resolveTenancyPostureOrRefusal — accepted values', () => {
  it('passes every posture the spec vocabulary declares', () => {
    for (const posture of TENANCY_POSTURES) {
      process.env.OS_TENANCY_POSTURE = posture;
      expect(resolveTenancyPostureOrRefusal()).toEqual({ ok: true, posture });
    }
  });

  it("keeps the legacy 'multi' spelling normalizing to isolated", () => {
    process.env.OS_TENANCY_POSTURE = 'multi';
    expect(resolveTenancyPostureOrRefusal()).toEqual({ ok: true, posture: 'isolated' });
  });

  it('unset falls back to the OS_MULTI_ORG_ENABLED derivation, not to a refusal', () => {
    expect(resolveTenancyPostureOrRefusal()).toEqual({ ok: true, posture: 'single' });

    process.env.OS_MULTI_ORG_ENABLED = 'true';
    expect(resolveTenancyPostureOrRefusal()).toEqual({ ok: true, posture: 'isolated' });
  });

  it('treats a blank value as unset — a gate that refused it would break `OS_TENANCY_POSTURE=` in a .env', () => {
    process.env.OS_TENANCY_POSTURE = '   ';
    expect(resolveTenancyPostureOrRefusal()).toEqual({ ok: true, posture: 'single' });
  });
});

describe('resolveTenancyPostureOrRefusal — the refusal', () => {
  it('REFUSES AS A VALUE, never as a throw — the property the AuthPlugin catch destroyed', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';

    // The point of the whole change. `resolveTenancyPosture()` throws here; if
    // this wrapper let that escape, any enclosing `try` — and serve has a broad
    // one — could turn "refuse to boot" back into a yellow warning, which is
    // precisely what shipped. A verdict cannot be caught.
    expect(() => resolveTenancyPostureOrRefusal()).not.toThrow();

    const verdict = resolveTenancyPostureOrRefusal();
    expect(verdict.ok).toBe(false);
  });

  it('names the fact: FATAL, the variable, and the value the operator actually typed', () => {
    process.env.OS_TENANCY_POSTURE = 'islolated'; // a real transposition typo
    const verdict = resolveTenancyPostureOrRefusal();
    if (verdict.ok) throw new Error('expected a refusal');

    const text = plain(verdict.fatal);
    expect(text).toContain('FATAL');
    expect(text).toContain('OS_TENANCY_POSTURE="islolated"');
    expect(text).toContain('Refusing to boot');

    // Not an AuthPlugin problem, not a plugin problem at all. The misattribution
    // is the defect; the word must not reappear in the refusal.
    expect(text).not.toContain('AuthPlugin');
  });

  it('prescribes a way out for EVERY posture the vocabulary declares (drift guard)', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const verdict = resolveTenancyPostureOrRefusal();
    if (verdict.ok) throw new Error('expected a refusal');

    const text = plain(verdict.fatal);
    // Generated from TENANCY_POSTURES rather than restated, so a posture added
    // to the spec cannot leave this advice quietly incomplete.
    for (const posture of TENANCY_POSTURES) {
      expect(text).toContain(`set OS_TENANCY_POSTURE=${posture}`);
    }
    // …plus the escape the enumeration cannot express.
    expect(text).toContain('unset OS_TENANCY_POSTURE');
    expect(text).toContain('OS_MULTI_ORG_ENABLED');
  });

  it('points at .env files, the source a shell-only search misses', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const verdict = resolveTenancyPostureOrRefusal();
    if (verdict.ok) throw new Error('expected a refusal');

    // The gate is deliberately placed AFTER dotenv-flow's load, so a value from
    // a committed `.env*` reaches it. Saying so is what stops the next operator
    // grepping only their shell profile.
    expect(plain(verdict.fatal)).toContain('.env');
  });

  it('carries the resolver\'s own sentence as `cause` rather than paraphrasing it', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const verdict = resolveTenancyPostureOrRefusal();
    if (verdict.ok) throw new Error('expected a refusal');

    // `@objectstack/types` owns the vocabulary and its wording; serve must not
    // maintain a second copy that can disagree with it.
    expect(plain(verdict.fatal)).toContain('cause: Invalid OS_TENANCY_POSTURE="bogus"');
  });

  it('states that nothing was loaded and nothing was served', () => {
    process.env.OS_TENANCY_POSTURE = 'bogus';
    const verdict = resolveTenancyPostureOrRefusal();
    if (verdict.ok) throw new Error('expected a refusal');

    const text = plain(verdict.fatal);
    // Only honest because the gate runs at the top of `run()` — the ordering
    // test below is what keeps these two sentences true.
    expect(text).toContain('No config has been loaded');
    expect(text).toContain('the HTTP server was\n    never started');

    // And deliberately NOT the stronger "no port has been bound": serve probes
    // port availability (bind + close) just above the gate. Overclaiming by one
    // word is how a diagnostic stops being trustworthy.
    expect(text).not.toContain('no port has been bound');
  });
});

describe('the gate runs before serve does ANY boot work', () => {
  /**
   * The ordering assertion, run against the real `serve` command in-process.
   *
   * This is the one that would have caught #5359. Before the fix, an invalid
   * posture got as far as `Loading objectstack.config.ts…`, the whole plugin
   * slate, a persisted dev crypto key and a degraded kernel bootstrap before
   * anything refused. After it, `run()` reaches the gate and stops: the FATAL
   * is the only thing written, and the diagnostic stream — where every
   * subsequent boot step reports — carries nothing else.
   *
   * That stream is **stderr** since #7915 (`serve` keeps stdout clear for the
   * MCP stdio transport), so the capture below watches `process.stderr.write`
   * rather than `console.log`. Watching `console.log` here would now be a
   * phantom check: no boot step writes there any more, so the assertion could
   * never fail, whatever the gate did.
   *
   * Note what is deliberately NOT asserted: "the port never listened". That was
   * true before the fix too (the escaping throw aborted kernel Phase 1, while
   * the socket only opens in Phase 4), so asserting it would pass for reasons
   * having nothing to do with this change. "No boot work happened at all" is
   * strictly stronger and actually moved.
   */
  it('refuses before the config file is even read, and writes nothing else', async () => {
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.OS_TENANCY_POSTURE = 'bogus';

    const errors: string[] = [];
    const diagnostics: string[] = [];
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.join(' '));
    });
    // Everything `serve` prints, at the stream: its own `printDiagnostic` lines
    // AND anything the redirect installed at the top of `run()` forwards there.
    const stdoutWrite = process.stdout.write;
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown) => {
        diagnostics.push(String(chunk));
        return true;
      }) as typeof process.stderr.write);
    // The gate exits the PROCESS on purpose (a throw is what the broad
    // AuthPlugin catch used to swallow). Convert it to something catchable so
    // the test runner survives, and assert it was reached.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT__:${code}`);
    }) as never);

    let raised: unknown;
    try {
      // `--dev` keeps the port-availability probe on the auto-shift path so a
      // busy port in CI cannot pre-empt the gate we are measuring.
      await Serve.run(['--dev', '--port', '39871'], { root: CLI_ROOT });
    } catch (err) {
      raised = err;
    } finally {
      errSpy.mockRestore();
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
      // `run()` reserves stdout for the process's lifetime (#7915). Harmless in
      // the real one-shot CLI; in a vitest worker it would outlive this case,
      // so put the stream back.
      process.stdout.write = stdoutWrite;
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }

    // Refused via process.exit(1), not by throwing into a catchable boot path.
    expect((raised as Error | undefined)?.message).toBe('__PROCESS_EXIT__:1');

    const stderr = plain(errors.join('\n'));
    expect(stderr).toContain('FATAL');
    expect(stderr).toContain('OS_TENANCY_POSTURE="bogus"');

    // ── The ordering facts ────────────────────────────────────────────────
    // serve announces the config load as its first boot step. It is absent, so
    // the gate preceded it — and therefore preceded every plugin load, the
    // kernel bootstrap and the listening socket that follow it.
    expect(plain(diagnostics.join('\n'))).not.toContain('Loading');
    // Nothing at all was printed by a boot step, in fact: the FATAL — written
    // with `console.error`, which the spy above takes before it reaches the
    // stream — is the whole output.
    expect(diagnostics).toEqual([]);

    // The misattribution that made this issue expensive to diagnose is gone:
    // no warning blames a plugin for an environment-variable typo.
    expect(stderr).not.toContain('AuthPlugin failed to load');
    // 60s, not the 5s default: unlike the ten message-only cases above, this one
    // imports and runs the REAL serve command in-process — the whole serve
    // module graph plus a port-availability probe. On a lightly-loaded PR shard
    // that costs a moment; on the merge queue's full-suite runner, sharing a
    // shard with the serve e2e tests (vitest reported import 94.8s / tests 282s
    // for that shard), it blew the 5s default and this case timed out — queue
    // run 30971902650, which is what took the PR out of the queue. Same posture
    // as the existing `}, 60_000)` cases in this package
    // (`utils/sqlite-occupancy.test.ts`, `utils/schema-migrate.deferred-ddl.
    // integration.test.ts`) and as #4856's package-level `testTimeout`.
    // Superficially the #4796 5000ms signature, but a different cause: that
    // family was the spec template suite, already fixed.
  }, 60_000);
});
