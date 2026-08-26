import { describe, expect, it } from 'vitest';
import {
  PluginHealthStatusSchema,
  PluginHealthCheckSchema,
  PluginHealthReportSchema,
  HotReloadConfigSchema,
  PluginStateSnapshotSchema,
} from './plugin-lifecycle-advanced.zod';

describe('Plugin Lifecycle Advanced Schemas', () => {
  describe('PluginHealthStatusSchema', () => {
    it('should validate valid health statuses', () => {
      expect(() => PluginHealthStatusSchema.parse('healthy')).not.toThrow();
      expect(() => PluginHealthStatusSchema.parse('degraded')).not.toThrow();
      expect(() => PluginHealthStatusSchema.parse('unhealthy')).not.toThrow();
      expect(() => PluginHealthStatusSchema.parse('failed')).not.toThrow();
      expect(() => PluginHealthStatusSchema.parse('recovering')).not.toThrow();
      expect(() => PluginHealthStatusSchema.parse('unknown')).not.toThrow();
    });

    it('should reject invalid health statuses', () => {
      expect(() => PluginHealthStatusSchema.parse('invalid')).toThrow();
      expect(() => PluginHealthStatusSchema.parse('')).toThrow();
    });
  });

  describe('PluginHealthCheckSchema', () => {
    it('should validate health check with defaults', () => {
      const healthCheck = PluginHealthCheckSchema.parse({});
      expect(healthCheck.interval).toBe(30000);
      expect(healthCheck.timeout).toBe(5000);
      expect(healthCheck.failureThreshold).toBe(3);
      expect(healthCheck.successThreshold).toBe(1);
      expect(healthCheck.autoRestart).toBe(false);
      expect(healthCheck.maxRestartAttempts).toBe(3);
      expect(healthCheck.restartBackoff).toBe('exponential');
    });

    it('should validate custom health check configuration', () => {
      const config = {
        interval: 60000,
        timeout: 10000,
        failureThreshold: 5,
        successThreshold: 2,
        autoRestart: true,
        maxRestartAttempts: 5,
        restartBackoff: 'linear' as const,
        checkMethod: 'healthCheck',
      };
      const healthCheck = PluginHealthCheckSchema.parse(config);
      expect(healthCheck).toEqual(config);
    });

    it('should enforce minimum interval', () => {
      expect(() => PluginHealthCheckSchema.parse({ interval: 500 })).toThrow();
    });

    it('should enforce minimum timeout', () => {
      expect(() => PluginHealthCheckSchema.parse({ timeout: 50 })).toThrow();
    });
  });

  describe('PluginHealthReportSchema', () => {
    it('should validate complete health report', () => {
      const report = {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        message: 'Plugin is operating normally',
        metrics: {
          uptime: 3600000,
          memoryUsage: 52428800,
          cpuUsage: 15.5,
          activeConnections: 10,
          errorRate: 0.1,
          responseTime: 150,
        },
        checks: [
          {
            name: 'database',
            status: 'passed' as const,
            message: 'Database connection is healthy',
          },
          {
            name: 'cache',
            status: 'passed' as const,
          },
        ],
        dependencies: [
          {
            pluginId: 'com.objectstack.driver.postgres',
            status: 'healthy' as const,
          },
        ],
      };
      const result = PluginHealthReportSchema.parse(report);
      expect(result.status).toBe('healthy');
      expect(result.metrics?.uptime).toBe(3600000);
      expect(result.checks).toHaveLength(2);
    });

    it('should validate minimal health report', () => {
      const report = {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
      };
      const result = PluginHealthReportSchema.parse(report);
      expect(result.status).toBe('healthy');
    });
  });

  describe('HotReloadConfigSchema', () => {
    it('should validate hot reload with defaults', () => {
      const config = HotReloadConfigSchema.parse({});
      expect(config.enabled).toBe(false);
      expect(config.debounceDelay).toBe(1000);
      expect(config.preserveState).toBe(true);
      expect(config.stateStrategy).toBe('memory');
      expect(config.shutdownTimeout).toBe(30000);
    });

    it('should validate custom hot reload configuration', () => {
      const config = {
        enabled: true,
        watchPatterns: ['src/**/*.ts', 'config/**/*.json'],
        debounceDelay: 2000,
        preserveState: false,
        stateStrategy: 'memory' as const,
        shutdownTimeout: 60000,
        beforeReload: ['beforeReloadHook'],
        afterReload: ['afterReloadHook'],
      };
      const result = HotReloadConfigSchema.parse(config);
      expect(result).toEqual(config);
    });

    // ── [#12340] The two retired strategies are REFUSED, with the prescription ──
    //
    // This block replaces the fixture that pinned the deleted 'distributed'
    // arm. That fixture passed precisely BECAUSE the arm existed and did
    // nothing: it asserted the value survived the parse, which was true right
    // up to the moment it stopped meaning anything at runtime.
    for (const retired of ['disk', 'distributed'] as const) {
      it(`refuses stateStrategy '${retired}' with the retirement prescription`, () => {
        const result = HotReloadConfigSchema.safeParse({ enabled: true, stateStrategy: retired });
        expect(result.success, `'${retired}' must no longer parse`).toBe(false);

        // The message IS the contract here — it is the whole migration
        // document for whoever hits it. Assert the load-bearing clauses, not
        // the byte string.
        const message = result.success ? '' : result.error.issues[0]?.message ?? '';
        expect(message).toContain('were removed');
        expect(message).toContain('#12340');
        expect(message).toContain('ADR-0049');
        expect(message).toMatch(/memory fallback|in-memory Map/);
        expect(message).toContain("Use 'memory'");
      });
    }

    it('keeps zod\'s own enum message for a value that was never legal', () => {
      // Anti-vacuity for the error map: a typo must NOT be told it "was
      // removed" — that would misinform the author of `dsik` (the
      // `crypto.hash` precedent's exact reasoning).
      const result = HotReloadConfigSchema.safeParse({ stateStrategy: 'dsik' });
      expect(result.success).toBe(false);
      const message = result.success ? '' : result.error.issues[0]?.message ?? '';
      expect(message).not.toContain('were removed');
      expect(message).not.toContain('#12340');
    });

    it('still accepts the two strategies the runtime implements', () => {
      for (const live of ['memory', 'none'] as const) {
        const result = HotReloadConfigSchema.safeParse({ enabled: true, stateStrategy: live });
        expect(result.success, `'${live}' must still parse`).toBe(true);
      }
    });

    it('no longer accepts distributedConfig as a declarable key', () => {
      // Non-strict object: the key is silently stripped rather than refused.
      // Pinning the STRIP is the honest assertion — it is what actually
      // happens, and it is why the prescription had to hang on the enum
      // (which IS refused) rather than on this key.
      const result = HotReloadConfigSchema.parse({
        enabled: true,
        distributedConfig: { provider: 'redis', endpoints: ['redis://localhost:6379'] },
      } as Record<string, unknown>);
      expect(result).not.toHaveProperty('distributedConfig');
    });
  });

  describe('PluginStateSnapshotSchema', () => {
    it('should validate state snapshot', () => {
      const snapshot = {
        pluginId: 'com.acme.plugin',
        version: '1.2.3',
        timestamp: new Date().toISOString(),
        state: {
          counter: 42,
          cache: { key1: 'value1' },
          settings: { theme: 'dark' },
        },
        metadata: {
          checksum: 'abc123def456',
          compressed: true,
          encryption: 'AES-256',
        },
      };
      const result = PluginStateSnapshotSchema.parse(snapshot);
      expect(result.pluginId).toBe('com.acme.plugin');
      expect(result.state.counter).toBe(42);
      expect(result.metadata?.compressed).toBe(true);
    });
  });

});
