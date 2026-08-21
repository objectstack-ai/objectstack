// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 batch D — `data/analytics.zod.ts` strictness (all 8 sites), plus the
 * two re-verdicts the same per-schema read produced (`seed-loader.zod.ts` →
 * wire, `field-value.zod.ts` → open), pinned so a later sweep stops here
 * instead of "finishing" them.
 *
 * This file is the third of the three places each verdict is recorded (the
 * others: the JSDoc on each shape, and the `data/` rows in
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md`).
 *
 * What is pinned, and why each needs its own assertion:
 *
 *   1. THE DOORS. `.strict()` is a property of a PARSE (#4583): `defineCube()`
 *      and `defineStack({ analyticsCubes })` for the cube family; the
 *      `/analytics/query` request wrapper for the query family.
 *   2. Every closed site at its OWN path through the real carrier — strictness
 *      does not recurse, and the batch's live behaviour change is exactly a
 *      nested site (`timeDimensions[]`) that used to ride through the already
 *      strict TOP level of the request wrapper.
 *   3. The CURATION: every alias is a claim about a sibling surface (ledger
 *      finding 18 — this campaign shipped four false prescriptions), so each
 *      is anchored to the declaration that makes it true.
 *   4. The wrapper still works: `AnalyticsQueryRequestSchema` extends the now
 *      strict base (`.extend()` on a strict shape — the webhook/connector
 *      precedent), with its #3878 tombstones intact.
 *   5. The two shapes deliberately NOT closed by this batch, with the
 *      measurement that says why.
 */

import { describe, it, expect } from 'vitest';

import {
  CubeSchema,
  MetricSchema,
  DimensionSchema,
  AnalyticsQuerySchema,
  defineCube,
} from './analytics.zod';
import { AnalyticsQueryRequestSchema } from '../api/analytics.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { LocationValueSchema, AddressSchema } from './field-value.zod';
import { SeedLoaderConfigSchema } from './seed-loader.zod';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify((r.error as { issues?: unknown })?.issues ?? r.error ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } },
  value: unknown,
): unknown {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data;
}

/** A minimal cube that parses — every nested probe is layered onto this. */
const CUBE = {
  name: 'batchd_probe',
  sql: 'batchd_probe_table',
  measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
  dimensions: { stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' } },
} as const;

/** A minimal query the REST wrapper accepts (it requires `cube`). */
const QUERY = { cube: 'batchd_probe', measures: ['count'] } as const;

// ===========================================================================
// 1. The doors — a parse must exist, or none of the rest means anything
// ===========================================================================
describe('#4001 batch D — the doors the cube family is reachable through', () => {
  it('`defineCube()` is a real parse door — it throws on a malformed config', () => {
    expect(() => defineCube({ ...CUBE, notACubeKey: 1 } as never)).toThrow(/notACubeKey/);
  });

  it('`defineStack({ analyticsCubes })` is the carrier — ObjectStackDefinitionSchema rejects a bad cube through it', () => {
    const stack = { name: 'batchd_stack', analyticsCubes: [{ ...CUBE, publik: true }] };
    expect(reject(ObjectStackDefinitionSchema, stack)).toContain('publik');
  });

  it('[#10194] `analytics_cube` now resolves the SAME schema at the saveMetaItem door', () => {
    // This pin used to assert the opposite — `getMetadataTypeSchema` answering
    // `undefined` — and its comment demanded that the ADR-0010 envelope
    // question be re-asked before the line was "fixed". It was: #10194 bound
    // `analytics_cube` in `UNREGISTERED_KIND_SCHEMAS` (so `PUT
    // /meta/analytics_cube/:name` stops storing any JSON as `success: true`),
    // and CubeSchema now declares `...MetadataProtectionFields`, exactly per
    // the webhook precedent the old comment cited — both metadata load paths
    // stamp `_packageId`/`_provenance` on EVERY type before storage, so a
    // strict schema at the overlay door must declare the stamp or 422 the
    // runtime's own envelope. Identity, not equivalence: the door must parse
    // with THIS file's CubeSchema, or the two doors drift apart again.
    expect(getMetadataTypeSchema('analytics_cube')).toBe(CubeSchema);
  });

  it('controls parse — these tests fail closed, they do not reject everything', () => {
    accept(CubeSchema, {
      ...CUBE,
      title: 'Probe',
      joins: { other: { name: 'other', relationship: 'many_to_one', sql: 'a.id = b.a_id' } },
      refreshKey: { every: '1 hour', sql: 'SELECT max(updated_at)' },
      public: true,
    });
    accept(AnalyticsQuerySchema, {
      ...QUERY,
      dimensions: ['stage'],
      where: { is_active: true },
      timeDimensions: [{ dimension: 'created', granularity: 'day', dateRange: 'Last 7 days' }],
      order: { stage: 'asc' },
      limit: 10,
      offset: 0,
      timezone: 'UTC',
    });
  });
});

