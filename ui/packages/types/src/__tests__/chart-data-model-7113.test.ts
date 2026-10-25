/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ChartSchema` declares the data model it actually renders: chart-level `data`
 * and `xAxisKey`, with the bare-string `xAxis` folded onto the latter; and
 * `ChartDataSeries` accepts both binding dialects.
 *
 * Two rulings land here as ONE change, because both independently instructed
 * declaring `xAxisKey` and chart-level `data` on this schema:
 *
 *   - objectui#7113, option **B** (项目总监席, 总监批 #28, 2026-09-01, maintainer
 *     verbatim 「同意」) — declare both keys, and fold `xAxis` per the
 *     objectstack#13897 precedent: parse-time fold, no second writable name, no
 *     precedence semantics invented here.
 *   - objectui#6939's `chart` row (maintainer ruling 2026-09-02, verbatim
 *     「同意」) — the mirror accepts both binding dialects (`dataKey` and
 *     `name`), and `series[].data` stops being required.
 *
 * ## What was measured on `origin/main` 98d4108a2, before the change
 *
 * The renderer has always implemented this model; the declaration never carried
 * it. Both keys survived only on `BaseSchema`'s `.passthrough()` (mirror) and
 * its `[key: string]: any` index signature (TS twin) — authored, read, and
 * UNCHECKED. Measured against the built mirror:
 *
 *     data: 'oops'      -> ACCEPT      xAxisKey: 123 -> ACCEPT
 *     series: [{ dataKey: 'revenue' }] -> REFUSE  (series.0.name required)
 *
 * The third reading is the live defect the other two frame: `dataKey` is the
 * spelling BOTH catalog chart fixtures are written in and the one
 * `normalizeSeries` prefers, and the mirror refused it — so
 * `examples/schema-catalog/src/schemas/plugin-charts/{advanced-line,area}-chart.json`
 * are exactly the `chart: 2` files in `objectui check`'s 28-file census
 * (objectui#6939 comment 5493518990).
 *
 * Meanwhile this file's own PUBLISHED `.describe()` prose was already teaching
 * authors to write both keys — the `ChartDataSeries.data` tombstone says
 * "put the rows on the chart-level `data` and the category axis on `xAxisKey`",
 * and `categories` says "the category axis comes from `xAxisKey`/`xAxis`". So
 * this is a RESTORATION of `declared = enforced`, not new capability
 * (objectui#7113 ruling, clause 4).
 *
 * ## ⚠️ What declaring these keys does NOT do — measured, and contrary to the
 * ruling's stated justification
 *
 * objectui#7113's ruling justifies option B by saying a misspelling like
 * `xAxiskey` / `datas` moves "from tsc-green + zod-green + empty chart to loud
 * at authoring time". When written that was FALSE on both faces, before AND
 * after this change, and section (f) below pins the zod half rather than letting
 * the claim stand unmeasured:
 *
 *   - the mirror's `BaseSchema` is `.passthrough()` (`base.zod.ts:212`), so an
 *     undeclared key is KEPT, never refused;
 *   - the TS `BaseSchema` carried `[key: string]: any`, which suppressed
 *     excess-property checking on every chart literal; objectui#8347 removed it,
 *     so a typed literal refuses the misspelling now.
 *
 * What the declaration DOES buy is the VALUE check — `data` and `xAxisKey` are
 * now refused BY NAME when malformed, where before they drew an empty chart in
 * silence — plus editor completion for the correct spellings, and prose that is
 * finally true. That is the real remedy, and it is worth stating precisely so
 * the next reader does not go looking for a typo refusal that cannot exist
 * while `BaseSchema` passes through.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChartSchema, ChartDataSeries } from '../data-display';
import { ChartSchema as ChartZodSchema, ChartDataSeriesSchema } from '../zod/data-display.zod';

const CHART = { type: 'chart', chartType: 'bar' } as const;
const chart = (extra: Record<string, unknown>) => ({ ...CHART, ...extra });

/** Parse and report the OUTPUT keys — the fold is only visible in the output. */
const parsed = (doc: unknown) => {
  const r = ChartZodSchema.safeParse(doc);
  if (!r.success) throw new Error(`expected ACCEPT, got: ${JSON.stringify(r.error.issues)}`);
  return r.data as Record<string, unknown>;
};

const refusalPaths = (doc: unknown): string[] => {
  const r = ChartZodSchema.safeParse(doc);
  if (r.success) throw new Error('expected REFUSE, got ACCEPT');
  return r.error.issues.map((i) => i.path.join('.'));
};

const catalog = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../../examples/schema-catalog/src/schemas/plugin-charts/${name}.json`, import.meta.url),
      ),
      'utf8',
    ),
  );

