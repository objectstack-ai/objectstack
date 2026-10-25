/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-grid` takes its props in the spec's `properties` bag, and the flat
 * spelling retires from both authoring faces (objectui#11276, the
 * `object-grid` batch of triage's routing call A).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s `ComponentPropsMap['object-grid']` row is the published
 * declaration of an authored `object-grid` node's props, and the spec's strict
 * `PageComponentSchema` refuses a prop written on the node itself as
 * mis-layered (ADR-0089 D3a). objectui's arm was the flat mirror of the
 * TypeScript twin instead, so the two validators disagreed in both directions:
 *
 *   - the objectstack showcase's work queues (`command-center.page.ts` and
 *     `my-work.page.ts` in objectstack's `examples/app-showcase`), written
 *     `{ type: 'object-grid', properties: { objectName, columns, … } }`, were
 *     refused by `safeValidateSchema` — the flat mirror's record-source rule
 *     found no `objectName` on the node — and by the strict face, which added
 *     `properties` as an unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * Triage's answer on objectui#11276 is the one this arm executes: "A block
 * schema takes the `properties` bag, while the flat mirror keeps the
 * `object-view` table slot", by reference to the row, with the flat spelling
 * refused by name and a prescription that names the bag member.
 *
 * ## What is particular to this node
 *
 *   - The flat spelling is refused by `flatPropRefusals`, the shared helper.
 *     `label` is a row member AND a node-level key of the spec's page component
 *     (its display label), so it stays on the node; `defaultSort` is a member
 *     the row itself retires, so written flat it keeps the row's retirement.
 *     Both splits are re-derived from the installed spec below, not transcribed.
 *   - The flat mirror's own retirements of keys the row does not declare
 *     (`operators`, `rowSpecActions`, `bulkSpecActions`, `name`, `placeholder`,
 *     `showFilters`) and its content-channel refusals ride onto the arm by
 *     reference; its `onNavigate` runtime slot is declared as it declares it.
 *   - The row carries spec defaults (inside `data`'s `api` provider), so the
 *     import boundary hands back a rebuilt copy: the pins below hold the key
 *     set, probe equivalence and type-level equality, and that no default is
 *     authored into a document.
 *   - The record-source rule (objectui#11117) stays, read in the bag, and the
 *     node's `dataSource` binding counts.
 *
 * ## What did NOT move
 *
 * The TypeScript `ObjectGridSchema` (`../objectql.ts`) and its zod mirror
 * (`ObjectGridSchema` in `../zod/objectql.zod.ts`) stay published: they are the
 * node as `ObjectGrid` reads it AFTER `SchemaRenderer` hoists `properties`, and
 * as code composes it. The mirror also keeps building the `object-view` `table`
 * slot. It is no longer an arm of `AnyComponentSchema`; `ObjectGridBlockSchema`
 * is. The last describe block holds that split. The renderer half — the bag
 * draws what the flat spelling drew — is `plugin-grid`'s
 * `ObjectGrid.propertiesBag-11276.test.tsx`.
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
  ObjectGridPropsSchema as SpecObjectGridPropsSchema,
  PageComponentSchema as SpecPageComponentSchema,
  type ObjectGridProps as SpecObjectGridProps,
} from '@objectstack/spec/ui';

import type { ObjectGridSchema as TsObjectGridSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import {
  ObjectGridBlockSchema,
  ObjectGridSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  ObjectViewSchema,
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
type Arm = ShapeOf<typeof ObjectGridBlockSchema>;

/**
 * The bag accepts exactly the spec's published props type (absent allowed),
 * the node's binding accepts exactly the spec's element binding, a row key or a
 * retired mirror key written flat accepts nothing, and neither content channel
 * accepts anything.
 */
export type assertionObjectGridArmIsTheRow = [
  Expect<Equal<InputOf<Arm['properties']>, SpecObjectGridProps | undefined>>,
  Expect<Equal<InputOf<Arm['dataSource']>, z.input<typeof SpecElementDataSourceSchema> | undefined>>,
  Expect<Equal<InputOf<Arm['objectName']>, undefined>>,
  Expect<Equal<InputOf<Arm['columns']>, undefined>>,
  Expect<Equal<InputOf<Arm['filter']>, undefined>>,
  Expect<Equal<InputOf<Arm['data']>, undefined>>,
  Expect<Equal<InputOf<Arm['title']>, undefined>>,
  Expect<Equal<InputOf<Arm['defaultSort']>, undefined>>,
  Expect<Equal<InputOf<Arm['operators']>, undefined>>,
  Expect<Equal<InputOf<Arm['name']>, undefined>>,
  Expect<Equal<InputOf<Arm['placeholder']>, undefined>>,
  Expect<Equal<InputOf<Arm['showFilters']>, undefined>>,
  Expect<Equal<InputOf<Arm['children']>, undefined>>,
  Expect<Equal<InputOf<Arm['body']>, undefined>>,
];

/**
 * Every member of the spec row is a member of the arm — refused flat, or
 * (`label` alone) kept as the node-level key the spec's page component
 * declares. The set is read by reference, so it cannot fall behind the row.
 */
export type assertionEveryRowKeyIsOnTheArm = [
  Expect<Equal<Exclude<keyof SpecObjectGridProps, keyof Arm>, never>>,
  // `label` is NOT refused: it is `BaseSchema`'s member, which accepts a string.
  Expect<Equal<Equal<InputOf<Arm['label']>, undefined>, false>>,
];

/**
 * The TypeScript twin is RE-DECLARED, not retired: still published, still the
 * post-hoist reading with `objectName` required, still a member of the
 * TypeScript ObjectQL union. A narrowing or a removal here reddens `tsc`.
 */
export type assertionTwinStaysPublished = [
  Expect<Equal<TsObjectGridSchema['type'], 'object-grid'>>,
  Expect<Equal<TsObjectGridSchema['objectName'], string>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'object-grid' }>, TsObjectGridSchema>>,
];

/** Non-vacuity: a bag narrower than the spec's props type is not Equal to it. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<{ objectName?: string } | undefined, SpecObjectGridProps | undefined>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

const COLUMNS = ['title', 'project', 'status', 'priority', 'due_date'];

/**
 * The objectstack showcase's command-center work queue
 * (`examples/app-showcase/src/ui/pages/command-center.page.ts`, `cc_queue_g`),
 * copied as it writes it. Its lit control is the spec's own page component.
 */
const SHOWCASE_COMMAND_CENTER = {
  id: 'cc_queue_g',
  type: 'object-grid',
  responsiveStyles: { large: { minWidth: '0', display: 'block' } },
  properties: { objectName: 'showcase_task', columns: COLUMNS },
} as const;

/**
 * The objectstack showcase's personal work queue
 * (`examples/app-showcase/src/ui/pages/my-work.page.ts`), copied as it writes it.
 */
const SHOWCASE_MY_WORK = {
  type: 'object-grid',
  properties: {
    objectName: 'showcase_task',
    columns: COLUMNS,
    filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
  },
} as const;

/** An object-bound grid with its query keys and display options, in the bag. */
const OBJECT_BOUND = {
  type: 'object-grid',
  properties: {
    objectName: 'task',
    label: 'Tasks',
    columns: [{ field: 'title', label: 'Title', width: 200, link: true }, { field: 'status' }],
    sort: [{ field: 'title', order: 'asc' }],
    pagination: { pageSize: 20 },
    searchableFields: ['title'],
    selection: { type: 'multiple' },
    rowActions: ['edit', 'delete'],
    bulkActions: ['export'],
    exportOptions: { formats: ['csv', 'xlsx'] },
    operations: { delete: false },
    editable: true,
  },
} as const;

/** Inline rows: a `ViewData` provider block in the bag. */
const INLINE = {
  type: 'object-grid',
  properties: { objectName: 'task', data: { provider: 'value', items: [{ id: 1, title: 'Design' }] } },
} as const;

/** The object supplied by the node's binding, the spec's per-element `dataSource`. */
const BOUND = {
  type: 'object-grid',
  dataSource: { object: 'task', view: 'open' },
  properties: { columns: ['title'] },
} as const;

/** The node-level display label the spec's page component declares. */
const LABELLED = { ...SHOWCASE_MY_WORK, label: 'My queue' } as const;

/** The flat spelling this batch retires. */
const FLAT = { type: 'object-grid', objectName: 'task', columns: COLUMNS } as const;

type Issues = z.core.$ZodIssue[];

function issuesOf(result: { success: boolean; error?: { issues: Issues } }): Issues {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues;
}

/** Every issue, union branches unfolded and paths made absolute — a child slot reports through one. */
type Unfolded = { code: string; path: PropertyKey[]; message: string };
const unfold = (issues: readonly unknown[], prefix: PropertyKey[] = []): Unfolded[] =>
  issues.flatMap((raw) => {
    const issue = raw as Unfolded & { errors?: unknown[][] };
    const path = [...prefix, ...issue.path];
    return [{ code: issue.code, path, message: issue.message }, ...(issue.errors ?? []).flatMap((branch) => unfold(branch, path))];
  });

const FACES = [
  ['safeValidateSchema', (doc: unknown) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc: unknown) => StrictAnyComponentSchema.safeParse(doc)],
] as const;

/** Every member of the spec's row, read off the installed spec on each run. */
const ROW_SHAPE = (SpecObjectGridPropsSchema as unknown as { shape: Record<string, z.ZodType> }).shape;
const ROW_KEYS = Object.keys(ROW_SHAPE);

/** Does this member refuse every value — the shape of a `z.never` retirement? */
const isNeverMember = (member: unknown): boolean => {
  const def = (member as { _zod: { def: { type: string; innerType?: { _zod: { def: { type: string } } } } } })._zod.def;
  return (def.type === 'optional' ? def.innerType!._zod.def.type : def.type) === 'never';
};

describe('object-grid validates in the spec\'s `properties` bag (objectui#11276)', () => {
  it.each([
    ['the objectstack showcase command-center queue', SHOWCASE_COMMAND_CENTER],
    ['the objectstack showcase my-work queue', SHOWCASE_MY_WORK],
    ['an object-bound grid with its query keys and display options', OBJECT_BOUND],
    ['a grid on inline rows', INLINE],
    ['a grid bound only through the node\'s `dataSource`', BOUND],
    ['a grid with the node-level display `label`', LABELLED],
  ] as const)('%s is accepted by safeValidateSchema and by the strict authoring face', (_label, doc) => {
    const tolerant = safeValidateSchema(doc);
    expect(tolerant.success, JSON.stringify(tolerant.success ? null : tolerant.error.issues)).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success, JSON.stringify(strict.success ? null : strict.error.issues)).toBe(true);
  });

  it('the fixtures are spec-valid by the spec\'s own page component and row (lit control)', () => {
    for (const doc of [SHOWCASE_COMMAND_CENTER, SHOWCASE_MY_WORK, OBJECT_BOUND, INLINE, BOUND, LABELLED]) {
      const page = SpecPageComponentSchema.safeParse(doc);
      expect(page.success, JSON.stringify(page.success ? null : page.error.issues)).toBe(true);
      expect(SpecObjectGridPropsSchema.safeParse(doc.properties).success, JSON.stringify(doc)).toBe(true);
    }
  });

  it('reaches the arm at a child slot too — a page holding both showcase queues', () => {
    const page = { type: 'page', children: [SHOWCASE_COMMAND_CENTER, SHOWCASE_MY_WORK] };
    for (const [face, parse] of FACES) {
      const result = parse(page);
      expect(result.success, `${face}: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true);
    }
  });

  // This pin used to ride on the `api` arm's `read.method` default. That arm
  // is retired in the spec (objectstack#23082, objectui#12325), so it rides on
  // `navigation`, whose spec row writes defaults too.
  it('the parse authors no default into the document (objectui#8317): `navigation` keeps no `mode`', () => {
    const doc = { type: 'object-grid', properties: { objectName: 'task', navigation: {} } };
    // Control: the spec's own row writes a default `mode` into its output.
    const specOut = SpecObjectGridPropsSchema.parse(doc.properties) as unknown as { navigation: Record<string, unknown> };
    expect(specOut.navigation.mode).toBe('page');
    const parsed = safeValidateSchema(doc);
    expect(parsed.success).toBe(true);
    const navigation = (parsed.data as unknown as { properties: { navigation: Record<string, unknown> } }).properties.navigation;
    expect('mode' in navigation).toBe(false);
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#11276)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the reason holds for this type)', () => {
    const issues = issuesOf(SpecPageComponentSchema.safeParse(FLAT));
    expect(issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    expect((issues[0] as { keys?: string[] }).keys).toEqual(['objectName', 'columns']);
  });

  it.each(FACES)('%s refuses a flat `objectName` on a page `object-grid` with the bag\'s prescription', (_face, parse) => {
    const issues = unfold(issuesOf(parse({ type: 'page', children: [FLAT] })));
    const byPath = new Map(issues.map((i) => [i.path.join('.'), i.message]));
    expect(byPath.get('children.0.objectName')).toContain('`objectName` → `properties.objectName`');
    expect(byPath.get('children.0.columns')).toContain('`columns` → `properties.columns`');
    // The prescription is the whole document shape, not only the path.
    expect(byPath.get('children.0.objectName')).toContain('"properties": {');
  });

  it('the row is non-trivial, and its two exceptions are read off the installed spec', () => {
    expect(ROW_KEYS.length).toBeGreaterThan(30);
    expect(ROW_KEYS).toEqual(expect.arrayContaining(['objectName', 'columns', 'data', 'label', 'defaultSort']));
    // `label`: the spec's page component declares it at node level too.
    const flatLabel = SpecPageComponentSchema.safeParse({ type: 'object-grid', label: 'Tasks' });
    expect(flatLabel.success).toBe(true);
    // `defaultSort`: the row's own retirement.
    expect(isNeverMember(ROW_SHAPE.defaultSort)).toBe(true);
  });

  const REFUSED_TO_BAG = ROW_KEYS.filter((key) => key !== 'label' && !isNeverMember(ROW_SHAPE[key]));

  it.each(REFUSED_TO_BAG.map((key) => [key] as const))('a flat `%s` is refused on both faces, by name, toward the bag', (key) => {
    for (const [face, parse] of FACES) {
      const issues = issuesOf(parse({ ...SHOWCASE_MY_WORK, [key]: true }));
      const issue = issues.find((i) => i.path.join('.') === key);
      expect(issue, `${face}: ${JSON.stringify(issues)}`).toBeDefined();
      expect(issue!.message, face).toContain(`\`${key}\` → \`properties.${key}\``);
    }
  });

  it('a node-level `label` is kept on both faces, as the spec\'s page component keeps it', () => {
    for (const [face, parse] of FACES) {
      expect(parse(LABELLED).success, face).toBe(true);
      expect(parse({ ...SHOWCASE_MY_WORK, label: 7 }).success, face).toBe(false);
    }
  });

  it('a flat `defaultSort` keeps the row\'s own retirement, by reference', () => {
    expect(ObjectGridBlockSchema.shape.defaultSort).toBe(stripImportedDefaults(SpecObjectGridPropsSchema).shape.defaultSort);
    for (const [, parse] of FACES) {
      const issue = issuesOf(parse({ ...SHOWCASE_MY_WORK, defaultSort: { field: 'title', order: 'asc' } }))
        .find((i) => i.path.join('.') === 'defaultSort');
      expect(issue?.message).toContain('`defaultSort`');
      expect(issue?.message).not.toContain('`properties.defaultSort`');
    }
  });

  it.each(['operators', 'rowSpecActions', 'bulkSpecActions', 'name', 'placeholder', 'showFilters'] as const)(
    'the flat mirror\'s retirement of `%s` rides onto the arm by reference, and is refused on both faces',
    (key) => {
      expect(ObjectGridBlockSchema.shape[key]).toBe(ObjectGridSchema.shape[key]);
      for (const [face, parse] of FACES) {
        const issue = issuesOf(parse({ ...SHOWCASE_MY_WORK, [key]: 'x' })).find((i) => i.path.join('.') === key);
        expect(issue?.code, face).toBe('invalid_type');
        expect(issue?.message, face).toMatch(/objectui#(9739|11068)/);
      }
    },
  );

  it('`onNavigate` stays the runtime slot `ObjectGrid` reads off the node (objectui#6124)', () => {
    // Declared exactly as the flat mirror declares it: the same helper, the same text.
    expect(ObjectGridBlockSchema.shape.onNavigate.description).toBe(ObjectGridSchema.shape.onNavigate.description);
    const issue = issuesOf(safeValidateSchema({ ...SHOWCASE_MY_WORK, onNavigate: { action: 'toast' } }))[0];
    expect(issue.path).toEqual(['onNavigate']);
    expect(issue.message).toContain('RUNTIME SLOT');
  });

  it.each([
    ['an invented key', 'inventedKey11276'],
  ] as const)('%s written flat stays unjudged on the tolerant face and is refused on the strict face', (_label, key) => {
    // The strictness control: this arm is `BaseSchema`, whose `.passthrough()`
    // every arm keeps, so a key the arm does not declare is not refused by the
    // tolerant face.
    const doc = { ...SHOWCASE_MY_WORK, [key]: { title: 'x' } };
    expect(safeValidateSchema(doc).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual([key]);
  });
  // ⭐ THE READING FLIPPED at `@objectstack/spec` 17.6.0 (objectstack#20694, read
  // on objectui#11227). These two mirror members used to sit in the table above,
  // as keys the row did not declare: written flat, the tolerant face kept them
  // unjudged and only the strict face refused them as unknown. The row now
  // declares both, so each is a row member like any other: written flat, it is
  // refused on BOTH faces, by name, toward the bag. Recorded by name here, not
  // left to the derived `REFUSED_TO_BAG` loop, so the flip itself stays visible.
  it.each(['emptyState', 'keyboardNavigation'] as const)(
    'the mirror\'s `%s`, which the row declares since 17.6.0, written flat is refused on both faces toward the bag (objectui#11227)',
    (key) => {
      // The spec's reading first: the installed row lists the key and does not retire it.
      expect(ROW_KEYS).toContain(key);
      expect(isNeverMember(ROW_SHAPE[key])).toBe(false);
      expect(REFUSED_TO_BAG).toContain(key);
      const doc = { ...SHOWCASE_MY_WORK, [key]: { title: 'x' } };
      for (const [face, parse] of FACES) {
        const issue = issuesOf(parse(doc)).find((i) => i.path.join('.') === key);
        expect(issue, face).toBeDefined();
        expect(issue!.message, face).toContain(`\`${key}\` → \`properties.${key}\``);
      }
    },
  );
});

describe('the bag is judged by the spec row (objectui#11276)', () => {
  const bag = (props: Record<string, unknown>) => ({ type: 'object-grid', properties: { objectName: 'task', ...props } });

  it('an undeclared key inside the bag is refused on the TOLERANT face, by name', () => {
    const issue = issuesOf(safeValidateSchema(bag({ inventedKey11276: 1 })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey11276']);
  });

  it('`operators` in the bag gets the spec\'s own prescription: `operations`', () => {
    const issue = issuesOf(safeValidateSchema(bag({ operators: { create: true } })))[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['properties']);
    expect(issue.message).toContain('`operations`');
  });

  it.each([
    ['the record form of `filter`', { filter: { status: 'open' } }, ['properties', 'filter'], 'invalid_type'],
    ['the ObjectQL tuple form of `filter`', { filter: [['status', '=', 'open']] }, ['properties', 'filter', 0], 'invalid_type'],
    ['the retired string `sort` clause (objectui#8221)', { sort: 'title asc' }, ['properties', 'sort'], 'invalid_type'],
    ['a bare array under `data` (objectui#8348)', { data: [{ id: 1 }] }, ['properties', 'data'], 'invalid_type'],
    ['a non-boolean `editable`', { editable: 'yes' }, ['properties', 'editable'], 'invalid_type'],
    ['the retired `defaultSort`', { defaultSort: { field: 'title', order: 'asc' } }, ['properties', 'defaultSort'], 'invalid_type'],
  ] as const)('%s is refused at that member', (_label, props, path, code) => {
    const issue = issuesOf(safeValidateSchema(bag(props)))[0];
    expect(issue.code).toBe(code);
    expect(issue.path).toEqual(path);
  });

  it.each(['showFilters', 'name'] as const)(
    'the row does not declare `%s`, so the bag refuses it on both faces (the spec\'s reading, recorded)',
    (key) => {
      for (const [face, parse] of FACES) {
        const issues = issuesOf(parse(bag({ [key]: { title: 'x' } })));
        expect(issues.some((i) => i.code === 'unrecognized_keys' && (i as { keys?: string[] }).keys?.includes(key)), face)
          .toBe(true);
      }
    },
  );

  // ⭐ THE READING FLIPPED at `@objectstack/spec` 17.6.0 (objectstack#20694, read
  // on objectui#11227). `emptyState` and `keyboardNavigation` used to be rows of
  // the table above: the row did not declare them, so the bag refused each as an
  // unknown key. The row now declares both, so the bag ACCEPTS each on both faces
  // and judges its value — `emptyState` as the list view's `EmptyStateSchema`,
  // whose `title` and `message` take an inline locale map, and
  // `keyboardNavigation` as a boolean. Accepting `keyboardNavigation` here is the
  // spec row's reading on the authoring face, nothing more: the row marks it
  // `[EXPERIMENTAL — not enforced]`, and whether `object-grid` PUBLISHES it in
  // `GRID_QUERY_INPUTS` is the console parity gate's question, not this file's.
  it.each([
    ['emptyState', { title: { en: 'No tasks yet', 'zh-CN': '暂无任务' }, message: 'Create one to start', icon: 'inbox' }, { title: 7 }],
    ['keyboardNavigation', true, 'yes'],
  ] as const)(
    'the row declares `%s` since 17.6.0, so the bag accepts it on both faces and judges its value (objectui#11227)',
    (key, valid, invalid) => {
      // The spec's own reading of the same values, so the recorded flip is the row's.
      expect(SpecObjectGridPropsSchema.safeParse({ objectName: 'task', [key]: valid }).success).toBe(true);
      expect(SpecObjectGridPropsSchema.safeParse({ objectName: 'task', [key]: invalid }).success).toBe(false);
      for (const [face, parse] of FACES) {
        const accepted = parse(bag({ [key]: valid }));
        expect(accepted.success, `${face}: ${JSON.stringify(accepted.success ? null : accepted.error.issues)}`).toBe(true);
        // Lit control: the member is JUDGED, not merely admitted — a wrong value
        // is refused at the member, and never as an unknown key.
        const issues = issuesOf(parse(bag({ [key]: invalid })));
        expect(issues.some((i) => i.path[0] === 'properties' && i.path[1] === key), `${face}: ${JSON.stringify(issues)}`).toBe(true);
        expect(issues.some((i) => i.code === 'unrecognized_keys'), face).toBe(false);
      }
    },
  );

  it('the bag is the spec row by reference, through the import boundary', () => {
    const member = ObjectGridBlockSchema.shape.properties.unwrap();
    const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    // The same members, read off the installed spec on every run.
    expect(keysOf(member)).toEqual(keysOf(SpecObjectGridPropsSchema));
    // The row carries spec defaults, so the boundary hands back a rebuilt copy
    // rather than the export itself — the boundary's own memoised copy — and
    // that copy accepts exactly what the spec's row accepts.
    expect(stripImportedDefaults(SpecObjectGridPropsSchema)).toBe(member);
    for (const probe of [
      {},
      { objectName: 'task', columns: COLUMNS },
      { inventedKey11276: 1 },
      { objectName: 7 },
      { operators: {} },
      { emptyState: { title: 'x' } },
      { filter: [{ field: 'a', operator: 'equals', value: 1 }] },
      { filter: { a: 1 } },
      { sort: [{ field: 'a', order: 'asc' }] },
      { pagination: { pageSize: 5 } },
      { data: { provider: 'object', object: 'task' } },
      { data: { provider: 'api', read: { url: '/x', method: 'TRACE' } } },
      { exportOptions: { formats: ['csv'] } },
      { label: { en: 'Tasks' } },
    ]) {
      expect(member.safeParse(probe).success, JSON.stringify(probe)).toBe(SpecObjectGridPropsSchema.safeParse(probe).success);
    }
  });

  it('the bag\'s description names the row it is', () => {
    expect(ObjectGridBlockSchema.shape.properties.description).toContain('`ComponentPropsMap[\'object-grid\']`');
  });

  it('`dataSource` is judged as the spec binding on both faces', () => {
    const adapterShaped = { ...SHOWCASE_MY_WORK, dataSource: 'objectstack' };
    expect(safeValidateSchema(adapterShaped).success).toBe(false);
    expect(StrictAnyComponentSchema.safeParse(adapterShaped).success).toBe(false);
    expect(SpecElementDataSourceSchema.safeParse(BOUND.dataSource).success).toBe(true);
  });

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const issue = issuesOf(safeValidateSchema({ ...SHOWCASE_MY_WORK, [key]: [{ type: 'text', content: 'x' }] }))[0];
    expect(issue.path).toEqual([key]);
    expect(issue.message).toContain('objectui#9256');
    expect(issue.message).toContain('`object-grid`');
  });
});

describe('the record source is required, read in the bag (objectui#11276)', () => {
  const RECORD_SOURCE_REQUIRED = (issues: Issues) =>
    issues.filter((i) => (i as { params?: { code?: string } }).params?.code === 'RECORD_SOURCE_REQUIRED');

  it.each([
    ['the bare node', { type: 'object-grid' }],
    ['an empty bag', { type: 'object-grid', properties: {} }],
    ['a bag with columns and no source', { type: 'object-grid', properties: { columns: COLUMNS } }],
    ['a binding that names no object', { type: 'object-grid', dataSource: { object: '' }, properties: { columns: COLUMNS } }],
  ] as const)('%s is refused on both faces, at `properties.objectName`, naming the bag rung and the binding', (_label, doc) => {
    for (const [, parse] of FACES) {
      const found = RECORD_SOURCE_REQUIRED(issuesOf(parse(doc)));
      expect(found).toHaveLength(1);
      expect(found[0].path).toEqual(['properties', 'objectName']);
      expect(found[0].message).toContain('`properties.objectName`');
      expect(found[0].message).toContain('`dataSource`');
    }
  });

  it('`properties.objectName` alone is a source', () => {
    for (const [, parse] of FACES) {
      expect(parse({ type: 'object-grid', properties: { objectName: 'task' } }).success).toBe(true);
    }
  });

  it('the node\'s `dataSource` binding alone is a source, on both faces — its `object` lands on `objectName`', () => {
    for (const [, parse] of FACES) {
      expect(parse({ type: 'object-grid', dataSource: { object: 'task' } }).success).toBe(true);
      expect(parse(BOUND).success).toBe(true);
    }
  });

  it('a source written flat is not a source: it is refused by name and pointed at the bag', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'object-grid', objectName: 'task' }));
    expect(issues.find((i) => i.path.join('.') === 'objectName')?.message).toContain('`objectName` → `properties.objectName`');
    expect(RECORD_SOURCE_REQUIRED(issues)).toHaveLength(1);
  });

  it('the spec row has no such rule: the spec\'s page component accepts the bare node (the recorded divergence)', () => {
    expect(SpecPageComponentSchema.safeParse({ type: 'object-grid' }).success).toBe(true);
    expect(SpecObjectGridPropsSchema.safeParse({}).success).toBe(true);
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#11276)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`object-grid` is armed by the bag arm, not by the flat mirror', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('object-grid');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('object-grid');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ObjectGridBlockSchema);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    // It is what `ObjectGrid` reads after the hoist, and what `ObjectView` /
    // `ListView` compose — neither is an authored `object-grid` node.
    expect(ObjectGridSchema.safeParse(FLAT).success).toBe(true);
    expect(ObjectGridSchema.safeParse({ ...FLAT, emptyState: { title: 'No tasks' } }).success).toBe(true);
    expect(ObjectGridSchema.safeParse({ ...FLAT, exportOptions: ['csv'] }).success).toBe(false);
  });

  it('the flat mirror still builds the `object-view` `table` slot', () => {
    const slot = ObjectViewSchema.shape.table.unwrap();
    expect(slot.safeParse({ columns: ['title'], pagination: { pageSize: 20 } }).success).toBe(true);
    // The slot's own withheld keys stay refused there (objectui#10976).
    expect(slot.safeParse({ emptyState: { title: 'x' } }).success).toBe(false);
    for (const [face, parse] of FACES) {
      const view = { type: 'object-view', objectName: 'task', table: { columns: ['title'], pagination: { pageSize: 20 } } };
      expect(parse(view).success, face).toBe(true);
    }
  });
});
