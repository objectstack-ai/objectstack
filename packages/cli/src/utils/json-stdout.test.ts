// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stdout reservation `--json` is built on (#6217), at the unit level.
 *
 * `packages/cli/test/json-stdout-purity.e2e.test.ts` pins the contract this
 * serves — every `--json` command in the `bootSchemaStack` family emitting one
 * parseable JSON document — over real child processes. This file pins the
 * mechanism underneath it, including the two properties that make the contract
 * hold rather than merely look held:
 *
 *   1. a reservation catches EVERY stdout writer, not just `ObjectLogger`
 *      (`console.log` is how `[StandaloneStack] no compiled artifact …`
 *      reaches stdout, and it never passes through the kernel logger at all);
 *   2. the payload writer still reaches the REAL stdout while a reservation is
 *      in force — a reservation that also swallowed the payload would produce
 *      an empty stdout, which `JSON.parse` rejects just as loudly.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Console } from 'node:console';
import { isStdoutReserved, reserveStdoutForJson, writeStdoutDirect } from './json-stdout.js';

/**
 * A `console` bound to the process streams, because the GLOBAL one is not
 * usable as evidence here: vitest replaces `globalThis.console` with its own
 * reporter sink, so a `console.log` inside a worker never reaches
 * `process.stdout.write` at all and would prove nothing either way.
 *
 * This is the same mechanism Node's own global console uses — hold the stream,
 * call `stream.write(...)` per record — so it exercises exactly the property
 * the reservation replaces. The end-to-end proof that the REAL global console
 * is covered is `packages/cli/test/json-stdout-purity.e2e.test.ts`, which runs
 * the CLI as a child process and pins `[StandaloneStack] no compiled artifact`
 * (a bare `console.log` in `@objectstack/runtime`) onto stderr.
 */
const streamConsole = new Console(process.stdout, process.stderr);

/**
 * Spy on both streams and hand back what each received.
 *
 * The stdout spy is installed BEFORE the reservation on purpose: a reservation
 * captures whatever `process.stdout.write` is at that moment, so the spy is
 * what {@link writeStdoutDirect} ends up calling, and "reached the real stdout"
 * becomes an assertion instead of an inference.
 */
function spyStreams() {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any, ...rest: any[]) => {
    const cb = rest.find((a) => typeof a === 'function');
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: any, ...rest: any[]) => {
    const cb = rest.find((a) => typeof a === 'function');
    if (cb) cb();
    return true;
  }) as typeof process.stderr.write);
  const text = (spy: typeof stdout) => spy.mock.calls.map((c) => String(c[0])).join('');
  return { stdout, stderr, stdoutText: () => text(stdout), stderrText: () => text(stderr) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reserveStdoutForJson — stdout goes to stderr, nothing is destroyed', () => {
  it('forwards direct writes AND console.log/info/debug to stderr', () => {
    const streams = spyStreams();
    const release = reserveStdoutForJson();
    try {
      process.stdout.write('direct write\n');
      // The three console methods Node binds to stdout. `console.log` is the
      // one that matters most here: `loadArtifactBundle` announces a missing
      // compiled artifact through it, so a fix that only reached the kernel
      // logger would still leave that line on stdout.
      streamConsole.log('console.log');
      streamConsole.info('console.info');
      streamConsole.debug('console.debug');
    } finally {
      release();
    }

    const onStderr = streams.stderrText();
    for (const line of ['direct write', 'console.log', 'console.info', 'console.debug']) {
      expect(onStderr).toContain(line);
      expect(streams.stdoutText()).not.toContain(line);
    }
  });

  it('keeps the drain callback, so a caller awaiting the write still resumes', async () => {
    spyStreams();
    const release = reserveStdoutForJson();
    try {
      await new Promise<void>((resolve, reject) => {
        process.stdout.write('needs a callback\n', (err) => (err ? reject(err) : resolve()));
      });
    } finally {
      release();
    }
    // Reaching here at all is the assertion: `emitJson` awaits exactly this
    // callback, and a forwarder that dropped it would hang the CLI forever
    // rather than print a wrong byte.
    expect(true).toBe(true);
  });

  it('lets the payload through to the real stdout while the reservation holds', async () => {
    const streams = spyStreams();
    const release = reserveStdoutForJson();
    try {
      streamConsole.log('boot chatter');
      await writeStdoutDirect('{"payload":true}\n');
    } finally {
      release();
    }

    expect(streams.stdoutText()).toBe('{"payload":true}\n');
    expect(streams.stderrText()).toContain('boot chatter');
    // The whole point, restated as the consumer sees it.
    expect(JSON.parse(streams.stdoutText())).toEqual({ payload: true });
  });

  it('releases back to the exact write it took', () => {
    const before = process.stdout.write;
    expect(isStdoutReserved()).toBe(false);
    const release = reserveStdoutForJson();
    expect(isStdoutReserved()).toBe(true);
    expect(process.stdout.write).not.toBe(before);
    release();
    expect(isStdoutReserved()).toBe(false);
    // `.bind()` makes a new function object, so identity cannot be asserted;
    // behaviour can — the stream is stdout's again.
    const streams = spyStreams();
    process.stdout.write('after release\n');
    expect(streams.stdoutText()).toContain('after release');
    expect(streams.stderrText()).not.toContain('after release');
  });

  it('an inner reservation releases nothing — the outer one owns the stream', () => {
    const streams = spyStreams();
    const outer = reserveStdoutForJson();
    const inner = reserveStdoutForJson();
    try {
      inner(); // must be a no-op: the outer reservation is still in force
      process.stdout.write('still reserved\n');
      expect(streams.stderrText()).toContain('still reserved');
      expect(streams.stdoutText()).not.toContain('still reserved');
    } finally {
      outer();
    }
    expect(isStdoutReserved()).toBe(false);
  });
});

describe('writeStdoutDirect — outside a reservation it is plain stdout', () => {
  it('writes to stdout when nothing is reserved', async () => {
    const streams = spyStreams();
    await writeStdoutDirect('unreserved\n');
    expect(streams.stdoutText()).toContain('unreserved');
    expect(streams.stderrText()).toBe('');
  });
});
