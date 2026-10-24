/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6152 round 11 — the list VIEW's four per-view-type blocks (`kanban`,
 * `calendar`, `gallery`, `timeline`) follow `@objectstack/spec`'s `ListViewSchema`
 * slots BY REFERENCE, and none of them ends `.passthrough()` any more.
 *
 * Each slot is a strict object. This package kept each block as the named spec
 * schema `.partial()` + `.passthrough()`, plus accepted aliases, so its door admitted
 * what the slot refuses: any undeclared key, the pre-#2231 aliases and the
 * objectui-only `calendar.defaultView`. objectui#8327 forbids that direction, and the
 * seat ruled Q1 → A on objectui#6152 (the census read no writer of any of these keys
 * on the declared blocks). The blocks below:
 *
 *   1. the slots, measured on the INSTALLED spec — strictness and required members,
 *      so a spec bump that moves either reds here by name;
 *   2. the mirror IS the slot: strict, every slot member present, and nothing beside
 *      them but named refusal arms; `.partial()` on kanban and timeline only;
 *   3. verdict equality with the slot over a set of accepted and refused inputs, and
 *      the one sanctioned difference (`.partial()`), each row naming its producer;
 *   4. one named-refusal pin per key this round refused, through every published door;
 *   5. calendar's required `startDateField`;
 *   6. undeclared keys refused through every door;
 *   7. the TypeScript face, which derives from the mirror and is closed the same way.
 *
 * ⛔ The READERS are not this round's (`normalizeListViewSchema`'s alias fold,
 * `ListView`'s `defaultView` lift and its two spreads stay). Nothing here asserts them.
 */
import { describe, it, expect } from 'vitest';

import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import type { ListViewSchema as TsListViewSchema } from '../objectql';
import { ListViewSchema } from '../zod/objectql.zod.js';
import { AnyComponentSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';
import { onPageSpelling } from './list-view-page-node';

/* ── Instruments ─────────────────────────────────────────────────────────────── */

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };
type Parsed = { success: boolean; error?: { issues: readonly Issue[] } };
type Parse = (doc: unknown) => Parsed;
type Zod = {
  safeParse: Parse;
  unwrap: () => Zod;
  shape: Record<string, Zod>;
  _zod: { def: { type: string; innerType?: Zod; catchall?: Zod } };
};

const verdict = (r: Parsed) => ({
  success: r.success,
  issues: r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys })),
});
const codeAndPath = (r: Parsed) => (r.success ? [] : r.error!.issues.map((i) => ({ code: i.code, path: i.path.join('.') })));

function wrapperChain(schema: Zod): string[] {
  const chain: string[] = [];
  let cur: Zod | undefined = schema;
  while (cur) {
    chain.push(cur._zod.def.type);
    cur = cur._zod.def.innerType;
  }
  return chain;
}
const catchallOf = (object: Zod) => object._zod.def.catchall?._zod.def.type;
/** The members an object REQUIRES: those whose schema refuses `undefined`. */
const requiredOf = (object: Zod) => Object.keys(object.shape).filter((k) => !object.shape[k].safeParse(undefined).success).sort();

const KINDS = ['kanban', 'calendar', 'gallery', 'timeline'] as const;
type Kind = (typeof KINDS)[number];

const SPEC = SpecListViewSchema as unknown as Zod;
const MIRROR = ListViewSchema as unknown as Zod;
/** The installed slot, as the spec's `ListViewSchema` holds it: `optional` around the block. */
const slot = (k: Kind) => SPEC.shape[k];
const slotBlock = (k: Kind) => slot(k).unwrap();
/** This package's block, as its `ListViewSchema` holds it. */
const mirrorBlock = (k: Kind) => MIRROR.shape[k].unwrap();

/** The only local keys each block may carry: named refusal arms, never a widening. */
const LOCAL: Record<Kind, readonly string[]> = {
  kanban: ['groupField', 'cardFields', 'groupBy'],
  calendar: ['defaultView', 'dateField', 'endField'],
  gallery: ['imageField'],
  timeline: ['dateField'],
};

