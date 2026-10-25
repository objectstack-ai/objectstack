/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A page `list-view` node is judged in its `properties` bag, in the spec
 * spelling — `data` names the object, `type` the list kind — and the retired
 * `objectName` / `viewType` are refused by name (objectui#12670; ruling C on
 * objectstack-ai/objectstack#22444, triage's option A).
 *
 * ## The defect this pins
 *
 * The `list-view` arm of `AnyComponentSchema` was the flat `ListViewSchema`
 * mirror, the `ListView` component's props, closed by a record-source rule
 * whose one rung was `objectName`. So `safeValidateSchema`, the strict
 * authoring face and `objectui validate`:
 *
 *   - refused the ruled page node, `{ type: 'list-view', properties: { data:
 *     { provider: 'object', object }, type: 'kanban', kanban } }` (no
 *     `objectName` on the node; the strict face also named `properties` as an
 *     unrecognized key);
 *   - accepted the retired flat `{ type: 'list-view', objectName, viewType }`.
 *
 * The door an author, human or AI, runs steered it from the ruled spelling
 * back to the retired one.
 *
 * ## What is particular to this node
 *
 *   - `@objectstack/spec` has no `ComponentPropsMap['list-view']` row at the
 *     resolved version, so the bag is built as `object-chart`'s is: the flat
 *     mirror's own members, BY REFERENCE (each the same schema object), with
 *     three ruled differences — `type` is the spec's view kind, `objectName`
 *     and `viewType` are refused by name.
 *   - In the bag the kind is the spec's own `type`, so the spec's two
 *     object-level list view checks attach there by reference, the chart
 *     binding check included, which the flat mirror cannot attach.
 *   - The record source is `properties.data`, or the node's `dataSource`
 *     binding naming the object.
 *
 * ## What did NOT move
 *
 * `ListViewSchema` (zod) and its TypeScript `ListViewSchema` stay published as
 * the `ListView` component's props, `objectName` / `viewType` and all; the
 * zod mirror is no longer an arm of `AnyComponentSchema`. The last describe
 * block holds that split.
 *
 * ## Two instruments
 *
 * The `Expect` / `Equal` block is TYPE-level (`tsc -p tsconfig.test.json`, the
 * third leg of this package's `type-check`); vitest strips it. The `describe`
 * blocks are RUNTIME.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ListViewSchema as SpecListViewSchema,
  PageComponentSchema as SpecPageComponentSchema,
} from '@objectstack/spec/ui';

import type { ListViewSchema as TsListViewSchema, ObjectQLComponentSchema as TsObjectQLComponentSchema } from '../objectql';
import type { ListViewBlockNode } from '../index';
import {
  ListViewBlockSchema,
  ListViewSchema,
  ObjectQLComponentSchema,
  ObjectQLPublicBlockComponentSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';

/* ── Type-level: the `tsc` channel ───────────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
type Arm = ShapeOf<typeof ListViewBlockSchema>;
type Bag = NonNullable<ListViewBlockNode['properties']>;
type SpecListView = z.input<typeof SpecListViewSchema>;

/**
 * On the node: the retired pair and a list view member written flat accept
 * nothing. In the bag: `type` is the spec's own view kind, `data` the spec's
 * own data source, and the retired pair accepts nothing.
 */
export type assertionThePageSpelling = [
  Expect<Equal<ListViewBlockNode['type'], 'list-view'>>,
  Expect<Equal<InputOf<Arm['objectName']>, undefined>>,
  Expect<Equal<InputOf<Arm['viewType']>, undefined>>,
  Expect<Equal<InputOf<Arm['columns']>, undefined>>,
  Expect<Equal<InputOf<Arm['data']>, undefined>>,
  Expect<Equal<Bag['type'], SpecListView['type']>>,
  Expect<Equal<Bag['data'], SpecListView['data']>>,
  Expect<Equal<Bag['objectName'], undefined>>,
  Expect<Equal<Bag['viewType'], undefined>>,
];

/**
 * The TypeScript `ListViewSchema` is RE-DECLARED, not retired: still the
 * `ListView` component's props, `objectName` / `viewType` still its members,
 * still in the TypeScript ObjectQL union.
 */
export type assertionComponentPropsStay = [
  Expect<Equal<TsListViewSchema['type'], 'list-view'>>,
  Expect<Equal<TsListViewSchema['objectName'], string | undefined>>,
  Expect<Equal<Equal<TsListViewSchema['viewType'], undefined>, false>>,
  Expect<Equal<Extract<TsObjectQLComponentSchema, { type: 'list-view' }>, TsListViewSchema>>,
];

/** Non-vacuity: a narrower kind is not Equal to the spec's. */
export type assertionInstrumentFires = [
  Expect<Equal<Equal<'grid' | undefined, SpecListView['type']>, false>>,
];

/* ── Runtime fixtures ────────────────────────────────────────────────────── */

/** The node the ruling and the card name: an object-bound kanban, in the bag. */
const RULED = {
  type: 'list-view',
  properties: {
    data: { provider: 'object', object: 'deal' },
    type: 'kanban',
    kanban: { groupByField: 'stage', columns: ['name', 'amount'] },
  },
} as const;

/** The object named by the node's binding alone, the spec's per-element `dataSource`. */
const BOUND = { type: 'list-view', dataSource: { object: 'deal', view: 'open' } } as const;

/** Inline rows: a `value` provider is a record source too. */
const INLINE = {
  type: 'list-view',
  properties: { data: { provider: 'value', items: [{ id: 1, name: 'Acme' }] }, columns: ['name'] },
} as const;

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; params?: { code?: string } };
type Result = { success: boolean; error?: { issues: readonly unknown[] } };

const FACES: ReadonlyArray<readonly [string, (doc: unknown) => Result]> = [
  ['safeValidateSchema', (doc) => safeValidateSchema(doc)],
  ['the strict authoring face', (doc) => StrictAnyComponentSchema.safeParse(doc)],
];

function issuesOf(result: Result): Issue[] {
  if (result.success) throw new Error('expected a refusal, the document parsed');
  return result.error!.issues as Issue[];
}
const at = (issues: Issue[], path: string) => issues.filter((i) => i.path.join('.') === path);
const recordSourceIssues = (issues: Issue[]) => issues.filter((i) => i.params?.code === 'RECORD_SOURCE_REQUIRED');

/* ── 1. The ruled node validates ─────────────────────────────────────────── */

describe('a page `list-view` validates in the spec spelling, in its `properties` bag (objectui#12670)', () => {
  it.each([
    ['the ruled node: `data` names the object, `properties.type` the kind', RULED],
    ['a node bound only through the node\'s `dataSource`', BOUND],
    ['a node on inline rows (a `value` provider)', INLINE],
    ['a node with a display `label` and `responsiveStyles` on the node', { ...RULED, id: 'deals', label: 'Deals', responsiveStyles: { large: { minWidth: '0' } } }],
  ] as const)('%s is accepted on both faces', (_label, doc) => {
    for (const [face, parse] of FACES) {
      const result = parse(doc);
      expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('the fixtures are spec-valid by the spec\'s own page component (lit control)', () => {
    for (const doc of [RULED, BOUND, INLINE]) {
      const page = SpecPageComponentSchema.safeParse(doc);
      expect(page.success, JSON.stringify(page.error?.issues)).toBe(true);
    }
  });

  it('reaches the arm at a child slot too — a page holding the ruled node', () => {
    for (const [face, parse] of FACES) {
      const result = parse({ type: 'page', children: [RULED] });
      expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it.each(SpecListViewSchema.shape.type.removeDefault().options.map((kind) => [kind] as const))(
    'the bag\'s `type` takes the spec\'s list kind `%s`',
    (kind) => {
      // A `chart` list names its dataset binding: the spec's own check (section 5) requires one.
      const chart = kind === 'chart' ? { chart: { chartType: 'bar', dataset: 'deal_ds', values: ['total'] } } : {};
      for (const [face, parse] of FACES) {
        const result = parse({ ...RULED, properties: { ...RULED.properties, type: kind, kanban: undefined, ...chart } });
        expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      }
    },
  );

  it.each([['the registry key', 'list-view'], ['a retired kind', 'page'], ['a misspelt kind', 'kanbn']] as const)(
    'the bag\'s `type` refuses %s, at `properties.type`',
    (_label, kind) => {
      for (const [face, parse] of FACES) {
        const found = at(issuesOf(parse({ ...RULED, properties: { ...RULED.properties, type: kind } })), 'properties.type');
        expect(found.map((i) => i.code), face).toEqual(['invalid_value']);
      }
    },
  );

  it('the parse authors no default into the document (objectui#8317): an absent kind stays absent', () => {
    // Control: the spec's own list view writes `type: 'grid'` into its output.
    expect((SpecListViewSchema.parse({ columns: ['name'] }) as { type?: string }).type).toBe('grid');
    const parsed = safeValidateSchema({ type: 'list-view', properties: { data: { provider: 'object', object: 'deal' } } });
    expect(parsed.success).toBe(true);
    expect('type' in (parsed.data as unknown as { properties: Record<string, unknown> }).properties).toBe(false);
  });
});

/* ── 2. The retired spelling is refused by name, FROM → TO ────────────────── */

describe('`objectName` / `viewType` are refused by name on a page `list-view`, flat or in the bag (objectui#12670)', () => {
  it.each([
    ['a flat `objectName`', { type: 'list-view', objectName: 'deal' }, 'objectName', '`objectName` → `properties.data`'],
    ['`properties.objectName`', { type: 'list-view', properties: { objectName: 'deal' } }, 'properties.objectName', '`objectName` → `properties.data`'],
    ['a flat `viewType`', { ...RULED, viewType: 'kanban' }, 'viewType', '`viewType` → `properties.type`'],
    ['`properties.viewType`', { ...RULED, properties: { ...RULED.properties, viewType: 'kanban' } }, 'properties.viewType', '`viewType` → `properties.type`'],
  ] as const)('%s is refused at its own path, naming the key and what to write instead', (_label, doc, path, fromTo) => {
    for (const [face, parse] of FACES) {
      const found = at(issuesOf(parse(doc)), path);
      expect(found.map((i) => i.code), face).toEqual(['invalid_type']);
      expect(found[0].message, face).toContain(`Did you mean ${fromTo}?`);
      // The remedy is the whole document shape, not only the path.
      expect(found[0].message, face).toContain('"properties": {');
    }
  });

  it('a node that names its object ONLY as `objectName` has no record source: it is refused for that too', () => {
    for (const doc of [{ type: 'list-view', objectName: 'deal' }, { type: 'list-view', properties: { objectName: 'deal' } }]) {
      for (const [face, parse] of FACES) {
        expect(recordSourceIssues(issuesOf(parse(doc))), face).toHaveLength(1);
      }
    }
  });

  it('the retired flat node is refused whole: each key at its own path, and the record source', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'list-view', objectName: 'deal', viewType: 'kanban' }));
    expect(issues.map((i) => i.path.join('.')).sort()).toEqual(['objectName', 'properties.data', 'viewType']);
  });

  it('⛔ no fallback acceptance: `objectName` beside a working `data` is refused, not ignored', () => {
    for (const [face, parse] of FACES) {
      const found = at(issuesOf(parse({ ...RULED, properties: { ...RULED.properties, objectName: 'deal' } })), 'properties.objectName');
      expect(found, face).toHaveLength(1);
    }
  });

  it('the spec\'s own page component refuses the flat pair as unrecognized keys (lit control: the reason holds)', () => {
    const page = SpecPageComponentSchema.safeParse({ type: 'list-view', objectName: 'deal', viewType: 'kanban' });
    expect(page.success).toBe(false);
    const issue = (page.error!.issues as Issue[]).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.keys?.sort()).toEqual(['objectName', 'viewType']);
  });

  it('the spec\'s own list view refuses both in the bag position too', () => {
    const spec = SpecListViewSchema.safeParse({ columns: ['name'], objectName: 'deal', viewType: 'kanban' });
    expect(spec.success).toBe(false);
    const issue = (spec.error!.issues as Issue[]).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.keys?.sort()).toEqual(['objectName', 'viewType']);
  });
});

/* ── 3. The record source ─────────────────────────────────────────────────── */

describe('the record source is `properties.data` or the node\'s `dataSource` binding (objectui#12670)', () => {
  it.each([
    ['the bare node', { type: 'list-view' }],
    ['an empty bag', { type: 'list-view', properties: {} }],
    ['a bag with columns and no source', { type: 'list-view', properties: { columns: ['name'] } }],
    ['a binding that names no object', { type: 'list-view', dataSource: { object: '' }, properties: { columns: ['name'] } }],
  ] as const)('%s is refused on both faces, at `properties.data`, naming the bag rung and the binding', (_label, doc) => {
    for (const [face, parse] of FACES) {
      const found = recordSourceIssues(issuesOf(parse(doc)));
      expect(found, face).toHaveLength(1);
      expect(found[0].code).toBe('custom');
      expect(found[0].path).toEqual(['properties', 'data']);
      expect(found[0].message).toContain('`properties.data`');
      expect(found[0].message).toContain('`dataSource.object`');
    }
  });

  it('`properties.data` alone is a source; the node\'s `dataSource.object` alone is a source', () => {
    for (const [face, parse] of FACES) {
      expect(parse({ type: 'list-view', properties: { data: { provider: 'object', object: 'deal' } } }).success, face).toBe(true);
      expect(parse({ type: 'list-view', dataSource: { object: 'deal' } }).success, face).toBe(true);
    }
  });

  it('a `data` written flat is not a source: it is refused by name and pointed at the bag', () => {
    const issues = issuesOf(safeValidateSchema({ type: 'list-view', data: { provider: 'object', object: 'deal' } }));
    expect(at(issues, 'data')[0]?.message).toContain('`data` → `properties.data`');
    expect(recordSourceIssues(issues)).toHaveLength(1);
  });

  it('the spec has no such rule: its page component accepts the bare node (the recorded divergence)', () => {
    expect(SpecPageComponentSchema.safeParse({ type: 'list-view' }).success).toBe(true);
  });
});

/* ── 4. The bag is the mirror's members, by reference ─────────────────────── */

const BAG = ListViewBlockSchema.shape.properties.unwrap();
const BAG_SHAPE = BAG.shape as Record<string, unknown>;
const MIRROR_SHAPE = ListViewSchema.shape as Record<string, unknown>;
/** The bag members the ruling changes: the kind, and the retired pair. */
const RULED_MEMBERS = new Set(['type', 'objectName', 'viewType']);

describe('the bag is the `ListViewSchema` mirror\'s own members, by reference (objectui#12670)', () => {
  it('every mirror member but the node-level ones is a bag member, the same schema object', () => {
    const bagKeys = Object.keys(BAG_SHAPE).filter((key) => !RULED_MEMBERS.has(key));
    expect(bagKeys.length).toBeGreaterThan(60);
    for (const key of bagKeys) expect(BAG_SHAPE[key], key).toBe(MIRROR_SHAPE[key]);
    // Every spec list view member is one of them, read off the installed spec.
    for (const key of Object.keys(SpecListViewSchema.shape)) expect(Object.keys(BAG_SHAPE), key).toContain(key);
  });

  it('the node-level keys stay on the node: the node base\'s own and the binding', () => {
    for (const key of ['id', 'className', 'visible', 'hidden', 'dataSource', 'body', 'children']) {
      expect(Object.keys(BAG_SHAPE), key).not.toContain(key);
    }
    // The keys the spec's list view shares with the node base are list view members, in the bag.
    for (const key of ['name', 'label', 'description', 'data']) expect(BAG_SHAPE[key], key).toBe(MIRROR_SHAPE[key]);
  });

  it('the bag\'s description says it is no spec row', () => {
    expect(ListViewBlockSchema.shape.properties.description).toContain('no `ComponentPropsMap[\'list-view\']` row');
  });

  it.each([
    ['an invented key', 'inventedKey12670'],
  ] as const)('%s in the bag stays unjudged on the tolerant face and is refused on the strict face', (_label, key) => {
    // The mirror's posture, `.passthrough()`, kept: the strict face closes it.
    const doc = { ...RULED, properties: { ...RULED.properties, [key]: 1 } };
    expect(safeValidateSchema(doc).success).toBe(true);
    const issue = issuesOf(StrictAnyComponentSchema.safeParse(doc)).find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['properties']);
    expect(issue?.keys).toEqual([key]);
  });

  it.each([
    ['a kanban block alias (objectui#6152)', { kanban: { groupField: 'stage' } }, 'properties.kanban.groupField'],
    ['a retired conditional-formatting dialect (objectui#11533)', { conditionalFormatting: [{ field: 'stage', operator: 'equals', value: 'won' }] }, 'properties.conditionalFormatting.0.field'],
    ['a handler key (objectui#6124 runtime slot)', { onAddRecord: { action: 'toast' } }, 'properties.onAddRecord'],
  ] as const)('the mirror\'s refusals reach the bag: %s', (_label, props, path) => {
    for (const [face, parse] of FACES) {
      expect(at(issuesOf(parse({ ...RULED, properties: { ...RULED.properties, ...props } })), path), face).toHaveLength(1);
    }
  });
});

