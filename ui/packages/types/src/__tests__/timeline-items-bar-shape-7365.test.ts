/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7365 — a gantt BAR is declared an OBJECT on both faces (director
 * seat, decision batch #71, 2026-09-07; maintainer reply verbatim
 * 「其他同意」, option B).
 *
 * ## What was wrong
 *
 * objectui#7164 narrowed the ROW (`items: [null]` is refused) and stopped
 * there DELIBERATELY, recording the stop in both faces' docblocks: the BARS
 * inside a row stayed `z.array(z.any())`. So an authored `null` BAR —
 * `{ items: [{ label: 'R', items: [null] }] }` — was green through `validate`
 * and only met the render-time date diagnostic, which named it
 *
 *     items[0].items[0].startDate is undefined, which is not a valid date
 *
 * — the WRONG FAULT, by a key the author never wrote. That is the same
 * mis-naming class objectui#7164 repaired for rows, one level down. The
 * ruling: a bar that is not a bar is refused at `validate`, by its own name.
 * objectui#7164's deliberate stop is superseded KNOWINGLY.
 *
 * ## The accept set, before and after (measured on `289d146` + this change; re-measured unchanged on `c4b3750`)
 *
 *     input                                             main     head
 *     items: [{ items: [null] }]                        accept   REFUSE  items[0].items[0]
 *     items: [{ items: [0] }]                           accept   REFUSE  items[0].items[0]
 *     items: [{ items: ['x'] }]                         accept   REFUSE  items[0].items[0]
 *     items: [{ items: [true] }]                        accept   REFUSE  items[0].items[0]
 *     items: [{ items: [[]] }]                          accept   REFUSE  items[0].items[0]
 *     items: [{ items: [undefined] }]                   accept   REFUSE  items[0].items[0]
 *     items: [{ items: [GOOD, null] }]                  accept   REFUSE  items[0].items[1]
 *     items: [{ items: [GOOD] }, { items: [null] }]     accept   REFUSE  items[1].items[0]
 *     items: [{ items: [GOOD] }]                        accept   accept
 *     items: [{ items: [{}] }]                          accept   accept   (keys stay open)
 *     items: [{ items: [] }]                            accept   accept
 *     items: [{ label: 'R' }]                           accept   accept
 *     a feed-variant items array                        accept   accept
 *
 * ## What is deliberately NOT narrowed
 *
 * The bar stays `.passthrough()`: its own keys (`title` / `startDate` /
 * `endDate` / `variant?`) are read dynamically by the renderer and are NOT
 * declared, so `items: [{}]` still parses — this card refuses a bar that is
 * not a bar, not a bar with the wrong keys. ⛔ Option A is REFUSED, not
 * deferred: `timeline.gantt.unusableRange.malformedRow`'s copy is unchanged,
 * no fourth path level was added, and the ten language packs are untouched.
 * The render-time date diagnostic remains the defined outcome for anything
 * that still reaches it, and the renderer stays only ever MORE lenient than
 * `validate` — asserted over the in-repo fixtures at the foot of this file.
 *
 * ⭐ The "NOT declared" clause is SUPERSEDED by objectui#6356 (maintainer
 * ruling 2026-09-27, Q2 = C): the bar now declares its four keys, every one
 * OPTIONAL, and stays `.passthrough()` — so `items: [{}]` still parses, the
 * refusals above keep their `items[i].items[j]` paths and `invalid_type`
 * code, and an undeclared bar key is refused only by the strict authoring
 * face. `./timeline-item-element-6356.test.ts` pins the declared keys.
 *
 * ## Stock measured before the narrowing, positive-controlled
 *
 * A published accept set narrows here (Clause-② yes), so the in-repo stock of
 * authored bars was counted on `289d146`, re-measured unchanged on
 * `c4b3750`, across `apps/` · `examples/` · `content/` ·
 * `packages/types/examples/`: FIVE bars, all well-formed objects,
 * ZERO `null` and ZERO non-object. The zero is a READING and not an empty
 * search — the same walker reported the five well-formed bars, and a planted
 * `null` bar plus a planted numeric bar in a scratch copy of the gantt fixture
 * were both found. `hotcrm` is a separate repository and is not reachable from
 * this checkout; it is unmeasured here and named as such on the PR. The
 * fixture census at the foot of this file is the durable half of that reading.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TimelineSchema } from '../zod/data-display.zod';
import { safeValidateSchema } from '../zod/index.zod';

const GOOD_BAR = { title: 'API', startDate: '2024-01-01', endDate: '2024-01-31' };
const gantt = (items: unknown) => ({ type: 'timeline', variant: 'gantt', items });
const row = (items: unknown) => ({ label: 'R', items });

