/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7164 — `TimelineSchema.items` declares the ROW shape (maintainer
 * ruling 2026-09-02, A+, door 2: author-time).
 *
 * ## What was wrong
 *
 * The mirror declared `items: z.array(z.any())`, which accepts a `null` element
 * and any element value. So `items: [null]` and `items: [{ items: 5 }]` —
 * ordinary JSON — parsed GREEN through `validate` and then crashed
 * `TimelineRenderer`'s gantt branch with a `TypeError`. The ruling put a door
 * at both ends; this file pins the author-time one: every element is an
 * object, and a gantt row's own `items`, when present, is an array.
 *
 * ## The accept set, before and after (measured on `a67abdc88` + this change)
 *
 *     input                                      main     head
 *     items: [null]                              accept   REFUSE  items[0]
 *     items: [{ items: 5 }]                      accept   REFUSE  items[0].items
 *     items: [{ items: {} }]                     accept   REFUSE  items[0].items
 *     items: [{ items: { length: 1, 0: … } }]    accept   REFUSE  items[0].items
 *     items: [{ items: 'x' }]                    accept   REFUSE  items[0].items
 *     items: [{ items: null }]                   accept   REFUSE  items[0].items
 *     items: [0]                                 accept   REFUSE  items[0]
 *     items: [[]]                                accept   REFUSE  items[0]
 *     items: {}                                  REFUSE   REFUSE  items
 *     items: 'x'                                 REFUSE   REFUSE  items
 *     items: []                                  accept   accept
 *     items: [{ label: 'R' }]                    accept   accept
 *     a feed-variant items array                 accept   accept
 *     an ordinary gantt row                      accept   accept
 *
 * `items: [{ items: null }]` is refused HERE and still DRAWS in the renderer
 * (as an empty row): the renderer is only ever as lenient as `validate` or
 * more, never the reverse, and it never crashes on a document `validate`
 * admits — that is the invariant, and it is asserted at the foot of this file
 * over the in-repo fixtures. `[0]` and `[[]]` drew too (as an unlabelled row)
 * until objectui#7364 (ruling 5809218505, letter A) superseded that clause:
 * the renderer now refuses them as well, through `malformedRow`.
 *
 * ## The bar level: a deliberate stop, since SUPERSEDED
 *
 * This card narrowed the ROW and stopped one level short DELIBERATELY — the
 * bars inside a row stayed `z.array(z.any())` — and this docblock recorded
 * that stop as the contract. ⭐ It is no longer the contract: objectui#7365
 * (director seat, decision batch #71, 2026-09-07, option B) SUPERSEDES the
 * stop KNOWINGLY. Every BAR is now `z.object({}).passthrough()` too, so a
 * `null` bar is refused at `validate` by its own name, at `items[i].items[j]`,
 * instead of reaching the render-time date diagnostic that used to name a
 * `startDate` the author never wrote. The bar level is pinned by
 * `./timeline-items-bar-shape-7365.test.ts`; the table above and every
 * assertion below are the ROW level and are unmoved by it.
 *
 * ## What is still deliberately NOT narrowed, by either card
 *
 * The element and the bar both stay `.passthrough()`: the two element shapes
 * (feed item / gantt row) are discriminated by `variant` and read dynamically,
 * and a feed item carries no `items` key, so the feed variants parse exactly
 * as before. Neither a row's nor a bar's own keys are declared, and refining
 * by `variant` is still a wider contract than either ruling named.
 *
 * ⭐ That paragraph is SUPERSEDED by objectui#6356 (maintainer ruling
 * 2026-09-27, Q1 = A, Q2 = C), which declared the element's keys and refines
 * by `variant`; `./timeline-item-element-6356.test.ts` pins it. The two
 * levels above keep their paths: the element stays an object at `items[i]`,
 * and a row's `items` stays an array at `items[i].items`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TimelineSchema } from '../zod/data-display.zod';

const GOOD_BAR = { title: 'API', startDate: '2024-01-01', endDate: '2024-01-31' };
const gantt = (items: unknown) => ({ type: 'timeline', variant: 'gantt', items });

/** The first issue's path, dotted-and-indexed the way the renderer spells it. */
const firstPath = (r: ReturnType<typeof TimelineSchema.safeParse>): string | null => {
  if (r.success) return null;
  return r.error.issues[0].path.reduce<string>(
    (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)),
    '',
  );
};