/** A block each slot accepts in full: every required member present. */
const BASE: Record<Kind, Record<string, unknown>> = {
  kanban: { groupByField: 'stage', columns: ['name', 'amount'] },
  calendar: { startDateField: 'starts_at' },
  gallery: { coverField: 'logo' },
  timeline: { startDateField: 'starts_at', titleField: 'name' },
};

const NODE = { type: 'list-view', objectName: 'deal' };
/**
 * The mirror is the `ListView` component's props; the three published faces
 * judge the authored PAGE node since objectui#12670, its props in the
 * `properties` bag, so each re-spells the node and reads its paths relative to
 * the bag (`onPageSpelling`). The bag's blocks are the mirror's, by reference.
 */
const DOORS: ReadonlyArray<readonly [string, Parse]> = [
  ['the list-view mirror', (d) => ListViewSchema.safeParse(d)],
  ['the tolerant face', onPageSpelling((d) => AnyComponentSchema.safeParse(d) as Parsed)],
  ['the strict face', onPageSpelling((d) => StrictAnyComponentSchema.safeParse(d) as Parsed)],
  ['safeValidateSchema', onPageSpelling((d) => safeValidateSchema(d) as Parsed)],
];

/* ── 1. The slots, on the installed protocol (the precondition) ──────────────── */

describe('objectui#6152 round 11 — the installed `ListViewSchema` slots', () => {
  it.each(KINDS)('%s is `optional` around a STRICT object', (k) => {
    expect(wrapperChain(slot(k))).toEqual(['optional', 'object']);
    expect(catchallOf(slotBlock(k))).toBe('never');
  });

  it('requires exactly the members the `.partial()` decision was taken on', () => {
    expect(requiredOf(slotBlock('kanban'))).toEqual(['columns', 'groupByField']);
    expect(requiredOf(slotBlock('calendar'))).toEqual(['startDateField']);
    expect(requiredOf(slotBlock('gallery'))).toEqual([]);
    expect(requiredOf(slotBlock('timeline'))).toEqual(['startDateField', 'titleField']);
  });

  it.each(KINDS)('%s declares none of the keys this package refuses by name on it', (k) => {
    for (const key of LOCAL[k]) expect(Object.keys(slotBlock(k).shape)).not.toContain(key);
  });
});

/* ── 2. The mirror IS the slot ───────────────────────────────────────────────── */

describe('objectui#6152 round 11 — each mirror block takes its slot by reference', () => {
  it.each(KINDS)('%s is strict, carries every slot member, and nothing beside them but refusal arms', (k) => {
    const block = mirrorBlock(k);
    expect(catchallOf(block)).toBe('never');
    const slotKeys = Object.keys(slotBlock(k).shape);
    expect(slotKeys.filter((key) => !(key in block.shape))).toEqual([]);
    const local = Object.keys(block.shape).filter((key) => !slotKeys.includes(key)).sort();
    expect(local).toEqual([...LOCAL[k]].sort());
    for (const key of local) {
      // A refusal arm: absent is fine, any written value is refused.
      expect(block.shape[key].safeParse(undefined).success).toBe(true);
      for (const value of ['x', 1, true, ['x'], {}]) expect(block.shape[key].safeParse(value).success).toBe(false);
    }
  });

  it('`.partial()` stays on kanban and timeline only; calendar requires its start, gallery requires nothing', () => {
    expect(requiredOf(mirrorBlock('kanban'))).toEqual([]);
    expect(requiredOf(mirrorBlock('calendar'))).toEqual(['startDateField']);
    expect(requiredOf(mirrorBlock('gallery'))).toEqual([]);
    expect(requiredOf(mirrorBlock('timeline'))).toEqual([]);
  });
});

/* ── 3. Verdict equality with the slot ───────────────────────────────────────── */

