/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-map` takes its props in the spec's `properties` bag, and the flat
 * spelling retires from both authoring faces (objectui#10859, batch 5).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-map']` row is the published
 * declaration of an authored `object-map` node's props, and the spec's strict
 * `PageComponentSchema` refuses a prop written on the node itself as
 * mis-layered (ADR-0089 D3a). objectui's arm was the flat mirror of the
 * TypeScript twin instead, so the two validators disagreed in both directions:
 *
 *   - the spec-shaped `{ type: 'object-map', properties: { … } }` document was
 *     refused by `safeValidateSchema` — the flat mirror's record-source rule
 *     found no source on the node — and by the strict face, which added
 *     `properties` as an unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * The seat's answer at PR objectui#11248's ACCEPT (A, inherited from
 * objectui#10872's triage answer A) is the one this arm executes, as batch 4
 * did for `object-form`: the `properties` bag is the contract, by reference to
 * the row, and the flat spelling is refused by name with a prescription that
 * names the bag member.
 *
 * ## What the arm keeps that the row does not say
 *
 * The flat mirror's record-source rule (`requireRecordSource`, `77cb489b4`)
 * stays, read in the bag and counting the node's `dataSource` binding. The spec
 * row keeps all three sources optional and has no such rule, so a node with no
 * source at all passes the spec's page component and is refused here, as the
 * flat mirror refused it. The record-source block below holds both readings.
 *
 * ## What did NOT move
 *
 * The TypeScript `ObjectMapSchema` (`../objectql.ts`) and its zod mirror
 * (`ObjectMapSchema` in `../zod/objectql.zod.ts`) stay published: they are the
 * node as `ObjectMap` reads it AFTER `SchemaRenderer` hoists `properties`, and
 * as `ObjectView` / `ListView` compose it. The mirror is no longer an arm of
 * `AnyComponentSchema`; `ObjectMapBlockSchema` is. The last describe block
 * holds that split. The renderer half — the bag draws what the flat spelling
 * drew — is `plugin-map`'s `ObjectMap.propertiesBag-10859.test.tsx`.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME. A green run
 * of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ElementDataSourceSchema as SpecElementDataSourceSchema,
  ObjectMapPropsSchema as SpecObjectMapPropsSchema,
  PageComponentSchema as SpecPageComponentSchema,
  type ObjectMapProps as SpecObjectMapProps,
} from '@objectstack/spec/ui';

