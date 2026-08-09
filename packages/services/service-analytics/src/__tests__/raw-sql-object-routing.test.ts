// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5033 — the dataset raw-SQL bridge must route by OBJECT, not to whatever the
 * default datasource happens to be.
 *
 * `ObjectQL.execute()` picks its driver in the order
 * `options.object` → `getDriver(object)`, then `options.datasource`, then the
 * default driver. `AnalyticsServicePlugin`'s auto-bridge received the object
 * name and dropped it, so rule 1 could never fire and every dataset raw-SQL
 * read landed on the default DB. Objects routed elsewhere — the ADR-0057 §3.6
 * telemetry split (`lifecycle.class ∈ {audit, telemetry, event}`), an explicit
 * `object.datasource`, a `datasourceMapping` rule — hit `no such table`, which
 * the widget-level graceful degradation then turned into a confident `0` over
 * 49 live audit rows. The `executeAggregate` bridge in the same file has always
 * routed correctly (`engine.aggregate(objectName, …)`), so the two dataset
 * execution paths disagreed about where an object lives; which strategy the
 * orchestrator picked decided whether you read data or zero.
 *
 * These cases drive the REAL plugin wiring (the `fakePluginContext` harness
 * `execution-context-bridge.test.ts` established) against an engine double that
 * resolves its driver exactly the way `engine.execute` documents — because the
 * defect was invisible to every test that stubbed `executeRawSql` directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

// ── Engine double: two datasources, driver chosen the way execute() documents ─

type Rows = Record<string, unknown>[];
/** datasource name → the tables physically present on it. */
type Topology = Record<string, Record<string, Rows>>;

const DEFAULT_DS = 'default';

interface EngineCall { sql: string; options?: { args?: unknown[]; object?: string } }

/**
 * Minimal ObjectQL stand-in. `execute()` reproduces the documented selection
 * order — `options.object` → that object's datasource, else the default one —
 * and then answers as a real driver would: a table that is not on the resolved
 * datasource raises the driver's own `no such table` error.
 */
