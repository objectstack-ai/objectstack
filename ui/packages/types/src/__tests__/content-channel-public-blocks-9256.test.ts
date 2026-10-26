/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9256 — the PUBLIC-BLOCK slice: the nineteen ADR-0080 public-block
 * arms whose renderer reads NEITHER content channel, plus `metric-card` in the
 * dashboard widget slot. Family D's earlier pins live in
 * `content-channel-family-d-9256.test.ts`, `content-channel-e3-residual-9256.test.ts`,
 * `content-channel-input-9256.test.ts` and `content-channel-remeasure-9256.test.ts`;
 * this file carries only what this slice adds.
 *
 * ## What is narrowed here
 *
 *   - Eighteen zod-only arms — sixteen in `zod/public-blocks.zod.ts`
 *     (`page:header`, `page:tabs`, `page:accordion`, the nine `record:` blocks
 *     below, and the four `element:` blocks) and two in `zod/objectql.zod.ts`
 *     (`object-metric`, `object-master-detail-form`): a by-name refusal of
 *     `children`, and `body` restated with the same neither-channel guidance,
 *     each kept a MEMBER. No TypeScript declaration in this package restates
 *     any of these nodes, so the zod arm is the only face that moves.
 *   - `record:alert`: `children` only. Its renderer reads a key named `body` as
 *     the message TEXT, so `body` is not a content channel there, and this
 *     slice gives it no tombstone. (A flat `body` there now has its own alias
 *     refusal naming `properties.body`, objectui#10872, pinned in
 *     `record-alert-flat-body-remedy-10872.test.ts`.)
 *   - `page:tabs` / `page:accordion`: the NODE's channels only. Each renders the
 *     `children` of every ITEM in its `items` bag member, and that item-level
 *     key stays live.
 *   - `metric-card`: `children?: never` (and `body` restated) on the TypeScript
 *     face `DashboardWidgetSlotComponentSchema`, and both members on its
 *     private zod twin, the first arm of the widget slot's `z.union`.
 *
 * ## ⚠️ How a `metric-card` refusal surfaces — measured, and the pin follows it
 *
 * The slot arm is not reachable on its own: `widgets` is
 * `z.union([slot arm, strict DashboardWidgetSchema])`. A widget the slot arm
 * refuses falls through to the strict widget schema, which refuses the same
 * key as unrecognized, so the author gets ONE `invalid_union` at the widget's
 * path with each arm's issues under `errors`. The slot arm's message is there,
 * at the arm-relative path `['children']`, and `objectui validate` prints it as
 * one arm of two. So the metric-card rows below assert the refusal INSIDE the
 * union's `errors`, not as a top-level issue — a top-level assertion would pin
 * a shape the union never produces.
 *
 * ## ⚠️ Half of the metric-card block is a COMPILE-TIME assertion
 *
 * `?: never` is erased before a test runs. The `@ts-expect-error` lines at the
 * bottom are read by `tsc -p tsconfig.test.json` (the `type-check` script),
 * NOT by vitest: under vitest alone, deleting the TypeScript tombstone leaves
 * this file GREEN.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  PageHeaderBlockSchema,
  PageTabsBlockSchema,
  PageAccordionBlockSchema,
  RecordDetailsBlockSchema,
  RecordHighlightsBlockSchema,
  RecordRelatedListBlockSchema,
  RecordPathBlockSchema,
  RecordActivityBlockSchema,
  RecordDiscussionBlockSchema,
  RecordHistoryBlockSchema,
  RecordQuickActionsBlockSchema,
  RecordReferenceRailBlockSchema,
  RecordAlertBlockSchema,
  ElementTextBlockSchema,
  ElementNumberBlockSchema,
  ElementButtonBlockSchema,
  ElementDividerBlockSchema,
  PageCardBlockSchema,
  PageSectionBlockSchema,
  PageFooterBlockSchema,
  PageSidebarBlockSchema,
} from '../zod/public-blocks.zod';
import { ObjectMetricBlockSchema, ObjectMasterDetailFormBlockSchema } from '../zod/objectql.zod';
import { DashboardComponentSchema as DashboardMirror } from '../zod/complex.zod';
import { AnyComponentSchema } from '../zod/index.zod';
import type { DashboardWidgetSlotComponentSchema } from '../complex';

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
  errors?: Issue[][];
};
type Mirror = {
  safeParse: (v: unknown) => { success: boolean; error?: z.ZodError };
  shape: Record<string, { description?: string } | undefined>;
};