/**
 * Inputs every one of which carries the slot's required members, so `.partial()`
 * cannot be what answers. Accepted and refused rows alike; none names a key this
 * package refuses by name (those are section 4, where the two faces deliberately
 * answer with different codes).
 */
const EQUALITY: Record<Kind, ReadonlyArray<readonly [string, Record<string, unknown>]>> = {
  kanban: [
    ['the required pair', BASE.kanban],
    ['every member', { ...BASE.kanban, summarizeField: 'amount', titleField: 'name' }],
    ['an undeclared key (swimlaneField)', { ...BASE.kanban, swimlaneField: 'owner' }],
    ['a nonsense key', { ...BASE.kanban, zzqxNoSuchField: 1 }],
    ['columns as a string', { groupByField: 'stage', columns: 'name' }],
    ['a padded lane field', { groupByField: ' stage ', columns: ['name'] }],
    ['a numeric lane field', { groupByField: 42, columns: ['name'] }],
  ],
  calendar: [
    ['the required start', BASE.calendar],
    ['every member', { startDateField: 's', endDateField: 'e', titleField: 't', colorField: 'c', allDayField: 'a' }],
    ['an undeclared key (swimlaneField)', { ...BASE.calendar, swimlaneField: 'owner' }],
    ['a nonsense key', { ...BASE.calendar, zzqxNoSuchField: 1 }],
    ['a numeric colour field', { ...BASE.calendar, colorField: 42 }],
    ['no start at all', { titleField: 'name' }],
  ],
  gallery: [
    ['an empty block', {}],
    ['every member', { coverField: 'logo', coverFit: 'contain', cardSize: 'large', titleField: 'name', visibleFields: ['name'] }],
    ['an undeclared key', { ...BASE.gallery, zzqxNoSuchField: 1 }],
    ['an unknown cover fit', { ...BASE.gallery, coverFit: 'stretch' }],
    ['an unknown card size', { ...BASE.gallery, cardSize: 'huge' }],
    ['visibleFields as a string', { ...BASE.gallery, visibleFields: 'name' }],
  ],
  timeline: [
    ['the required pair', BASE.timeline],
    ['every member', { ...BASE.timeline, endDateField: 'ends_at', groupByField: 'owner', colorField: 'stage', scale: 'month' }],
    ['an undeclared key (endField)', { ...BASE.timeline, endField: 'ends_at' }],
    ['a nonsense key', { ...BASE.timeline, zzqxNoSuchField: 1 }],
    ['an unknown scale', { ...BASE.timeline, scale: 'decade' }],
    ['a numeric start', { startDateField: 42, titleField: 'name' }],
  ],
};

describe('objectui#6152 round 11 — verdict equality: the mirror block answers as the slot does', () => {
  for (const k of KINDS) {
    it.each(EQUALITY[k])(`${k}: %s`, (_label, block) => {
      expect(verdict(mirrorBlock(k).safeParse(block))).toEqual(verdict(slotBlock(k).safeParse(block)));
    });
  }

  it('LIT CONTROL: the table holds accepted AND refused rows on every block', () => {
    for (const k of KINDS) {
      const outcomes = EQUALITY[k].map(([, block]) => slotBlock(k).safeParse(block).success);
      expect(outcomes, k).toContain(true);
      expect(outcomes, k).toContain(false);
    }
  });

  // The ONE sanctioned difference, row by row, each naming the producer that needs it.
  const PARTIAL_ROWS: ReadonlyArray<readonly [Kind, Record<string, unknown>, string, string]> = [
    ['kanban', { groupByField: 'stage' }, 'columns', '`defaultKanbanFromObject` (InterfaceListPage, ObjectDataPage)'],
    ['timeline', { startDateField: 'starts_at' }, 'titleField', "InterfaceListPage's timeline default (`defaultCalendarFromObject`)"],
  ];
  it.each(PARTIAL_ROWS)('`.partial()` on %s: the slot refuses %j for its missing `%s`, the mirror accepts it — for %s', (k, block, missing) => {
    expect(codeAndPath(slotBlock(k).safeParse(block))).toEqual([{ code: 'invalid_type', path: missing }]);
    expect(mirrorBlock(k).safeParse(block).success).toBe(true);
  });
});

