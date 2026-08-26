// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { 
  PluginHealthStatus, 
  PluginHealthCheckParsed, 
  PluginHealthReport 
} from '@objectstack/spec/kernel';
import type { ObjectLogger } from './logger.js';
import type { Plugin } from './types.js';

/**
 * Is a success from `status` still subject to `successThreshold`?
 *
 * `successThreshold` is declared as "Consecutive successes needed to mark
 * healthy" (`PluginHealthCheckSchema`, `@objectstack/spec/kernel`), so the
 * counter stays in force on the way out of every status that records an
 * OBSERVED failure — `recovering` included. `recovering` is declared "Plugin
 * is in recovery process": recovery under way, not finished, and the count is
 * exactly its completion criterion. Consulting the counter only from
 * `unhealthy`/`degraded` capped the declared value at 2, because the first
 * success moved the plugin to `recovering` — a status the gate did not name —
 * so the second success bypassed the counter entirely and went straight to
 * `healthy`. `failed` was skipped for the same reason and recovered on its
 * first success (#11955).
 *
 * `healthy` and `unknown` promote on the first success: neither records a
 * failure to recover from. `unknown` is declared "Health status cannot be
 * determined" — the status a plugin is registered in before any check has run,
 * so there is nothing for the recovery count to count back from.
 *
 * Exhaustive over `PluginHealthStatus` deliberately: a status added to
 * `PluginHealthStatusSchema` fails to compile here until this map says which
 * side it falls on, so the gate cannot quietly acquire a second bypass the way
 * `recovering` did.
 */
const RECOVERY_IS_THRESHOLD_GATED: Record<PluginHealthStatus, boolean> = {
  degraded: true,
  unhealthy: true,
  failed: true,
  recovering: true,
  healthy: false,
  unknown: false,
};

/**
 * An ADR-0112-enveloped refusal (`code` + `status` on the error), so a caller —
 * and a rejection-class test — can assert the refusal rather than merely "it
 * threw". `VALIDATION_ERROR` is the standard catalog's generic
 * argument-validation code, the same envelope `hot-reload.ts` uses for the
 * sibling retirements (#12340, #12428).
 */
function healthMonitorRefusal(message: string): Error & { code: string; status: number } {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  return err;
}

/**
 * Keys removed from `PluginHealthCheck` in 18 (#12032) that a host may still
 * be passing.
 *
 * `PluginHealthCheckSchema` is not `.strict()`, so before the tombstones zod
 * would have silently STRIPPED each of these — a clean parse and a setting
 * that never takes effect. The tombstones answer the parse; this table is the
 * door for the audience that does NOT parse, which is every host there is:
 * nothing in the tree parses `PluginHealthCheckSchema` outside its own unit
 * test, and `registerPlugin` takes the PARSED shape straight from the caller's
 * hand.
 *
 * Each entry is the guidance clause; the `[HealthMonitor] Plugin '<name>': `
 * prefix is added at throw time. The facts these must carry are pinned in
 * `health-monitor.test.ts` by CONTENT, never by byte-equality against the
 * spec-side prescriptions — `@objectstack/core`'s every import of
 * `@objectstack/spec/kernel` is type-only, and a value import would be the
 * first, linking that module's zod closure into every consumer of this package
 * for three strings (the reasoning `hot-reload.ts` records for the same
 * duplication).
 */
const RETIRED_HEALTH_CHECK_KEYS: ReadonlyArray<readonly [string, string]> = [
  [
    'autoRestart',
    "'autoRestart' was removed from PluginHealthCheck in @objectstack/spec 18 "
    + '(#12032, ADR-0049 enforce-or-remove) — it never restarted a plugin. '
    + '`attemptRestart` called `plugin.destroy()` and stopped there, then '
    + "logged 'Plugin restarted' and set status `recovering`, and the periodic "
    + 'checks carried on against the destroyed instance — which the default '
    + "check (`{ name: 'plugin-loaded', status: 'passed' }`) passes forever, so "
    + 'a destroyed, never-re-initialised plugin ended up reported `healthy`. '
    + 'Delete the key. This monitor no longer destroys anything: a failing '
    + 'plugin is reported `unhealthy` or `failed` and left alone.',
  ],
  [
    'maxRestartAttempts',
    "'maxRestartAttempts' was removed from PluginHealthCheck in "
    + '@objectstack/spec 18 (#12032, ADR-0049 enforce-or-remove) — it capped a '
    + 'restart that never happened, so it only counted `destroy()` calls. '
    + 'Delete the key.',
  ],
  [
    'restartBackoff',
    "'restartBackoff' was removed from PluginHealthCheck in @objectstack/spec "
    + '18 (#12032, ADR-0049 enforce-or-remove) — it delayed a restart that '
    + 'never happened, so it only moved when the `destroy()` landed. Delete '
    + 'the key.',
  ],
];

