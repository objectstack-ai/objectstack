/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8284 — each component schema narrows to the content channel its
 * renderer actually reads and TOMBSTONES the other, on both published faces
 * (maintainer ruling, summon #17 decision batch #2, 2026-09-07, verbatim
 * 「同意」). This file pins that rule on the twelve dedicated declarations
 * listed in `ROWS`.
 *
 * ## The defect this pins closed
 *
 * `BaseSchema` used to declare TWO optional content channels, and its docblock
 * admitted that "some components use `children` instead of `body`" WITHOUT
 * saying which. The zod base is `.passthrough()` and both keys were optional,
 * so a node carrying the WRONG channel type-checked, parsed green, was
 * PRESERVED by the parse, and then rendered an EMPTY element — no error at
 * authoring time, none at validation time, none at render time. Seven cards
 * repaired one page of that each (#5027 · #3900 · #6773 · #6806 · #8197 ·
 * #8234 · #6939) before the declaration itself was named.
 *
 * objectui#6771 has since retired `body` as a child-list spelling on every
 * node: `BaseSchema.body` is `never` on the TypeScript face and refused by name
 * on the zod mirror, and `children` is the one child-list key. So on every row
 * below the renderer reads `children` and the refused channel is `body`. What
 * this file still pins is objectui#8284's own refusal on each row's DEDICATED
 * declaration: it is installed there, it names both keys and this card, it is
 * the `.describe()` metadata too, and it reaches a nested node.
 *
 * ## The population here is FAMILY A + B of the measured table, not "all"
 *
 * The table posted on objectui#8284 is derived from every
 * `ComponentRegistry.register(...)` call under
 * `packages/components/src/renderers/**` (114 registrations when it was taken)
 * and the read side is measured with the TypeScript TYPE CHECKER — each
 * `body` / `children` property access is filed under the TYPE of the object it
 * is read from, so a docblock mention cannot score.
 *
 * ⚠️ THE CONTROL MOVED, because objectui#6771 SPENT the one that stood here.
 * It read: the `BoxSchema` docblock in `renderers/layout/box.tsx` SAYS
 * `schema.body` in prose and `grep -l` counts it, the checker does not — and
 * the card's own `17 / 17` figure came from that query. objectui#6771 rewrote
 * that docblock, so `box.tsx` now answers 0 to BOTH halves and a reader replaying it
 * gets no divergence at all. ⛔ A control that cannot fire is worse than none:
 * it reads as evidence and is not.
 *
 * ⭐ The live control is `renderers/basic/span.tsx`, whose JSX comment says
 * "This read used to be `schema.body`" and carries no such property access.
 * Measured with the repo's own masker (`scripts/js-comment-mask.mjs`, the
 * instrument the producer scan projects): the raw text answers 1 — what
 * `grep -l` counts — and the comment-stripped text answers 0 — what the checker
 * can see. ⇒ the divergence is live and replayable. The masker is controlled on
 * the same run rather than trusted: `schema.bodyExtra` in
 * `renderers/action/action-icon.tsx` is a REAL property access and survives
 * stripping at 1, so the 0 above is a reading and not a blanked file.
 *
 * The twelve rows below are the ones that table measured as reading EXACTLY ONE
 * channel, owning a dedicated declaration, and claimed by exactly one
 * registration. `sidebar` was measured into family B and held BACK, because two
 * registrations claim `sidebar` and the second types its schema prop `any`; it
 * is not a row here. The other families are not pinned in this file:
 * family C (read both, through a live `children || body` fallback) lost its
 * `body` arm to objectui#6771 and reads the `children` channel only; family D
 * (reads neither) is pinned by `content-channel-family-d-9256.test.ts`
 * (objectui#9256); family E (no dedicated declaration) was ruled done or
 * superseded by objectui#6771 and objectui#9910, with its residual moved to
 * objectui#9256 (ruling 5861449497 on objectui#8284).
 *
 * ## What is NOT pinned here, and why
 *
 * ⛔ Not the renderers. This file pins the two authoring faces only: a
 * document that authors the channel its renderer reads parses and compiles,
 * and a document that authors `body` is refused by both.
 * The render side is pinned elsewhere, by counter-probes that deliberately
 * author the dead channel (`body`) and assert the empty render:
 * `examples/schema-catalog/test/badge-demo-label-6829.test.tsx` and
 * `packages/components/src/__tests__/span-children-rendering.test.tsx`.
 *
 * ## ⚠️ Half of this file is a COMPILE-TIME assertion and vitest CANNOT read it
 *
 * `?: never` narrowings are erased before a test runs. The `@ts-expect-error`
 * lines below are read by `tsc -p tsconfig.test.json` (the `type-check`
 * script), NOT by this runner: under vitest alone, removing a tombstone from
 * the TypeScript face leaves every case here GREEN. Both readers are the gate;
 * either alone reports NOT MEASURED.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type {
  BoxSchema, TextSpanSchema, ContainerSchema, FlexSchema, StackSchema, GridSchema, ScrollAreaSchema, TextSchema,
} from '../layout';
import type { FormSchema, ToggleSchema } from '../form';
import type { AlertSchema, BadgeSchema } from '../data-display';
import type { TooltipSchema } from '../overlay';
import {
  BoxSchema as BoxMirror,
  TextSpanSchema as SpanMirror,
  ContainerSchema as ContainerMirror,
  FlexSchema as FlexMirror,
  StackSchema as StackMirror,
  GridSchema as GridMirror,
  ScrollAreaSchema as ScrollAreaMirror,
} from '../zod/layout.zod';
import { FormSchema as FormMirror, ToggleSchema as ToggleMirror } from '../zod/form.zod';
import { AlertSchema as AlertMirror, BadgeSchema as BadgeMirror } from '../zod/data-display.zod';
import { TooltipSchema as TooltipMirror } from '../zod/overlay.zod';
import { AnyComponentSchema } from '../zod/index.zod';

type Mirror = { safeParse: (v: unknown) => { success: boolean; error?: z.ZodError }; shape: Record<string, { description?: string }> };

/**
 * One row of the measured table: the node, its mirror, the live channel, the
 * tombstoned one, and the node's OTHER required members — `form` requires
 * `fields`, so a bare `{ type: 'form' }` is refused for a reason that has
 * nothing to do with this change and would read as a false positive here.
 */
const ROWS: ReadonlyArray<readonly [
  type: string, mirror: Mirror, live: 'body' | 'children', dead: 'body' | 'children', required: Record<string, unknown>,
]> = [
  ['box', BoxMirror as unknown as Mirror, 'children', 'body', {}],
  ['span', SpanMirror as unknown as Mirror, 'children', 'body', {}],
  ['container', ContainerMirror as unknown as Mirror, 'children', 'body', {}],
  ['flex', FlexMirror as unknown as Mirror, 'children', 'body', {}],
  ['stack', StackMirror as unknown as Mirror, 'children', 'body', {}],
  ['grid', GridMirror as unknown as Mirror, 'children', 'body', {}],
  ['scroll-area', ScrollAreaMirror as unknown as Mirror, 'children', 'body', {}],
  ['form', FormMirror as unknown as Mirror, 'children', 'body', { fields: [] }],
  ['toggle', ToggleMirror as unknown as Mirror, 'children', 'body', {}],
  // ⚠️ THESE THREE SWAPPED SIDES with objectui#6771, and the rule did not.
  // `alert`, `badge` and `tooltip` were family B — the renderer read `body`
  // and `children` was the dead channel — because `body` was the ONLY door on
  // a dozen registrations. That ruling retired the spelling; the renderers
  // converged on `children`, so the channel each of them does not read is now
  // `body`, and the tombstone moved with the read. What is pinned here is
  // objectui#8284's rule, not a fixed key per component: every assertion below
  // reads `live` / `dead` out of this table.
  ['alert', AlertMirror as unknown as Mirror, 'children', 'body', {}],
  ['badge', BadgeMirror as unknown as Mirror, 'children', 'body', {}],
  ['tooltip', TooltipMirror as unknown as Mirror, 'children', 'body', {}],
];

const CONTENT: TextSchema[] = [{ type: 'text', content: 'measured' }];
const issues = (m: Mirror, doc: unknown) => {
  const r = m.safeParse(doc);
  return r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

/* ── (a) the tombstoned channel is REFUSED BY NAME, at its own path ───────── */

describe('objectui#8284 — the channel a renderer does not read is refused by name', () => {
  it.each(ROWS)('`%s` refuses its DEAD channel at that key\'s own path', (type, mirror, _live, dead, required) => {
    const found = issues(mirror, { type, ...required, [dead]: CONTENT });
    expect(found, `${type}.${dead} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(found!.some((i) => i.path === dead && i.code === 'invalid_type')).toBe(true);
  });

  it.each(ROWS)('`%s` — the message names the dead key AND the live one, so the author is told what to write', (type, mirror, live, dead, required) => {
    const issue = issues(mirror, { type, ...required, [dead]: CONTENT })!.find((i) => i.path === dead)!;
    expect(issue.message).toContain(`\`${dead}\``);
    expect(issue.message).toContain(`\`${live}\``);
    expect(issue.message).toContain('objectui#8284');
  });

  it.each(ROWS)('`%s` — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (type, mirror, _live, dead, required) => {
    const issue = issues(mirror, { type, ...required, [dead]: CONTENT })!.find((i) => i.path === dead)!;
    expect(mirror.shape[dead]?.description).toBe(issue.message);
  });

  it.each(ROWS)('`%s` — the refusal is about the KEY, not a value domain: every value is refused', (type, mirror, _live, dead, required) => {
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(issues(mirror, { type, ...required, [dead]: value })?.some((i) => i.path === dead)).toBe(true);
    }
  });
});

