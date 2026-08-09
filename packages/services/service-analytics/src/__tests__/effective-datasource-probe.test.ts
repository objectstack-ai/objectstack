// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5288 — the `getObjectDatasource` probe reports the EFFECTIVE datasource, not
 * the declared one.
 *
 * `plugin.ts` used to wire the probe to `getObject(name).datasource` — the value
 * the object DECLARES, which is step 1 of the five `ObjectQL.getDriver` routes
 * by. `ObjectSchema.datasource` defaults to `'default'`, so every object placed
 * by a `datasourceMapping` rule, by the ADR-0057 §3.6 lifecycle split, or by its
 * package's `defaultDatasource` answered `'default'` — a string that means "no
 * explicit binding, keep looking" inside the engine and "the primary DB" to
 * everyone reading it out here.
 *
 * `sys_audit_log` is the live specimen: `lifecycle.class: 'audit'` puts it on
 * the `telemetry` datasource without any declaration to read, so #5033's
 * query-time diagnostic — whose entire job is to NAME the database a table is
 * missing from — named the wrong one.
 *
 * These cases drive the REAL plugin wiring (the `fakePluginContext` harness from
 * `execution-context-bridge.test.ts` / `raw-sql-object-routing.test.ts`) against
 * an engine double that answers the two questions SEPARATELY: what the object
 * declares, and where the engine actually routes it. That separation is what the
 * defect lived in, and no test that made the double declare its routing could
 * see it.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

// ── Engine double ───────────────────────────────────────────────────────────

interface EngineShape {
  /** object → declared fields. Membership is also what `isRegisteredObject` reads. */
  schema: Record<string, Record<string, { type?: string; reference?: string }>>;
  /**
   * What each object DECLARES. `'default'` is what a Zod-parsed object carries
   * when its author declared nothing — the shape a real deployment has.
   */
  declared: Record<string, string>;
  /**
   * Where the engine actually routes each object — `resolveEffectiveDatasource`.
   * Absent ⇒ the object rides the deployment default, which the accessor
   * reports as `undefined`.
   */
  routed: Record<string, string>;
  /** Tables physically present, per datasource. */
  tables: Record<string, string[]>;
}

const DEFAULT_DS = '<the deployment default>';

/**
 * Minimal ObjectQL stand-in. `execute` resolves its datasource the way
 * `engine.execute` documents (by `options.object`) and then answers as a driver
 * would: a relation that is not on the resolved datasource raises `no such
 * table`, which is what drives #5033's triage.
 *
 * `withResolver: false` builds an engine that does NOT implement
 * `resolveEffectiveDatasource` at all — an older or non-ObjectQL data service.
 */
function fakeEngine(shape: EngineShape, opts: { withResolver?: boolean } = {}) {
  const withResolver = opts.withResolver !== false;
  const datasourceOf = (object?: string) => (object ? shape.routed[object] ?? DEFAULT_DS : DEFAULT_DS);
  const relationsIn = (sql: string): string[] => {
    const names: string[] = [];
    const from = /\bFROM\s+["`]?([a-z0-9_]+)["`]?/i.exec(sql);
    if (from?.[1]) names.push(from[1]);
    for (const m of sql.matchAll(/\bJOIN\s+["`]?([a-z0-9_]+)["`]?/gi)) names.push(m[1]);
    return names;
  };

  const engine: Record<string, unknown> = {
    execute: async (sql: unknown, options?: { args?: unknown[]; object?: string }) => {
      const ds = datasourceOf(options?.object);
      for (const rel of relationsIn(String(sql))) {
        if (!(shape.tables[ds] ?? []).includes(rel)) throw new Error(`SQLITE_ERROR: no such table: ${rel}`);
      }
      return { rows: [] };
    },
    getObject: (name: string) => {
      const fields = shape.schema[name];
      if (!fields) return undefined;
      // A real registered object carries its DECLARED datasource and nothing
      // about the routing that placed it.
      return { fields, datasource: shape.declared[name] ?? 'default' };
    },
  };
  if (withResolver) {
    engine.resolveEffectiveDatasource = (name: string): string | undefined =>
      shape.schema[name] ? shape.routed[name] : undefined;
  }
  return engine;
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

async function analyticsVia(engine: unknown) {
  const { ctx, registered } = fakePluginContext({ data: engine });
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
  return registered.analytics as AnalyticsService;
}

// ── The #5033 diagnostic, over a lifecycle-routed ledger ─────────────────────

const TELEMETRY = 'telemetry';

/** `sys_audit_log` joined to `account` — the dataset #5033's message describes. */
const auditByActor = DatasetSchema.parse({
  name: 'audit_by_actor',
  label: 'Audit by actor',
  object: 'sys_audit_log',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'event_count', aggregate: 'count' }],
});
const auditSelection = { dimensions: ['region'], measures: ['event_count'] };

/**
 * The issue's exact deployment shape: `sys_audit_log` DECLARES nothing (so it
 * carries the schema default `'default'`) and is routed to `telemetry` by its
 * `lifecycle.class`; `account` is an ordinary business object on the default
 * store.
 */
