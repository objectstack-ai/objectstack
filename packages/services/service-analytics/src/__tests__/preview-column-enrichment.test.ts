// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16097 — a draft-preview dataset response must describe its COLUMNS the same
 * way the live response does.
 *
 * `AnalyticsService.queryDataset` has an ADR-0037 P3 branch: when the request
 * renders the as-if-published world and the base object has a PENDING seed
 * draft, the selection is evaluated over the seed rows in memory and returned
 * immediately. Measured on `main` @ `7d7ca6c0c` (after #16101 landed in this
 * same file and moved both line numbers the card quoted), that early `return`
 * sat at `analytics-service.ts:1115` and the ADR-0021 result-column enrichment
 * began at `:1367` — ~250 lines it could never reach.
 *
 * ## What that cost, driven rather than read
 *
 * One dataset, one row set, two services differing ONLY in whether a pending
 * seed exists — so the only thing that can differ between the two responses is
 * the enrichment. Before this change:
 *
 * ```
 * live    {"name":"total_amount","type":"number","label":"Total Amount","format":"$0,0","currency":"EUR"}
 * preview {"name":"total_amount","type":"number"}
 * live    {"name":"avg_margin","type":"number","label":"Avg Margin","format":"0.0%","percentScale":"whole"}
 * preview {"name":"avg_margin","type":"number"}
 * live    {"name":"expense_count","type":"number","builtinAggregate":"count"}
 * preview {"name":"expense_count","type":"number"}
 * live    {"name":"latest_spend","type":"time","label":"Latest Spend"}
 * preview {"name":"latest_spend","type":"number"}
 * live    {"name":"category","type":"string","label":"Category"}
 * preview {"name":"category","type":"string"}
 * ```
 *
 * A renderer then falls back to humanizing the raw measure name and guessing a
 * percent scale from magnitude — the failures #5537, objectui#3136 and #14492
 * each closed on the live path — and it does so only because a pending seed
 * draft exists, a state that has nothing to do with how a column is described.
 *
 * ## Per-key: why each one is answerable over a seed row set
 *
 * Every key asserted here is read off the DATASET (the authored measure or
 * dimension) and `sourceFieldMeta` (the source object's declared field
 * metadata). None is read off `rows`, which is the whole reason one seam can
 * serve both paths:
 *
 * | key                | resolved from                                   |
 * |:-------------------|:------------------------------------------------|
 * | `label`            | `measure.label` / `dimension.label` + `ctx.locale` (#6761) |
 * | `format`           | `measure.format`                                 |
 * | `builtinAggregate` | `measure.aggregate` + `measure.label == null` (#14492) |
 * | `currency`         | ADR-0053 chain: `measure.currency` → `sourceFieldMeta().defaultCurrency` → `ctx.currency` |
 * | `percentScale`     | `measure.derived.op === 'ratio'`, else `percentScaleOf(sourceFieldMeta())` (objectui#3136) |
 * | `type`             | `measureResultType(measure.aggregate, sourceFieldMeta().type)` (#16101) |
 *
 * The two chains that reach OUTSIDE the measure are pinned deliberately: the
 * currency chain's `ExecutionContext` limb and its `sourceFieldMeta` limb both
 * have a case below, because "the block is self-contained" was an assumption
 * worth measuring rather than believing.
 *
 * ## ⛔ What stays skipped, and why that is not the same question
 *
 * Dimension VALUE label resolution — turning a stored lookup id into the
 * related record's display name — remains skipped on the preview path, and the
 * last describe block pins it: `fetchRecordLabels` is not called at all there.
 * Drafted seed rows reference lookups by NAME (the seed convention), so there is
 * no id to resolve and the value already reads well. That reasoning is about ROW
 * VALUES; it never covered COLUMN descriptors, which come from the authored
 * measure and which no property of the seed rows can supply.
 *
 * ## Known-divergent and deliberately NOT asserted
 *
 * Two preview/live differences survive this change because they are produced
 * BEFORE any enrichment, by `evaluateAnalyticsQueryOverRows` (`preview-
 * evaluator.ts`), and no descriptor pass can reach them. They are filed
 * separately rather than pinned here, so that fixing them does not have to red
 * this file:
 *
 *   - a time dimension's `fields[].type` is minted `'string'` on preview and
 *     `'time'` on live (`evaluateAnalyticsQueryOverRows` mints every dimension
 *     as `'string'`);
 *   - `min`/`max` over a non-numeric field returns `0` on preview
 *     (`aggregate()` coerces with `Number()` and drops non-finite values), so
 *     `latest_spend` is `0` there and `'2026-05-12'` on live.
 *
 * The second one meets this card at exactly one point: `latest_spend` is now
 * correctly described as `type: 'time'` on BOTH paths, which is what its
 * authored `max` over a `date` field means, while the preview VALUE beside it
 * stays wrong until the evaluator is fixed. The descriptor is not withheld to
 * accommodate a producer defect — that would be a consumer-side `??` in
 * descriptor form (Prime Directive #12), and it would make the response's
 * account of the column depend on a bug.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Deleting the `enrichResultColumns(previewResult, …)` call from the preview
 * branch must turn RED every `preview` assertion below and leave every `live`
 * assertion GREEN. Ordinary direction, no inversion: the change ADDS descriptor
 * keys that were absent, narrows no rule and removes no limb, so nothing
 * downstream can gain a finding from it. The dimension-value-label block is
 * predicted GREEN under that mutation too — it pins what the preview path does
 * NOT do, which the mutation does not change.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import type { DimensionLabelDeps, FieldMetaLite } from '../dimension-labels.js';

// ── one fixture, two paths ──────────────────────────────────────────────────

interface Expense extends Record<string, unknown> {
  amount: number;
  fee: number;
  margin: number;
  category: string;
  vendor: string;
  spent_on: string;
}

/**
 * `vendor` is a LOOKUP carrying the SEED convention: the drafted row references
 * the related record by NAME (`Acme Air`), not by the FK id the live table
 * stores. That is the fixture the standing skip is about.
 */
const ROWS: Expense[] = [
  { amount: 1200, fee: 30, margin: 40, category: 'travel', vendor: 'Acme Air', spent_on: '2026-05-03' },
  { amount: 800, fee: 20, margin: 20, category: 'travel', vendor: 'Acme Air', spent_on: '2026-05-12' },
  { amount: 60, fee: 5, margin: 10, category: 'meals', vendor: 'Bistro Ltd', spent_on: '2026-06-01' },
];

const DATASET = DatasetSchema.parse({
  name: 'expense_ds',
  label: 'Expense',
  object: 'expense',
  dimensions: [
    { name: 'category', field: 'category', type: 'string', label: 'Category' },
  ],
  measures: [
    // aggregate + NO label ⇒ `builtinAggregate`, and no invented header.
    { name: 'expense_count', aggregate: 'count' },
    // label + format + the currency chain's `sourceFieldMeta` limb.
    { name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount', format: '$0,0' },
    // the currency chain's ExecutionContext limb (no measure currency, no
    // field default) — the limb that lives furthest from the measure.
    { name: 'total_fee', aggregate: 'sum', field: 'fee', label: 'Total Fee' },
    // percentScale from the source field (`percent`, max 100 ⇒ 'whole').
    { name: 'avg_margin', aggregate: 'avg', field: 'margin', label: 'Avg Margin', format: '0.0%' },
    // percentScale from the measure shape (`ratio` ⇒ 'fraction').
    { name: 'amount_per_item', derived: { op: 'ratio', of: ['total_amount', 'expense_count'] }, label: 'Per Item', format: '0.0%' },
    // #16101 — `max` over a `date` field is temporal, not a number.
    { name: 'latest_spend', aggregate: 'max', field: 'spent_on', label: 'Latest Spend' },
  ],
});

/** The `vendor` variant, used only by the dimension-value-label block. */
const VENDOR_DATASET = DatasetSchema.parse({
  name: 'expense_by_vendor',
  label: 'Expense by Vendor',
  object: 'expense',
  dimensions: [{ name: 'vendor', field: 'vendor', type: 'lookup', label: 'Vendor' }],
  measures: [{ name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount' }],
});

const sourceFieldMeta = (object: string, field: string) => {
  if (object !== 'expense') return undefined;
  if (field === 'amount') return { type: 'currency', defaultCurrency: 'EUR' };
  if (field === 'fee') return { type: 'currency' };
  if (field === 'margin') return { type: 'percent', max: 100 };
  if (field === 'spent_on') return { type: 'date' };
  return undefined;
};

const FIELDS: Record<string, Record<string, FieldMetaLite>> = {
  expense: { vendor: { type: 'lookup', reference: 'crm_account' } },
  crm_account: { name: { type: 'text' } },
};

const CTX = { tenantId: 'org_A', currency: 'USD' } as ExecutionContext;

/** Enough of a GROUP BY for this fixture — the LIVE path's engine. */
function evaluateAggregate(opts: { groupBy?: unknown; aggregations?: unknown }) {
  const groupBy = (opts.groupBy ?? []) as Array<string | { field: string }>;
  const aggs = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const buckets = new Map<string, { key: Record<string, unknown>; rows: Expense[] }>();
  for (const r of ROWS) {
    const key: Record<string, unknown> = {};
    for (const g of groupBy) {
      const f = typeof g === 'string' ? g : g.field;
      key[f] = r[f];
    }
    const id = JSON.stringify(Object.values(key));
    let b = buckets.get(id);
    if (!b) { b = { key, rows: [] }; buckets.set(id, b); }
    b.rows.push(r);
  }
  return [...buckets.values()].map(({ key, rows }) => {
    const row: Record<string, unknown> = { ...key };
    for (const a of aggs) {
      const vals = rows.map((r) => r[a.field]);
      const sorted = vals.map(String).sort();
      row[a.alias] =
        a.method === 'sum' ? vals.reduce((s: number, v) => s + Number(v ?? 0), 0)
          : a.method === 'avg' ? vals.reduce((s: number, v) => s + Number(v ?? 0), 0) / rows.length
            : a.method === 'max' ? sorted[sorted.length - 1]
              : rows.length;
    }
    return row;
  });
}

/**
 * The two services differ in exactly one config key. Everything else — the
 * dataset, the rows, the field metadata, the ExecutionContext — is shared, so a
 * difference in the response is a difference the preview branch caused.
 */
function svc(opts: { preview: boolean; labels?: DimensionLabelDeps } = { preview: false }) {
  return new AnalyticsService({
    sourceFieldMeta,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => evaluateAggregate(options),
    ...(opts.labels ? { labelResolver: opts.labels } : {}),
    ...(opts.preview ? { draftRowsResolver: async () => ROWS as Record<string, unknown>[] } : {}),
  });
}

const SELECTION = {
  dimensions: ['category'],
  measures: ['expense_count', 'total_amount', 'total_fee', 'avg_margin', 'amount_per_item', 'latest_spend'],
};

type Field = Awaited<ReturnType<AnalyticsService['queryDataset']>>['fields'][number];

async function bothPaths() {
  const live = await svc({ preview: false }).queryDataset(DATASET, SELECTION, CTX);
  const preview = await svc({ preview: true }).queryDataset(DATASET, SELECTION, CTX, { previewDrafts: true });
  const by = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.name, f]));
  return { live: by(live.fields), preview: by(preview.fields) };
}

/** The six keys the card tabulates, absent ones dropped so they read as absent. */
function descriptor(f: Field | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['label', 'format', 'currency', 'percentScale', 'builtinAggregate', 'type'] as const) {
    const v = (f as Record<string, unknown> | undefined)?.[k];
    if (v != null) out[k] = v;
  }
  return out;
}

describe('#16097 — a preview response describes its measure columns like the live one', () => {
  it('carries every measure descriptor the live path carries, key for key', async () => {
    const { live, preview } = await bothPaths();
    for (const name of ['expense_count', 'total_amount', 'total_fee', 'avg_margin', 'amount_per_item', 'latest_spend']) {
      expect(descriptor(preview[name]), `measure "${name}"`).toEqual(descriptor(live[name]));
    }
  });

  it('label — the authored measure label, on both paths', async () => {
    const { live, preview } = await bothPaths();
    expect(live.total_amount.label).toBe('Total Amount');
    expect(preview.total_amount.label).toBe('Total Amount');
  });

  it('format — the authored measure format, on both paths', async () => {
    const { live, preview } = await bothPaths();
    expect(live.total_amount.format).toBe('$0,0');
    expect(preview.total_amount.format).toBe('$0,0');
  });

  it('builtinAggregate (#14492) — present exactly where the measure has no authored label', async () => {
    const { live, preview } = await bothPaths();
    expect(live.expense_count.builtinAggregate).toBe('count');
    expect(preview.expense_count.builtinAggregate).toBe('count');
    // …and the enrichment still invents no header for it, on either path.
    expect(live.expense_count.label).toBeUndefined();
    expect(preview.expense_count.label).toBeUndefined();
    // An authored label keeps its text and gets no discriminator.
    expect(preview.total_amount.builtinAggregate).toBeUndefined();
  });

  it('currency (ADR-0053) — the sourceFieldMeta limb resolves on the preview path', async () => {
    const { live, preview } = await bothPaths();
    expect(live.total_amount.currency).toBe('EUR');
    expect(preview.total_amount.currency).toBe('EUR');
  });

  it('currency (ADR-0053) — the ExecutionContext limb reaches the preview path too', async () => {
    const { live, preview } = await bothPaths();
    // No measure currency, no field default ⇒ the tenant default on `ctx`.
    expect(live.total_fee.currency).toBe('USD');
    expect(preview.total_fee.currency).toBe('USD');
    // A non-monetary measure never acquires one, on either path.
    expect(preview.avg_margin.currency).toBeUndefined();
    expect(preview.expense_count.currency).toBeUndefined();
  });

  it('percentScale (objectui#3136) — both limbs resolve on the preview path', async () => {
    const { live, preview } = await bothPaths();
    expect(live.avg_margin.percentScale).toBe('whole');       // from the percent field's max
    expect(preview.avg_margin.percentScale).toBe('whole');
    expect(live.amount_per_item.percentScale).toBe('fraction'); // from `derived.op === 'ratio'`
    expect(preview.amount_per_item.percentScale).toBe('fraction');
  });

  it('type (#16101) — a `max` over a date field is temporal on the preview path too', async () => {
    const { live, preview } = await bothPaths();
    expect(live.latest_spend.type).toBe('time');
    expect(preview.latest_spend.type).toBe('time');
    // Every other measure keeps the `number` its producer minted.
    expect(preview.total_amount.type).toBe('number');
    expect(preview.expense_count.type).toBe('number');
  });

  it('resolves the label through the #6761 i18n map with the REQUEST locale', async () => {
    const localized = DatasetSchema.parse({
      ...DATASET,
      name: 'expense_localized',
      measures: [{ name: 'total_amount', aggregate: 'sum', field: 'amount', label: { en: 'Total Amount', 'zh-CN': '总金额' } }],
    });
    const selection = { dimensions: ['category'], measures: ['total_amount'] };
    const zh = { ...CTX, locale: 'zh-CN' } as ExecutionContext;
    const preview = await svc({ preview: true }).queryDataset(localized, selection, zh, { previewDrafts: true });
    const live = await svc({ preview: false }).queryDataset(localized, selection, zh);
    expect(live.fields.find((f) => f.name === 'total_amount')?.label).toBe('总金额');
    expect(preview.fields.find((f) => f.name === 'total_amount')?.label).toBe('总金额');
  });
});

describe('#16097 — dimension COLUMN headers, same authored source, same answer', () => {
  it('gives the grouped column its authored header on both paths', async () => {
    const { live, preview } = await bothPaths();
    expect(live.category.label).toBe('Category');
    expect(preview.category.label).toBe('Category');
  });
});

describe('⛔ the fence: dimension VALUE label resolution stays skipped on preview', () => {
  it('resolves the lookup value on the live path and leaves the seed name alone on preview', async () => {
    const fetchRecordLabels = vi.fn(async (_t: string, ids: unknown[]) => {
      const m = new Map<unknown, string>();
      for (const id of ids) m.set(id, `Resolved(${String(id)})`);
      return m;
    });
    const labels: DimensionLabelDeps = { getObjectFields: (o) => FIELDS[o], fetchRecordLabels };

    const selection = { dimensions: ['vendor'], measures: ['total_amount'] };
    const live = await svc({ preview: false, labels }).queryDataset(VENDOR_DATASET, selection, CTX);
    const liveCalls = fetchRecordLabels.mock.calls.length;
    expect(liveCalls).toBeGreaterThan(0);
    expect(live.rows.map((r) => r.vendor)).toContain('Resolved(Acme Air)');

    fetchRecordLabels.mockClear();
    const preview = await svc({ preview: true, labels })
      .queryDataset(VENDOR_DATASET, selection, CTX, { previewDrafts: true });
    // The row value is the seed's own name, untouched — and NOTHING was fetched.
    expect(preview.rows.map((r) => r.vendor).sort()).toEqual(['Acme Air', 'Bistro Ltd']);
    expect(fetchRecordLabels).not.toHaveBeenCalled();
  });

  it('but the preview still describes that dimension COLUMN — the two are different questions', async () => {
    const labels: DimensionLabelDeps = {
      getObjectFields: (o) => FIELDS[o],
      fetchRecordLabels: async () => new Map(),
    };
    const preview = await svc({ preview: true, labels }).queryDataset(
      VENDOR_DATASET,
      { dimensions: ['vendor'], measures: ['total_amount'] },
      CTX,
      { previewDrafts: true },
    );
    expect(preview.fields.find((f) => f.name === 'vendor')?.label).toBe('Vendor');
    expect(preview.fields.find((f) => f.name === 'total_amount')?.label).toBe('Total Amount');
  });
});