/**
 * What a host does instead. Names only affordances that exist: the monitor
 * could not restart a plugin even in principle, because `Plugin.init(ctx)`
 * needs a `PluginContext` that only the kernel constructs and exposes to
 * nobody (`ObjectKernel.context` is private, `KernelBase.createContext` is
 * protected).
 */
const RESTART_IS_THE_HOSTS_JOB =
  ' Restarting a plugin is the HOST\'s job in this host-driven library: poll '
  + '`getHealthStatus(pluginName)` / `getHealthReport(pluginName)` and act on '
  + '`unhealthy` / `failed` at the level that owns the plugin\'s lifetime — '
  + 'recreate the kernel, or let your supervisor restart the process.';

/**
 * Refuse a key this library removed, at the moment the host hands the config
 * over. First match wins; the order is the order they appear in the schema.
 */
function assertNoRetiredKeys(pluginName: string, config: object): void {
  for (const [key, guidance] of RETIRED_HEALTH_CHECK_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      continue;
    }
    throw healthMonitorRefusal(
      `[HealthMonitor] Plugin '${pluginName}': ${guidance}${RESTART_IS_THE_HOSTS_JOB}`
    );
  }
}

/**
 * Plugin Health Monitor
 *
 * Monitors plugin health status. It REPORTS; it does not act on what it finds.
 *
 * ## The monitor no longer "restarts" anything (#12032)
 *
 * It used to claim it did. `attemptRestart` called `plugin.destroy()` and
 * stopped there — the comment above the call read "Call destroy and init to
 * restart", and `init` appeared in this file ONLY inside that comment. What a
 * plugin got was: destroy, a log line reading 'Plugin restarted', status
 * `recovering`, and periodic checks continuing against the destroyed instance.
 * The default check when no `checkMethod` resolves is
 * `{ name: 'plugin-loaded', status: 'passed' }`, which a destroyed plugin
 * passes indefinitely, so the TERMINAL report on a destroyed, never
 * re-initialised plugin was `healthy` — and #11955 made that MORE convincing
 * rather than less, because reaching `healthy` now costs `successThreshold`
 * consecutive passing rounds.
 *
 * The restart could not be repaired in place. `Plugin.init(ctx)` needs a
 * `PluginContext`, and the only two `plugin.init(...)` call sites in the tree
 * are the kernel's own boot loops, over the full plugin list, with a context
 * that is `private` on `ObjectKernel` and `protected` on `KernelBase`. No host
 * can obtain one, so there was nothing for a re-init hook to call. ADR-0049
 * enforce-or-remove, with no roadmap to point EXPERIMENTAL at, therefore
 * removed the declaration: `autoRestart`, `maxRestartAttempts` and
 * `restartBackoff` are tombstoned in `@objectstack/spec` 18, and this class
 * refuses a config that still carries one instead of accepting it and doing
 * something else.
 *
 * What a failing plugin gets now is the truth: `degraded`, `unhealthy` or
 * `failed`, and no destroy. Acting on that is the HOST's job — this is a
 * host-driven library (#11825 route 2), and the host is the only party that
 * owns the plugin's lifetime.
 */
export class PluginHealthMonitor {
  private logger: ObjectLogger;
  private healthChecks = new Map<string, PluginHealthCheckParsed>();
  private healthStatus = new Map<string, PluginHealthStatus>();
  private healthReports = new Map<string, PluginHealthReport>();
  private checkIntervals = new Map<string, NodeJS.Timeout>();
  private failureCounters = new Map<string, number>();
  private successCounters = new Map<string, number>();

  constructor(logger: ObjectLogger) {
    this.logger = logger.child({ component: 'HealthMonitor' });
  }

  /**
   * Register a plugin for health monitoring
   */
  registerPlugin(pluginName: string, config: PluginHealthCheckParsed): void {
    // Before anything is stored: a config still carrying a retired restart key
    // is refused with its prescription, never accepted-and-ignored. Deliberately
    // FIRST, so a config that would otherwise register cleanly cannot smuggle
    // the false declaration past the door.
    assertNoRetiredKeys(pluginName, config as object);

    this.healthChecks.set(pluginName, config);
    this.healthStatus.set(pluginName, 'unknown');
    this.failureCounters.set(pluginName, 0);
    this.successCounters.set(pluginName, 0);

    this.logger.info('Plugin registered for health monitoring', { 
      plugin: pluginName,
      interval: config.interval 
    });
  }

