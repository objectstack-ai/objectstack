// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Phase 2 Integration Example
 * 
 * This example demonstrates how to use all Phase 2 components together
 * in a real-world scenario.
 */

import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  ObjectKernel,
  PluginHealthMonitor,
  HotReloadManager,
  PluginPermissionManager,
  PluginSandboxRuntime,
  PluginSecurityScanner,
  createLogger
} from '../src/index.js';

import type { Plugin, ObjectLogger } from '../src/index.js';
// [#14613] The PARSED variants, because that is what the methods below take:
// `PluginHealthMonitor.registerPlugin` is declared over `PluginHealthCheckParsed`
// and `HotReloadManager.registerPlugin` over `HotReloadConfigParsed`
// (`src/health-monitor.ts`, `src/hot-reload.ts`). The unparsed shapes have every
// key optional, so passing them was a real type error this file carried while no
// tsc program read it.
import type {
  PluginHealthCheckParsed,
  HotReloadConfigParsed,
  PluginPermissionSet,
  SandboxConfig
} from '@objectstack/spec/kernel';

/**
 * Example: Enterprise Plugin Platform with Phase 2 Features
 */
export class EnterprisePluginPlatform {
  private kernel: ObjectKernel;
  private logger: ObjectLogger;
  private healthMonitor: PluginHealthMonitor;
  private hotReload: HotReloadManager;
  private permManager: PluginPermissionManager;
  private sandbox: PluginSandboxRuntime;
  private scanner: PluginSecurityScanner;

  constructor() {
    // Initialize kernel
    this.kernel = new ObjectKernel({
      logger: {
        level: 'info',
        name: 'EnterprisePluginPlatform',
      },
    });

    // [#14613] The example's OWN logger. `ObjectKernel.logger` is private, so
    // every one of the 20 reads this file made of it was a type error --
    // invisible until this package declared a `typecheck` script, because no
    // tsc program had ever compiled this directory.
    this.logger = createLogger({ level: 'info', name: 'EnterprisePluginPlatform' });

    // Initialize Phase 2 components
    this.healthMonitor = new PluginHealthMonitor(this.logger);
    this.hotReload = new HotReloadManager(this.logger);
    this.permManager = new PluginPermissionManager(this.logger);
    this.sandbox = new PluginSandboxRuntime(this.logger);
    this.scanner = new PluginSecurityScanner(this.logger);
  }

  /**
   * Install and configure a plugin with full Phase 2 features
   */
  async installPlugin(
    plugin: Plugin,
    config: {
      health?: PluginHealthCheckParsed;
      hotReload?: HotReloadConfigParsed;
      permissions?: PluginPermissionSet;
      sandbox?: SandboxConfig;
      securityScan?: boolean;
    }
  ): Promise<void> {
    const pluginName = plugin.name;
    const pluginVersion = plugin.version || '1.0.0';

    this.logger.info(`Installing plugin: ${pluginName} v${pluginVersion}`);

    // Step 1: Security Scan
    if (config.securityScan !== false) {
      this.logger.info('Running security scan...');
      
      const scanResult = await this.scanner.scan({
        pluginId: pluginName,
        version: pluginVersion,
        // In real implementation, would provide actual files and dependencies
      });

      // [#14613] `KernelSecurityScanResult` carries `status` and per-severity
      // COUNTS; it has never had `passed`, `score`, `summary.critical` or
      // `summary.high`. This block read four members that do not exist.
      if (scanResult.status !== 'passed') {
        throw new Error(
          `Security scan ${scanResult.status}: ` +
          `${scanResult.summary.totalVulnerabilities} vulnerability(ies), ` +
          `Critical: ${scanResult.summary.criticalCount}, ` +
          `High: ${scanResult.summary.highCount}`
        );
      }

      this.logger.info(
        `Security scan passed: ${scanResult.summary.totalVulnerabilities} vulnerability(ies)`
      );
    }

    // Step 2: Register Permissions
    if (config.permissions) {
      this.permManager.registerPermissions(pluginName, config.permissions);
      
      // Auto-grant all permissions (in production, would prompt user)
      this.permManager.grantAllPermissions(pluginName, 'system');
      
      this.logger.info(
        `Permissions registered: ${config.permissions.permissions.length} permissions`
      );
    }

    // Step 3: Create Sandbox
    if (config.sandbox) {
      this.sandbox.createSandbox(pluginName, config.sandbox);
      this.logger.info(`Sandbox created: ${config.sandbox.level} level`);
    }

    // Step 4: Register for Health Monitoring
    if (config.health) {
      this.healthMonitor.registerPlugin(pluginName, config.health);
      this.logger.info(
        `Health monitoring configured: ${config.health.interval}ms interval`
      );
    }

    // Step 5: Register for Hot Reload
    if (config.hotReload) {
      this.hotReload.registerPlugin(pluginName, config.hotReload);
      this.logger.info(
        `Hot reload enabled: ${config.hotReload.stateStrategy} state strategy`
      );
    }

    // Step 6: Register with Kernel
    this.kernel.use(plugin);

    this.logger.info(`Plugin ${pluginName} installed successfully`);
  }

