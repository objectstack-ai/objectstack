/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10872 batch 5 — the content channels of the six public blocks
 * batch 4 armed by reference (`action:button`, `action:icon`, `action:group`,
 * `action:menu`, `element:definition-list`, `element:repeater`), narrowed by
 * the objectui#9256 method. The arms themselves are pinned in
 * `held-public-block-arms-10872.test.ts`; the nineteen blocks objectui#9256
 * narrowed first are pinned in `content-channel-public-blocks-9256.test.ts`.
 * This file carries only what this batch adds.
 *
 * ## The defect
 *
 * Batch 4 gave the six an arm, and each arm took `BaseSchema`'s channels as
 * they were. So `{ "type": "action:group", "children": [ … ] }` parsed green on
 * both faces, while no renderer of the six reads the node's `children` (nor
 * its `body`) and `SchemaRenderer` strips both out of the props it spreads:
 * the child list rendered nothing, with no error and no warning. And a flat
 * `body` was refused with `BaseSchema`'s objectui#6771 remedy, which points at
 * `children` — the key that did nothing.
 *
 * ## What is narrowed
 *
 * Each arm declares `children` as a by-name refusal and restates `body` with
 * the same guidance: two `retirementTombstone` members fed ONE
 * `neitherContentChannelGuidance` string, both kept MEMBERS, exactly as the
 * objectui#9256 arms are. The message names what the block renders instead,
 * and so the channel an author's content belongs in: `properties.actions` for
 * the group and the menu, `properties.items` for the definition list, the
 * `label` and `icon` for the two buttons. `element:repeater` has no content
 * channel, and its message says so rather than naming one.
 *
 * ## Why this is not a second dialect
 *
 * `@objectstack/spec`'s own `PageComponentSchema` has no node-level `children`
 * and refuses one as an unrecognized key, on every one of the six. The last
 * block below re-reads that verdict from the INSTALLED spec, so a spec that
 * starts accepting the key turns this file red here, and the refusal has to
 * be re-decided rather than drift.
 *
 * The two readings that say no renderer reads either channel (a TypeScript
 * type-checker census of the `@object-ui/components` program on a built tree,
 * and a runtime probe through the real `SchemaRenderer` and registry) were
 * taken once and are recorded on objectui#10872. Nothing in this file
 * re-derives them: it pins the validator's answer, not the renderers'.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PageComponentSchema } from '@objectstack/spec/ui';

import {
  ActionButtonBlockSchema,
  ActionGroupBlockSchema,
  ActionIconBlockSchema,
  ActionMenuBlockSchema,
  ElementDefinitionListBlockSchema,
  ElementRepeaterBlockSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };
type Arm = {
  safeParse: (v: unknown) => Result;
  shape: Record<string, { description?: string } | undefined>;
};

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

/**
 * One row per narrowed block: its arm, a node that fills its real content
 * channel (the positive control), and the name the refusal gives that channel
 * — `null` for the block that has none.
 */
const ROWS: ReadonlyArray<
  readonly [type: string, arm: Arm, node: Record<string, unknown>, channel: string | null]
> = [
  [
    'action:button',
    ActionButtonBlockSchema as unknown as Arm,
    { type: 'action:button', properties: { label: 'Open', icon: 'external-link', actionType: 'url', target: '/users/ada' } },
    '`properties.label`',
  ],
  [
    'action:icon',
    ActionIconBlockSchema as unknown as Arm,
    { type: 'action:icon', properties: { icon: 'pencil', label: 'Edit', actionType: 'url', target: '/users/ada' } },
    '`properties.icon`',
  ],
  [
    'action:group',
    ActionGroupBlockSchema as unknown as Arm,
    { type: 'action:group', properties: { display: 'dropdown', label: 'More', actions: [{ name: 'open', label: 'Open', type: 'url', target: '/a' }] } },
    '`properties.actions`',
  ],
  [
    'action:menu',
    ActionMenuBlockSchema as unknown as Arm,
    { type: 'action:menu', properties: { label: 'More', actions: [{ name: 'open', label: 'Open', type: 'url', target: '/a' }] } },
    '`properties.actions`',
  ],
  [
    'element:definition-list',
    ElementDefinitionListBlockSchema as unknown as Arm,
    { type: 'element:definition-list', properties: { items: [{ term: 'Owner', description: 'Ada' }], columns: 2 } },
    '`properties.items`',
  ],
  [
    'element:repeater',
    ElementRepeaterBlockSchema as unknown as Arm,
    { type: 'element:repeater', dataSource: { object: 'account' }, properties: { titleField: 'name', fields: ['industry'] } },
    null,
  ],
];

const CHANNELS = ['children', 'body'] as const;
const CONTENT = [{ type: 'element:text', properties: { content: 'measured' } }];
const issuesOf = (result: Result): Issue[] => (result.success ? [] : (result.error!.issues as unknown as Issue[]));
const issueAt = (result: Result, path: string): Issue | undefined =>
  issuesOf(result).find((i) => i.path.join('.') === path);

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });

const CASES = ROWS.flatMap(([type, arm, node, channel]) =>
  CHANNELS.map((key) => [`${type}.${key}`, type, arm, node, channel, key] as const));
