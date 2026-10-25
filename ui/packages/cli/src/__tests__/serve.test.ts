/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins two independent fixes to `serve` (objectui#4924):
 *
 * 1. `--no-open` — `serve` hardcoded Vite's `open: true` and had no flag to
 *    turn it off, unlike `dev` (which already ships `--no-open`). The
 *    default must not change: `serve` opens a browser today and must keep
 *    doing so when the flag is absent.
 * 2. The headless spawn failure — when the browser-open step fails (no
 *    `xdg-open`/opener binary available), Vite's own `openBrowser()`
 *    reports it via `logger.error(err.stack || err.message)` with no
 *    `{ timestamp: true }`, printing a bare Node stack with no `[vite]`
 *    prefix, no context, and — because that promise chain is fire-and-forget
 *    from `server.listen()` — on a *later* tick than our own success
 *    banner, reading like a crash even though the server is fine.
 *
 * ## Why there is no `vi.mock('vite')` here
 *
 * `packages/**\/*.test.ts` runs in the root `unit` Vitest project with
 * `isolate: false` (a shared module graph per worker, spanning every
 * package's `*.test.ts`, not just this one) — see the same note in
 * `project-source.test.ts`. Mocking `vite` there would leak into every
 * other file sharing the worker. So instead of letting `serve()` run to
 * completion against a real (or mocked) Vite server, both fixes are pinned
 * on the two pure, exported seams `serve.ts` pulls the logic into:
 * `resolveServeOpenOption` (the config value threading) and
 * `createServeLogger` (the spawn-failure interception) — neither imports or
 * touches the `vite` module's runtime behavior, so nothing needs mocking.
 *
 * `createServeLogger`'s fixture messages are not invented: they are the
 * literal shape a Node `ChildProcess` ENOENT error's `.stack` takes,
 * confirmed by both reading Vite 8.2.1's bundled
 * `src/node/server/openBrowser.ts` (`startBrowserProcess` catches the
 * failed `open(url)` and calls exactly `logger.error(err.stack ||
 * err.message)`) and a live repro: `createServer({ server: { open: true },
 * customLogger })` with `BROWSER` pointed at a nonexistent binary produced
 * verbatim
 *
 *   Error: spawn objectui-repro-nonexistent-opener ENOENT
 *       at ChildProcess._handle.onexit (node:internal/child_process:285:19)
 *       ...
 *
 * after the "✓ Server started successfully!" banner — exactly the ordering
 * and shape objectui#4924 reports, and exactly what `createServeLogger`
 * turns into the short contextual line below.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'vite';

import { createServeLogger, resolveServeOpenOption } from '../commands/serve.js';

describe('resolveServeOpenOption', () => {
  it('keeps the default of opening a browser when no flag is passed (options.open undefined)', () => {
    expect(resolveServeOpenOption(undefined)).toBe(true);
  });

  it('keeps opening a browser when the flag resolves truthy (commander default for --no-open absent)', () => {
    expect(resolveServeOpenOption(true)).toBe(true);
  });

  it('suppresses the open when --no-open sets options.open to false', () => {
    expect(resolveServeOpenOption(false)).toBe(false);
  });
});

/** A minimal stand-in satisfying Vite's `Logger` shape, with spies on every method. */
function makeFakeBaseLogger(): Logger & {
  errorCalls: Array<[string, unknown]>;
} {
  const errorCalls: Array<[string, unknown]> = [];
  return {
    errorCalls,
    hasWarned: false,
    info: vi.fn(),
    warn: vi.fn(function (this: Logger) {
      this.hasWarned = true;
    }),
    warnOnce: vi.fn(),
    error: vi.fn(function (this: Logger, msg: string, opts?: unknown) {
      this.hasWarned = true;
      errorCalls.push([msg, opts]);
    }),
    clearScreen: vi.fn(),
    hasErrorLogged: vi.fn(() => false),
  };
}

describe('createServeLogger', () => {
  it('replaces the bare browser-open ENOENT stack with a short contextual line instead of forwarding it to the base logger', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const enoentStack =
      'Error: spawn xdg-open ENOENT\n' +
      '    at ChildProcess._handle.onexit (node:internal/child_process:285:19)\n' +
      '    at onErrorNT (node:internal/child_process:483:16)\n' +
      '    at process.processTicksAndRejections (node:internal/process/task_queues:89:21)';

    logger.error(enoentStack);

    // The raw stack must never reach the base logger (no bare stack after
    // the success banner).
    expect(base.errorCalls).toHaveLength(0);
    // Something contextual replaces it, naming the missing opener.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain('xdg-open');
    expect(printed).not.toContain('at ChildProcess._handle.onexit');

    logSpy.mockRestore();
  });

  it('still detects the failure when a different opener binary is named (Vite reads BROWSER; not Linux/xdg-open-specific)', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.error('Error: spawn open ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:285:19)');

    expect(base.errorCalls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0] as string).toContain('open');

    logSpy.mockRestore();
  });

  it('passes an unrelated error straight through to the base logger, unmodified (counter-probe: the interception is selective, not a blanket error swallow)', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const realError = 'Error: Port 5173 is already in use';
    const opts = { timestamp: true };
    logger.error(realError, opts);

    expect(base.errorCalls).toEqual([[realError, opts]]);
    // No extra contextual console.log for a message that isn't the
    // browser-open failure.
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('passes a spawn ENOENT for something that is not the browser opener through unmodified (counter-probe: pattern is anchored, not a bare "ENOENT" substring match)', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Not vite's `Error: spawn <cmd> ENOENT` shape (no "Error: spawn" prefix) —
    // must not be swallowed just because "ENOENT" appears somewhere in it.
    const unrelated = 'Failed to read config: open /tmp/vite.config.ts ENOENT';
    logger.error(unrelated);

    expect(base.errorCalls).toEqual([[unrelated, undefined]]);
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('delegates info/warn/warnOnce/clearScreen/hasErrorLogged to the base logger unchanged', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);

    logger.info('hello', { timestamp: true });
    expect(base.info).toHaveBeenCalledWith('hello', { timestamp: true });

    logger.warn('careful');
    expect(base.warn).toHaveBeenCalledWith('careful', undefined);

    logger.warnOnce('once');
    expect(base.warnOnce).toHaveBeenCalledWith('once', undefined);

    logger.clearScreen('info');
    expect(base.clearScreen).toHaveBeenCalledWith('info');

    const err = new Error('x');
    logger.hasErrorLogged(err);
    expect(base.hasErrorLogged).toHaveBeenCalledWith(err);
  });

  it('mirrors hasWarned live from the base logger rather than freezing it at construction time', () => {
    const base = makeFakeBaseLogger();
    const logger = createServeLogger(base);

    expect(logger.hasWarned).toBe(false);
    base.warn('something');
    expect(logger.hasWarned).toBe(true);
  });
});
