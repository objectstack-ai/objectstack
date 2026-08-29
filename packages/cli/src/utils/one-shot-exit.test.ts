// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13027 — the exit primitive, pinned where the e2e cannot look.
 *
 * `test/migrate-plan-exits.e2e.test.ts` owns the end-to-end fact (a real child
 * returns). This file owns the two properties that make that safe and which a
 * child process cannot show you: the streams are DRAINED before the exit — the
 * pipe-truncation `emitJson` exists to prevent, re-introduced one statement
 * later would be invisible from outside — and the drain cannot itself hang.
 */

import { describe, it, expect, vi } from 'vitest';
import { exitOneShotCommand } from './one-shot-exit.js';

/** A stream whose no-op write callback fires, in order, when told to. */
function drainableStream() {
  const pending: Array<() => void> = [];
  return {
    writes: 0,
    write(_chunk: string, cb?: () => void) {
      this.writes++;
      if (cb) pending.push(cb);
      return true;
    },
    flush() { for (const cb of pending.splice(0)) cb(); },
  };
}

describe('exitOneShotCommand (#13027)', () => {
  it('drains every stream before it exits', async () => {
    const out = drainableStream();
    const err = drainableStream();
    const order: string[] = [];
    const exit = vi.fn((code: number) => { order.push(`exit:${code}`); return undefined as never; });

    const promise = exitOneShotCommand(0, { streams: [out, err], exit });

    // Not yet: the streams have been asked to drain and have not answered.
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    expect(out.writes).toBe(1);
    expect(err.writes).toBe(1);

    out.flush();
    err.flush();
    await promise;
    expect(order).toEqual(['exit:0']);
  });

  it('carries the exit code through', async () => {
    const exit = vi.fn(() => undefined as never);
    await exitOneShotCommand(1, { streams: [], exit });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits anyway when a stream never drains', async () => {
    // A pipe whose reader has gone away never drains. This function's whole
    // job is to stop a command from failing to return, so it must not become a
    // second way to do exactly that.
    const stuck = { write: () => true }; // callback never invoked
    const exit = vi.fn(() => undefined as never);
    const timers: Array<() => void> = [];
    const setTimeoutFn = ((fn: () => void) => {
      timers.push(fn);
      return { unref() { /* noop */ } };
    }) as unknown as typeof setTimeout;

    const promise = exitOneShotCommand(0, { streams: [stuck], exit, setTimeoutFn });
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    // The budget expires.
    for (const fire of timers) fire();
    await promise;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('tolerates a stream that throws on write, and one that is absent', async () => {
    const exit = vi.fn(() => undefined as never);
    const throwing = { write() { throw new Error('EPIPE'); } };
    await exitOneShotCommand(0, { streams: [throwing, undefined], exit });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
