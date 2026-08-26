// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';

import type { 
  HotReloadConfigParsed, 
  PluginStateSnapshot 
} from '@objectstack/spec/kernel';
import type { ObjectLogger } from './logger.js';
import type { Plugin } from './types.js';

// Polyfill for UUID generation to support both Node.js and Browser
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Basic UUID v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * The `stateStrategy` values `PluginStateManager` actually implements.
 *
 * This is the ENFORCED set — it exists so the runtime door and the switch in
 * `saveState` cannot drift apart silently. `@objectstack/spec`'s
 * `HotReloadConfigSchema` declares exactly these two (#12340).
 */
const HONOURED_STATE_STRATEGIES = ['memory', 'none'] as const;

/**
 * Prescription for the two strategies retired in 18 (#12340).
 *
 * Deliberately PARALLEL to `HOT_RELOAD_STATE_STRATEGY_RETIRED` in
 * `packages/spec/src/kernel/plugin-lifecycle-advanced.zod.ts` rather than
 * imported from it: every `@objectstack/core` import of
 * `@objectstack/spec/kernel` is type-only, and a value import would be the
 * first — linking that module's zod closure into every consumer of this
 * package for one string. The two prescriptions answer different doors (parse
 * vs registration); the facts they must both carry are pinned in
 * `hot-reload.test.ts`, by content and never by byte-equality.
 */
const RETIRED_STATE_STRATEGY_GUIDANCE =
  "'disk' and 'distributed' were removed from HotReloadConfig.stateStrategy in "
  + '@objectstack/spec 18 (#12340, ADR-0049 enforce-or-remove) — neither was ever '
  + "implemented. Both wrote to the same in-memory Map as 'memory' and reported it "
  + 'only at debug level, so a host that asked for durable or cluster-replicated '
  + 'state got process-local memory and no error. '
  + "Use 'memory' for in-process state preservation across a reload, or 'none' to "
  + 'disable it. There is no in-tree replacement for durable or distributed plugin '
  + 'state — persist it in the host, which owns the process lifetime these '
  + 'strategies pretended to outlive.';

/**
 * An ADR-0112-enveloped refusal (`code` + `status` on the error), so a caller —
 * and a rejection-class test — can assert the refusal rather than merely "it
 * threw". `VALIDATION_ERROR` is the standard catalog's generic
 * argument-validation code, following `metadata-service-contract.ts`.
 */
function hotReloadRefusal(message: string): Error & { code: string; status: number } {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  return err;
}

/**
 * Refuse a `stateStrategy` this library does not implement, at the moment the
 * host hands the config over.
 *
 * TypeScript hosts cannot reach this: `HotReloadConfigParsed['stateStrategy']`
 * is `'memory' | 'none'`, so `'disk'` is a compile error. This is the door for
 * the callers types do not reach — JavaScript hosts, and config that arrived
 * as JSON — which is exactly where a silent fallback used to live.
 */
function assertHonouredStateStrategy(pluginName: string, strategy: unknown): void {
  if ((HONOURED_STATE_STRATEGIES as readonly unknown[]).includes(strategy)) {
    return;
  }
  const shown = typeof strategy === 'string' ? `'${strategy}'` : String(strategy);
  const retired = strategy === 'disk' || strategy === 'distributed';
  throw hotReloadRefusal(
    `[HotReload] Plugin '${pluginName}': unsupported stateStrategy ${shown}. `
    + `Honoured values are ${HONOURED_STATE_STRATEGIES.map((v) => `'${v}'`).join(' and ')}. `
    + (retired
      ? RETIRED_STATE_STRATEGY_GUIDANCE
      : 'This value has never been implemented by PluginStateManager.')
  );
}

/**
 * Keys removed from `HotReloadConfig` that a host may still be passing.
 *
 * `HotReloadConfigSchema` is not `.strict()`, so zod would silently STRIP each
 * of these on the parse paths that exist — a clean parse and a setting that
 * never takes effect, which is the exact failure the authorable-surface gate
 * names. Both keys were removed rather than tombstoned (route 3: nothing in
 * the tree parses this schema, so a parse-time prescription reaches nobody),
 * and this table is the door that makes that route honest for the audience
 * that DOES exist — a host handing the object straight to the class.
 *
 * Each entry is the guidance clause; the `[HotReload] Plugin '<name>': `
 * prefix is added at throw time. #12340's `distributedConfig` message is
 * carried across byte-for-byte — its pins assert content, and this
 * generalisation must not move them.
 */
const RETIRED_HOT_RELOAD_KEYS: ReadonlyArray<readonly [string, string]> = [
  [
    'distributedConfig',
    "'distributedConfig' was removed from "
    + 'HotReloadConfig in @objectstack/spec 18 (#12340, ADR-0049 '
    + 'enforce-or-remove) — nothing ever read it. A provider, endpoints, a key '
    + 'prefix, a TTL and a replication factor could all be declared and no '
    + "connection was ever opened. It left with the stateStrategy: 'distributed' "
    + 'value it was documented as being required for. Delete the key; there is no '
    + 'in-tree replacement for distributed plugin state — persist it in the host.',
  ],
  [
    'watchPatterns',
    "'watchPatterns' was removed from HotReloadConfig in @objectstack/spec 18 "
    + '(#12428, ADR-0049 enforce-or-remove) — nothing ever read it. Its only two '
    + 'uses were log lines: no watcher was ever constructed from it, so an author '
    + 'could declare a glob and no file change ever triggered a reload. File '
    + 'watching is the HOST\'s job in this host-driven library. Delete the key, '
    + 'declare your globs wherever your own watcher reads them, and call '
    + '`HotReloadManager.scheduleReload(pluginName, reloadFn)` when one matches — '
    + 'that is the debounced integration point this class does implement.',
  ],
];

/**
 * Refuse a key this library removed, at the moment the host hands the config
 * over. First match wins; the order is the order they were retired.
 */
function assertNoRetiredKeys(pluginName: string, config: object): void {
  for (const [key, guidance] of RETIRED_HOT_RELOAD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      continue;
    }
    throw hotReloadRefusal(`[HotReload] Plugin '${pluginName}': ${guidance}`);
  }
}

