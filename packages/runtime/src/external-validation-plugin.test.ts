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

/** [#11166] The row `validateEach` produces when the remote could not be read. */
const unreachableDiffs: SchemaDiffEntry[] = [
  { kind: 'unreachable', remoteName: 'fact_orders', actual: 'connect ECONNREFUSED 10.0.0.5:5432', severity: 'error' },
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

  /**
   * [#11166] An `unreachable` row is not a schema mismatch: validation was
   * indeterminate (the remote could not be read), so the default
   * `onMismatch: 'fail'` must NOT abort boot for it — a transient outage
   * during startup used to be a refusal to start. Loud logging instead,
   * per the maintainer ruling of 2026-08-23.
   */
  it('does not abort boot for an `unreachable` row under onMismatch=fail — logs loudly instead (#11166)', async () => {
    const { ctx, warnings, infos } = makeCtx({
      'external-datasource': {
        validateAll: async () => ({
          ok: false,
          results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: unreachableDiffs }],
        }),
      },
      metadata: { get: async () => ({ schemaMode: 'external', external: { validation: { onMismatch: 'fail' } } }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    const line = warnings.find((w) => String(w[0]).includes('could not be validated'));
    expect(line).toBeDefined();
    // The log names the datasource, the object, and the underlying error.
    expect(line![1]).toMatchObject({
      datasource: 'warehouse',
      object: 'wh_order',
      errors: ['connect ECONNREFUSED 10.0.0.5:5432'],
    });
    // And it is NOT the all-clear: an unverified boot must not read as clean.
    expect(infos.some((i) => String(i[0]).includes('match their remote schema'))).toBe(false);
  });

  it('still aborts for a measured mismatch even when another row is merely unreachable (#11166)', async () => {
    const { ctx } = makeCtx({
      'external-datasource': {
        validateAll: async () => ({
          ok: false,
          results: [
            { ok: false, datasource: 'warehouse', object: 'wh_down', diffs: unreachableDiffs },
            { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: sampleDiffs },
          ],
        }),
      },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).rejects.toBeInstanceOf(ExternalSchemaMismatchError);
  });

  it('logs the unreachable row even under onMismatch=ignore — an outage is not a mismatch the policy covers (#11166)', async () => {
    const { ctx, warnings } = makeCtx({
      'external-datasource': {
        validateAll: async () => ({
          ok: false,
          results: [{ ok: false, datasource: 'warehouse', object: 'wh_order', diffs: unreachableDiffs }],
        }),
      },
      metadata: { get: async () => ({ schemaMode: 'external', external: { validation: { onMismatch: 'ignore' } } }) },
    });
    await expect(new ExternalValidationPlugin().runValidation(ctx)).resolves.toBeUndefined();
    expect(warnings.some((w) => String(w[0]).includes('could not be validated'))).toBe(true);
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

  /**
   * [#11166] A briefly-unreachable remote used to raise `external.schema.drift`
   * events whose diffs claimed `missing_table` on every tick it stayed down.
   * The event is still emitted (audit/notification consumers see the outage)
   * but under the distinct `unreachable` kind — and the operator-facing
   * summary log says "could not read", never "drift detected".
   */
  it('runDriftCheck reports an unreachable remote under the `unreachable` kind, not as drift (#11166)', async () => {
    const { ctx, warnings } = makeCtx({
      'external-datasource': scopedService([
        { ok: false, datasource: 'warehouse', object: 'wh_order', diffs: unreachableDiffs },
      ]),
    });
    const emitted = await new ExternalValidationPlugin().runDriftCheck(ctx, 'warehouse');
    expect(emitted).toBe(1);
    expect(ctx.trigger).toHaveBeenCalledWith('external.schema.drift', {
      datasource: 'warehouse',
      object: 'wh_order',
      diffs: unreachableDiffs,
    });
    expect(warnings.some((w) => String(w[0]).includes('could not read the remote'))).toBe(true);
    expect(warnings.some((w) => String(w[0]).includes('drift detected'))).toBe(false);
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
