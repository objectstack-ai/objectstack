/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The three ONE-RECORD blocks declare the node's `dataSource` binding, by
 * reference to the spec (objectui#12294).
 *
 * `record:details`, `record:highlights` and `record:quick_actions` read the
 * binding at runtime (`@object-ui/plugin-detail`, `renderers/recordBinding.tsx`),
 * so their arms declare it, as `record:line_items` and the gate-wrapped
 * ObjectQL blocks do. Before this the strict authoring face refused it as an
 * undeclared key on all three, while the spec's own page component accepts it
 * on every component.
 *
 *  - every face, and the TypeScript authoring face, accepts the binding on the
 *    three; the spec's page component accepts the same nodes (lit control);
 *  - the binding's VALUE is the spec's verdict: a binding the spec refuses is
 *    refused at `dataSource`;
 *  - the member is the spec's `ElementDataSourceSchema` itself;
 *  - a record block that reads no binding still refuses the key (`record:path`).
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ElementDataSourceSchema, PageComponentSchema } from '@objectstack/spec/ui';

import {
  RecordDetailsBlockSchema,
  RecordHighlightsBlockSchema,
  RecordQuickActionsBlockSchema,
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

const BINDING = {
  object: 'sys_environment',
  filter: [{ field: 'environment_type', operator: 'equals', value: 'production' }],
  sort: [{ field: 'created_at', order: 'desc' }],
  limit: 1,
};

const ARMS = [
  ['record:details', RecordDetailsBlockSchema],
  ['record:highlights', RecordHighlightsBlockSchema],
  ['record:quick_actions', RecordQuickActionsBlockSchema],
] as const;

describe.each(ARMS)('`%s` declares the node\'s `dataSource` binding (objectui#12294)', (type, arm) => {
  const BOUND = { type, dataSource: BINDING };

  it('the spec\'s own page component accepts the bound node (lit control)', () => {
    expect(PageComponentSchema.safeParse(BOUND).success).toBe(true);
  });

  it.each(FACES)('%s face: the bound node parses', (_face, judge) => {
    expect(judge(BOUND).success).toBe(true);
  });

  it('the member is the spec\'s `ElementDataSourceSchema`, through the import boundary', () => {
    const member = (arm.shape.dataSource as unknown as z.ZodOptional).unwrap();
    const spec = ElementDataSourceSchema as unknown as z.ZodType;
    expect((member as unknown as { _zod: { def: unknown } })._zod.def)
      .toBe((spec as unknown as { _zod: { def: unknown } })._zod.def);
  });

  it.each(FACES)('%s face: a binding the spec refuses is refused at `dataSource`', (_face, judge) => {
    for (const dataSource of ['sys_environment', { object: 'sys_environment', limit: 0 }, { limit: 1 }]) {
      const document = { type, dataSource };
      // The verdict is the spec's, not this face's.
      expect(PageComponentSchema.safeParse(document).success, JSON.stringify(dataSource)).toBe(false);
      const result = judge(document);
      expect(result.success, JSON.stringify(dataSource)).toBe(false);
      expect(pathsOf(result).some((path) => path === 'dataSource' || path.startsWith('dataSource.')), JSON.stringify(dataSource))
        .toBe(true);
    }
  });
});

describe('a record block that reads no binding still refuses it (objectui#12294)', () => {
  it('`record:path`: the strict face refuses `dataSource` as undeclared', () => {
    const result = StrictAnyComponentSchema.safeParse({ type: 'record:path', dataSource: BINDING });
    expect(result.success).toBe(false);
    const issue = issuesOf(result as Result).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.keys).toContain('dataSource');
  });
});

describe('the TypeScript authoring face follows the arms (objectui#12294)', () => {
  it('a typed node literal carries the binding on the three, and is refused it on `record:path`', () => {
    // Fresh literals, so the literal member types (`'equals'`, `'desc'`) are checked as written.
    const nodes: PublicBlockNode[] = [
      { type: 'record:details', dataSource: { object: 'sys_environment', filter: [{ field: 'environment_type', operator: 'equals', value: 'production' }], limit: 1 } },
      { type: 'record:highlights', dataSource: { object: 'sys_environment', sort: [{ field: 'created_at', order: 'desc' }], limit: 1 } },
      { type: 'record:quick_actions', dataSource: { object: 'sys_environment', limit: 1 } },
    ];
    // Control: the same node without the binding compiles, so the refusal below is the binding's.
    const plain: PublicBlockNode = { type: 'record:path' };
    // @ts-expect-error -- `record:path` reads no binding, so its node declares none.
    const refused: PublicBlockNode = { type: 'record:path', dataSource: { object: 'sys_environment', limit: 1 } };
    expect(plain.type).toBe('record:path');
    expect(nodes).toHaveLength(3);
    expect(refused.type).toBe('record:path');
  });
});