/** One row per arm whose renderer reads NEITHER channel: both channels are refused. */
const ROWS: ReadonlyArray<readonly [type: string, mirror: Mirror]> = [
  ['page:header', PageHeaderBlockSchema as unknown as Mirror],
  ['page:tabs', PageTabsBlockSchema as unknown as Mirror],
  ['page:accordion', PageAccordionBlockSchema as unknown as Mirror],
  ['record:details', RecordDetailsBlockSchema as unknown as Mirror],
  ['record:highlights', RecordHighlightsBlockSchema as unknown as Mirror],
  ['record:related_list', RecordRelatedListBlockSchema as unknown as Mirror],
  ['record:path', RecordPathBlockSchema as unknown as Mirror],
  ['record:activity', RecordActivityBlockSchema as unknown as Mirror],
  ['record:discussion', RecordDiscussionBlockSchema as unknown as Mirror],
  ['record:history', RecordHistoryBlockSchema as unknown as Mirror],
  ['record:quick_actions', RecordQuickActionsBlockSchema as unknown as Mirror],
  ['record:reference_rail', RecordReferenceRailBlockSchema as unknown as Mirror],
  ['element:text', ElementTextBlockSchema as unknown as Mirror],
  ['element:number', ElementNumberBlockSchema as unknown as Mirror],
  ['element:button', ElementButtonBlockSchema as unknown as Mirror],
  ['element:divider', ElementDividerBlockSchema as unknown as Mirror],
  ['object-metric', ObjectMetricBlockSchema as unknown as Mirror],
  ['object-master-detail-form', ObjectMasterDetailFormBlockSchema as unknown as Mirror],
];

const CHANNELS = ['body', 'children'] as const;
const CONTENT = [{ type: 'text', content: 'measured' }];
const issuesOf = (m: Mirror, doc: unknown): Issue[] | null => {
  const r = m.safeParse(doc);
  return r.success ? null : (r.error!.issues as unknown as Issue[]);
};
const at = (issues: Issue[] | null, key: string) => issues?.find((i) => i.path.join('.') === key);
const CASES = ROWS.flatMap(([type, mirror]) => CHANNELS.map((key) => [`${type}.${key}`, type, mirror, key] as const));

/* ── (a) both channels are REFUSED BY NAME, at the key's own path ─────────── */

describe('objectui#9256 public blocks — both content channels are refused where the renderer reads neither', () => {
  it('the population is the narrowed one — a row dropped from the table fails here', () => {
    // 18 two-channel rows + `record:alert`'s one channel = the nineteen arms.
    expect(ROWS).toHaveLength(18);
    expect(CASES).toHaveLength(36);
  });

  it.each(CASES)('%s is refused at that key\'s own path', (label, type, mirror, key) => {
    const found = issuesOf(mirror, { type, [key]: CONTENT });
    expect(found, `${label} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(at(found, key)?.code).toBe('invalid_type');
  });

  it.each(CASES)('%s — the message names the channel, the card, and what the node renders instead', (_label, type, mirror, key) => {
    const issue = at(issuesOf(mirror, { type, [key]: CONTENT }), key)!;
    expect(issue.message).toContain(`\`${type}\` reads NEITHER content channel`);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('What it renders instead: ');
    // ⛔ Not `BaseSchema`'s generic `body` refusal, which names `children` as
    // the remedy — on these nodes `children` is refused as well.
    expect(issue.message).not.toContain('Did you mean');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, type, mirror, key) => {
    const issue = at(issuesOf(mirror, { type, [key]: CONTENT }), key)!;
    expect(mirror.shape[key]?.description).toBe(issue.message);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, type, mirror, key) => {
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(at(issuesOf(mirror, { type, [key]: value }), key), JSON.stringify(value)).toBeDefined();
    }
  });

  it.each(CASES)('%s — the refusal reaches the node through `AnyComponentSchema`, not only its own arm', (_label, type, _mirror, key) => {
    expect(AnyComponentSchema.safeParse({ type }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type, [key]: CONTENT }).success).toBe(false);
  });

  it.each(CASES)('%s — the tombstone is a MEMBER of the arm\'s shape', (_label, _type, mirror, key) => {
    expect(Object.keys(mirror.shape)).toContain(key);
  });
});

/* ── (b) the carve-outs — what this slice deliberately leaves live ────────── */

