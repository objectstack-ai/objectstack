import { describe, it, expect } from 'vitest';
import {
  StartupOptionsSchema,
  HealthStatusSchema,
  PluginStartupResultSchema,
  StartupOrchestrationResultSchema,
} from './startup-orchestrator.zod';

describe('Startup Orchestrator Protocol', () => {
  describe('StartupOptionsSchema', () => {
    it('should apply default values', () => {
      const options = {};

      const result = StartupOptionsSchema.parse(options);
      expect(result.timeoutMs).toBe(30000);
      expect(result.rollbackOnFailure).toBe(true);
      expect(result.healthCheck).toBe(false);
      expect(result.parallel).toBe(false);
    });

    it('should validate custom options', () => {
      const options = {
        timeoutMs: 60000,
        rollbackOnFailure: false,
        healthCheck: true,
        parallel: true,
        context: { custom: 'data' },
      };

      const result = StartupOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeoutMs).toBe(60000);
        expect(result.data.context).toEqual({ custom: 'data' });
      }
    });

    it('should reject negative timeout', () => {
      const options = {
        timeoutMs: -1000,
      };

      const result = StartupOptionsSchema.safeParse(options);
      expect(result.success).toBe(false);
    });
  });

  describe('HealthStatusSchema', () => {
    it('should validate healthy status', () => {
      const healthyStatus = {
        healthy: true,
        checkedAt: Date.now(),
        details: {
          databaseConnected: true,
          memoryUsage: 45.2,
        },
      };

      const result = HealthStatusSchema.safeParse(healthyStatus);
      expect(result.success).toBe(true);
    });

    it('should validate unhealthy status with message', () => {
      const unhealthyStatus = {
        healthy: false,
        checkedAt: Date.now(),
        message: 'Database connection failed',
      };

      const result = HealthStatusSchema.safeParse(unhealthyStatus);
      expect(result.success).toBe(true);
    });
  });

  describe('PluginStartupResultSchema', () => {
    it('should validate successful startup result', () => {
      const successResult = {
        plugin: {
          name: 'crm-plugin',
          version: '1.0.0',
        },
        success: true,
        durationMs: 1250,
      };

      const result = PluginStartupResultSchema.safeParse(successResult);
      expect(result.success).toBe(true);
    });

    it('should validate failed startup result with error', () => {
      const failedResult = {
        plugin: {
          name: 'failing-plugin',
          version: '1.0.0',
        },
        success: false,
        durationMs: 500,
        error: { name: 'Error', message: 'Connection failed' },
      };

      const result = PluginStartupResultSchema.safeParse(failedResult);
      expect(result.success).toBe(true);
    });

    it('should validate result with health status', () => {
      const resultWithHealth = {
        plugin: {
          name: 'crm-plugin',
        },
        success: true,
        durationMs: 1250,
        health: {
          healthy: true,
          checkedAt: Date.now(),
        },
      };

      const result = PluginStartupResultSchema.safeParse(resultWithHealth);
      expect(result.success).toBe(true);
    });

    it('should reject negative duration', () => {
      const invalidResult = {
        plugin: { name: 'test' },
        success: true,
        durationMs: -100,
      };

      const result = PluginStartupResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });
  });

  describe('StartupOrchestrationResultSchema', () => {
    it('should validate complete orchestration result', () => {
      const orchestrationResult = {
        results: [
          {
            plugin: { name: 'plugin1', version: '1.0.0' },
            success: true,
            durationMs: 1200,
          },
          {
            plugin: { name: 'plugin2', version: '2.0.0' },
            success: true,
            durationMs: 850,
          },
        ],
        totalDurationMs: 2050,
        allSuccessful: true,
      };

      const result = StartupOrchestrationResultSchema.safeParse(orchestrationResult);
      expect(result.success).toBe(true);
    });

    it('should validate orchestration with rollback', () => {
      const orchestrationWithRollback = {
        results: [
          {
            plugin: { name: 'plugin1' },
            success: true,
            durationMs: 1200,
          },
          {
            plugin: { name: 'plugin2' },
            success: false,
            durationMs: 850,
            error: { name: 'Error', message: 'Startup failed' },
          },
        ],
        totalDurationMs: 2050,
        allSuccessful: false,
        rolledBack: ['plugin1'],
      };

      const result = StartupOrchestrationResultSchema.safeParse(orchestrationWithRollback);
      expect(result.success).toBe(true);
    });
  });
});

// #15678 (stack card 3/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. All three old spellings are `retiredKey()`
// tombstones, so the refusal carries the RENAME (the prescription IS the
// payload) rather than a bare unrecognized-key error. This contract already
// contained its own counter-example: `startWithTimeout(plugin, ctx, timeoutMs)`
// named its parameter correctly while the options object beside it did not.
describe('Startup orchestration durations carry their unit (#15678)', () => {
  it('StartupOptions REFUSES the retired `timeout` with the rename in the message', () => {
    const result = StartupOptionsSchema.safeParse({ timeout: 60000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`StartupOptions.timeout` was renamed to `timeoutMs`');
  });

  it('PluginStartupResult REFUSES the retired `duration` with the rename in the message', () => {
    const result = PluginStartupResultSchema.safeParse({
      plugin: { name: 'crm-plugin' },
      success: true,
      duration: 1250,
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'duration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`PluginStartupResult.duration` was renamed to `durationMs`');
  });

  it('StartupOrchestrationResult REFUSES the retired `totalDuration` with the rename', () => {
    const result = StartupOrchestrationResultSchema.safeParse({
      results: [],
      totalDuration: 2050,
      allSuccessful: true,
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'totalDuration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`StartupOrchestrationResult.totalDuration` was renamed to `totalDurationMs`',
    );
  });

  it('the aggregate and its parts now agree: totalDurationMs sums durationMs', () => {
    const parsed = StartupOrchestrationResultSchema.parse({
      results: [
        { plugin: { name: 'plugin1' }, success: true, durationMs: 1200 },
        { plugin: { name: 'plugin2' }, success: true, durationMs: 850 },
      ],
      totalDurationMs: 2050,
      allSuccessful: true,
    });
    expect(parsed.totalDurationMs).toBe(2050);
    expect(parsed.results.reduce((sum, r) => sum + r.durationMs, 0)).toBe(2050);
  });

  it('keeps the 30000 default under the renamed key', () => {
    expect(StartupOptionsSchema.parse({}).timeoutMs).toBe(30000);
    expect(StartupOptionsSchema.parse({ timeoutMs: 5000 }).timeoutMs).toBe(5000);
  });
});