/**
 * Plugin State Manager
 * 
 * Handles state persistence and restoration during hot reloads
 */
class PluginStateManager {
  private logger: ObjectLogger;
  private stateSnapshots = new Map<string, PluginStateSnapshot>();
  private memoryStore = new Map<string, any>();

  constructor(logger: ObjectLogger) {
    this.logger = logger.child({ component: 'StateManager' });
  }

  /**
   * Save plugin state before reload
   */
  async saveState(
    pluginId: string,
    version: string,
    state: Record<string, any>,
    config: HotReloadConfigParsed
  ): Promise<string> {
    const snapshot: PluginStateSnapshot = {
      pluginId,
      version,
      timestamp: new Date().toISOString(),
      state,
      metadata: {
        checksum: this.calculateChecksum(state),
        compressed: false,
      },
    };

    const snapshotId = generateUUID();

    switch (config.stateStrategy) {
      case 'memory':
        this.memoryStore.set(snapshotId, snapshot);
        this.logger.debug('State saved to memory', { pluginId, snapshotId });
        break;

      case 'none':
        this.logger.debug('State persistence disabled', { pluginId });
        break;
    }

    this.stateSnapshots.set(pluginId, snapshot);
    return snapshotId;
  }

  /**
   * Restore plugin state after reload
   */
  async restoreState(
    pluginId: string,
    snapshotId?: string
  ): Promise<Record<string, any> | undefined> {
    // Try to get from snapshot ID first, otherwise use latest for plugin
    let snapshot: PluginStateSnapshot | undefined;

    if (snapshotId) {
      snapshot = this.memoryStore.get(snapshotId);
    } else {
      snapshot = this.stateSnapshots.get(pluginId);
    }

    if (!snapshot) {
      this.logger.warn('No state snapshot found', { pluginId, snapshotId });
      return undefined;
    }

    // Verify checksum if available
    if (snapshot.metadata?.checksum) {
      const currentChecksum = this.calculateChecksum(snapshot.state);
      if (currentChecksum !== snapshot.metadata.checksum) {
        this.logger.error('State checksum mismatch - data may be corrupted', { 
          pluginId,
          expected: snapshot.metadata.checksum,
          actual: currentChecksum
        });
        return undefined;
      }
    }

    this.logger.debug('State restored', { pluginId, version: snapshot.version });
    return snapshot.state;
  }

  /**
   * Clear state for a plugin
   */
  clearState(pluginId: string): void {
    this.stateSnapshots.delete(pluginId);
    // Note: We don't clear memory store as it might have multiple snapshots
    this.logger.debug('State cleared', { pluginId });
  }

  /**
   * Calculate checksum for state verification using SHA-256.
   */
  private calculateChecksum(state: Record<string, any>): string {
    const stateStr = JSON.stringify(state);
    return createHash('sha256').update(stateStr).digest('hex');
  }

  /**
   * Shutdown state manager
   */
  shutdown(): void {
    this.stateSnapshots.clear();
    this.memoryStore.clear();
    this.logger.info('State manager shutdown complete');
  }
}

/**
 * Hot Reload Manager
 * 
 * Manages hot reloading of plugins with state preservation
 */
