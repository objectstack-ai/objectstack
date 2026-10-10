// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22491] A `type: 'chart'` list view binds a dataset — at every list-view
 * door, judged on the view's EFFECTIVE binding.
 *
 * Before (measured on `origin/main` @ `e148ca98`): the flattened overlay member
 * (`PUT /api/v1/meta/view`, the Studio / MCP / AI write door) accepted
 * `type: 'chart'` with no `chart` block, and accepted an `options.chart` bag
 * holding only `chartType`; the two authoring doors (`ListViewSchema`,
 * `ObjectListViewSchema` — what `defineStack` / `os validate` judge) accepted
 * the block-less view too. Only a DECLARED `chart` block was held to its
 * required `dataset` and `values`.
 *
 * The effective binding is the renderer's: the `chart` block, else the
 * `options.chart` bag, the block replacing the bag whole — see
 * `checkListViewChartBinding`'s docblock for the objectui line it mirrors.
 *
 * Refusal pins assert the issue `code`, its path and the message's FIRST
 * sentence (the verdict); the HTTP envelope (`422 INVALID_METADATA`) is pinned
 * at the real door in `packages/rest/src/meta-view-chart-binding.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ListViewSchema,
  ObjectListViewSchema,
  ListChartConfigSchema,
  ViewMetadataSchema,
} from './view.zod';

type Parse = (body: Record<string, unknown>) => z.ZodSafeParseResult<unknown>;

const OVERLAY_IDENTITY = { name: 'crm_lead.revenue_chart', object: 'crm_lead', viewKind: 'list' } as const;

/** The three list-view doors, the overlay through the union the write door runs. */
const doors: ReadonlyArray<readonly [string, Parse]> = [
  ['ListViewSchema', (body) => ListViewSchema.safeParse(body)],
  ['ObjectListViewSchema', (body) => ObjectListViewSchema.safeParse(body)],
  ['flattened overlay (PUT /api/v1/meta/view)', (body) => ViewMetadataSchema.safeParse({ ...OVERLAY_IDENTITY, ...body })],
];

const overlay: Parse = (body) => ViewMetadataSchema.safeParse({ ...OVERLAY_IDENTITY, ...body });

const BINDING = { chartType: 'bar', dataset: 'lead_metrics', dimensions: ['stage'], values: ['amount_sum'] } as const;

const NO_BLOCK_VERDICT =
  "This list view is `type: 'chart'` but declares no `chart` block, so it binds no dataset and there is nothing to plot.";
const bagVerdict = (missing: string): string =>
  "This list view is `type: 'chart'` and its only chart binding is the legacy `options.chart` bag, "
  + `which names no ${missing}, so there is nothing to plot.`;

/** Every issue, nested union arms included — a shape failure on the overlay is wrapped one level down. */
const flatten = (issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue[] =>
  issues.flatMap((i) => {
    const nested = (i as unknown as { errors?: z.core.$ZodIssue[][] }).errors;
    return i.code === 'invalid_union' && Array.isArray(nested) ? [i, ...flatten(nested.flat())] : [i];
  });

const issuesOf = (r: z.ZodSafeParseResult<unknown>): z.core.$ZodIssue[] =>
  (r.success ? [] : flatten(r.error.issues));

const at = (r: z.ZodSafeParseResult<unknown>, path: string) =>
  issuesOf(r).filter((i) => i.path.map(String).join('.') === path);

const firstSentence = (message: string): string => message.slice(0, message.indexOf('. ') + 1);

describe.each(doors)("%s — a `type: 'chart'` list view binds a dataset", (_door, parse) => {
  it("REFUSES `type: 'chart'` with no `chart` block, at `chart`, naming the block's required keys", () => {
    const r = parse({ type: 'chart', columns: ['stage', 'amount'] });
    expect(r.success).toBe(false);
    const hits = at(r, 'chart');
    expect(hits, JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(hits[0]!.code).toBe('custom');
    expect(firstSentence(hits[0]!.message)).toBe(NO_BLOCK_VERDICT);
    // The remedy is the top-level block, spelled with both required keys.
    expect(hits[0]!.message).toContain("`chart: { dataset: '<dataset_name>', values: ['<measure_name>'] }`");
  });

  it('ACCEPTS a chart view whose `chart` block names a dataset and a measure — the lit control', () => {
    const r = parse({ type: 'chart', columns: ['stage', 'amount'], chart: BINDING });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect((r as { data: { chart?: unknown } }).data.chart).toEqual(BINDING);
  });

  it("leaves a declared `chart` block to its own schema — `chart.dataset` / `chart.values`, and no second issue at `chart`", () => {
    const r = parse({ type: 'chart', columns: ['stage'], chart: { chartType: 'line' } });
    expect(r.success).toBe(false);
    expect(at(r, 'chart.dataset'), JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(at(r, 'chart.values'), JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(at(r, 'chart')).toEqual([]);
  });

  it('does not judge a view of another type — a block-less grid still parses', () => {
    expect(parse({ type: 'grid', columns: ['name'] }).success).toBe(true);
  });

  // ⚠️ Scope: a view that only OFFERS a chart. objectui's switcher gate asks
  // the same binding resolver and never offers an unbound chart, so this view
  // renders as the grid it is — a degrade, not a dead screen.
  it("does not judge a grid that lists 'chart' in `allowedVisualizations` without a block", () => {
    const r = parse({ type: 'grid', columns: ['name'], appearance: { allowedVisualizations: ['grid', 'chart'] } });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

describe("the overlay's legacy `options.chart` bag — the binding when no `chart` block replaces it", () => {
  it('REFUSES a bag holding only `chartType`, at `options.chart.dataset` and `options.chart.values`', () => {
    const r = overlay({ type: 'chart', columns: ['stage'], options: { chart: { chartType: 'bar' } } });
    expect(r.success).toBe(false);
    const dataset = at(r, 'options.chart.dataset');
    const values = at(r, 'options.chart.values');
    expect(dataset, JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(values, JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(dataset[0]!.code).toBe('custom');
    expect(values[0]!.code).toBe('custom');
    expect(firstSentence(dataset[0]!.message)).toBe(bagVerdict('`dataset`'));
    expect(firstSentence(values[0]!.message)).toBe(bagVerdict('measure in `values`'));
    expect(dataset[0]!.message).toContain("`chart: { dataset: '<dataset_name>', values: ['<measure_name>'] }`");
  });

  it('REFUSES a bag naming a dataset but no measure, at `options.chart.values` only', () => {
    const r = overlay({ type: 'chart', columns: ['stage'], options: { chart: { dataset: 'lead_metrics' } } });
    expect(r.success).toBe(false);
    expect(at(r, 'options.chart.values'), JSON.stringify(issuesOf(r))).toHaveLength(1);
    expect(at(r, 'options.chart.dataset')).toEqual([]);
  });

  it('ACCEPTS a bag that carries the whole binding, and keeps it', () => {
    const r = overlay({ type: 'chart', columns: ['stage'], options: { chart: BINDING } });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    expect((r as { data: { options?: unknown } }).data.options).toEqual({ chart: BINDING });
  });

  it('ACCEPTS an incomplete bag under a complete `chart` block — the block replaces the bag whole', () => {
    const r = overlay({ type: 'chart', columns: ['stage'], chart: BINDING, options: { chart: { chartType: 'line' } } });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  // A body that names no `type` is a PATCH on the view it shadows (the console's
  // toolbar save), whose own binding decides — the overlay member reads `type`
  // on the input side for exactly this line.
  it('does not judge a patch that names no `type`', () => {
    const r = overlay({ options: { chart: { chartType: 'line' } } });
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });

  // The check hand-lists the binding keys for its messages. Derive the block's
  // REQUIRED keys from the schema itself, so a key the block starts requiring
  // that the check does not ask of the bag goes red here.
  it("asks of the bag exactly what `ListChartConfigSchema` requires of the block", () => {
    const shape = (ListChartConfigSchema as unknown as { shape: Record<string, z.ZodType> }).shape;
    const required = Object.keys(shape).filter((key) => !shape[key]!.safeParse(undefined).success);
    expect(required.sort()).toEqual(['dataset', 'values']);
    for (const key of required) {
      const bag: Record<string, unknown> = { ...BINDING };
      delete bag[key];
      const r = overlay({ type: 'chart', columns: ['stage'], options: { chart: bag } });
      expect(at(r, `options.chart.${key}`), `${key}: ${JSON.stringify(issuesOf(r))}`).toHaveLength(1);
    }
  });
});