// ===========================================================================
// 2. Every closed site, at its own path, through its real carrier
// ===========================================================================
describe('#4001 batch D — closed sites reject unknown keys where they live', () => {
  it('`Cube` — the top-level cube shape', () => {
    expect(reject(CubeSchema, { ...CUBE, publik: true })).toContain('publik');
  });

  it('`Cube.refreshKey` — one level below an already-closed parent', () => {
    expect(reject(CubeSchema, { ...CUBE, refreshKey: { every: '1 hour', sqll: 'x' } })).toContain('sqll');
  });

  it('`Metric` — through the cube `measures` record', () => {
    expect(
      reject(CubeSchema, {
        ...CUBE,
        measures: { m: { name: 'm', label: 'M', type: 'count', sql: '*', drillMembers: [] } },
      }),
    ).toContain('drillMembers');
  });

  // Batch D also closed the nested `Metric.filters[]` item ("this metric
  // filter"), pinned here as `{ sql: 'x', field: 'y' }` → rejection naming
  // `field`. #10414 removed `Metric.filters` outright (ADR-0049
  // enforce-or-remove: no strategy ever read it), so the nested surface no
  // longer exists — the batch-D verdict for it is SUPERSEDED, not reopened.
  // The key itself now rejects with the retirement prescription:
  it('`Metric.filters` — REMOVED (#10414); the key rejects with the prescription, not as a bare unknown', () => {
    expect(
      reject(MetricSchema, { name: 'm', label: 'M', type: 'count', sql: '*', filters: [{ sql: 'x' }] }),
    ).toContain('was removed in @objectstack/spec 17 (#10414');
  });

  it('`Dimension` — through the cube `dimensions` record', () => {
    expect(
      reject(CubeSchema, {
        ...CUBE,
        dimensions: { d: { name: 'd', label: 'D', type: 'string', sql: 'd', primaryKey: true } },
      }),
    ).toContain('primaryKey');
  });

  it('`CubeJoin` — through the cube `joins` record; a typo\'d `relationship` used to fall back to the default silently', () => {
    expect(
      reject(CubeSchema, {
        ...CUBE,
        joins: { j: { name: 'other', sql: 'x', relationshipp: 'one_to_one' } },
      }),
    ).toContain('relationshipp');
  });

  it('`AnalyticsQuery` — the base top level (already gated at the REST wrapper; now gated at every door)', () => {
    expect(reject(AnalyticsQuerySchema, { ...QUERY, granularity: 'day' })).toContain('granularity');
  });

  it('`AnalyticsQuery.timeDimensions[]` — THE batch\'s live behaviour change: this typo used to ride through the strict REST wrapper', () => {
    // Measured on `main` before the close: the wrapper's `.strict()` guards
    // only the top level, so `granuarity` was silently stripped and the query
    // bucketed the whole range as one group under an ordinary 200.
    const issues = reject(AnalyticsQueryRequestSchema, {
      ...QUERY,
      timeDimensions: [{ dimension: 'created', granuarity: 'day' }],
    });
    expect(issues).toContain('granuarity');
    expect(issues).toContain('granularity'); // the rename rides in the rejection
  });
});

