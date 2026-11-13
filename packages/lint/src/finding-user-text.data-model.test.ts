// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The data-model advisories' user-facing sentences in the request's language
 * (ruling record 6819749037, the pattern `finding-user-text.test.ts` pins for
 * the security-posture rule): the autonumber-format rule's catalog
 * (`lint-autonumber-formats.user-text.ts`), the sort and search rules'
 * (`validate-sortable-fields.user-text.ts`, `validate-searchable-fields.user-text.ts`)
 * and the object-reference rule's (`validate-object-references.user-text.ts`),
 * each rendered from the rule's REAL findings in every platform locale, and
 * carried out of the publish door.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { FINDING_USER_TEXT_CATALOG, findingUserMessage } from './finding-user-text.js';
import { AUTONUMBER_FORMATS_USER_TEXT } from './lint-autonumber-formats.user-text.js';
import { SORTABLE_FIELDS_USER_TEXT } from './validate-sortable-fields.user-text.js';
import { SEARCHABLE_FIELDS_USER_TEXT } from './validate-searchable-fields.user-text.js';
import { OBJECT_REFERENCES_USER_TEXT } from './validate-object-references.user-text.js';
import {
  AUTONUMBER_LITERAL_TOKEN,
  AUTONUMBER_OPTIONAL_FIELD,
  AUTONUMBER_UNKNOWN_FIELD,
  lintAutonumberFormats,
} from './lint-autonumber-formats.js';
import { SORT_FIELD_UNPROVISIONED, validateSortableFields } from './validate-sortable-fields.js';
import { SEARCHABLE_FIELD_UNPROVISIONED, validateSearchableFields } from './validate-searchable-fields.js';
import {
  OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
  validateObjectReferences,
} from './validate-object-references.js';
import { PAGE_FIELD_UNPROVISIONED } from './validate-page-field-bindings.js';
import { TITLE_UNRESOLVABLE } from './validate-record-title.js';
import {
  RELATIONSHIP_MASTER_DETAIL_REQUIRED,
  UNIQUE_DOUBLE_DECLARATION,
  UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
} from './data-model-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;

/** The data-model advisory ids the publish door returns, one catalog each. */
const CATALOGS = [
  { catalog: AUTONUMBER_FORMATS_USER_TEXT, rules: [AUTONUMBER_LITERAL_TOKEN, AUTONUMBER_OPTIONAL_FIELD] },
  { catalog: SORTABLE_FIELDS_USER_TEXT, rules: [SORT_FIELD_UNPROVISIONED] },
  { catalog: SEARCHABLE_FIELDS_USER_TEXT, rules: [SEARCHABLE_FIELD_UNPROVISIONED] },
  { catalog: OBJECT_REFERENCES_USER_TEXT, rules: [OBJECT_REFERENCE_UNREGISTERED_PLATFORM] },
] as const;

// ── Fixtures ────────────────────────────────────────────────────────────────

/** An object with one Auto Number field of the given format. */
const autonumberStack = (format: string): AnyRec => ({
  objects: [{
    name: 'acme_invoice',
    fields: {
      name: { type: 'text', required: true },
      plan_no: { type: 'text' },
      invoice_no: { type: 'autonumber', autonumberFormat: format },
    },
  }],
});

/** An external object: its injected audit columns are addressable and not stored. */
const EXT = {
  name: 'acme_ext_customer',
  datasource: 'acme_external',
  external: { remoteName: 'customers' },
  fields: { name: { type: 'text' }, email: { type: 'text' } },
};
const extStack = (patch: AnyRec): AnyRec => ({ objects: [{ ...EXT, ...patch }] });

const datasetStack = (object: string): AnyRec => ({
  objects: [EXT],
  datasets: [{ name: 'acme_customer_metrics', object, dimensions: [], measures: [] }],
});

type Case = {
  label: string;
  rule: string;
  stack: AnyRec;
  params: Record<string, string>;
  run: (stack: AnyRec) => ReadonlyArray<{ rule: string; severity: string; userTextParams?: Record<string, string> }>;
};

/**
 * One stack per advisory push site the publish door reaches, with the params
 * each finding must carry: both arms of `autonumber-unrecognized-token`, the
 * optional-field site, the list-view sort site (`checkSortDeclaration`), both
 * roles of the search site (`checkSearchableFieldList`) and the dataset site
 * of the object-reference rule.
 */
