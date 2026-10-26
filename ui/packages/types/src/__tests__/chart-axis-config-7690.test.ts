/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7690 — `ChartSchema.xAxis` / `ChartSchema.yAxis` DECLARE the spec's
 * axis config object (ruling 5809510046, branch 2 — declare).
 *
 * ## The protocol answered first
 *
 * `@objectstack/spec/ui` DECLARES the object: `ChartAxisSchema`, a strict object
 * whose keys are read below off the installed spec rather than written down
 * here, is the type of `ChartConfigSchema.xAxis` and of each entry of
 * `ChartConfigSchema.yAxis`. The chart node renders that shape — the renderer's
 * `normalizeAxis` reads the same keys, pinned from the renderer's side in
 * `plugin-charts/src/normalizeChartSchema.specAxisKeys-7690.test.ts` — so the
 * mirror references the spec schema BY REFERENCE and the TS twin takes the
 * spec's `ChartAxis` type. A retire branch would have contradicted a spec
 * declaration; the liveness read (on the card and the PR, with lit controls)
 * found real producers besides, so the two readings agree.
 *
 * ## The defect (measured on `80a0ecda9` before the change)
 *
 * Neither key was declared, so both rode `BaseSchema`'s `.passthrough()`: KEPT,
 * read by the renderer, and UNCHECKED. `xAxis: { field: 'month', min: 'zero' }`,
 * `xAxis: { field: 'month', grid: true }` and `yAxis: { field: 'total' }` all
 * parsed green. Block (b) is red on that tree; the ablation in the PR shows it.
 *
 * ## What is pinned, and how
 *
 * Refusals assert the issue `code` and `path`. Where a message is asserted, it
 * is compared against the SPEC's own message for the same input, read off the
 * spec schema in the same test — never against a string written here.
 */

import { describe, it, expect } from 'vitest';
import { ChartAxisSchema as SpecChartAxisSchema, type ChartAxis as SpecChartAxis } from '@objectstack/spec/ui';
import type { ChartSchema } from '../data-display';
import { ChartSchema as ChartZodSchema } from '../zod/data-display.zod';

const CHART = { type: 'chart', chartType: 'bar', series: [{ name: 'total' }] } as const;
const chart = (extra: Record<string, unknown>) => ({ ...CHART, ...extra });

const parsed = (doc: unknown) => {
  const r = ChartZodSchema.safeParse(doc);
  if (!r.success) throw new Error(`expected ACCEPT, got: ${JSON.stringify(r.error.issues)}`);
  return r.data as Record<string, unknown>;
};

const issues = (doc: unknown) => {
  const r = ChartZodSchema.safeParse(doc);
  if (r.success) throw new Error('expected REFUSE, got ACCEPT');
  return r.error.issues;
};

/** The spec's own first message for an axis value, read live off the spec schema. */
const specMessage = (axis: unknown): string => {
  const r = SpecChartAxisSchema.safeParse(axis);
  if (r.success) throw new Error('control: the spec accepts this axis');
  return r.error.issues[0]!.message;
};

const SPEC_AXIS_KEYS = Object.keys(SpecChartAxisSchema.shape).sort();

/** One valid value per spec axis key — a key the spec adds without a sample here fails (a) loudly. */
const FULL_AXIS: Record<string, unknown> = {
  field: 'total',
  title: { en: 'Total', 'zh-CN': '合计' },
  format: '$0,0',
  min: 0,
  max: 100,
  stepSize: 10,
  showGridLines: false,
  position: 'left',
  logarithmic: false,
};

type Shape = Record<string, { unwrap?: () => unknown }>;
const chartShape = (ChartZodSchema as unknown as { shape: Shape }).shape;

/* ── (a) the declaration IS the spec's ───────────────────────────────────── */

describe('objectui#7690 (a) — both keys are declared, with the spec axis object', () => {
  it('both keys are in the mirror\'s own shape — declared, not passed through', () => {
    expect(Object.keys(chartShape)).toEqual(expect.arrayContaining(['xAxis', 'yAxis']));
  });

  it('the sample below covers exactly the spec\'s axis keys (read off the installed spec)', () => {
    expect(Object.keys(FULL_AXIS).sort()).toEqual(SPEC_AXIS_KEYS);
  });

  it('every spec axis key is accepted on `xAxis` and on a `yAxis` entry, and the value survives unchanged', () => {
    const out = parsed(chart({ xAxis: FULL_AXIS, yAxis: [FULL_AXIS, { ...FULL_AXIS, position: 'right' }] }));
    expect(out.xAxis).toEqual(FULL_AXIS);
    expect(out.yAxis).toEqual([FULL_AXIS, { ...FULL_AXIS, position: 'right' }]);
  });

  /*
   * The spec gives `showGridLines` and `logarithmic` a `.default()`. Referenced
   * raw, a parse would WRITE both into the output, and an injected
   * `showGridLines: true` reads downstream as an authored opt-in to the x-axis
   * vertical grid. The CONTROL is the spec schema itself, which does inject —
   * so the equality is a reading of `stripImportedDefaults`, not an accident.
   */
  it('omitted keys stay omitted — the spec defaults are not written into the output', () => {
    const out = parsed(chart({ xAxis: { field: 'month' }, yAxis: [{ field: 'total' }] }));
    expect(out.xAxis).toEqual({ field: 'month' });
    expect(out.yAxis).toEqual([{ field: 'total' }]);
  });

  it('CONTROL — the spec schema referenced raw DOES inject its defaults', () => {
    expect(SpecChartAxisSchema.parse({ field: 'month' })).toEqual({
      field: 'month',
      showGridLines: true,
      logarithmic: false,
    });
  });
});

