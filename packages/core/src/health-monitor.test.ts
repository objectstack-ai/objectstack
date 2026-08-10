import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginHealthMonitor } from './health-monitor.js';
import { createLogger } from './logger.js';
import type { Plugin } from './types.js';
import type { PluginHealthCheckParsed } from '@objectstack/spec/kernel';

describe('PluginHealthMonitor', () => {
  let monitor: PluginHealthMonitor;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    logger = createLogger({ level: 'silent' });
    monitor = new PluginHealthMonitor(logger);
  });

  it('should register plugin for health monitoring', () => {
    const config: PluginHealthCheckParsed = {
      interval: 5000,
      timeout: 1000,
      failureThreshold: 3,
      successThreshold: 1,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'exponential',
    };

    monitor.registerPlugin('test-plugin', config);
    expect(monitor.getHealthStatus('test-plugin')).toBe('unknown');
  });

  it('should report healthy status initially', () => {
    const config: PluginHealthCheckParsed = {
      interval: 5000,
      timeout: 1000,
      failureThreshold: 3,
      successThreshold: 1,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'fixed',
    };

    monitor.registerPlugin('test-plugin', config);
    expect(monitor.getHealthStatus('test-plugin')).toBe('unknown');
  });

  it('should get all health statuses', () => {
    const config: PluginHealthCheckParsed = {
      interval: 5000,
      timeout: 1000,
      failureThreshold: 3,
      successThreshold: 1,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'linear',
    };

    monitor.registerPlugin('plugin1', config);
    monitor.registerPlugin('plugin2', config);
    
    const statuses = monitor.getAllHealthStatuses();
    expect(statuses.size).toBe(2);
    expect(statuses.has('plugin1')).toBe(true);
    expect(statuses.has('plugin2')).toBe(true);
  });

  it('should shutdown cleanly', () => {
    const config: PluginHealthCheckParsed = {
      interval: 5000,
      timeout: 1000,
      failureThreshold: 3,
      successThreshold: 1,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'exponential',
    };

    monitor.registerPlugin('test-plugin', config);
    monitor.shutdown();

    expect(monitor.getAllHealthStatuses().size).toBe(0);
  });

  // #4875 — the health-check timeout guard must not outlive the race it guards.
  //
  // Same shape as the kernel's startup guards (#4813, PR #4874), with one
  // aggravating difference: health checks are *periodic*, so an abandoned
  // guard is not a fixed cost paid once at boot — it is one orphaned timer per
  // plugin per round, each pinning the event loop for a whole `config.timeout`.
  //
  // What follows asserts the observable consequence, never the source:
  // "health-monitor.ts calls clearTimeout" is a tautology any refactor could
  // satisfy while still leaving the loop pinned.
  describe('Health-check timeout guard does not outlive the race (#4875)', () => {
    /** A guard long enough that a single orphan is unmistakable. */
    const guardedConfig = (overrides: Partial<PluginHealthCheckParsed> = {}): PluginHealthCheckParsed => ({
      interval: 30_000,
      timeout: 120_000,
      failureThreshold: 3,
      successThreshold: 1,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'fixed',
      checkMethod: 'healthCheck',
      ...overrides,
    });

    /** A plugin whose custom health check answers immediately (wins the race). */
    const healthyPlugin = (calls: { count: number }): Plugin =>
      ({
        name: 'guarded-plugin',
        version: '1.0.0',
        init: () => {},
        healthCheck: async () => {
          calls.count++;
          return true;
        },
      }) as unknown as Plugin;

    /**
     * Ref'd `Timeout` handles — `getActiveResourcesInfo()` reports only
     * resources currently keeping the event loop alive, which is exactly the
     * property that made `os migrate` idle ~120s in #4813.
     *
     * The count is *process*-global, so it is only ever read here in
     * synchronously adjacent pairs (see below). Comparing two reads separated
     * by an `await` is what made this suite flaky in the merge queue (#6329):
     * the runner shares this loop and keeps a **non-unref'd 100ms** timer on it
     * (`throttle(sendTasksUpdate, 100)` in `@vitest/runner`), so once the
     * window between the reads stretched past 100ms under full concurrent load
     * — the failing run measured 105ms — that timer fired inside the window and
     * the count fell by one for a reason that had nothing to do with the
     * monitor. Between two adjacent synchronous statements no timer callback
     * can run at all, so a difference measured that way is the monitor's doing
     * and nobody else's.
     */
    const refdTimers = () =>
      process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

    /**
     * Run `body` while recording the `Timeout` handles `setTimeout` hands out,
     * and return those armed with `delay` — the monitor's health-check guards,
     * told apart from every other timer on the shared loop by the very timeout
     * they were configured with.
     *
     * Holding the handles is what lets the assertion below name the guard
     * instead of counting the world. It records where the guard came from; what
     * it then asserts is still the observable consequence — whether that handle
     * is keeping the event loop alive — never that `clearTimeout` was called.
     */
    const recordingGuards = async (
      delay: number,
      body: () => Promise<void>
    ): Promise<NodeJS.Timeout[]> => {
      const guards: NodeJS.Timeout[] = [];
      const real = globalThis.setTimeout;
      const recording = ((...args: Parameters<typeof globalThis.setTimeout>) => {
        const handle = real(...args);
        if (args[1] === delay) guards.push(handle);
        return handle;
      }) as typeof globalThis.setTimeout;
      Object.assign(recording, real);

      globalThis.setTimeout = recording;
      try {
        await body();
      } finally {
        globalThis.setTimeout = real;
      }
      return guards;
    };

    it("leaves no ref'd timer behind when the health check wins the race", async () => {
      const calls = { count: 0 };
      const config = guardedConfig();
      monitor.registerPlugin('guarded-plugin', config);

      const guards = await recordingGuards(config.timeout, async () => {
        monitor.startMonitoring('guarded-plugin', healthyPlugin(calls));

        // The initial check runs immediately; wait for its report to land.
        await vi.waitFor(() => {
          expect(monitor.getHealthReport('guarded-plugin')).toBeDefined();
        });
      });

      expect(calls.count).toBe(1);
      expect(monitor.getHealthStatus('guarded-plugin')).toBe('healthy');

      // The round armed exactly one guard. Without this the reclaim below would
      // be vacuously green — a difference of zero because nothing was measured,
      // rather than because nothing was left behind.
      expect(guards).toHaveLength(1);

      // Everything from here to the last assertion runs in one uninterrupted
      // synchronous turn, so each difference is attributable.
      const whileMonitoring = refdTimers();

      // Drop the monitoring interval — whatever is left is the guard's doing.
      monitor.stopMonitoring('guarded-plugin');
      const afterStop = refdTimers();

      // The interval was pinning the loop and is now reclaimed. This also keeps
      // the instrument honest: `refdTimers()` demonstrably observes *this*
      // monitor's timers on *this* loop, so the guard's zero below is a real
      // reading and not a blind one.
      expect(whileMonitoring - afterStop).toBe(1);

      // The guard is not pinning the loop: reclaiming it a second time is a
      // no-op. Had it outlived the race it would still be armed and ref'd, and
      // this reclaim would drop the count by one.
      for (const guard of guards) clearTimeout(guard);
      expect(refdTimers()).toBe(afterStop);
    });

    it('still reports the timeout when the check never answers', async () => {
      // The companion assertion: reclaiming the guard must not disarm it.
      // `unref()` would satisfy "no ref'd timer" by detaching the guard from
      // the loop — a process with nothing else to run then exits *silently*
      // instead of reporting the timeout. Clearing on settle keeps the guard
      // armed exactly while the race is undecided.
      let release: () => void = () => {};
      const hangingPlugin = {
        name: 'hanging-plugin',
        version: '1.0.0',
        init: () => {},
        healthCheck: () =>
          new Promise((resolve) => {
            release = () => resolve(true);
          }),
      } as unknown as Plugin;

      monitor.registerPlugin('hanging-plugin', guardedConfig({ timeout: 100 }));
      monitor.startMonitoring('hanging-plugin', hangingPlugin);

      await vi.waitFor(() => {
        expect(monitor.getHealthStatus('hanging-plugin')).toBe('failed');
      });

      expect(monitor.getHealthReport('hanging-plugin')?.message).toBe(
        'Health check timeout after 100ms'
      );

      monitor.stopMonitoring('hanging-plugin');
      release();
    });

    describe('under fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('accumulates no guard across periodic rounds', async () => {
        const calls = { count: 0 };
        const config = guardedConfig({ interval: 1_000 });
        monitor.registerPlugin('guarded-plugin', config);

        const before = vi.getTimerCount();
        monitor.startMonitoring('guarded-plugin', healthyPlugin(calls));

        // Flush the initial check without letting the interval or the guard fire.
        await vi.advanceTimersByTimeAsync(0);
        expect(calls.count).toBe(1);

        // Unlike `getActiveResourcesInfo()`, the fake-timer count still sees
        // an `unref()`'d timer — so this distinguishes "the guard was
        // reclaimed" from "the guard was merely detached from the loop".
        const settled = vi.getTimerCount();
        expect(settled).toBe(before + 1); // the monitoring interval, and nothing else

        // Periodic checks are where this leak compounds: one orphan per round.
        for (let round = 0; round < 5; round++) {
          await vi.advanceTimersByTimeAsync(config.interval);
        }

        expect(calls.count).toBe(6);
        expect(vi.getTimerCount()).toBe(settled);

        monitor.stopMonitoring('guarded-plugin');
        expect(vi.getTimerCount()).toBe(before);
      });
    });
  });
});
