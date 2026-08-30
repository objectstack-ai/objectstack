// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11569 — the two captures in `expected-read-refusal-noise.ts` do NOT have the
// same PASS-THROUGH loudness, and this file is the measurement that says so.
//
// ## What is pinned, and why prose alone would not have been enough
//
// That module's header used to claim, of both channels, that "anything it does
// not recognise still reaches the log". It holds on the driver channel and not
// on the engine channel:
//
//   * `captureDriver` installs a sink whose non-matching branch calls
//     `console.warn` / `console.error` DIRECTLY, so an unrecognised driver
//     refusal is loud no matter how the kernel's logger is configured;
//   * `captureEngine` installs a Proxy whose non-matching branch calls
//     `target.error(...)` / `target.debug(...)` — `target` being the engine's
//     own logger, which the kernel built from its `logger` config and handed
//     over BY REFERENCE. So the pass-through is subject to that logger's level:
//     `ObjectLogger.write` returns early unless
//     `LEVEL_ORDER[frame] >= LEVEL_ORDER[config.level]`.
//
// ⚠️ [#13273] The frame this probe provokes is a MISSING TABLE, and `engine.ts`
// now classifies that class onto `debug` rather than `error` (its own
// `reportFindFailure`). Two mechanical consequences for this instrument, both
// measured rather than reasoned:
//
//   * the threshold the engine channel is compared against is `debug` (rank 0),
//     not `error` (rank 3) — so the positive control below probes at `debug`,
//     which is the level that admits this frame, where `error` used to be;
//   * `ObjectLogger.write` sends `error`/`fatal` to `process.stderr` and every
//     other level to `process.stdout`, so the instrument patches BOTH streams
//     and counts their union. Patching stderr alone would have read the
//     demotion as "the frame stopped being emitted" — a false negative that
//     looks exactly like the thing this file exists to detect.
//
// The asymmetry itself is unchanged in shape and is what stays pinned: the
// driver channel is loud at any level, the engine channel is only as loud as
// the fixture's own kernel logger.
//
// The correction #11569 ruled is a documentation one — no behaviour moves, no
// consuming fixture goes loud. This file is what keeps that documentation
// HONEST: the sentences in the module header are now claims about a measured
// threshold, and a change to either sink (or to `ObjectLogger.isEnabled`) that
// invalidates one of them turns this red instead of leaving prose behind that
// nobody re-measures.
//
// ⭐ Every case here is GREEN both before and after #11569's edit — the edit
// changed comments only. These are regression guards on the behaviour the new
// prose describes, never red-before evidence for it.
//
// ## The instrument, and its deliberate limits
//
// The engine pass-through's destination under `environment: 'node'` is a
// process stream (`ObjectLogger.write` prefers them and only falls back to
// `console` where they are absent — the same finding the sibling module's
// #11571 block records): `process.stderr` for `error`/`fatal`, `process.stdout`
// for everything else. So the engine channel is counted by patching BOTH
// stream writers, and the driver channel by spying `console.warn`.
//
// ⛔ That patch is an INSTRUMENT here, not a capture mechanism: it is installed
// around one probe kernel's lifetime and removed in a `finally`, which is a
// different thing from the file-scoped `process.stderr` capture #11571 refuses
// on blast-radius grounds. It also covers `bootstrap()` and `shutdown()` on
// purpose — boot-time fail-soft reads of this lean composition would otherwise
// print the very noise `expected-read-refusal-noise.ts` exists to withhold, and
// a probe that measures noise by emitting some is not one.

import { describe, it, expect } from 'vitest';
import type { LogLevel } from '@objectstack/spec/system';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { DriverPlugin } from './driver-plugin.js';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';

// [#10126] Both dist-resolved workspace deps above are STATIC imports, so their
// first transform is already paid at module load rather than inside a clocked
// `it()` body — no bare re-import is needed here (see
// `scripts/check-test-source-alias.mjs`, the clocked-window rule).

const BOOT_TIMEOUT = 60_000;

/** Read by the probe, and DECLARED to the capture: the recognised pair. */
const DECLARED_TABLE = 'probe_11569_declared';
/** Read by the probe, and NOT declared: the unrecognised pair. */
const UNDECLARED_TABLE = 'probe_11569_undeclared';

interface Readout {
  /** Did the read reject at all? A silent success would invalidate everything. */
  readonly rejected: boolean;
  /** `console.warn` lines naming the driver's refusal envelope for `table`. */
  readonly driverPassThrough: number;
  /**
   * Process-stream lines carrying the engine's `Find operation failed`, from
   * `stderr` and `stdout` together — [#13273] the frame's level decides which
   * of the two it lands on, and this file measures whether a reader saw it at
   * all, not which pipe carried it.
   */
  readonly enginePassThrough: number;
  /** What the capture withheld and counted, per channel. */
  readonly withheldRefusals: number;
  readonly withheldEngineFrames: number;
  readonly silentChannels: readonly string[];
}

/**
 * Boot a lean real kernel at `level`, read `table` through the real engine and
 * the real sqlite driver, and count what each channel's PASS-THROUGH put in
 * front of a reader.
 *
 * `declared` is what the capture was told to expect, so the caller chooses
 * whether the resulting pair is recognised (`declared` contains `table`) or
 * not.
 */
