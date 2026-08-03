// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { 
  PluginHealthStatus, 
  PluginHealthCheck, 
  PluginHealthReport 
} from '@objectstack/spec/kernel';
import type { ObjectLogger } from './logger.js';
import type { Plugin } from './types.js';

/**
 * Plugin Health Monitor
 * 
 * Monitors plugin health status and performs automatic recovery actions.
 * Implements the advanced lifecycle health monitoring protocol.
 */
export class PluginHealthMonitor {
  private logger: ObjectLogger;
  private healthChecks = new Map<string, PluginHealthCheck>();
  private healthStatus = new Map<string, PluginHealthStatus>();
  private healthReports = new Map<string, PluginHealthReport>();
  private checkIntervals = new Map<string, NodeJS.Timeout>();
  private failureCounters = new Map<string, number>();
  private successCounters = new Map<string, number>();
  private restartAttempts = new Map<string, number>();

  constructor(logger: ObjectLogger) {
    this.logger = logger.child({ component: 'HealthMonitor' });
  }

  /**
   * Register a plugin for health monitoring
   */
  registerPlugin(pluginName: string, config: PluginHealthCheck): void {
    this.healthChecks.set(pluginName, config);
    this.healthStatus.set(pluginName, 'unknown');
    this.failureCounters.set(pluginName, 0);
    this.successCounters.set(pluginName, 0);
    this.restartAttempts.set(pluginName, 0);

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
    config: PluginHealthCheck
  ): Promise<void> {
    const startTime = Date.now();
    let status: PluginHealthStatus = 'healthy';
    let message: string | undefined;
    const checks: Array<{ name: string; status: 'passed' | 'failed' | 'warning'; message?: string }> = [];

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

        // Recover from unhealthy state if we have enough successes
        const currentStatus = this.healthStatus.get(pluginName);
        if (currentStatus === 'unhealthy' || currentStatus === 'degraded') {
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
        this.failureCounters.set(pluginName, (this.failureCounters.get(pluginName) || 0) + 1);
        this.successCounters.set(pluginName, 0);

        const failureCount = this.failureCounters.get(pluginName) || 0;
        if (failureCount >= config.failureThreshold) {
          this.healthStatus.set(pluginName, 'unhealthy');
          this.logger.warn('Plugin marked as unhealthy', { 
            plugin: pluginName, 
            failures: failureCount 
          });

          // Attempt auto-restart if configured
          if (config.autoRestart) {
            await this.attemptRestart(pluginName, plugin, config);
          }
        } else {
          this.healthStatus.set(pluginName, 'degraded');
        }
      }
    } catch (error) {
      status = 'failed';
      message = error instanceof Error ? error.message : 'Unknown error';
      this.failureCounters.set(pluginName, (this.failureCounters.get(pluginName) || 0) + 1);
      this.healthStatus.set(pluginName, 'failed');
      
      checks.push({ 
        name: 'health-check', 
        status: 'failed', 
        message: message 
      });

      this.logger.error('Health check exception', { 
        plugin: pluginName, 
        error 
      });
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
   * Attempt to restart a plugin
   */
  private async attemptRestart(
    pluginName: string,
    plugin: Plugin,
    config: PluginHealthCheck
  ): Promise<void> {
    const attempts = this.restartAttempts.get(pluginName) || 0;
    
    if (attempts >= config.maxRestartAttempts) {
      this.logger.error('Max restart attempts reached, giving up', { 
        plugin: pluginName, 
        attempts 
      });
      this.healthStatus.set(pluginName, 'failed');
      return;
    }

    this.restartAttempts.set(pluginName, attempts + 1);
    
    // Calculate backoff delay
    const delay = this.calculateBackoff(attempts, config.restartBackoff);
    
    this.logger.info('Scheduling plugin restart', { 
      plugin: pluginName, 
      attempt: attempts + 1, 
      delay 
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Call destroy and init to restart
      if (plugin.destroy) {
        await plugin.destroy();
      }
      
      // Note: Full restart would require kernel context
      // This is a simplified version - actual implementation would need kernel integration
      this.logger.info('Plugin restarted', { plugin: pluginName });
      
      // Reset counters on successful restart
      this.failureCounters.set(pluginName, 0);
      this.successCounters.set(pluginName, 0);
      this.healthStatus.set(pluginName, 'recovering');
    } catch (error) {
      this.logger.error('Plugin restart failed', { 
        plugin: pluginName, 
        error 
      });
      this.healthStatus.set(pluginName, 'failed');
    }
  }

  /**
   * Calculate backoff delay for restarts
   */
  private calculateBackoff(attempt: number, strategy: 'fixed' | 'linear' | 'exponential'): number {
    const baseDelay = 1000; // 1 second base

    switch (strategy) {
      case 'fixed':
        return baseDelay;
      case 'linear':
        return baseDelay * (attempt + 1);
      case 'exponential':
        return baseDelay * Math.pow(2, attempt);
      default:
        return baseDelay;
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
    this.restartAttempts.clear();
    
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