/* ── 5. The spec's object-level checks, attached in the bag ───────────────── */

describe('the spec\'s list view checks run in the bag, with the spec\'s own issue (objectui#12670)', () => {
  /** The spec's issue for the same list view — the spec requires `columns`. */
  const specIssue = (props: Record<string, unknown>, path: string) =>
    (SpecListViewSchema.safeParse({ columns: ['name'], ...props }).error?.issues as Issue[] | undefined)
      ?.find((i) => i.path.join('.') === path);
  const page = (props: Record<string, unknown>) => ({
    type: 'list-view',
    properties: { data: { provider: 'object', object: 'deal' }, ...props },
  });

  it.each([
    ['`checkListViewCalendarVisualization`: a calendar offered with no `calendar` block', { appearance: { allowedVisualizations: ['calendar'] } }, 'calendar'],
    ['`checkListViewChartBinding`: a `chart` list with no dataset binding', { type: 'chart' }, 'chart'],
  ] as const)('%s', (_label, props, path) => {
    const expected = specIssue(props, path);
    expect(expected?.code, 'the spec refuses the same list view (lit control)').toBe('custom');
    for (const [face, parse] of FACES) {
      const found = at(issuesOf(parse(page(props))), `properties.${path}`);
      expect(found.map((i) => ({ code: i.code, message: i.message })), face).toEqual([{ code: 'custom', message: expected!.message }]);
    }
  });

  it('controls: a declared calendar block, and a dataset-bound chart, pass on both faces', () => {
    for (const props of [
      { appearance: { allowedVisualizations: ['calendar'] }, calendar: { startDateField: 'starts_at' } },
      { type: 'chart', chart: { chartType: 'bar', dataset: 'deal_ds', dimensions: ['stage'], values: ['total'] } },
    ]) {
      expect(SpecListViewSchema.safeParse({ columns: ['name'], ...props }).success).toBe(true);
      for (const [face, parse] of FACES) expect(parse(page(props)).success, face).toBe(true);
    }
  });

  it('objectui\'s dataset-chart filter refusal (objectui#10327) reads the bag\'s `type` as the kind', () => {
    const chart = { chartType: 'bar', dataset: 'deal_ds', dimensions: ['stage'], values: ['total'] };
    const filter = [{ field: 'stage', operator: 'equals', value: 'won' }];
    for (const [face, parse] of FACES) {
      expect(at(issuesOf(parse(page({ type: 'chart', chart, filter }))), 'properties.filter'), face).toHaveLength(1);
      // Control: the same filter on a grid scopes the grid.
      expect(parse(page({ type: 'grid', chart, filter })).success, face).toBe(true);
    }
  });
});

