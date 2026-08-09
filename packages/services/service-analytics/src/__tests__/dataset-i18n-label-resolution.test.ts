// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6761 — a dataset dimension/measure `label` written as an inline locale map
 * must reach the wire as a **resolved string**, not be dropped and not be
 * replaced by the machine name.
 *
 * `I18nLabelSchema` has authorized two forms of a display label since #5728: a
 * plain string, and an inline locale map `{ en: 'Owner', 'zh-CN': '负责人' }`.
 * Every producer in this service tested `typeof label === 'string'` and dropped
 * anything else, so a dataset written the way the schema documents shipped:
 *
 * ```
 * label: 'Owner'                              → fields[] carries label: 'Owner'   ✅
 * label: { en: 'Owner', 'zh-CN': '负责人' }     → fields[] carries NO label         ❌
 * (no label declared)                         → fields[] carries NO label         ✅ (unchanged)
 * ```
 *
 * measured identically on both strategies at `origin/main`. One layer up,
 * `dataset-compiler` substituted the machine NAME for the same map, so
 * `/analytics/meta` additionally published `title: 'owner'` as a display title —
 * a face that lies rather than one that is merely bare.
 *
 * ## What resolves it, and why it is imported rather than written here
 *
 * `resolveI18nLabel` (`@objectstack/spec/ui`, #6765) — the one shared
 * `I18nLabel → string` resolver, pinned in its own package to rule parity with
 * objectui's `pickLocalized`. Maintainer ruling B (#6761, 2026-08-08) chose a
 * shared resolver over a private twin inside this service precisely so the two
 * ends cannot answer the same authored map differently. These tests therefore
 * assert *that this service asks the resolver*, and assert the resolver's own
 * documented fallback rule where it applies — never a locally guessed rule.
 *
 * The wire is unchanged: `AnalyticsResult.fields[].label` is `string | undefined`
 * on both ends (`packages/spec/src/contracts/analytics-service.ts`, objectui's
 * `DatasetResultField`), and objectui's `headerLabel` feeds it into
 * `fieldLabel(...)` as a plain string with no `pickLocalized` on that path — a
 * raw map would render `[object Object]`. Widening the wire was option C and was
 * rejected. Every case below asserts `typeof label === 'string'`.
 *
 * ## Which locale each site uses
 *
 *  * **`queryDataset`'s two enrichment sites** — `ExecutionContext.locale`, the
 *    per-request BCP-47 tag `resolveExecutionContext` derives from the caller's
 *    `Accept-Language` (falling back to the workspace `localization` setting).
 *    Both sites are inside one method and read one hoisted `requestLocale`, so
 *    a single response cannot mix two audiences.
 *  * **`dataset-compiler`** — deliberately **no** locale (`REGISTRY_LOCALE`),
 *    i.e. the resolver's documented nullish answer `en`. A compiled Cube is a
 *    registry artifact shared by every later reader, and `getMeta()` — the
 *    `/analytics/meta` face — takes no execution context at all. Baking a
 *    request locale there would make `/analytics/meta` answer whoever queried
 *    last; the last describe block pins that it does not.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Unhooking the resolution (restoring `typeof … === 'string'` at both
 * enrichment sites and in the compiler) must turn RED exactly the cases whose
 * label is a MAP, and leave GREEN every plain-string, absent-label and
 * empty-map case — those pin the behaviour this change converges ON rather than
 * changes. Ordinary direction, no inversion and no count movement: the change
 * ADDS resolutions that were absent, narrows no rule and removes no `??` limb,
 * so nothing downstream can gain a finding from it.
 *
 * Per strategy, RED: the `zh-CN`, `en`, base-language, last-resort-limb and
 * no-locale cases (5); GREEN: plain string, no label, empty map (3). Plus, on
 * `/analytics/meta`: RED the resolved-title and no-locale-leak cases (2), GREEN
 * the plain-string/machine-name-fallback case (1).
 *
 * **Predicted 12 red / 7 green. Measured exactly that** — the run is quoted in
 * the PR body.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

// ── the fixture ─────────────────────────────────────────────────────────────

/**
 * One dataset carrying every label shape the schema authorizes, so a single
 * selection describes all of them in one response:
 *
 *  * `owner` / `opp_count` — inline map with both `en` and `zh-CN`: the shape
 *    the defect dropped, and the one the three renderers are waiting for.
 *  * `stage` / `total_amount` — plain string: the control that must not move.
 *  * `lead_source` / `bare_count` — no label at all: the control that must stay
 *    key-less (an invented `label` would be worse than none — see #5537's note
 *    on descriptors describing columns rather than minting them).
 *  * `region` — a map that names NEITHER the requested locale nor `en`: the
 *    resolver's last-resort limb, asserted as the resolver's rule.
 *  * `blank` — an empty map: the only in-contract input on which the resolver
 *    misses entirely, so it pins "a miss writes nothing".
 *
 * The dataset's own `label` is a map too, which is what `/analytics/meta`
 * published as `title: 'ownership'`.
 */
const dataset = DatasetSchema.parse({
  name: 'ownership',
  label: { en: 'Ownership', 'zh-CN': '归属' },
  object: 'opportunity',
  include: [],
  dimensions: [
    { name: 'owner', field: 'owner_id', type: 'string', label: { en: 'Owner', 'zh-CN': '负责人' } },
    { name: 'stage', field: 'stage', type: 'string', label: 'Stage' },
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'region', field: 'region', type: 'string', label: { 'ja-JP': '地域' } },
    { name: 'blank', field: 'blank', type: 'string', label: {} },
  ],
  measures: [
    { name: 'opp_count', aggregate: 'count', label: { en: 'Opportunities', 'zh-CN': '商机数' } },
    { name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount' },
    { name: 'bare_count', aggregate: 'count' },
  ],
});

const ALL_DIMENSIONS = ['owner', 'stage', 'lead_source', 'region', 'blank'];
const ALL_MEASURES = ['opp_count', 'total_amount', 'bare_count'];

/** Every field descriptor keyed by name, with `label` present only when written. */
function labels(fields: { name: string; label?: string }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // The wire carries a RESOLVED STRING or nothing. A map that reached this
    // point would render `[object Object]` in every consumer.
    if (f.label !== undefined) expect(typeof f.label).toBe('string');
    out[f.name] = 'label' in f && f.label !== undefined ? f.label : '(no label key)';
  }
  return out;
}

