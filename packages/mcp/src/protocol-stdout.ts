// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Writable } from 'node:stream';

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