// ===========================================================================
// 3. The curation — each alias anchored to the declaration that makes it true
// ===========================================================================
describe('#4001 batch D — alias claims are true of the surfaces they point at', () => {
  it('`title` → `label` on Metric/Dimension, and `label` → `title` on Cube: each spelling is CORRECT on the other surface', () => {
    // The claims are structural: CubeSchema declares `title`, Metric/Dimension
    // declare `label`. If either declaration changes, this pins the alias table
    // to be re-read.
    expect(Object.keys(CubeSchema.shape)).toContain('title');
    expect(Object.keys(CubeSchema.shape)).not.toContain('label');
    expect(Object.keys(MetricSchema.shape)).toContain('label');
    expect(Object.keys(DimensionSchema.shape)).toContain('label');
    expect(reject(MetricSchema, { name: 'm', title: 'M', label: 'M', type: 'count', sql: '*' })).toContain('label');
    expect(reject(CubeSchema, { ...CUBE, label: 'Probe' })).toContain('title');
  });

  it('`orderBy` → `order`: the sibling record dialect really does spell sorting `orderBy`', async () => {
    const { QuerySchema } = await import('./query.zod');
    // BaseQuerySchema (via QuerySchema) declares `orderBy`; the analytics
    // dialect declares `order` — the alias is a cross-dialect pointer, not a
    // typo suggestion.
    accept(QuerySchema, { object: 'probe', orderBy: [{ field: 'created_at', order: 'desc' }] });
    expect(reject(AnalyticsQuerySchema, { ...QUERY, orderBy: { stage: 'asc' } })).toContain('order');
  });

  it('`filters` gets the wrong-layer prescription (`where`), matching the dispatcher\'s #3878 bespoke hint', () => {
    const issues = reject(AnalyticsQuerySchema, { ...QUERY, filters: { is_active: true } });
    expect(issues).toContain('where');
  });

  it('`granularities` ↔ `granularity`: the plural is the cube dimension\'s key, the singular is the query\'s', () => {
    expect(Object.keys(DimensionSchema.shape)).toContain('granularities');
    const issues = reject(AnalyticsQueryRequestSchema, {
      ...QUERY,
      timeDimensions: [{ dimension: 'created', granularities: ['day'] }],
    });
    expect(issues).toContain('granularity');
  });
});

// ===========================================================================
// 4. The REST wrapper still composes — strictness rides `.extend()` correctly
// ===========================================================================
describe('#4001 batch D — the strict base does not break the request wrapper', () => {
  it('a valid request body still parses through `AnalyticsQueryRequestSchema`', () => {
    accept(AnalyticsQueryRequestSchema, {
      ...QUERY,
      dimensions: ['stage'],
      timeDimensions: [{ dimension: 'created', granularity: 'day' }],
    });
  });

  it('the #3878 tombstones still fire — `query` and `format` carry their migration text', () => {
    expect(reject(AnalyticsQueryRequestSchema, { ...QUERY, query: { measures: ['count'] } })).toContain('#3878');
    expect(reject(AnalyticsQueryRequestSchema, { ...QUERY, format: 'csv' })).toContain('#3878');
  });
});

// ===========================================================================
// 5. The shapes this batch deliberately did NOT close, with the reason
// ===========================================================================
describe('#4001 batch D — deliberate non-closures (re-verdicts, not omissions)', () => {
  it('`LocationValueSchema` / `AddressSchema` stay tolerant — record-data value contracts (ADR-0104), not authoring surfaces', () => {
    // A phone's geolocation payload carries `heading`/`speed`; a geocoder's
    // address carries `district`. These are legitimate stored record data, and
    // every consumer is validation-only (`record-validator` stores the value
    // verbatim), so `.strip` never actually strips anything here. Closing them
    // would reject real data; the enforcement posture belongs to ADR-0104's
    // evidence-gated warn-first rollout. The day either line goes red, that
    // rollout — not this ratchet — is the place the decision was made.
    accept(LocationValueSchema, { lat: 1, lng: 2, heading: 90, speed: 3 });
    accept(AddressSchema, { street: '1 Main St', district: 'Central' });
  });

  it('`seed-loader` shapes stay tolerant — an internal service contract whose every producer is framework code', () => {
    // Re-verdicted `wire` in batch D: no authoring surface writes these keys
    // (the authored half of seeding is `SeedSchema`, already strict, nested as
    // the request's `seeds[]` value). An unknown key here is a framework code
    // literal, caught in review — not an author's silent loss.
    accept(SeedLoaderConfigSchema, { multiPass: true, somethingInternal: 1 });
  });
});
