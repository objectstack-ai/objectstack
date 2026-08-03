import { describe, it, expect } from 'vitest';
import {
  DynamicPluginOperationSchema,
  PluginSourceSchema,
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

  // `ActivationEventSchema` was REMOVED (#4657, ADR-0049) — no runtime ever
  // read an activation event, so the vocabulary retired with the keys that
  // embedded it. Export-surface pins live in
  // activation-events-retirement.test.ts; the tombstone pins are below.

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

    it('should accept full load request', () => {
      const request = {
        pluginId: 'com.acme.analytics',
        source: {
          type: 'registry' as const,
          location: 'acme-analytics',
          version: '~2.1.0',
        },
        config: { apiKey: 'abc123', region: 'us-east' },
        priority: 50,
        sandbox: true,
        timeout: 120000,
      };
      const result = DynamicLoadRequestSchema.parse(request);
      expect(result.sandbox).toBe(true);
      expect(result.priority).toBe(50);
    });

    // ─── [#4657] `activationEvents` tombstone pins (ADR-0049) ────────────
    // The key promised lazy activation no runtime ever implemented — every
    // plugin activates immediately on load. The schema is not `.strict()`,
    // so the removal is a `retiredKey()` tombstone: a plain delete would have
    // Zod silently STRIP an authored value (#2169 shape) instead of teaching.
    it('rejects an authored activationEvents with the retirement prescription', () => {
      expect(() =>
        DynamicLoadRequestSchema.parse({
          pluginId: 'com.acme.analytics',
          source: { type: 'npm' as const, location: '@acme/analytics-plugin' },
          activationEvents: [{ type: 'onRoute', pattern: '/api/v1/analytics/*' }],
        }),
      ).toThrow(/activationEvents.*removed.*17\.0\.0.*#4657.*Delete the key/s);
    });

    it('parses clean without the key — and the result does not carry it', () => {
      const result = DynamicLoadRequestSchema.parse({
        pluginId: 'com.acme.analytics',
        source: { type: 'npm' as const, location: '@acme/analytics-plugin' },
      });
      // Absence stays absence: the tombstone must not materialize a value.
      expect(result).not.toHaveProperty('activationEvents');
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
