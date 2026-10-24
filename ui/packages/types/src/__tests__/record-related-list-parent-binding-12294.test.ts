/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:related_list`'s PARENT binding, `parentDataSource`, on this
 * package's faces (objectui#12294's related-list leg, ruling B on
 * objectui#12296).
 *
 * The key is a member of the spec's `record:related_list` row
 * (`RecordRelatedListProps.parentDataSource`, the object binding
 * `ElementDataSourceSchema` by reference). Two faces carry it:
 *
 *  - the zod faces, through the arm's `properties` bag, which IS the spec row
 *    by reference — so the arm declares nothing for it, and a node-level
 *    spelling is refused toward `properties.parentDataSource`;
 *  - the TypeScript mirror `RecordRelatedListComponentProps`, the props the
 *    renderer reads after `SchemaRenderer`'s `properties` hoist, which declares
 *    it as the spec's own input type (the `Equal` legs below are compiled by
 *    `tsc -p tsconfig.test.json`; vitest strips types).
 *
 * The binding's VALUE is the spec's verdict (a full parse), and its KEY is
 * reachable on the arm (no `unrecognized_keys`): two different facts, each
 * asserted as itself.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ComponentPropsInput, ElementDataSource } from '@objectstack/spec/ui';

import { RecordRelatedListBlockSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { RecordRelatedListComponentProps } from '../record-components.js';

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// @ts-expect-error objectui#12294 — `Expect` must refuse `false`, or every pin below is vacuous.
type _ExpectRefusesFalse = Expect<false>;

/** The mirror's member IS the spec row's input type, not a lookalike. */
export type _ParentBindingMirrorsSpec = Expect<
  Equal<RecordRelatedListComponentProps['parentDataSource'], ComponentPropsInput<'record:related_list'>['parentDataSource']>
>;

/** …and that type is the element object binding, optional — spelled out, so two drifted faces cannot agree. */
export type _ParentBindingIsTheObjectBinding = Expect<
  Equal<RecordRelatedListComponentProps['parentDataSource'], ElementDataSource | undefined>
>;

/** The card's node as the renderer reads it: compiles. Refused with TS2353 before this card. */
export const parentBindingAccepted: RecordRelatedListComponentProps = {
  objectName: 'sys_member',
  relationshipField: 'environment_id',
  parentDataSource: { object: 'sys_environment', sort: [{ field: 'created_at', order: 'desc' }], limit: 1 },
};

export const parentBindingRefused: RecordRelatedListComponentProps = {
  objectName: 'sys_member',
  relationshipField: 'environment_id',
  // @ts-expect-error objectui#12294 — a bare object name is not a binding.
  parentDataSource: 'sys_environment',
};

/* ── The zod faces ─────────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; keys?: string[] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };
const issuesOf = (result: Result): Issue[] => (result.success ? [] : (result.error!.issues as unknown as Issue[]));

const BAG = { objectName: 'sys_member', relationshipField: 'environment_id' };
const PARENT = {
  object: 'sys_environment',
  filter: [{ field: 'environment_type', operator: 'equals', value: 'production' }],
  limit: 1,
};

describe('`record:related_list` carries `parentDataSource` in its `properties` bag (objectui#12294)', () => {
  it.each([
    ['the arm', (node: unknown) => RecordRelatedListBlockSchema.safeParse(node)],
    ['the strict face', (node: unknown) => StrictAnyComponentSchema.safeParse(node)],
  ] as const)('%s parses the node in full, beside the child-row `dataSource`', (_face, judge) => {
    const node = {
      type: 'record:related_list',
      properties: { ...BAG, parentDataSource: PARENT },
      dataSource: { object: 'sys_member', limit: 5 },
    };
    const result = judge(node);
    expect(issuesOf(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('the binding\'s VALUE is the spec\'s verdict: a binding naming no object is refused AT the key', () => {
    const result = RecordRelatedListBlockSchema.safeParse({
      type: 'record:related_list',
      properties: { ...BAG, parentDataSource: { limit: 1 } },
    });
    expect(result.success).toBe(false);
    const paths = issuesOf(result).map((issue) => issue.path.join('.'));
    expect(paths.some((path) => path.startsWith('properties.parentDataSource'))).toBe(true);
    // The key itself is not what was refused.
    expect(issuesOf(result).filter((issue) => issue.code === 'unrecognized_keys')).toEqual([]);
  });

  it('the node-level spelling is refused, at its own path', () => {
    const result = RecordRelatedListBlockSchema.safeParse({ type: 'record:related_list', properties: BAG, parentDataSource: PARENT });
    expect(result.success).toBe(false);
    expect(issuesOf(result).map((issue) => issue.path.join('.'))).toContain('parentDataSource');
  });
});
