import { describe, it, expect } from 'vitest';
import { PluginStartupResultSchema } from './startup-orchestrator.zod';

// [#16059] The orchestration vocabulary this file used to cover
// (`StartupOptionsSchema`, `HealthStatusSchema`,
// `StartupOrchestrationResultSchema`) is retired — see
// `startup-orchestrator-retirement.test.ts` for the absence pins and the zod
// module's retirement block for the record. What is left is the one shape the
// kernel really produces, so the cases below are written against
// `ObjectKernel.startPluginWithTimeout()`'s three real return paths.
describe('PluginStartupResultSchema — the shape the kernel produces', () => {
  it('accepts the no-start() path: success with no elapsed time', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'crm-plugin',
      success: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the success path: durationMs plus the deprecated startTime alias', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'crm-plugin',
      success: true,
      durationMs: 1250,
      startTime: 1250,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationMs).toBe(1250);
      // The kernel populates both with the SAME elapsed value under its
      // ADR-0087 L1 disposition; the contract mirrors that rather than
      // declaring `never` for a member the kernel emits.
      expect(result.data.startTime).toBe(result.data.durationMs);
    }
  });

  it('accepts the failure path: the serializable error projection', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'failing-plugin',
      success: false,
      durationMs: 500,
      error: { name: 'Error', message: 'Connection failed' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts the TIMEOUT failure path, where timedOut is set', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'slow-plugin',
      success: false,
      durationMs: 30000,
      error: { name: 'Error', message: 'Plugin slow-plugin start timeout after 30000ms' },
      timedOut: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.timedOut).toBe(true);
  });

  it('requires pluginName — the result carries the NAME, never a plugin object', () => {
    const result = PluginStartupResultSchema.safeParse({ success: true });
    expect(result.success).toBe(false);
  });

  it('rejects a negative duration', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'test',
      success: true,
      durationMs: -100,
    });
    expect(result.success).toBe(false);
  });
});

// #15678 (stack card 3/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. The old spelling is a `retiredKey()` tombstone,
// so the refusal carries the RENAME (the prescription IS the payload) rather
// than a bare unrecognized-key error. The two sibling tombstones this file used
// to cover (`StartupOptions.timeout`, `StartupOrchestrationResult.totalDuration`)
// left with their defs on #16059 — a whole-def removal is strictly stronger
// than "this one key is gone", and the retired-key registrations that dated
// them stay in RETIRED_KEYS_BY_MAJOR[18] as the record of the narrower step.
describe('Startup result durations carry their unit (#15678)', () => {
  it('REFUSES the retired `duration` with the rename in the message', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'crm-plugin',
      success: true,
      duration: 1250,
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'duration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`PluginStartupResult.duration` was renamed to `durationMs`');
  });
});

// [#16059] The two members that left the SURVIVING def. Both are tombstones,
// not deletions, because this def keeps emitting and `@objectstack/core`
// imports its type: a construction site still writing them meets the
// prescription at the parse as well as at `tsc`.
describe('[#16059] the re-declared result refuses the members it dropped', () => {
  it('REFUSES `plugin` and prescribes `pluginName`', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'crm-plugin',
      success: true,
      plugin: { name: 'crm-plugin', version: '1.0.0' },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'plugin');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('Replace the key with `pluginName`');
  });

  it('REFUSES `health` and says no startup probe system exists', () => {
    const result = PluginStartupResultSchema.safeParse({
      pluginName: 'crm-plugin',
      success: true,
      health: { healthy: true, checkedAt: Date.now() },
    });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'health');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toMatch(/health.*removed.*Delete the key/s);
  });
});