  /**
   * Bootstrap the platform
   */
  async start(): Promise<void> {
    // Bootstrap kernel (will init and start all plugins)
    await this.kernel.bootstrap();

    // Start health monitoring for all registered plugins
    for (const [pluginName, plugin] of this.kernel['plugins']) {
      if (this.healthMonitor['healthChecks'].has(pluginName)) {
        this.healthMonitor.startMonitoring(pluginName, plugin);
      }
    }

    this.logger.info('Platform started successfully');
  }

  /**
   * Shutdown the platform
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down platform...');

    // Stop health monitoring
    this.healthMonitor.shutdown();

    // Shutdown sandbox
    this.sandbox.shutdown();

    // Shutdown kernel
    await this.kernel.shutdown();

    this.logger.info('Platform shutdown complete');
  }

  /**
   * Get platform health status
   */
  getHealthStatus(): Record<string, any> {
    const statuses = this.healthMonitor.getAllHealthStatuses();
    const summary: Record<string, any> = {
      totalPlugins: statuses.size,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      failed: 0,
      plugins: {},
    };

    for (const [pluginName, status] of statuses) {
      summary[status]++;
      summary.plugins[pluginName] = {
        status,
        report: this.healthMonitor.getHealthReport(pluginName),
      };
    }

    return summary;
  }

  /**
   * Perform hot reload of a plugin
   */
  async reloadPlugin(pluginName: string): Promise<void> {
    this.logger.info(`Hot reloading plugin: ${pluginName}`);

    const plugin = this.kernel['plugins'].get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    // Get current state (simplified - would need plugin cooperation)
    const getState = () => ({
      timestamp: Date.now(),
      // ... plugin state
    });

    // Restore state (simplified - would need plugin cooperation)
    const restoreState = (state: Record<string, any>) => {
      this.logger.info(`Restoring state from ${new Date(state.timestamp)}`);
      // ... restore plugin state
    };

    await this.hotReload.reloadPlugin(
      pluginName,
      plugin,
      plugin.version || '1.0.0',
      getState,
      restoreState
    );

    this.logger.info(`Plugin ${pluginName} reloaded successfully`);
  }
}

/**
 * Example Usage
 */