async function probeRead(
  level: LogLevel,
  table: string,
  declared: readonly string[],
): Promise<Readout> {
  const warnings: string[] = [];
  const streamed: string[] = [];

  const realWarn = console.warn;
  const realError = console.error;
  const realErrWrite = process.stderr.write.bind(process.stderr);
  const realOutWrite = process.stdout.write.bind(process.stdout);

  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  console.error = (...args: unknown[]): void => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => {
    streamed.push(String(chunk));
    return true;
  };
  (process.stdout as { write: unknown }).write = (chunk: unknown): boolean => {
    streamed.push(String(chunk));
    return true;
  };

  let capture: ExpectedReadRefusalCapture | undefined;
  let rejected = false;
  let kernel: ObjectKernel | undefined;
  try {
    kernel = new ObjectKernel({ logger: { level } });
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    capture = captureExpectedReadRefusals(declared);
    // ⛔ Before the driver runs any statement — the idiom the capture's own
    // doc comment names.
    capture.captureDriver(driver);
    await kernel.use(new DriverPlugin(driver));
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    capture.captureEngine(kernel.getService<unknown>('objectql'));

    const data = kernel.getService<{ find(o: string): Promise<unknown[]> }>('data');
    try {
      await data.find(table);
    } catch {
      rejected = true;
    }
  } finally {
    try {
      await kernel?.shutdown();
    } catch {
      /* the probe's verdict does not depend on a clean teardown */
    }
    (process.stderr as { write: unknown }).write = realErrWrite;
    (process.stdout as { write: unknown }).write = realOutWrite;
    console.warn = realWarn;
    console.error = realError;
  }

  return {
    rejected,
    driverPassThrough: warnings.filter((l) => l.includes(`refused a read on '${table}'`)).length,
    enginePassThrough: streamed.filter((l) => l.includes('Find operation failed')).length,
    withheldRefusals: capture?.totalRefusals() ?? -1,
    withheldEngineFrames: capture?.totalEngineFrames() ?? -1,
    silentChannels: capture?.silentChannels() ?? ['probe never built a capture'],
  };
}

describe('#11569 expected-read-refusal-noise: the two channels are not equally loud on pass-through', () => {
  it(
    'engine pass-through: a level above the frame\'s own (silent) drops it, while the driver stays loud',
    async () => {
      const seen = await probeRead('silent', UNDECLARED_TABLE, [DECLARED_TABLE]);

      // The read really did fail — otherwise "no frame appeared" would be a
      // statement about a read that never refused.
      expect(seen.rejected).toBe(true);
      // Nothing was recognised: this is the PASS-THROUGH path on both channels.
      expect(seen.withheldRefusals).toBe(0);
      expect(seen.withheldEngineFrames).toBe(0);

      // The driver's pass-through goes to `console` directly — loud.
      expect(seen.driverPassThrough).toBeGreaterThanOrEqual(1);
      // The engine's pass-through goes to the kernel-derived logger — dropped.
      expect(seen.enginePassThrough).toBe(0);
    },
    BOOT_TIMEOUT,
  );

  it(
    'engine pass-through: the SAME unrecognised read is loud at `debug` — the instrument produces a positive',
    async () => {
      // [#13273] `debug` is the level that admits THIS frame: the probe reads a
      // table that does not exist, and `engine.ts` classifies that class onto
      // `debug`. Before #13273 the same control was run at `error`. The claim
      // under test is unchanged — "the engine channel is only as loud as the
      // kernel's own level" — only the rank it is compared against moved.
      const seen = await probeRead('debug', UNDECLARED_TABLE, [DECLARED_TABLE]);

      expect(seen.rejected).toBe(true);
      expect(seen.withheldEngineFrames).toBe(0);
      expect(seen.driverPassThrough).toBeGreaterThanOrEqual(1);
      // ⭐ The negative above is a real measurement and not a broken probe:
      // the identical read on the identical composition DOES reach the log
      // when the kernel's level admits the frame.
      expect(seen.enginePassThrough).toBeGreaterThanOrEqual(1);
    },
    BOOT_TIMEOUT,
  );

  it(
    'engine pass-through: the condition is the LEVEL THRESHOLD, not the word `silent` — `fatal` drops it too',
    async () => {
      // `ObjectLogger.isEnabled` compares rank: this frame ([#13273] `debug`,
      // rank 0) is admitted only while the configured level is `debug`.
      // `fatal` (4) and `silent` (5) both refuse it — as do `info` and `warn`
      // — so a fixture that floats its kernel to `fatal` is just as blind as
      // one at `silent`. The threshold, not the word `silent`, is the rule.
      const seen = await probeRead('fatal', UNDECLARED_TABLE, [DECLARED_TABLE]);

      expect(seen.rejected).toBe(true);
      expect(seen.driverPassThrough).toBeGreaterThanOrEqual(1);
      expect(seen.enginePassThrough).toBe(0);
    },
    BOOT_TIMEOUT,
  );

  it(
    'the surviving half is untouched: a RECOGNISED pair is still withheld on both channels and counted',
    async () => {
      const seen = await probeRead('silent', DECLARED_TABLE, [DECLARED_TABLE]);

      expect(seen.rejected).toBe(true);
      // Withheld, on both channels, and COUNTED — a capture nobody asserts is
      // a mute, and this is the assertion.
      expect(seen.withheldRefusals).toBeGreaterThanOrEqual(1);
      expect(seen.withheldEngineFrames).toBeGreaterThanOrEqual(1);
      expect([...seen.silentChannels]).toEqual([]);
      // …and neither channel put anything in front of a reader.
      expect(seen.driverPassThrough).toBe(0);
      expect(seen.enginePassThrough).toBe(0);
    },
    BOOT_TIMEOUT,
  );
});
