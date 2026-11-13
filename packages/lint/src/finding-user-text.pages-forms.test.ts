// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The form, visibility and page-sort advisories' user-facing sentences in the
 * request's language (ruling record 6819749037, the pattern
 * `finding-user-text.test.ts` pins for the security-posture rule): the
 * form-layout rule's catalog (`validate-form-layout.user-text.ts`), the
 * visibility rule's (`validate-visibility-predicates.user-text.ts`) and
 * `page-field-unprovisioned`'s (`validate-page-field-bindings.user-text.ts`,
 * pushed by `validate-sortable-fields.ts` at a page sort), each rendered from
 * the rule's REAL findings in every platform locale, and carried out of the
 * publish door.
 *
 * The page, navigation and translation advisories of the same card's rule
 * files have no sentence: they are reference-integrity members on the frozen
 * `flow` default, and a flow write's snapshot carries no pages, apps or
 * translations, so the door never returns them. The last block pins that.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { FINDING_USER_TEXT_CATALOG, findingUserMessage } from './finding-user-text.js';
import { FORM_LAYOUT_USER_TEXT } from './validate-form-layout.user-text.js';
import { VISIBILITY_PREDICATES_USER_TEXT } from './validate-visibility-predicates.user-text.js';
import { PAGE_FIELD_BINDINGS_USER_TEXT } from './validate-page-field-bindings.user-text.js';
import { FORM_FIELD_UNKNOWN, FORM_SECTION_GROUP_UNKNOWN, validateFormLayout } from './validate-form-layout.js';
import { VISIBILITY_ROOT_MISLAYERED, validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { validateSortableFields } from './validate-sortable-fields.js';
import {
  PAGE_FIELD_UNKNOWN,
  PAGE_FIELD_UNPROVISIONED,
  PAGE_SECTION_GROUP_UNKNOWN,
  validatePageFieldBindings,
} from './validate-page-field-bindings.js';
import {
  REACT_CHART_AGGREGATE_INVALID,
  REACT_CHART_FIELD_UNPROVISIONED,
  REACT_PAGE_SOURCE_UNPARSEABLE,
  REACT_PROP_DEPRECATED,
} from './validate-react-page-props.js';
import { NAV_OBJECT_UNGRANTED, validateNavAccess } from './validate-nav-access.js';
import { NAV_TARGET_UNRESOLVED, validateNavTargetRefs } from './validate-nav-target-refs.js';
import { TRANSLATION_OPTION_KEY_UNKNOWN } from './validate-translation-references.js';
import { TRANSLATION_SECTION_NAME_MISSING } from './validate-translatable-sections.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;
type Finding = { rule: string; severity: string; path: string; userTextParams?: Record<string, string> };

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT = {
  name: 'contract',
  fieldGroups: [{ key: 'basics', label: 'Basics' }],
  fields: { name: { type: 'text', group: 'basics' }, status: { type: 'text' } },
};
/** An ADR-0015 external object: the registry injects `created_at`, the remote table may not store it. */
const EXTERNAL = {
  name: 'showcase_ext_customer',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: { name: { type: 'text' }, email: { type: 'text' } },
};

const formStack = (view: AnyRec): AnyRec => ({ objects: [CONTRACT], views: [view] });
const simpleForm = (form: AnyRec): AnyRec =>
  ({ name: 'contract_form', type: 'simple', data: { provider: 'object', object: 'contract' }, ...form });

const RUNTIME_RULE = "data.status == 'open'";
const visibilityStack = (extra: AnyRec): AnyRec => ({ objects: [CONTRACT], ...extra });
const runtimeView = (section: AnyRec): AnyRec => ({ name: 'contract_view', object: 'contract', form: { sections: [section] } });

const sortPage = (page: AnyRec): AnyRec => ({ objects: [EXTERNAL], pages: [{ name: 'customer_page', ...page }] });
const UNSTORED_SORT = [{ field: 'created_at' }];
const SORT_PARAMS = { page: 'customer_page', object: 'showcase_ext_customer', field: 'created_at' };

type Case = {
  label: string;
  rule: string;
  stack: AnyRec;
  params: Record<string, string>;
  run: (stack: AnyRec) => readonly Finding[];
};

const formCase = (label: string, rule: string, view: AnyRec, params: Record<string, string>): Case =>
  ({ label, rule, stack: formStack(view), params, run: (s) => validateFormLayout(s as never) });
const visibilityCase = (label: string, stack: AnyRec, params: Record<string, string>): Case =>
  ({ label, rule: VISIBILITY_ROOT_MISLAYERED, stack, params, run: (s) => validateVisibilityPredicates(s as never) });
const sortCase = (label: string, page: AnyRec): Case =>
  ({ label, rule: PAGE_FIELD_UNPROVISIONED, stack: sortPage(page), params: SORT_PARAMS, run: (s) => validateSortableFields(s as never) });

/**
 * One stack per advisory push site the publish door reaches, and per way into
 * it: both of the form rule's sites (and both section buckets, and the Studio
 * form item's `config` rung), the visibility site from a view section, a view
 * field, a page component and a metadata-editing form, and the page-sort site
 * from each of its five callers.
 */
const CASES: readonly Case[] = [
  formCase('section field the object does not have', FORM_FIELD_UNKNOWN,
    simpleForm({ sections: [{ label: 'Main', fields: ['name', 'ghost_field'] }] }),
    { view: 'contract_form', object: 'contract', field: 'ghost_field' }),
  formCase('field in a Studio form item\'s config', FORM_FIELD_UNKNOWN,
    { name: 'contract_entry', object: 'contract', viewKind: 'form', config: { sections: [{ label: 'Main', fields: ['ghost_field'] }] } },
    { view: 'contract_entry', object: 'contract', field: 'ghost_field' }),
  formCase('section group the object does not declare', FORM_SECTION_GROUP_UNKNOWN,
    simpleForm({ sections: [{ label: 'Money', group: 'money' }] }),
    { view: 'contract_form', object: 'contract', group: 'money' }),
  formCase('legacy groups bucket naming an undeclared group', FORM_SECTION_GROUP_UNKNOWN,
    simpleForm({ groups: [{ label: 'Money', group: 'money' }] }),
    { view: 'contract_form', object: 'contract', group: 'money' }),
  visibilityCase('data-rooted rule on a view section',
    visibilityStack({ views: [runtimeView({ label: 'Main', visibleWhen: RUNTIME_RULE, fields: [] })] }),
    { surface: 'view', name: 'contract_view', root: 'data' }),
  visibilityCase('data-rooted rule on a view field',
    visibilityStack({ views: [runtimeView({ label: 'Main', fields: [{ field: 'name', visibleWhen: RUNTIME_RULE }] })] }),
    { surface: 'view', name: 'contract_view', root: 'data' }),
  visibilityCase('data-rooted rule on a page component',
    visibilityStack({ pages: [{ name: 'contract_page', type: 'record', object: 'contract', regions: [{ name: 'main', components: [
      { type: 'record:details', visibleWhen: RUNTIME_RULE, properties: {} },
    ] }] }] }),
    { surface: 'page', name: 'contract_page', root: 'data' }),
  visibilityCase('record-rooted rule on a metadata-editing form',
    visibilityStack({ views: [{ name: 'field_editor', form: {
      data: { provider: 'schema', schemaId: 'field' },
      sections: [{ label: 'Main', fields: [{ field: 'name', visibleWhen: "record.type == 'grid'" }] }],
    } }] }),
    { surface: 'view', name: 'field_editor', root: 'record' }),
  sortCase('list page sort', { type: 'list', object: 'showcase_ext_customer', interfaceConfig: { sort: UNSTORED_SORT } }),
  sortCase('app page record sort', { type: 'app', record: { object: 'showcase_ext_customer', sort: UNSTORED_SORT } }),
  sortCase('block sort', { type: 'app', regions: [{ name: 'main', components: [
    { type: 'object-grid', properties: { objectName: 'showcase_ext_customer', sort: UNSTORED_SORT } },
  ] }] }),
  sortCase('block data source sort', { type: 'app', regions: [{ name: 'main', components: [
    { type: 'element:number', dataSource: { object: 'showcase_ext_customer', sort: UNSTORED_SORT }, properties: { field: 'name' } },
  ] }] }),
  sortCase('related list parent data source sort', { type: 'app', regions: [{ name: 'main', components: [
    { type: 'record:related_list', properties: {
      objectName: 'showcase_ext_customer', relationshipField: 'name',
      parentDataSource: { object: 'showcase_ext_customer', sort: UNSTORED_SORT },
    } },
  ] }] }),
];

/** The one finding of `rule` the case's stack produces. */
const findingOf = (c: Case): Finding => {
  const found = c.run(c.stack).filter((f) => f.rule === c.rule);
  expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
  return found[0]!;
};

/** The params that are NAMES the sentence must show (not the variant selectors). */
const namesOf = (params: Record<string, string>): string[] =>
  Object.entries(params).filter(([key]) => key !== 'surface' && key !== 'root').map(([, value]) => value);

const DOOR_RULES = {
  form: [FORM_FIELD_UNKNOWN, FORM_SECTION_GROUP_UNKNOWN],
  visibility: [VISIBILITY_ROOT_MISLAYERED],
  pageFields: [PAGE_FIELD_UNPROVISIONED],
};

describe('form, visibility and page-sort advisories user text · the catalogs', () => {
  it.each([
    ['form layout', FORM_LAYOUT_USER_TEXT, DOOR_RULES.form],
    ['visibility predicates', VISIBILITY_PREDICATES_USER_TEXT, DOOR_RULES.visibility],
    ['page field bindings', PAGE_FIELD_BINDINGS_USER_TEXT, DOOR_RULES.pageFields],
  ] as const)('the %s catalog holds a sentence for exactly its door-reaching ids, in every platform locale', (_label, catalog, rules) => {
    expect(Object.keys(catalog).sort()).toEqual([...rules].sort());
    for (const [rule, entry] of Object.entries(catalog)) {
      expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
    }
  });

  it('all three are merged into the one finding catalog the door renders from', () => {
    for (const rule of DOOR_RULES.form) expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(FORM_LAYOUT_USER_TEXT[rule]);
    for (const rule of DOOR_RULES.visibility) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(VISIBILITY_PREDICATES_USER_TEXT[rule]);
    }
    for (const rule of DOOR_RULES.pageFields) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(PAGE_FIELD_BINDINGS_USER_TEXT[rule]);
    }
  });

  it('keeps every rule id stable: the catalogs are keyed by the ids the findings already carry', () => {
    expect([...DOOR_RULES.form, ...DOOR_RULES.visibility, ...DOOR_RULES.pageFields]).toEqual([
      'form-field-unknown',
      'form-section-group-unknown',
      'visibility-root-mislayered',
      'page-field-unprovisioned',
    ]);
  });

  it('the advisory ids the door never returns have no sentence, and stay on the English message', () => {
    for (const rule of [
      REACT_PAGE_SOURCE_UNPARSEABLE, REACT_PROP_DEPRECATED, 'react-prop-typo', REACT_CHART_AGGREGATE_INVALID,
      REACT_CHART_FIELD_UNPROVISIONED, NAV_OBJECT_UNGRANTED, NAV_TARGET_UNRESOLVED, PAGE_FIELD_UNKNOWN,
      PAGE_SECTION_GROUP_UNKNOWN, TRANSLATION_OPTION_KEY_UNKNOWN, TRANSLATION_SECTION_NAME_MISSING,
    ]) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBeUndefined();
    }
  });
});