const lifecycleRoutedShape: EngineShape = {
  schema: {
    sys_audit_log: { action: { type: 'text' }, account: { type: 'lookup', reference: 'account' } },
    account: { region: { type: 'text' } },
  },
  declared: { sys_audit_log: 'default', account: 'default' },
  routed: { sys_audit_log: TELEMETRY },
  tables: { [TELEMETRY]: ['sys_audit_log'], [DEFAULT_DS]: ['account'] },
};

async function diagnosticFor(engine: unknown): Promise<string> {
  const service = await analyticsVia(engine);
  const err = await service
    .queryDataset(auditByActor as never, auditSelection as never)
    .then(() => null, (e: Error) => e);
  return String(err?.message ?? '');
}

describe('#5033 diagnostic names the datasource the object is actually on (#5288)', () => {
  it('names `telemetry` for a ledger the lifecycle split routed there', async () => {
    const message = await diagnosticFor(fakeEngine(lifecycleRoutedShape));

    // The whole point of this wording is to name the real cause.
    expect(message).toContain('table "account"');
    expect(message).toContain('is not on datasource "telemetry"');
    expect(message).toContain('base object "sys_audit_log"');
    // …and the joined side, which nothing binds, is reported as riding the
    // default rather than being given an invented name.
    expect(message).toContain('"account" is registered on the default datasource');
  });

  it('no longer reports the object\'s DECLARED value as if it were a database', async () => {
    const message = await diagnosticFor(fakeEngine(lifecycleRoutedShape));

    // `'default'` is what `ObjectSchema.datasource` defaults to and what the
    // engine reads as "no explicit binding, keep looking". Printing it as a
    // database name is the defect — it pointed the reader at the main DB for a
    // table that is in the telemetry one.
    expect(message).not.toContain('datasource "default"');
    expect(message).not.toContain('is not on the default datasource');
  });

  it('leaves an explicitly-bound object saying exactly what it said before', async () => {
    // The step the declared read already got right must not move: an object
    // that binds itself is reported by its own name, through the new probe.
    const message = await diagnosticFor(
      fakeEngine({
        ...lifecycleRoutedShape,
        declared: { sys_audit_log: 'warehouse', account: 'default' },
        routed: { sys_audit_log: 'warehouse' },
        tables: { warehouse: ['sys_audit_log'], [DEFAULT_DS]: ['account'] },
      }),
    );

    expect(message).toContain('is not on datasource "warehouse"');
  });

  it('stands down to the pre-#5288 wording when the engine cannot answer', async () => {
    // A data service that does not implement the accessor (an older engine, a
    // non-ObjectQL one). The probe answers nothing, the diagnostic says "the
    // default datasource" rather than inventing a name — the same tiering every
    // other probe on this config carries, and exactly the (wrong-but-honest)
    // sentence this object produced before the fix.
    const message = await diagnosticFor(fakeEngine(lifecycleRoutedShape, { withResolver: false }));

    expect(message).toContain('is not on the default datasource');
    expect(message).not.toContain('telemetry');
  });
});

// ── #5115's compile-time gate: same rule, better-informed inputs ─────────────

/**
 * The gate's PREDICATE is untouched by #5288 ("both sides answered a
 * non-`'default'` name, and the names differ"). What changed is what the host
 * can answer with — so these two cases record where the compile-time verdict now
 * lands, and where it still does not. Widening the predicate itself (so that
 * "rides the deployment default" counts as an answer) is #5115's follow-up.
 */
describe('cross-datasource compile gate, with the effective probe (#5288)', () => {
  const bind = (routed: Record<string, string>) =>
    fakeEngine({ ...lifecycleRoutedShape, routed, tables: { [DEFAULT_DS]: ['account'] } });

  it('refuses at compile time when BOTH sides are bound, whichever mechanism bound them', async () => {
    // Base explicitly on `warehouse`, joined object routed to `telemetry` by its
    // lifecycle class. Before #5288 the joined side answered `'default'` and the
    // gate stood down; the join still could not execute, it just failed later.
    const service = await analyticsVia(
      bind({ sys_audit_log: 'warehouse', account: TELEMETRY }),
    );

    const err = (() => {
      try {
        service.registerDataset(auditByActor as never);
        return null;
      } catch (e) {
        return e as Error & { code?: string; status?: number };
      }
    })();

    // ADR-0112 envelope — the author's verdict, not a runtime fault.
    expect(err?.code).toBe('DATASET_INVALID');
    expect(err?.status).toBe(400);
    expect(err?.message).toContain('declares a JOIN that crosses datasources');
  });

  it('still stands down when one side merely rides the deployment default', async () => {
    // The #5115 motivating scenario, and still undecidable HERE: `account` is
    // bound by nothing, so the probe reports `undefined` rather than the default
    // driver's natural name, and an unanswered side never rejects. It is caught
    // at query time by the diagnostic above.
    const service = await analyticsVia(bind({ sys_audit_log: TELEMETRY }));

    expect(() => service.registerDataset(auditByActor as never)).not.toThrow();
  });
});
