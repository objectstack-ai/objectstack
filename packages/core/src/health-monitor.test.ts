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

  // ── #12032 — the monitor REPORTS; it never destroys, and never lies ───────
  //
  // This block replaces #11852's `autoRestart covers both failure routes`.
  // Those five tests are REWRITTEN here rather than deleted, and the change is
  // declared because four of them pinned the false contract as the contract:
  // each drove a plugin past `failureThreshold` and then asserted
  // `destroyed.count === 1` and status `recovering` — i.e. asserted that a
  // "restart" had happened. It had not. `attemptRestart` called
  // `plugin.destroy()` and stopped; `init` appeared in `health-monitor.ts`
  // ONLY inside the comment that claimed both were called. The assertions were
  // true readings of a false behaviour.
  //
  // What #11852 actually established SURVIVES and is re-pinned below: both
  // failure routes — the check RETURNS a failure, or it THROWS (which, because
  // `raceCheckTimeout` rejects rather than resolving, includes every `timeout`
  // overrun) — share the counters, and a throw keeps its own `failed` label.
  // What leaves is the restart decision they were also said to share, because
  // there is no restart (#12032: `autoRestart` / `maxRestartAttempts` /
  // `restartBackoff` retired in @objectstack/spec 18, ADR-0049).
  //
  // These pin the observable consequence, never the source. `plugin.destroy()`
  // had exactly one caller in this class, so a `destroyed.count` of zero is
  // the whole claim "the monitor does not tear plugins down"; asserting that
  // some method is absent would be a tautology any refactor could satisfy, and
  // asserting "`init` is called" would be satisfied by a no-op `init`.
  describe('a failing plugin is reported, never destroyed (#12032)', () => {
    const INTERVAL_MS = 10_000;
    /** The backoff the retired restart used to wait out before destroying. */
    const FORMER_RESTART_BACKOFF_MS = 1_000;

    const failingConfig = (
      overrides: Partial<PluginHealthCheckParsed> = {}
    ): PluginHealthCheckParsed => ({
      interval: INTERVAL_MS,
      timeout: 100,
      failureThreshold: 2,
      successThreshold: 1,
      checkMethod: 'healthCheck',
      ...overrides,
    });

    /**
     * A plugin that records whether it is still ALIVE — not merely whether
     * `destroy` was called. `alive` is what an operator's `healthy` reading is
     * supposed to be about, and it is the reading the old behaviour got wrong.
     */
    const observable = (name: string, healthCheck: () => unknown) => {
      const destroyed = { count: 0 };
      const state = { alive: true };
      const plugin = {
        name,
        version: '1.0.0',
        init: () => {
          state.alive = true;
        },
        destroy: async () => {
          destroyed.count++;
          state.alive = false;
        },
        healthCheck,
      } as unknown as Plugin;
      return { plugin, destroyed, state };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // ⭐ The terminal-state pin. Not "init is called" — that is green the
    // moment someone adds a no-op `init`. This asserts what an operator READS
    // at the end of the sequence, and the invariant behind it: a plugin that
    // reads `healthy` is a plugin that is alive.
    //
    // The sequence is the one that used to produce the false report: drive a
    // plugin past `failureThreshold` (the point the retired `autoRestart`
    // fired), wait out the former restart backoff, then feed it
    // `successThreshold` CONSECUTIVE passing rounds — the #11955 gate — and
    // read the status an operator would read.
    //
    // Before #12032 this same drive ended at:
    //   after backoff:    status=recovering destroyed=1 alive=false
    //   recovery round 3: status=healthy    destroyed=1 alive=false
    it('never reports `healthy` for a plugin it has torn down', async () => {
      const config = failingConfig({ failureThreshold: 1, successThreshold: 3 });
      const mode = { current: 'throw' as 'throw' | 'pass' };
      const { plugin, destroyed, state } = observable('observed-plugin', async () => {
        if (mode.current === 'throw') throw new Error('check exploded');
        return true;
      });

      monitor.registerPlugin('observed-plugin', config);
      monitor.startMonitoring('observed-plugin', plugin);

      // The failing round that used to trigger the "restart".
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('observed-plugin')).toBe('failed');
      expect(destroyed.count).toBe(0);
      expect(state.alive).toBe(true);

      // The window the destroy used to land in.
      await vi.advanceTimersByTimeAsync(FORMER_RESTART_BACKOFF_MS);
      expect(destroyed.count, 'the monitor must not tear the plugin down').toBe(0);
      expect(monitor.getHealthStatus('observed-plugin')).toBe('failed');

      // `successThreshold` consecutive successes — the walk that used to end
      // at `healthy` on a destroyed instance.
      mode.current = 'pass';
      for (let round = 1; round <= config.successThreshold; round++) {
        await vi.advanceTimersByTimeAsync(INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(0);
        // THE INVARIANT, checked at every step and not only at the end: a
        // `healthy` reading is only ever about a plugin that is alive.
        if (monitor.getHealthStatus('observed-plugin') === 'healthy') {
          expect(state.alive, '`healthy` was reported for a destroyed plugin').toBe(true);
        }
      }

      expect(monitor.getHealthStatus('observed-plugin')).toBe('healthy');
      expect(state.alive, 'the plugin that reads healthy must actually be alive').toBe(true);
      expect(destroyed.count).toBe(0);

      monitor.stopMonitoring('observed-plugin');
    });

    it('leaves a plugin whose check THROWS alone, however many rounds fail', async () => {
      // Was: 'restarts a plugin whose check THROWS, once failureThreshold
      // accumulates', asserting destroyed.count === 1 and `recovering`.
      const config = failingConfig();
      const { plugin, destroyed, state } = observable('throwing-plugin', async () => {
        throw new Error('check exploded');
      });

      monitor.registerPlugin('throwing-plugin', config);
      monitor.startMonitoring('throwing-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('throwing-plugin')).toBe('failed');

      // Past `failureThreshold`, and past the former backoff window, twice
      // over: the retired path would have destroyed by now and moved the
      // status to `recovering`.
      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(FORMER_RESTART_BACKOFF_MS);
      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(FORMER_RESTART_BACKOFF_MS);

      expect(destroyed.count).toBe(0);
      expect(state.alive).toBe(true);
      expect(monitor.getHealthStatus('throwing-plugin')).toBe('failed');

      monitor.stopMonitoring('throwing-plugin');
    });

    it('leaves a plugin that exceeds `timeout` alone — and still reports the timeout', async () => {
      // Was: 'restarts a plugin whose check exceeds `timeout` — the severest
      // route'. The REPORT half of that test is kept verbatim: a timed-out
      // round is still reported as the timeout it was.
      const config = failingConfig();
      const { plugin, destroyed, state } = observable(
        'hanging-plugin',
        () => new Promise(() => {})
      );

      monitor.registerPlugin('hanging-plugin', config);
      monitor.startMonitoring('hanging-plugin', plugin);

      await vi.advanceTimersByTimeAsync(config.timeout);
      expect(monitor.getHealthStatus('hanging-plugin')).toBe('failed');

      await vi.advanceTimersByTimeAsync(config.interval - config.timeout);
      await vi.advanceTimersByTimeAsync(config.timeout);
      await vi.advanceTimersByTimeAsync(FORMER_RESTART_BACKOFF_MS);

      expect(destroyed.count).toBe(0);
      expect(state.alive).toBe(true);

      const report = monitor.getHealthReport('hanging-plugin');
      expect(report?.message).toBe(`Health check timeout after ${config.timeout}ms`);
      expect(report?.checks).toEqual([
        { name: 'health-check', status: 'failed', message: report?.message },
      ]);

      monitor.stopMonitoring('hanging-plugin');
    });

    it('leaves a plugin whose check RETURNS a failure alone', async () => {
      // Was: 'still restarts a plugin whose check RETURNS a failure'.
      const config = failingConfig();
      const { plugin, destroyed, state } = observable('unhealthy-plugin', async () => false);

      monitor.registerPlugin('unhealthy-plugin', config);
      monitor.startMonitoring('unhealthy-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('degraded');

      await vi.advanceTimersByTimeAsync(config.interval);
      await vi.advanceTimersByTimeAsync(FORMER_RESTART_BACKOFF_MS);

      expect(monitor.getHealthStatus('unhealthy-plugin')).toBe('unhealthy');
      expect(destroyed.count).toBe(0);
      expect(state.alive).toBe(true);

      monitor.stopMonitoring('unhealthy-plugin');
    });

    it('keeps a throw at `failed` immediately, with no threshold', async () => {
      // Unchanged from #11852 except for the retired config keys. The
      // documented rule this must not unify away: "A check that throws —
      // including one that exceeds `timeout` — is the separate `failed`
      // status, applied immediately with no threshold"
      // (content/docs/protocol/kernel/lifecycle.mdx, "Custom Health Checks").
      const config = failingConfig({ failureThreshold: 10 });
      const { plugin, destroyed } = observable('strict-plugin', async () => {
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

  // ── #12032 — the door for the audience that does not parse ───────────────
  //
  // `PluginHealthCheckSchema` is not `.strict()`, so before the tombstones a
  // leftover restart key was SILENTLY STRIPPED on the parse paths that exist.
  // The tombstones answer the parse; `registerPlugin` answers everyone else —
  // and everyone else is who there is, since nothing in the tree parses this
  // schema outside its own unit test and `registerPlugin` takes the parsed
  // shape straight from the caller's hand.
  describe('a config still declaring a restart is REFUSED (#12032)', () => {
    const legalConfig = (): PluginHealthCheckParsed => ({
      interval: 30_000,
      timeout: 5_000,
      failureThreshold: 3,
      successThreshold: 1,
    });

    for (const [key, value] of [
      ['autoRestart', true],
      ['maxRestartAttempts', 3],
      ['restartBackoff', 'exponential'],
    ] as const) {
      it(`refuses \`${key}\` with an ADR-0112 envelope and the prescription`, () => {
        const config = { ...legalConfig(), [key]: value } as PluginHealthCheckParsed;

        // ADR-0112: assert the ENVELOPE, not merely that it threw. A bare
        // `toThrow()` here would stay green against an unrelated TypeError.
        let caught: (Error & { code?: string; status?: number }) | undefined;
        try {
          monitor.registerPlugin('legacy-host-plugin', config);
        } catch (error) {
          caught = error as Error & { code?: string; status?: number };
        }

        expect(caught, `${key} must be refused`).toBeDefined();
        expect(caught?.code).toBe('VALIDATION_ERROR');
        expect(caught?.status).toBe(400);

        const message = caught?.message ?? '';
        expect(message).toContain(`'${key}' was removed`);
        expect(message).toContain('#12032');
        expect(message).toContain('ADR-0049');
        expect(message).toContain('Delete the key');
        // The affordance that exists, named in place of the one that did not.
        expect(message).toContain('getHealthStatus');

        // Refused BEFORE anything was stored: a refused config must not leave
        // a half-registered plugin behind.
        expect(monitor.getHealthStatus('legacy-host-plugin')).toBeUndefined();
        expect(monitor.getAllHealthStatuses().size).toBe(0);
      });
    }

    it('accepts a config that carries none of them (anti-vacuity)', () => {
      // The control. Without it, the three refusals above would also pass if
      // `registerPlugin` had simply started throwing for everything.
      monitor.registerPlugin('clean-plugin', legalConfig());
      expect(monitor.getHealthStatus('clean-plugin')).toBe('unknown');
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

    const thresholdConfig = (
      overrides: Partial<PluginHealthCheckParsed> = {}
    ): PluginHealthCheckParsed => ({
      interval: INTERVAL_MS,
      timeout: 100,
      failureThreshold: 2,
      successThreshold: THRESHOLD,
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

    it('requires all three successes to leave a `recovering` it did not just write', async () => {
      // [#12032] REWRITTEN, declared, not a quiet edit. This test was
      // 'requires all three successes to leave the `recovering` a restart
      // wrote', and its whole point was to reach `recovering` from the RESTART
      // path — `attemptRestart` wrote it with both counters zeroed — so the
      // gate under test was reading a status it had not just produced itself.
      // That starting point no longer exists: the restart was only a
      // `plugin.destroy()`, and it is gone (#12032, ADR-0049). The test drove
      // a plugin to `destroyed=1, alive=false` and then asserted it walks to
      // `healthy`, which is precisely the false report #12032 removes.
      //
      // What it was PROTECTING survives and is re-pinned here without the
      // destroy: `recovering` as an INHERITED starting state rather than one
      // the current round wrote. A fresh monitor is seeded by driving the
      // plugin into `recovering` and then STOPPING — the next `startMonitoring`
      // resumes from a `recovering` the gate did not just produce, with the
      // success counter mid-flight, which is the same reading the restart path
      // used to supply.
      const config = thresholdConfig({ failureThreshold: 1 });
      const { plugin, mode, destroyed } = switchable('resumed-plugin', 'throw');

      monitor.registerPlugin('resumed-plugin', config);
      monitor.startMonitoring('resumed-plugin', plugin);

      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('resumed-plugin')).toBe('failed');

      mode.current = 'pass';
      await nextRound();
      expect(monitor.getHealthStatus('resumed-plugin')).toBe('recovering');

      // Suspend and resume: the status the next round reads was written by an
      // earlier round, not by this one.
      monitor.stopMonitoring('resumed-plugin');
      monitor.startMonitoring('resumed-plugin', plugin);
      await vi.advanceTimersByTimeAsync(0);
      expect(monitor.getHealthStatus('resumed-plugin')).toBe('recovering');

      await nextRound();
      expect(monitor.getHealthStatus('resumed-plugin')).toBe('healthy');

      // And the reading the old version of this test could not make: the
      // plugin that reached `healthy` was never torn down.
      expect(destroyed.count).toBe(0);

      monitor.stopMonitoring('resumed-plugin');
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
