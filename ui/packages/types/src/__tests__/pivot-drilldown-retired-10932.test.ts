/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `drillDown` on the bare `pivot` node is REFUSED, on both
 * faces (objectui#10932, triage grade: retire behind a measured premise).
 *
 * ## The failure this pin exists to prevent
 *
 * `PivotTableSchema` declared `drillDown` as the shared `DrillDownConfig`, and
 * the zod `pivot` arm (objectui#10859, batch 2) accepted it, so `objectui
 * validate` passed a `pivot` node carrying a drill. Nothing honoured it:
 * `PivotTable` fired a drill only when its HOST passed an `onDrillDown`
 * handler, and the one host that does is `ObjectPivotTable`, which renders
 * `object-pivot`. The `pivot` registration hands the node to `PivotTable` bare.
 * So an author (or an AI) wrote a drill, validation accepted it, and clicking a
 * cell did nothing, with no signal: declared, not enforced.
 *
 * The premise measured before retiring: no shipped or example document, in
 * this repository or in objectstack's, authors `drillDown` on a `pivot` node,
 * and `DashboardGridLayout`'s static-data pivot never writes one of its own.
 * The readings, with their positive controls, are on the pull request.
 *
 * ## What is NOT pinned here
 *
 * `object-pivot`'s `drillDown` (`ObjectPivotDrillDownConfig`) is untouched and
 * still drills. It has no zod arm, so it is not a `safeParse` control; its
 * pins live in `@object-ui/plugin-dashboard`: the prop type in
 * `ObjectPivotTable.drillDownRefusal-10685.test.tsx` (the `live` accept
 * control) and the drawer opening in `drillRefusal-10789.test.tsx`.
 *
 * ## Two instruments
 *
 * The `Expect` / `Equal` rows and the `@ts-expect-error` line are judged by
 * `tsc -p tsconfig.test.json` (the third leg of this package's `type-check`);
 * vitest strips types and judges the `describe` blocks.
 */

import { describe, expect, it } from 'vitest';
import { PivotTableSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import type { PivotTableSchema as Ts_PivotTableSchema } from '../data-display';

/* ── The TypeScript face: `?: never` ─────────────────────────────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `?: never` reads as `undefined`. A deletion read as `any` (the `BaseSchema`
 * index signature) until objectui#8347 and fails to compile now, and the old member as `DrillDownConfig | undefined`.
 */
export type assertionPivotDrillDownIsATombstone = Expect<Equal<Ts_PivotTableSchema['drillDown'], undefined>>;
/** Non-vacuity twin: a member the node does read keeps its real type. */
export type assertionPivotTitleStaysLive = Expect<Equal<Ts_PivotTableSchema['title'], string | undefined>>;

const MINIMAL = {
  type: 'pivot',
  rowField: 'region',
  columnField: 'quarter',
  valueField: 'revenue',
  data: [{ region: 'EU', quarter: 'Q1', revenue: 10 }],
} as const;

const WITH_DRILL = { ...MINIMAL, drillDown: { enabled: true, target: 'drawer', title: 'Revenue records' } };

describe('`drillDown` on a `pivot` node is a tombstone on the TypeScript face (objectui#10932)', () => {
  it('authoring it is a compile error; the same node without it compiles', () => {
    const accepted: Ts_PivotTableSchema = { ...MINIMAL, data: [...MINIMAL.data] };
    const refused: Ts_PivotTableSchema = {
      ...MINIMAL,
      data: [...MINIMAL.data],
      // @ts-expect-error `drillDown` is retired on `pivot` (objectui#10932) — author `object-pivot` to drill
      drillDown: { enabled: true },
    };
    expect([accepted.type, refused.type]).toEqual(['pivot', 'pivot']);
  });
});

/* ── The zod face: `retirementTombstone()` ───────────────────────────────── */

describe('`drillDown` on a `pivot` node is refused by the zod arm (objectui#10932)', () => {
  it('the arm refuses it at `drillDown`, `invalid_type` against `never`', () => {
    const result = PivotTableSchema.safeParse(WITH_DRILL);
    expect(result.success, 'an authored pivot drill was ACCEPTED — it validates and does nothing').toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'drillDown');
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.path).toEqual(['drillDown']);
    expect((issue as { expected?: string } | undefined)?.expected).toBe('never');
  });

  it.each([
    ['safeValidateSchema (the rendering face)', (doc: unknown) => safeValidateSchema(doc)],
    ['StrictAnyComponentSchema (the authoring face)', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
  ] as const)('%s refuses it at `drillDown` too', (_face, parse) => {
    const result = parse(WITH_DRILL);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'drillDown');
    expect(issue, JSON.stringify(result.error.issues)).toBeDefined();
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.path).toEqual(['drillDown']);
  });

  it('the refusal names the remedy, `object-pivot`, in one string on both channels', () => {
    const result = PivotTableSchema.safeParse(WITH_DRILL);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'drillDown');
    expect(issue?.message).not.toContain('Invalid input: expected never');
    expect(issue?.message).toContain('`object-pivot`');
    // `retirementTombstone()`: the parse message and the `.describe()` metadata
    // are the same string, so generated docs and the refusal cannot drift.
    expect(issue?.message).toBe((PivotTableSchema.shape.drillDown as { description?: string }).description);
  });

  it('keeps `drillDown` DECLARED on the arm: a tombstone, not a deletion', () => {
    // `BaseSchema` is `.passthrough()`: a deleted key would be kept unjudged on
    // the rendering face, the silent no-op this card closes.
    expect('drillDown' in PivotTableSchema.shape).toBe(true);
  });

  it('CONTROL — the same node without `drillDown` still parses, on the arm and on both faces', () => {
    const arm = PivotTableSchema.safeParse(MINIMAL);
    expect(arm.success, JSON.stringify(arm.success ? null : arm.error.issues)).toBe(true);
    expect(safeValidateSchema(MINIMAL).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it('the content-channel refusal no longer lists `drillDown` among what a `pivot` renders', () => {
    const result = PivotTableSchema.safeParse({ ...MINIMAL, children: [{ type: 'text', content: 'x' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'children');
    expect(issue?.message).toContain('`columnColors`'); // lit control: the list is there
    expect(issue?.message).not.toContain('`drillDown`');
  });
});