function fakeEngine(opts: {
  /**
   * The kernel's schema registry: object → its declared fields. Membership is
   * also what `isRegisteredObject` reads, so an object omitted here is one this
   * kernel never mounted (as opposed to one that lives on another datasource).
   */
  schema: Record<string, Record<string, { type?: string; reference?: string }>>;
  /** object → datasource. Objects absent here ride the default datasource. */
  routing: Record<string, string>;
  topology: Topology;
  /** The (dimension, measure alias) pair every query in this file groups by. */
  shape: { groupBy: string; alias: string };
}) {
  const calls: EngineCall[] = [];
  const datasourceOf = (object?: string) => (object ? opts.routing[object] ?? DEFAULT_DS : DEFAULT_DS);
  const tableOn = (ds: string, table: string): Rows | undefined => opts.topology[ds]?.[table];

  /** COUNT(*) … GROUP BY <dim> over raw rows — the one shape these datasets ask for. */
  const groupCount = (rows: Rows): Rows => {
    const buckets = new Map<unknown, number>();
    for (const r of rows) buckets.set(r[opts.shape.groupBy], (buckets.get(r[opts.shape.groupBy]) ?? 0) + 1);
    return [...buckets].map(([value, count]) => ({ [opts.shape.groupBy]: value, [opts.shape.alias]: count }));
  };

  /** Every relation the compiled statement names — the base table and its joins. */
  const relationsIn = (sql: string): string[] => {
    const names: string[] = [];
    const from = /\bFROM\s+["`]?([a-z0-9_]+)["`]?/i.exec(sql);
    if (from?.[1]) names.push(from[1]);
    for (const m of sql.matchAll(/\bJOIN\s+["`]?([a-z0-9_]+)["`]?/gi)) names.push(m[1]);
    return names;
  };

  return {
    calls,
    engine: {
      execute: async (sql: unknown, options?: { args?: unknown[]; object?: string }) => {
        calls.push({ sql: String(sql), options });
        const ds = datasourceOf(options?.object);
        const relations = relationsIn(String(sql));
        for (const rel of relations) {
          if (!tableOn(ds, rel)) throw new Error(`SQLITE_ERROR: no such table: ${rel}`);
        }
        const base = relations[0] ? tableOn(ds, relations[0]) : undefined;
        return { rows: groupCount(base ?? []) };
      },
      aggregate: async (object: string, options: Record<string, unknown>) => {
        const ds = datasourceOf(object);
        const rows = tableOn(ds, object);
        if (!rows) throw new Error(`SQLITE_ERROR: no such table: ${object}`);
        const aggs = options.aggregations as Array<{ alias: string }> | undefined;
        const alias = aggs?.[0]?.alias ?? opts.shape.alias;
        return groupCount(rows).map((r) => ({
          [opts.shape.groupBy]: r[opts.shape.groupBy],
          [alias]: r[opts.shape.alias],
        }));
      },
      getObject: (name: string) => {
        const fields = opts.schema[name];
        if (!fields) return undefined;
        const datasource = opts.routing[name];
        return datasource ? { fields, datasource } : { fields };
      },
      // [#5288] The engine's own answer to "where does this object's data live",
      // which is what the analytics probe asks now — `getObject().datasource` is
      // the DECLARED value and covers only the first of five resolution steps.
      // `routing` above is already the effective placement (it is what `execute`
      // resolves by), so the double answers both faces from the one map, the way
      // `ObjectQL.resolveEffectiveDatasource` and `getDriver` answer from one
      // resolution order.
      resolveEffectiveDatasource: (name: string) =>
        (opts.schema[name] ? opts.routing[name] : undefined),
    },
  };
}

/** Minimal PluginContext: the four members `AnalyticsServicePlugin.init` uses. */
function fakePluginContext(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = {};
  const warn = vi.fn();
  return {
    warn,
    registered,
    ctx: {
      getService: (name: string) => services[name] ?? registered[name],
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      logger: { info() {}, warn, error() {}, debug() {} },
    },
  };
}

const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

// ── The issue's exact shape: an audit object on the telemetry datasource ─────

/** ADR-0057 §3.6 — `sys_audit_log` lives in the sibling telemetry DB, not the main one. */
const TELEMETRY = 'telemetry';
const auditRows: Rows = [
  { action: 'login', id: 'a1' },
  { action: 'login', id: 'a2' },
  { action: 'permission_change', id: 'a3' },
];

const auditDataset = DatasetSchema.parse({
  name: 'sys_audit_log_metrics',
  label: 'Audit events',
  object: 'sys_audit_log',
  dimensions: [{ name: 'action', field: 'action', type: 'string' }],
  measures: [{ name: 'event_count', aggregate: 'count' }],
});

function auditEngine() {
  return fakeEngine({
    schema: { sys_audit_log: { action: { type: 'text' } }, opportunity: { stage: { type: 'text' } } },
    routing: { sys_audit_log: TELEMETRY },
    topology: {
      // The main DB has 88 objects — and NOT this one. Reading it here is the bug.
      [DEFAULT_DS]: { opportunity: [] },
      [TELEMETRY]: { sys_audit_log: auditRows },
    },
    shape: { groupBy: 'action', alias: 'event_count' },
  });
}

async function analyticsVia(
  engine: unknown,
  capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean },
) {
  const { ctx, registered, warn } = fakePluginContext({ data: engine });
  await new AnalyticsServicePlugin({ queryCapabilities: capabilities }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, warn };
}

const auditSelection = { dimensions: ['action'], measures: ['event_count'] };

