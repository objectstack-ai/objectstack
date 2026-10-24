/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10872 batch 6 — the child list of the four `page:` containers
 * (`page:card`, `page:section`, `page:footer`, `page:sidebar`) is
 * `properties.children`, and the node-level spelling is refused by name,
 * pointed there. The objectui#9256 slices narrowed every OTHER public block,
 * whose renderers read neither content channel
 * (`content-channel-public-blocks-9256.test.ts`,
 * `held-block-content-channels-10872.test.ts`); this file carries only what
 * this batch adds.
 *
 * ## The defect
 *
 * These four DO render a child list, and each one's `@objectstack/spec` row
 * declares it as the `children` member of the props bag (`PageCardProps`;
 * `PageContainerProps` for the other three). Their arms took `BaseSchema`'s
 * node-level `children` as it was, so `{ "type": "page:section", "children":
 * [ … ] }` parsed green on both faces while the spec's own
 * `PageComponentSchema` refuses that node as an unrecognized key: `objectui
 * validate` accepted what `os validate` refuses. And a flat `body` was refused
 * with `BaseSchema`'s objectui#6771 remedy, which points at the node-level
 * `children`.
 *
 * ## What is narrowed
 *
 * Each arm declares `children` as a by-name refusal and restates `body` with
 * the same guidance: two `retirementTombstone` members fed ONE string, both
 * kept MEMBERS, as the objectui#9256 arms are — but the string is not the
 * neither-channel text, because these blocks render their child list. It
 * names where the list goes: `properties.children`. The renderers are not
 * touched; they keep reading the node-level spellings for stored documents.
 *
 * ## Why the remedy is honest, and why this is not a second dialect
 *
 * The last blocks below re-read the installed spec: its `PageComponentSchema`
 * refuses the node-level `children` on all four and passes the bag spelling,
 * and each row still declares the `children` member the message names. A spec
 * that changes either turns this file red here.
 *
 * That the bag spelling renders the same page (the child list, in order, with
 * DOM byte-identical to the node-level spelling) was measured once through the
 * real `SchemaRenderer` and registry, and that no objectui or objectstack
 * producer writes the node-level spelling on these four was measured once by
 * the committed `census:body-dialect` instrument. Both readings are recorded on
 * objectui#10872; nothing in this file re-derives them — `@object-ui/types`
 * imports no renderer.
 *
 * ## The props-bag helper fold
 *
 * `objectql.zod.ts`'s two public-block arms had a byte copy of
 * `public-blocks.zod.ts`'s `propsBag` under another name; they import the one
 * helper now. The last block pins that their `properties` member is what it
 * was: the same description, from the same composer.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';

