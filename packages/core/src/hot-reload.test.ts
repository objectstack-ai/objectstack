// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HotReloadManager } from './hot-reload.js';
import type { ObjectLogger } from './logger.js';
import type { Plugin } from './types.js';
import type { HotReloadConfigParsed } from '@objectstack/spec/kernel';
import { recordGuards, stillPinningTheLoop } from '@objectstack/refd-timer-testkit';

/** Records `error` reports; every other level is dropped. `child()` is self. */
function createRecordingLogger(errors: { message: string; error?: unknown }[]): ObjectLogger {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    trace: () => {},
    fatal: () => {},
    error: (message: string, meta?: Record<string, unknown>) => {
      errors.push({ message, error: meta?.error });
    },
    child: () => logger,
  };
  return logger as unknown as ObjectLogger;
}

describe('HotReloadManager', () => {
  let errors: { message: string; error?: unknown }[];
  let manager: HotReloadManager;

  beforeEach(() => {
    errors = [];
    manager = new HotReloadManager(createRecordingLogger(errors));
  });

  // #4952 — the shutdown timeout guard must not outlive the race it guards.
  //
  // Byte-for-byte the leak #4813 fixed in the kernel's startup guards
  // (PR #4874) and #4875 fixed in the periodic health checks (PR #4950): the
  // guard was armed and then abandoned, so a `destroy()` that finished in
  // milliseconds still pinned the event loop for the whole `shutdownTimeout`
  // — once per reload, per plugin.
  //
  // Everything below asserts the observable consequence, never the source:
  // "hot-reload.ts calls clearTimeout" is a tautology any refactor could
  // satisfy while still leaving the loop pinned.
  describe('Shutdown timeout guard does not outlive the race (#4952)', () => {
    /** A guard long enough that a single orphan is unmistakable. */
    const guardedConfig = (overrides: Partial<HotReloadConfigParsed> = {}): HotReloadConfigParsed =>
      ({
        enabled: true,
        debounceDelay: 1000,
        preserveState: false,
        stateStrategy: 'none',
        shutdownTimeout: 120_000,
        ...overrides,
      }) as HotReloadConfigParsed;

    const noState = () => ({});
    const noRestore = () => {};

    it("leaves no ref'd timer behind when destroy() wins the race", async () => {
      const calls = { count: 0 };
      const plugin = {
        name: 'guarded-plugin',
        version: '1.0.0',
        init: () => {},
        destroy: async () => {
          calls.count++;
        },
      } as unknown as Plugin;

      const config = guardedConfig();
      manager.registerPlugin('guarded-plugin', config);

      // The guard is named by the timeout it was armed with rather than
      // counted out of the process — `@objectstack/refd-timer-testkit` explains
      // why `reloadPlugin()`'s `await` makes an absolute count unsound (#10685).
      let reloaded = false;
      const guards = await recordGuards(config.shutdownTimeout, async () => {
        reloaded = await manager.reloadPlugin(
          'guarded-plugin',
          plugin,
          '1.0.0',
          noState,
          noRestore
        );
      });

      expect(reloaded).toBe(true);
      expect(calls.count).toBe(1);

      // The reload armed exactly one shutdown guard. Without this the reclaim
      // below would be vacuously green — a zero because nothing was measured,
      // rather than because nothing was left behind.
      expect(guards).toHaveLength(1);
      expect(stillPinningTheLoop(guards)).toBe(0);
    });

    it('still reports the timeout when destroy() never answers', async () => {
      // The companion assertion: reclaiming the guard must not disarm it.
      // `unref()` would satisfy "no ref'd timer" by detaching the guard from
      // the loop — a process with nothing else to run then exits *silently*
      // instead of reporting the timeout, and a plugin that hangs on shutdown
      // is exactly the case this guard exists for. Clearing on settle keeps
      // the guard armed exactly while the race is undecided.
      let release: () => void = () => {};
      const hangingPlugin = {
        name: 'hanging-plugin',
        version: '1.0.0',
        init: () => {},
        destroy: () =>
          new Promise<void>(resolve => {
            release = resolve;
          }),
      } as unknown as Plugin;

      manager.registerPlugin('hanging-plugin', guardedConfig({ shutdownTimeout: 50 }));

      const reloaded = await manager.reloadPlugin(
        'hanging-plugin',
        hangingPlugin,
        '1.0.0',
        noState,
        noRestore
      );

      expect(reloaded).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toBe('Hot reload failed');
      expect((errors[0]?.error as Error).message).toBe('Shutdown timeout');

      release();
    });

    describe('under fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('accumulates no guard across repeated reloads', async () => {
        const calls = { count: 0 };
        const plugin = {
          name: 'guarded-plugin',
          version: '1.0.0',
          init: () => {},
          destroy: async () => {
            calls.count++;
          },
        } as unknown as Plugin;

        manager.registerPlugin('guarded-plugin', guardedConfig());

        // Unlike `getActiveResourcesInfo()`, the fake-timer count still sees
        // an `unref()`'d timer — so this distinguishes "the guard was
        // reclaimed" from "the guard was merely detached from the loop", the
        // fake fix that keeps the leak and loses the report above.
        const before = vi.getTimerCount();

        for (let round = 0; round < 4; round++) {
          const reloaded = await manager.reloadPlugin(
            'guarded-plugin',
            plugin,
            '1.0.0',
            noState,
            noRestore
          );
          expect(reloaded).toBe(true);
          // Nothing armed survives the reload that armed it — no drift.
          expect(vi.getTimerCount()).toBe(before);
        }

        expect(calls.count).toBe(4);
      });

      it('reclaims the guard on the same turn for a synchronous destroy()', async () => {
        // The Plugin contract permits `destroy(): void` — the reason the helper
        // is widened to `T | PromiseLike<T>`. A sync hook wins the race
        // immediately, and the guard must go with it.
        const calls = { count: 0 };
        const syncPlugin = {
          name: 'sync-plugin',
          version: '1.0.0',
          init: () => {},
          destroy: () => {
            calls.count++;
          },
        } as unknown as Plugin;

        manager.registerPlugin('sync-plugin', guardedConfig());

        const before = vi.getTimerCount();
        const reloaded = await manager.reloadPlugin(
          'sync-plugin',
          syncPlugin,
          '1.0.0',
          noState,
          noRestore
        );

        expect(reloaded).toBe(true);
        expect(calls.count).toBe(1);
        expect(vi.getTimerCount()).toBe(before);
      });
    });
  });
});
