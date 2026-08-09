import { describe, it, expect } from 'vitest';
import {
  PluginLoadingEventSchema,
  PluginLoadingStateSchema,
} from './plugin-loading.zod';

// The PluginLoadingConfig block's tests (PluginLoadingStrategySchema,
// PluginPreloadConfigSchema, PluginCodeSplittingSchema,
// PluginDynamicImportSchema, PluginInitializationSchema,
// PluginDependencyResolutionSchema, PluginHotReloadSchema,
// PluginCachingSchema, PluginSandboxingSchema,
// PluginPerformanceMonitoringSchema, PluginLoadingConfigSchema) and the
// "Integration scenarios" that composed them were removed with those schemas in
// #4914 (ADR-0049 enforce-or-remove). The retirement itself is pinned in
// `plugin-loading-retirement.test.ts`. What remains here is the module's
// surviving observational half.
describe('Plugin Loading Protocol', () => {
  describe('PluginLoadingEventSchema', () => {
    it('should accept loading events', () => {
      const event = {
        type: 'load-completed',
        pluginId: 'com.example.plugin',
        timestamp: Date.now(),
        durationMs: 150,
        metadata: {
          version: '1.0.0',
          size: 1024,
        },
      };
      const result = PluginLoadingEventSchema.parse(event);
      expect(result.type).toBe('load-completed');
      expect(result.durationMs).toBe(150);
    });

    it('should accept error events', () => {
      const event = {
        type: 'load-failed',
        pluginId: 'com.example.plugin',
        timestamp: Date.now(),
        error: {
          message: 'Failed to load plugin',
          code: 'LOAD_ERROR',
          stack: 'Error stack trace',
        },
      };
      const result = PluginLoadingEventSchema.parse(event);
      expect(result.type).toBe('load-failed');
      expect(result.error?.message).toBe('Failed to load plugin');
    });

    it('should accept all event types', () => {
      const types = [
        'load-started',
        'load-completed',
        'load-failed',
        'init-started',
        'init-completed',
        'init-failed',
        'preload-started',
        'preload-completed',
        'cache-hit',
        'cache-miss',
        'hot-reload',
        'dynamic-load',
        'dynamic-unload',
        'dynamic-discover',
      ];

      types.forEach((type) => {
        const event = {
          type,
          pluginId: 'com.example.plugin',
          timestamp: Date.now(),
        };
        const result = PluginLoadingEventSchema.parse(event);
        expect(result.type).toBe(type);
      });
    });
  });

  describe('PluginLoadingStateSchema', () => {
    it('should accept loading state', () => {
      const state = {
        pluginId: 'com.example.plugin',
        state: 'loading',
        progress: 45,
        startedAt: Date.now(),
        retryCount: 1,
      };
      const result = PluginLoadingStateSchema.parse(state);
      expect(result.state).toBe('loading');
      expect(result.progress).toBe(45);
    });

    it('should accept all state values', () => {
      const states = [
        'pending',
        'loading',
        'loaded',
        'initializing',
        'ready',
        'failed',
        'reloading',
        'unloading',
        'unloaded',
      ];

      states.forEach((stateValue) => {
        const state = {
          pluginId: 'com.example.plugin',
          state: stateValue,
        };
        const result = PluginLoadingStateSchema.parse(state);
        expect(result.state).toBe(stateValue);
      });
    });

    it('should apply defaults', () => {
      const state = {
        pluginId: 'com.example.plugin',
        state: 'pending',
      };
      const result = PluginLoadingStateSchema.parse(state);
      expect(result.progress).toBe(0);
      expect(result.retryCount).toBe(0);
    });

    it('should validate progress range', () => {
      expect(() =>
        PluginLoadingStateSchema.parse({
          pluginId: 'com.example.plugin',
          state: 'loading',
          progress: 150,
        })
      ).toThrow();

      expect(() =>
        PluginLoadingStateSchema.parse({
          pluginId: 'com.example.plugin',
          state: 'loading',
          progress: -10,
        })
      ).toThrow();
    });
  });
});
