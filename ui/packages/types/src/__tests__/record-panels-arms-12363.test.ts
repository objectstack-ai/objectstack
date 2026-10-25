/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12363 — the `record:approvals` and `record:attachments` arms
 * (`../zod/record-panels.zod.ts`).
 *
 * `@objectstack/spec` 18 declares both page blocks, `@object-ui/app-shell`
 * registers both, and `buildDefaultPageSchema` emits both. These arms let
 * `AnyComponentSchema` claim the two types instead of refusing them at `type`.
 * Each props bag restates the spec's unnamed row, so the rows are read here
 * from the INSTALLED spec on every run: each arm's key set and accept set must
 * equal its row's.
 *
 * Refusals are asserted by issue `code` and `path` — the envelope a consumer
 * reads — and not by message wording.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, PageComponentType } from '@objectstack/spec/ui';

import {
  AnyComponentSchema,
  RecordApprovalsBlockSchema,
  RecordAttachmentsBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

const ARMS = [
  ['record:approvals', RecordApprovalsBlockSchema],
  ['record:attachments', RecordAttachmentsBlockSchema],
] as const;

/** The spec's row, as the published map carries it. */
const rowOf = (type: string): z.ZodType => (ComponentPropsMap as unknown as Record<string, z.ZodType>)[type];

/** The arm's `properties` member with its `.optional()` peeled off. */
const bagOf = (arm: (typeof ARMS)[number][1]): z.ZodType =>
  (arm.shape.properties as unknown as z.ZodOptional).unwrap() as z.ZodType;

const keysOf = (schema: z.ZodType): string[] =>
  Object.keys((schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}).sort();

/** The issues of a refused parse, as `code` + dotted `path`. */
function issuesOf(document: unknown): { code: string; path: string }[] {
  const result = safeValidateSchema(document);
  expect(result.success, 'expected a refusal').toBe(false);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }));
}

describe.each(ARMS)('`%s` — the bag is the spec row (objectui#12363)', (type, arm) => {
  it('the installed spec declares the type and carries its row, which declares no key', () => {
    expect((PageComponentType.options as readonly string[]).includes(type)).toBe(true);
    expect(rowOf(type), `ComponentPropsMap has no ${type} row`).toBeDefined();
    expect(keysOf(rowOf(type))).toEqual([]);
  });

  it("the arm's bag declares the row's key set", () => {
    expect(keysOf(bagOf(arm))).toEqual(keysOf(rowOf(type)));
  });

  it.each([
    ['the empty bag', {}],
    ['a bag with the host payload key', { approvals: { available: true, requests: [], pendingRequest: null } }],
    ['a bag with the host user key', { currentUserId: 'usr_1' }],
    ['a bag with an invented key', { inventedProp12363: true }],
    ['a bag that is not an object', 'x'],
  ])('accepts or refuses %s exactly as the row does', (_case, bag) => {
    expect(bagOf(arm).safeParse(bag).success).toBe(rowOf(type).safeParse(bag).success);
  });

  it('CONTROL: the row itself accepts `{}` and refuses a key', () => {
    expect(rowOf(type).safeParse({}).success).toBe(true);
    expect(rowOf(type).safeParse({ inventedProp12363: true }).success).toBe(false);
  });
});

describe.each(ARMS)('`%s` — the node a record page carries (objectui#12363)', (type, arm) => {
  it('accepts the bare node on every face', () => {
    const node = { type };
    expect(arm.safeParse(node).success).toBe(true);
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('accepts an empty `properties` bag and the node-level keys a page writes', () => {
    const node = { type, id: 'panel', className: 'mt-2', properties: {} };
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('is claimed at `type` — the union no longer refuses the literal', () => {
    expect(safeValidateSchema({ type }).success).toBe(true);
    // Control: an unclaimed `record:` literal IS refused there.
    const unclaimed = issuesOf({ type: 'record:no_such_panel_12363' });
    expect(unclaimed.some((i) => i.code === 'invalid_union' && i.path === 'type')).toBe(true);
  });
});

describe.each(ARMS)('`%s` — what the arm refuses (objectui#12363)', (type, arm) => {
  it('refuses an undeclared key inside the bag — the row declares none', () => {
    expect(issuesOf({ type, properties: { inventedProp12363: true } })).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', path: 'properties' }),
    ]);
  });

  it('refuses a flat undeclared key on the strict face', () => {
    const strict = StrictAnyComponentSchema.safeParse({ type, inventedProp12363: true });
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it.each(['children', 'body'])('refuses `%s` by name — the panel reads neither content channel', (key) => {
    const issues = issuesOf({ type, [key]: [{ type: 'text', content: 'x' }] });
    expect(issues).toEqual([expect.objectContaining({ code: 'invalid_type', path: key })]);
  });

  it('reaches the arm through the union, not a second schema', () => {
    const document = { type, properties: { inventedProp12363: true } };
    const bare = arm.safeParse(document);
    const viaUnion = AnyComponentSchema.safeParse(document);
    expect(bare.success).toBe(false);
    expect(viaUnion.success).toBe(false);
    expect(viaUnion.error?.issues.map((i) => [i.code, i.path.join('.')])).toEqual(
      bare.error?.issues.map((i) => [i.code, i.path.join('.')]),
    );
  });
});

describe('`record:approvals` — the host channels are refused in the bag (objectui#12363)', () => {
  it.each([
    ['approvals', { available: true, requests: [], pendingRequest: null }],
    ['currentUserId', 'usr_1'],
  ])('refuses `properties.%s` — the spec row names it the host\'s channel', (key, value) => {
    expect(issuesOf({ type: 'record:approvals', properties: { [key]: value } })).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', path: 'properties' }),
    ]);
  });
});
