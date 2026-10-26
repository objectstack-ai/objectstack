/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12342 — the `record:approval_decision` arm
 * (`../zod/record-approval-decision.zod.ts`).
 *
 * `@object-ui/app-shell` registers `record:approval_decision`, the block
 * `@objectstack/spec` 18 declares, and this arm lands with it so
 * `AnyComponentSchema` claims the type instead of refusing it at `type`. Its
 * props bag restates the spec's unnamed row, so the row is read here from the
 * INSTALLED spec on every run: the arm's key set and its accept set must equal
 * the row's.
 *
 * Refusals are asserted by issue `code` and `path` — the envelope a consumer
 * reads — and not by message wording.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap } from '@objectstack/spec/ui';

import {
  AnyComponentSchema,
  RecordApprovalDecisionBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

const TYPE = 'record:approval_decision';

/** The spec's row, as the published map carries it. */
const ROW = (ComponentPropsMap as unknown as Record<string, z.ZodType>)[TYPE];

/** The arm's `properties` member with its `.optional()` peeled off. */
const BAG = (RecordApprovalDecisionBlockSchema.shape.properties as unknown as z.ZodOptional).unwrap() as z.ZodType;

const keysOf = (schema: z.ZodType): string[] =>
  Object.keys((schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}).sort();

/** The issues of a refused parse, as `code` + dotted `path`. */
function issuesOf(document: unknown): { code: string; path: string; message: string }[] {
  const result = safeValidateSchema(document);
  expect(result.success, 'expected a refusal').toBe(false);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('`record:approval_decision` — the bag is the spec row (objectui#12342)', () => {
  it('the installed spec carries the row, and it declares no key', () => {
    expect(ROW, 'ComponentPropsMap has no record:approval_decision row').toBeDefined();
    expect(keysOf(ROW)).toEqual([]);
  });

  it("the arm's bag declares the row's key set", () => {
    expect(keysOf(BAG)).toEqual(keysOf(ROW));
  });

  it.each([
    ['the empty bag', {}],
    ['a bag with a key', { request: 'req_1' }],
    ['a bag that is not an object', 'req_1'],
  ])('accepts or refuses %s exactly as the row does', (_case, bag) => {
    expect(BAG.safeParse(bag).success).toBe(ROW.safeParse(bag).success);
  });

  it('CONTROL: the row itself accepts `{}` and refuses a key', () => {
    expect(ROW.safeParse({}).success).toBe(true);
    expect(ROW.safeParse({ request: 'req_1' }).success).toBe(false);
  });
});

describe('`record:approval_decision` — the node a request page authors (objectui#12342)', () => {
  it('accepts the bare node on every face', () => {
    const node = { type: TYPE };
    expect(RecordApprovalDecisionBlockSchema.safeParse(node).success).toBe(true);
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('accepts an empty `properties` bag and the node-level keys a page writes', () => {
    const node = { type: TYPE, id: 'decision', className: 'mt-2', properties: {} };
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('is claimed at `type` — the union no longer refuses the literal', () => {
    // The ratchet's reading (`registered-types-validate-ratchet-10859.test.ts` in `@object-ui/cli`).
    expect(safeValidateSchema({ type: TYPE }).success).toBe(true);
    // Control: an unclaimed `record:` literal IS refused there.
    const unclaimed = issuesOf({ type: 'record:no_such_block_12342' });
    expect(unclaimed.some((i) => i.code === 'invalid_union' && i.path === 'type')).toBe(true);
  });
});

describe('`record:approval_decision` — what the arm refuses (objectui#12342)', () => {
  it('refuses any key inside the bag — the row declares none', () => {
    expect(issuesOf({ type: TYPE, properties: { request: 'req_1' } })).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', path: 'properties' }),
    ]);
  });

  it('refuses a flat key the renderer does not read, on the strict face', () => {
    const strict = StrictAnyComponentSchema.safeParse({ type: TYPE, request: 'req_1' });
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it.each(['children', 'body'])('refuses `%s` by name — the panel reads neither content channel', (key) => {
    const issues = issuesOf({ type: TYPE, [key]: [{ type: 'text', content: 'x' }] });
    expect(issues).toEqual([expect.objectContaining({ code: 'invalid_type', path: key })]);
  });

  it('reaches the arm through the union, not a second schema', () => {
    const document = { type: TYPE, properties: { request: 'req_1' } };
    const bare = RecordApprovalDecisionBlockSchema.safeParse(document);
    const viaUnion = AnyComponentSchema.safeParse(document);
    expect(bare.success).toBe(false);
    expect(viaUnion.success).toBe(false);
    expect(viaUnion.error?.issues.map((i) => [i.code, i.path.join('.')])).toEqual(
      bare.error?.issues.map((i) => [i.code, i.path.join('.')]),
    );
  });
});