const CASES: readonly Case[] = [
  {
    label: 'autonumber format with a token that is no counter, date or field',
    rule: AUTONUMBER_LITERAL_TOKEN,
    stack: autonumberStack('INV-{ YYYY }-{0000}'),
    params: { object: 'acme_invoice', field: 'invoice_no', token: '{ YYYY }', kind: 'unknown-token' },
    run: (s) => lintAutonumberFormats(s),
  },
  {
    label: 'autonumber format with a second counter',
    rule: AUTONUMBER_LITERAL_TOKEN,
    stack: autonumberStack('INV-{0000}-{00}'),
    params: { object: 'acme_invoice', field: 'invoice_no', token: '{00}', kind: 'second-counter' },
    run: (s) => lintAutonumberFormats(s),
  },
  {
    label: 'autonumber format interpolating an optional field',
    rule: AUTONUMBER_OPTIONAL_FIELD,
    stack: autonumberStack('{plan_no}-{0000}'),
    params: { object: 'acme_invoice', field: 'invoice_no', ref: 'plan_no' },
    run: (s) => lintAutonumberFormats(s),
  },
  {
    label: 'list-view sort on an unprovisioned injected column',
    rule: SORT_FIELD_UNPROVISIONED,
    stack: extStack({ listViews: { recent: { type: 'grid', sort: [{ field: 'created_at', order: 'desc' }] } } }),
    params: { object: 'acme_ext_customer', field: 'created_at' },
    run: (s) => validateSortableFields(s),
  },
  {
    label: 'object searchable fields naming an unprovisioned injected column',
    rule: SEARCHABLE_FIELD_UNPROVISIONED,
    stack: extStack({ searchableFields: ['name', 'created_at'] }),
    params: { object: 'acme_ext_customer', field: 'created_at', role: 'canonical' },
    run: (s) => validateSearchableFields(s),
  },
  {
    label: 'list-view search fields naming an unprovisioned injected column',
    rule: SEARCHABLE_FIELD_UNPROVISIONED,
    stack: extStack({ listViews: { recent: { type: 'grid', searchableFields: ['updated_at'] } } }),
    params: { object: 'acme_ext_customer', field: 'updated_at', role: 'narrowing' },
    run: (s) => validateSearchableFields(s),
  },
  {
    label: 'dataset based on a platform-shaped object no package provides',
    rule: OBJECT_REFERENCE_UNREGISTERED_PLATFORM,
    stack: datasetStack('sys_customer_score'),
    params: { dataset: 'acme_customer_metrics', object: 'sys_customer_score' },
    run: (s) => validateObjectReferences(s),
  },
];

/** The one finding of `rule` the case's stack produces. */
const findingOf = (c: Case) => {
  const found = c.run(c.stack).filter((f) => f.rule === c.rule);
  expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
  return found[0]!;
};

/** The params that are NAMES the sentence must show (not the arm selectors). */
const namesOf = (params: Record<string, string>): string[] =>
  Object.entries(params).filter(([key]) => key !== 'kind' && key !== 'role').map(([, value]) => value);

describe('data-model advisories user text · the catalogs', () => {
  it.each(CATALOGS.map((c) => [c.rules.join(', '), c] as const))(
    'the catalog of %s holds a sentence for exactly its door-reaching ids, in every platform locale',
    (_label, { catalog, rules }) => {
      expect(Object.keys(catalog).sort()).toEqual([...rules].sort());
      for (const [rule, entry] of Object.entries(catalog)) {
        expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
      }
    },
  );

  it('all four are merged into the one finding catalog the door renders from', () => {
    for (const { catalog, rules } of CATALOGS) {
      for (const rule of rules) expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(catalog[rule]);
    }
  });

  it('keeps every rule id stable: the catalogs are keyed by the ids the findings already carry', () => {
    expect(CATALOGS.flatMap((c) => c.rules)).toEqual([
      'autonumber-unrecognized-token',
      'autonumber-references-optional-field',
      'sort-field-unprovisioned',
      'searchable-field-unprovisioned',
      'object-reference-unregistered-platform',
    ]);
  });

  it('the advisory ids the door never returns have no sentence here, and stay on the English message', () => {
    // CLI-only registry entries (`RUNTIME_OBJECT_ADVISORY_VOLUME`) and the
    // `lintDataModel` sweep, which has no registry entry at all.
    for (const rule of [
      UNIQUE_DOUBLE_DECLARATION,
      UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
      'field/select-missing-options',
      RELATIONSHIP_MASTER_DETAIL_REQUIRED,
      'relationship/association-inline-edit',
      TITLE_UNRESOLVABLE,
    ]) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBeUndefined();
    }
  });
});