// ── the two strategies ──────────────────────────────────────────────────────

/** NativeSQLStrategy — the raw-SQL path. */
function sqlService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [
      { owner: 'usr_1', stage: 'open', lead_source: 'web', region: 'NA', blank: 'b', opp_count: 2, total_amount: 170, bare_count: 2 },
    ],
  });
}

/** ObjectQLStrategy — the aggregate-bridge path. */
function aggregateService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => {
      const groupBy = (options.groupBy ?? []) as Array<string | { field: string }>;
      const aggregations = (options.aggregations ?? []) as Array<{ alias: string }>;
      const row: Record<string, unknown> = {};
      for (const g of groupBy) row[typeof g === 'string' ? g : g.field] = 'x';
      for (const a of aggregations) row[a.alias] = 1;
      return [row];
    },
  });
}

const STRATEGIES: [string, () => AnalyticsService][] = [
  ['NativeSQLStrategy', sqlService],
  ['ObjectQLStrategy', aggregateService],
];

async function describeColumns(svc: AnalyticsService, context?: ExecutionContext) {
  const result = await svc.queryDataset(
    dataset,
    { dimensions: ALL_DIMENSIONS, measures: ALL_MEASURES },
    context,
  );
  return labels(result.fields);
}

// ── the wire ────────────────────────────────────────────────────────────────

