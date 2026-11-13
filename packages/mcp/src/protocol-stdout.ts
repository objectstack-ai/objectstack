// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Writable } from 'node:stream';

/**
 * The mark {@link protocolStdout} leaves on `process.stdout` when a stdio
 * transport claims it: from that moment this process is SERVING, and whatever
 * it writes may be the output of a call rather than of its boot.
 *
 * Who reads it: a host that holds its boot output back for a while. `os serve`
 * keeps a boot-quiet window open until `runtime.start()` returns, so the
 * banner is not buried under boot chatter (`packages/cli/src/commands/serve.ts`).
 * A stdio client writes `initialize` at spawn and its first `tools/call` the
 * moment that is answered, so its calls are served while that window is still
 * open: everything a host plugin `console.log`ged from them was dropped with
 * the chatter, on stdout and stderr alike. The window ends for a host's console
 * when it reads this mark — and only then, so an HTTP-only boot keeps its quiet
 * window exactly as before.
 *
 * Registered with `Symbol.for`, so a second copy of this package in the
 * process (an ESM and a CJS load, two versions) writes the same key, and a host
 * can read it without importing this package. The key is pinned on both sides
 * (this package's `protocol-stdout.test.ts`, and the CLI's stdio purity e2e,
 * which boots the real transport).
 */
export const PROTOCOL_STDOUT_CLAIM: unique symbol = Symbol.for('@objectstack/mcp:protocol-stdout-claimed');

/**
 * The stdout channel the **stdio MCP transport** writes its JSON-RPC frames to
 * (#7915).
 *
 * ## Why this is not just `process.stdout`
 *
 * A stdio MCP session multiplexes nothing: stdout carries the protocol and
 * NOTHING else, because the framing is newline-delimited JSON and a conforming
 * client `JSON.parse`s every line it reads. A host that boots this plugin
 * therefore has to put its own banners, boot progress and kernel logs somewhere
 * else — and the only way to move `ObjectLogger` and every stray `console.log`
 * in one place is to intercept `process.stdout.write` itself (`LoggerConfig`
 * has a level but no destination knob). `os serve` does exactly that,
 * unconditionally, for the whole life of the process
 * (`packages/cli/src/utils/json-stdout.ts`).
 *
 * That interception is an OWN property on the `process.stdout` instance, and
 * `StdioServerTransport.send()` resolves `this._stdout.write` per frame — so a
 * transport constructed with the default `process.stdout` would have its frames
 * forwarded to stderr along with the diagnostics, and the session would go
 * silent in a way that reads exactly like #7645 (started, never answers).
 *
 * So the protocol channel is taken from the stream's PROTOTYPE: the same
 * `write` implementation `process.stdout.write` normally resolves to, reached
 * past any instance-level interception, with the real stream as `this` — real
 * fd, real backpressure, no reimplementation of Node's stdout.
 *
 * ## Why the transport claims it unconditionally
 *
 * The alternative is for the host to hand its transport a channel ("the CLI
 * knows it redirected stdout, so it passes the real one in"). That makes the
 * protocol work or not work depending on WHO constructed the plugin — a
 * user-authored `plugins: [new MCPServerPlugin()]` under the same `os serve`
 * would be swallowed, silently. The transport owns stdout in every host by
 * contract, so it holds the channel in every host too.
 *
 * ## Backpressure
 *
 * `write()` returns the real stream's boolean and `once('drain', …)` is
 * delegated to the real stream, which is the whole surface the SDK transport
 * uses (`if (this._stdout.write(json)) resolve(); else this._stdout.once('drain', resolve)`).
 */
export function protocolStdout(): Writable {
  const stdout = process.stdout as unknown as {
    write: (chunk: string | Uint8Array, ...rest: unknown[]) => boolean;
    once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };

  // Say so on the stream, BEFORE the transport can read its first request: the
  // caller attaches stdin only after this returns, so no call can be served
  // while the mark is still missing. See {@link PROTOCOL_STDOUT_CLAIM}.
  (stdout as unknown as Record<symbol, unknown>)[PROTOCOL_STDOUT_CLAIM] = true;

  // The prototype's `write`, i.e. the one an instance-level interception
  // replaced. Falls back to the instance property when there is no prototype
  // implementation to reach (never true for Node's stdout — TTY, pipe and file
  // all inherit `write` — but a fallback beats a throw in an exotic runtime).
  const proto = Object.getPrototypeOf(stdout) as { write?: typeof stdout.write } | null;
  const directWrite = typeof proto?.write === 'function' ? proto.write : stdout.write;

  const channel = {
    write(chunk: string | Uint8Array, ...rest: unknown[]): boolean {
      return directWrite.call(stdout, chunk, ...rest);
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      stdout.once(event, listener);
      return channel;
    },
  };

  return channel as unknown as Writable;
}