import {
  PageCardBlockSchema,
  PageSectionBlockSchema,
  PageFooterBlockSchema,
  PageSidebarBlockSchema,
  ObjectMetricBlockSchema,
  ObjectMasterDetailFormBlockSchema,
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

/** One row per narrowed container: its arm, and the spec row's exported name the message cites. */
const ROWS: ReadonlyArray<readonly [type: string, arm: Arm, row: string]> = [
  ['page:card', PageCardBlockSchema as unknown as Arm, 'PageCardProps'],
  ['page:section', PageSectionBlockSchema as unknown as Arm, 'PageContainerProps'],
  ['page:footer', PageFooterBlockSchema as unknown as Arm, 'PageContainerProps'],
  ['page:sidebar', PageSidebarBlockSchema as unknown as Arm, 'PageContainerProps'],
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

/** The first sentence of a message — where an author's eye lands. */
const firstSentence = (message: string) => message.slice(0, message.indexOf('. ') + 1);

const CASES = ROWS.flatMap(([type, arm, row]) =>
  CHANNELS.map((key) => [`${type}.${key}`, type, arm, row, key] as const));
const FACE_CASES = CASES.flatMap(([label, type, arm, row, key]) =>
  FACES.map(([face, judge]) => [`${label} (${face})`, type, arm, row, key, judge] as const));
const FACE_ROWS = ROWS.flatMap(([type]) => FACES.map(([face, judge]) => [`${type} (${face})`, type, judge] as const));

/* ── (a) the node-level child list is REFUSED BY NAME, on both faces ──────── */

describe('objectui#10872 batch 6 — the four `page:` containers refuse a node-level child list', () => {
  it('the population is the four containers — a row dropped from the table fails here', () => {
    expect(ROWS.map(([type]) => type)).toEqual(['page:card', 'page:section', 'page:footer', 'page:sidebar']);
    expect(CASES).toHaveLength(8);
    expect(FACE_CASES).toHaveLength(16);
  });

  it.each(FACE_CASES)('%s is refused with `invalid_type` at the key\'s own path', (label, type, _arm, _row, key, judge) => {
    const result = judge({ type, [key]: CONTENT });
    expect(result.success, `${label} parsed green — the refusal is not installed`).toBe(false);
    expect(issueAt(result, key)?.code).toBe('invalid_type');
  });

  it.each(FACE_CASES)('%s — the first sentence names `properties.children` and the block', (_label, type, _arm, row, key, judge) => {
    const message = issueAt(judge({ type, [key]: CONTENT }), key)!.message;
    const lead = firstSentence(message);
    expect(lead).toContain('`properties.children`');
    expect(lead).toContain(`\`${type}\``);
    // The row the member belongs to, so the remedy can be looked up.
    expect(lead).toContain(`\`${row}\``);
    expect(lead).toContain(`{ "type": "${type}", "properties": { "children": [`);
  });

  it.each(FACE_CASES)('%s — not the neither-channel text, and not the objectui#6771 remedy it replaces', (_label, type, _arm, _row, key, judge) => {
    const message = issueAt(judge({ type, [key]: CONTENT }), key)!.message;
    // These blocks render their child list: the objectui#9256 text would say the opposite.
    expect(message).not.toContain('reads NEITHER content channel');
    // `BaseSchema`'s `body` remedy points at the node-level `children`, refused here too.
    expect(message).not.toContain('Did you mean `body` → `children`?');
    expect(message).toContain('objectui#10872');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, type, arm, _row, key) => {
    const issue = issueAt(arm.safeParse({ type, [key]: CONTENT }), key)!;
    expect(arm.shape[key]?.description).toBe(issue.message);
    expect(arm.shape.children?.description).toBe(arm.shape.body?.description);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, type, arm, _row, key) => {
    for (const value of [CONTENT, CONTENT[0], 'text', 42, null, {}, []]) {
      expect(issueAt(arm.safeParse({ type, [key]: value }), key)?.code, JSON.stringify(value)).toBe('invalid_type');
    }
  });

  it.each(CASES)('%s — the refusal is a MEMBER of the arm\'s shape', (_label, _type, arm, _row, key) => {
    expect(Object.keys(arm.shape)).toContain(key);
  });
});

/* ── (b) the positive controls — the remedy parses ────────────────────────── */

describe('objectui#10872 batch 6 — the child list the message names parses', () => {
  it.each(FACE_ROWS)('%s — `properties.children` parses, and so does the bare node', (_label, type, judge) => {
    const result = judge({ type, properties: { children: CONTENT } });
    expect(issuesOf(result).map((i) => `${i.path.join('.')}: ${i.code}`)).toEqual([]);
    expect(result.success).toBe(true);
    expect(judge({ type }).success).toBe(true);
  });

  it.each(FACE_ROWS)('%s — nested in a `page`: the bag spelling parses, and the node-level one is refused at its own path', (_label, type, judge) => {
    expect(judge({ type: 'page', children: [{ type, properties: { children: CONTENT } }] }).success).toBe(true);
    const refused = judge({ type: 'page', children: [{ type, children: CONTENT }] });
    expect(refused.success).toBe(false);
    const nested = allIssues(issuesOf(refused)).filter((i) => i.path.join('.') === 'children.0.children');
    expect(nested.some((i) => i.code === 'invalid_type' && i.message.includes('`properties.children`'))).toBe(true);
  });

  it.each(FACES)('%s face: `page:card`\'s whole row is still judged in the bag — `title`, `children` and `footer` parse together', (_face, judge) => {
    const card = { type: 'page:card', properties: { title: 'Summary', bordered: false, children: CONTENT, footer: CONTENT } };
    expect(judge(card).success).toBe(true);
  });
});

/* ── (c) the installed spec: the same verdict, and the member the message names ── */

describe('objectui#10872 batch 6 — `@objectstack/spec` refuses the node-level spelling and declares the bag member', () => {
  it.each(ROWS.map(([type]) => type))('`%s`: the installed spec refuses a node-level `children` and passes `properties.children`', (type) => {
    // CONTROL — the node without it passes the spec's page-component shape,
    // so the refusal below is about the one key.
    expect(PageComponentSchema.safeParse({ type, id: 'n1' }).success).toBe(true);
    const result = PageComponentSchema.safeParse({ type, id: 'n1', children: CONTENT }) as unknown as Result;
    expect(result.success).toBe(false);
    expect(issuesOf(result).find((i) => i.code === 'unrecognized_keys')?.keys).toContain('children');
    expect(PageComponentSchema.safeParse({ type, id: 'n1', properties: { children: CONTENT } }).success).toBe(true);
  });

  it.each(ROWS.map(([type]) => type))('`%s`: the spec row declares the `children` member the refusal sends the author to', (type) => {
    const row = (ComponentPropsMap as unknown as Record<string, { shape: Record<string, unknown>; safeParse: (v: unknown) => Result }>)[type];
    expect(Object.keys(row.shape)).toContain('children');
    expect(row.safeParse({ children: CONTENT }).success).toBe(true);
  });
});

/* ── (d) the props-bag helper fold — no behaviour moves ───────────────────── */

describe('objectui#10872 batch 6 — `objectql.zod.ts`\'s public-block arms use the one `propsBag`', () => {
  const descriptionOf = (arm: unknown) => (arm as Arm).shape.properties?.description;

  it('the `properties` description is the text the helper composes, word for word', () => {
    expect(descriptionOf(ObjectMetricBlockSchema)).toBe(
      'The `object-metric` props bag — `@objectstack/spec` `ComponentPropsMap[\'object-metric\']`, by reference. '
      + 'Judged only when present, as the spec\'s props gate judges it.',
    );
  });

  it.each([
    ['object-metric', ObjectMetricBlockSchema],
    ['object-master-detail-form', ObjectMasterDetailFormBlockSchema],
  ] as const)('`%s` — the same composer as the `public-blocks.zod.ts` arms, and the bag stays optional', (type, arm) => {
    expect(descriptionOf(arm)).toBe(descriptionOf(PageCardBlockSchema)!.split('page:card').join(type));
    expect((arm as unknown as Arm).safeParse({ type }).success).toBe(true);
  });
});