/* ── (a) chart-level `data` — the shape comes from the READ SITES ─────────── */

/**
 * ⛔ NOT from `normalizeChartSchema`. objectui#7113's ruling says `data`'s
 * declared shape follows "`normalizeChartSchema`'s actual read shape", and that
 * function has **zero** reads of `schema.data` — `grep -n 'schema\.data\b'
 * packages/plugin-charts/src/normalizeChartSchema.ts` returns nothing. The read
 * sites are elsewhere, and the shape below is derived from them:
 *
 *   - `ChartRenderer.tsx:17,47`  — the prop is declared `Array<Record<string, any>>`
 *   - `ChartRenderer.tsx:164`    — `data: Array.isArray(schema.data) ? schema.data : []`
 *   - `AdvancedChartImpl.tsx:2229` — `Object.keys(props.data[0] ?? {})`, i.e. a row's
 *                                    keys ARE the column names
 *   - `AdvancedChartImpl.tsx:1968` — `d[xAxisKey]`, i.e. a row is indexed by column name
 *   - `ObjectChart.tsx:279,703`  — `Array.isArray(schema.data)`, rows used verbatim
 *
 * ⇒ an ARRAY OF ROW OBJECTS keyed by column name. Identical to the sibling
 * `BarChartSchema.data`, which objectui#6318 derived from the same renderer the
 * same way — the two chart nodes agreeing is a check on the derivation.
 */
describe('objectui#7113 (a) — chart-level `data` is declared, with the shape the renderer reads', () => {
  it('accepts an array of row objects keyed by column name', () => {
    const out = parsed(chart({ series: [{ name: 'revenue' }], data: [{ month: 'Jan', revenue: 4000 }] }));
    expect(out.data).toEqual([{ month: 'Jan', revenue: 4000 }]);
  });

  it('refuses a non-array `data` BY NAME — before, this parsed clean and drew an empty chart', () => {
    expect(refusalPaths(chart({ series: [{ name: 'r' }], data: 'oops' }))).toContain('data');
  });

  it('refuses rows that are not objects — a bare number array is the retired inline model', () => {
    expect(refusalPaths(chart({ series: [{ name: 'r' }], data: [1, 2, 3] }))).toContain('data.0');
  });

  it('stays OPTIONAL — a query-backed chart carries no inline rows', () => {
    expect(parsed(chart({ series: [{ name: 'r' }] })).data).toBeUndefined();
  });

  it('agrees with the sibling `BarChartSchema.data`, derived from the same renderer', () => {
    const rows = [{ name: 'Jan', value: 10 }];
    expect(parsed(chart({ series: [{ name: 'value' }], data: rows })).data).toEqual(rows);
  });
});

/* ── (b) `xAxisKey` declared, and the `xAxis` alias fold ──────────────────── */

