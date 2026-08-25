import { describe, expect, it } from 'vitest';
import {
  PluginHealthStatusSchema,
  PluginHealthCheckSchema,
  PluginHealthReportSchema,
  DistributedStateConfigSchema,
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
        stateStrategy: 'disk' as const,
        shutdownTimeout: 60000,
        beforeReload: ['beforeReloadHook'],
        afterReload: ['afterReloadHook'],
      };
      const result = HotReloadConfigSchema.parse(config);
      expect(result).toEqual(config);
    });

    it('should validate distributed state strategy', () => {
      const config = {
        enabled: true,
        stateStrategy: 'distributed' as const,
        distributedConfig: {
          provider: 'redis' as const,
          endpoints: ['redis://localhost:6379'],
          keyPrefix: 'plugin:my-plugin:',
          ttl: 3600,
        },
      };
      const result = HotReloadConfigSchema.parse(config);
      expect(result.stateStrategy).toBe('distributed');
      expect(result.distributedConfig?.provider).toBe('redis');
      expect(result.distributedConfig?.keyPrefix).toBe('plugin:my-plugin:');
    });
  });

  describe('DistributedStateConfigSchema', () => {
    it('should validate Redis configuration', () => {
      const config = {
        provider: 'redis' as const,
        endpoints: ['redis://localhost:6379', 'redis://localhost:6380'],
        keyPrefix: 'objectstack:',
        ttl: 7200,
        auth: {
          username: 'admin',
          password: 'secret',
        },
        replication: {
          enabled: true,
          minReplicas: 2,
        },
      };
      const result = DistributedStateConfigSchema.parse(config);
      expect(result.provider).toBe('redis');
      expect(result.endpoints).toHaveLength(2);
      expect(result.ttl).toBe(7200);
    });

    it('should validate Etcd configuration', () => {
      const config = {
        provider: 'etcd' as const,
        endpoints: ['http://localhost:2379'],
        auth: {
          certificate: '/path/to/cert.pem',
        },
      };
      const result = DistributedStateConfigSchema.parse(config);
      expect(result.provider).toBe('etcd');
    });

    it('should validate custom provider configuration', () => {
      const config = {
        provider: 'custom' as const,
        customConfig: {
          type: 'consul',
          address: 'consul.example.com:8500',
        },
      };
      const result = DistributedStateConfigSchema.parse(config);
      expect(result.provider).toBe('custom');
      expect(result.customConfig).toBeDefined();
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
