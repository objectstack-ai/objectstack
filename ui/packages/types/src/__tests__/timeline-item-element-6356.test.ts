/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6356 — `TimelineSchema.items` declares its ELEMENT (maintainer
 * ruling 2026-09-27: Q1 「A 内部键(推荐)」, Q2 「C 联合+校验判别(推荐)」).
 *
 * ## What was wrong
 *
 * The element was an object whose keys were all open, on both faces. So:
 *
 *   - `{ title, date }` type-checked and parsed green, and `date` was dropped
 *     in silence — it is the retired `TimelineEvent` vocabulary, and a feed
 *     item's date is `time`;
 *   - a gantt row on a feed timeline, or a feed item on a gantt timeline,
 *     parsed green and drew an EMPTY entry with no diagnostic;
 *   - the strict authoring face (objectui#8345) refused EVERY legitimate
 *     element, the schema-catalog's own included, because an element that
 *     declares no keys closes to nothing.
 *
 * ## What the ruling declared
 *
 *   - Q1 = A — the feed element is the seven documented keys. `color`, `group`,
 *     `meta`, `startDate`, `endDate` and `_data` are renderer-internal (typed
 *     by the handoff inside `packages/plugin-timeline`), and the strict face
 *     refuses them when authored — immediately, no alias, no window.
 *   - Q2 = C — the TypeScript element is a union (feed item or gantt row); the
 *     zod node stays a `ZodObject` with a node-level refinement that judges
 *     each element against the arm `variant` selects (absent ⇒ vertical); feed
 *     `title` and gantt `label` are required; element and bar `variant` are the
 *     documented five.
 *
 * ## How to read the assertions
 *
 * Refusals are asserted by issue `code` and `path` (and, for the strict face,
 * the `keys` an `unrecognized_keys` issue names) — ⛔ never by message text,
 * which nothing parses. Every refusal table has an accepting control beside
 * it, and the cross-shape and strict-face refusals each have a BEFORE control
 * rebuilt on today's node from the previous element declaration, so a refusal
 * here is a reading against a base that accepted, not an assumption.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { TimelineFeedItem, TimelineGanttItem, TimelineSchema as TimelineSchemaTS } from '../data-display.js';
import {
  DataDisplaySchema,
  TimelineFeedItemSchema,
  TimelineGanttItemBarSchema,
  TimelineGanttItemSchema,
  TimelineSchema,
} from '../zod/data-display.zod.js';
import { deriveStrictAuthoringSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';

/* ── Reading a result ─────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };

/**
 * Every leaf issue, per-arm `invalid_union` groups flattened. zod reports an
 * arm's issues with paths RELATIVE to the union, so each is re-rooted at the
 * union's own path — otherwise a refused bar date would read as a refusal of
 * the whole document.
 */
function leaves(result: { success: boolean; error?: { issues: unknown[] } }): Issue[] {
  if (result.success) return [];
  const out: Issue[] = [];
  const walk = (issues: readonly Issue[], prefix: PropertyKey[]) => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      if (issue.code === 'invalid_union' && issue.errors) for (const group of issue.errors) walk(group, path);
      else out.push({ ...issue, path });
    }
  };
  walk(result.error!.issues as Issue[], []);
  return out;
}

/** `code @ dotted.path`, sorted — the pair every refusal below is asserted on. */
function codesAt(result: { success: boolean; error?: { issues: unknown[] } }): string[] {
  return leaves(result).map((i) => `${i.code} @ ${i.path.map(String).join('.')}`).sort();
}

/* ── Documents ────────────────────────────────────────────────────────────── */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CATALOG = [
  'examples/schema-catalog/src/schemas/plugin-timeline/vertical-timeline.json',
  'examples/schema-catalog/src/schemas/plugin-timeline/horizontal-timeline.json',
  'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
];
const readCatalog = (file: string) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

const FEED = { time: '2024-01-15', title: 'Kickoff', description: 'Planning', variant: 'success', icon: '🚀' };
const BAR = { title: 'API', startDate: '2024-01-01', endDate: '2024-01-31', variant: 'info' };
const ROW = { label: 'Backend', items: [BAR] };
const timeline = (variant: string | undefined, items: unknown[]) =>
  (variant === undefined ? { type: 'timeline', items } : { type: 'timeline', variant, items });

/**
 * The element as it was declared before this card — an object whose keys are
 * all open, a row's `items` an array of open objects — rebuilt on TODAY's node
 * shape. `z.object(shape)` deliberately drops the node's refinement: that is
 * what "before" means here, and it is the spelling the strict face's own
 * docblock warns against using for anything else.
 */
