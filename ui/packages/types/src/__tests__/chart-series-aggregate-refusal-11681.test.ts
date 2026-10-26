/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11681 — `aggregate` on a chart series is renderer-internal, and the
 * authoring face refuses it BY NAME.
 *
 * The chart reads a series' `aggregate` (the dataset answer's
 * `fields[].aggregate`, carried by `buildChartSeries`) and a value axis whose
 * series all plot a count draws whole-number ticks. An author must not be able
 * to claim that: `aggregate: 'count'` on a currency sum would strip the
 * decimals its axis needs. `ChartDataSeriesSchema` is NON-STRICT, so an
 * undeclared key was stripped in silence while the raw node still reached the
 * renderer; the key is now declared and unwritable on both faces — the zod
 * mirror refuses it, and the TS twin types it `?: never`.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { ChartDataSeries } from '../data-display';
import { ChartDataSeriesSchema, ChartSchema } from '../zod/data-display.zod';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type Issue = { code: string; path: string; message: string };
type Parser = {
  safeParse: (v: unknown) =>
    | { success: true }
    | { success: false; error: { issues: Array<{ code: string; path: PropertyKey[]; message: string }> } };
};
const issuesOf = (schema: Parser, input: unknown): Issue[] | null => {
  const r = schema.safeParse(input);
  return r.success
    ? null
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));
};

const NODE = { type: 'chart', chartType: 'bar', series: [{ name: 'task_count' }] } as const;

describe('objectui#11681 — an authored series `aggregate` is refused by name', () => {
  it.each(['count', 'count_distinct', 'sum'])('`aggregate: %j` refuses with one `invalid_type` issue at `aggregate`', (value) => {
    const issues = issuesOf(ChartDataSeriesSchema, { name: 'task_count', aggregate: value });
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: 'aggregate' });
    expect(issues![0].message).toContain('objectui#11681');
  });

  it('CONTROL — the same series without the key parses', () => {
    expect(issuesOf(ChartDataSeriesSchema, { name: 'task_count' })).toBeNull();
  });

  it('the chart node carries the refusal to its series path', () => {
    expect(issuesOf(ChartSchema, NODE), 'the control node must parse, or the refusal below measures nothing').toBeNull();
    const issues = issuesOf(ChartSchema, { ...NODE, series: [{ name: 'task_count', aggregate: 'count' }] });
    expect(issues?.map((i) => i.path)).toEqual(['series.0.aggregate']);
  });
});

describe('objectui#11681 — the two faces agree: `aggregate` is unwritable on both', () => {
  it('the zod arm\'s input type is exactly `undefined`, and the TS twin declares `never`', () => {
    type ArmInput = z.input<typeof ChartDataSeriesSchema>['aggregate'];
    const zodArmIsUndefined: Eq<ArmInput, undefined> = true;
    const tsTwinIsNever: Eq<ChartDataSeries['aggregate'], undefined> = true;
    expect(zodArmIsUndefined && tsTwinIsNever).toBe(true);
  });

  it('a typed literal refuses it at the authoring site', () => {
    // @ts-expect-error — `aggregate` is `?: never` on the authoring face.
    const authored: ChartDataSeries = { name: 'task_count', aggregate: 'count' };
    expect(authored.name).toBe('task_count');
  });
});
