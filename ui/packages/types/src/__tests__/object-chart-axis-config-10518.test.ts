/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10518 — `ObjectChartSchema.xAxis` / `ObjectChartSchema.yAxis`
 * DECLARE the spec's axis config — ONE object on `xAxis`, a LIST on `yAxis`
 * (ruling 5809510046, branch 2 — declare), the `object-chart` sibling of
 * objectui#7690, whose pin for the `chart` node is
 * `chart-axis-config-7690.test.ts`.
 *
 * ## The protocol answered first
 *
 * `@objectstack/spec/ui` declares both keys on this very node: the
 * `REACT_BLOCKS` entry for the `ObjectChart` react block carries
 * `schemaType: 'object-chart'` and `schema: ChartConfigSchema`, and lists
 * `xAxis` / `yAxis` among its `dataProps`; `ChartConfigSchema.xAxis` is ONE
 * `ChartAxisSchema` and `ChartConfigSchema.yAxis` an ARRAY of them. Blocks (a)
 * and (f) read that off the installed spec rather than writing it down here.
 *
 * ## `xAxis` is the object ONLY (seat decision on objectui#10518, option A)
 *
 * No string arm and no fold onto `xAxisKey`: objectui#7113's bare-string alias
 * is `ChartSchema`'s alone, and the spec's `ChartConfigSchema.xAxis` has no
 * string arm. A bare column name and a list are refused with the `{ field }`
 * remedy. The renderer's own tolerance of a bare string is untouched and stays
 * pinned where it lives (`ObjectChart.absentCategoryAxisRefusal-8168.test.tsx`).
 *
 * ## The defect (measured on the branch point before the change)
 *
 * Neither key was declared on either face, so both rode `BaseSchema`'s
 * `.passthrough()` — KEPT, read by the renderer, and UNCHECKED:
 * `yAxis: [{ field: 'n', stepSize: 'big' }]`, `xAxis: { field: 'n', min: 'zero' }`,
 * keys the spec only names as aliases, a single `yAxis` object and a bare
 * `xAxis` string all parsed green. The shape pins in (a) and (f) and every
 * refusal in (c), (d), (h) and (i) are red on that tree; the PR records the run.
 *
 * ## The lit controls are the real producers
 *
 * `yAxis`: the objectstack showcase command-center page builds its
 * dataset-bound charts through one helper that writes
 * `yAxis: [{ field: values[0], stepSize: 1 }]` inside the node's `properties`
 * bag. `SchemaRenderer` hoists that bag onto the node, so the node below is the
 * shape the mirror judges — flattened, with the helper's own keys.
 * `xAxis`: the showcase `renewals-pipeline` page writes `xAxis={{ field }}` and
 * `yAxis={[{ field, format }]}` on the `ObjectChart` react block. Both parse on
 * the branch point and on this change alike: the declarations narrow nothing
 * those producers write.
 *
 * ## How refusals are asserted
 *
 * By issue `code` and `path`. Where a message is asserted, it is compared
 * against the SPEC's own message for the same axis, read off the spec schema in
 * the same test — never against a string written here. The one exception is
 * the `xAxis` remedy, whose wording (`xAxis: { field`) IS the contract the seat
 * decision asked for.
 */

import { describe, it, expect } from 'vitest';
import {
  ChartAxisSchema as SpecChartAxisSchema,
  ChartConfigSchema as SpecChartConfigSchema,
  REACT_BLOCKS,
  type ChartAxis as SpecChartAxis,
} from '@objectstack/spec/ui';
import type { ObjectChartSchema } from '../objectql';
import { ObjectChartSchema as ObjectChartMirror } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';

const CHART = { type: 'object-chart', chartType: 'bar' } as const;
const chart = (extra: Record<string, unknown>) => ({ ...CHART, ...extra });
/**
 * The AUTHORED spelling of `chart(extra)` (objectui#11276): an authored
 * `object-chart` takes its props in the `properties` bag, and the public door
 * judges that arm, so every `safeValidateSchema` row below hands it this. The
 * mirror rows keep `chart(extra)`, the node as `ObjectChart` reads it.
 */
const authored = (extra: Record<string, unknown>) => ({ type: 'object-chart', properties: { chartType: 'bar', ...extra } });

