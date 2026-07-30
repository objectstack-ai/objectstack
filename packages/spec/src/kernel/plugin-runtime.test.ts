import { describe, it, expect } from 'vitest';
import {
  DynamicPluginOperationSchema,
  PluginSourceSchema,
  ActivationEventSchema,
  DynamicLoadRequestSchema,
  DynamicUnloadRequestSchema,
  DynamicPluginResultSchema,
} from './plugin-runtime.zod';

describe('Plugin Runtime Management Protocol', () => {
  describe('DynamicPluginOperationSchema', () => {
    it('should accept valid operations', () => {
      expect(DynamicPluginOperationSchema.parse('load')).toBe('load');
      expect(DynamicPluginOperationSchema.parse('unload')).toBe('unload');
      expect(DynamicPluginOperationSchema.parse('reload')).toBe('reload');
      expect(DynamicPluginOperationSchema.parse('enable')).toBe('enable');
      expect(DynamicPluginOperationSchema.parse('disable')).toBe('disable');
    });

    it('should reject invalid operations', () => {
      expect(() => DynamicPluginOperationSchema.parse('invalid')).toThrow();
    });
  });

  describe('PluginSourceSchema', () => {
    it('should accept npm source', () => {
      const source = {
        type: 'npm',
        location: '@objectstack/plugin-analytics',
        version: '^2.0.0',
      };
      const result = PluginSourceSchema.parse(source);
      expect(result.type).toBe('npm');
      expect(result.version).toBe('^2.0.0');
    });

    it('should accept local source', () => {
      const source = {
        type: 'local',
        location: '/opt/plugins/custom-plugin',
      };
      const result = PluginSourceSchema.parse(source);
      expect(result.type).toBe('local');
      expect(result.version).toBeUndefined();
    });

    it('should accept url source with integrity', () => {
      const source = {
        type: 'url',
        location: 'https://plugins.example.com/analytics-1.0.0.tgz',
        integrity: 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC',
      };
      const result = PluginSourceSchema.parse(source);
      expect(result.integrity).toBeDefined();
    });

    it('should accept all source types', () => {
      const types = ['npm', 'local', 'url', 'registry', 'git'];
      types.forEach((type) => {
        const result = PluginSourceSchema.parse({ type, location: 'test' });
        expect(result.type).toBe(type);
      });
    });
  });

  describe('ActivationEventSchema', () => {
    it('should accept command activation', () => {
      const event = {
        type: 'onCommand',
        pattern: 'analytics.generateReport',
      };
      const result = ActivationEventSchema.parse(event);
      expect(result.type).toBe('onCommand');
      expect(result.pattern).toBe('analytics.generateReport');
    });

    it('should accept route activation', () => {
      const event = {
        type: 'onRoute',
        pattern: '/api/v1/analytics/*',
      };
      const result = ActivationEventSchema.parse(event);
      expect(result.type).toBe('onRoute');
    });

    it('should accept all activation types', () => {
      const types = [
        'onCommand', 'onRoute', 'onObject',
        'onEvent', 'onService', 'onSchedule', 'onStartup',
      ];
      types.forEach((type) => {
        const result = ActivationEventSchema.parse({ type, pattern: '*' });
        expect(result.type).toBe(type);
      });
    });
  });

  describe('DynamicLoadRequestSchema', () => {
    it('should accept minimal load request', () => {
      const request = {
        pluginId: 'com.acme.analytics',
        source: {
          type: 'npm' as const,
          location: '@acme/analytics-plugin',
          version: '^1.0.0',
        },
      };
      const result = DynamicLoadRequestSchema.parse(request);
      expect(result.pluginId).toBe('com.acme.analytics');
      expect(result.priority).toBe(100); // default
      expect(result.sandbox).toBe(false); // default
      expect(result.timeout).toBe(60000); // default
    });

    it('should accept full load request with activation events', () => {
      const request = {
        pluginId: 'com.acme.analytics',
        source: {
          type: 'registry' as const,
          location: 'acme-analytics',
          version: '~2.1.0',
        },
        activationEvents: [
          { type: 'onRoute' as const, pattern: '/api/v1/analytics/*' },
          { type: 'onCommand' as const, pattern: 'analytics.*' },
        ],
        config: { apiKey: 'abc123', region: 'us-east' },
        priority: 50,
        sandbox: true,
        timeout: 120000,
      };
      const result = DynamicLoadRequestSchema.parse(request);
      expect(result.activationEvents).toHaveLength(2);
      expect(result.sandbox).toBe(true);
      expect(result.priority).toBe(50);
    });
  });

  describe('DynamicUnloadRequestSchema', () => {
    it('should accept minimal unload request', () => {
      const request = {
        pluginId: 'com.acme.analytics',
      };
      const result = DynamicUnloadRequestSchema.parse(request);
      expect(result.strategy).toBe('graceful'); // default
      expect(result.timeout).toBe(30000); // default
      expect(result.cleanupCache).toBe(false); // default
      expect(result.dependentAction).toBe('block'); // default
    });

    it('should accept full unload request', () => {
      const request = {
        pluginId: 'com.acme.analytics',
        strategy: 'drain' as const,
        timeout: 60000,
        cleanupCache: true,
        dependentAction: 'cascade' as const,
      };
      const result = DynamicUnloadRequestSchema.parse(request);
      expect(result.strategy).toBe('drain');
      expect(result.cleanupCache).toBe(true);
      expect(result.dependentAction).toBe('cascade');
    });

    it('should accept all unload strategies', () => {
      const strategies = ['graceful', 'forceful', 'drain'];
      strategies.forEach((strategy) => {
        const result = DynamicUnloadRequestSchema.parse({
          pluginId: 'test',
          strategy,
        });
        expect(result.strategy).toBe(strategy);
      });
    });
  });

  describe('DynamicPluginResultSchema', () => {
    it('should accept successful result', () => {
      const result = DynamicPluginResultSchema.parse({
        success: true,
        operation: 'load',
        pluginId: 'com.acme.analytics',
        durationMs: 1500,
        version: '1.2.3',
      });
      expect(result.success).toBe(true);
      expect(result.version).toBe('1.2.3');
    });

    it('should accept failed result with error', () => {
      const result = DynamicPluginResultSchema.parse({
        success: false,
        operation: 'load',
        pluginId: 'com.acme.analytics',
        error: {
          code: 'DEPENDENCY_MISSING',
          message: 'Required dependency "postgres" is not loaded',
          details: { missing: ['postgres'] },
        },
        warnings: ['Plugin was partially loaded before failure'],
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DEPENDENCY_MISSING');
      expect(result.warnings).toHaveLength(1);
    });
  });

});
