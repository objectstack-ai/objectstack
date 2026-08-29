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
      // [#12032] The three restart defaults ASSERTED HERE ARE GONE — declared,
      // not a quiet edit. `autoRestart` (false), `maxRestartAttempts` (3) and
      // `restartBackoff` ('exponential') were pinned on this line and the
      // assertions passed precisely BECAUSE the keys parsed and the thing they
      // named never happened. They are tombstoned; their refusal is pinned
      // below.
      expect(healthCheck).not.toHaveProperty('autoRestart');
      expect(healthCheck).not.toHaveProperty('maxRestartAttempts');
      expect(healthCheck).not.toHaveProperty('restartBackoff');
    });

    it('should validate custom health check configuration', () => {
      // [#12032] `autoRestart: true`, `maxRestartAttempts: 5` and
      // `restartBackoff: 'linear'` REMOVED from this fixture — declared, not a
      // quiet edit. Their presence here was the strongest single pin of the
      // false contract: the fixture asserted, via `toEqual`, that a config
      // asking for automatic restart survives the parse intact — which was
      // true right up to the moment it stopped meaning anything at runtime,
      // and it never meant anything at runtime.
      const config = {
        interval: 60000,
        timeout: 10000,
        failureThreshold: 5,
        successThreshold: 2,
        checkMethod: 'healthCheck',
      };
      const healthCheck = PluginHealthCheckSchema.parse(config);
      expect(healthCheck).toEqual(config);
    });

    // ── [#12032] The three restart keys are REFUSED, with the prescription ───
    //
    // Tombstones, not deletions: `PluginHealthCheckSchema` is not `.strict()`,
    // so a bare deletion would be a SILENT STRIP (#3733, ADR-0104) — a clean
    // parse and a setting that never takes effect, which is a milder form of
    // the defect being retired.
    const RETIRED_RESTART_KEYS = {
      autoRestart: true,
      maxRestartAttempts: 5,
      restartBackoff: 'linear',
    } as const;

    for (const [key, value] of Object.entries(RETIRED_RESTART_KEYS)) {
      it(`refuses ${key} with the retirement prescription (#12032)`, () => {
        const result = PluginHealthCheckSchema.safeParse(
          { [key]: value } as Record<string, unknown>
        );
        expect(result.success, `${key} must no longer parse`).toBe(false);

        // The message IS the contract — it is the whole migration document for
        // whoever hits it. Assert the load-bearing clauses, not the bytes.
        const message = result.success ? '' : result.error.issues[0]?.message ?? '';
        expect(message).toContain('was removed');
        expect(message).toContain('ADR-0049');
        expect(message, 'the ADR is the durable reference; the tracker id is not')
          .not.toMatch(/#\d{3,5}/);
        expect(message).toContain('Delete the key');
        // The measured fact, in every one of the three prescriptions: the
        // restart was only ever a destroy.
        expect(message).toContain('plugin.destroy()');
        expect(message).toContain('healthy');
        // And the affordance that DOES exist, named in place of the one that
        // never did.
        expect(message).toContain('getHealthStatus');
      });
    }

    it('leaves an unrelated unknown key alone (anti-vacuity)', () => {
      // The control. `PluginHealthCheckSchema` is not `.strict()`, so an
      // unknown key is stripped rather than refused — which is exactly why the
      // three above needed tombstones. Without this, the refusals could be
      // passing because the schema had become strict, a different change.
      const result = PluginHealthCheckSchema.safeParse(
        { somethingElse: true } as Record<string, unknown>
      );
      expect(result.success).toBe(true);
      expect(result.success && result.data).not.toHaveProperty('somethingElse');
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
        // [#12428] `watchPatterns` REMOVED from this fixture — declared, not a
        // quiet edit. It used to be listed here and asserted via toEqual below,
        // an assertion that passed precisely BECAUSE the key parsed and did
        // nothing. The key's departure is pinned as a STRIP in its own test.
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
        expect(message).toContain('ADR-0049');
        // The customer-resolvable anchors stay; the tracker id does not reach
        // this audience at all. Negative pin, so a re-introduced id reds here
        // rather than only at `check:doc-authoring`.
        expect(message).not.toMatch(/#\d{3,5}\b/);
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

    it('refuses watchPatterns with the retirement prescription (#12428)', () => {
      // Unlike the distributedConfig pin above, this one asserts a REFUSAL, not
      // a strip: `watchPatterns` is `retiredKey()`-tombstoned. A bare deletion
      // was tried first and `gen:schema` gate (a) refused it — this object is
      // not `.strict()`, so deleting the key would be a silent strip (#3733,
      // ADR-0104), which is the very defect being retired.
      const result = HotReloadConfigSchema.safeParse({
        enabled: true,
        watchPatterns: ['src/**/*.ts'],
      } as Record<string, unknown>);
      expect(result.success, 'watchPatterns must no longer parse').toBe(false);

      // The message IS the contract — it is the whole migration document for
      // whoever hits it. Assert the load-bearing clauses, not the byte string.
      const message = result.success ? '' : result.error.issues[0]?.message ?? '';
      expect(message).toContain('was removed');
      expect(message).toContain('nothing ever read it');
      expect(message).toContain('ADR-0049');
      expect(message).toContain('scheduleReload');

      // Anti-vacuity: the surrounding keep still parses, so the refusal above
      // is about this key and not about the schema having broken.
      expect(HotReloadConfigSchema.safeParse({ enabled: true }).success).toBe(true);
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