const parsed = (doc: unknown) => {
  const r = ObjectChartMirror.safeParse(doc);
  if (!r.success) throw new Error(`expected ACCEPT, got: ${JSON.stringify(r.error.issues)}`);
  return r.data as Record<string, unknown>;
};

const issues = (doc: unknown) => {
  const r = ObjectChartMirror.safeParse(doc);
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
  field: 'task_count',
  title: { en: 'Tasks', 'zh-CN': '任务' },
  format: '0,0',
  min: 0,
  max: 100,
  stepSize: 1,
  showGridLines: false,
  position: 'left',
  logarithmic: false,
};

/**
 * The showcase command-center producer's node, flattened as `SchemaRenderer`
 * hoists `properties` — the `chart()` helper with its `integerYAxis` flag on.
 */
const SHOWCASE_NODE = {
  id: 'cc_status_c',
  type: 'object-chart',
  responsiveStyles: { large: { width: '100%', minWidth: '0' } },
  dataset: 'showcase_task_metrics',
  dimensions: ['status'],
  values: ['task_count'],
  chartType: 'bar',
  colors: ['hsl(192 86% 46%)', 'hsl(256 72% 62%)'],
  yAxis: [{ field: 'task_count', stepSize: 1 }],
} as const;

/** The same producer node as the producer WRITES it — its props in the bag (objectui#11276). */
const SHOWCASE_AUTHORED = (() => {
  const { id, type, responsiveStyles, ...props } = SHOWCASE_NODE;
  return { id, type, responsiveStyles, properties: props };
})();

type Shape = Record<string, unknown>;
const mirrorShape = (ObjectChartMirror as unknown as { shape: Shape }).shape;

/* ── Type-level pin (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `Equal`, not `extends`: an UNDECLARED member read `any` through
 * `BaseSchema`'s index signature until objectui#8347, and a one-way check
 * accepts `any` — which is precisely the before-state.
 */
export type assertionYAxisIsTheSpecList = Expect<Equal<ObjectChartSchema['yAxis'], SpecChartAxis[] | undefined>>;
/** `xAxis` is the spec's ONE object — not a string, not a list, not `any`. */
export type assertionXAxisIsTheSpecObject = Expect<Equal<ObjectChartSchema['xAxis'], SpecChartAxis | undefined>>;
/** The helper can FAIL — synthetic control (an undeclared key reads `any`). */
export type assertionEqualCanFail = Expect<Equal<Equal<any, SpecChartAxis[] | undefined>, false>>;

/* ── (a) the declaration IS the spec's ───────────────────────────────────── */

describe('objectui#10518 (a) — `yAxis` is declared, with the spec axis list', () => {
  it('the spec declares `yAxis` on the `object-chart` react block, as `ChartConfigSchema`\'s list', () => {
    const block = REACT_BLOCKS.find((b) => b.schemaType === 'object-chart');
    expect(block, 'no REACT_BLOCKS entry for object-chart in the installed spec').toBeDefined();
    expect(block!.schema).toBe(SpecChartConfigSchema);
    expect(block!.dataProps).toContain('yAxis');
    // The list arm, read off the spec: one entry parses, a bare object is
    // refused AT `yAxis` (the spec's config needs its own `type`, so it is given).
    expect(SpecChartConfigSchema.safeParse({ type: 'bar', yAxis: [{ field: 'n' }] }).success).toBe(true);
    const single = SpecChartConfigSchema.safeParse({ type: 'bar', yAxis: { field: 'n' } });
    expect(single.success).toBe(false);
    expect(single.error!.issues.map((i) => i.path)).toEqual([['yAxis']]);
  });

  it('`yAxis` is in the mirror\'s own shape — declared, not passed through', () => {
    expect(Object.keys(mirrorShape)).toContain('yAxis');
  });

  it('the sample below covers exactly the spec\'s axis keys (read off the installed spec)', () => {
    expect(Object.keys(FULL_AXIS).sort()).toEqual(SPEC_AXIS_KEYS);
  });

  it('every spec axis key is accepted on a `yAxis` entry, and the value survives unchanged', () => {
    const second = { ...FULL_AXIS, position: 'right' };
    expect(parsed(chart({ yAxis: [FULL_AXIS, second] })).yAxis).toEqual([FULL_AXIS, second]);
  });

  /*
   * The spec gives `showGridLines` and `logarithmic` a `.default()`. Referenced
   * raw, a parse would WRITE both into the output. The CONTROL is the spec
   * schema itself, which does inject — so the equality is a reading of
   * `stripImportedDefaults`, not an accident.
   */
  it('omitted keys stay omitted — the spec defaults are not written into the output', () => {
    expect(parsed(chart({ yAxis: [{ field: 'task_count' }] })).yAxis).toEqual([{ field: 'task_count' }]);
  });

  it('CONTROL — the spec schema referenced raw DOES inject its defaults', () => {
    expect(SpecChartAxisSchema.parse({ field: 'task_count' })).toEqual({
      field: 'task_count',
      showGridLines: true,
      logarithmic: false,
    });
  });
});