export class HotReloadManager {
  private logger: ObjectLogger;
  private stateManager: PluginStateManager;
  private reloadConfigs = new Map<string, HotReloadConfigParsed>();
  private reloadTimers = new Map<string, NodeJS.Timeout>();

  constructor(logger: ObjectLogger) {
    this.logger = logger.child({ component: 'HotReload' });
    this.stateManager = new PluginStateManager(logger);
  }

  /**
   * Register a plugin for hot reload
   */
  registerPlugin(pluginName: string, config: HotReloadConfigParsed): void {
    // Refused BEFORE the `enabled` check on purpose: a config naming a
    // strategy this library cannot honour is malformed whether or not hot
    // reload is switched on, and a door that opens only for `enabled: true`
    // would let the false declaration through on exactly the configs nobody
    // is watching.
    assertHonouredStateStrategy(pluginName, config.stateStrategy);
    assertNoRetiredKeys(pluginName, config);

    if (!config.enabled) {
      this.logger.debug('Hot reload disabled for plugin', { plugin: pluginName });
      return;
    }

    this.reloadConfigs.set(pluginName, config);
    this.logger.info('Plugin registered for hot reload', { 
      plugin: pluginName,
      stateStrategy: config.stateStrategy
    });
  }

  /**
   * Refuse the file-watching call this class never implemented (#12428).
   *
   * The body used to be a guard plus `logger.info('File watching started')`
   * over an in-source note saying real watching "would require chokidar or
   * similar". Nothing was ever watched, so an operator who set
   * `enabled: true` and read that line at INFO had been told the opposite of
   * the truth — positive confirmation of a capability that did not exist.
   * ADR-0049 leaves three states and this surface qualified for none of the
   * other two: no runtime composes this class, so ENFORCE would build for a
   * caller that does not exist, and no roadmap entry anywhere claims the
   * feature, so EXPERIMENTAL would be a promise nobody made.
   *
   * Kept as a throwing door rather than deleted: removing the method leaves a
   * JavaScript host a bare `TypeError: not a function` with no prescription,
   * and this is the one place a caller of the old placeholder is guaranteed
   * to arrive. The refusal carries an ADR-0112 envelope so it can be asserted
   * rather than merely caught.
   */
  startWatching(pluginName: string): never {
    throw hotReloadRefusal(
      `[HotReload] Plugin '${pluginName}': startWatching() never watched `
      + 'anything and was removed in @objectstack/core 18 (#12428, ADR-0049 '
      + "enforce-or-remove). It logged 'File watching started' at info level "
      + 'while no watcher was ever constructed, so no file change could ever '
      + 'trigger a reload. File watching is the HOST\'s job in this '
      + 'host-driven library: run your own watcher and call '
      + '`HotReloadManager.scheduleReload(pluginName, reloadFn)` when a file '
      + 'changes — that is the debounced integration point this class does '
      + 'implement. `HotReloadConfig.watchPatterns` was removed in '
      + '@objectstack/spec 18 for the same reason; declare your globs where '
      + 'your watcher reads them.'
    );
  }

  /**
   * Cancel a pending debounced reload for a plugin.
   *
   * The name is historical (#12428). This never stopped a watcher, because
   * nothing in this class ever started one: its `watchHandles` cleanup branch
   * read a Map that had no writer anywhere in the tree, so the branch was
   * structurally unreachable rather than merely untaken, and it left with
   * `startWatching`'s placeholder. What survives is the half that always did
   * something — the debounce timer armed by `scheduleReload` is cleared, so a
   * reload that was scheduled but has not fired yet is cancelled.
   */
  stopWatching(pluginName: string): void {
    const timer = this.reloadTimers.get(pluginName);
    if (timer) {
      clearTimeout(timer);
      this.reloadTimers.delete(pluginName);
    }
  }

