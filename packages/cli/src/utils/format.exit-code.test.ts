// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `emitJson` / `emitText` write exactly two things: the payload, and
 * `process.exitCode`. This pins the second one (#4873).
 *
 * The defect these tests exist for was not a wrong value computed somewhere —
 * it was an ARGUMENT IN THE WRONG SLOT. `emitJson(payload, exitCode, opts)`
 * takes its exit code second, positionally, and `os migrate recorded-by --json`
 * / `os migrate resume --json` passed `timer.elapsed()` there: a duration in
 * milliseconds. A fully successful run therefore ended with
 * `process.exitCode = 531`, which the shell reports as `531 & 0xFF` = 19 — a
 * different non-zero code on every run, on a command whose JSON was correct and
 * whose stderr was empty.
 *
 * Two things are pinned here, and the second is the one that lasts:
 *
 *  1. the runtime contract — silence unless a caller asks for a failure code;
 *  2. that a `number` can no longer reach that slot AT ALL (`CliExitCode`),
 *     so the same mistake is a compile error rather than a false failure for
 *     every scripted caller.
 *
 * (2) lives in `src/` deliberately: `packages/cli/tsconfig.json` includes
 * `src`, so `pnpm typecheck` compiles this file and its `@ts-expect-error`
 * directives are real. The same test under `packages/cli/test/` would be a
 * phantom check — no tsc program reads that directory, so every directive in
 * it would evaluate never and deleting them would leave every gate green.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emitJson, emitText } from './format.js';

/** Whatever the runner was holding before this file ran — restored after each case. */
const OUTER_EXIT_CODE = process.exitCode;

describe('emitJson / emitText — process.exitCode (#4873)', () => {
  let written: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    written = [];
    // The real write must still invoke its callback: `emitText` awaits it, and
    // that await is the whole point of the function (the #3512 pipe-truncation
    // fix). A mock that swallows the callback hangs the test instead of failing
    // it.
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: unknown,
      encodingOrCb: unknown,
      maybeCb: unknown,
    ) => {
      written.push(String(chunk));
      const done = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
      if (typeof done === 'function') done();
      return true;
    }) as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.exitCode = OUTER_EXIT_CODE;
  });

  it('leaves the exit code alone on the success path', async () => {
    await emitJson({ planId: 'x', pending: 0, applied: false, duration: 531 });

    expect(JSON.parse(written.join(''))).toMatchObject({ pending: 0, duration: 531 });
    expect(process.exitCode).toBe(0);
  });

  it('still records a failure when one is asked for — the other direction', async () => {
    await emitJson({ error: 'confirmation_required' }, 1, { compact: true });

    expect(process.exitCode).toBe(1);
    // Compact is a formatting choice; it must not change the exit contract.
    expect(written.join('')).toBe('{"error":"confirmation_required"}\n');
  });

  it('emitText carries the same contract — silent by default, 1 on request', async () => {
    await emitText('hello');
    expect(process.exitCode).toBe(0);

    await emitText('goodbye', 1);
    expect(process.exitCode).toBe(1);
  });

  /**
   * The regression pin, written as the mistake itself.
   *
   * Both `@ts-expect-error`s below are the gate: if someone widens
   * `CliExitCode` back to `number`, the directives become unused and tsc fails
   * on THEM — which is the only way a repo-wide guarantee like this can be
   * enforced from one file.
   *
   * The runtime half is kept because it is the evidence: with the type check
   * suppressed, the exact call `recorded-by.ts` used to make still reproduces
   * the defect verbatim, so this test states what the type is preventing
   * rather than merely asserting that it prevents something.
   *
   * The duration below is a LITERAL, and deliberately so (#6266). It used to
   * be read off a live clock — `createTimer()` then `timer.elapsed() + 531` —
   * which made the truncation assertion hold only while `elapsed()` returned
   * exactly `0`: one millisecond ticking between those two statements (there
   * is an `await emitJson(...)` in between) turned 531 into 532, `& 0xff` from
   * 19 into 20, and the case red on a machine that was merely busy. Nothing
   * this case pins is a function of how long anything took — neither the type
   * rejection nor Node's truncation of `process.exitCode` — so the clock
   * supplied a failure mode and no coverage whatsoever. A duration that never
   * varies still is one.
   */
  it('a duration can no longer reach the exit-code slot (#4873)', async () => {
    const durationMs = 531; // a plausible `os migrate` run, in milliseconds

    // @ts-expect-error — a `number` is not a `CliExitCode`. This is exactly the
    // call `migrate/recorded-by.ts` and `migrate/resume.ts` used to make.
    const asExitCode: Parameters<typeof emitJson>[1] = durationMs;
    expect(asExitCode).toBe(durationMs);

    // @ts-expect-error — same rejection at the call site, which is where it bit.
    await emitJson({ pending: 0, applied: false }, durationMs);

    // The defect itself, reproduced: the duration lands in the exit-code slot
    // verbatim, on a run whose JSON was correct and whose stderr was empty.
    expect(process.exitCode).toBe(durationMs);

    // And this is why the reported codes looked random rather than wrong: Node
    // truncates the exit status to 8 bits, so 531 leaves the process as 19 —
    // which is not one of the two codes this CLI defines, so every scripted
    // caller read a successful run as a failure it could not name.
    expect(durationMs & 0xff).toBe(19);
    const definedExitCodes = [0, 1]; // the whole of `CliExitCode`
    expect(definedExitCodes).not.toContain(durationMs & 0xff);
  });
});
