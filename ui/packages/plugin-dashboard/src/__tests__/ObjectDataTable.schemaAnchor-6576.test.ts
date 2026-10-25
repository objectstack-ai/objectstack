/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6576 / #6914 — `ObjectDataTableProps.schema` is anchored to the
 * exported `ObjectDataTableSchema` (`extends BaseSchema`); the literal's own
 * `[key: string]: any` is gone, and the two keys the widget reads behind casts
 * (`drillDown`, `onRowClick`) are declared.
 *
 * ## Why this pin is compile-time
 *
 * Same reading as `ObjectDataTable.emitBoundary-6373.test.tsx` next door: the
 * widget renders identically before and after a type declaration, so only a
 * COMPILE can fail. `tsconfig.test.json` compiles this file.
 *
 * ## Direction of the move, stated (Clause ②)
 *
 * `ObjectDataTableProps` is NOT exported from `plugin-dashboard/src/index.tsx`
 * — it reaches consumers only structurally, as the prop type of the exported
 * component — so the breakage surface is the in-repo call sites.
 *
 *   - NARROWS: a wrong-typed base member is refused (`visible: 42` used to be
 *     absorbed by the literal's index signature); `type` is pinned to the
 *     registry key (it used to be bare `string`).
 *   - WIDENS, in declaration only: `drillDown` / `onRowClick` are now DECLARED
 *     with real types — before, they compiled through the index signature as
 *     `any`, which is why a wrong-shaped `drillDown` compiled too.
 *   - UNCHANGED then, pinned honestly: an unknown key still compiled, because
 *     `BaseSchema`'s `[key: string]: any` was inherited (objectui#5155).
 *     objectui#8347 removed it, and that row is flipped: an unknown key is
 *     refused now.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectDataTableProps } from '../ObjectDataTable';
import type { BaseSchema, ObjectDataTableDrillDownConfig, ObjectDataTableSchema } from '@object-ui/types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Schema = ObjectDataTableProps['schema'];

/** The anchor itself — invariant equality, so a second literal cannot creep back. */
export type assertionSchemaIsAnchored = Expect<Equal<Schema, ObjectDataTableSchema>>;
export type assertionSchemaExtendsBase = Expect<[Schema] extends [BaseSchema] ? true : false>;
/**
 * objectui#6914 — `Equal`, not `extends`: before the declaration both keys
 * resolved to `any` through the literal's index signature, and `any` satisfies
 * a one-way check. These were RED on the unmodified tree for exactly that reason.
 * objectui#10685 re-pointed this row at the block's own drill shape: the shared
 * `DrillDownConfig` with `filter` / `maxRows` / `report` refused and `target`
 * narrowed, so the widget's prop refuses exactly what the schema refuses.
 */
export type assertionDrillDownDeclared = Expect<Equal<Schema['drillDown'], ObjectDataTableDrillDownConfig | undefined>>;
/**
 * objectui#9799 widened the anchor's own declaration to an OPTIONAL second
 * parameter; this pin reads through `ObjectDataTableProps['schema']`, so it is
 * the consumer-side half of that measurement — the widget's prop type sees the
 * widened slot, not a stale copy.
 */
export type assertionOnRowClickDeclared = Expect<Equal<Schema['onRowClick'], ((row: any, event?: any) => void) | undefined>>;
export type assertionTypeIsRegistryKey = Expect<Equal<Schema['type'], 'object-data-table'>>;
/** The pin can fail: the pre-#6576 literal shape is NOT the anchor. */
export type assertionAnchorPinCanFail = Expect<Equal<Equal<{ type: string; [key: string]: any }, ObjectDataTableSchema>, false>>;

describe('ObjectDataTableProps.schema — anchored to ObjectDataTableSchema (objectui#6576, #6914)', () => {
  it('NARROWS: refuses a wrong-typed base member the literal used to absorb', () => {
    // Before this card this directive was UNUSED (TS2578): the literal's own
    // `[key: string]: any` typed `visible` as `any` and 42 compiled.
    // @ts-expect-error — `visible` is `boolean | string` through BaseSchema.
    const node: Schema = { type: 'object-data-table', objectName: 'account', visible: 42 };
    expect(node.visible).toBe(42);
  });

  it('NARROWS: `type` is the registry key, not bare `string`', () => {
    // Before this card `type: string` accepted any spelling, including the
    // `data-table` key of a DIFFERENT node.
    // @ts-expect-error — the only spelling is the key `ObjectDataTable.tsx` registers.
    const node: Schema = { type: 'data-table', objectName: 'account' };
    expect(node.type).toBe('data-table');
  });

  it('declares the two keys the widget reads (objectui#6914) — typed, so a wrong shape is refused', () => {
    const node: Schema = {
      type: 'object-data-table',
      objectName: 'account',
      drillDown: { enabled: true, mode: 'record', target: 'dialog' },
      // `row` is contextually typed from the declaration; it used to sit behind `(schema as any)`.
      onRowClick: (row) => { void row; },
    };
    expect(node.drillDown?.mode).toBe('record');

    // @ts-expect-error — `enabled` is a boolean on the drill shape; the index signature used to hide this.
    const wrongShape: Schema = { type: 'object-data-table', drillDown: { enabled: 'yes' } };
    // @ts-expect-error — `onRowClick` is a function.
    const notAFunction: Schema = { type: 'object-data-table', onRowClick: 'toast' };
    expect([wrongShape.drillDown, notAFunction.onRowClick]).toEqual([{ enabled: 'yes' }, 'toast']);
  });

  it('keeps `data` typed as `any[]` — a non-array is still refused, as before', () => {
    // @ts-expect-error — `data` is `any[]`; the interface member overrides BaseSchema's `data?: any`.
    const node: Schema = { type: 'object-data-table', data: 'not-an-array' };
    expect(node.data).toBe('not-an-array');
  });

  it('an UNKNOWN key is refused — the ceiling this row stated is gone (objectui#8347)', () => {
    // The inherited index signature let it compile until objectui#8347 removed it.
    // @ts-expect-error — `ObjectDataTableSchema` declares no `bogusKey`
    const node: Schema = { type: 'object-data-table', bogusKey: 1 };
    expect(node.type).toBe('object-data-table');
  });
});
