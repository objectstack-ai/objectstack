/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28462 — the props `record:related_list` hands its `filter` and
 * `add.picker.filter` to take the contract's filter-list element (a flat rule
 * or an any-of group `{ or: [rule, ...] }`), as the `@object-ui/types` face
 * does, so the renderer passes the authored value through without a cast.
 *
 * Three declarations carry the value on its way to the wire and must move
 * together: `RecordRelatedListComponentProps` (the authoring face),
 * `RelatedListProps` here, and `@object-ui/react`'s
 * `ResolveRelatedRecordActionsInput.filter` (the resolved list filter the
 * renderer hands the host for "View all"). Widening the face alone is a TS2322
 * in `renderers/record-related-list.tsx` (measured on `main` `4bc963ca`).
 *
 * Type-level only: compiled by `tsc -p tsconfig.test.json` (this package's
 * `type-check`), erased by vitest; the `it` below only keeps vitest from
 * reporting an empty file. Lowering the group to an `or` node is
 * `@object-ui/core`'s `toFilterNode` (objectstack#28370), not pinned here.
 */

import { describe, it, expect } from 'vitest';
import type { ViewFilterElement } from '@objectstack/spec/ui';
import type { RecordRelatedListComponentProps } from '@object-ui/types';
import type { FilterNode } from '@object-ui/core';
import type { ResolveRelatedRecordActionsInput } from '@object-ui/react';
import type { RelatedListProps } from '../RelatedList';

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// @ts-expect-error objectstack#28462 — `Expect` must refuse `false`, or every leg below is vacuous.
type _ExpectRefusesFalse = Expect<false>;

/** The list's own scope: the element array as authored, or the AST node the data-source gate composes. */
export type _ListFilter = Expect<Equal<RelatedListProps['filter'], ViewFilterElement[] | FilterNode | undefined>>;

/** The picker's filter: the element array, passed to `RecordPickerDialog`'s `baseFilter` verbatim. */
export type _PickerFilter = Expect<
  Equal<NonNullable<RelatedListProps['add']>['picker']['filter'], ViewFilterElement[] | undefined>
>;

/** The resolved list filter the renderer hands the host carries the same elements. */
export type _ActionsInputFilter = Expect<
  Equal<ResolveRelatedRecordActionsInput['filter'], ViewFilterElement[] | FilterNode | undefined>
>;

/** The authoring face flows into all three with no cast — what the renderer does. */
export function _flowsWithoutCast(authored: RecordRelatedListComponentProps): unknown[] {
  const toList: RelatedListProps['filter'] = authored.filter;
  const toPicker: NonNullable<RelatedListProps['add']>['picker']['filter'] = authored.add?.picker.filter;
  const toHost: ResolveRelatedRecordActionsInput['filter'] = authored.filter;
  return [toList, toPicker, toHost];
}

/** The card's example compiles on the component's own prop. */
export const _group: RelatedListProps['filter'] = [
  {
    or: [
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'completed_at', operator: 'greater_than', value: '{7_days_ago}' },
    ],
  },
];

describe('objectstack#28462 — RelatedList filter props take the { or } group', () => {
  it('is a type-level pin (see the header); the module loaded', () => {
    expect(_group).toHaveLength(1);
  });
});