/** The first issue's path, dotted-and-indexed the way the renderer spells it. */
const firstPath = (r: ReturnType<typeof TimelineSchema.safeParse>): string | null => {
  if (r.success) return null;
  return r.error.issues[0].path.reduce<string>(
    (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)),
    '',
  );
};

/** Every issue path in the tree, per-arm `errors` included — the union door
 * reports its arms nested, so a flat `issues[]` read would miss the bar. */
const issuePaths = (r: ReturnType<typeof safeValidateSchema>): string[] => {
  if (r.success) return [];
  const out: string[] = [];
  const walk = (issues: readonly z.core.$ZodIssue[]) => {
    for (const issue of issues) {
      out.push(issue.path.map(String).join('.'));
      const nested = (issue as { errors?: readonly (readonly z.core.$ZodIssue[])[] }).errors;
      if (nested) for (const arm of nested) walk(arm);
    }
  };
  walk(r.error.issues);
  return out;
};

describe('a gantt BAR that is not an object is refused at authoring time (objectui#7365)', () => {
  const refused: [string, unknown, string][] = [
    ["the ruling's pin — a null bar", [row([null])], 'items[0].items[0]'],
    ['a bar that is the number 0', [row([0])], 'items[0].items[0]'],
    ['a bar that is a string', [row(['x'])], 'items[0].items[0]'],
    ['a bar that is a boolean', [row([true])], 'items[0].items[0]'],
    ['a bar that is an array', [row([[]])], 'items[0].items[0]'],
    ['a bar that is undefined', [row([undefined])], 'items[0].items[0]'],
    ['a null bar BESIDE a good one — the path names the bar, not the row', [row([GOOD_BAR, null])], 'items[0].items[1]'],
    ['a null bar in the SECOND row', [row([GOOD_BAR]), row([null])], 'items[1].items[0]'],
  ];

  for (const [label, items, path] of refused) {
    it(`${label} -> REFUSED at ${path}`, () => {
      const r = TimelineSchema.safeParse(gantt(items));
      expect(r.success).toBe(false);
      expect(firstPath(r)).toBe(path);
    });
  }

  it('the refusal names the BAR, never `startDate` — the whole point of the card', () => {
    const r = TimelineSchema.safeParse(gantt([row([null])]));
    expect(r.success).toBe(false);
    const issues = JSON.stringify(r.success ? [] : r.error.issues);
    expect(issues).not.toContain('startDate');
    expect(firstPath(r)).toBe('items[0].items[0]');
  });

  it('every refusal above is an `invalid_type` — the bar is refused for its TYPE, not its keys', () => {
    // The bar stays `.passthrough()`, so an `unrecognized_keys` here would mean
    // the refusal came from the wrong rule: the card declares OBJECT-ness only.
    for (const [label, items] of refused) {
      const r = TimelineSchema.safeParse(gantt(items));
      expect(r.success).toBe(false);
      expect(r.success ? null : r.error.issues[0].code, label).toBe('invalid_type');
    }
  });

  it('the previous declaration accepted every bar above — the CONTROL that makes the refusals readings', () => {
    // The exact bar-level declaration this card replaced — `z.array(z.any())`
    // inside the row — rebuilt on today's `TimelineSchema` so the "before"
    // column of the table in the header is measured against the same base,
    // not remembered.
    // Annotated `z.ZodType<any, any>` for `.safeExtend` below, which admits
    // only a replacement whose output AND input types fit the slot it replaces
    // — and the old row is the looser declaration. The annotation is static
    // only: the control measures the RUNTIME accept set, which it does not touch.
    const previousRow: z.ZodType<any, any> = z.object({ items: z.array(z.any()).optional() }).passthrough();
    // `.safeExtend`, not `.extend`: since objectui#6356 the node carries a
    // refinement, and zod 4 refuses to `.extend()` a refined object over an
    // existing key. `.safeExtend` keeps that refinement; every row below has a
    // `label` and no feed key under `variant: 'gantt'`, so it admits them all.
    const previous = TimelineSchema.safeExtend({ items: z.array(previousRow).optional() });
    for (const [label, items] of refused) {
      expect(previous.safeParse(gantt(items)).success, `${label} was NOT accepted by the old mirror`).toBe(true);
    }
    // And two the old mirror already refused, so the control is two-sided —
    // objectui#7164's ROW level is untouched by this card.
    expect(previous.safeParse(gantt([null])).success).toBe(false);
    expect(previous.safeParse(gantt([{ label: 'R', items: 5 }])).success).toBe(false);
  });
});