describe('form, visibility and page-sort advisories user text · rendered from the rules\' real findings', () => {
  it.each(CASES.map((c) => [c.label, c] as const))('%s: carries its params and renders in every platform locale', (_label, c) => {
    const finding = findingOf(c);
    expect(finding.severity).toBe('warning');
    expect(finding.userTextParams).toEqual(c.params);

    const english = findingUserMessage(finding, ['en'])!;
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const text = findingUserMessage(finding, [tag]);
      expect(text, `${c.rule} · ${tag}`).toBeTruthy();
      expect(text, `${c.rule} · ${tag}`).not.toMatch(/undefined|\$\{/);
      for (const name of namesOf(c.params)) expect(text, `${c.rule} · ${tag} names ${name}`).toContain(name);
      // A real translation, not the English floor standing in for it.
      if (tag !== 'en') expect(text, `${c.rule} · ${tag}`).not.toBe(english);
    }
  });

  it('tells a runtime surface to use record. and a metadata-editing form to use data., in every locale', () => {
    const [runtime, metadata] = ['data-rooted rule on a view section', 'record-rooted rule on a metadata-editing form']
      .map((label) => findingOf(CASES.find((c) => c.label === label)!));
    expect(findingUserMessage(runtime!, ['en'])).toContain('Start the rule with "record."');
    expect(findingUserMessage(metadata!, ['en'])).toContain('Start the rule with "data."');
    for (const tag of PLATFORM_LOCALE_TAGS) {
      // Same name, so only `root` tells the two apart.
      const texts = [runtime!, metadata!].map((f) =>
        findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, name: 'n' } }, [tag]));
      expect(new Set(texts).size, tag).toBe(2);
    }
  });

  it('names a view as a view and a page as a page, in every locale', () => {
    const [view, page] = ['data-rooted rule on a view section', 'data-rooted rule on a page component']
      .map((label) => findingOf(CASES.find((c) => c.label === label)!));
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const texts = [view!, page!].map((f) =>
        findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, name: 'n' } }, [tag]));
      expect(new Set(texts).size, tag).toBe(2);
    }
  });

  it('renders the form sentence in zh-Hans and en with the view, object and field names', () => {
    const finding = findingOf(CASES[0]!);
    expect(findingUserMessage(finding, ['zh-CN'])).toContain('视图“contract_form”的表单列出了字段“ghost_field”');
    expect(findingUserMessage(finding, ['en-US'])).toContain('The form in view "contract_form" lists the field "ghost_field"');
  });

  it('gives no sentence where the id is not advice the door returns', () => {
    // The page-field-bindings rule's own sites of the provenance id, and its
    // section-group id: judged only on a flow write, whose snapshot has no pages.
    const bound = validatePageFieldBindings({
      objects: [EXTERNAL, CONTRACT],
      pages: [{ name: 'p', type: 'record', object: 'contract', regions: [{ name: 'main', components: [
        { type: 'record:details', properties: { objectName: 'contract', sections: [{ label: 'S', group: 'money', fields: ['name'] }] } },
      ] }] }],
    } as never);
    expect(bound.map((f) => f.rule)).toContain(PAGE_SECTION_GROUP_UNKNOWN);
    for (const f of bound) expect((f as Finding).userTextParams, f.rule).toBeUndefined();
    // The navigation advisories.
    const nav = [
      ...validateNavAccess({ objects: [CONTRACT], permissions: [{ name: 'ps', objects: {} }],
        apps: [{ name: 'a', navigation: [{ id: 'n', type: 'object', objectName: 'contract' }] }] } as never),
      ...validateNavTargetRefs({ apps: [{ name: 'a', navigation: [{ id: 'n', type: 'page', pageName: 'ghost' }] }] } as never),
    ];
    expect(nav.map((f) => f.rule).sort()).toEqual([NAV_OBJECT_UNGRANTED, NAV_TARGET_UNRESOLVED].sort());
    for (const f of nav) expect((f as Finding).userTextParams, f.rule).toBeUndefined();
    // A gating visibility verdict is an error with its own English message.
    const syntax = validateVisibilityPredicates(
      visibilityStack({ views: [runtimeView({ label: 'Main', visibleWhen: "record.status === 'open'", fields: [] })] }) as never);
    expect(syntax.map((f) => f.severity)).toEqual(['error']);
    expect(syntax[0]!.userTextParams).toBeUndefined();
  });
});