/* ── (b) CONTROLS — nothing that rendered stops parsing ───────────────────── */

describe('objectui#8284 — CONTROLS: the live channel, and an unrelated key, are untouched', () => {
  it.each(ROWS)('`%s` still accepts its LIVE channel — the document that renders today is unchanged', (type, mirror, live, _dead, required) => {
    expect(issues(mirror, { type, ...required, [live]: CONTENT }), `${type}.${live} was refused — the narrowing hit the wrong channel`).toBeNull();
  });

  it.each(ROWS)('`%s` still accepts a bare node and a `className` — the unknown-key policy is byte-identical', (type, mirror, _live, _dead, required) => {
    expect(issues(mirror, { type, ...required })).toBeNull();
    expect(issues(mirror, { type, ...required, className: 'p-4' })).toBeNull();
  });

  it.each(ROWS)('`%s` — the tombstone is a MEMBER of the mirror shape, so the parity ratchet\'s key sets stay equal', (_type, mirror, _live, dead) => {
    expect(Object.keys(mirror.shape)).toContain(dead);
  });
});

/* ── (c) the refusal reaches NESTED nodes, not only the root ──────────────── */

describe('objectui#8284 — a nested node is refused too (the objectui#8344 recursion point selects the arm)', () => {
  it('a `scroll-area` authoring `body` INSIDE a `box`\'s `children` is REFUSED — the tombstone is not a root-only rule', () => {
    const r = AnyComponentSchema.safeParse({
      type: 'box',
      children: [{ type: 'scroll-area', body: CONTENT }],
    });
    expect(r.success).toBe(false);
    // ⚠️ The child slot is a `z.union`, so what surfaces is ONE
    // `invalid_union` at `children` carrying objectui#8344's capped message —
    // the nested `body` path and the remedy text are collapsed by that union,
    // not by this change. Measured at the ROOT in block (a), where the arm is
    // selected directly and the full guidance is reported.
    expect(r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') })))
      .toEqual([{ code: 'invalid_union', path: 'children' }]);
  });

  it('CONTROL — the same tree authoring `children` on the `scroll-area` parses', () => {
    expect(AnyComponentSchema.safeParse({
      type: 'box',
      children: [{ type: 'scroll-area', children: CONTENT }],
    }).success).toBe(true);
  });
});

/* ── (d) the TypeScript face — ⚠️ READ BY `tsc`, NOT BY VITEST ────────────── */

describe('objectui#8284 — the TypeScript face refuses the dead channel at the AUTHORING site', () => {
  it('the `@ts-expect-error` lines in this block are the assertion; vitest only proves they are reachable', () => {
    // Family A — the renderer reads `children`; `body` is `?: never`.
    // @ts-expect-error objectui#8284 — `box` reads `children`, never `body`
    const box: BoxSchema = { type: 'box', body: CONTENT };
    // @ts-expect-error objectui#8284 — `span` reads `children`, never `body`
    const span: TextSpanSchema = { type: 'span', body: CONTENT };
    // @ts-expect-error objectui#8284 — `container` reads `children`, never `body`
    const container: ContainerSchema = { type: 'container', body: CONTENT };
    // @ts-expect-error objectui#8284 — `flex` reads `children`, never `body`
    const flex: FlexSchema = { type: 'flex', body: CONTENT };
    // @ts-expect-error objectui#8284 — `stack` reads `children`, never `body`
    const stack: StackSchema = { type: 'stack', body: CONTENT };
    // @ts-expect-error objectui#8284 — `grid` reads `children`, never `body`
    const grid: GridSchema = { type: 'grid', body: CONTENT };
    // @ts-expect-error objectui#8284 — `scroll-area` reads `children`, never `body`
    const scrollArea: ScrollAreaSchema = { type: 'scroll-area', body: CONTENT };
    // @ts-expect-error objectui#8284 — `form` reads `children`, never `body`
    const form: FormSchema = { type: 'form', body: CONTENT };
    // @ts-expect-error objectui#8284 — `toggle` reads `children`, never `body`
    const toggle: ToggleSchema = { type: 'toggle', body: CONTENT };

    // Family B — these three read `body` until objectui#6771 retired it. The
    // renderers converged on `children`, so the refused channel is now `body`
    // on them too, and this block reads the same way for all twelve.
    // @ts-expect-error objectui#8284 — `alert` reads `children`, never `body`
    const alert: AlertSchema = { type: 'alert', body: CONTENT };
    // @ts-expect-error objectui#8284 — `badge` reads `children`, never `body`
    const badge: BadgeSchema = { type: 'badge', body: CONTENT };
    // @ts-expect-error objectui#8284 — `tooltip` reads `content`/`children`, never `body`
    const tooltip: TooltipSchema = { type: 'tooltip', body: CONTENT };

    expect([box, span, container, flex, stack, grid, scrollArea, form, toggle, alert, badge, tooltip]).toHaveLength(12);
  });

  it('CONTROL — the LIVE channel compiles on every one of the twelve (no `@ts-expect-error` here, and `tsc` is the reader)', () => {
    const live = [
      { type: 'box', children: CONTENT } satisfies BoxSchema,
      { type: 'span', children: CONTENT } satisfies TextSpanSchema,
      { type: 'container', children: CONTENT } satisfies ContainerSchema,
      { type: 'flex', children: CONTENT } satisfies FlexSchema,
      { type: 'stack', children: CONTENT } satisfies StackSchema,
      { type: 'grid', children: CONTENT } satisfies GridSchema,
      { type: 'scroll-area', children: CONTENT } satisfies ScrollAreaSchema,
      { type: 'form', children: CONTENT } satisfies FormSchema,
      { type: 'toggle', children: CONTENT } satisfies ToggleSchema,
      { type: 'alert', children: CONTENT } satisfies AlertSchema,
      { type: 'badge', children: CONTENT } satisfies BadgeSchema,
      { type: 'tooltip', children: CONTENT } satisfies TooltipSchema,
    ];
    expect(live).toHaveLength(12);
  });
});