const previousNode = z
  .object({
    ...TimelineSchema.shape,
    items: z
      .array(z.object({ items: z.array(z.object({}).passthrough()).optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const strictNode = deriveStrictAuthoringSchema(TimelineSchema);
const strictPrevious = deriveStrictAuthoringSchema(previousNode);

/* ── The arms ─────────────────────────────────────────────────────────────── */

describe('the two arms declare exactly the ruled vocabulary (objectui#6356)', () => {
  it('the feed arm is the seven documented keys — Q1 = A', () => {
    expect(Object.keys(TimelineFeedItemSchema.shape).sort()).toEqual(
      ['className', 'content', 'description', 'icon', 'time', 'title', 'variant'],
    );
  });

  it('the gantt arm is `{ label, items }`, and a bar is `{ title, startDate, endDate, variant }`', () => {
    expect(Object.keys(TimelineGanttItemSchema.shape).sort()).toEqual(['items', 'label']);
    expect(Object.keys(TimelineGanttItemBarSchema.shape).sort()).toEqual(['endDate', 'startDate', 'title', 'variant']);
  });

  it('none of the composed-only keys is declared on any arm', () => {
    const declared = new Set([
      ...Object.keys(TimelineFeedItemSchema.shape),
      ...Object.keys(TimelineGanttItemSchema.shape),
    ]);
    for (const key of ['color', 'group', 'meta', 'startDate', 'endDate', '_data', 'date']) {
      expect(declared.has(key), key).toBe(false);
    }
  });
});

/* ── Tolerant face: the arm `variant` selects ─────────────────────────────── */

describe('each element is judged against the arm `variant` selects — tolerant face', () => {
  const crossShape: Array<[label: string, doc: unknown, expected: string[]]> = [
    ['a gantt row on a vertical timeline', timeline('vertical', [ROW]),
      ['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']],
    ['a gantt row on a horizontal timeline', timeline('horizontal', [ROW]),
      ['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']],
    ['a gantt row with `variant` absent — absent reads as vertical', timeline(undefined, [ROW]),
      ['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']],
    ['a feed item on a gantt timeline', timeline('gantt', [{ time: '2024-01-15', title: 'Kickoff' }]),
      ['custom @ items.0.label', 'custom @ items.0.time', 'custom @ items.0.title']],
    ['a feed item beside a good row — the path names the element', timeline('gantt', [ROW, { title: 'Stray' }]),
      ['custom @ items.1.label', 'custom @ items.1.title']],
  ];

  for (const [label, doc, expected] of crossShape) {
    it(`${label} -> REFUSED, each issue at the key it names`, () => {
      expect(codesAt(TimelineSchema.safeParse(doc))).toEqual(expected);
    });
  }

  it('BEFORE control: the previous element declaration accepted every one of them', () => {
    for (const [label, doc] of crossShape) {
      expect(previousNode.safeParse(doc).success, label).toBe(true);
    }
  });

  it('the required key of each arm', () => {
    expect(codesAt(TimelineSchema.safeParse(timeline('vertical', [{ time: '2024-01-15', description: 'no title' }]))))
      .toEqual(['custom @ items.0.title']);
    expect(codesAt(TimelineSchema.safeParse(timeline('gantt', [{ items: [BAR] }]))))
      .toEqual(['custom @ items.0.label']);
  });

  it('element and bar `variant` are the documented five, and nothing else', () => {
    for (const variant of ['default', 'success', 'warning', 'danger', 'info']) {
      expect(TimelineSchema.safeParse(timeline('vertical', [{ title: 'T', variant }])).success, variant).toBe(true);
      expect(TimelineSchema.safeParse(timeline('gantt', [{ label: 'R', items: [{ ...BAR, variant }] }])).success, variant).toBe(true);
    }
    // `todo` is a marker variant the composed path paints — not an authoring colour.
    for (const variant of ['todo', 'purple']) {
      expect(codesAt(TimelineSchema.safeParse(timeline('vertical', [{ title: 'T', variant }])))).toEqual(['invalid_value @ items.0.variant']);
      expect(codesAt(TimelineSchema.safeParse(timeline('gantt', [{ label: 'R', items: [{ ...BAR, variant }] }]))))
        .toEqual(['invalid_value @ items.0.items.0.variant']);
    }
  });

  it('a bar date is a string, a FINITE number or a Date — the renderer’s own rule (objectui#6781)', () => {
    for (const startDate of ['2024-01-01', 0, 1704067200000, new Date('2024-01-01')]) {
      expect(TimelineSchema.safeParse(timeline('gantt', [{ label: 'R', items: [{ startDate }] }])).success, String(startDate)).toBe(true);
    }
    for (const startDate of [Number.POSITIVE_INFINITY, Number.NaN, null, true, {}]) {
      expect(codesAt(TimelineSchema.safeParse(timeline('gantt', [{ label: 'R', items: [{ startDate }] }]))), String(startDate))
        .toContain('invalid_type @ items.0.items.0.startDate');
    }
  });

  it('accepting control: the documented shapes, a bar with no keys, and undeclared keys on the tolerant face', () => {
    const accepted: Array<[string, unknown]> = [
      ['a documented feed item', timeline('vertical', [FEED])],
      ['a horizontal feed', timeline('horizontal', [FEED])],
      ['a feed with `variant` absent', timeline(undefined, [FEED])],
      ['a documented gantt row', timeline('gantt', [ROW])],
      ['a row with no bars yet (objectui#6750)', timeline('gantt', [{ label: 'R' }])],
      ['a bar with no keys at all — every bar key is optional', timeline('gantt', [{ label: 'R', items: [{}] }])],
      ['an undeclared key on a feed item — refused by the STRICT face, not this one', timeline('vertical', [{ ...FEED, meta: [] }])],
      ['an undeclared key on a row', timeline('gantt', [{ ...ROW, color: 'red' }])],
      ['content as a node', timeline('vertical', [{ title: 'T', content: { type: 'text', content: 'x' } }])],
      ['no items at all', { type: 'timeline', variant: 'gantt' }],
    ];
    for (const [label, doc] of accepted) {
      const r = TimelineSchema.safeParse(doc);
      expect(r.success, `${label}: ${codesAt(r).join(', ')}`).toBe(true);
    }
  });

  it('the schema-catalog documents are accepted', () => {
    for (const file of CATALOG) {
      const r = TimelineSchema.safeParse(readCatalog(file));
      expect(r.success, `${file}: ${codesAt(r).join(', ')}`).toBe(true);
    }
  });
});

/* ── Strict authoring face ────────────────────────────────────────────────── */

describe('the strict authoring face closes the element to the declared vocabulary', () => {
  it('refuses each composed-only key BY NAME — `unrecognized_keys` at the element', () => {
    for (const key of ['meta', 'group', 'color', 'startDate', 'endDate', '_data']) {
      const r = strictNode.safeParse(timeline('vertical', [{ ...FEED, [key]: 'x' }]));
      expect(r.success, key).toBe(false);
      expect(leaves(r).map((i) => [i.code, i.path.map(String).join('.'), i.keys]), key)
        .toEqual([['unrecognized_keys', 'items.0', [key]]]);
    }
  });

  it('refuses `date` — the trap this card was filed on — by name', () => {
    const r = strictNode.safeParse(timeline('vertical', [{ title: 'Static Event', date: '2024-01-01' }]));
    expect(leaves(r).map((i) => [i.code, i.path.map(String).join('.'), i.keys]))
      .toEqual([['unrecognized_keys', 'items.0', ['date']]]);
  });

  it('refuses an undeclared BAR key by name, at the bar', () => {
    const r = strictNode.safeParse(timeline('gantt', [{ label: 'R', items: [{ ...BAR, progress: 0.5 }] }]));
    expect(leaves(r).map((i) => [i.code, i.path.map(String).join('.'), i.keys]))
      .toEqual([['unrecognized_keys', 'items.0.items.0', ['progress']]]);
  });

  it('the refinement survives the strict clone: cross-shape is refused here too', () => {
    expect(codesAt(strictNode.safeParse(timeline('vertical', [ROW]))))
      .toEqual(['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']);
    // An element carrying keys of BOTH arms passes the closed shape — both are
    // declared there — and is refused by the arm judgement alone.
    expect(codesAt(strictNode.safeParse(timeline('vertical', [{ title: 'T', label: 'L' }]))))
      .toEqual(['custom @ items.0.label']);
  });

  it('accepts the schema-catalog documents — and the previous declaration’s strict face refused them', () => {
    for (const file of CATALOG) {
      const doc = readCatalog(file);
      const now = strictNode.safeParse(doc);
      expect(now.success, `${file}: ${codesAt(now).join(', ')}`).toBe(true);
      // BEFORE control — the reading objectui#6356's measurement took: an
      // element that declares no keys closes to nothing, so every legitimate
      // element key was `unrecognized_keys`.
      const before = strictPrevious.safeParse(doc);
      expect(before.success, file).toBe(false);
      expect(leaves(before).every((i) => i.code === 'unrecognized_keys'), file).toBe(true);
    }
  });

  it('the published document face agrees: `StrictAnyComponentSchema` names `meta` and accepts a catalog feed', () => {
    const refused = StrictAnyComponentSchema.safeParse(timeline('vertical', [{ ...FEED, meta: [] }]));
    expect(leaves(refused).filter((i) => i.code === 'unrecognized_keys').map((i) => i.keys)).toEqual([['meta']]);
    const accepted = StrictAnyComponentSchema.safeParse(readCatalog(CATALOG[0]));
    expect(accepted.success, codesAt(accepted).join(', ')).toBe(true);
  });
});

/* ── The node keeps its class and its neighbours ─────────────────────────── */

describe('the node stays a ZodObject — what Q2 = C had to leave standing', () => {
  it('is still a ZodObject with its own `.shape`', () => {
    expect(TimelineSchema).toBeInstanceOf(z.ZodObject);
    for (const key of ['items', 'variant', 'scale', 'timeScale', 'body', 'children', 'events', 'orientation', 'position']) {
      expect(Object.keys(TimelineSchema.shape), key).toContain(key);
    }
  });

  it('the `DataDisplaySchema` discriminated union still dispatches to it, refinement included', () => {
    expect(codesAt(DataDisplaySchema.safeParse(timeline('vertical', [ROW]))))
      .toEqual(['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']);
    for (const file of CATALOG) {
      expect(DataDisplaySchema.safeParse(readCatalog(file)).success, file).toBe(true);
    }
  });

  it('the tombstones refuse exactly what they refused', () => {
    expect(codesAt(TimelineSchema.safeParse({ type: 'timeline', timeScale: 'month' }))).toEqual(['invalid_type @ timeScale']);
    expect(codesAt(TimelineSchema.safeParse({ type: 'timeline', body: [] }))).toEqual(['invalid_type @ body']);
    expect(codesAt(TimelineSchema.safeParse({ type: 'timeline', children: [] }))).toEqual(['invalid_type @ children']);
  });

  it('`.extend()` over an existing key is refused by zod on a refined object; `.safeExtend()` keeps the refinement', () => {
    expect(() => TimelineSchema.extend({ items: z.array(z.any()).optional() })).toThrow();
    const rebuilt = TimelineSchema.safeExtend({ items: z.array(z.any()).optional() });
    // The refinement came along, and guards its own element reads: non-object
    // elements the rebuilt slot admits do not make it throw.
    expect(rebuilt.safeParse(timeline('gantt', [null, 0, [], { label: 'R' }])).success).toBe(true);
    expect(codesAt(rebuilt.safeParse(timeline('vertical', [ROW]))))
      .toEqual(['custom @ items.0.items', 'custom @ items.0.label', 'custom @ items.0.title']);
  });
});

/* ── TypeScript face ──────────────────────────────────────────────────────── */

describe('TimelineSchema (TS) — the element union, closed arms', () => {
  it('accepts the documented shapes', () => {
    const feed: TimelineSchemaTS = { type: 'timeline', variant: 'vertical', items: [{ time: '2024-01-15', title: 'Kickoff', variant: 'success', icon: '🚀' }] };
    const gantt: TimelineSchemaTS = {
      type: 'timeline',
      variant: 'gantt',
      items: [{ label: 'Backend', items: [{ title: 'API', startDate: '2024-01-01', endDate: 1706659200000, variant: 'info' }] }],
    };
    const item: TimelineFeedItem = { title: 'Only a title' };
    const row: TimelineGanttItem = { label: 'Only a label' };
    expect([feed, gantt, item, row]).toHaveLength(4);
  });

  it('refuses an undeclared key, a missing required key and an off-vocabulary colour', () => {
    // Each directive fails the build (TS2578) the moment the arm stops refusing.
    // @ts-expect-error — `meta` is renderer-internal, declared on no arm.
    const meta: TimelineSchemaTS = { type: 'timeline', items: [{ title: 'T', meta: [] }] };
    // @ts-expect-error — `date` is not a feed key; the date is `time`.
    const date: TimelineSchemaTS = { type: 'timeline', items: [{ title: 'T', date: '2024-01-01' }] };
    // @ts-expect-error — `title` is required on a feed item.
    const untitled: TimelineFeedItem = { time: '2024-01-15' };
    // @ts-expect-error — `label` is required on a gantt row.
    const unlabelled: TimelineGanttItem = { items: [] };
    // @ts-expect-error — an element with neither required key fits neither arm of the union.
    const neither: TimelineSchemaTS = { type: 'timeline', items: [{ time: '2024-01-15' }] };
    // @ts-expect-error — `purple` is not one of the five.
    const colour: TimelineFeedItem = { title: 'T', variant: 'purple' };
    expect([meta, date, untitled, unlabelled, neither, colour]).toHaveLength(6);
  });

  it('cross-shape type-checks — TypeScript cannot see `variant`; validation is the door that refuses it', () => {
    // The ruling's stated limit, pinned so it is read rather than rediscovered:
    // the element's arm depends on a key of the PARENT.
    const crossShape: TimelineSchemaTS = { type: 'timeline', variant: 'vertical', items: [{ label: 'Backend' }] };
    expect(TimelineSchema.safeParse(crossShape).success).toBe(false);
  });
});