/* ── (b) the lit control: the real producer ──────────────────────────────── */

describe('objectui#10518 (b) — LIT CONTROL: the showcase producer\'s node parses, unchanged', () => {
  it('on the mirror, with `yAxis` exactly as written', () => {
    expect(parsed(SHOWCASE_NODE).yAxis).toEqual([{ field: 'task_count', stepSize: 1 }]);
  });

  it('through `safeValidateSchema`, the tolerant face', () => {
    expect(safeValidateSchema(SHOWCASE_AUTHORED).success).toBe(true);
  });
});

/* ── (c) values and keys are CHECKED now ─────────────────────────────────── */

describe('objectui#10518 (c) — a malformed `yAxis` entry is refused at its own path', () => {
  it.each([
    ['a non-number `stepSize`', { field: 'task_count', stepSize: 'big' }, ['yAxis', 0, 'stepSize'], 'invalid_type'],
    ['a `position` outside the four', { field: 'task_count', position: 'middle' }, ['yAxis', 0, 'position'], 'invalid_value'],
    ['an undeclared key the spec names an alias of (`logScale`)', { field: 'task_count', logScale: true }, ['yAxis', 0], 'unrecognized_keys'],
    ['a missing `field` — the spec requires it', { stepSize: 1 }, ['yAxis', 0, 'field'], 'invalid_type'],
  ])('%s', (_label, axis, path, code) => {
    const [issue] = issues(chart({ yAxis: [axis] }));
    expect(issue!.code).toBe(code);
    expect(issue!.path).toEqual(path);
    expect(issue!.message).toBe(specMessage(axis));
  });

  it('the refusal reaches the public door — `safeValidateSchema` refuses the node', () => {
    expect(safeValidateSchema(authored({ yAxis: [{ field: 'task_count', stepSize: 'big' }] })).success).toBe(false);
  });

  /* CONTROL for every refusal above: the same documents minus the defect parse. */
  it('CONTROL — the same entries, minus the defect, are accepted', () => {
    expect(() => parsed(chart({ yAxis: [{ field: 'task_count', stepSize: 2 }] }))).not.toThrow();
    expect(() => parsed(chart({ yAxis: [{ field: 'task_count', position: 'right', logarithmic: true }] }))).not.toThrow();
    expect(safeValidateSchema(authored({ yAxis: [{ field: 'task_count', stepSize: 2 }] })).success).toBe(true);
  });
});

/* ── (d) `yAxis` is the spec's LIST — the two other shapes the normalizer tolerates are not members ── */

describe('objectui#10518 (d) — `yAxis` is the spec array, and only that', () => {
  it.each([
    ['a single axis object', { field: 'task_count', stepSize: 1 }],
    ['a bare column name', 'task_count'],
  ])('%s is refused at `yAxis` with `invalid_type`', (_label, yAxis) => {
    const [issue] = issues(chart({ yAxis }));
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['yAxis']);
  });

  it('CONTROL — the same axis as a one-entry list parses', () => {
    expect(parsed(chart({ yAxis: [{ field: 'task_count', stepSize: 1 }] })).yAxis).toEqual([
      { field: 'task_count', stepSize: 1 },
    ]);
  });
});

/* ── (e) the TS twin carries the same contract ───────────────────────────── */