/* ── 6. The node: flat members, runtime slots, content channels ───────────── */

describe('the node around the bag (objectui#12670)', () => {
  it.each(['columns', 'filter', 'kanban', 'options', 'showSearch'] as const)(
    'a flat `%s` is refused on both faces, by name, toward the bag',
    (key) => {
      for (const [face, parse] of FACES) {
        const found = at(issuesOf(parse({ ...RULED, [key]: [] })), key);
        expect(found.map((i) => i.code), face).toEqual(['invalid_type']);
        expect(found[0].message, face).toContain(`\`${key}\` → \`properties.${key}\``);
      }
    },
  );

  it('a node-level `label` is kept on both faces, as the spec\'s page component keeps it', () => {
    for (const [face, parse] of FACES) {
      expect(parse({ ...RULED, label: 'Deals' }).success, face).toBe(true);
      expect(parse({ ...RULED, label: 7 }).success, face).toBe(false);
    }
  });

  it.each(['onAddRecord', 'onBulkAction', 'onDensityChange', 'onNavigate', 'onPageSizeChange'] as const)(
    'a flat `%s` is refused as the runtime slot `ListView` reads, not pointed at the bag',
    (key) => {
      expect(ListViewBlockSchema.shape[key].description).toBe(ListViewSchema.shape[key].description);
      for (const [face, parse] of FACES) {
        const found = at(issuesOf(parse({ ...RULED, [key]: { action: 'toast' } })), key);
        expect(found.map((i) => i.code), face).toEqual(['custom']);
        expect(found[0].message, face).toContain('RUNTIME SLOT');
      }
    },
  );

  it.each(['body', 'children'] as const)('refuses the `%s` content channel by name (objectui#9256)', (key) => {
    const found = at(issuesOf(safeValidateSchema({ ...RULED, [key]: [{ type: 'text', content: 'x' }] })), key);
    expect(found[0]?.message).toContain('`list-view` reads NEITHER content channel');
    expect(found[0]?.message).toContain('`properties.data`');
  });

  it('`dataSource` is judged as the spec binding on both faces', () => {
    for (const [face, parse] of FACES) expect(parse({ ...RULED, dataSource: 'objectstack' }).success, face).toBe(false);
  });
});

