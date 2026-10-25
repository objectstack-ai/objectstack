/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-gantt` takes its props in the spec's `properties` bag, and the flat
 * spelling retires from both authoring faces (objectui#10859, batch 6).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-gantt']` row is the
 * published declaration of an authored `object-gantt` node's props, and the
 * spec's strict `PageComponentSchema` refuses a prop written on the node itself
 * as mis-layered (ADR-0089 D3a). objectui's arm was the flat mirror of the
 * TypeScript twin instead, so the two validators disagreed in both directions:
 *
 *   - the spec-shaped `{ type: 'object-gantt', properties: { … } }` document
 *     was refused by `safeValidateSchema` — the flat mirror's record-source
 *     rule found no source on the node — and by the strict face, which added
 *     `properties` as an unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * The seat's answer at PR objectui#11248's ACCEPT (A, inherited from
 * objectui#10872's triage answer A) is the one this arm executes, as batches
 * 4 and 5 did for `object-form` and `object-map`: the `properties` bag is the
 * contract, by reference to the row, and the flat spelling is refused by name
 * with a prescription that names the bag member.
 *
 * ## What is particular to this node
 *
 *   - The flat mirror also declared the whole `GanttConfig` vocabulary flat on
 *     the node (`startDateField`, `viewMode`, …, the flatten product
 *     `getGanttConfig` reads when there is no `gantt` block) and the legacy
 *     `dependencyField` alias. Each is refused by name and pointed at the
 *     bag's `gantt` block, the home the row gives them.
 *   - `label` is a row member AND a node-level key of the spec's page
 *     component (its display label), so it is the one row member a node may
 *     still carry. The split is re-derived from the installed spec below,
 *     member by member, not transcribed.
 *   - The row carries spec defaults (inside `data`'s `api` provider), so the
 *     import boundary hands back a rebuilt copy: the pins below hold the key
 *     set, probe equivalence and type-level equality, and that no default is
 *     authored into a document.
 *   - The record-source rule stays, read in the bag, and the node's
 *     `dataSource` binding counts: a node bound only through `dataSource`
 *     parses on both faces (the batch-5 finding, closed for this arm).
 *
 * ## What did NOT move
 *
 * The TypeScript `ObjectGanttSchema` (`../objectql.ts`) and its zod mirror
 * (`ObjectGanttSchema` in `../zod/objectql.zod.ts`) stay published: they are
 * the node as `ObjectGantt` reads it AFTER `SchemaRenderer` hoists
 * `properties`, and as `ObjectView` / `ListView` compose it. The mirror is no
 * longer an arm of `AnyComponentSchema`; `ObjectGanttBlockSchema` is. The last
 * describe block holds that split. The renderer half — the bag draws what the
 * flat spelling drew — is `plugin-gantt`'s `ObjectGantt.propertiesBag-10859.test.tsx`.
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
  ObjectGanttPropsSchema as SpecObjectGanttPropsSchema,
  PageComponentSchema as SpecPageComponentSchema,
  type ObjectGanttProps as SpecObjectGanttProps,
} from '@objectstack/spec/ui';

import type { ObjectGanttSchema as TsObjectGanttSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import {
  ObjectGanttBlockSchema,
  ObjectGanttSchema,
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
type Arm = ShapeOf<typeof ObjectGanttBlockSchema>;
/** A member of the row's `gantt` block. */
type GanttBlockKey = keyof NonNullable<SpecObjectGanttProps['gantt']>;

/**
 * The bag accepts exactly the spec's published props type (absent allowed),
 * the node's binding accepts exactly the spec's element binding, a row key, a
 * `gantt`-block key or the legacy alias written flat accepts nothing, and
 * neither content channel accepts anything.
 */
export type assertionObjectGanttArmIsTheRow = [
  Expect<Equal<InputOf<Arm['properties']>, SpecObjectGanttProps | undefined>>,
  Expect<Equal<InputOf<Arm['dataSource']>, z.input<typeof SpecElementDataSourceSchema> | undefined>>,
  Expect<Equal<InputOf<Arm['objectName']>, undefined>>,
  Expect<Equal<InputOf<Arm['gantt']>, undefined>>,
  Expect<Equal<InputOf<Arm['staticData']>, undefined>>,
  Expect<Equal<InputOf<Arm['readOnly']>, undefined>>,
  Expect<Equal<InputOf<Arm['startDateField']>, undefined>>,
  Expect<Equal<InputOf<Arm['viewMode']>, undefined>>,
  Expect<Equal<InputOf<Arm['dependencyField']>, undefined>>,
  Expect<Equal<InputOf<Arm['children']>, undefined>>,
  Expect<Equal<InputOf<Arm['body']>, undefined>>,
];

/**
 * Every member of the spec row, and every member of its `gantt` block, is a
 * member of the arm — refused flat, or (`label` alone) kept as the node-level
 * key the spec's page component declares. Both sets are read by reference, so
 * they cannot fall behind the row.
 */
export type assertionEveryRowKeyIsOnTheArm = [
  Expect<Equal<Exclude<keyof SpecObjectGanttProps, keyof Arm>, never>>,
  Expect<Equal<Exclude<GanttBlockKey, keyof Arm>, never>>,
  // `label` is NOT refused: it is `BaseSchema`'s member, which accepts a string.
  Expect<Equal<Equal<InputOf<Arm['label']>, undefined>, false>>,
];

/**
 * The TypeScript twin is RE-DECLARED, not retired: still published, still the
 * post-hoist reading with its flat members, still a member of the TypeScript
 * ObjectQL union. A narrowing or a removal here reddens `tsc`.
 */
export type assertionTwinStaysPublished = [
  Expect<Equal<TsObjectGanttSchema['type'], 'object-gantt'>>,
  Expect<Equal<TsObjectGanttSchema['objectName'], string | undefined>>,
  Expect<Equal<TsObjectGanttSchema['startDateField'], string | undefined>>,
  Expect<Equal<TsObjectGanttSchema['search'], string | undefined>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'object-gantt' }>, TsObjectGanttSchema>>,
];

/** Non-vacuity: a bag narrower than the spec's props type is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectGanttProps | undefined>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

const GANTT = { startDateField: 'start', endDateField: 'end', titleField: 'name', progressField: 'progress' } as const;

/** An object-bound gantt with its query keys and display options, in the bag. */
const OBJECT_BOUND = {
  type: 'object-gantt',
  properties: {
    objectName: 'task',
    gantt: { ...GANTT, viewMode: 'week', dependenciesField: 'depends_on' },
    filter: [{ field: 'status', operator: 'equals', value: 'open' }],
    sort: [{ field: 'start', order: 'asc' }],
    navigation: { mode: 'drawer' },
    criticalPath: true,
    skipWeekends: true,
    holidays: ['2026-12-25'],
    readOnly: false,
    label: 'Release plan',
  },
} as const;

/** Inline rows, the spelling the three schema-catalog gantt entries use. */
const INLINE = {
  type: 'object-gantt',
  properties: { staticData: [{ id: 1, name: 'Design', start: '2024-01-01', end: '2024-01-15' }], gantt: GANTT },
} as const;

/** The first rung of the ladder: a `ViewData` provider block. */
const PROVIDER = {
  type: 'object-gantt',
  properties: { data: { provider: 'value', items: [{ id: 1, name: 'Design' }] }, gantt: GANTT },
} as const;

/** The object supplied by the node's binding, the spec's per-element `dataSource`. */
const BOUND = {
  type: 'object-gantt',
  dataSource: { object: 'task' },
  properties: { gantt: GANTT },
} as const;

/** The node-level display label the spec's page component declares, beside the row's own. */
const LABELLED = { ...OBJECT_BOUND, label: 'Plan' } as const;

/** The flat spelling this batch retires. */
const FLAT = { type: 'object-gantt', objectName: 'task', gantt: GANTT } as const;

type Issues = z.core.$ZodIssue[];

function issuesOf(result: { success: boolean; error?: { issues: Issues } }): Issues {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
] as const;

/** Every member of the spec's row, read off the installed spec on each run. */
const ROW_KEYS = Object.keys((SpecObjectGanttPropsSchema as unknown as { shape: Record<string, unknown> }).shape);
/** Every member of the row's `gantt` block, read the same way. */
const GANTT_BLOCK_KEYS = Object.keys(
  ((SpecObjectGanttPropsSchema as unknown as { shape: { gantt: { unwrap(): { shape: Record<string, unknown> } } } })
    .shape.gantt.unwrap()).shape,
);

describe('object-gantt validates in the spec\'s `properties` bag (objectui#10859 batch 6)', () => {
  it.each([
    ['an object-bound gantt with its query keys and display options', OBJECT_BOUND],
    ['a gantt on inline rows', INLINE],
    ['a gantt on a `data` provider block', PROVIDER],
    ['a gantt bound only through the node\'s `dataSource`', BOUND],
    ['a gantt with the node-level display `label` beside the row\'s own', LABELLED],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the fixtures are spec-valid by the spec\'s own page component and row (lit control)', () => {
    for (const doc of [OBJECT_BOUND, INLINE, PROVIDER, BOUND, LABELLED]) {
      const r = SpecPageComponentSchema.safeParse(doc);
      expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
      expect(SpecObjectGanttPropsSchema.safeParse(doc.properties).success).toBe(true);
    }
  });

  it('reaches the arm at a child slot too — a page holding the block', () => {
    expect(safeValidateSchema({ type: 'page', children: [OBJECT_BOUND, BOUND] }).success).toBe(true);
  });

  // This pin used to ride on the `api` arm's `read.method` default. That arm
  // is retired in the spec (objectstack#23082, objectui#12325), so it rides on
  // `navigation`, whose spec row writes defaults too.
  it('authors no default into the document: the row\'s `navigation` defaults are stripped (objectui#8317)', () => {
    const doc = {
      type: 'object-gantt',
      properties: { objectName: 'task', navigation: {}, gantt: GANTT },
    } as const;
    // Control: the spec's own row writes a default `mode` into its output.
    const specOut = SpecObjectGanttPropsSchema.parse(doc.properties) as unknown as { navigation: Record<string, unknown> };
    expect(specOut.navigation.mode).toBe('page');
    // This face validates and writes nothing.
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const out = result.data as unknown as { properties: { navigation: Record<string, unknown> } };
    expect(Object.keys(out.properties.navigation)).toEqual([]);
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#10859 batch 6)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the inherited reason holds)', () => {
    const issues = issuesOf(SpecPageComponentSchema.safeParse(FLAT));
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['objectName', 'gantt']);
  });

  it.each(FACES)('%s refuses the flat node at each flat key, naming `properties.KEY`', (_face, parse) => {
    const issues = issuesOf(parse(FLAT));
    const byPath = new Map(issues.map((i) => [i.path.join('.'), i.message]));
    // The record-source refinement runs beside the flat-key refusals (`when:
    // () => true`), so the flat node, whose bag holds no source, also carries
    // the ROOT `RECORD_SOURCE_REQUIRED` issue. The flat keys are the KEYED issues.
    expect([...byPath.keys()].sort()).toEqual(['', 'gantt', 'objectName']);
    expect((issues.find((i) => i.path.length === 0) as { params?: { code?: string } }).params?.code)
      .toBe('RECORD_SOURCE_REQUIRED');
    expect(byPath.get('objectName')).toContain('`objectName` → `properties.objectName`');
    expect(byPath.get('gantt')).toContain('`gantt` → `properties.gantt`');
    // The prescription is the whole document shape, not only the path.
    expect(byPath.get('objectName')).toContain('"properties": {');
  });

  it('the row and its `gantt` block are non-trivial, so the per-key rows below are not vacuous', () => {
    expect(ROW_KEYS.length).toBeGreaterThan(10);
    expect(ROW_KEYS).toEqual(expect.arrayContaining(['objectName', 'data', 'staticData', 'gantt', 'label']));
    expect(GANTT_BLOCK_KEYS.length).toBeGreaterThan(20);
    expect(GANTT_BLOCK_KEYS).toEqual(expect.arrayContaining(['startDateField', 'endDateField', 'titleField', 'viewMode']));
  });

  // The one exception, re-derived from the installed spec: a row member the
  // spec's page component ALSO declares on the node is not mis-layered there.
  it.each(ROW_KEYS.map((key) => [key] as const))(
    'a flat `%s` is refused by the spec\'s page component exactly when it is not a node-level key',
    (key) => {
      const verdict = SpecPageComponentSchema.safeParse({ ...OBJECT_BOUND, [key]: 'x' });
      const unrecognized = verdict.success
        ? []
        : verdict.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? (i as { keys: string[] }).keys : []));
      expect(unrecognized.includes(key), JSON.stringify(verdict.success ? null : verdict.error.issues)).toBe(key !== 'label');
    },
  );

  it.each(ROW_KEYS.filter((key) => key !== 'label').map((key) => [key] as const))(
    'a flat `%s` is refused on the tolerant face, by name',
    (key) => {
      const issues = issuesOf(safeValidateSchema({ ...OBJECT_BOUND, [key]: true }));
      const issue = issues.find((i) => i.path.join('.') === key);
      expect(issue, JSON.stringify(issues)).toBeDefined();
      expect(issue!.message).toContain(`\`${key}\` → \`properties.${key}\``);
    },
  );

  it('a node-level `label` is kept on both faces, as the spec\'s page component keeps it', () => {
    for (const [, parse] of FACES) {
      expect(parse(LABELLED).success).toBe(true);
      expect(parse({ ...OBJECT_BOUND, label: 7 }).success).toBe(false);
    }
  });

  it.each(GANTT_BLOCK_KEYS.map((key) => [key] as const))(
    'the flat `GanttConfig` member `%s` is refused by name on both faces, pointed at the bag\'s `gantt` block',
    (key) => {
      // Lit control: the spec's page component refuses it flat too.
      const spec = issuesOf(SpecPageComponentSchema.safeParse({ ...OBJECT_BOUND, [key]: 'x' }));
      expect(spec.flatMap((i) => (i as { keys?: string[] }).keys ?? [])).toContain(key);
      for (const [, parse] of FACES) {
        const issue = issuesOf(parse({ ...OBJECT_BOUND, [key]: 'x' })).find((i) => i.path.join('.') === key);
        expect(issue).toBeDefined();
        expect(issue!.message).toContain(`\`${key}\` → \`properties.gantt.${key}\``);
      }
    },
  );

  it('the legacy `dependencyField` alias is refused by name, pointed at the canonical `properties.gantt.dependenciesField`', () => {
    for (const [, parse] of FACES) {
      const issue = issuesOf(parse({ ...OBJECT_BOUND, dependencyField: 'depends_on' }))
        .find((i) => i.path.join('.') === 'dependencyField');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('`dependencyField` → `properties.gantt.dependenciesField`');
    }
  });

  it.each([
    ['an invented key', 'inventedKey10859b6'],
    // The full-text pair a list view writes onto the node it composes — declared
    // on the flat mirror, not in the row, so it is not an authored key here.
    ['the composer-written `search` term', 'search'],
    ['the composer-written `searchableFields`', 'searchableFields'],
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

describe('the bag is judged by the spec row (objectui#10859 batch 6)', () => {
  const bag = (props: Record<string, unknown>) => ({ type: 'object-gantt', properties: { objectName: 'task', ...props } });

  it('an undeclared key inside the bag is refused on the TOLERANT face, by name', () => {
    const issue = issuesOf(safeValidateSchema(bag({ inventedKey10859b6: 1 })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859b6']);
  });

  it('a flat `GanttConfig` key written in the bag gets the spec\'s prescription to move it into `gantt`', () => {
    const issue = issuesOf(safeValidateSchema(bag({ startDateField: 'start' })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['startDateField']);
    expect(issue.message).toContain('`gantt`');
  });

  it.each([
    ['a `gantt` block without its required `titleField` (objectui#6475)', { gantt: { startDateField: 's', endDateField: 'e' } }, ['properties', 'gantt', 'titleField'], 'invalid_type'],
    ['an unknown `viewMode`', { gantt: { ...GANTT, viewMode: 'decade' } }, ['properties', 'gantt', 'viewMode'], 'invalid_value'],
    ['a typo inside the `gantt` block', { gantt: { ...GANTT, progresField: 'p' } }, ['properties', 'gantt'], 'unrecognized_keys'],
    ['the retired string `sort` clause (objectui#8221)', { sort: 'start asc' }, ['properties', 'sort'], 'invalid_type'],
    ['the record form of `filter`', { filter: { status: 'open' } }, ['properties', 'filter'], 'invalid_type'],
    ['a bare array under `data` (objectui#8348)', { data: [{ id: 1 }] }, ['properties', 'data'], 'invalid_type'],
    ['a non-boolean `readOnly`', { readOnly: 'yes' }, ['properties', 'readOnly'], 'invalid_type'],
  ] as const)('%s is refused at that member', (_label, props, path, code) => {
    const issue = issuesOf(safeValidateSchema(bag(props)))[0];
    expect(issue.code).toBe(code);
    expect(issue.path).toEqual(path);
  });

  it('the bag is the spec row by reference, through the import boundary', () => {
    const member = ObjectGanttBlockSchema.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run.
    expect(keysOf(member)).toEqual(keysOf(SpecObjectGanttPropsSchema));
    // The row carries spec defaults, so the boundary hands back a rebuilt copy
    // rather than the export itself — the boundary's own memoised copy — and
    // that copy accepts exactly what the spec's row accepts.
    expect(stripImportedDefaults(SpecObjectGanttPropsSchema)).toBe(member);
    for (const probe of [
      {},
      { objectName: 'task', gantt: GANTT },
      { inventedKey10859b6: 1 },
      { objectName: 7 },
      { startDateField: 'start' },
      { search: 'x' },
      { title: 'x' },
      { gantt: { startDateField: 's' } },
      { data: { provider: 'object', object: 'task' } },
      { data: { provider: 'api', read: { url: '/x', method: 'TRACE' } } },
      { navigation: 'anything' },
      { markers: [{ date: '2026-07-01' }] },
    ]) {
      expect(member.safeParse(probe).success, JSON.stringify(probe)).toBe(SpecObjectGanttPropsSchema.safeParse(probe).success);
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
    expect(issue.message).toContain('`object-gantt`');
  });
});

describe('the record source is required, read in the bag (objectui#10859 batch 6)', () => {
  const RECORD_SOURCE_REQUIRED = (issues: Issues) =>
    issues.filter((i) => (i as { params?: { code?: string } }).params?.code === 'RECORD_SOURCE_REQUIRED');

  it.each([
    ['the bare node', { type: 'object-gantt' }],
    ['an empty bag', { type: 'object-gantt', properties: {} }],
    ['a bag with a `gantt` block and no source', { type: 'object-gantt', properties: { gantt: GANTT } }],
    ['a binding that names no object', { type: 'object-gantt', dataSource: { object: '' }, properties: { gantt: GANTT } }],
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
    ['`properties.objectName`', { objectName: 'task' }],
    ['`properties.staticData`', { staticData: [] }],
    ['`properties.data`', { data: { provider: 'object', object: 'task' } }],
  ] as const)('%s alone is a source', (_label, props) => {
    expect(safeValidateSchema({ type: 'object-gantt', properties: props }).success).toBe(true);
  });

  it('the node\'s `dataSource` binding alone is a source, on both faces — its `object` lands on `objectName`', () => {
    for (const [, parse] of FACES) {
      expect(parse({ type: 'object-gantt', dataSource: { object: 'task' } }).success).toBe(true);
      expect(parse(BOUND).success).toBe(true);
    }
  });

  it('a source written flat is not a source: it is refused by name and pointed at the bag', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'object-gantt', staticData: [] }));
    const issue = issues.find((i) => i.path.join('.') === 'staticData');
    expect(issue?.message).toContain('`staticData` → `properties.staticData`');
  });

  it('the spec row has no such rule: the spec\'s page component accepts the bare node (the recorded divergence)', () => {
    expect(SpecPageComponentSchema.safeParse({ type: 'object-gantt' }).success).toBe(true);
    expect(SpecObjectGanttPropsSchema.safeParse({}).success).toBe(true);
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#10859 batch 6)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`object-gantt` is armed by the bag arm, not by the flat mirror', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('object-gantt');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('object-gantt');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ObjectGanttBlockSchema);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    // It is what `ObjectGantt` reads after the hoist, and what `ObjectView` /
    // `ListView` compose — neither is an authored `object-gantt` node.
    expect(ObjectGanttSchema.safeParse(FLAT).success).toBe(true);
    expect(
      ObjectGanttSchema.safeParse({ type: 'object-gantt', objectName: 'task', ...GANTT, viewMode: 'week', search: 'x' }).success,
    ).toBe(true);
    expect(ObjectGanttSchema.safeParse({ ...FLAT, gantt: { startDateField: 's' } }).success).toBe(false);
  });
});
