/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `mcp:authorized-assistants` arm (`../zod/mcp-authorized-assistants.zod.ts`).
 *
 * `@object-ui/app-shell` registers `mcp:authorized-assistants` for a `sys_user`
 * record page, and this arm lands with it so `AnyComponentSchema` claims the
 * type instead of refusing it at `type`. The arm is declared from the widget's
 * read points: the widget reads no prop (the person is the bound record), so
 * the only `properties` bag it takes is `{}`, and both content channels are
 * refused by name.
 *
 * Refusals are asserted by issue `code` and `path` — the envelope a consumer
 * reads — and not by message wording.
 */

import { describe, expect, it } from 'vitest';

import {
  AnyComponentSchema,
  McpAuthorizedAssistantsSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

const TYPE = 'mcp:authorized-assistants';

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

describe('`mcp:authorized-assistants` — the node a `sys_user` record page authors', () => {
  it('accepts the bare node on every face', () => {
    const node = { type: TYPE };
    expect(McpAuthorizedAssistantsSchema.safeParse(node).success).toBe(true);
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('accepts an empty `properties` bag on every face', () => {
    const node = { type: TYPE, properties: {} };
    expect(McpAuthorizedAssistantsSchema.safeParse(node).success).toBe(true);
    expect(safeValidateSchema(node).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(node).success).toBe(true);
  });

  it('accepts the node inside a page, with the spec page-component keys a page writes beside it', () => {
    const page = {
      type: 'page',
      children: [{ type: TYPE, id: 'user_authorized_assistants', className: 'mt-2' }],
    };
    expect(safeValidateSchema(page).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(page).success).toBe(true);
  });

  it('is claimed at `type` — the union no longer refuses the literal', () => {
    // The ratchet's reading (`registered-types-validate-ratchet-10859.test.ts`).
    expect(safeValidateSchema({ type: TYPE }).success).toBe(true);
    // Control: an unclaimed `mcp:` literal IS refused there.
    const unclaimed = issuesOf({ type: 'mcp:no-such-widget' });
    expect(unclaimed.some((i) => i.code === 'invalid_union' && i.path === 'type')).toBe(true);
  });
});

describe('`mcp:authorized-assistants` — what the arm refuses', () => {
  it('refuses any key inside the bag — the widget reads none, the person included', () => {
    expect(issuesOf({ type: TYPE, properties: { userId: 'user_mia' } })).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', path: 'properties' }),
    ]);
  });

  it('refuses a bag that is not an object', () => {
    expect(issuesOf({ type: TYPE, properties: 'user_mia' })).toEqual([
      expect.objectContaining({ code: 'invalid_type', path: 'properties' }),
    ]);
  });

  it('refuses a flat key the widget does not read, on the strict face', () => {
    const strict = StrictAnyComponentSchema.safeParse({ type: TYPE, userId: 'user_mia' });
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it.each(['children', 'body'])('refuses `%s` by name — the widget reads neither content channel', (key) => {
    const issues = issuesOf({ type: TYPE, [key]: [{ type: 'text', content: 'x' }] });
    expect(issues).toEqual([expect.objectContaining({ code: 'invalid_type', path: key })]);
    expect(issues[0].message).toContain(TYPE);
  });

  it('reaches the arm through the union, not a second schema', () => {
    // The union dispatches on the literal to this arm: the same refusal either way.
    const document = { type: TYPE, properties: { userId: 'user_mia' } };
    const bare = McpAuthorizedAssistantsSchema.safeParse(document);
    const viaUnion = AnyComponentSchema.safeParse(document);
    expect(bare.success).toBe(false);
    expect(viaUnion.success).toBe(false);
    expect(viaUnion.error?.issues.map((i) => [i.code, i.path.join('.')])).toEqual(
      bare.error?.issues.map((i) => [i.code, i.path.join('.')]),
    );
  });
});
