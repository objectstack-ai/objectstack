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
      // [#17780] Renamed: these two lines pinned `interval` / `timeout`, whose
      // unit lived in a source JSDoc only. Same values, same defaults; the
      // names now carry the milliseconds. The old spellings are tombstoned and
      // their refusal is pinned at the bottom of this file.
      expect(healthCheck.intervalMs).toBe(30000);
      expect(healthCheck.timeoutMs).toBe(5000);
      expect(healthCheck).not.toHaveProperty('interval');
      expect(healthCheck).not.toHaveProperty('timeout');
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
        // [#17780] `interval` / `timeout` renamed to carry their unit.
        intervalMs: 60000,
        timeoutMs: 10000,
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

    // [#17780] These two pinned the MIN BOUND through the bare spellings. Left
    // as they were they would have stayed green off the tombstone's refusal
    // instead of the bound — a pin that can no longer fail. They pin the
    // suffixed keys now, and the bound is asserted by issue code so a
    // tombstone refusal could not stand in for it.
    it('should enforce minimum intervalMs', () => {
      const result = PluginHealthCheckSchema.safeParse({ intervalMs: 500 });
      expect(result.success).toBe(false);
      expect(result.error!.issues.some((i) => i.code === 'too_small')).toBe(true);
      expect(PluginHealthCheckSchema.parse({ intervalMs: 1000 }).intervalMs).toBe(1000);
    });

    it('should enforce minimum timeoutMs', () => {
      const result = PluginHealthCheckSchema.safeParse({ timeoutMs: 50 });
      expect(result.success).toBe(false);
      expect(result.error!.issues.some((i) => i.code === 'too_small')).toBe(true);
      expect(PluginHealthCheckSchema.parse({ timeoutMs: 100 }).timeoutMs).toBe(100);
    });
  });

  describe('PluginHealthReportSchema', () => {
    it('should validate complete health report', () => {
      const report = {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        message: 'Plugin is operating normally',
        metrics: {
          uptimeMs: 3600000,
          memoryUsage: 52428800,
          cpuUsage: 15.5,
          activeConnections: 10,
          errorRate: 0.1,
          responseTimeMs: 150,
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
      expect(result.metrics?.uptimeMs).toBe(3600000);
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
      // [#17780] Renamed: this pinned `debounceDelay`, whose unit lived in a
      // source JSDoc only. Same value, same default, unit now in the name.
      expect(config.debounceDelayMs).toBe(1000);
      expect(config).not.toHaveProperty('debounceDelay');
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
        // [#17780] `debounceDelay` renamed to carry its unit.
        debounceDelayMs: 2000,
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

// #15678 (stack card 3/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. Both old spellings are `retiredKey()`
// tombstones inside the live `metrics` block, so the refusal carries the RENAME
// and the block's other members must keep parsing beside it.
describe('PluginHealthReport metrics durations carry their unit (#15678)', () => {
  const base = { status: 'healthy' as const, timestamp: new Date().toISOString() };

  it.each([
    ['uptime', 'uptimeMs', 3600000],
    ['responseTime', 'responseTimeMs', 150],
  ])('REFUSES the retired `metrics.%s` with the rename to `%s` in the message', (old, next, value) => {
    const result = PluginHealthReportSchema.safeParse({ ...base, metrics: { [old]: value } });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === `metrics.${old}`);
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      `\`PluginHealthReport.metrics.${old}\` was renamed to \`${next}\``,
    );
  });

  it('accepts the suffixed metrics beside their unchanged non-duration siblings', () => {
    const parsed = PluginHealthReportSchema.parse({
      ...base,
      metrics: {
        uptimeMs: 3600000,
        responseTimeMs: 150,
        // Not durations, so this rule does not reach them and they keep their
        // bare names: bytes, a percentage, a count and a rate.
        memoryUsage: 52428800,
        cpuUsage: 15.5,
        activeConnections: 10,
        errorRate: 0.1,
      },
    });
    expect(parsed.metrics?.uptimeMs).toBe(3600000);
    expect(parsed.metrics?.responseTimeMs).toBe(150);
    expect(parsed.metrics?.memoryUsage).toBe(52428800);
    expect(parsed.metrics?.activeConnections).toBe(10);
  });
});

// #17780 (ruling A on #15939, executing #14478) — the three remaining
// duration-shaped keys on this file whose unit lived in a source JSDoc only.
// `.describe()` is what `content/docs/references/**` publishes and the JSDoc
// above a key is NOT, so the reader who most needs the unit was the only one
// who never saw it. `interval`'s describe was the sharpest case: its one
// unit-shaped token was a "(default: 30s)" parenthetical naming SECONDS for a
// value carried in milliseconds. All three old spellings are `retiredKey()`
// tombstones — neither object is `.strict()`, so a bare deletion would be a
// silent strip.
describe('plugin lifecycle durations carry their unit (#17780, #14478)', () => {
  it.each([
    ['interval', 'intervalMs', 60000],
    ['timeout', 'timeoutMs', 10000],
  ])('REFUSES the retired `PluginHealthCheck.%s` with the rename to `%s`', (old, next, value) => {
    const result = PluginHealthCheckSchema.safeParse({ [old]: value });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === old);
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(`\`PluginHealthCheck.${old}\` was renamed to \`${next}\``);
  });

  it('REFUSES the retired `HotReloadConfig.debounceDelay` with the rename', () => {
    const result = HotReloadConfigSchema.safeParse({ debounceDelay: 2000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'debounceDelay');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`HotReloadConfig.debounceDelay` was renamed to `debounceDelayMs`',
    );
  });

  it('accepts the suffixed keys at the magnitude the retired ones carried', () => {
    const health = PluginHealthCheckSchema.parse({ intervalMs: 60000, timeoutMs: 10000 });
    expect(health.intervalMs).toBe(60000);
    expect(health.timeoutMs).toBe(10000);
    const reload = HotReloadConfigSchema.parse({ debounceDelayMs: 2000 });
    expect(reload.debounceDelayMs).toBe(2000);
    // Unchanged defaults, read off an empty parse.
    expect(PluginHealthCheckSchema.parse({}).intervalMs).toBe(30000);
    expect(PluginHealthCheckSchema.parse({}).timeoutMs).toBe(5000);
    expect(HotReloadConfigSchema.parse({}).debounceDelayMs).toBe(1000);
  });

  it('publishes the unit in the describe — the text the reference pages render', () => {
    const health = PluginHealthCheckSchema.shape;
    expect(health.intervalMs.description).toBe(
      'How often to perform health checks, in milliseconds',
    );
    expect(health.timeoutMs.description).toBe(
      'Maximum time to wait for health check response, in milliseconds',
    );
    expect(HotReloadConfigSchema.shape.debounceDelayMs.description).toBe(
      'Wait time after change detection before reload, in milliseconds',
    );
  });
});
// #18124 — step 3 of ruling A on #18115. `HotReloadConfig.shutdownTimeout` takes
// the TYPE route rather than the rename route, and that is the disposition this
// def already recorded: the #15676 wave that renamed its siblings to `intervalMs`
// / `timeoutMs` / `debounceDelayMs` wrote down that this key was "deliberately NOT
// renamed with them". Measured unit: `packages/core/src/hot-reload.ts` is the only
// in-repo reader and treats it as a millisecond budget (its own test suite drives
// 120_000, 1000 and 50 through it).
//
// `DurationMs` is `z.number().int().nonnegative()` and this key declared
// `z.number().int().min(0)`, so the accepted set is UNCHANGED — the pins below
// are about what the declaration now refuses loudly at the authoring site.
describe('HotReloadConfig.shutdownTimeout declares milliseconds (#18124)', () => {
  it('refuses a fractional millisecond count', () => {
    const result = HotReloadConfigSchema.safeParse({ shutdownTimeout: 30000.5 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'shutdownTimeout');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
  });

  it('refuses a negative span', () => {
    const result = HotReloadConfigSchema.safeParse({ shutdownTimeout: -1 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'shutdownTimeout');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('too_small');
  });

  it('keeps the accepted set it already had — the 30000 default and the zero floor', () => {
    expect(HotReloadConfigSchema.parse({}).shutdownTimeout).toBe(30000);
    expect(HotReloadConfigSchema.parse({ shutdownTimeout: 0 }).shutdownTimeout).toBe(0);
  });
});