  /**
   * Trigger hot reload for a plugin
   */
  async reloadPlugin(
    pluginName: string,
    plugin: Plugin,
    version: string,
    getPluginState: () => Record<string, any>,
    restorePluginState: (state: Record<string, any>) => void
  ): Promise<boolean> {
    const config = this.reloadConfigs.get(pluginName);
    if (!config) {
      this.logger.warn('Cannot reload - plugin not registered', { plugin: pluginName });
      return false;
    }

    this.logger.info('Starting hot reload', { plugin: pluginName });

    try {
      // Call before reload hooks
      if (config.beforeReload) {
        this.logger.debug('Executing before reload hooks', { 
          plugin: pluginName,
          hooks: config.beforeReload 
        });
        // Hook execution would be done through kernel's hook system
      }

      // Save state if configured
      let snapshotId: string | undefined;
      if (config.preserveState && config.stateStrategy !== 'none') {
        const state = getPluginState();
        snapshotId = await this.stateManager.saveState(
          pluginName,
          version,
          state,
          config
        );
        this.logger.debug('Plugin state saved', { plugin: pluginName, snapshotId });
      }

      // Gracefully shutdown the plugin
      if (plugin.destroy) {
        this.logger.debug('Destroying plugin', { plugin: pluginName });
        
        await this.raceShutdownTimeout(
          plugin.destroy(),
          config.shutdownTimeout,
          'Shutdown timeout'
        );
        this.logger.debug('Plugin destroyed successfully', { plugin: pluginName });
      }

      // At this point, the kernel would reload the plugin module
      // This would be handled by the plugin loader
      this.logger.debug('Plugin module would be reloaded here', { plugin: pluginName });

      // Restore state if we saved it
      if (snapshotId && config.preserveState) {
        const restoredState = await this.stateManager.restoreState(pluginName, snapshotId);
        if (restoredState) {
          restorePluginState(restoredState);
          this.logger.debug('Plugin state restored', { plugin: pluginName });
        }
      }

      // Call after reload hooks
      if (config.afterReload) {
        this.logger.debug('Executing after reload hooks', { 
          plugin: pluginName,
          hooks: config.afterReload 
        });
        // Hook execution would be done through kernel's hook system
      }

      this.logger.info('Hot reload completed successfully', { plugin: pluginName });
      return true;
    } catch (error) {
      this.logger.error('Hot reload failed', { 
        plugin: pluginName, 
        error 
      });
      return false;
    }
  }

  /**
   * Race a plugin's `destroy()` against its shutdown-timeout guard, and
   * reclaim the guard the moment the race settles (#4952).
   *
   * The guard used to be armed and then abandoned — byte-for-byte the leak
   * #4813 fixed in the kernel's startup guards (PR #4874) and #4875 fixed in
   * the periodic health checks (PR #4950): when `destroy()` won the race, its
   * `setTimeout` stayed ref'd in the event loop for the full
   * `shutdownTimeout`, so a hot reload that finished in milliseconds still
   * pinned the loop for the whole budget — once per reload, per plugin.
   *
   * Clearing on settle rather than `unref()`-ing at arm time is deliberate.
   * An unref'd guard also stops pinning the loop, but it stops being a guard
   * as well: if `destroy()` never settles and nothing else keeps the loop
   * alive, Node exits before the timer can fire and the timeout is never
   * reported. The guard has to stay ref'd exactly as long as the race is
   * undecided, which is what `clearTimeout` in a `finally` expresses.
   *
   * `shutdown` is widened to `T | PromiseLike<T>` because the Plugin contract
   * permits a synchronous `destroy()` (`Promise<void> | void`); such a hook
   * wins the race immediately and the guard is reclaimed on the same turn.
   */
  private async raceShutdownTimeout<T>(
    shutdown: T | PromiseLike<T>,
    timeout: number,
    message: string
  ): Promise<T> {
    let guard: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      guard = setTimeout(() => {
        reject(new Error(message));
      }, timeout);
    });

    try {
      return await Promise.race([shutdown, timeoutPromise]);
    } finally {
      clearTimeout(guard);
    }
  }

  /**
   * Schedule a reload with debouncing
   */
  scheduleReload(
    pluginName: string,
    reloadFn: () => Promise<void>
  ): void {
    const config = this.reloadConfigs.get(pluginName);
    if (!config) {
      return;
    }

    // Clear existing timer
    const existingTimer = this.reloadTimers.get(pluginName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new reload with debounce
    const timer = setTimeout(() => {
      this.logger.debug('Debounce period elapsed, executing reload', { 
        plugin: pluginName 
      });
      reloadFn().catch(error => {
        this.logger.error('Scheduled reload failed', { 
          plugin: pluginName, 
          error 
        });
      });
      this.reloadTimers.delete(pluginName);
    }, config.debounceDelay);

    this.reloadTimers.set(pluginName, timer);
    this.logger.debug('Reload scheduled with debounce', { 
      plugin: pluginName,
      delay: config.debounceDelay 
    });
  }

  /**
   * Get state manager for direct access
   */
  getStateManager(): PluginStateManager {
    return this.stateManager;
  }

  /**
   * Shutdown hot reload manager
   */
  shutdown(): void {
    // Clear all timers
    for (const timer of this.reloadTimers.values()) {
      clearTimeout(timer);
    }

    this.reloadConfigs.clear();
    this.reloadTimers.clear();
    this.stateManager.shutdown();
    
    this.logger.info('Hot reload manager shutdown complete');
  }
}