describe.each(STRATEGIES)(
  '#6761 — dataset field labels on the wire (%s)',
  (_name, service) => {
    it('resolves an inline locale map to the REQUESTED locale (zh-CN)', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
      // The defect: both of these were absent entirely before this change.
      expect(cols.owner).toBe('负责人');
      expect(cols.opp_count).toBe('商机数');
    });

    it('resolves the same map to `en` for an English request', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'en-US' } as ExecutionContext);
      // `en-US` misses the exact tag and hits the base-language limb (`en`).
      expect(cols.owner).toBe('Owner');
      expect(cols.opp_count).toBe('Opportunities');
    });

    it('resolves a bare base language to its region-qualified sibling (`zh` → `zh-CN`)', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh' } as ExecutionContext);
      // Neither `zh` (limb 2) nor an exact `zh` key (limb 1) exists; limb 3
      // takes the first region-qualified sibling sharing the base.
      expect(cols.owner).toBe('负责人');
      expect(cols.opp_count).toBe('商机数');
    });

    it('leaves a plain-string label exactly as authored', async () => {
      const zh = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
      const en = await describeColumns(service(), { tenantId: 'org_A', locale: 'en' } as ExecutionContext);
      // A string is already the answer — the locale cannot change it.
      expect(zh.stage).toBe('Stage');
      expect(zh.total_amount).toBe('Total Amount');
      expect(en.stage).toBe('Stage');
      expect(en.total_amount).toBe('Total Amount');
    });

    it('invents no `label` key when the dataset declares none', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
      // Not `null`, not `''`, not the machine name — the key is simply absent,
      // exactly as before this change.
      expect(cols.lead_source).toBe('(no label key)');
      expect(cols.bare_count).toBe('(no label key)');
    });

    it('writes nothing when the map itself resolves to nothing (empty map)', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
      // The one in-contract input on which every limb misses. A placeholder
      // here would permanently pre-empt any later label under the downstream
      // `if (f.label == null)` guard (#5199 route A).
      expect(cols.blank).toBe('(no label key)');
    });

    it('follows the shipped resolver\'s last-resort limb for a map missing the requested locale', async () => {
      const cols = await describeColumns(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
      // `{ 'ja-JP': '地域' }` under `zh-CN` misses limbs 1–5 (exact, base,
      // regional sibling, `default`, `en`) and lands on limb 6: any string in
      // the map, in key insertion order. This asserts `resolveI18nLabel`'s
      // documented rule ("a label in the wrong language still beats a column
      // with no header"), not a locally invented preference.
      expect(cols.region).toBe('地域');
    });

    it('falls back to the platform source language when the request states no locale', async () => {
      // Anonymous requests skip localization, so `context.locale` is undefined.
      // The resolver documents nullish as "no locale known" ⇒ `en`; this
      // service passes it through rather than choosing its own default.
      const noLocale = await describeColumns(service(), { tenantId: 'org_A' } as ExecutionContext);
      const noContext = await describeColumns(service());
      expect(noLocale.owner).toBe('Owner');
      expect(noLocale.opp_count).toBe('Opportunities');
      expect(noContext.owner).toBe('Owner');
      expect(noContext.opp_count).toBe('Opportunities');
    });
  },
);

// ── the `/analytics/meta` face ──────────────────────────────────────────────

describe('#6761 — /analytics/meta no longer publishes the machine name as a display title', () => {
  /** `getMeta` reduced to `{ name → title }` for the one cube under test. */
  async function meta(svc: AnalyticsService) {
    const [cube] = await svc.getMeta('ownership');
    const titles: Record<string, unknown> = { '(cube)': cube.title };
    for (const m of cube.measures) titles[m.name] = m.title;
    for (const d of cube.dimensions) titles[d.name] = d.title;
    return titles;
  }

  it('publishes the resolved label, not the machine name, for a map-labelled cube/dimension/measure', async () => {
    const svc = sqlService();
    svc.registerDataset(dataset);
    const titles = await meta(svc);
    // Before: 'ownership' / 'owner' / 'opp_count' — the machine names, published
    // as display titles by `typeof … === 'string' ? … : d.name`.
    expect(titles['(cube)']).toBe('Ownership');
    expect(titles['ownership.owner']).toBe('Owner');
    expect(titles['ownership.opp_count']).toBe('Opportunities');
  });

  it('leaves plain-string labels and the no-label machine-name fallback unchanged', async () => {
    const svc = sqlService();
    svc.registerDataset(dataset);
    const titles = await meta(svc);
    expect(titles['ownership.stage']).toBe('Stage');
    expect(titles['ownership.total_amount']).toBe('Total Amount');
    // `Metric.label` / `Dimension.label` are REQUIRED strings in the Cube
    // schema, so an unresolvable label must still produce one. The machine name
    // is what this compiler already wrote, and it stays — the map case is the
    // only one that moves.
    expect(titles['ownership.lead_source']).toBe('lead_source');
    expect(titles['ownership.bare_count']).toBe('bare_count');
    expect(titles['ownership.blank']).toBe('blank');
  });

  it('stays request-independent — a zh-CN query does not leak its locale into the registry', async () => {
    const svc = sqlService();
    // `queryDataset` re-registers the cube on every call. If the compiler baked
    // the request locale in, this Chinese query would leave a Chinese-labelled
    // cube behind and `/analytics/meta` — which takes no execution context at
    // all — would answer whoever queried last.
    await svc.queryDataset(
      dataset,
      { dimensions: ALL_DIMENSIONS, measures: ALL_MEASURES },
      { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext,
    );
    const titles = await meta(svc);
    expect(titles['(cube)']).toBe('Ownership');
    expect(titles['ownership.owner']).toBe('Owner');
    expect(titles['ownership.opp_count']).toBe('Opportunities');
  });
});
