/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9590 — an item-level `body` on a `list` item or a `tabs` item is
 * REFUSED BY NAME on both published faces, and the refusal names `content`.
 *
 * ## The defect, measured before this change
 *
 * `ListItemSchema` and `TabItemSchema` are STRIPPING `z.object`s that declared
 * no `body`: a list item authored `{ "body": node }` parsed GREEN to `{}`, and
 * `body` beside a tab item's `content` was dropped in silence. The renderers
 * meanwhile READ that key as a fallback, so the one spelling the faces dropped
 * was the one that rendered. objectui#9590 retired both reads (each item now
 * draws `content` only), which left `body` a key that is stripped at the door
 * AND rendered by nothing: the silently-inert shape ADR-0049 ends. So the key
 * is refused by name, in the shape the node-level retirement took
 * (`BaseSchema.body`, objectui#6771): `aliasKeyRefusal` on the zod face, a
 * `?: never` twin on the TypeScript face.
 *
 * ## The rows
 *
 * - (a) the zod doors: each item schema refuses `body` at its own path, alone
 *   or beside `content`, and through the node schema at `items.N.body`. Red
 *   before this change (every one parsed green).
 * - (b) the CONTROLS: `content` (string, node, node array) and every other
 *   accepted key still parse, keys unchanged. Green in both worlds.
 * - (c) the TypeScript faces: a NON-FRESH object carrying `body` no longer
 *   assigns. A fresh literal was already an excess-property error before this
 *   change, so it could not discriminate; the non-fresh assignment compiled
 *   before and is a `tsc` error now. `tsc -p tsconfig.test.json` is the reader.
 *
 * ⛔ Message prose is not pinned: an issue is asserted by `code` and `path`, and
 * by the one named subject the refusal exists to carry, the key `content`.
 */

import { describe, it, expect } from 'vitest';
import type { ListItem } from '../data-display';
import type { TabItem, TextSchema } from '../layout';
import { ListItemSchema, ListSchema } from '../zod/data-display.zod';
import { TabItemSchema, TabsSchema } from '../zod/layout.zod';

const NODE: TextSchema = { type: 'text', content: 'x' };

type Issue = { code: string; path: PropertyKey[]; message: string };
function issuesOf(r: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  return r.success ? [] : (r.error?.issues ?? []);
}
function bodyIssue(r: { success: boolean; error?: { issues: Issue[] } }, path: PropertyKey[]): Issue | undefined {
  return issuesOf(r).find((i) => i.code === 'invalid_type' && i.path.join('.') === path.join('.'));
}

describe('objectui#9590 (a) — the item doors refuse `body` by name', () => {
  it('ListItemSchema refuses `body` alone, and names `content`', () => {
    const r = ListItemSchema.safeParse({ body: NODE });
    expect(r.success).toBe(false);
    const issue = bodyIssue(r, ['body']);
    expect(issue, JSON.stringify(issuesOf(r))).toBeDefined();
    expect(issue?.message).toContain('`content`');
  });

  it('ListItemSchema refuses `body` beside `content`', () => {
    const r = ListItemSchema.safeParse({ content: 'a', body: NODE });
    expect(r.success).toBe(false);
    expect(bodyIssue(r, ['body'])).toBeDefined();
  });

  it('ListSchema refuses it at `items.0.body`', () => {
    const r = ListSchema.safeParse({ type: 'list', items: [{ body: NODE }] });
    expect(r.success).toBe(false);
    expect(bodyIssue(r, ['items', 0, 'body']), JSON.stringify(issuesOf(r))).toBeDefined();
  });

  it('TabItemSchema refuses `body` beside `content`, and names `content`', () => {
    const r = TabItemSchema.safeParse({ value: 'a', label: 'A', content: NODE, body: NODE });
    expect(r.success).toBe(false);
    const issue = bodyIssue(r, ['body']);
    expect(issue, JSON.stringify(issuesOf(r))).toBeDefined();
    expect(issue?.message).toContain('`content`');
  });

  it('TabsSchema refuses it at `items.0.body`', () => {
    const r = TabsSchema.safeParse({ type: 'tabs', items: [{ value: 'a', label: 'A', content: NODE, body: NODE }] });
    expect(r.success).toBe(false);
    expect(bodyIssue(r, ['items', 0, 'body']), JSON.stringify(issuesOf(r))).toBeDefined();
  });
});

describe('objectui#9590 (b) — CONTROLS: `content` and every other key still parse', () => {
  it('a list item\'s `content` parses as a string, a node and a node array', () => {
    for (const content of ['a', NODE, [NODE, NODE]]) {
      const r = ListItemSchema.safeParse({ content });
      expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    }
  });

  it('a list item carrying every other declared key parses with its keys unchanged', () => {
    const item = { id: 'i', label: 'L', description: 'D', icon: 'check', avatar: '/a.png', disabled: false, content: NODE };
    const r = ListItemSchema.safeParse(item);
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    if (r.success) expect(Object.keys(r.data).sort()).toEqual(Object.keys(item).sort());
  });

  it('a tab item carrying every declared key parses with its keys unchanged', () => {
    const item = { value: 'a', label: 'A', icon: 'check', disabled: true, content: [NODE] };
    const r = TabItemSchema.safeParse(item);
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
    if (r.success) expect(Object.keys(r.data).sort()).toEqual(Object.keys(item).sort());
  });
});

describe('objectui#9590 (c) — the TypeScript faces refuse `body` too', () => {
  it('a non-fresh object carrying `body` assigns to neither item type', () => {
    const listItemWithBody = { content: 'a', body: [NODE] };
    // @ts-expect-error objectui#9590 — `ListItem.body` is `never`; author `content`
    const listItem: ListItem = listItemWithBody;

    const tabItemWithBody = { value: 'a', label: 'A', content: [NODE], body: [NODE] };
    // @ts-expect-error objectui#9590 — `TabItem.body` is `never`; author `content`
    const tabItem: TabItem = tabItemWithBody;

    // CONTROL (no `@ts-expect-error`): the same objects without `body` assign.
    const listOk: ListItem = { content: 'a' };
    const tabOk: TabItem = { value: 'a', label: 'A', content: [NODE] };

    expect([listItem, tabItem, listOk, tabOk]).toHaveLength(4);
  });
});
