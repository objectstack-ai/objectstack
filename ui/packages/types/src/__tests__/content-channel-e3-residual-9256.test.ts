/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9256 — the E3 RESIDUAL: registrations that have a published arm and
 * whose renderer reads NEITHER content channel, moved onto this card by the
 * maintainer's ruling on objectui#8284 (Q2 A: family-D-shaped, narrowed under
 * that card's ruling 「1」 — every component schema narrows to the channel its
 * renderer actually reads and tombstones the other). Family D's own pins live in
 * `content-channel-family-d-9256.test.ts`; this file carries the ones this slice
 * adds, and nothing it pins is restated there.
 *
 * ## What is narrowed here
 *
 * The nine `object-*` views, `detail-view`, and the `email` / `password` input
 * shorthands: both `body` and `children` are `?: never` on the TypeScript face
 * and a by-name refusal on the zod mirror (two `retirementTombstone` members fed
 * one `neitherContentChannelGuidance` string), each kept a MEMBER so
 * `zod-mirror-parity`'s key sets stay equal. `body` was already refused by `BaseSchema` (objectui#6771), but
 * that refusal names `children` as the remedy and `children` is dead here too,
 * so each node restates it with a message naming what the node renders instead.
 *
 * READERSHIP was measured, not inherited from the ruling's table: a TypeScript
 * compiler-API sweep over one program per workspace package, on a BUILT tree,
 * files every `.body` / `.children` read under the declared type of its
 * receiver. It answers zero for every declaration narrowed here while its lit
 * controls (`ButtonSchema`, `DivSchema`, `CardSchema`, `ContainerSchema`) fire,
 * and the same program sees every one of these declarations as the receiver of
 * the keys its renderer reads, so the zeros are readings and not blindness.
 * Every registration hop here is `any`-typed; each was attributed directly —
 * it hands the node to a component typed by the declaration above, or (for
 * `email` / `password`) spreads it into the `input` renderer typed
 * `InputSchema`. The delegation hosts were checked for pass-through: every node
 * `ObjectView` / `ObjectForm` / `ObjectGrid` / `ObjectChart` / `DetailView`
 * hands to `SchemaRenderer` is assembled from named keys or from a sub-key, and
 * none copies the host's own channel.
 *
 * ## The `Omit` erasure, repaired (the ruling's execution parameter 3)
 *
 * `InputShorthandSchema` and `UiCalendarSchema` were spelled `Omit< Base, K >`
 * over an interface carrying `BaseSchema`'s index signature, so the published
 * face declared nothing but what the interface wrote itself: `body` type-checked
 * on `email`, `children` on `ui:calendar`, and `label: 42` on `email`. Both now
 * inherit through `OmitDeclared` (`../form.ts`). `ui:calendar` gains NO new
 * refusal: its face re-exposes what `CalendarSchema` already declares, and its
 * mirror — a `.extend()` of that one — already refused both channels.
 *
 * ## HELD, and why — a decision, not appetite
 *
 * `br`, `hr` and `img` read neither channel either — the factory in
 * `renderers/basic/html-elements.tsx` passes `undefined` as a void tag's child —
 * but their only published arm is `HtmlElementSchema`, ONE object over 38 tags
 * whose renderer draws `children` for the other 35. Refusing the key on three
 * tags means splitting that family arm, which the option the ruling adopted
 * leaves to the parser tier (the registration declares no `children` slot on a
 * void tag, so `validateTree` already names it `not-a-container`) and which
 * objectui#9067's ruling declined for these families. The CONTROL below pins
 * the shared-arm reason, so the hold is visible rather than forgotten.
 *
 * ## ⚠️ Half of this file is a COMPILE-TIME assertion and vitest CANNOT read it
 *
 * `?: never` is erased before a test runs. The `@ts-expect-error` lines in the
 * last block are read by `tsc -p tsconfig.test.json` (the `type-check` script),
 * NOT by this runner: under vitest alone, deleting a tombstone from the
 * TypeScript face leaves every case here GREEN. Both readers are the gate.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ObjectGridSchema as ObjectGridMirror,
  ObjectFormSchema as ObjectFormMirror,
  ObjectKanbanSchema as ObjectKanbanMirror,
  ObjectMapSchema as ObjectMapMirror,
  ObjectTreeSchema as ObjectTreeMirror,
  ObjectViewSchema as ObjectViewMirror,
  ObjectGanttSchema as ObjectGanttMirror,
  ObjectCalendarSchema as ObjectCalendarMirror,
  ObjectChartSchema as ObjectChartMirror,
} from '../zod/objectql.zod';
import { DetailViewSchema as DetailViewMirror } from '../zod/views.zod';
import { InputShorthandSchema as InputShorthandMirror } from '../zod/form.zod';
import { HtmlElementSchema as HtmlElementMirror } from '../zod/layout.zod';
import { AnyComponentSchema } from '../zod/index.zod';
import type {
  ObjectGridSchema,
  ObjectFormSchema,
  ObjectKanbanSchema,
  ObjectMapSchema,
  ObjectTreeSchema,
  ObjectViewSchema,
  ObjectGanttSchema,
  ObjectCalendarSchema,
  ObjectChartSchema,
} from '../objectql';
import type { DetailViewSchema } from '../views';
import type { CalendarSchema, InputSchema, InputShorthandSchema, UiCalendarSchema } from '../form';

