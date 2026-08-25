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
//     `target.error(...)` — `target` being the engine's own logger, which the
//     kernel built from its `logger` config and handed over BY REFERENCE. So
//     the pass-through is subject to that logger's level: `ObjectLogger.write`
//     returns early unless `LEVEL_ORDER.error >= LEVEL_ORDER[config.level]`,
//     which is false for `fatal` and for `silent`.
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
// The engine pass-through's destination under `environment: 'node'` is
// `process.stderr` (`ObjectLogger.write` prefers the process streams and only
// falls back to `console` where they are absent — the same finding the sibling
// module's #11571 block records). So the engine channel is counted by patching
// `process.stderr.write`, and the driver channel by spying `console.warn`.
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

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD, not inside a clocked `it()` body — see
// `scripts/check-test-source-alias.mjs` (the clocked-window rule).
import '@objectstack/objectql';
import '@objectstack/driver-sqlite-wasm';

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
  /** `process.stderr` lines carrying the engine's `Find operation failed`. */
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
  const stderr: string[] = [];

  const realWarn = console.warn;
  const realError = console.error;
  const realWrite = process.stderr.write.bind(process.stderr);

  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  console.error = (...args: unknown[]): void => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => {
    stderr.push(String(chunk));
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
    (process.stderr as { write: unknown }).write = realWrite;
    console.warn = realWarn;
    console.error = realError;
  }

  return {
    rejected,
    driverPassThrough: warnings.filter((l) => l.includes(`refused a read on '${table}'`)).length,
    enginePassThrough: stderr.filter((l) => l.includes('Find operation failed')).length,
    withheldRefusals: capture?.totalRefusals() ?? -1,
    withheldEngineFrames: capture?.totalEngineFrames() ?? -1,
    silentChannels: capture?.silentChannels() ?? ['probe never built a capture'],
  };
}

describe('#11569 expected-read-refusal-noise: the two channels are not equally loud on pass-through', () => {
  it(
    'engine pass-through: a level ABOVE `error` (silent) drops the frame, while the driver stays loud',
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
    'engine pass-through: the SAME unrecognised read is loud at `error` — the instrument produces a positive',
    async () => {
      const seen = await probeRead('error', UNDECLARED_TABLE, [DECLARED_TABLE]);

      expect(seen.rejected).toBe(true);
      expect(seen.withheldEngineFrames).toBe(0);
      expect(seen.driverPassThrough).toBeGreaterThanOrEqual(1);
      // ⭐ The negative above is a real measurement and not a broken probe:
      // the identical read on the identical composition DOES reach the log
      // when the kernel's level admits `error`.
      expect(seen.enginePassThrough).toBeGreaterThanOrEqual(1);
    },
    BOOT_TIMEOUT,
  );

  it(
    'engine pass-through: the condition is the LEVEL THRESHOLD, not the word `silent` — `fatal` drops it too',
    async () => {
      // `ObjectLogger.isEnabled` compares rank: `error` (3) is admitted only
      // while the configured level is `debug`/`info`/`warn`/`error`. `fatal`
      // (4) and `silent` (5) both refuse it, so a fixture that floats its
      // kernel to `fatal` is just as blind as one at `silent`.
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
