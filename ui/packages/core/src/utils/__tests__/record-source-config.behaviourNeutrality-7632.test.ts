/**
 * objectui#7632 — the shared record-source LADDER is BEHAVIOUR-NEUTRAL at every
 * site that delegates to it.
 *
 * Five view plugins each hand-copied `getDataConfig` — the ruled three-rung
 * ladder `data` -> `staticData` -> `objectName`, published on both faces of the
 * contract (objectui#6939) and pinned by
 * `objectql-record-source-refinement-6939.test.ts`. Collapsing them onto
 * {@link resolveRecordSourceConfig} is only legitimate if it changes nothing any
 * of them resolves, so this file TRANSCRIBES each site's pre-collapse body
 * verbatim from `origin/main` 1ec291c0 and asserts the post-collapse spelling
 * agrees with it across the whole input matrix. A future edit to the shared
 * reader that moves any site turns this red.
 *
 * ## The population is NOT four-identical-plus-one
 *
 * The card measured "four byte-identical modulo the parameter type, plus
 * calendar's `in` guards". Re-measuring on 1ec291c0 found THREE shapes, and the
 * third one is behavioural:
 *
 *  - `ObjectGantt`, `ObjectTree` — the bare ladder.
 *  - `ObjectCalendar` — `'data' in schema && schema.data` guards, because at
 *    that commit its props parameter was the union `ObjectGridSchema |
 *    CalendarSchema` and the second member declared neither `data` nor
 *    `staticData`. Type-level only: an absent property reads `undefined`, which
 *    is falsy either way. `CALENDAR_IN_GUARD` below pins that equivalence
 *    directly, on a schema that really lacks both keys.
 *    ⛔ That union is RETIRED (objectui#8651) —
 *    `ObjectCalendarComponentProps.schema` is the published
 *    `ObjectCalendarSchema` today — so this clause is HISTORY, describing the
 *    tree at 1ec291c0 that the transcriptions below come from. It is not a
 *    reading anyone can re-derive from `main`, and it is kept only because it
 *    is why the guard was there to transcribe.
 *  - `ObjectGrid`, `ObjectMap` — a bare-array `data` shorthand normalized to
 *    `{ provider: 'value', items }`, which the other three do NOT have. This is
 *    a REAL divergence on off-contract input: those three return the array
 *    verbatim, so `dataConfig.provider` is `undefined` downstream and the block
 *    draws nothing.
 *
 * ## ⭐ objectui#8348 — what this file now pins, and what it still pins
 *
 * The divergence above was PRESERVED by objectui#7632 and is RULED on by
 * decision batch #83 (2026-09-08, maintainer verbatim 「8348 以协议为准」): rung 1
 * honours `data` only on the arm the block's PUBLISHED row declares. So this
 * file keeps its original job — the shared rung moves nothing at any site — for
 * every input the ruling leaves alone, and pins the ruled MOVES explicitly
 * where it does not:
 *
 *  - `object-calendar` (row: `z.array(z.unknown())`) no longer takes a
 *    `{ provider, items }` object as a record source;
 *  - `object-grid`, `object-map`, `object-gantt` (row: `ViewData`) no longer
 *    take a bare array, and grid's and map's normalizing heads are gone;
 *  - `object-tree` (row: `ViewData`, since ruling batch #136 item 3 Q1-C had
 *    the protocol gain it) no longer takes a bare array either. It passed the
 *    `'undeclared'` arm while no published face declared a `data` row for it.
 *
 * The pre-collapse bodies transcribed below stay as the reference for both
 * halves: they are what "unchanged" means, and they are the ⛔ CONTROL that
 * makes "changed" a measurement instead of a restatement.
 */
import { describe, it, expect } from 'vitest';
import { resolveRecordSourceConfig } from '../record-source.js';

type Schema = { objectName?: string; data?: any; staticData?: any[] };
type Cfg = { provider?: string; object?: string; items?: unknown[] } | null;