describe('executeRawSql auto-bridge routes by object (#5033)', () => {
  it('hands the object name to engine.execute as its driver-selection key', async () => {
    const { engine, calls } = auditEngine();
    const { service } = await analyticsVia(engine, nativeSql);

    await service.queryDataset(auditDataset as never, auditSelection as never);

    // The key `engine.execute` resolves FIRST. Dropping it is the whole defect.
    expect(calls).toHaveLength(1);
    expect(calls[0].options?.object).toBe('sys_audit_log');
    // …alongside the bound parameters the bridge already forwarded.
    expect(calls[0].options).toHaveProperty('args');
  });

  it('reads the SAME rows through raw SQL as through the object-routed aggregate', async () => {
    // The invariant this issue is really about: two dataset execution paths,
    // ONE answer to "which datasource is this object in".
    const raw = await analyticsVia(auditEngine().engine, nativeSql);
    const routed = await analyticsVia(auditEngine().engine, objectqlOnly);

    const viaRawSql = await raw.service.queryDataset(auditDataset as never, auditSelection as never);
    const viaAggregate = await routed.service.queryDataset(auditDataset as never, auditSelection as never);

    expect(viaRawSql.rows).toEqual(viaAggregate.rows);
    expect(viaRawSql.rows).toEqual([
      { action: 'login', event_count: 2 },
      { action: 'permission_change', event_count: 1 },
    ]);
  });

  it('no longer reaches the graceful-degradation path at all', async () => {
    // Pre-fix this query returned `{rows:[],fields:[],totals:[]}` plus a WARN
    // naming `sys_audit_log` "unavailable" — over live rows. The fix must not
    // merely quieten that log; the misroute that produced it is gone.
    const { engine } = auditEngine();
    const { service, warn } = await analyticsVia(engine, nativeSql);

    const result = await service.queryDataset(auditDataset as never, auditSelection as never);

    expect(result.rows.length).toBeGreaterThan(0);
    expect(warn.mock.calls.map(String).join('\n')).not.toMatch(/is unavailable/);
  });

  it('leaves default-datasource objects exactly where they were', async () => {
    // The regression guard for the other 88 objects: naming the object routes
    // to the SAME default driver they already used.
    const { engine, calls } = fakeEngine({
      schema: { opportunity: { stage: { type: 'text' } } },
      routing: {},
      topology: { [DEFAULT_DS]: { opportunity: [{ stage: 'won' }, { stage: 'won' }, { stage: 'lost' }] } },
      shape: { groupBy: 'stage', alias: 'deal_count' },
    });
    const dataset = DatasetSchema.parse({
      name: 'pipeline', label: 'Pipeline', object: 'opportunity',
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'deal_count', aggregate: 'count' }],
    });
    const { service, warn } = await analyticsVia(engine, nativeSql);

    const result = await service.queryDataset(
      dataset as never,
      { dimensions: ['stage'], measures: ['deal_count'] } as never,
    );

    expect(calls[0].options?.object).toBe('opportunity');
    expect(result.rows).toEqual([
      { stage: 'won', deal_count: 2 },
      { stage: 'lost', deal_count: 1 },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ── The accepted behaviour change: cross-datasource joins now fail loudly ────

/**
 * `NativeSQLStrategy` emits a `LEFT JOIN` for a dotted dimension
 * (`account.region`). Once the statement is routed to the base object's OWN
 * datasource, a join whose target lives elsewhere can no longer silently read
 * the wrong database — it fails there. That is the correct trade (this repo's
 * fail-loud line), but it must fail as ITSELF: the pre-fix wording ("backing
 * object … is unavailable" → empty result) would keep the confident `0` alive
 * under a new cause, with the base table sitting right there.
 */
const crossDsDataset = DatasetSchema.parse({
  name: 'audit_by_actor',
  label: 'Audit by actor',
  object: 'sys_audit_log',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'event_count', aggregate: 'count' }],
});

function crossDsEngine() {
  return fakeEngine({
    schema: {
      sys_audit_log: { action: { type: 'text' }, account: { type: 'lookup', reference: 'account' } },
      account: { region: { type: 'text' } },
    },
    routing: { sys_audit_log: TELEMETRY },
    topology: {
      [DEFAULT_DS]: { account: [{ region: 'NA' }] },
      [TELEMETRY]: { sys_audit_log: auditRows },
    },
    shape: { groupBy: 'region', alias: 'event_count' },
  });
}

describe('cross-datasource dataset JOIN fails loudly, naming the real cause (#5033)', () => {
  const selection = { dimensions: ['region'], measures: ['event_count'] };

  it('rejects instead of degrading to an empty result', async () => {
    const { service } = await analyticsVia(crossDsEngine().engine, nativeSql);

    await expect(
      service.queryDataset(crossDsDataset as never, selection as never),
    ).rejects.toThrow(/cannot be executed as one statement/);
  });

  it('names the missing table AND the datasource it is missing from', async () => {
    const { service } = await analyticsVia(crossDsEngine().engine, nativeSql);

    const err = await service
      .queryDataset(crossDsDataset as never, selection as never)
      .then(() => null, (e: Error) => e);

    // table X …
    expect(err?.message).toContain('table "account"');
    // … not on datasource Y (the one the BASE object routed to) …
    expect(err?.message).toContain('datasource "telemetry"');
    expect(err?.message).toContain('base object "sys_audit_log"');
    // … and the remedy, not just the symptom.
    expect(err?.message).toMatch(/JOIN cannot cross datasources/);
    // NOT the misleading old shape.
    expect(err?.message).not.toMatch(/backing object "sys_audit_log" is unavailable/);
  });

  it('does not emit the widget-degradation WARN for a topology error', async () => {
    const { engine } = crossDsEngine();
    const { service, warn } = await analyticsVia(engine, nativeSql);

    await service.queryDataset(crossDsDataset as never, selection as never).catch(() => undefined);

    expect(warn.mock.calls.map(String).join('\n')).not.toMatch(/is unavailable/);
  });
});

// ── Ruling 3: the genuine-absence degradation is untouched ───────────────────

describe('graceful degradation survives for a genuinely missing table (#5033)', () => {
  it("still returns an empty result + WARN when the dataset's OWN object is absent", async () => {
    // The case the degradation exists for: a platform dashboard charting an
    // object this kernel never mounted. Nothing to route to — render "no data",
    // do not 500 the widget.
    const { engine } = fakeEngine({
      schema: { opportunity: { stage: { type: 'text' } } },
      routing: {},
      topology: { [DEFAULT_DS]: { opportunity: [] } },
      shape: { groupBy: 'action', alias: 'event_count' },
    });
    const { service, warn } = await analyticsVia(engine, nativeSql);

    const result = await service.queryDataset(auditDataset as never, auditSelection as never);

    expect(result).toEqual({ rows: [], fields: [], totals: [] });
    expect(warn.mock.calls.map(String).join('\n')).toMatch(
      /dataset "sys_audit_log_metrics" backing object "sys_audit_log" is unavailable/,
    );
  });

  it('degrades (not throws) when a JOINED object is not registered in this kernel either', async () => {
    // The joined table is missing AND the object does not exist here at all —
    // absence, not a routing mistake. Same tiering as the base-object case.
    const { engine } = fakeEngine({
      // `account` is a declared lookup on the base object, but no such OBJECT is
      // mounted in this kernel — so there is nothing to have mis-routed.
      schema: { sys_audit_log: { action: { type: 'text' }, account: { type: 'lookup', reference: 'account' } } },
      routing: {},
      topology: { [DEFAULT_DS]: { sys_audit_log: auditRows } },
      shape: { groupBy: 'region', alias: 'event_count' },
    });
    const { service, warn } = await analyticsVia(engine, nativeSql);

    const result = await service.queryDataset(
      crossDsDataset as never,
      { dimensions: ['region'], measures: ['event_count'] } as never,
    );

    expect(result).toEqual({ rows: [], fields: [], totals: [] });
    expect(warn.mock.calls.map(String).join('\n')).toMatch(/is unavailable/);
  });
});