type Mirror = {
  safeParse: (v: unknown) => { success: boolean; error?: z.ZodError };
  shape: Record<string, { description?: string } | undefined>;
};

/**
 * One row per narrowed `type`: its mirror and the node's OTHER required
 * members — a bare `{ type: 'object-form' }` is refused for reasons that have
 * nothing to do with this change, and would read here as a false positive. The
 * CONTROL block proves every `required` set parses on its own.
 */
const ROWS: ReadonlyArray<readonly [type: string, mirror: Mirror, required: Record<string, unknown>]> = [
  // The flat mirror is the node as `ObjectGrid` reads it after the `properties`
  // hoist; the AUTHORED node takes the same members in the bag
  // (`AUTHORED_REQUIRED` below, objectui#11276's `object-grid` batch).
  ['object-grid', ObjectGridMirror as unknown as Mirror, { objectName: 'account' }],
  // The flat mirror is the node as `ObjectForm` reads it after the `properties`
  // hoist; the AUTHORED node takes the same members in the bag
  // (`AUTHORED_REQUIRED` below, objectui#10859 batch 4).
  ['object-form', ObjectFormMirror as unknown as Mirror, { objectName: 'account', mode: 'create' }],
  ['object-kanban', ObjectKanbanMirror as unknown as Mirror, { objectName: 'account' }],
  // As `object-form` above: the authored node's spelling is `AUTHORED_REQUIRED`
  // below (objectui#10859 batch 5).
  ['object-map', ObjectMapMirror as unknown as Mirror, { objectName: 'account' }],
  ['object-tree', ObjectTreeMirror as unknown as Mirror, { objectName: 'account' }],
  ['object-view', ObjectViewMirror as unknown as Mirror, { objectName: 'account' }],
  // As `object-form` above: the authored node's spelling is `AUTHORED_REQUIRED`
  // below (objectui#10859 batch 6).
  ['object-gantt', ObjectGanttMirror as unknown as Mirror, { objectName: 'account' }],
  ['object-calendar', ObjectCalendarMirror as unknown as Mirror, { objectName: 'account' }],
  // As `object-form` above: the authored node's spelling is `AUTHORED_REQUIRED`
  // below (objectui#11276).
  ['object-chart', ObjectChartMirror as unknown as Mirror, { objectName: 'account', chartType: 'bar' }],
  ['detail-view', DetailViewMirror as unknown as Mirror, { objectName: 'account' }],
  ['email', InputShorthandMirror as unknown as Mirror, {}],
  ['password', InputShorthandMirror as unknown as Mirror, {}],
];

/**
 * The authored spelling of a row's required members, where it differs from the
 * mirror's: an authored `object-grid`, `object-form`, `object-map`,
 * `object-chart` or `object-gantt` takes its props in the `properties` bag, and
 * `AnyComponentSchema` refuses them flat (objectui#10859 batches 4 to 6;
 * objectui#11276). The mirror rows above keep the post-hoist spelling.
 */
const AUTHORED_REQUIRED: Readonly<Record<string, Record<string, unknown>>> = {
  'object-grid': { properties: { objectName: 'account' } },
  'object-form': { properties: { objectName: 'account', mode: 'create' } },
  'object-map': { properties: { objectName: 'account' } },
  'object-chart': { properties: { objectName: 'account', chartType: 'bar' } },
  'object-gantt': { properties: { objectName: 'account' } },
};