  /**
   * Start monitoring a plugin
   */
  startMonitoring(pluginName: string, plugin: Plugin): void {
    const config = this.healthChecks.get(pluginName);
    if (!config) {
      this.logger.warn('Cannot start monitoring - plugin not registered', { plugin: pluginName });
      return;
    }

    // Clear any existing interval
    this.stopMonitoring(pluginName);

    // Set up periodic health checks
    const interval = setInterval(() => {
      this.performHealthCheck(pluginName, plugin, config).catch(error => {
        this.logger.error('Health check failed with error', { 
          plugin: pluginName, 
          error 
        });
      });
    }, config.interval);

    this.checkIntervals.set(pluginName, interval);
    this.logger.info('Health monitoring started', { plugin: pluginName });

    // Perform initial health check
    this.performHealthCheck(pluginName, plugin, config).catch(error => {
      this.logger.error('Initial health check failed', { 
        plugin: pluginName, 
        error 
      });
    });
  }

  /**
   * Stop monitoring a plugin
   */
  stopMonitoring(pluginName: string): void {
    const interval = this.checkIntervals.get(pluginName);
    if (interval) {
      clearInterval(interval);
      this.checkIntervals.delete(pluginName);
      this.logger.info('Health monitoring stopped', { plugin: pluginName });
    }
  }

  /**
   * Perform a health check on a plugin
   */
  private async performHealthCheck(
    pluginName: string,
    plugin: Plugin,
    config: PluginHealthCheckParsed
  ): Promise<void> {
    const startTime = Date.now();
    let status: PluginHealthStatus = 'healthy';
    let message: string | undefined;
    const checks: Array<{ name: string; status: 'passed' | 'failed' | 'warning'; message?: string }> = [];
    // Which failure route this round took, if any. A round can fail two
    // disjoint ways and both settle here, so that the counters and the
    // threshold are consulted in exactly one place below.
    let failureRoute: 'returned' | 'thrown' | undefined;

    try {
      // Check if plugin has a custom health check method
      if (config.checkMethod && typeof (plugin as any)[config.checkMethod] === 'function') {
        const checkResult = await this.raceCheckTimeout(
          (plugin as any)[config.checkMethod](),
          config.timeout,
          `Health check timeout after ${config.timeout}ms`
        );

        if (checkResult === false || (checkResult && checkResult.status === 'unhealthy')) {
          status = 'unhealthy';
          message = checkResult?.message || 'Custom health check failed';
          checks.push({ name: config.checkMethod, status: 'failed', message });
        } else {
          checks.push({ name: config.checkMethod, status: 'passed' });
        }
      } else {
        // Default health check - just verify plugin is loaded
        checks.push({ name: 'plugin-loaded', status: 'passed' });
      }

      // Update counters based on result
      if (status === 'healthy') {
        this.successCounters.set(pluginName, (this.successCounters.get(pluginName) || 0) + 1);
        this.failureCounters.set(pluginName, 0);

        // Recover only once `successThreshold` consecutive successes have
        // accumulated — from every status that records an observed failure,
        // not just the two the gate used to name (#11955).
        const currentStatus = this.healthStatus.get(pluginName) ?? 'unknown';
        if (RECOVERY_IS_THRESHOLD_GATED[currentStatus]) {
          const successCount = this.successCounters.get(pluginName) || 0;
          if (successCount >= config.successThreshold) {
            this.healthStatus.set(pluginName, 'healthy');
            this.logger.info('Plugin recovered to healthy state', { plugin: pluginName });
          } else {
            this.healthStatus.set(pluginName, 'recovering');
          }
        } else {
          this.healthStatus.set(pluginName, 'healthy');
        }
      } else {
        failureRoute = 'returned';
      }
    } catch (error) {
      status = 'failed';
      message = error instanceof Error ? error.message : 'Unknown error';

      checks.push({ 
        name: 'health-check', 
        status: 'failed', 
        message: message 
      });

      this.logger.error('Health check exception', { 
        plugin: pluginName, 
        error 
      });

      failureRoute = 'thrown';
    }

    // Both failure routes land here, and only here. Kept outside the `try`:
    // a fault raised while RECORDING a round is not a health-check exception,
    // and catching it above would relabel it as one and push a second
    // `health-check` entry for a check that ran. (#11852 needed this because
    // `recordFailedRound` awaited a restart; the restart is gone as of #12032
    // but the reason the boundary sits here is unchanged.)
    if (failureRoute) {
      this.recordFailedRound(pluginName, config, failureRoute);
    }

    // Create health report
    const report: PluginHealthReport = {
      status: this.healthStatus.get(pluginName) || 'unknown',
      timestamp: new Date().toISOString(),
      message,
      metrics: {
        uptime: Date.now() - startTime,
      },
      checks: checks.length > 0 ? checks : undefined,
    };

    this.healthReports.set(pluginName, report);
  }

