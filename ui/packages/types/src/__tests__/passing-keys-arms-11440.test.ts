/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Seven registered node types get an arm in `AnyComponentSchema`
 * (objectui#11440, the follow-up the seat ruling `5945530142` on objectui#10859
 * filed, with its amendment `5945583855`).
 *
 * Each of `home`, `record`, `utility`, `app-schema-renderer`, `object-pivot`,
 * `embeddable-form` and `detail-section` was registered and refused by
 * `safeValidateSchema` (then what `objectui validate` ran) with one
 * `invalid_union` at `type`. The bare-key count is ratcheted in
 * `packages/cli/src/__tests__/registered-types-validate-ratchet-10859.test.ts`;
 * this file pins what each arm accepts and refuses, on BOTH faces — the
 * tolerant validator and the strict authoring face — with a lit control per
 * refusal, so no row passes for the wrong reason.
 *
 * Each registration's own inputs are pinned against its arm in the package
 * that registers it (`@object-ui/plugin-dashboard`, `@object-ui/plugin-form`,
 * `@object-ui/plugin-detail`, `@object-ui/layout`): this package imports none
 * of them.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ComponentPropsMap,
  PageSchema as SpecPageSchema,
  PageTypeSchema as SpecPageTypeSchema,
  ReportSchema as SpecReportSchema,
} from '@objectstack/spec/ui';
import {
  AppSchemaRendererNodeSchema,
  DetailSectionNodeSchema,
  DetailViewSectionSchema,
  EmbeddableFormBlockSchema,
  ObjectPivotBlockSchema,
  PageKindNodeSchema,
  PageNodeSchema,
  ReportComponentSchema,
  ReportNodeSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod';
import type { EmbeddableFormBlockNode, ObjectPivotBlockNode } from '../authoring-nodes';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };
type Result = { success: boolean; error?: { issues: unknown[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesOf = (result: Result): Issue[] => allIssues(result.error?.issues as Issue[] | undefined);
const at = (result: Result, path: string): Issue[] => issuesOf(result).filter((issue) => issue.path.join('.') === path);
/** Is the document's `type` unclaimed by every arm — the ratchet's reading? */
const refusedAtType = (result: Result): boolean =>
  issuesOf(result).some((issue) => issue.code === 'invalid_union' && issue.path.join('.') === 'type');

/* ── The page kinds ──────────────────────────────────────────────────────── */

/** A stored spec page, in the shape objectstack's example apps author (`definePage`). */
const specPage = (kind: string) => ({
  name: `${kind}_page`,
  label: 'Welcome',
  type: kind,
  template: 'header-sidebar-main',
  kind: 'full',
  regions: [
    { name: 'header', width: 'full', components: [{ type: 'page:header', properties: { title: 'Welcome' } }] },
    { name: 'main', components: [{ type: 'element:text', properties: { content: 'Hello' } }] },
  ],
});

const KINDS = ['record', 'home', 'utility'] as const;

describe('the page kinds `record` / `home` / `utility` (objectui#11440)', () => {
  it('the arm claims exactly these three, each a kind the spec\'s own `PageTypeSchema` declares', () => {
    const literals = (PageKindNodeSchema.shape.type as unknown as z.ZodEnum).options;
    expect([...literals].sort()).toEqual([...KINDS].sort());
    for (const kind of literals) expect(SpecPageTypeSchema.safeParse(kind).success, String(kind)).toBe(true);
    // The two kinds left out are claimed by other arms, not by this one.
    for (const kind of ['app', 'list']) {
      expect(SpecPageTypeSchema.safeParse(kind).success, kind).toBe(true);
      expect(literals, kind).not.toContain(kind);
    }
  });

  it.each(KINDS)('`%s` — the spec\'s own page document validates on both faces', (kind) => {
    const page = specPage(kind);
    // Lit control: it IS a spec page — the spec's strict `PageSchema` accepts it.
    expect(SpecPageSchema.safeParse(page).success).toBe(true);
    for (const [face, judge] of FACES) {
      const result = judge(page);
      expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('every member but `type` is the `page` node\'s own, by reference', () => {
    const { type: _kindType, ...kindMembers } = PageKindNodeSchema.shape;
    const { type: _pageType, ...pageMembers } = PageNodeSchema.shape;
    expect(Object.keys(kindMembers).sort()).toEqual(Object.keys(pageMembers).sort());
    for (const key of Object.keys(pageMembers)) {
      expect((kindMembers as Record<string, unknown>)[key], key).toBe((pageMembers as Record<string, unknown>)[key]);
    }
  });

  it.each(FACES)('%s face: a region component is judged by the node union, at its own path', (face, judge) => {
    const bad = { ...specPage('home'), regions: [{ name: 'main', components: [{ type: 'no-such-block-11440' }] }] };
    const result = judge(bad);
    expect(result.success, face).toBe(false);
    expect(at(result, 'regions.0.components.0.type').map((issue) => issue.code), face).toEqual(['invalid_union']);
  });

  it.each(FACES)('%s face: the `page` node\'s refusals carry over (`actions`, by name)', (face, judge) => {
    const result = judge({ ...specPage('record'), actions: [{ type: 'button', label: 'Go' }] });
    expect(at(result, 'actions').map((issue) => issue.code), face).toEqual(['invalid_type']);
    // Lit control: the same document without the key validates.
    expect(judge(specPage('record')).success, face).toBe(true);
  });

  it.each(FACES)('%s face: a spelling outside the three is still refused at `type` (lit control)', (face, judge) => {
    expect(refusedAtType(judge({ ...specPage('home'), type: 'homepage' })), face).toBe(true);
  });
});

/* ── app-schema-renderer ─────────────────────────────────────────────────── */

describe('`app-schema-renderer` (objectui#11440)', () => {
  it.each(FACES)('%s face: the node the governed mobile guide teaches validates — its `mobileNavMode` key', (face, judge) => {
    for (const mode of ['bottom_nav', 'drawer']) {
      const result = judge({ type: 'app-schema-renderer', mobileNavMode: mode, basePath: '/apps/crm' });
      expect(result.success, `${face} ${mode}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it.each(FACES)('%s face: a mode the renderer does not implement is refused at `mobileNavMode`', (face, judge) => {
    expect(at(judge({ type: 'app-schema-renderer', mobileNavMode: 'bottom-nav' }), 'mobileNavMode').map((i) => i.code), face)
      .toEqual(['invalid_value']);
    expect(at(judge({ type: 'app-schema-renderer', basePath: 7 }), 'basePath').map((i) => i.code), face)
      .toEqual(['invalid_type']);
  });

  it.each(FACES)('%s face: both content channels are refused by name — a node draws neither', (face, judge) => {
    for (const key of ['children', 'body']) {
      const issues = at(judge({ type: 'app-schema-renderer', [key]: [{ type: 'text', content: 'x' }] }), key);
      expect(issues.map((i) => i.code), `${face} ${key}`).toEqual(['invalid_type']);
      expect(issues[0].message).toContain('reads NEITHER content channel');
    }
  });

  // The registration's third input, `schema`, was not declared here because no
  // node delivered it (measured on objectui#11440). objectui#11494 (triage
  // ruling A `5958227972`) made it true through a registration adapter and
  // declared it as the app document by reference, so this row moved, inverted,
  // to `./app-schema-renderer-schema-input-11494.test.ts`.
  it('the registration\'s `schema` input is declared since objectui#11494 (its rows moved there)', () => {
    expect(Object.keys(AppSchemaRendererNodeSchema.shape)).toContain('schema');
  });
});

/* ── object-pivot and embeddable-form ────────────────────────────────────── */

const PIVOT_BAG = { objectName: 'deal', rowField: 'stage', columnField: 'owner', valueField: 'amount', aggregation: 'sum' };
const FORM_BAG = { formId: 'contact-us', objectName: 'lead', fields: ['name', 'email'], allowMultiple: false };

describe('`object-pivot` and `embeddable-form` — the bag is the contract (objectui#11440)', () => {
  const BLOCKS = [
    ['object-pivot', PIVOT_BAG, ObjectPivotBlockSchema],
    ['embeddable-form', FORM_BAG, EmbeddableFormBlockSchema],
  ] as const;

  it.each(BLOCKS)('%s — neither row exists in the spec, so the bag is objectui\'s own', (type) => {
    expect(Object.keys(ComponentPropsMap)).not.toContain(type);
  });

  it.each(BLOCKS)('%s — the bag node validates on both faces, and with the node\'s `dataSource` binding in place of `objectName`', (type, bag) => {
    const { objectName: _object, ...unbound } = bag;
    for (const [face, judge] of FACES) {
      expect(judge({ type, properties: bag }).success, face).toBe(true);
      expect(judge({ type, properties: unbound, dataSource: { object: 'deal' } }).success, face).toBe(true);
    }
  });

  it.each(BLOCKS)('%s — each prop written flat is refused by name, toward `properties.KEY`', (type, bag) => {
    for (const [face, judge] of FACES) {
      const result = judge({ type, ...bag });
      for (const key of Object.keys(bag)) {
        const issues = at(result, key);
        expect(issues.map((i) => i.code), `${face} ${key}`).toEqual(['invalid_type']);
        expect(issues[0].message, `${face} ${key}`).toContain(`\`properties.${key}\``);
      }
    }
  });

  it.each(BLOCKS)('%s — no record source is refused, keyed `RECORD_SOURCE_REQUIRED`', (type, bag) => {
    const { objectName: _object, ...unbound } = bag;
    for (const [face, judge] of FACES) {
      const issues = at(judge({ type, properties: unbound }), 'properties.objectName');
      expect(issues.map((i) => i.code), face).toEqual(['custom']);
      expect((issues[0] as unknown as { params?: { code?: string } }).params?.code, face).toBe('RECORD_SOURCE_REQUIRED');
    }
  });

  it.each(BLOCKS)('%s — an undeclared bag key: unjudged by the tolerant face, refused as unrecognized by the strict one', (type, bag) => {
    const node = { type, properties: { ...bag, inventedKey11440: true } };
    expect(safeValidateSchema(node).success).toBe(true);
    expect(issuesOf(StrictAnyComponentSchema.safeParse(node)).flatMap((i) => i.keys ?? [])).toEqual(['inventedKey11440']);
  });

  it.each(BLOCKS)('%s — both content channels are refused by name', (type, bag) => {
    for (const [face, judge] of FACES) {
      for (const key of ['children', 'body']) {
        const issues = at(judge({ type, properties: bag, [key]: [] }), key);
        expect(issues.map((i) => i.code), `${face} ${key}`).toEqual(['invalid_type']);
      }
    }
  });
});

describe('`object-pivot` — its required members and its drill shape (objectui#11440)', () => {
  it.each(FACES)('%s face: a missing cross-tab field is refused at its bag path', (face, judge) => {
    const { rowField: _row, ...noRow } = PIVOT_BAG;
    expect(at(judge({ type: 'object-pivot', properties: noRow }), 'properties.rowField').map((i) => i.code), face)
      .toEqual(['invalid_type']);
    expect(at(judge({ type: 'object-pivot', properties: { ...PIVOT_BAG, aggregation: 'median' } }), 'properties.aggregation')
      .map((i) => i.code), face).toEqual(['invalid_value']);
  });

  it.each(FACES)('%s face: `drillDown` is accepted, and its `mode` refused by name', (face, judge) => {
    const drill = { enabled: true, target: 'drawer', columns: ['name'], maxRows: 50 };
    expect(judge({ type: 'object-pivot', properties: { ...PIVOT_BAG, drillDown: drill } }).success, face).toBe(true);
    const refused = at(judge({ type: 'object-pivot', properties: { ...PIVOT_BAG, drillDown: { ...drill, mode: 'record' } } }), 'properties.drillDown.mode');
    expect(refused.map((i) => i.code), face).toEqual(['invalid_type']);
    expect(refused[0].message).toContain('object-data-table');
  });

  it.each(FACES)('%s face: the retired `dataProvider` is refused by name, in the bag and written flat', (face, judge) => {
    const provider = { provider: 'object', object: 'deal' };
    expect(at(judge({ type: 'object-pivot', properties: { ...PIVOT_BAG, dataProvider: provider } }), 'properties.dataProvider')
      .map((i) => i.code), face).toEqual(['invalid_type']);
    expect(at(judge({ type: 'object-pivot', properties: PIVOT_BAG, dataProvider: provider }), 'dataProvider')
      .map((i) => i.code), face).toEqual(['invalid_type']);
  });
});

describe('`embeddable-form` — its required member (objectui#11440)', () => {
  it.each(FACES)('%s face: a missing `formId` is refused at its bag path; `fields` takes field names', (face, judge) => {
    const { formId: _form, ...noForm } = FORM_BAG;
    expect(at(judge({ type: 'embeddable-form', properties: noForm }), 'properties.formId').map((i) => i.code), face)
      .toEqual(['invalid_type']);
    expect(at(judge({ type: 'embeddable-form', properties: { ...FORM_BAG, fields: [{ field: 'name' }] } }), 'properties.fields.0')
      .map((i) => i.code), face).toEqual(['invalid_type']);
  });
});

describe('`object-pivot` and `embeddable-form` — the TypeScript authoring face (objectui#11440)', () => {
  // TYPE-level rows: judged by this package's `type-check` (`tsc -p
  // tsconfig.test.json`), never by vitest, which strips types.
  it('the bag is closed and required, and a flat prop is refused', () => {
    const pivot: ObjectPivotBlockNode = { type: 'object-pivot', properties: { rowField: 'stage', columnField: 'owner', valueField: 'amount' } };
    // @ts-expect-error `rowFeild` is not a member of the object-pivot bag (the registration inputs, closed)
    const misspelled: ObjectPivotBlockNode = { type: 'object-pivot', properties: { rowFeild: 'stage', columnField: 'owner', valueField: 'amount' } };
    // @ts-expect-error the bag is required: `rowField`, `columnField` and `valueField` live in it
    const bagless: ObjectPivotBlockNode = { type: 'object-pivot' };
    // @ts-expect-error `formId` is a member of the bag, refused flat on the node by name
    const flat: EmbeddableFormBlockNode = { type: 'embeddable-form', formId: 'contact-us', properties: { formId: 'contact-us' } };
    const form: EmbeddableFormBlockNode = { type: 'embeddable-form', properties: { formId: 'contact-us', objectName: 'lead' } };
    expect([pivot, misspelled, bagless, flat, form]).toHaveLength(5);
  });
});

/* ── detail-section ──────────────────────────────────────────────────────── */

/** The `detail-section` node the plugin-detail README teaches inside a `detail-view` tab. */
const README_SECTION = {
  type: 'detail-section',
  fields: [
    { name: 'description', label: 'Description' },
    { name: 'employees', label: 'Employee Count' },
  ],
};

describe('`detail-section` (objectui#11440)', () => {
  it.each(FACES)('%s face: the README\'s node validates, alone and inside a `detail-view` tab', (face, judge) => {
    expect(judge(README_SECTION).success, face).toBe(true);
    const view = {
      type: 'detail-view',
      title: 'Account: Acme Corp',
      objectName: 'accounts',
      resourceId: '12345',
      tabs: [{ key: 'details', label: 'Details', content: README_SECTION }],
    };
    const result = judge(view);
    expect(result.success, `${face}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  });

  it('its members are exactly the ten section members the registration publishes, by reference', () => {
    const { type: _type, body: _body, children: _children, ...members } = DetailSectionNodeSchema.shape;
    const published = [
      'title', 'description', 'icon', 'fields', 'collapsible',
      'defaultCollapsed', 'columns', 'showBorder', 'headerColor', 'hideEmpty',
    ];
    const own = Object.keys(members).filter((key) => published.includes(key));
    expect(own.sort()).toEqual([...published].sort());
    for (const key of published) {
      expect((members as Record<string, unknown>)[key], key).toBe((DetailViewSectionSchema.shape as Record<string, unknown>)[key]);
    }
  });

  it.each(FACES)('%s face: `fields` is required, and `headerColor` keeps its six tokens', (face, judge) => {
    expect(at(judge({ type: 'detail-section' }), 'fields').map((i) => i.code), face).toEqual(['invalid_type']);
    expect(at(judge({ ...README_SECTION, headerColor: 'bg-red-500' }), 'headerColor').map((i) => i.code), face)
      .toEqual(['invalid_value']);
    expect(judge({ ...README_SECTION, headerColor: 'muted', columns: 2, collapsible: true }).success, face).toBe(true);
  });

  it('it is not `record:details`\'s section shape — the spec row refuses the README\'s section (why it is not folded)', () => {
    const row = ComponentPropsMap['record:details'] as unknown as z.ZodType;
    const result = row.safeParse({ sections: [{ title: 'Details', fields: README_SECTION.fields }] }) as Result;
    expect(result.success).toBe(false);
    const codes = issuesOf(result).map((issue) => `${issue.code}@${issue.path.join('.')}`);
    expect(codes).toContain('unrecognized_keys@sections.0');
    expect(codes).toContain('invalid_type@sections.0.fields.0');
    // Lit control: the spec's own spelling of a section parses.
    expect(row.safeParse({ sections: [{ label: 'Details', fields: ['description'] }] }).success).toBe(true);
  });
});

/* ── report: the wrapper `spec-report` carried (objectui#11440, second PR) ── */

/** A dataset-bound spec report: the shape `plugin-report.mdx` teaches embedding. */
const SPEC_REPORT = {
  name: 'opp_by_stage',
  label: 'Opportunities by Stage',
  type: 'summary',
  dataset: 'opportunity_pipeline',
  rows: ['stage'],
  values: ['amount_sum'],
};

describe('`report` declares the wrapper shape the retired `spec-report` carried (objectui#11440)', () => {
  it.each(FACES)('%s face: FROM `spec-report` is refused at `type`; TO `report` validates', (face, judge) => {
    // Lit control: the wrapped value IS a spec report.
    expect(SpecReportSchema.safeParse(SPEC_REPORT).success).toBe(true);
    expect(refusedAtType(judge({ type: 'spec-report', report: SPEC_REPORT })), face).toBe(true);
    const to = judge({ type: 'report', report: SPEC_REPORT });
    expect(to.success, `${face}: ${JSON.stringify(to.error?.issues)}`).toBe(true);
  });

  it('the member is the spec\'s `ReportSchema`, by reference: what the spec refuses in a report is refused here, at its path', () => {
    const { name: _name, ...nameless } = SPEC_REPORT;
    for (const [face, judge] of FACES) {
      expect(at(judge({ type: 'report', report: nameless }), 'report.name').length, face).toBeGreaterThan(0);
      // The pre-9.0 query form, which the spec refuses ("did you mean `dataset`?").
      const pre9 = { name: 'legacy', label: 'Legacy', type: 'tabular', objectName: 'deal', columns: ['name'] };
      expect(issuesOf(judge({ type: 'report', report: pre9 })).some((i) => i.path[0] === 'report'), face).toBe(true);
      expect(SpecReportSchema.safeParse(pre9).success).toBe(false);
    }
  });

  it('the wrapper is on the authored node only: the report RECORD a viewer holds does not declare it', () => {
    expect(Object.keys(ReportNodeSchema.shape)).toContain('report');
    expect(Object.keys(ReportComponentSchema.shape)).not.toContain('report');
    const viewer = { type: 'report-viewer', report: { type: 'report', title: 'Q3', report: SPEC_REPORT } };
    expect(issuesOf(StrictAnyComponentSchema.safeParse(viewer)).flatMap((i) => i.keys ?? [])).toEqual(['report']);
    // Lit control: the legacy presentation node, with no wrapper, validates as before.
    for (const [face, judge] of FACES) expect(judge({ type: 'report', title: 'Q3', data: [] }).success, face).toBe(true);
  });
});

/* ── The ratchet's reading, per key ──────────────────────────────────────── */

describe('none of the seven is refused at `type` any more (objectui#11440)', () => {
  it.each([...KINDS, 'app-schema-renderer', 'object-pivot', 'embeddable-form', 'detail-section'])('%s', (type) => {
    for (const [face, judge] of FACES) expect(refusedAtType(judge({ type })), face).toBe(false);
  });

  it('lit control: `spec-report`, the eighth key, is refused there — retired, it has no arm (objectui#11440)', () => {
    for (const [face, judge] of FACES) expect(refusedAtType(judge({ type: 'spec-report' })), face).toBe(true);
  });
});
