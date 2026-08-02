import { describe, it, expect } from 'vitest';
import type {
  StartupOptions,
  StartupOptionsInput,
  PluginStartupResult,
  HealthStatus,
  IStartupOrchestrator,
} from './startup-orchestrator';
// [#4538] The contract's data shapes ARE the kernel zod types — the same
// declaration, re-exported. This import compiling is part of the pin.
import { StartupOptionsSchema } from '../kernel/startup-orchestrator.zod';
import type { Plugin } from './plugin-validator';

describe('Startup Orchestrator Contract', () => {
  describe('StartupOptions tiers (re-exported kernel zod types, #4538)', () => {
    it('should allow an empty INPUT-tier options object (all optional)', () => {
      const options: StartupOptionsInput = {};

      expect(options).toBeDefined();
      expect(options.timeout).toBeUndefined();
      expect(options.rollbackOnFailure).toBeUndefined();
    });

    it('parses the input tier into the defaulted StartupOptions tier', () => {
      const parsed: StartupOptions = StartupOptionsSchema.parse({});

      expect(parsed.timeout).toBe(30000);
      expect(parsed.rollbackOnFailure).toBe(true);
      expect(parsed.healthCheck).toBe(false);
      expect(parsed.parallel).toBe(false);
    });

    it('should allow full options', () => {
      const options: StartupOptionsInput = {
        timeout: 30000,
        rollbackOnFailure: true,
        healthCheck: true,
        parallel: false,
        context: { db: 'postgres' },
      };

      expect(options.timeout).toBe(30000);
      expect(options.rollbackOnFailure).toBe(true);
      expect(options.healthCheck).toBe(true);
      expect(options.parallel).toBe(false);
      expect(options.context).toEqual({ db: 'postgres' });
    });
  });

  describe('HealthStatus interface', () => {
    it('should allow a minimal health status', () => {
      const status: HealthStatus = {
        healthy: true,
        timestamp: Date.now(),
      };

      expect(status.healthy).toBe(true);
      expect(status.timestamp).toBeGreaterThan(0);
    });

    it('should allow a full health status with details', () => {
      const status: HealthStatus = {
        healthy: false,
        timestamp: Date.now(),
        details: { connections: 0, maxConnections: 10 },
        message: 'No database connections available',
      };

      expect(status.healthy).toBe(false);
      expect(status.message).toBe('No database connections available');
      expect(status.details).toHaveProperty('connections');
    });
  });

  describe('PluginStartupResult interface', () => {
    it('should represent a successful startup', () => {
      const plugin: Plugin = { name: 'auth-plugin', version: '1.0.0' };
      const result: PluginStartupResult = {
        plugin,
        success: true,
        duration: 150,
      };

      expect(result.success).toBe(true);
      expect(result.duration).toBe(150);
      expect(result.error).toBeUndefined();
    });

    it('should represent a failed startup with a SERIALIZABLE error (#4538)', () => {
      const plugin: Plugin = { name: 'broken-plugin' };
      const result: PluginStartupResult = {
        plugin,
        success: false,
        duration: 30000,
        // The kernel schema declares the serializable projection, not a live
        // Error instance — what a wire/log consumer of the result can carry.
        error: { name: 'Error', message: 'Timeout' },
      };

      expect(result.success).toBe(false);
      expect(result.error!.message).toBe('Timeout');
    });

    it('should include optional health status', () => {
      const plugin: Plugin = { name: 'healthy-plugin' };
      const result: PluginStartupResult = {
        plugin,
        success: true,
        duration: 50,
        health: {
          healthy: true,
          timestamp: Date.now(),
          details: { uptime: 1000 },
        },
      };

      expect(result.health!.healthy).toBe(true);
    });
  });

  describe('IStartupOrchestrator interface', () => {
    it('should allow a minimal implementation', () => {
      const orchestrator: IStartupOrchestrator = {
        orchestrateStartup: async (plugins, _options) => {
          return plugins.map((p) => ({
            plugin: p,
            success: true,
            duration: 10,
          }));
        },
        rollback: async (_startedPlugins) => {},
        checkHealth: async (_plugin) => ({
          healthy: true,
          timestamp: Date.now(),
        }),
      };

      expect(typeof orchestrator.orchestrateStartup).toBe('function');
      expect(typeof orchestrator.rollback).toBe('function');
      expect(typeof orchestrator.checkHealth).toBe('function');
    });

    it('should orchestrate startup for multiple plugins', async () => {
      const plugins: Plugin[] = [
        { name: 'core', version: '1.0.0' },
        { name: 'auth', version: '2.0.0', dependencies: ['core'] },
      ];

      const orchestrator: IStartupOrchestrator = {
        orchestrateStartup: async (pluginList, options) => {
          return pluginList.map((p) => ({
            plugin: p,
            success: true,
            duration: options.timeout ? 10 : 20,
          }));
        },
        rollback: async () => {},
        checkHealth: async () => ({ healthy: true, timestamp: Date.now() }),
      };

      const results = await orchestrator.orchestrateStartup(plugins, { timeout: 5000 });
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].plugin.name).toBe('auth');
    });

    it('should support optional startWithTimeout method', async () => {
      const orchestrator: IStartupOrchestrator = {
        orchestrateStartup: async () => [],
        rollback: async () => {},
        checkHealth: async () => ({ healthy: true, timestamp: Date.now() }),
        startWithTimeout: async (_plugin, _context, _timeoutMs) => {},
      };

      expect(orchestrator.startWithTimeout).toBeDefined();
      await expect(
        orchestrator.startWithTimeout!({ name: 'test' }, {}, 5000)
      ).resolves.toBeUndefined();
    });

    it('should rollback started plugins on failure', async () => {
      const rolledBack: string[] = [];

      const orchestrator: IStartupOrchestrator = {
        orchestrateStartup: async () => [],
        rollback: async (startedPlugins) => {
          for (const p of startedPlugins) {
            rolledBack.push(p.name);
          }
        },
        checkHealth: async () => ({ healthy: true, timestamp: Date.now() }),
      };

      await orchestrator.rollback([
        { name: 'plugin-a' },
        { name: 'plugin-b' },
      ]);

      expect(rolledBack).toEqual(['plugin-a', 'plugin-b']);
    });
  });
});