describe('TimelineSchema.items refuses a malformed ROW at authoring time (objectui#7164)', () => {
  const refused: [string, unknown, string][] = [
    ['a null row', [null], 'items[0]'],
    ["a row whose items is a number", [{ label: 'R', items: 5 }], 'items[0].items'],
    ["a row whose items is a plain object", [{ label: 'R', items: {} }], 'items[0].items'],
    ["a row whose items is ARRAY-LIKE", [{ label: 'R', items: { length: 1, 0: GOOD_BAR } }], 'items[0].items'],
    ["a row whose items is a string", [{ label: 'R', items: 'x' }], 'items[0].items'],
    ["a row whose items is null", [{ label: 'R', items: null }], 'items[0].items'],
    ['a row that is the number 0', [0], 'items[0]'],
    ['a row that is an empty array', [[]], 'items[0]'],
    ['a null row beside a good one', [{ label: 'R', items: [GOOD_BAR] }, null], 'items[1]'],
  ];

  for (const [label, items, path] of refused) {
    it(`${label} -> REFUSED at ${path}`, () => {
      const r = TimelineSchema.safeParse(gantt(items));
      expect(r.success).toBe(false);
      expect(firstPath(r)).toBe(path);
    });
  }

  it('items that is not an array was already refused, and still is', () => {
    for (const items of [{}, 'x', 5, true]) {
      const r = TimelineSchema.safeParse(gantt(items));
      expect(r.success, `items: ${JSON.stringify(items)}`).toBe(false);
      expect(firstPath(r)).toBe('items');
    }
  });

  it('the previous declaration accepted every row above — the CONTROL that makes the refusals readings', () => {
    // The exact declaration this card replaced — `items: z.array(z.any())` —
    // rebuilt on today's `TimelineSchema` so the "before" column of the table
    // in the header is measured against the same base, not remembered.
    // `.safeExtend`, not `.extend`: since objectui#6356 the node carries a
    // refinement, and zod 4 refuses to `.extend()` a refined object over an
    // existing key. `.safeExtend` keeps that refinement; every row below has a
    // `label` and no feed key under `variant: 'gantt'`, so it admits them all.
    const previous = TimelineSchema.safeExtend({ items: z.array(z.any()).optional() });
    for (const [label, items] of refused) {
      expect(previous.safeParse(gantt(items)).success, `${label} was NOT accepted by the old mirror`).toBe(true);
    }
    // And the two the old mirror DID refuse, so the control is two-sided.
    expect(previous.safeParse(gantt({})).success).toBe(false);
    expect(previous.safeParse(gantt('x')).success).toBe(false);
  });
});

describe('what still parses — the accept set is narrowed, not redrawn', () => {
  const accepted: [string, Record<string, unknown>][] = [
    ['an ordinary gantt row', gantt([{ label: 'Backend', items: [GOOD_BAR] }])],
    ['an empty items list', gantt([])],
    ['a row with no items key (no bars yet)', gantt([{ label: 'R' }])],
    ['a row with an empty items array', gantt([{ label: 'R', items: [] }])],
    ['a row with extra keys (passthrough)', gantt([{ label: 'R', items: [GOOD_BAR], color: 'red' }])],
    [
      'a feed-variant items array',
      { type: 'timeline', variant: 'vertical', items: [{ time: '2024-01-15', title: 'Started', description: 'Kickoff', variant: 'success' }] },
    ],
    ['a horizontal feed', { type: 'timeline', variant: 'horizontal', items: [{ time: '2024-01-01', title: 'Q1' }] }],
    ['no items key at all', { type: 'timeline', variant: 'gantt' }],
  ];

  for (const [label, doc] of accepted) {
    it(`${label} -> accepted`, () => {
      const r = TimelineSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues[0])).toBe(true);
    });
  }
});

describe('fixture census — no in-repo timeline document is refused by the narrowed mirror', () => {
  /**
   * Every JSON fixture in the repo that declares `type: "timeline"`, read from
   * disk rather than copied here so a fixture edit is measured, not remembered.
   * The docs page's code-fence examples are TS object literals and are censused
   * on the PR that landed this file (all green); the JSON ones are pinned.
   */
  const ROOT = resolve(__dirname, '../../../..');
  const files = [
    'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
    'examples/schema-catalog/src/schemas/plugin-timeline/horizontal-timeline.json',
    'examples/schema-catalog/src/schemas/plugin-timeline/vertical-timeline.json',
  ];

  for (const file of files) {
    it(`${file} -> accepted`, () => {
      const doc = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));
      expect(doc.type).toBe('timeline');
      const r = TimelineSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues[0])).toBe(true);
    });
  }

  it('packages/types/examples/data-display-examples.json#examples.timeline -> accepted', () => {
    const doc = JSON.parse(readFileSync(resolve(ROOT, 'packages/types/examples/data-display-examples.json'), 'utf8'));
    const timeline = doc.examples.timeline;
    expect(timeline.type).toBe('timeline');
    expect(TimelineSchema.safeParse(timeline).success).toBe(true);
  });
});