  /**
   * Handle one failed round — the single path BOTH failure routes take.
   *
   * `performHealthCheck` can fail two disjoint ways: the check *returns* a
   * failure (`false` or `{ status: 'unhealthy' }`), or it *throws* — which by
   * `raceCheckTimeout` includes every `timeout` overrun, the severest case of
   * the two. The routes used to be handled in separate blocks, and only the
   * returned one cleared `successCounters`, so the counters a declared
   * `failureThreshold` / `successThreshold` are counted with depended on which
   * way the round happened to fail (#11852).
   *
   * What stays route-specific is the *status label*, deliberately. A throw is
   * the separate `failed` status applied immediately with no threshold — that
   * is the documented contract (`content/docs/protocol/kernel/lifecycle.mdx`,
   * "Custom Health Checks") and is pinned by the timeout test. Only the
   * counters are shared, because that is what `failureThreshold` declares, and
   * it does not name a route.
   *
   * This round ENDS here. Nothing is done TO the plugin — see the #12032 note
   * on the class: a monitor that cannot re-initialise a plugin has no business
   * destroying one.
   */
  private recordFailedRound(
    pluginName: string,
    config: PluginHealthCheckParsed,
    route: 'returned' | 'thrown'
  ): void {
    const failureCount = (this.failureCounters.get(pluginName) || 0) + 1;
    this.failureCounters.set(pluginName, failureCount);
    this.successCounters.set(pluginName, 0);

    const thresholdReached = failureCount >= config.failureThreshold;

    if (route === 'thrown') {
      this.healthStatus.set(pluginName, 'failed');
    } else if (thresholdReached) {
      this.healthStatus.set(pluginName, 'unhealthy');
      this.logger.warn('Plugin marked as unhealthy', { 
        plugin: pluginName, 
        failures: failureCount 
      });
    } else {
      this.healthStatus.set(pluginName, 'degraded');
    }
  }

  /**
   * Get current health status of a plugin
   */
  getHealthStatus(pluginName: string): PluginHealthStatus | undefined {
    return this.healthStatus.get(pluginName);
  }

  /**
   * Get latest health report for a plugin
   */
  getHealthReport(pluginName: string): PluginHealthReport | undefined {
    return this.healthReports.get(pluginName);
  }

  /**
   * Get all health statuses
   */
  getAllHealthStatuses(): Map<string, PluginHealthStatus> {
    return new Map(this.healthStatus);
  }

  /**
   * Shutdown health monitor
   */
  shutdown(): void {
    // Stop all monitoring intervals
    for (const pluginName of this.checkIntervals.keys()) {
      this.stopMonitoring(pluginName);
    }
    
    this.healthChecks.clear();
    this.healthStatus.clear();
    this.healthReports.clear();
    this.failureCounters.clear();
    this.successCounters.clear();
    
    this.logger.info('Health monitor shutdown complete');
  }

  /**
   * Race a plugin's custom health check against its timeout guard, and
   * reclaim the guard the moment the race settles (#4875).
   *
   * Same shape, same reasoning as `ObjectKernel.raceStartupTimeout()` (#4813,
   * PR #4874): the guard used to be armed and then abandoned — when the check
   * won the race, its `setTimeout` stayed ref'd in the event loop for the full
   * `config.timeout`. Health checks are *periodic*, so unlike the kernel's
   * one-shot startup guards the orphans here accumulate: one per plugin per
   * round, each pinning the loop for `config.timeout`.
   *
   * Clearing on settle rather than `unref()`-ing at arm time is deliberate.
   * An unref'd guard also stops pinning the loop, but it stops being a guard
   * as well: if the check never settles and nothing else keeps the loop alive,
   * Node exits before the timer can fire and the timeout is never reported.
   * The guard has to stay ref'd exactly as long as the race is undecided,
   * which is what `clearTimeout` in a `finally` expresses.
   *
   * `check` is widened to `T | PromiseLike<T>` because `checkMethod` is called
   * dynamically off the plugin and may be synchronous; such a check wins the
   * race immediately and the guard is reclaimed on the same turn.
   */
  private async raceCheckTimeout<T>(
    check: T | PromiseLike<T>,
    ms: number,
    message: string
  ): Promise<T> {
    let guard: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      guard = setTimeout(() => {
        reject(new Error(message));
      }, ms);
    });

    try {
      return await Promise.race([check, timeoutPromise]);
    } finally {
      clearTimeout(guard);
    }
  }
}