describe('data-model advisories user text · rendered from the rules\' real findings', () => {
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

  it('renders the two autonumber token arms, and the two search roles, apart in every platform locale', () => {
    for (const rule of [AUTONUMBER_LITERAL_TOKEN, SEARCHABLE_FIELD_UNPROVISIONED]) {
      const findings = CASES.filter((c) => c.rule === rule).map(findingOf);
      expect(findings, rule).toHaveLength(2);
      for (const tag of PLATFORM_LOCALE_TAGS) {
        // Same names, so only the arm selector tells the two apart.
        const texts = findings.map((f) =>
          findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, token: '{x}', field: 'f' } }, [tag]));
        expect(new Set(texts).size, `${rule} · ${tag}`).toBe(2);
      }
    }
  });

  it('renders the Auto Number sentence in zh-Hans and en with the object, field and optional field names', () => {
    const finding = findingOf(CASES.find((c) => c.rule === AUTONUMBER_OPTIONAL_FIELD)!);
    expect(findingUserMessage(finding, ['zh-CN'])).toContain('对象“acme_invoice”的自动编号字段“invoice_no”');
    expect(findingUserMessage(finding, ['zh-CN'])).toContain('请将“plan_no”设为必填字段');
    expect(findingUserMessage(finding, ['en-US'])).toContain(
      'Auto Number field "invoice_no" on object "acme_invoice" puts the value of "plan_no"',
    );
  });

  it('gives no sentence where the finding is not advice the door returns', () => {
    // An autonumber error refuses the write: no params.
    const unknown = lintAutonumberFormats(autonumberStack('{gone_field}-{0000}')).filter((f) => f.rule === AUTONUMBER_UNKNOWN_FIELD);
    expect(unknown.map((f) => f.severity)).toEqual(['error']);
    expect(unknown[0]!.userTextParams).toBeUndefined();
    // A page sort's unprovisioned warning is `validate-page-field-bindings.ts`'s
    // id: this file's page-sort site carries no params of its own.
    const pageSort = validateSortableFields({
      objects: [EXT],
      pages: [{
        name: 'acme_customer_page', type: 'app',
        regions: [{ name: 'main', components: [{
          type: 'object-grid',
          properties: { objectName: 'acme_ext_customer', sort: [{ field: 'created_at', order: 'desc' }] },
        }] }],
      }],
    }).filter((f) => f.rule === PAGE_FIELD_UNPROVISIONED);
    expect(pageSort.map((f) => f.severity)).toEqual(['warning']);
    expect(pageSort[0]!.userTextParams).toBeUndefined();
    expect(FINDING_USER_TEXT_CATALOG[PAGE_FIELD_UNPROVISIONED]).toBeUndefined();
    // The object-reference sites a per-write snapshot never carries as the
    // written item (here an object field's lookup target) carry none.
    const fieldSite = validateObjectReferences({
      objects: [{ name: 'acme_note', fields: { score: { type: 'lookup', reference: 'sys_customer_score' } } }],
    }).filter((f) => f.rule === OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
    expect(fieldSite.map((f) => f.severity)).toEqual(['warning']);
    expect(fieldSite[0]!.userTextParams).toBeUndefined();
  });
});

describe('data-model advisories user text · from the runtime gate to the wire field', () => {
  /** The element the save door's `advisories[]` carries, with the sentence it renders. */
  const issueOf = (advisory: { rule: string; path: string; where: string; message: string; hint: string; severity: string; userTextParams?: Record<string, string> }, locales: string[]) =>
    RuntimeAuthoringIssueSchema.parse({
      rule: advisory.rule,
      path: advisory.path,
      where: advisory.where,
      message: advisory.message,
      hint: advisory.hint,
      severity: advisory.severity,
      userMessage: findingUserMessage(advisory, locales),
    });

  it('an object write\'s autonumber advisory carries its params through the registry adapter', () => {
    const stack = autonumberStack('{plan_no}-{0000}') as { objects: AnyRec[] };
    const result = runRuntimeAuthoringRules({ type: 'object', item: stack.objects[0], context: { objects: [] } });
    const advisory = result.advisories.find((f) => f.rule === AUTONUMBER_OPTIONAL_FIELD);
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.userTextParams).toEqual({ object: 'acme_invoice', field: 'invoice_no', ref: 'plan_no' });

    const issue = issueOf(advisory!, ['zh-CN', 'en']);
    expect(issue.rule).toBe('autonumber-references-optional-field');
    expect(issue.userMessage).toContain('自动编号字段“invoice_no”');
    expect(issue.message).toBe(advisory!.message);
  });

  it('a view write\'s sort and search advisories render a valid userMessage', () => {
    const view = {
      name: 'acme_ext_recent', objectName: 'acme_ext_customer', viewKind: 'list', type: 'grid',
      sort: [{ field: 'created_at', order: 'desc' }], searchableFields: ['created_at'],
    };
    const result = runRuntimeAuthoringRules({ type: 'view', item: view, context: { objects: [EXT] } });
    for (const rule of [SORT_FIELD_UNPROVISIONED, SEARCHABLE_FIELD_UNPROVISIONED]) {
      const advisory = result.advisories.find((f) => f.rule === rule);
      expect(advisory, `${rule}: ${JSON.stringify(result.advisories)}`).toBeDefined();
      const issue = issueOf(advisory!, ['fr-FR', 'zh-CN']);
      expect(issue.rule).toBe(rule);
      expect(issue.userMessage).toContain('l’objet externe « acme_ext_customer »');
    }
  });

  it('a dataset write\'s object-reference advisory renders a valid userMessage', () => {
    const stack = datasetStack('sys_customer_score') as { objects: unknown[]; datasets: AnyRec[] };
    const result = runRuntimeAuthoringRules({ type: 'dataset', item: stack.datasets[0], context: { objects: stack.objects } });
    const advisory = result.advisories.find((f) => f.rule === OBJECT_REFERENCE_UNREGISTERED_PLATFORM);
    expect(advisory, JSON.stringify(result.advisories)).toBeDefined();
    expect(advisory!.userTextParams).toEqual({ dataset: 'acme_customer_metrics', object: 'sys_customer_score' });

    const issue = issueOf(advisory!, ['ja-JP']);
    expect(issue.userMessage).toContain('データセット「acme_customer_metrics」はオブジェクト「sys_customer_score」');
  });
});