import type { ObjectMapSchema as TsObjectMapSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import {
  ObjectMapBlockSchema,
  ObjectMapSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import { stripImportedDefaults } from '../zod/imported-defaults.js';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The arm's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
type Arm = ShapeOf<typeof ObjectMapBlockSchema>;

/**
 * The bag accepts exactly the spec's published props type (absent allowed),
 * the node's binding accepts exactly the spec's element binding, a row key or
 * a flat-mirror compatibility key written flat accepts nothing, and neither
 * content channel accepts anything.
 */
export type assertionObjectMapArmIsTheRow = [
  Expect<Equal<InputOf<Arm['properties']>, SpecObjectMapProps | undefined>>,
  Expect<Equal<InputOf<Arm['dataSource']>, z.input<typeof SpecElementDataSourceSchema> | undefined>>,
  Expect<Equal<InputOf<Arm['objectName']>, undefined>>,
  Expect<Equal<InputOf<Arm['map']>, undefined>>,
  Expect<Equal<InputOf<Arm['staticData']>, undefined>>,
  Expect<Equal<InputOf<Arm['locationField']>, undefined>>,
  Expect<Equal<InputOf<Arm['titleField']>, undefined>>,
  Expect<Equal<InputOf<Arm['children']>, undefined>>,
  Expect<Equal<InputOf<Arm['body']>, undefined>>,
];

/**
 * Every member of the spec row is refused flat on the arm: the refusal set is
 * the row's key set, read by reference, so it cannot fall behind the row.
 */
export type assertionEveryRowKeyIsRefusedFlat = Expect<
  Equal<Exclude<keyof SpecObjectMapProps, keyof Arm>, never>
>;

/**
 * The TypeScript twin is RE-DECLARED, not retired: still published, still the
 * post-hoist reading with its flat members, still a member of the TypeScript
 * ObjectQL union. A narrowing or a removal here reddens `tsc`.
 */
export type assertionTwinStaysPublished = [
  Expect<Equal<TsObjectMapSchema['type'], 'object-map'>>,
  Expect<Equal<TsObjectMapSchema['objectName'], string | undefined>>,
  Expect<Equal<TsObjectMapSchema['locationField'], string | undefined>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'object-map' }>, TsObjectMapSchema>>,
];

/** Non-vacuity: a bag narrower than the spec's props type is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectMapProps | undefined>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

const MAP = { latitudeField: 'lat', longitudeField: 'lng', titleField: 'name', zoom: 9 } as const;

/** An object-bound map with every query key and the map's own settings, in the bag. */
const OBJECT_BOUND = {
  type: 'object-map',
  properties: {
    objectName: 'store',
    map: MAP,
    filter: [{ field: 'region', operator: 'equals', value: 'west' }],
    sort: [{ field: 'name', order: 'desc' }],
    mapStyle: 'https://tiles.example.com/style.json',
    enableClustering: true,
    navigation: { mode: 'drawer' },
  },
} as const;

/** Inline rows, the spelling the three schema-catalog map entries use. */
const INLINE = {
  type: 'object-map',
  properties: { staticData: [{ id: 1, name: 'HQ', lat: 37.7749, lng: -122.4194 }], map: MAP },
} as const;

/** The first rung of the ladder: a `ViewData` provider block. */
const PROVIDER = {
  type: 'object-map',
  properties: { data: { provider: 'value', items: [{ id: 1, lat: 1, lng: 2 }] }, map: MAP },
} as const;

/** The object supplied by the node's binding, the spec's per-element `dataSource`. */
const BOUND = {
  type: 'object-map',
  dataSource: { object: 'store' },
  properties: { map: MAP },
} as const;

/** The flat spelling this batch retires. */
const FLAT = { type: 'object-map', objectName: 'store', map: MAP } as const;

type Issues = z.core.$ZodIssue[];

function issuesOf(result: { success: boolean; error?: { issues: Issues } }): Issues {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
] as const;

describe('object-map validates in the spec\'s `properties` bag (objectui#10859 batch 5)', () => {
  it.each([
    ['an object-bound map with its query keys and settings', OBJECT_BOUND],
    ['a map on inline rows', INLINE],
    ['a map on a `data` provider block', PROVIDER],
    ['a map bound through the node\'s `dataSource`', BOUND],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the fixtures are spec-valid by the spec\'s own page component and row (lit control)', () => {
    for (const doc of [OBJECT_BOUND, INLINE, PROVIDER, BOUND]) {
      const r = SpecPageComponentSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
      expect(SpecObjectMapPropsSchema.safeParse(doc.properties).success).toBe(true);
    }
  });

  it('reaches the arm at a child slot too — a page holding the block', () => {
    expect(safeValidateSchema({ type: 'page', children: [OBJECT_BOUND, BOUND] }).success).toBe(true);
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#10859 batch 5)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the inherited reason holds)', () => {
    const issues = issuesOf(SpecPageComponentSchema.safeParse(FLAT));
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['objectName', 'map']);
  });

  it.each(FACES)('%s refuses the flat node at each flat key, naming `properties.KEY`', (_face, parse) => {
    const issues = issuesOf(parse(FLAT));
    const byPath = new Map(issues.map((i) => [i.path.join('.'), i.message]));
    // objectui#11117: the record-source refinement now runs beside the flat-key
    // refusals (`when: () => true`, shared by every gate-wrapped arm), so the
    // flat node, whose bag holds no source, also carries the ROOT
    // `RECORD_SOURCE_REQUIRED` issue. The flat keys are still the only KEYED issues.
    expect([...byPath.keys()].sort()).toEqual(['', 'map', 'objectName']);
    expect((issues.find((i) => i.path.length === 0) as { params?: { code?: string } }).params?.code)
      .toBe('RECORD_SOURCE_REQUIRED');
    expect(byPath.get('objectName')).toContain('`objectName` → `properties.objectName`');
    expect(byPath.get('map')).toContain('`map` → `properties.map`');
    // The prescription is the whole document shape, not only the path.
    expect(byPath.get('objectName')).toContain('"properties": {');
  });

  // Every member of the spec's row, read off the installed spec on each run —
  // not a transcribed list that could drift from it.
  const ROW_KEYS = Object.keys((SpecObjectMapPropsSchema as unknown as { shape: Record<string, unknown> }).shape);

  it('the row is non-trivial, so the per-key rows below are not vacuous', () => {
    expect(ROW_KEYS.length).toBeGreaterThan(5);
    expect(ROW_KEYS).toEqual(expect.arrayContaining(['objectName', 'data', 'staticData', 'map']));
    // `data` is also a `BaseSchema` key; on this node the arm's refusal wins,
    // because the map's `data` is the row's member.
  });

  it.each(ROW_KEYS.map((key) => [key] as const))('a flat `%s` is refused on the tolerant face, by name', (key) => {
    const issues = issuesOf(safeValidateSchema({ ...OBJECT_BOUND, [key]: true }));
    const issue = issues.find((i) => i.path.join('.') === key);
    expect(issue, JSON.stringify(issues)).toBeDefined();
    expect(issue!.message).toContain(`\`${key}\` → \`properties.${key}\``);
  });

  it.each(['locationField', 'titleField'] as const)(
    'the flat mirror\'s compatibility member `%s` is refused by name, pointed at the `map` block in the bag',
    (key) => {
      for (const [, parse] of FACES) {
        const issue = issuesOf(parse({ ...OBJECT_BOUND, [key]: 'location' })).find((i) => i.path.join('.') === key);
        expect(issue).toBeDefined();
        expect(issue!.message).toContain(`\`${key}\` → \`properties.map.${key}\``);
      }
    },
  );

  it.each([
    ['an invented key', 'inventedKey10859b5'],
    // The flat `map`-config spellings the views flatten — never declared on the
    // flat mirror either, so their verdict does not move here.
    ['a flat `map`-config spelling', 'latitudeField'],
  ] as const)('%s written flat stays unjudged on the tolerant face and is refused on the strict face', (_label, key) => {
    // The strictness control: this arm is `BaseSchema`, whose `.passthrough()`
    // every arm keeps, so a key the arm does not declare is not refused by the
    // tolerant face.
    const doc = { ...OBJECT_BOUND, [key]: 'x' };
    expect(safeValidateSchema(doc).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual([key]);
  });
});

describe('the bag is judged by the spec row (objectui#10859 batch 5)', () => {
  const bag = (props: Record<string, unknown>) => ({ type: 'object-map', properties: { objectName: 'store', ...props } });

  it('an undeclared key inside the bag is refused on the TOLERANT face, by name', () => {
    const issue = issuesOf(safeValidateSchema(bag({ inventedKey10859b5: 1 })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859b5']);
  });

  it('a flat `map`-config key written in the bag gets the spec\'s wrong-layer prescription', () => {
    const issue = issuesOf(safeValidateSchema(bag({ locationField: 'location' })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['locationField']);
    expect(issue.message).toContain('`map`');
  });

  it.each([
    ['a typo inside the `map` block (objectui#5157)', { map: { latitudeFieId: 'lat' } }, ['properties', 'map'], 'unrecognized_keys'],
    ['a non-number `map.zoom`', { map: { ...MAP, zoom: 'far' } }, ['properties', 'map', 'zoom'], 'invalid_type'],
    ['the retired string `sort` clause (objectui#8221)', { sort: 'name desc' }, ['properties', 'sort'], 'invalid_type'],
    ['the record form of `filter`', { filter: { region: 'west' } }, ['properties', 'filter'], 'invalid_type'],
    ['a bare array under `data` (objectui#8348)', { data: [{ id: 1 }] }, ['properties', 'data'], 'invalid_type'],
  ] as const)('%s is refused at that member', (_label, props, path, code) => {
    const issue = issuesOf(safeValidateSchema(bag(props)))[0];
    expect(issue.code).toBe(code);
    expect(issue.path).toEqual(path);
  });

  it('the bag is the spec row by reference, through the import boundary', () => {
    const member = ObjectMapBlockSchema.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run.
    expect(keysOf(member)).toEqual(keysOf(SpecObjectMapPropsSchema));
    // The spec exports this row behind a lazy facade; the import boundary
    // hands back the object it resolves to (objectui#8317), and that object
    // answers every probe exactly as the spec's own export does.
    expect(stripImportedDefaults(SpecObjectMapPropsSchema)).toBe(member);
    for (const probe of [
      {},
      { objectName: 'store', map: MAP },
      { inventedKey10859b5: 1 },
      { objectName: 7 },
      { filters: [] },
      { locationField: 'location' },
      { data: { provider: 'object', object: 'store' } },
      { navigation: 'anything' },
    ]) {
      expect(member.safeParse(probe).success, JSON.stringify(probe)).toBe(SpecObjectMapPropsSchema.safeParse(probe).success);
    }
  });

  it('`dataSource` is judged as the spec binding on both faces', () => {
    const adapterShaped = { ...OBJECT_BOUND, dataSource: 'objectstack' };
    expect(safeValidateSchema(adapterShaped).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(adapterShaped).success).toBe(false);
    expect(SpecElementDataSourceSchema.safeParse(BOUND.dataSource).success).toBe(true);
  });

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = issuesOf(safeValidateSchema({ ...OBJECT_BOUND, [key]: [{ type: 'text', content: 'x' }] }))[0];
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`object-map`');
  });
});

describe('the record source is required, read in the bag (objectui#10859 batch 5)', () => {
  const RECORD_SOURCE_REQUIRED = (issues: Issues) =>
    issues.filter((i) => (i as { params?: { code?: string } }).params?.code === 'RECORD_SOURCE_REQUIRED');

  it.each([
    ['the bare node', { type: 'object-map' }],
    ['an empty bag', { type: 'object-map', properties: {} }],
    ['a bag with a `map` block and no source', { type: 'object-map', properties: { map: MAP } }],
  ] as const)('%s is refused on both faces, at the root, naming the bag rungs and the binding', (_label, doc) => {
    for (const [, parse] of FACES) {
      const found = RECORD_SOURCE_REQUIRED(issuesOf(parse(doc)));
      expect(found).toHaveLength(1);
      expect(found[0].path).toEqual([]);
      for (const rung of ['`properties.data`', '`properties.staticData`', '`properties.objectName`', '`dataSource`']) {
        expect(found[0].message).toContain(rung);
      }
    }
  });

  it.each([
    ['`properties.objectName`', { objectName: 'store' }],
    ['`properties.staticData`', { staticData: [] }],
    ['`properties.data`', { data: { provider: 'object', object: 'store' } }],
  ] as const)('%s alone is a source', (_label, props) => {
    expect(safeValidateSchema({ type: 'object-map', properties: props }).success).toBe(true);
  });

  it('the node\'s `dataSource` binding alone is a source — its `object` lands on `objectName`', () => {
    expect(safeValidateSchema({ type: 'object-map', dataSource: { object: 'store' } }).success).toBe(true);
  });

  it('a source written flat is not a source: it is refused by name and pointed at the bag', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'object-map', staticData: [] }));
    const issue = issues.find((i) => i.path.join('.') === 'staticData');
    expect(issue?.message).toContain('`staticData` → `properties.staticData`');
  });

  it('the spec row has no such rule: the spec\'s page component accepts the bare node (the recorded divergence)', () => {
    expect(SpecPageComponentSchema.safeParse({ type: 'object-map' }).success).toBe(true);
    expect(SpecObjectMapPropsSchema.safeParse({}).success).toBe(true);
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#10859 batch 5)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`object-map` is armed by the bag arm, not by the flat mirror', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('object-map');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('object-map');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ObjectMapBlockSchema);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    // It is what `ObjectMap` reads after the hoist, and what `ObjectView` /
    // `ListView` compose — neither is an authored `object-map` node.
    expect(ObjectMapSchema.safeParse(FLAT).success).toBe(true);
    expect(ObjectMapSchema.safeParse({ ...FLAT, locationField: 'location', titleField: 'name' }).success).toBe(true);
    expect(ObjectMapSchema.safeParse({ ...FLAT, map: { latitudeFieId: 'lat' } }).success).toBe(false);
  });
});