async function example() {
  const platform = new EnterprisePluginPlatform();

  // Define a sample plugin
  const myPlugin: Plugin = {
    name: 'com.example.my-plugin',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    
    async init(ctx) {
      ctx.logger.info('MyPlugin initializing...');
      // Initialize plugin
    },
    
    async start(ctx) {
      ctx.logger.info('MyPlugin starting...');
      // Start plugin services
    },
    
    async destroy() {
      console.log('MyPlugin destroying...');
      // Cleanup
    },
  };

  // Install plugin with full Phase 2 features
  await platform.installPlugin(myPlugin, {
    // Health monitoring
    health: {
      interval: 30000,           // Check every 30 seconds
      timeout: 5000,
      failureThreshold: 3,
      successThreshold: 1,
      // [#12032] `autoRestart` / `maxRestartAttempts` / `restartBackoff`
      // removed: the monitor never restarted anything (it called
      // `plugin.destroy()` and reported the corpse `healthy`), so the keys
      // were retired under ADR-0049. Act on `getHealthStatus()` in the host.
    },

    // Hot reload
    hotReload: {
      enabled: true,
      debounceDelay: 1000,
      preserveState: true,
      stateStrategy: 'memory',
      shutdownTimeout: 30000,
    },

    // Permissions
    permissions: {
      permissions: [
        {
          id: 'read-data',
          resource: 'data.object',
          actions: ['read'],
          scope: 'plugin',
          description: 'Read object data',
          required: true,
        },
        {
          id: 'write-data',
          resource: 'data.object',
          actions: ['create', 'update'],
          scope: 'plugin',
          description: 'Write object data',
          required: false,
        },
      ],
      defaultGrant: 'prompt',
    },

    // Sandbox
    sandbox: {
      enabled: true,
      level: 'standard',
      filesystem: {
        mode: 'restricted',
        allowedPaths: ['/app/plugins/my-plugin'],
        deniedPaths: ['/etc', '/root'],
      },
      network: {
        mode: 'restricted',
        allowedHosts: ['api.example.com'],
        maxConnections: 10,
      },
      process: {
        allowSpawn: false,
      },
      memory: {
        maxHeap: 100 * 1024 * 1024, // 100 MB
      },
    },

    // Security scanning
    securityScan: true,
  });

  // Start platform
  await platform.start();

  // Get health status
  const health = platform.getHealthStatus();
  console.log('Platform Health:', health);

  // Simulate hot reload after some time
  setTimeout(async () => {
    await platform.reloadPlugin('com.example.my-plugin');
  }, 60000);

  // Shutdown on SIGINT
  process.on('SIGINT', async () => {
    await platform.shutdown();
    process.exit(0);
  });
}

// ─── entry guard ───────────────────────────────────────────────────────
// ⛔ NOT ``import.meta.url === `file://${process.argv[1]}` ``. Node symlink-resolves
// `import.meta.url` but leaves `process.argv[1]` exactly as the caller typed it, and
// the template also skips the percent-encoding `pathToFileURL` applies — so that
// spelling goes INERT (exit 0, no output) through a symlink AND on any checkout path
// containing a character that needs encoding (a `#` in a parent directory name is
// enough, with no symlink involved). Compare RESOLVED PATHS, never URL strings.
//
// Same predicate as `packages/cli/src/utils/invocation.ts` (`isProcessEntry`) and
// `scripts/invoked-as.mjs` (`invokedAs`). Spelled out rather than imported because
// neither home is legally reachable from this file — the PR for #10269 carries the
// boundary measurement. ⚠️ Two predicates answering this question differently IS the
// defect this closes; change one, change all of them.
function isProcessEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false; // `node --eval` / the REPL
  const self = resolve(fileURLToPath(import.meta.url));
  const entry = resolve(entryArg);
  // `node <dir>` gives the ENTRY ARGUMENT, and only it, directory resolution.
  const candidates = [entry, join(entry, 'index.js'), join(entry, 'index.mjs'), join(entry, 'index.ts')];
  if (candidates.includes(self)) return true;
  const realSelf = realOrSelf(self);
  return candidates.some((candidate) => realOrSelf(candidate) === realSelf);
}

/** `realpathSync`, degrading to the input for a path that cannot be read. */
function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

if (isProcessEntry()) {
  example().catch(console.error);
}
