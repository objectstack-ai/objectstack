import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginHealthMonitor } from './health-monitor.js';
import { createLogger } from './logger.js';
import type { Plugin } from './types.js';
import type { PluginHealthCheckParsed } from '@objectstack/spec/kernel';
import {
  recordGuards,
  refdTimeouts,
  stillPinningTheLoop,
} from '@objectstack/refd-timer-testkit';

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
     * The instrument these pins measure with lives in
     * `@objectstack/refd-timer-testkit`, together with the argument for its shape:
     * `getActiveResourcesInfo()` is PROCESS-global, so two readings are only
     * comparable across a window that crosses no event-loop turn — the very
     * property this suite states below and the one three sibling pins were
     * relying on without saying so (#10685). `stillPinningTheLoop()` is the
     * synchronous form of that window; `refdTimeouts()` is the raw reading,
     * used here only in synchronously adjacent pairs.
     */

    it("leaves no ref'd timer behind when the health check wins the race", async () => {
      const calls = { count: 0 };
      const config = guardedConfig();
      monitor.registerPlugin('guarded-plugin', config);

      const guards = await recordGuards(config.timeout, async () => {
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
      const whileMonitoring = refdTimeouts();

      // Drop the monitoring interval — whatever is left is the guard's doing.
      monitor.stopMonitoring('guarded-plugin');
      const afterStop = refdTimeouts();

      // The interval was pinning the loop and is now reclaimed. This also keeps
      // the instrument honest: `refdTimeouts()` demonstrably observes *this*
      // monitor's timers on *this* loop, so the guard's zero below is a real
      // reading and not a blind one.
      expect(whileMonitoring - afterStop).toBe(1);

      // The guard is not pinning the loop: reclaiming it a second time is a
      // no-op. Had it outlived the race it would still be armed and ref'd, and
      // this reclaim would drop the count by one.
      expect(stillPinningTheLoop(guards)).toBe(0);
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

  // #11852 — `autoRestart` covers BOTH failure routes, not only the milder one.
  //
  // `performHealthCheck` fails two disjoint ways: the check RETURNS a failure
  // (`false` / `{ status: 'unhealthy' }`), or it THROWS — which, because
  // `raceCheckTimeout` rejects rather than resolving, includes every `timeout`
  // overrun. Only the returned route ever reached `config.autoRestart`, so a
  // plugin that threw or hung until its timeout — the severer failure of the
  // two — was marked `failed` and never restarted, whatever the config said.
  //
  // These pin the observable consequence, never the source: `attemptRestart`
  // is the only caller of `plugin.destroy()` and the only writer of
  // `recovering`, so those two readings together mean a restart happened and
  // nothing else can produce them. Asserting that some shared helper was
  // called would be a tautology any refactor could satisfy.
  describe('autoRestart covers both failure routes (#11852)', () => {
    /** `calculateBackoff(0, 'fixed')` — the delay before the first restart. */
    const FIRST_RESTART_BACKOFF_MS = 1_000;

    const restartConfig = (
      overrides: Partial<PluginHealthCheckParsed> = {}
    ): PluginHealthCheckParsed => ({
      interval: 10_000,
      timeout: 100,
      failureThreshold: 2,
      successThreshold: 1,
      autoRestart: true,
      maxRestartAttempts: 3,
      restartBackoff: 'fixed',
      checkMethod: 'healthCheck',
      ...overrides,
    });

    const restartable = (name: string, healthCheck: () => unknown) => {
      const destroyed = { count: 0 };
      const plugin = {
        name,
        version: '1.0.0',
        init: () => {},
        destroy: async () => {
          destroyed.count++;
        },
        healthCheck,
      } as unknown as Plugin;
      return { plugin, destroyed };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('restarts a plugin whose check THROWS, once failureThreshold accumulates', async () => {
      const config = restartConfig();
      const { plugin, destroyed } = restartable('throwing-plugin', async () => {
        throw new Error('check exploded');
      });

      monitor.registerPlugin('throwing-plugin', config);
      monitor.startMonitoring('throwing-plugin', plugin);

      // Round 1 (the immediate initial check) is below `failureThreshold`.
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('throwing-plugin')).toBe('failed');
      expect(destroyed.count).toBe(0);

      // Round 2 reaches the threshold and arms the restart's backoff.
      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(0);
      // Not yet: the restart waits out `restartBackoff` first. Without this the
      // reading below could be "restarted eventually" rather than "restarted".
      expect(destroyed.count).toBe(0);

      await vi.advanceTimersByTimeAsync(FIRST_RESTART_BACKOFF_MS);
      expect(destroyed.count).toBe(1);
      expect(monitor.getHealthStatus('throwing-plugin')).toBe('recovering');

      monitor.stopMonitoring('throwing-plugin');
    });

    it('restarts a plugin whose check exceeds `timeout` — the severest route', async () => {
      const config = restartConfig();
      // Never settles: the timeout guard is what ends every round.
      const { plugin, destroyed } = restartable(
        'hanging-plugin',
        () => new Promise(() => {})
      );

      monitor.registerPlugin('hanging-plugin', config);
      monitor.startMonitoring('hanging-plugin', plugin);

      // Round 1's guard rejects at +timeout. Below threshold: no restart.
      await vi.advanceTimersByTimeAsync(config.timeout);
      expect(monitor.getHealthStatus('hanging-plugin')).toBe('failed');
      expect(destroyed.count).toBe(0);

      // Round 2 begins at +interval and its own guard rejects at +timeout.
      await vi.advanceTimersByTimeAsync(config.interval - config.timeout);
      await vi.advanceTimersByTimeAsync(config.timeout);
      expect(destroyed.count).toBe(0);

      await vi.advanceTimersByTimeAsync(FIRST_RESTART_BACKOFF_MS);
      expect(destroyed.count).toBe(1);
      expect(monitor.getHealthStatus('hanging-plugin')).toBe('recovering');

      // The round is still reported as the timeout it was — restarting it does
      // not relabel why it failed.
      const report = monitor.getHealthReport('hanging-plugin');
      expect(report?.message).toBe(`Health check timeout after ${config.timeout}ms`);
      expect(report?.checks).toEqual([
        { name: 'health-check', status: 'failed', message: report?.message },
      ]);

      monitor.stopMonitoring('hanging-plugin');
    });

    it('still restarts a plugin whose check RETURNS a failure', async () => {
      // The route that already worked. Without this pin, unifying the two
      // routes could close the throw gap by opening one here instead.
      const config = restartConfig();
      const { plugin, destroyed } = restartable('unhealthy-plugin', async () => false);

      monitor.registerPlugin('unhealthy-plugin', config);
      monitor.startMonitoring('unhealthy-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('degraded');
      expect(destroyed.count).toBe(0);

      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(FIRST_RESTART_BACKOFF_MS);
      expect(destroyed.count).toBe(1);
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('recovering');

      monitor.stopMonitoring('unhealthy-plugin');
    });

    it('leaves a throwing plugin alone when `autoRestart` is false', async () => {
      // The control. Without it, the pins above would also pass if every
      // failure restarted unconditionally — which would be a different defect,
      // not a fix.
      const config = restartConfig({ autoRestart: false });
      const { plugin, destroyed } = restartable('opted-out-plugin', async () => {
        throw new Error('check exploded');
      });

      monitor.registerPlugin('opted-out-plugin', config);
      monitor.startMonitoring('opted-out-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(FIRST_RESTART_BACKOFF_MS);

      expect(destroyed.count).toBe(0);
      expect(monitor.getHealthStatus('opted-out-plugin')).toBe('failed');

      monitor.stopMonitoring('opted-out-plugin');
    });

    it('keeps a throw at `failed` immediately, with no threshold', async () => {
      // The documented rule this fix deliberately does NOT unify away:
      // "A check that throws — including one that exceeds `timeout` — is the
      // separate `failed` status, applied immediately with no threshold"
      // (content/docs/protocol/kernel/lifecycle.mdx, "Custom Health Checks").
      // Sharing the counters and the restart decision must not turn a throw
      // into the returned route's `degraded`.
      const config = restartConfig({ failureThreshold: 10 });
      const { plugin, destroyed } = restartable('strict-plugin', async () => {
        throw new Error('check exploded');
      });

      monitor.registerPlugin('strict-plugin', config);
      monitor.startMonitoring('strict-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('strict-plugin')).toBe('failed');
      expect(destroyed.count).toBe(0);

      monitor.stopMonitoring('strict-plugin');
    });
  });

  // `successThreshold` is declared as "Consecutive successes needed to mark
  // healthy", and was read only while status was `unhealthy` or `degraded`.
  // The first success wrote `recovering` — a status the gate did not name — so
  // the second success took the outer `else` and reached `healthy` without the
  // counter being consulted at all; `failed` was in neither set either, so a
  // plugin that threw recovered on its FIRST success. A declared 5 was
  // indistinguishable from 2, and from 1 when recovery started at `failed`.
  //
  // Every case below declares `successThreshold: 3`, never the default `1` —
  // 1 is exactly the value at which the defect is invisible.
  //
  // These read `getHealthStatus` only. Asserting that some status set is
  // consulted would be a tautology any refactor could satisfy; what the
  // declaration promises is the number of consecutive successes a plugin needs
  // before it is called healthy, so that is what is counted.
  describe('`successThreshold` binds from every status that records a failure (#11955)', () => {
    const THRESHOLD = 3;
    const INTERVAL_MS = 10_000;
    /** `calculateBackoff(0, 'fixed')` — the delay before the first restart. */
    const FIRST_RESTART_BACKOFF_MS = 1_000;

    const thresholdConfig = (
      overrides: Partial<PluginHealthCheckParsed> = {}
    ): PluginHealthCheckParsed => ({
      interval: INTERVAL_MS,
      timeout: 100,
      failureThreshold: 2,
      successThreshold: THRESHOLD,
      autoRestart: false,
      maxRestartAttempts: 3,
      restartBackoff: 'fixed',
      checkMethod: 'healthCheck',
      ...overrides,
    });

    type CheckMode = 'pass' | 'return-failure' | 'throw';

    /** A plugin whose check outcome is switched between rounds. */
    const switchable = (name: string, initial: CheckMode) => {
      const mode = { current: initial };
      const destroyed = { count: 0 };
      const plugin = {
        name,
        version: '1.0.0',
        init: () => {},
        destroy: async () => {
          destroyed.count++;
        },
        healthCheck: async () => {
          if (mode.current === 'throw') throw new Error('check exploded');
          if (mode.current === 'return-failure') return false;
          return true;
        },
      } as unknown as Plugin;
      return { plugin, mode, destroyed };
    };

    /** Advance to the next scheduled round and let its check settle. */
    const nextRound = async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('requires all three successes to leave `unhealthy`', async () => {
      const config = thresholdConfig();
      const { plugin, mode } = switchable('unhealthy-plugin', 'return-failure');

      monitor.registerPlugin('unhealthy-plugin', config);
      monitor.startMonitoring('unhealthy-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('degraded');
      await nextRound();
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('unhealthy');

      mode.current = 'pass';
      await nextRound();
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('recovering');
      // The round that used to promote: status is `recovering` going in, which
      // the old gate did not name, so the counter went unread and 2 of 3
      // successes was enough.
      await nextRound();
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('recovering');

      await nextRound();
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('healthy');

      monitor.stopMonitoring('unhealthy-plugin');
    });

    it('requires all three successes to leave `degraded`', async () => {
      // `failureThreshold: 5` keeps the single failure below `unhealthy`, so
      // the successes start from `degraded` itself.
      const config = thresholdConfig({ failureThreshold: 5 });
      const { plugin, mode } = switchable('degraded-plugin', 'return-failure');

      monitor.registerPlugin('degraded-plugin', config);
      monitor.startMonitoring('degraded-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('degraded-plugin')).toBe('degraded');

      mode.current = 'pass';
      await nextRound();
      expect(monitor.getHealthStatus('degraded-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('degraded-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('degraded-plugin')).toBe('healthy');

      monitor.stopMonitoring('degraded-plugin');
    });

    it('requires all three successes to leave `failed` — not one', async () => {
      // `failed` was in neither set the gate named, so the first success after
      // a throw went straight to `healthy` whatever the declared count said.
      const config = thresholdConfig({ failureThreshold: 5 });
      const { plugin, mode } = switchable('thrown-plugin', 'throw');

      monitor.registerPlugin('thrown-plugin', config);
      monitor.startMonitoring('thrown-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('thrown-plugin')).toBe('failed');

      mode.current = 'pass';
      await nextRound();
      expect(monitor.getHealthStatus('thrown-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('thrown-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('thrown-plugin')).toBe('healthy');

      monitor.stopMonitoring('thrown-plugin');
    });

    it('requires all three successes to leave the `recovering` a restart wrote', async () => {
      // `recovering` reached from the restart path rather than from the
      // success branch: `attemptRestart` writes it with both counters zeroed,
      // so this is the status as a genuine STARTING point, not as a value the
      // gate under test just produced.
      const config = thresholdConfig({ failureThreshold: 1, autoRestart: true });
      const { plugin, mode, destroyed } = switchable('restarted-plugin', 'throw');

      monitor.registerPlugin('restarted-plugin', config);
      monitor.startMonitoring('restarted-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      // The restart waits out `restartBackoff` before it destroys.
      expect(destroyed.count).toBe(0);
      await vi.advanceTimersByTimeAsync(FIRST_RESTART_BACKOFF_MS);
      expect(destroyed.count).toBe(1);
      expect(monitor.getHealthStatus('restarted-plugin')).toBe('recovering');

      mode.current = 'pass';
      await nextRound();
      expect(monitor.getHealthStatus('restarted-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('restarted-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('restarted-plugin')).toBe('healthy');

      monitor.stopMonitoring('restarted-plugin');
    });

    it('starts the count over after a throw interrupts a recovery (#11852)', async () => {
      // The pin #11852 correctly declined to fake. That card fixed the `catch`
      // path's missing `successCounters` reset and could not test it: the
      // counter's only read site was unreachable with a stale non-zero value,
      // so any test would have passed for the wrong reason. Gating `failed` on
      // the counter is what makes the reset observable — and load-bearing.
      //
      // Two successes accumulate, then the check throws. With the reset, the
      // recovery restarts from zero and three more successes are needed; with
      // the stale counter the third success below would carry the count to 3
      // and promote immediately.
      const config = thresholdConfig({ failureThreshold: 5 });
      const { plugin, mode } = switchable('interrupted-plugin', 'return-failure');

      monitor.registerPlugin('interrupted-plugin', config);
      monitor.startMonitoring('interrupted-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('degraded');

      mode.current = 'pass';
      await nextRound();
      await nextRound();
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('recovering');

      mode.current = 'throw';
      await nextRound();
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('failed');

      mode.current = 'pass';
      await nextRound();
      // Success #1 of a fresh three, not #3 of a carried-over count.
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('recovering');
      await nextRound();
      expect(monitor.getHealthStatus('interrupted-plugin')).toBe('healthy');

      monitor.stopMonitoring('interrupted-plugin');
    });

    it('marks a never-checked plugin healthy on its first success', async () => {
      // The boundary of the chosen semantics, pinned so it cannot drift: the
      // count is a RECOVERY criterion ("Number of consecutive successes to
      // recover from unhealthy state"), and `unknown` — declared "Health
      // status cannot be determined", the status `registerPlugin` writes —
      // records no failure to recover from. A fresh plugin is healthy on its
      // first passing check however high `successThreshold` is declared.
      const config = thresholdConfig();
      const { plugin } = switchable('fresh-plugin', 'pass');

      monitor.registerPlugin('fresh-plugin', config);
      expect(monitor.getHealthStatus('fresh-plugin')).toBe('unknown');

      monitor.startMonitoring('fresh-plugin', plugin);
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('fresh-plugin')).toBe('healthy');

      monitor.stopMonitoring('fresh-plugin');
    });
  });
});