describe('objectui#10518 (e) — the TS twin types `yAxis` with the spec\'s `ChartAxis[]`', () => {
  it('accepts the spec shape at the authoring site', () => {
    const axis: SpecChartAxis = { field: 'task_count', stepSize: 1, title: { en: 'Tasks', 'zh-CN': '任务' } };
    const node: ObjectChartSchema = {
      type: 'object-chart',
      chartType: 'bar',
      dataset: 'showcase_task_metrics',
      dimensions: ['status'],
      values: ['task_count'],
      yAxis: [axis, { field: 'task_count', position: 'right' }],
    };
    expect(node.yAxis).toHaveLength(2);
  });

  it('refuses what the mirror refuses — checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const`: a readonly literal would fail every line below for a
    // reason of its own, and each `@ts-expect-error` would pass without testing.
    const base = { type: 'object-chart' as const, chartType: 'bar' as const };
    const refused: ObjectChartSchema[] = [
      // @ts-expect-error — `yAxis` is the spec's LIST, not a single axis object
      { ...base, yAxis: { field: 'task_count' } },
      // @ts-expect-error — `yAxis` is the spec's LIST, not a bare column name
      { ...base, yAxis: 'task_count' },
      // @ts-expect-error — `stepSize` is a number
      { ...base, yAxis: [{ field: 'task_count', stepSize: 'big' }] },
      // @ts-expect-error — `field` is required on a spec axis object
      { ...base, yAxis: [{ stepSize: 1 }] },
    ];
    expect(refused).toHaveLength(4);
  });
});

/* ══ `xAxis` — the spec's ONE axis object, and only that ══════════════════ */

/** The showcase `renewals-pipeline` producer's axis props and binding, on this node. */
const RENEWALS_AXES = {
  objectName: 'showcase_invoice',
  aggregate: { field: 'total', function: 'sum', groupBy: 'status' },
  xAxis: { field: 'status' },
  yAxis: [{ field: 'total', format: '$0,0' }],
} as const;

/** The remedy's own spelling — the contract the seat decision named. */
const X_AXIS_REMEDY = 'xAxis: { field';

/* ── (f) the declaration IS the spec's ───────────────────────────────────── */

describe('objectui#10518 (f) — `xAxis` is declared, with the spec axis object', () => {
  it('the spec declares `xAxis` on the `object-chart` react block, as `ChartConfigSchema`\'s ONE object', () => {
    const block = REACT_BLOCKS.find((b) => b.schemaType === 'object-chart');
    expect(block!.dataProps).toContain('xAxis');
    // The object arm, read off the spec: an object parses, a bare string and a
    // list are refused AT `xAxis` — the spec's config has no string arm.
    expect(SpecChartConfigSchema.safeParse({ type: 'bar', xAxis: { field: 'n' } }).success).toBe(true);
    for (const xAxis of ['n', [{ field: 'n' }]]) {
      const r = SpecChartConfigSchema.safeParse({ type: 'bar', xAxis });
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path)).toEqual([['xAxis']]);
    }
  });

  it('`xAxis` is in the mirror\'s own shape — declared, not passed through', () => {
    expect(Object.keys(mirrorShape)).toContain('xAxis');
  });

  it('every spec axis key is accepted on `xAxis`, and the value survives unchanged', () => {
    const axis = { ...FULL_AXIS, field: 'status', position: 'bottom' };
    expect(parsed(chart({ xAxis: axis })).xAxis).toEqual(axis);
  });

  it('omitted keys stay omitted — the spec defaults are not written into the output', () => {
    expect(parsed(chart({ xAxis: { field: 'status' } })).xAxis).toEqual({ field: 'status' });
  });

  it('NOT folded — the object survives the parse, and no `xAxisKey` is minted from it', () => {
    const out = parsed(chart({ xAxis: { field: 'status', title: 'Status' } }));
    expect(out.xAxis).toEqual({ field: 'status', title: 'Status' });
    expect(out).not.toHaveProperty('xAxisKey');
  });
});

/* ── (g) the lit control: the real producer ──────────────────────────────── */

describe('objectui#10518 (g) — LIT CONTROL: the showcase `renewals-pipeline` axes parse, unchanged', () => {
  it('on the mirror, with `xAxis` / `yAxis` exactly as written', () => {
    const out = parsed(chart(RENEWALS_AXES));
    expect(out.xAxis).toEqual({ field: 'status' });
    expect(out.yAxis).toEqual([{ field: 'total', format: '$0,0' }]);
  });

  it('through `safeValidateSchema`, the tolerant face', () => {
    expect(safeValidateSchema(authored(RENEWALS_AXES)).success).toBe(true);
  });
});