describe('form, visibility and page-sort advisories user text · from the runtime gate to the wire field', () => {
  /** The element the save door's `advisories[]` carries, with the sentence it renders. */
  const issueOf = (advisory: Finding & { where: string; message: string; hint: string }, locales: string[]) =>
    RuntimeAuthoringIssueSchema.parse({
      rule: advisory.rule,
      path: advisory.path,
      where: advisory.where,
      message: advisory.message,
      hint: advisory.hint,
      severity: advisory.severity,
      userMessage: findingUserMessage(advisory, locales),
    });

  it('a view write\'s section-group advisory carries the call-site params out of the gate', () => {
    const view = simpleForm({ sections: [{ label: 'Money', group: 'money' }] });
    const result = runRuntimeAuthoringRules({ type: 'view', item: view, context: { objects: [CONTRACT] } });
    const advisory = result.advisories.find((f) => f.rule === FORM_SECTION_GROUP_UNKNOWN);
    expect(advisory, 'the gate returns the section-group advisory for this write').toBeDefined();
    expect(advisory!.userTextParams).toEqual({ view: 'contract_form', object: 'contract', group: 'money' });

    const issue = issueOf(advisory!, ['de-DE', 'en']);
    expect(issue.rule).toBe('form-section-group-unknown');
    expect(issue.userMessage).toContain('aus der Feldgruppe „money“');
    expect(issue.message).toBe(advisory!.message);
  });

  it('a view write\'s unknown-field advisory renders a valid userMessage', () => {
    const view = simpleForm({ sections: [{ label: 'Main', fields: ['ghost_field'] }] });
    const result = runRuntimeAuthoringRules({ type: 'view', item: view, context: { objects: [CONTRACT] } });
    const advisory = result.advisories.find((f) => f.rule === FORM_FIELD_UNKNOWN);
    expect(advisory!.userTextParams).toEqual({ view: 'contract_form', object: 'contract', field: 'ghost_field' });
    expect(issueOf(advisory!, ['ja-JP']).userMessage).toContain('ビュー「contract_form」のフォーム');
  });

  it('a page write\'s mislayered root and unstored sort carry their params out of the gate', () => {
    const page = {
      name: 'customer_page', type: 'list', object: 'showcase_ext_customer',
      interfaceConfig: { sort: UNSTORED_SORT },
      regions: [{ name: 'main', components: [{ type: 'record:details', visibleWhen: RUNTIME_RULE, properties: {} }] }],
    };
    const result = runRuntimeAuthoringRules({ type: 'page', item: page, context: { objects: [EXTERNAL] } });
    const sort = result.advisories.find((f) => f.rule === PAGE_FIELD_UNPROVISIONED);
    const root = result.advisories.find((f) => f.rule === VISIBILITY_ROOT_MISLAYERED);
    expect(sort, 'the gate returns the unstored-sort advisory for this write').toBeDefined();
    expect(root, 'the gate returns the mislayered-root advisory for this write').toBeDefined();
    expect(sort!.userTextParams).toEqual(SORT_PARAMS);
    expect(root!.userTextParams).toEqual({ surface: 'page', name: 'customer_page', root: 'data' });

    expect(issueOf(sort!, ['zh-CN']).userMessage).toContain('页面“customer_page”按“created_at”排序');
    expect(issueOf(root!, ['fr-FR']).userMessage).toContain('la page « customer_page »');
  });
});
