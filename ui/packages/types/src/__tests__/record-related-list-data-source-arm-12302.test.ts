/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:related_list` declares the node's `dataSource` binding, by reference
 * to the spec (objectui#12302).
 *
 * The block's registration is gate-wrapped (`RecordRelatedListRenderer` is
 * `elementDataSourceBlock`-wrapped around `ElementDataSourceGate`), and the
 * gate maps the binding onto the keys the list reads: `object` onto
 * `objectName`, plus `columns`, `filter`, `sort` and `limit` (objectstack#6953).
 * The binding is the binding of the CHILD rows the list shows. The parent is
 * still the record the block sits on, matched through `relationshipField`.
 * Before this the strict authoring face refused the key as undeclared, while
 * the spec's own page component accepts it on every component.
 *
 *  - every face, and the TypeScript authoring face, accepts the binding; the
 *    spec's page component accepts the same nodes (lit control);
 *  - the binding's VALUE is the spec's verdict: a binding the spec refuses is
 *    refused at `dataSource`;
 *  - the member is the spec's `ElementDataSourceSchema` itself, and it is NOT
 *    the one-record blocks' member (a different meaning, objectui#12294);
 *  - a record block that reads no binding still refuses the key (`record:path`).
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ElementDataSourceSchema, PageComponentSchema } from '@objectstack/spec/ui';

import {
  RecordDetailsBlockSchema,
  RecordRelatedListBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type { PublicBlockNode } from '../authoring-nodes.js';

type Issue = { code: string; path: PropertyKey[]; keys?: string[] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issuesOf = (result: Result): Issue[] => (result.success ? [] : (result.error!.issues as unknown as Issue[]));
const pathsOf = (result: Result): string[] => issuesOf(result).map((issue) => issue.path.join('.'));

/** A child-row binding: many rows, by design — no `limit: 1`. */
const CHILD_BINDING = {
  object: 'sys_member',
  filter: [{ field: 'role', operator: 'equals', value: 'admin' }],
  sort: [{ field: 'created_at', order: 'desc' }],
  limit: 5,
};

const BAG = { objectName: 'sys_member', relationshipField: 'organization_id' };

/** The nodes the card names: bound with no bag, and bound beside a bag. */
const BOUND_NODES = [
  ['bound, no bag', { type: 'record:related_list', dataSource: { object: 'sys_member', limit: 5 } }],
  ['bound beside its bag', { type: 'record:related_list', properties: BAG, dataSource: CHILD_BINDING }],
] as const;

describe('`record:related_list` declares the node\'s `dataSource` binding (objectui#12302)', () => {
  it.each(BOUND_NODES)('the spec\'s own page component accepts the node — %s (lit control)', (_why, node) => {
    expect(PageComponentSchema.safeParse(node).success).toBe(true);
  });

  const cases = BOUND_NODES.flatMap(([why, node]) => FACES.map(([face, judge]) => [face, why, node, judge] as const));

  it.each(cases)('%s face: the node parses — %s', (_face, _why, node, judge) => {
    expect(judge(node).success).toBe(true);
  });

  it('the member is the spec\'s `ElementDataSourceSchema`, through the import boundary', () => {
    const member = (RecordRelatedListBlockSchema.shape.dataSource as unknown as z.ZodOptional).unwrap();
    const spec = ElementDataSourceSchema as unknown as z.ZodType;
    expect((member as unknown as { _zod: { def: unknown } })._zod.def)
      .toBe((spec as unknown as { _zod: { def: unknown } })._zod.def);
  });

  it('the member is not the one-record blocks\' member: the child rows, not the record', () => {
    // Same schema, different binding meaning, so a different member with its own description.
    const related = RecordRelatedListBlockSchema.shape.dataSource;
    const oneRecord = RecordDetailsBlockSchema.shape.dataSource;
    expect(related).not.toBe(oneRecord);
    expect(related.description).toBeTruthy();
    expect(related.description).not.toBe(oneRecord.description);
  });

  it.each(FACES)('%s face: a binding the spec refuses is refused at `dataSource`', (_face, judge) => {
    for (const dataSource of ['sys_member', { object: 'sys_member', limit: 0 }, { limit: 5 }]) {
      const document = { type: 'record:related_list', dataSource };
      // The verdict is the spec's, not this face's.
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(dataSource)).toBe(false);
      const result = judge(document);
      expect(result.success, JSON.stringify(dataSource)).toBe(false);
      expect(pathsOf(result).some((path) => path === 'dataSource' || path.startsWith('dataSource.')), JSON.stringify(dataSource))
        .toBe(true);
    }
  });
});

describe('a record block that reads no binding still refuses it (objectui#12302)', () => {
  it('`record:path`: the strict face refuses `dataSource` as undeclared', () => {
    const result = StrictAnyComponentSchema.safeParse({ type: 'record:path', dataSource: CHILD_BINDING });
    expect(result.success).toBe(false);
    const issue = issuesOf(result as Result).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.keys).toContain('dataSource');
  });
});

describe('the TypeScript authoring face follows the arm (objectui#12302)', () => {
  it('a typed node literal carries the child binding on `record:related_list`, and is refused it on `record:path`', () => {
    // Fresh literals, so the literal member types (`'equals'`, `'desc'`) are checked as written.
    const bound: PublicBlockNode = {
      type: 'record:related_list',
      properties: { objectName: 'sys_member', relationshipField: 'organization_id' },
      dataSource: { object: 'sys_member', sort: [{ field: 'created_at', order: 'desc' }], limit: 5 },
    };
    // Control: the same node without the binding compiles, so the refusal below is the binding's.
    const plain: PublicBlockNode = { type: 'record:path' };
    // @ts-expect-error -- `record:path` reads no binding, so its node declares none.
    const refused: PublicBlockNode = { type: 'record:path', dataSource: { object: 'sys_member', limit: 5 } };
    expect(bound.type).toBe('record:related_list');
    expect(plain.type).toBe('record:path');
    expect(refused.type).toBe('record:path');
  });
});