/* ── 7. The arm moved; the component props stayed ─────────────────────────── */

describe('the arm moved; `ListViewSchema` stayed the `ListView` component\'s props (objectui#12670)', () => {
  const literalsOf = (union: { options: readonly unknown[] }) =>
    union.options.map((arm) => (arm as { shape: { type: z.ZodLiteral<string> } }).shape.type.value);

  it('`list-view` is armed by the page arm, not by the component props', () => {
    expect(literalsOf(ObjectQLPublicBlockComponentSchema)).toContain('list-view');
    expect(literalsOf(ObjectQLComponentSchema)).not.toContain('list-view');
    expect(ObjectQLPublicBlockComponentSchema.options).toContain(ListViewBlockSchema);
  });

  it('`ListViewSchema` still judges the component props, `objectName` / `viewType` and all', () => {
    const props = { type: 'list-view', objectName: 'deal', viewType: 'kanban', kanban: { groupByField: 'stage' } };
    expect(ListViewSchema.safeParse(props).success).toBe(true);
    // Its own record-source rule is unchanged: `objectName`, or the binding.
    const bare = ListViewSchema.safeParse({ type: 'list-view' });
    expect(bare.success).toBe(false);
    expect(recordSourceIssues(issuesOf(bare))[0]?.path).toEqual(['objectName']);
  });
});