const CHANNELS = ['body', 'children'] as const;
const CONTENT = [{ type: 'text', content: 'measured' }];
const issues = (m: Mirror, doc: unknown) => {
  const r = m.safeParse(doc);
  return r.success ? null : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};
const CASES = ROWS.flatMap(([type, mirror, required]) =>
  CHANNELS.map((key) => [`${type}.${key}`, type, mirror, key, required] as const));

/* ── (a) both channels are REFUSED BY NAME, at the key's own path ─────────── */

describe('objectui#9256 E3 residual — both content channels are refused where the renderer reads neither', () => {
  it('the population is the narrowed one — a row dropped from the table fails here', () => {
    expect(ROWS).toHaveLength(12);
    expect(CASES).toHaveLength(24);
  });

  it.each(CASES)('%s is refused at that key\'s own path', (label, type, mirror, key, required) => {
    const found = issues(mirror, { ...required, type, [key]: CONTENT });
    expect(found, `${label} parsed green — the tombstone is not installed`).not.toBeNull();
    expect(found!.some((i) => i.path === key && i.code === 'invalid_type')).toBe(true);
  });

  it.each(CASES)('%s — the message names the channel, the card, and what the node renders instead', (_label, type, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type, [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(issue.message).toContain(`\`${key}\``);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('NEITHER content channel');
    expect(issue.message).toContain('What it renders instead: ');
    // ⛔ Not `BaseSchema`'s generic `body` refusal, which names `children` as
    // the remedy — on these nodes `children` is refused as well.
    expect(issue.message).not.toContain('Did you mean');
  });

  it.each(CASES)('%s — ONE string feeds both author-facing channels: the issue message IS the `.describe()` metadata', (_label, type, mirror, key, required) => {
    const issue = issues(mirror, { ...required, type, [key]: CONTENT })!.find((i) => i.path === key)!;
    expect(mirror.shape[key]?.description).toBe(issue.message);
  });

  it.each(CASES)('%s — the refusal is about the KEY, not a value domain: every value is refused', (_label, type, mirror, key, required) => {
    for (const value of [CONTENT, 'text', 42, null, {}, []]) {
      expect(issues(mirror, { ...required, type, [key]: value })?.some((i) => i.path === key)).toBe(true);
    }
  });

  it.each(CASES)('%s — the refusal reaches the node through `AnyComponentSchema`, not only its own arm', (_label, type, _mirror, key, mirrorRequired) => {
    const required = AUTHORED_REQUIRED[type] ?? mirrorRequired;
    expect(AnyComponentSchema.safeParse({ ...required, type }).success).toBe(true);
    expect(AnyComponentSchema.safeParse({ ...required, type, [key]: CONTENT }).success).toBe(false);
  });
});

/* ── (b) CONTROLS — nothing that parsed before stops parsing ──────────────── */

describe('objectui#9256 E3 residual — CONTROLS', () => {
  it.each(ROWS)('`%s` still parses with its own required members and a `className`', (type, mirror, required) => {
    expect(issues(mirror, { ...required, type })).toBeNull();
    expect(issues(mirror, { ...required, type, className: 'p-4' })).toBeNull();
  });

  it.each(CASES)('%s — the tombstone is a MEMBER of the mirror shape, so the parity ratchet\'s key sets stay equal', (_label, _type, mirror, key) => {
    expect(Object.keys(mirror.shape)).toContain(key);
  });

  it('a nested narrowed node is refused inside a container that reads `children`', () => {
    const tree = (child: Record<string, unknown>) => ({ type: 'div', children: [child] });
    // The authored spelling: its props in the bag (objectui#11276's `object-grid` batch).
    const grid = { type: 'object-grid', ...AUTHORED_REQUIRED['object-grid'] };
    expect(AnyComponentSchema.safeParse(tree(grid)).success).toBe(true);
    expect(AnyComponentSchema.safeParse(tree({ ...grid, children: CONTENT })).success).toBe(false);
  });

  it('family C still reads a content channel — `div` takes `children`', () => {
    // The distinction this card rests on: a reader keeps its channel, a
    // non-reader loses both. Measured in the same run as the rows above.
    expect(AnyComponentSchema.safeParse({ type: 'div', children: CONTENT }).success).toBe(true);
  });

  it('HELD — `br` / `hr` / `img` share ONE arm with 35 tags that DO render `children`', () => {
    // Why the three void tags are not narrowed here (header, "HELD"): refusing
    // the key on the arm refuses it on `p` too, and `p` renders it. This pins
    // the shared-arm fact the hold rests on; a split of the family arm is the
    // decision it waits on, and that change turns this red on purpose.
    const html = HtmlElementMirror as unknown as Mirror;
    expect(issues(html, { type: 'p', children: CONTENT })).toBeNull();
    expect(issues(html, { type: 'br', children: CONTENT })).toBeNull();
  });
});

/* ── (c) the TypeScript face — ⚠️ READ BY `tsc`, NOT BY VITEST ────────────── */

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

describe('objectui#9256 E3 residual — the TypeScript face refuses both channels at the AUTHORING site', () => {
  // Each refused line spreads a base that the CONTROL test below proves
  // compiles, so the ONLY difference an `@ts-expect-error` can be answering is
  // the channel written beside it — not a missing required member.
  const grid = { type: 'object-grid', objectName: 'account' } satisfies ObjectGridSchema;
  const form = { type: 'object-form', objectName: 'account', mode: 'create' } satisfies ObjectFormSchema;
  const kanban = { type: 'object-kanban', objectName: 'account' } satisfies ObjectKanbanSchema;
  const map = { type: 'object-map', objectName: 'account' } satisfies ObjectMapSchema;
  const tree = { type: 'object-tree', objectName: 'account' } satisfies ObjectTreeSchema;
  const view = { type: 'object-view', objectName: 'account' } satisfies ObjectViewSchema;
  const gantt = { type: 'object-gantt', objectName: 'account' } satisfies ObjectGanttSchema;
  const calendar = { type: 'object-calendar', objectName: 'account' } satisfies ObjectCalendarSchema;
  const chart = { type: 'object-chart', objectName: 'account', chartType: 'bar' } satisfies ObjectChartSchema;
  const detail = { type: 'detail-view', objectName: 'account' } satisfies DetailViewSchema;
  const email = { type: 'email' } satisfies InputShorthandSchema;
  const password = { type: 'password' } satisfies InputShorthandSchema;
  const uiCalendar = { type: 'ui:calendar' } satisfies UiCalendarSchema;

  it('the `@ts-expect-error` lines in this block are the assertion; vitest only proves they are reachable', () => {
    // @ts-expect-error objectui#9256 — `object-grid` reads neither channel
    const gridBody: ObjectGridSchema = { ...grid, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-grid` reads neither channel
    const gridChildren: ObjectGridSchema = { ...grid, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-form` reads neither channel
    const formBody: ObjectFormSchema = { ...form, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-form` reads neither channel
    const formChildren: ObjectFormSchema = { ...form, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-kanban` reads neither channel
    const kanbanBody: ObjectKanbanSchema = { ...kanban, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-kanban` reads neither channel
    const kanbanChildren: ObjectKanbanSchema = { ...kanban, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-map` reads neither channel
    const mapBody: ObjectMapSchema = { ...map, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-map` reads neither channel
    const mapChildren: ObjectMapSchema = { ...map, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-tree` reads neither channel
    const treeBody: ObjectTreeSchema = { ...tree, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-tree` reads neither channel
    const treeChildren: ObjectTreeSchema = { ...tree, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-view` reads neither channel
    const viewBody: ObjectViewSchema = { ...view, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-view` reads neither channel
    const viewChildren: ObjectViewSchema = { ...view, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-gantt` reads neither channel
    const ganttBody: ObjectGanttSchema = { ...gantt, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-gantt` reads neither channel
    const ganttChildren: ObjectGanttSchema = { ...gantt, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-calendar` reads neither channel
    const calendarBody: ObjectCalendarSchema = { ...calendar, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-calendar` reads neither channel
    const calendarChildren: ObjectCalendarSchema = { ...calendar, children: CONTENT };
    // @ts-expect-error objectui#9256 — `object-chart` reads neither channel
    const chartBody: ObjectChartSchema = { ...chart, body: CONTENT };
    // @ts-expect-error objectui#9256 — `object-chart` reads neither channel
    const chartChildren: ObjectChartSchema = { ...chart, children: CONTENT };
    // @ts-expect-error objectui#9256 — `detail-view` reads neither channel
    const detailBody: DetailViewSchema = { ...detail, body: CONTENT };
    // @ts-expect-error objectui#9256 — `detail-view` reads neither channel
    const detailChildren: DetailViewSchema = { ...detail, children: CONTENT };
    // @ts-expect-error objectui#9256 — `email` reads neither channel (and this face used to erase `body`'s refusal)
    const emailBody: InputShorthandSchema = { ...email, body: CONTENT };
    // @ts-expect-error objectui#9256 — `email` reads neither channel
    const emailChildren: InputShorthandSchema = { ...email, children: CONTENT };
    // @ts-expect-error objectui#9256 — `password` reads neither channel (and this face used to erase `body`'s refusal)
    const passwordBody: InputShorthandSchema = { ...password, body: CONTENT };
    // @ts-expect-error objectui#9256 — `password` reads neither channel
    const passwordChildren: InputShorthandSchema = { ...password, children: CONTENT };
    // The pair the `ui:calendar` TRIPWIRE in the family-D file asked for once
    // the `Omit` collapse was repaired — `CalendarSchema`'s own tombstones,
    // re-exposed rather than newly declared.
    // @ts-expect-error objectui#9256 — `ui:calendar` inherits `calendar`'s tombstone
    const uiCalendarBody: UiCalendarSchema = { ...uiCalendar, body: CONTENT };
    // @ts-expect-error objectui#9256 — `ui:calendar` inherits `calendar`'s tombstone
    const uiCalendarChildren: UiCalendarSchema = { ...uiCalendar, children: CONTENT };

    expect([
      gridBody, gridChildren, formBody, formChildren, kanbanBody, kanbanChildren,
      mapBody, mapChildren, treeBody, treeChildren, viewBody, viewChildren,
      ganttBody, ganttChildren, calendarBody, calendarChildren, chartBody, chartChildren,
      detailBody, detailChildren, emailBody, emailChildren, passwordBody, passwordChildren,
      uiCalendarBody, uiCalendarChildren,
    ]).toHaveLength(26);
  });

  it('the repaired `Omit` re-exposes EVERY inherited member, not only the tombstones', () => {
    // The erasure was never about the channels: `label: 42` type-checked on
    // `email` and `mode: 'default'` on `ui:calendar`, because neither face
    // carried a named member at all. `tsc` is the reader of these lines.
    // @ts-expect-error objectui#9256 — `label` is `InputSchema`'s `string` again
    const emailLabel: InputShorthandSchema = { ...email, label: 42 };
    // @ts-expect-error objectui#9256 — `mode` is `CalendarSchema`'s enum again
    const uiCalendarMode: UiCalendarSchema = { ...uiCalendar, mode: 'default' };
    // @ts-expect-error objectui#8762 — the key this face writes itself still refuses
    const emailInputType: InputShorthandSchema = { ...email, inputType: 'text' };
    const label: Eq<InputShorthandSchema['label'], InputSchema['label']> = true;
    const mode: Eq<UiCalendarSchema['mode'], CalendarSchema['mode']> = true;
    const value: Eq<UiCalendarSchema['value'], CalendarSchema['value']> = true;
    expect([emailLabel, uiCalendarMode, emailInputType]).toHaveLength(3);
    expect([label, mode, value]).toEqual([true, true, true]);
  });

  it('CONTROL — the same nodes WITHOUT a content channel compile (no `@ts-expect-error` here, and `tsc` is the reader)', () => {
    const ok = [grid, form, kanban, map, tree, view, gantt, calendar, chart, detail, email, password, uiCalendar];
    // The repair kept the index signature, so it narrowed nothing an author
    // could write before beyond the members' own declared types. objectui#8347
    // then removed `BaseSchema`'s signature, so an undeclared key no longer
    // compiles on these nodes either.
    // @ts-expect-error — `InputShorthandSchema` declares no `notAMember` (objectui#8347)
    const undeclared = { type: 'email', label: 'Email', notAMember: 1 } satisfies InputShorthandSchema;
    const calendarRange = { type: 'ui:calendar', mode: 'range' } satisfies UiCalendarSchema;
    expect(ok).toHaveLength(13);
    expect([undeclared.type, calendarRange.mode]).toEqual(['email', 'range']);
  });
});