describe('objectui#7164 ROW-level refusals are unchanged by this card', () => {
  const stillRefused: [string, unknown, string][] = [
    ['a null row', [null], 'items[0]'],
    ['a row whose items is a number', [row(5)], 'items[0].items'],
    ['a row whose items is null', [row(null)], 'items[0].items'],
    ['a row that is an empty array', [[]], 'items[0]'],
  ];
  for (const [label, items, path] of stillRefused) {
    it(`${label} -> still REFUSED at ${path}`, () => {
      const r = TimelineSchema.safeParse(gantt(items));
      expect(r.success).toBe(false);
      expect(firstPath(r)).toBe(path);
    });
  }
});

describe('what still parses — the accept set is narrowed, not redrawn', () => {
  const accepted: [string, Record<string, unknown>][] = [
    ["the ruling's pin, other half — a well-formed bar", gantt([row([GOOD_BAR])])],
    ['a bar with NO declared keys — the bar stays passthrough', gantt([row([{}])])],
    ['a bar with extra keys', gantt([row([{ ...GOOD_BAR, color: 'red', progress: 0.5 }])])],
    ['a row with an empty bar list', gantt([row([])])],
    ['a row with no items key (no bars yet)', gantt([{ label: 'R' }])],
    ['an empty items list', gantt([])],
    ['no items key at all', { type: 'timeline', variant: 'gantt' }],
    [
      'a feed-variant items array — it carries no `items` key and is untouched',
      { type: 'timeline', variant: 'vertical', items: [{ time: '2024-01-15', title: 'Started', description: 'Kickoff', variant: 'success' }] },
    ],
    ['a horizontal feed', { type: 'timeline', variant: 'horizontal', items: [{ time: '2024-01-01', title: 'Q1' }] }],
  ];

  for (const [label, doc] of accepted) {
    it(`${label} -> accepted`, () => {
      const r = TimelineSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues[0])).toBe(true);
    });
  }
});

describe('fixture census — the in-repo bar stock, read from disk', () => {
  /**
   * The durable half of the stock measurement in this file's header: every
   * in-repo JSON document that declares `type: "timeline"`, read from disk
   * rather than copied here so a fixture edit is MEASURED, not remembered. The
   * docs page's gantt example (`content/docs/plugins/plugin-timeline.mdx`) is a
   * TS object literal typed `TimelineSchema` and is checked by `check:doc-types`
   * against the narrowed declaration instead.
   */
  const ROOT = resolve(__dirname, '../../../..');
  const files = [
    'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
    'examples/schema-catalog/src/schemas/plugin-timeline/horizontal-timeline.json',
    'examples/schema-catalog/src/schemas/plugin-timeline/vertical-timeline.json',
  ];

  const read = (file: string) => JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));

  for (const file of files) {
    it(`${file} -> accepted by the narrowed mirror`, () => {
      const doc = read(file);
      expect(doc.type).toBe('timeline');
      const r = TimelineSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues[0])).toBe(true);
    });
  }

  it('packages/types/examples/data-display-examples.json#examples.timeline -> accepted', () => {
    const timeline = read('packages/types/examples/data-display-examples.json').examples.timeline;
    expect(timeline.type).toBe('timeline');
    expect(TimelineSchema.safeParse(timeline).success).toBe(true);
  });

  it('the in-repo bar stock is FIVE bars, all objects, zero null — positive-controlled', () => {
    const bars: unknown[] = [];
    for (const file of files) {
      for (const r of read(file).items ?? []) for (const bar of r?.items ?? []) bars.push(bar);
    }
    // The control: the walker above found bars at all. A zero here with an
    // empty `bars` would be indistinguishable from a broken traversal.
    expect(bars.length).toBe(5);
    expect(bars.filter((b) => b === null || typeof b !== 'object' || Array.isArray(b))).toEqual([]);
  });
});

describe('the same verdict through the tolerant node union (`safeValidateSchema`)', () => {
  // `TimelineSchema.safeParse` above is the declaration; this is the tolerant
  // node union. A `.passthrough()` arm elsewhere in the
  // union could have re-admitted the document, so the union is measured, not
  // assumed — and the good half is asserted beside it so a green refusal is
  // not just "no arm matched anything".
  it("a well-formed gantt document validates through the union", () => {
    const r = safeValidateSchema(gantt([row([GOOD_BAR])]));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it("the ruling's pin — a `null` bar — is refused through the union, and the bar is named", () => {
    const r = safeValidateSchema(gantt([row([null])]));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('items.0.items.0');
  });
});