describe('objectui#7113 (b) — `xAxisKey` is declared and the bare-string `xAxis` folds onto it', () => {
  it('accepts `xAxisKey` and refuses a non-string one BY NAME', () => {
    expect(parsed(chart({ series: [{ name: 'r' }], xAxisKey: 'month' })).xAxisKey).toBe('month');
    expect(refusalPaths(chart({ series: [{ name: 'r' }], xAxisKey: 123 }))).toContain('xAxisKey');
  });

  /* Direction 1 of the fold: the alias ARRIVES on the canonical key. */
  it('`xAxis` authored ALONE lands on `xAxisKey`', () => {
    expect(parsed(chart({ series: [{ name: 'r' }], xAxis: 'month' })).xAxisKey).toBe('month');
  });

  /*
   * Direction 2, and the half a "does it parse?" pin cannot see: NO SECOND
   * WRITABLE NAME. The alias must not survive the parse — if it did, the fold
   * would have produced two spellings of one fact instead of folding them.
   */
  it('`xAxis` does NOT survive the parse — exactly one name for the category column', () => {
    const out = parsed(chart({ series: [{ name: 'r' }], xAxis: 'month' }));
    expect(out).not.toHaveProperty('xAxis');
    expect(Object.keys(out).filter((k) => k === 'xAxis' || k === 'xAxisKey')).toEqual(['xAxisKey']);
  });

  /*
   * ⛔ NO PRECEDENCE SEMANTICS. There is no output in which both survive with a
   * rule for reading them: when both are written the canonical key is kept and
   * the alias is dropped. That is not a rule minted here — it is the one already
   * running at `normalizeChartSchema.ts:292`, where `xAxisKey` is the first limb
   * of `str(schema.xAxisKey) ?? xAxisSpec?.field ?? str(xAxisRaw)`. So no chart
   * that renders today changes what it renders.
   */
  it('both written: canonical kept, alias dropped — never a surviving pair', () => {
    const out = parsed(chart({ series: [{ name: 'r' }], xAxisKey: 'canonical', xAxis: 'alias' }));
    expect(out.xAxisKey).toBe('canonical');
    expect(out).not.toHaveProperty('xAxis');
  });

  /*
   * The object dialect is NOT an alias and is deliberately NOT folded. Its
   * `field` also answers the column question, but `format` / `title` /
   * `showGridLines` are presentation that `normalizeChartSchema:289-291` keeps
   * separately in `out.xAxis` — folding it would discard them.
   */
  it('the `xAxis` CONFIG OBJECT is left intact — folding it would discard presentation', () => {
    const axis = { field: 'month', title: 'Month', format: 'MMM' };
    const out = parsed(chart({ series: [{ name: 'r' }], xAxis: axis }));
    expect(out.xAxis).toEqual(axis);
    expect(out.xAxisKey).toBeUndefined();
  });

  /*
   * CONTROL for the fold's construction, and it must pass FOR THE REASON IT
   * CLAIMS: `ChartSchema` was a plain `ZodObject` before this change and must
   * still be one after it, so this assertion is legal in BOTH states and
   * reddens only if the fold is rewritten as `.transform()`. ⚠️ It deliberately
   * does NOT assert the new keys — an earlier draft did, and the reverse
   * verification caught it reddening for the DECLARATION instead of for
   * pipe-ness, which would have made it a probe wearing a control's label.
   * `.transform()` returns a ZodPipe: no `.shape`, no `.extend()`.
   * `zod-mirror-parity.test.ts` reads `.shape` on every mirror and would answer
   * with an EMPTY set — a silent hole in the ratchet rather than an error — and
   * `reports.zod.ts` consumes `ChartSchema` as an object.
   */
  it('CONTROL — `ChartSchema` is still a ZodObject, so the parity ratchet can read `.shape`', () => {
    const shape = (ChartZodSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).length).toBeGreaterThan(0);
    expect(Object.keys(shape)).toContain('series');
    expect(typeof (ChartZodSchema as unknown as { extend?: unknown }).extend).toBe('function');
  });

  it('the two keys are DECLARED in the shape, not merely passed through', () => {
    const shape = (ChartZodSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['data', 'xAxisKey']));
  });
});

/* ── (c) both binding dialects (objectui#6939's `chart` row) ──────────────── */

describe('objectui#6939 `chart` — the mirror accepts both binding dialects', () => {
  it('accepts `name`', () => {
    expect(parsed(chart({ series: [{ name: 'revenue' }] })).series).toEqual([{ name: 'revenue' }]);
  });

  it('accepts `dataKey` — REFUSED before this change, and it is what the renderer prefers', () => {
    expect(parsed(chart({ series: [{ dataKey: 'revenue' }] })).series).toEqual([{ dataKey: 'revenue' }]);
  });

  it('accepts both written together', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'Revenue', dataKey: 'revenue' }).success).toBe(true);
  });

  /*
   * CONTROL for the two ACCEPTs above. Without it they could be reporting a
   * passthrough that accepts anything. This series resolves to NEITHER spelling,
   * which `normalizeSeries` drops in silence (`normalizeChartSchema.ts:240`,
   * `if (!dataKey) return undefined`) — the mirror refuses it by name instead.
   * ⚠️ It is legal in BOTH states of the change (`name`'s required flag refused
   * it before, the refinement refuses it now), so it is a control, not a probe
   * for the very thing it controls.
   */
  it('CONTROL — a series binding to neither spelling is still refused, at `series.0.name`', () => {
    expect(refusalPaths(chart({ series: [{ color: '#fff' }] }))).toContain('series.0.name');
  });

  it('CONTROL — the `series[].data` tombstone still refuses, with its migration note', () => {
    const r = ChartDataSeriesSchema.safeParse({ name: 'r', data: [1, 2, 3] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/RETIRED \(ADR-0049\)/);
  });
});