/* ── 4. The named refusals ───────────────────────────────────────────────────── */

const REFUSED: ReadonlyArray<readonly [Kind, string, string | null]> = [
  ['kanban', 'groupField', 'groupByField'],
  ['kanban', 'cardFields', 'columns'],
  ['gallery', 'imageField', 'coverField'],
  ['timeline', 'dateField', 'startDateField'],
  ['calendar', 'defaultView', null],
];
const VALUE: Record<string, unknown> = { cardFields: ['name'], defaultView: 'week' };

describe('objectui#6152 round 11 — each key this round refused, refused BY NAME', () => {
  it.each(REFUSED)('%s.%s: the slot refuses it as an unrecognized key', (k, key) => {
    const r = slotBlock(k).safeParse({ ...BASE[k], [key]: VALUE[key] ?? 'stage' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => ({ code: i.code, keys: i.keys }))).toEqual([{ code: 'unrecognized_keys', keys: [key] }]);
  });

  it.each(REFUSED)('%s.%s: the mirror refuses it at its own path, naming the remedy (canonical: %s)', (k, key, canonical) => {
    const r = mirrorBlock(k).safeParse({ ...BASE[k], [key]: VALUE[key] ?? 'stage' });
    expect(r.success).toBe(false);
    const issues = r.error!.issues;
    expect(issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([{ code: 'invalid_type', path: [key] }]);
    // The lead is the spec's own lead for an unrecognized key on this surface.
    expect(issues[0].message.startsWith(`Unrecognized key(s) on this ${k} configuration: \`${key}\`.`)).toBe(true);
    if (canonical) expect(issues[0].message).toContain(`Did you mean \`${key}\` → \`${canonical}\`?`);
    else expect(issues[0].message).toContain('has no `defaultView` member on a list view\'s calendar block');
  });

  for (const [door, parse] of DOORS) {
    it.each(REFUSED)(`${door}: a list-view node with %s.%s is refused at that key`, (k, key) => {
      const r = parse({ ...NODE, [k]: { ...BASE[k], [key]: VALUE[key] ?? 'stage' } });
      expect(r.success).toBe(false);
      expect(codeAndPath(r)).toContainEqual({ code: 'invalid_type', path: `${k}.${key}` });
    });

    it(`${door}: LIT CONTROL — the same nodes without the refused key parse`, () => {
      for (const k of KINDS) {
        const r = parse({ ...NODE, [k]: BASE[k] });
        expect(r.success, `${k}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
      }
    });
  }
});

/* ── 5. Calendar's required start ────────────────────────────────────────────── */

describe('objectui#6152 round 11 — the list view\'s calendar block requires `startDateField`', () => {
  it('the mirror answers a start-less block as the slot does', () => {
    const block = { titleField: 'name', colorField: 'stage' };
    expect(codeAndPath(slotBlock('calendar').safeParse(block))).toEqual([{ code: 'invalid_type', path: 'startDateField' }]);
    expect(verdict(mirrorBlock('calendar').safeParse(block))).toEqual(verdict(slotBlock('calendar').safeParse(block)));
  });

  for (const [door, parse] of DOORS) {
    it(`${door}: a start-less calendar block is refused at \`calendar.startDateField\`; with a start it parses`, () => {
      expect(codeAndPath(parse({ ...NODE, calendar: { titleField: 'name' } }))).toContainEqual({ code: 'invalid_type', path: 'calendar.startDateField' });
      expect(parse({ ...NODE, calendar: { startDateField: 'starts_at', titleField: 'name' } }).success).toBe(true);
    });
  }
});

/* ── 6. Undeclared keys, through every door ──────────────────────────────────── */

describe('objectui#6152 round 11 — an undeclared key is refused with the slot\'s own `unrecognized_keys`', () => {
  const UNDECLARED: ReadonlyArray<readonly [Kind, string]> = [
    ['kanban', 'swimlaneField'],
    ['calendar', 'zzqxNoSuchField'],
    ['gallery', 'zzqxNoSuchField'],
    ['timeline', 'endField'],
  ];
  for (const [door, parse] of DOORS) {
    it.each(UNDECLARED)(`${door}: %s.%s`, (k, key) => {
      const r = parse({ ...NODE, [k]: { ...BASE[k], [key]: 'x' } });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join('.') === k);
      expect({ code: issue?.code, keys: issue?.keys }).toEqual({ code: 'unrecognized_keys', keys: [key] });
    });
  }
});

/* ── 7. The TypeScript face ──────────────────────────────────────────────────── */

type Block<K extends Kind> = NonNullable<TsListViewSchema[K]>;
/** `'closed'` when the block type has no string index signature. */
type Closed<T> = string extends keyof T ? 'open' : 'closed';

describe('objectui#6152 round 11 — the TypeScript face is closed the same way', () => {
  it('no block type carries an index signature any more', () => {
    const kanban: Closed<Block<'kanban'>> = 'closed';
    const calendar: Closed<Block<'calendar'>> = 'closed';
    const gallery: Closed<Block<'gallery'>> = 'closed';
    const timeline: Closed<Block<'timeline'>> = 'closed';
    expect([kanban, calendar, gallery, timeline]).toEqual(['closed', 'closed', 'closed', 'closed']);
  });

  it('refuses each narrowed key at the authoring site, and compiles the lit control', () => {
    const live: TsListViewSchema = {
      type: 'list-view',
      objectName: 'deal',
      kanban: { groupByField: 'stage', columns: ['name'], summarizeField: 'amount' },
      calendar: { startDateField: 'starts_at', titleField: 'name' },
      gallery: { coverField: 'logo', cardSize: 'large' },
      timeline: { startDateField: 'starts_at', titleField: 'name', scale: 'month' },
    };
    // `.partial()` on kanban and timeline: app-shell's derived defaults compile.
    const derived: TsListViewSchema = {
      type: 'list-view',
      objectName: 'deal',
      kanban: { groupByField: 'stage' },
      timeline: { startDateField: 'starts_at' },
    };
    const refused: TsListViewSchema[] = [
      // @ts-expect-error — an undeclared key on the kanban block.
      { type: 'list-view', objectName: 'deal', kanban: { groupByField: 'stage', swimlaneField: 'owner' } },
      // @ts-expect-error — `groupField` is a refusal arm: its type is `undefined`.
      { type: 'list-view', objectName: 'deal', kanban: { groupField: 'stage' } },
      // @ts-expect-error — `cardFields` is a refusal arm.
      { type: 'list-view', objectName: 'deal', kanban: { cardFields: ['name'] } },
      // @ts-expect-error — `imageField` is a refusal arm.
      { type: 'list-view', objectName: 'deal', gallery: { imageField: 'logo' } },
      // @ts-expect-error — `timeline.dateField` is a refusal arm.
      { type: 'list-view', objectName: 'deal', timeline: { dateField: 'starts_at' } },
      // @ts-expect-error — `calendar.defaultView` is a refusal arm.
      { type: 'list-view', objectName: 'deal', calendar: { startDateField: 'starts_at', defaultView: 'week' } },
      // @ts-expect-error — the calendar block requires `startDateField`.
      { type: 'list-view', objectName: 'deal', calendar: { titleField: 'name' } },
      // @ts-expect-error — an undeclared key on the timeline block.
      { type: 'list-view', objectName: 'deal', timeline: { startDateField: 'starts_at', endField: 'ends_at' } },
    ];
    expect(live.kanban?.groupByField).toBe('stage');
    expect(derived.timeline?.startDateField).toBe('starts_at');
    expect(refused).toHaveLength(8);
  });
});