/** The bare ladder — `ObjectGantt:321` and `ObjectTree:93`, verbatim. */
const beforeBare = (schema: Schema): Cfg => {
  if (schema.data) return schema.data;
  if (schema.staticData) return { provider: 'value', items: schema.staticData };
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/** `ObjectCalendar:118`, verbatim — the `in`-guarded ladder. */
const beforeCalendar = (schema: Schema): Cfg => {
  if ('data' in schema && schema.data) return schema.data;
  if ('staticData' in schema && schema.staticData) {
    return { provider: 'value', items: schema.staticData };
  }
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/** `ObjectGrid:428`, verbatim — the ladder with the array shorthand inside rung 1. */
const beforeGrid = (schema: Schema): Cfg => {
  if (schema.data) {
    if (Array.isArray(schema.data)) return { provider: 'value', items: schema.data };
    return schema.data;
  }
  if (schema.staticData) return { provider: 'value', items: schema.staticData };
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/** `ObjectMap:128`, verbatim — same shape as grid, spelled through `authored`. */
const beforeMap = (schema: Schema): Cfg => {
  if (schema.data) {
    const authored: unknown = schema.data;
    if (Array.isArray(authored)) return { provider: 'value', items: authored };
    return schema.data;
  }
  if (schema.staticData) return { provider: 'value', items: schema.staticData };
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/**
 * The ladder with rung 1 REMOVED — where an authored `data` that is off its
 * block's declared arm now lands (objectui#8348). Not a third hand-copy: it is
 * the expected value this file compares against, written out so a reader can
 * see that "refused at rung 1" means "falls through to `staticData`, then
 * `objectName`" and not "returns null".
 */
const ladderBelowRungOne = (schema: Schema): Cfg => {
  if (schema.staticData) return { provider: 'value', items: schema.staticData };
  if (schema.objectName) return { provider: 'object', object: schema.objectName };
  return null;
};

/**
 * The five sites, each with the arm its block's PUBLISHED `data` row declares
 * (objectui#8348, decision batch #83 — 「8348 以协议为准」). The arm is what the
 * site passes today; `before` is what the site resolved before the collapse
 * (objectui#7632), which is still the reference for every input the ruling does
 * not move.
 */
const SITES: { id: string; arm: 'view-data' | 'array' | 'undeclared'; before: (s: Schema) => Cfg }[] = [
  { id: 'ObjectGantt', arm: 'view-data', before: beforeBare },
  { id: 'ObjectTree', arm: 'view-data', before: beforeBare },
  { id: 'ObjectCalendar', arm: 'array', before: beforeCalendar },
  { id: 'ObjectGrid', arm: 'view-data', before: beforeGrid },
  { id: 'ObjectMap', arm: 'view-data', before: beforeMap },
];

/** What the site resolves TODAY. */
const after = (site: (typeof SITES)[number], schema: Schema): Cfg =>
  resolveRecordSourceConfig(schema as any, site.arm) as Cfg;

/** Is the authored `data` a `ViewData` OBJECT (the arm calendar's row refuses)? */
const hasObjectData = (s: Schema): boolean => !!s.data && !Array.isArray(s.data);

/**
 * Contract-valid by construction: `ViewDataSchema` is a
 * `z.discriminatedUnion('provider', [...])` over object variants whose `object`
 * member declares `object` REQUIRED.
 */
const CONTRACT_VALID: [string, Schema][] = [
  ['both-bindings', { objectName: 'Y', data: { provider: 'object', object: 'X' } }],
  ['data-only', { data: { provider: 'object', object: 'X' } }],
  ['objectName-only', { objectName: 'Y' }],
  ['empty-objectName', { objectName: '', data: { provider: 'object', object: 'X' } }],
  ['api-provider', { objectName: 'Y', data: { provider: 'api', read: { url: '/x' } } }],
  ['api-provider-no-name', { data: { provider: 'api', read: { url: '/x' } } }],
  ['value-provider', { objectName: 'Y', data: { provider: 'value', items: [1] } }],
  ['value-provider-empty-items', { objectName: 'Y', data: { provider: 'value', items: [] } }],
  ['staticData+objectName', { objectName: 'Y', staticData: [1] }],
  ['staticData-only', { staticData: [1] }],
  ['staticData-empty', { objectName: 'Y', staticData: [] }],
  ['data-object-empty-string', { objectName: 'Y', data: { provider: 'object', object: '' } }],
  ['empty-objectName-only', { objectName: '' }],
  ['nothing-bound', {}],
  ['all-three', { objectName: 'Y', staticData: [1], data: { provider: 'object', object: 'X' } }],
];

describe('resolveRecordSourceConfig — behaviour neutrality on contract-valid input (objectui#7632)', () => {
  for (const [name, schema] of CONTRACT_VALID) {
    for (const site of SITES) {
      // ⭐ objectui#8348 moves exactly one cell family of this matrix, and the
      // branch below is what keeps the rest a neutrality claim rather than a
      // rewritten expectation. `object-calendar`'s published row is
      // `z.array(z.unknown())`, so a `ViewData` OBJECT under `data` is no
      // longer a record source THERE — and nowhere else.
      const ruledAway = site.arm === 'array' && hasObjectData(schema);
      it(`${site.id} ${ruledAway ? 'refuses the off-arm `data` (objectui#8348)' : 'is unchanged'} for "${name}"`, () => {
        if (ruledAway) {
          expect(after(site, schema)).not.toEqual(site.before(schema));
          expect(after(site, schema)).toEqual(ladderBelowRungOne(schema));
        } else {
          expect(after(site, schema)).toEqual(site.before(schema));
        }
      });
    }
  }

  it('the matrix is a LIT control: every rung of the ladder is actually exercised', () => {
    const reached = new Set(
      CONTRACT_VALID.map(([, s]) => {
        const cfg = resolveRecordSourceConfig(s as any, 'view-data');
        if (cfg === null) return 'null';
        if (s.data) return 'data';
        if (s.staticData) return 'staticData';
        return 'objectName';
      }),
    );
    // A matrix that never reaches a rung cannot prove that rung neutral.
    expect([...reached].sort()).toEqual(['data', 'null', 'objectName', 'staticData']);
  });

  it('⛔ NON-VACUITY: the ruled-away family is not empty', () => {
    // Without this, a `hasObjectData` that answered `false` everywhere would
    // turn the branch above into "everything is unchanged" and the file would
    // pass while asserting nothing about the ruling.
    const ruled = CONTRACT_VALID.filter(([, s]) => hasObjectData(s));
    expect(ruled.length).toBeGreaterThan(0);
    expect(SITES.filter((site) => site.arm === 'array')).toHaveLength(1);
  });
});

/**
 * The bare array under `data` — the fork objectui#7632 preserved and
 * objectui#8348 RESOLVES, by the row rather than by convention.
 *
 * Before this card: `ObjectGrid` and `ObjectMap` lifted `data: [...]` to
 * `{ provider: 'value', items }` at their own sites; gantt, tree and calendar
 * returned the array verbatim (`provider` `undefined` downstream). Decision
 * batch #83 rules by each block's published row, and the rows are not the same
 * shape, so the fork does not close onto ONE answer — it closes onto the
 * declared one per block:
 *
 *  - `object-grid` — row is `ViewData`, and its own spec description says "the
 *    bare-array shortcut is refused". ⇒ the lift is gone; the array falls
 *    through rung 1.
 *  - `object-map`, `object-gantt`, `object-tree` — their `ComponentPropsMap`
 *    rows (which ruling batch #136 item 3, Q1-C, had the protocol gain) are the
 *    `ViewData` union too. ⇒ same verdict. Each block's pin derives that from
 *    the INSTALLED row (`dataArmSpecRow-8348` in each plugin's tests); map and
 *    gantt were judged through `ObjectMapSchema.data` / `ObjectGanttSchema.data`
 *    as an interim, and tree passed `'undeclared'` and kept the array.
 *  - `object-calendar` — row IS `z.array(z.unknown())`
 *    ("Pre-fetched records — skips the internal fetch"), so the array is the
 *    DECLARED spelling and rung 1 still returns it verbatim. Unmoved.
 */
const ARRAY_SHORTHAND: [string, Schema][] = [
  ['array-shorthand', { objectName: 'Y', data: [1, 2] }],
  ['array-shorthand-empty', { objectName: 'Y', data: [] }],
  ['array-shorthand-no-name', { data: [{ id: 1 }] }],
  ['array-shorthand+staticData', { staticData: [9], data: [1] }],
];

describe('the bare-array `data` shorthand, judged by the row (objectui#8348)', () => {
  for (const [name, schema] of ARRAY_SHORTHAND) {
    it(`grid, map, gantt and tree no longer honour it for "${name}"`, () => {
      for (const site of SITES.filter((s) => s.arm === 'view-data')) {
        expect(after(site, schema), site.id).toEqual(ladderBelowRungOne(schema));
        // The named regression: the lift is gone, not relocated.
        expect(after(site, schema), site.id).not.toEqual({
          provider: 'value',
          items: schema.data,
        });
      }
      // ⛔ CONTROL: the pre-8348 grid/map bodies transcribed at the top of this
      // file DID lift it — so the rows above are a change in behaviour, not a
      // restatement of what was already true.
      expect(beforeGrid(schema)).toEqual({ provider: 'value', items: schema.data });
      expect(beforeMap(schema)).toEqual({ provider: 'value', items: schema.data });
    });

    it(`calendar still returns it verbatim for "${name}"`, () => {
      for (const site of SITES.filter((s) => s.arm !== 'view-data')) {
        expect(after(site, schema), site.id).toBe(schema.data);
      }
      // Unmoved against the pre-collapse body, which is the objectui#7632
      // neutrality claim still holding for this site.
      expect(beforeCalendar(schema)).toBe(schema.data);
    });

    it(`⛔ CONTROL: the tree's pre-8348 body returned it verbatim for "${name}", so the tree's row above is a MOVE`, () => {
      // `ObjectTree` shares `beforeBare` with `ObjectGantt`; the bare body
      // took the array as rung 1. Without this leg the tree's inclusion in the
      // row above would read as a restatement rather than as a change.
      expect(beforeBare(schema)).toBe(schema.data);
      expect(SITES.find((s) => s.id === 'ObjectTree')?.arm).toBe('view-data');
    });
  }

  it('an empty array is still truthy — so this is an ARM verdict, not a falsiness one', () => {
    // `[]` was the case that made the old head's hoist neutral. It is also the
    // case that proves the new rung 1 discriminates on SHAPE rather than on
    // truthiness: a `view-data` site drops `data: []` even though it is truthy,
    // and an `array` site keeps it.
    expect(Boolean([])).toBe(true);
    const schema: Schema = { objectName: 'Y', staticData: [9], data: [] };
    expect(resolveRecordSourceConfig(schema as any, 'view-data')).toEqual({
      provider: 'value',
      items: [9],
    });
    expect(resolveRecordSourceConfig(schema as any, 'array')).toBe(schema.data);
  });
});

/**
 * The other direction of the same ruling: the `{ provider, items }` config
 * object on the block whose row is the ARRAY arm — the exact spelling
 * objectui#8348 was filed about.
 *
 * `ComponentPropsMap['object-calendar'].data.safeParse({ provider: 'value',
 * items: [] })` fails with `invalid_type … expected: 'array'`, so `os validate`
 * and the save gate refuse it. As of this card the renderer refuses it too.
 */
describe('the `{ provider, items }` object on an ARRAY-armed block (objectui#8348)', () => {
  const OFF_ARM: [string, Schema][] = [
    ['value-provider + objectName', { objectName: 'Y', data: { provider: 'value', items: [{ id: 1 }] } }],
    ['value-provider alone', { data: { provider: 'value', items: [{ id: 1 }] } }],
    ['value-provider + staticData', { staticData: [9], data: { provider: 'value', items: [{ id: 1 }] } }],
    ['object-provider + objectName', { objectName: 'Y', data: { provider: 'object', object: 'X' } }],
  ];

  for (const [name, schema] of OFF_ARM) {
    it(`is not a record source for "${name}"`, () => {
      expect(resolveRecordSourceConfig(schema as any, 'array')).toEqual(
        ladderBelowRungOne(schema),
      );
      expect(resolveRecordSourceConfig(schema as any, 'array')).not.toBe(schema.data);
    });

    it(`⛔ CONTROL: the same document IS a record source on a view-data arm for "${name}"`, () => {
      // Without this leg, a rung 1 that had simply stopped working would satisfy
      // every assertion above.
      expect(resolveRecordSourceConfig(schema as any, 'view-data')).toBe(schema.data);
    });
  }
});

/**
 * `ObjectCalendar`'s `in` guards, on the schema shape that motivated them: a
 * schema carrying neither `data` nor `staticData`, so the guard is a TypeScript
 * narrowing device with no runtime effect. Pinned directly rather than argued,
 * because "the guard is load-bearing" was the card's claim.
 *
 * ⛔ The shape used to be named here as `CalendarSchema`, the second member of
 * the props union `ObjectCalendar` carried at 1ec291c0. objectui#8651 retired
 * that union, so the name no longer resolves to anything a reader can open —
 * and naming it was never what this block measures. What it measures is the
 * KEYS, which the fixtures below carry (or do not) directly, and the `LIT
 * control` row is what proves they really do.
 */
describe('the `in`-guard divergence is type-level, not behavioural (objectui#7632)', () => {
  const CALENDAR_IN_GUARD: [string, Schema][] = [
    ['no data/staticData keys at all', { objectName: 'Y' }],
    ['keys present but undefined', { objectName: 'Y', data: undefined, staticData: undefined }],
    ['keys absent, nothing bound', {}],
    ['staticData only, no data key', { staticData: [1] }],
  ];

  for (const [name, schema] of CALENDAR_IN_GUARD) {
    it(`the guarded and unguarded ladders agree for "${name}"`, () => {
      expect(resolveRecordSourceConfig(schema as any, 'array')).toEqual(beforeCalendar(schema));
      expect(beforeCalendar(schema)).toEqual(beforeBare(schema));
    });
  }

  it('is a LIT control: the fixtures really do lack the keys', () => {
    expect('data' in CALENDAR_IN_GUARD[0][1]).toBe(false);
    expect('staticData' in CALENDAR_IN_GUARD[0][1]).toBe(false);
    expect('data' in CALENDAR_IN_GUARD[1][1]).toBe(true);
  });
});
