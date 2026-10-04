// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11833] The plugin's aggregate auto-bridge speaks the ENGINE's aggregate
 * vocabulary, and refuses anything else instead of forwarding it.
 *
 * `plugin.ts` used to name the engine through a consumer-local structural
 * `DataEngineLike` that declared `aggregations[].function` as `string`. The
 * declared contract (`IDataEngine.aggregate` →
 * `EngineAggregateOptions.aggregations[].function`) is the SIX-value
 * `AggregationFunction`. Nothing compiled the two against each other, so the
 * bridge forwarded whatever string reached it — and the engine then failed in
 * the two ways commit 017130a09 documents: `driver-sql` blaming a `function` key the
 * author never wrote, or the in-memory evaluator answering `null` for every
 * bucket under the author's own measure name (the #4157 class).
 *
 * Deriving the local view from the contract makes the forward a compile error;
 * these cases pin the RUNTIME half of that repair.
 *
 * ## Why this refusal is deliberately NOT in the ADR-0112 envelope
 *
 * A non-aggregate method is host drift (an unparsed cube object, our own
 * drift), which `dataset-refusal.ts`'s module header assigns to the
 * bare-`Error`, undeclared-500 tier. The absence of a `code` is therefore
 * asserted, not overlooked: enveloping this as a 400 would tell the author to
 * fix something they did not write.
 *
 * ## [#21000] Two seams, one tier
 *
 * The custom-SQL metric types (`AggregationMetricType` `number` / `string` /
 * `boolean`) used to be refused `INVALID_FIELD` / 400 by
 * `ObjectQLStrategy.resolveMeasureAggregation` (commit 017130a09), and every
 * OTHER non-aggregate type — `median`, a cube that never met the parse — was
 * forwarded on to this bridge. The three were retired from the spec, and the
 * resolver now answers every type no aggregate lowers itself
 * (`aggregateOfMeasure`), in the same undeclared-500 tier, in the spec's words.
 * So the cube path no longer reaches the bridge with one, and this file pins
 * both seams: the cube path refused at the resolver, nothing reaching the
 * engine; and the bridge itself, driven directly, still parsing whatever
 * method arrives before the engine sees it.
 */

import { describe, it, expect, vi } from 'vitest';
import { AggregationFunction } from '@objectstack/spec/data';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

type EngineAggregateCall = {
  object: string;
  aggregations?: Array<{ function: string; field?: string; alias: string }>;
};

/**
 * Minimal `'data'` service: the one member the aggregate bridge requires.
 * `getObject` answers the schema so the source-field gates can stand.
 */
function fakeEngine(calls: EngineAggregateCall[], fields: Record<string, { type?: string }>) {
  return {
    getObject: (name: string) => (name === 'opportunity' ? { fields } : undefined),
    aggregate: async (object: string, options: EngineAggregateCall) => {
      calls.push({ object, aggregations: options.aggregations });
      return [{ region: 'west', total: 1 }];
    },
  };
}

function fakePluginContext(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = {};
  const warn = vi.fn();
  return {
    registered,
    ctx: {
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn, error() {}, debug() {} },
    },
  };
}

const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

/**
 * A cube carrying one measure of the given metric type.
 *
 * `type` is widened past `AggregationMetricType` on purpose: the drift case
 * below needs a cube that never met `CubeSchema`'s parse, which is exactly the
 * arrival path the refusal is tiered for. A parsed cube cannot carry it.
 */
const cubeWithMeasureType = (type: string): Cube => ({
  name: 'sales',
  title: 'Sales',
  sql: 'opportunity',
  measures: { revenue: { label: 'Revenue', type, sql: 'amount' } as Cube['measures'][string] },
  dimensions: { region: { label: 'Region', type: 'string', sql: 'region' } },
  public: true,
});

async function analyticsVia(engine: unknown, cube: Cube): Promise<AnalyticsService> {
  const { ctx, registered } = fakePluginContext({ data: engine });
  await new AnalyticsServicePlugin({
    cubes: [cube],
    queryCapabilities: objectqlOnly,
  }).init(ctx as never);
  return registered.analytics as AnalyticsService;
}

const selection = { cube: 'sales', dimensions: ['region'], measures: ['revenue'] };
const schema = { region: { type: 'text' }, amount: { type: 'number' } };

describe('[#11833] the aggregate auto-bridge speaks the engine contract vocabulary', () => {
  it('forwards a declared aggregate function through to the engine', async () => {
    // Positive control: without this, the refusal case below could pass because
    // NOTHING reaches the engine, for reasons that have nothing to do with the
    // vocabulary.
    const calls: EngineAggregateCall[] = [];
    const service = await analyticsVia(fakeEngine(calls, schema), cubeWithMeasureType('sum'));

    await service.query(selection as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].aggregations?.[0].function).toBe('sum');
    expect(AggregationFunction.options).toContain(calls[0].aggregations?.[0].function);
  });

  it('a cube measure whose type names no aggregate is refused at the resolver, before the bridge', async () => {
    // Host drift: a cube object registered without meeting `CubeSchema`, so its
    // `type` never faced the enum's parse. Since #21000 the strategy's resolver
    // refuses it — the same tier the bridge answers in, in the spec's words.
    const calls: EngineAggregateCall[] = [];
    const service = await analyticsVia(fakeEngine(calls, schema), cubeWithMeasureType('median'));

    const err = await service.query(selection as never).then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('measure "revenue" on cube "sales" cannot be served: its type "median"');
    for (const fn of AggregationFunction.options) expect(err?.message).toContain(fn);
    // Undeclared-500 tier, deliberately: no ADR-0112 envelope on this family.
    expect((err as Error & { code?: string }).code).toBeUndefined();
    // The load-bearing half — the bad type never reached the engine.
    expect(calls).toHaveLength(0);
  });

  it('the bridge itself still refuses a method outside the engine vocabulary instead of forwarding it', async () => {
    // Driven DIRECTLY: no cube path reaches the bridge with a non-aggregate
    // method any more (the case above), so the seam is exercised as the
    // strategy calls it — the service's strategy context's `executeAggregate`,
    // which is the plugin's auto-bridge — with a method the engine does not
    // declare.
    const calls: EngineAggregateCall[] = [];
    const service = await analyticsVia(fakeEngine(calls, schema), cubeWithMeasureType('sum'));
    const bridge = (service as unknown as {
      baseCtx: { executeAggregate: (object: string, options: unknown) => Promise<unknown> };
    }).baseCtx.executeAggregate;

    const err = await bridge('opportunity', {
      groupBy: ['region'],
      aggregations: [{ field: 'amount', method: 'median', alias: 'revenue' }],
    }).then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    // The wording IS the contract here: it must name the offending method, the
    // aggregation it belongs to, and the legal vocabulary.
    expect(err?.message).toContain('"median" is not one of the engine\'s aggregate functions');
    expect(err?.message).toContain('revenue');
    for (const fn of AggregationFunction.options) expect(err?.message).toContain(fn);
    // Undeclared-500 tier, deliberately: no ADR-0112 envelope on this family.
    expect((err as Error & { code?: string }).code).toBeUndefined();
    // The load-bearing half — the bad method never reached the engine, so no
    // driver got a chance to blame a `function` key nobody wrote and no bucket
    // came back silently null.
    expect(calls).toHaveLength(0);
  });
});
