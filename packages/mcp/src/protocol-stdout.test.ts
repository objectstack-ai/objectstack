// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7915 — the stdio transport's channel survives a host that redirects stdout.
 *
 * `os serve` forwards everything written to `process.stdout` to stderr, for the
 * whole life of the process, so its banner and the kernel's logs cannot corrupt
 * the newline-delimited JSON the stdio transport speaks. That interception is
 * an own property on `process.stdout`, and `StdioServerTransport.send()`
 * resolves `this._stdout.write` per frame — so a transport left on the default
 * `process.stdout` loses every frame to stderr.
 *
 * These cases are the two halves of that: frames reach the real stream even
 * while an interception is installed, and the interception still catches
 * everything else.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { protocolStdout } from './protocol-stdout.js';

type StreamWrite = (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;

const originalWrite = process.stdout.write;

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe('protocolStdout (#7915)', () => {
  it('writes past an instance-level `process.stdout.write` interception', () => {
    const swallowed: string[] = [];
    const real: string[] = [];

    // Stand in for the real stream underneath, so the assertion does not depend
    // on this test process's actual fd 1.
    const proto = Object.getPrototypeOf(process.stdout) as { write: StreamWrite };
    const protoWrite = proto.write;
    proto.write = function patchedProto(this: unknown, chunk: string | Uint8Array) {
      real.push(String(chunk));
      return true;
    } as StreamWrite;

    // The host's redirect: an OWN property, exactly as `redirectStdoutToStderr`
    // installs it.
    process.stdout.write = ((chunk: string | Uint8Array) => {
      swallowed.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const channel = protocolStdout();
      channel.write('{"jsonrpc":"2.0","id":1,"result":{}}\n');

      // The frame went to the real stream…
      expect(real).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}\n']);
      // …and NOT into the host's diagnostics forwarder.
      expect(swallowed).toEqual([]);

      // The interception is still in force for everyone else — the channel is a
      // hole for the protocol, not a release of the redirect.
      process.stdout.write('a banner line\n');
      expect(swallowed).toEqual(['a banner line\n']);
    } finally {
      proto.write = protoWrite;
    }
  });

  it('reports the real stream\'s backpressure and delegates `drain`', () => {
    const proto = Object.getPrototypeOf(process.stdout) as { write: StreamWrite };
    const protoWrite = proto.write;
    proto.write = (() => false) as StreamWrite;

    try {
      const channel = protocolStdout();
      // `false` is what makes the SDK transport wait for `drain` instead of
      // resolving — swallowing it would turn backpressure into lost frames.
      expect(channel.write('{"jsonrpc":"2.0"}\n')).toBe(false);

      let drained = false;
      channel.once('drain', () => {
        drained = true;
      });
      process.stdout.emit('drain');
      expect(drained).toBe(true);
    } finally {
      proto.write = protoWrite;
    }
  });
});