describe('objectui#9256 public blocks — the carve-outs', () => {
  it('`record:alert` refuses `children` with its OWN message, which does not say the renderer reads no `body`', () => {
    const issue = at(issuesOf(RecordAlertBlockSchema as unknown as Mirror, { type: 'record:alert', children: CONTENT }), 'children');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toContain('`record:alert` renders no child list');
    expect(issue?.message).toContain('objectui#9256');
    expect(issue?.message).toContain('What it renders instead: ');
    // The neither-channel builder's sentence is FALSE here: this renderer reads
    // a key named `body` (the message text). The row must not carry it.
    expect(issue?.message).not.toContain('reads NEITHER content channel');
    expect((RecordAlertBlockSchema as unknown as Mirror).shape.children?.description).toBe(issue?.message);
  });

  it('`record:alert`\'s `body` gets no neither-channel tombstone: a flat `body` is refused toward `properties.body`, and `properties.body` still parses', () => {
    const issue = at(issuesOf(RecordAlertBlockSchema as unknown as Mirror, { type: 'record:alert', body: 'Overdue' }), 'body');
    expect(issue?.code).toBe('invalid_type');
    // Not this slice's tombstone: this renderer DOES read a key named `body`.
    expect(issue?.message).not.toContain('reads NEITHER content channel');
    expect(issue?.message).not.toContain('REFUSED (objectui#9256');
    // The remedy is objectui#10872's; its own pins live in
    // `record-alert-flat-body-remedy-10872.test.ts`.
    expect(issue?.message).toContain('`properties.body`');
    // CONTROL — the message TEXT, where the spec row declares it, is live.
    expect(AnyComponentSchema.safeParse({ type: 'record:alert', properties: { severity: 'warning', body: 'Overdue' } }).success)
      .toBe(true);
  });

  it.each(['page:tabs', 'page:accordion'])('`%s` still takes `children` on each ITEM — only the node\'s own channel is refused', (type) => {
    const item = { label: 'Details', children: CONTENT };
    expect(AnyComponentSchema.safeParse({ type, properties: { items: [item] } }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ type, properties: { items: [item] }, children: CONTENT }).success).toBe(false);
  });

  it.each([
    ['page:card', PageCardBlockSchema],
    ['page:section', PageSectionBlockSchema],
    ['page:footer', PageFooterBlockSchema],
    ['page:sidebar', PageSidebarBlockSchema],
  ] as const)('CONTROL — `%s` renders its child list, so it still takes one, in `properties.children`', (type, mirror) => {
    // Measured in the same run as the rows above: a reader keeps its channel. Its spelling is the
    // spec row's `children` member, in the bag: objectui#10872 batch 6 refuses the node-level one,
    // with a message that names the bag member and never this slice's neither-channel text
    // (`container-children-channel-10872.test.ts` pins that refusal).
    expect(issuesOf(mirror as unknown as Mirror, { type, properties: { children: CONTENT } })).toBeNull();
    expect(AnyComponentSchema.safeParse({ type, properties: { children: CONTENT } }).success).toBe(true);
    expect(at(issuesOf(mirror as unknown as Mirror, { type, children: CONTENT }), 'children')?.message)
      .not.toContain('reads NEITHER content channel');
  });

  it('a narrowed block nested in a `page` is refused; the same block without a child list parses', () => {
    const page = (block: Record<string, unknown>) => ({ type: 'page', children: [block] });
    expect(AnyComponentSchema.safeParse(page({ type: 'record:details' })).success).toBe(true);
    expect(AnyComponentSchema.safeParse(page({ type: 'record:details', children: CONTENT })).success).toBe(false);
  });
});

/* ── (c) `metric-card` — the refusal lives INSIDE the widget-slot union ───── */

describe('objectui#9256 public blocks — `metric-card` in the dashboard widget slot', () => {
  const dashboard = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });
  const card = { type: 'metric-card', title: 'Revenue', value: '42' };
  const unionIssue = (doc: unknown) =>
    issuesOf(DashboardMirror as unknown as Mirror, doc)?.find((i) => i.path.join('.') === 'widgets.0');

  it('CONTROL — the card without a content channel parses, on the arm and at the root', () => {
    expect(issuesOf(DashboardMirror as unknown as Mirror, dashboard(card))).toBeNull();
    expect(AnyComponentSchema.safeParse(dashboard(card)).success).toBe(true);
  });

  it.each(CHANNELS)('`%s` is refused: ONE `invalid_union` at the widget, the slot arm\'s by-name refusal among its `errors`', (key) => {
    const issue = unionIssue(dashboard({ ...card, [key]: CONTENT }));
    expect(issue?.code).toBe('invalid_union');
    const armIssues = (issue?.errors ?? []).flat();
    // The slot arm reports RELATIVE to the widget — the path is the key alone.
    const refusal = armIssues.find((i) => i.path.join('.') === key && i.code === 'invalid_type');
    expect(refusal?.message).toContain('`metric-card` reads NEITHER content channel');
    expect(refusal?.message).toContain('objectui#9256');
    expect(refusal?.message).toContain('What it renders instead: ');
    expect(refusal?.message).not.toContain('Did you mean');
    // The fall-through arm refuses the same key too, so no arm accepts it.
    const strict = armIssues.find((i) => i.code === 'unrecognized_keys');
    expect(strict?.keys).toContain(key);
    expect(AnyComponentSchema.safeParse(dashboard({ ...card, [key]: CONTENT })).success).toBe(false);
  });

  it('the TypeScript face refuses both channels at the AUTHORING site (`tsc` is the reader)', () => {
    const ok = { type: 'metric-card', title: 'Revenue', value: '42' } satisfies DashboardWidgetSlotComponentSchema;
    // @ts-expect-error objectui#9256 — `metric-card` reads neither channel
    const withChildren: DashboardWidgetSlotComponentSchema = { ...ok, children: CONTENT };
    // @ts-expect-error objectui#9256 — `metric-card` reads neither channel
    const withBody: DashboardWidgetSlotComponentSchema = { ...ok, body: CONTENT };
    expect([ok, withChildren, withBody]).toHaveLength(3);
  });
});
