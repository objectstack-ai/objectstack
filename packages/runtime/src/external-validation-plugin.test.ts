// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExternalValidationPlugin } from './external-validation-plugin';
import { ExternalSchemaMismatchError, type SchemaDiffEntry } from '@objectstack/spec/shared';

function makeCtx(services: Record<string, unknown>) {
  const warnings: any[] = [];
  const infos: any[] = [];
  const ctx = {
    getService: <T>(name: string): T => {
      if (name in services) return services[name] as T;
      throw new Error(`service '${name}' not registered`);
    },
    registerService: vi.fn(),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: (...a: any[]) => infos.push(a),
      warn: (...a: any[]) => warnings.push(a),
    },
  } as any;
  return { ctx, warnings, infos };
}

const sampleDiffs: SchemaDiffEntry[] = [
  { kind: 'type_mismatch', remoteName: 'fact_orders', column: 'amount', expected: 'number', actual: 'text', severity: 'error' },
];

describe('ExternalValidationPlugin (ADR-0015 Gate 2)', () => {
  it('subscribes to kernel:ready in start()', () => {
    const { ctx } = makeCtx({});
    new ExternalValidationPlugin().start(ctx);
    expect(ctx.hook).toHaveBeenCalledWith('kernel:ready', expect.any(Function));
  });

  it('is a no-op when the external-datasource service is absent', async () => {
    const { ctx } = makeCtx({});
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
  });

  it('passes silently when all federated objects validate', async () => {
    const { ctx, infos } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: true, results: [{ ok: true, datasource: 'warehouse', object: 'wh_order', diffs: [] }] }) },
    });
    await new ExternalValidationPlugin().runValidation(ctx);
    expect(infos.length).toBeGreaterThan(0);
  });

  it('throws ExternalSchemaMismatchError on failure with default (fail) policy', async () => {
    const { ctx } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: false, results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs }] }) },
      metadata: { get: async () => ({ schemaMode: 'external', external: { validation: { onMismatch: 'fail' } } }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(ExternalSchemaMismatchError);
  });

  it('warns instead of throwing when onMismatch=warn', async () => {
    const { ctx, warnings } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: false, results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs }] }) },
      metadata: { get: async () => ({ schemaMode: 'validate-only', external: { validation: { onMismatch: 'warn' } } }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    expect(warnings.some((w) => String(w[0]).includes('drift'))).toBe(true);
  });

  it('does nothing when onMismatch=ignore', async () => {
    const { ctx, warnings } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: false, results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs }] }) },
      metadata: { get: async () => ({ schemaMode: 'external', external: { validation: { onMismatch: 'ignore' } } }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    expect(warnings.length).toBe(0);
  });

  it('defaults to fail when the datasource definition is unavailable', async () => {
    const { ctx } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: false, results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs }] }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(ExternalSchemaMismatchError);
  });
});

describe('ExternalValidationPlugin — background drift detection (ADR-0015 §5.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * [#10961] The fake answers the SCOPED spelling, because that is what the
   * checker now calls: a timer armed for one datasource asks the service about
   * that datasource, instead of sweeping the farm and filtering the report.
   * The rows below live behind that scoping so the fixture cannot hand back a
   * foreign datasource's row by accident — the cross-datasource claim is
   * carried here by the ARGUMENT, and against the real service by
   * `external-validation-drift-scope.test.ts`.
   */
  const scopedService = (rows: Array<{ ok: boolean; datasource: string; object: string; diffs: SchemaDiffEntry[] }>) => ({
    validateAll: async () => ({ ok: rows.every((r) => r.ok), results: rows }),
    validateDatasource: async (datasource: string) => {
      const scoped = rows.filter((r) => r.datasource === datasource);
      return { ok: scoped.every((r) => r.ok), results: scoped };
    },
  });

  it('runDriftCheck emits one external.schema.drift event per drifted object', async () => {
    const { ctx } = makeCtx({
      'external-datasource': scopedService([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs },
        { ok: true, datasource: 'warehouse', object: 'wh_ok', diffs: [] },
        // A failure on a *different* datasource must not bleed into warehouse's
        // check — and must not be introspected for it either (drift-scope test).
        { ok: false, datasource: 'other', object: 'x', diffs: sampleDiffs },
      ]),
    });
    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'warehouse');
    expect(emitted).toBe(1);
    expect(ctx.trigger).toHaveBeenCalledTimes(1);
    expect(ctx.trigger).toHaveBeenCalledWith('external.schema.drift', {
      datasource: 'warehouse',
      object: 'wh_order',
      diffs: sampleDiffs,
    });
  });

  it('runDriftCheck is a no-op (no throw) when the scoped validation rejects', async () => {
    const { ctx, warnings } = makeCtx({
      'external-datasource': {
        validateAll: async () => ({ ok: true, results: [] }),
        validateDatasource: async () => { throw new Error('remote unreachable'); },
      },
    });
    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'warehouse');
    expect(emitted).toBe(0);
    expect(ctx.trigger).not.toHaveBeenCalled();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('schedules a timer only for datasources declaring checkIntervalMs', async () => {
    const { ctx } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: true, results: [] }) },
      metadata: {
        list: async () => [
          { name: 'warehouse', external: { validation: { checkIntervalMs: 60_000 } } },
          { name: 'replica', external: { validation: {} } }, // no interval → skipped
          { name: 'local' }, // not federated → skipped
        ],
      },
    });
    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    expect(vi.getTimerCount()).toBe(1);
    plugin.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the armed timer fires runDriftCheck on its interval and emits drift', async () => {
    const { ctx } = makeCtx({
      'external-datasource': scopedService([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs },
      ]),
      metadata: {
        list: async () => [{ name: 'warehouse', external: { validation: { checkIntervalMs: 1000 } } }],
      },
    });
    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    expect(ctx.trigger).not.toHaveBeenCalled();
    // Advance past one interval and flush the fire-and-forget async work.
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.trigger).toHaveBeenCalledWith('external.schema.drift', expect.objectContaining({
      datasource: 'warehouse',
      object: 'wh_order',
    }));
    plugin.stop();
  });

  it('re-arming clears prior timers so intervals do not accumulate', async () => {
    const { ctx } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: true, results: [] }) },
      metadata: {
        list: async () => [{ name: 'warehouse', external: { validation: { checkIntervalMs: 1000 } } }],
      },
    });
    const plugin = new ExternalValidationPlugin();
    await plugin.scheduleDriftChecks(ctx);
    await plugin.scheduleDriftChecks(ctx);
    expect(vi.getTimerCount()).toBe(1);
    plugin.stop();
  });

  it('is a no-op when metadata cannot enumerate datasources', async () => {
    const { ctx } = makeCtx({
      'external-datasource': { validateAll: async () => ({ ok: true, results: [] }) },
    });
    await expect(new ExternalValidationPlugin().scheduleDriftChecks(ctx)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