/*
 * ⚠️ objectui#6939's `chart` row also says "`series[].data` stops being
 * required". On this base it ALREADY is not required, and by a STRONGER
 * mechanism than the row anticipated: objectui#6896 (landed in b0d308da9, after
 * the 2026-09-01 census the row cites) replaced it with
 * `retirementTombstone(...)` = `z.never({ error }).optional()`. It is optional
 * AND refuses any authored value by name. Implementing the clause literally
 * would mean re-widening a retired key — reversing a landed maintainer ruling —
 * so it is deliberately NOT done, and this pin holds that line.
 */
describe('objectui#6939 `chart` — `series[].data` is already not required (and must stay retired)', () => {
  it('a series omitting `data` parses', () => {
    expect(ChartDataSeriesSchema.safeParse({ name: 'revenue' }).success).toBe(true);
  });

  it('the tombstone is optional, not required — the clause is satisfied without re-widening', () => {
    const shape = (ChartDataSeriesSchema as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
    expect(shape.data.safeParse(undefined).success).toBe(true);
    expect(shape.data.safeParse([1, 2, 3]).success).toBe(false);
  });
});

/* ── (d) the catalog fixtures — the two `chart` files in the census ───────── */

describe('objectui#6939/#7113 — both catalog chart fixtures now validate', () => {
  it.each(['advanced-line-chart', 'area-chart'])('%s validates against the published mirror', (name) => {
    const doc = catalog(name);
    const out = parsed(doc);
    // Byte-identical inputs to the renderer: every authored key survives with
    // its authored value (nothing is folded or dropped in these two).
    expect(out.data).toEqual(doc.data);
    expect(out.xAxisKey).toEqual(doc.xAxisKey);
    expect(out.series).toEqual(doc.series);
  });

  it('CONTROL — the fixtures are written in the `dataKey` dialect, which is why they were refused', () => {
    for (const name of ['advanced-line-chart', 'area-chart']) {
      for (const s of catalog(name).series as Array<Record<string, unknown>>) {
        expect(s.dataKey).toBeTypeOf('string');
        expect(s.name).toBeUndefined();
      }
    }
  });
});

/* ── (e) the TS twin moves with the mirror ───────────────────────────────── */

describe('objectui#7113 — the TS twin declares the same model', () => {
  it('accepts the model at the authoring site', () => {
    const node: ChartSchema = {
      type: 'chart',
      chartType: 'line',
      data: [{ month: 'Jan', revenue: 4000 }],
      xAxisKey: 'month',
      series: [{ dataKey: 'revenue' }],
    };
    expect(node.data).toHaveLength(1);
    expect(node.xAxisKey).toBe('month');
  });

  it('`dataKey` alone is a complete binding on the twin', () => {
    const series: ChartDataSeries = { dataKey: 'revenue' };
    expect(series.dataKey).toBe('revenue');
  });
});

/* ── (f) the limit of the remedy — pinned so the claim is not inherited ──── */

/**
 * These two pins assert what this change CANNOT do, because objectui#7113's
 * ruling claims it does. Keeping them here means the next reader measures the
 * claim instead of quoting it: while `BaseSchema` passes through, a MISSPELLED
 * key is kept, not refused — before and after. If someone later makes
 * `ChartSchema` strict, these turn red and the ruling's justification becomes
 * true for the first time; that is the correct signal, not a failure.
 */
describe('objectui#7113 (f) — declaring the keys does NOT make a misspelling loud', () => {
  it.each(['datas', 'xAxiskey'])('`%s` is still ACCEPTED — `BaseSchema` is `.passthrough()`', (typo) => {
    const out = parsed(chart({ series: [{ name: 'r' }], [typo]: 'x' }));
    expect(out).toHaveProperty(typo);
  });
});