const FACE_CASES = CASES.flatMap(([label, type, arm, node, channel, key]) =>
  FACES.map(([face, judge]) => [`${label} (${face})`, type, arm, node, channel, key, judge] as const));

/* ── (a) both channels are REFUSED BY NAME, at the key's own path, on both faces ── */

describe('objectui#10872 batch 5 — the six held blocks refuse both content channels', () => {
  it('the population is the six batch-4 arms — a row dropped from the table fails here', () => {
    expect(ROWS.map(([type]) => type)).toEqual([
      'action:button',
      'action:icon',
      'action:group',
      'action:menu',
      'element:definition-list',
      'element:repeater',
    ]);
    expect(CASES).toHaveLength(12);
    expect(FACE_CASES).toHaveLength(24);
  });

  it.each(FACE_CASES)('%s is refused with `invalid_type` at the key\'s own path', (label, _type, _arm, node, _channel, key, judge) => {
    const result = judge({ ...node, [key]: CONTENT });
    expect(result.success, `${label} parsed green — the tombstone is not installed`).toBe(false);
    expect(issueAt(result, key)?.code).toBe('invalid_type');
  });

  it.each(FACE_CASES)('%s — the message names the block, the method, and what it renders instead', (_label, type, _arm, node, channel, key, judge) => {
    const message = issueAt(judge({ ...node, [key]: CONTENT }), key)!.message;
    expect(message).toContain(`\`${type}\` reads NEITHER content channel`);
    expect(message).toContain('objectui#9256');
    const instead = message.slice(message.indexOf('What it renders instead: '));
    expect(instead.length).toBeGreaterThan('What it renders instead: '.length);
    if (channel) {
      // The channel the author's content belongs in, named where the message
      // says what the block renders.
      expect(instead).toContain(channel);
    } else {
      // `element:repeater` has none, and the message says so instead of
      // pointing at a key that would do nothing either.
      expect(instead).toContain('NO content channel');
    }
    // ⛔ Not `BaseSchema`'s objectui#6771 `body` remedy, which points at
    // `children` — refused here too.
    expect(message).not.toContain('Did you mean');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, _type, arm, node, _channel, key) => {
    const issue = issueAt(arm.safeParse({ ...node, [key]: CONTENT }), key)!;
    expect(arm.shape[key]?.description).toBe(issue.message);
    // One string per block, fed to both members.
    expect(arm.shape.children?.description).toBe(arm.shape.body?.description);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, _type, arm, node, _channel, key) => {
    for (const value of [CONTENT, CONTENT[0], 'text', 42, null, {}, []]) {
      expect(issueAt(arm.safeParse({ ...node, [key]: value }), key)?.code, JSON.stringify(value)).toBe('invalid_type');
    }
  });

  it.each(CASES)('%s — the tombstone is a MEMBER of the arm\'s shape', (_label, _type, arm, _node, _channel, key) => {
    expect(Object.keys(arm.shape)).toContain(key);
  });
});

/* ── (b) the positive controls — the content channel is live ─────────────── */

describe('objectui#10872 batch 5 — each block\'s real content channel still parses', () => {
  it.each(ROWS.flatMap((row) => FACES.map(([face, judge]) => [`${row[0]} (${face})`, row[2], judge] as const)))(
    '%s — the `properties` node parses',
    (_label, node, judge) => {
      const result = judge(node);
      expect(issuesOf(result).map((i) => `${i.path.join('.')}: ${i.code}`)).toEqual([]);
      expect(result.success).toBe(true);
    },
  );

  it.each(ROWS.flatMap((row) => FACES.map(([face, judge]) => [`${row[0]} (${face})`, row[2], judge] as const)))(
    '%s — nested in a `page`: the block parses, and the same block with a child list is refused at its own path',
    (_label, node, judge) => {
      expect(judge({ type: 'page', children: [node] }).success).toBe(true);
      const refused = judge({ type: 'page', children: [{ ...node, children: CONTENT }] });
      expect(refused.success).toBe(false);
      const nested = allIssues(issuesOf(refused)).filter((i) => i.path.join('.') === 'children.0.children');
      expect(nested.some((i) => i.code === 'invalid_type' && i.message.includes('reads NEITHER content channel'))).toBe(true);
    },
  );
});

/* ── (c) the spec refuses the same key — alignment, not a second dialect ─── */

describe('objectui#10872 batch 5 — `@objectstack/spec`\'s page component refuses a node-level `children` on the six', () => {
  it.each(ROWS.map(([type]) => type))('`%s`: the installed spec refuses `children` as an unrecognized key', (type) => {
    // CONTROL — the node without it passes the spec's page-component shape,
    // so the refusal below is about the one key.
    expect(PageComponentSchema.safeParse({ type, id: 'n1' }).success).toBe(true);
    const result = PageComponentSchema.safeParse({ type, id: 'n1', children: CONTENT }) as unknown as Result;
    expect(result.success).toBe(false);
    const unrecognized = issuesOf(result).find((i) => i.code === 'unrecognized_keys');
    expect(unrecognized?.keys).toContain('children');
  });
});