/* ── (b) values and keys are CHECKED now ─────────────────────────────────── */

describe('objectui#7690 (b) — a malformed axis is refused at parse', () => {
  it.each([
    ['a non-number `min`', { field: 'm', min: 'zero' }],
    ['a non-string `format`', { field: 'm', format: 5 }],
    ['a `position` outside the four', { field: 'm', position: 'middle' }],
    ['a non-boolean `logarithmic`', { field: 'm', logarithmic: 'yes' }],
    ['an undeclared key the spec names an alias of (`grid`)', { field: 'm', grid: true }],
    ['a missing `field` — the spec requires it', { title: 'Month' }],
  ])('`xAxis` with %s is refused at `xAxis`, carrying the spec\'s own diagnostic', (_label, axis) => {
    const [issue] = issues(chart({ xAxis: axis }));
    expect(issue!.code).toBe('invalid_union');
    expect(issue!.path).toEqual(['xAxis']);
    expect(issue!.message).toContain(specMessage(axis));
  });

  it.each([
    ['a non-number `max`', { field: 't', max: '10' }, ['yAxis', 0, 'max'], 'invalid_type'],
    ['a `position` outside the four', { field: 't', position: 'middle' }, ['yAxis', 0, 'position'], 'invalid_value'],
    ['an undeclared key the spec names an alias of (`logScale`)', { field: 't', logScale: true }, ['yAxis', 0], 'unrecognized_keys'],
    ['a missing `field`', { title: 'Total' }, ['yAxis', 0, 'field'], 'invalid_type'],
  ])('a `yAxis` entry with %s is refused at its own path', (_label, axis, path, code) => {
    const [issue] = issues(chart({ yAxis: [axis] }));
    expect(issue!.code).toBe(code);
    expect(issue!.path).toEqual(path);
    expect(issue!.message).toBe(specMessage(axis));
  });

  /* CONTROL for every refusal above: the same documents minus the defect parse. */
  it('CONTROL — the same axes, minus the defect, are accepted', () => {
    expect(() => parsed(chart({ xAxis: { field: 'm', min: 0, format: '0.0%', position: 'bottom', logarithmic: true } }))).not.toThrow();
    expect(() => parsed(chart({ yAxis: [{ field: 't', max: 10, position: 'right', title: 'Total' }] }))).not.toThrow();
  });
});

/* ── (c) `yAxis` is the spec's LIST — the two other shapes the normalizer tolerates are not members ── */

describe('objectui#7690 (c) — `yAxis` is the spec array, and only that', () => {
  it.each([
    ['a single axis object', { field: 'total' }],
    ['a bare column name', 'total'],
  ])('%s is refused at `yAxis` with `invalid_type`', (_label, yAxis) => {
    const [issue] = issues(chart({ yAxis }));
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['yAxis']);
  });

  it('CONTROL — the same axis as a one-entry list parses', () => {
    expect(parsed(chart({ yAxis: [{ field: 'total' }] })).yAxis).toEqual([{ field: 'total' }]);
  });
});

/* ── (d) the objectui#7113 fold is untouched ─────────────────────────────── */

describe('objectui#7690 (d) — the bare-string `xAxis` alias still folds onto `xAxisKey`', () => {
  it('a bare string lands on `xAxisKey` and does not survive the parse', () => {
    const out = parsed(chart({ xAxis: 'month' }));
    expect(out.xAxisKey).toBe('month');
    expect(out).not.toHaveProperty('xAxis');
  });

  it('the axis OBJECT is not folded — it survives beside `xAxisKey`', () => {
    const out = parsed(chart({ xAxisKey: 'month', xAxis: { field: 'month', title: 'Month' } }));
    expect(out.xAxisKey).toBe('month');
    expect(out.xAxis).toEqual({ field: 'month', title: 'Month' });
  });

  it('a value that is neither arm is refused at `xAxis`', () => {
    const [issue] = issues(chart({ xAxis: 42 }));
    expect(issue!.code).toBe('invalid_union');
    expect(issue!.path).toEqual(['xAxis']);
  });
});

/* ── (e) the TS twin carries the same contract ───────────────────────────── */

describe('objectui#7690 (e) — the TS twin types both keys with the spec\'s `ChartAxis`', () => {
  it('accepts the spec shape at the authoring site', () => {
    const axis: SpecChartAxis = { field: 'total', title: 'Total', min: 0, position: 'left' };
    const node: ChartSchema = {
      type: 'chart',
      chartType: 'line',
      data: [{ month: 'Jan', total: 1 }],
      series: [{ name: 'total' }],
      xAxis: { field: 'month', title: { en: 'Month', 'zh-CN': '月份' } },
      yAxis: [axis],
    };
    expect(node.yAxis).toHaveLength(1);
  });

  it('refuses what the mirror refuses — checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const`: a readonly `series` would fail every line below for a
    // reason of its own, and each `@ts-expect-error` would pass without testing.
    const base = { type: 'chart' as const, chartType: 'bar' as const, series: [{ name: 'total' }] };
    const refused: ChartSchema[] = [
      // @ts-expect-error — `yAxis` is the spec's LIST, not a single axis object
      { ...base, yAxis: { field: 'total' } },
      // @ts-expect-error — `field` is required on a spec axis object
      { ...base, xAxis: { title: 'Month' } },
      // @ts-expect-error — `position` is one of the four sides
      { ...base, yAxis: [{ field: 'total', position: 'middle' }] },
      // @ts-expect-error — `min` is a number
      { ...base, xAxis: { field: 'month', min: 'zero' } },
    ];
    expect(refused).toHaveLength(4);
  });
});