/* ── (h) values and keys inside the object are CHECKED now ───────────────── */

describe('objectui#10518 (h) — a malformed `xAxis` object is refused at `xAxis`, carrying the spec\'s own diagnostic', () => {
  it.each([
    ['a non-number `min`', { field: 'status', min: 'zero' }],
    ['a `position` outside the four', { field: 'status', position: 'middle' }],
    ['an undeclared key the spec names an alias of (`grid`)', { field: 'status', grid: true }],
    ['a missing `field` — the spec requires it', { title: 'Status' }],
  ])('%s', (_label, axis) => {
    const [issue] = issues(chart({ xAxis: axis }));
    expect(issue!.code).toBe('invalid_union');
    expect(issue!.path).toEqual(['xAxis']);
    expect(issue!.message).toContain(specMessage(axis));
  });

  it('the refusal reaches the public door — `safeValidateSchema` refuses the node', () => {
    expect(safeValidateSchema(authored({ xAxis: { field: 'status', min: 'zero' } })).success).toBe(false);
  });

  /* CONTROL for every refusal above: the same objects, minus the defect, parse. */
  it('CONTROL — the same objects, minus the defect, are accepted', () => {
    expect(() => parsed(chart({ xAxis: { field: 'status', min: 0, position: 'bottom', showGridLines: true } }))).not.toThrow();
    expect(() => parsed(chart({ xAxis: { field: 'status', title: 'Status' } }))).not.toThrow();
  });
});

/* ── (i) a bare string and a list are refused, with the remedy ───────────── */

describe('objectui#10518 (i) — `xAxis` is the spec object, and only that', () => {
  it.each([
    ['a bare column name', 'status'],
    ['a list of axis objects', [{ field: 'status' }]],
    ['a number', 42],
  ])('%s is refused at `xAxis`, naming the `{ field }` remedy', (_label, xAxis) => {
    const [issue] = issues(chart({ xAxis }));
    expect(issue!.code).toBe('invalid_union');
    expect(issue!.path).toEqual(['xAxis']);
    expect(issue!.message).toContain(X_AXIS_REMEDY);
  });

  it('the bare string is refused at the public door too', () => {
    expect(safeValidateSchema(authored({ xAxis: 'status' })).success).toBe(false);
  });

  it('CONTROL — the same column as the spec object parses, and a malformed OBJECT is not told the remedy', () => {
    expect(parsed(chart({ xAxis: { field: 'status' } })).xAxis).toEqual({ field: 'status' });
    const [issue] = issues(chart({ xAxis: { field: 'status', min: 'zero' } }));
    expect(issue!.message).not.toContain(X_AXIS_REMEDY);
  });
});

/* ── (j) the TS twin carries the same contract ───────────────────────────── */

describe('objectui#10518 (j) — the TS twin types `xAxis` with the spec\'s ONE `ChartAxis`', () => {
  it('accepts the spec shape at the authoring site', () => {
    const node: ObjectChartSchema = {
      type: 'object-chart',
      chartType: 'bar',
      objectName: 'showcase_invoice',
      aggregate: { field: 'total', function: 'sum', groupBy: 'status' },
      xAxis: { field: 'status', title: { en: 'Status', 'zh-CN': '状态' } },
      yAxis: [{ field: 'total', format: '$0,0' }],
    };
    expect(node.xAxis?.field).toBe('status');
  });

  it('refuses what the mirror refuses — checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const`, for the reason block (e) gives.
    const base = { type: 'object-chart' as const, chartType: 'bar' as const };
    const refused: ObjectChartSchema[] = [
      // @ts-expect-error — `xAxis` is the spec's axis OBJECT, not a bare column name
      { ...base, xAxis: 'status' },
      // @ts-expect-error — `xAxis` is ONE axis object, not a list
      { ...base, xAxis: [{ field: 'status' }] },
      // @ts-expect-error — `field` is required on a spec axis object
      { ...base, xAxis: { title: 'Status' } },
      // @ts-expect-error — `min` is a number
      { ...base, xAxis: { field: 'status', min: 'zero' } },
    ];
    expect(refused).toHaveLength(4);
  });
});
