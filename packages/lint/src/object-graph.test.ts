// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The seam's own pins (#14105). `validate-dataset-references.test.ts` exercises
// this module through one caller; these pin the VERDICTS directly, because the
// queued siblings (#14148 widget filter keys + sortBy, #14107 list-view field
// positions) consume the verdict union rather than that caller's findings. A
// verdict that silently changes kind would break them with a green suite here
// otherwise.

import { describe, it, expect } from 'vitest';
import {
  indexObjectGraph,
  resolveFieldPath,
  isUnjudgeable,
  nearestName,
  listNames,
  packagesOf,
  objectExtensionsByTarget,
  objectsAsServed,
  RELATIONSHIP_FIELD_TYPES,
} from './object-graph.js';
import { walkFilterFieldKeys, type FilterFieldKey } from './filter-walk.js';
import { DATASET_FIELD_UNKNOWN, validateDatasetReferences } from './validate-dataset-references.js';
import { MEASURE_AGGREGATE_FIELD_TYPE_REFUSED, validateDatasetMeasureAggregates } from './validate-dataset-measure-aggregates.js';
import { FIELD_NO_CONSUMERS, validateFieldConsumers } from './validate-field-consumers.js';
import { LIST_VIEW_FIELD_UNKNOWN, LIST_VIEW_KANBAN_LANE_UNKNOWN, validateListViewFieldRefs } from './validate-list-view-field-refs.js';
import { MAPPING_TARGET_FIELD_UNKNOWN, validateMappingTargetFields } from './validate-mapping-target-fields.js';
import { OBJECT_FIELD_REF_UNKNOWN, validateObjectFieldRefs } from './validate-object-field-refs.js';
import { PAGE_FIELD_UNKNOWN, validatePageFieldBindings } from './validate-page-field-bindings.js';
import { FILTER_PRESET_COMPARAND, validatePresetComparands } from './validate-preset-comparands.js';
import { RELATED_LIST_REF_UNKNOWN, validateRelatedListRefs } from './validate-related-list-refs.js';
import { REPORT_FILTER_FIELD_UNKNOWN, validateReportRuntimeFilters } from './validate-report-runtime-filter.js';
import { RLS_PREDICATE_UNKNOWN_FIELD, validateRlsPredicateEnforceability } from './validate-rls-predicate-enforceability.js';
import { SHARING_RULE_UNLOWERABLE_CONDITION, validateSharingRuleEnforceability } from './validate-sharing-rule-enforceability.js';
import { THANK_YOU_RECORD_FIELD, validateThankYouRecordFields } from './validate-thank-you-record-fields.js';
import { MEASURE_AGGREGATE_INCOHERENT, WIDGET_FILTER_FIELD_UNKNOWN, validateWidgetBindings } from './validate-widget-bindings.js';
import { validateStackExpressions } from './validate-expressions.js';
import { FLOW_NODE_WRITE_UNKNOWN_FIELD, validateFlowNodeWrites } from './validate-flow-node-writes.js';
import { ACTION_BODY_WRITE_UNKNOWN_FIELD, validateActionBodyWrites } from './validate-action-body-writes.js';
import { HOOK_BODY_WRITE_UNKNOWN_FIELD, validateHookBodyWrites } from './validate-hook-body-writes.js';
import { validateReactPageProps } from './validate-react-page-props.js';
import { TRANSLATION_TARGET_UNKNOWN, validateTranslationReferences } from './validate-translation-references.js';
import { FLOW_UPDATE_READONLY_FIELD, FLOW_UPDATE_READONLY_WHEN_FIELD, validateReadonlyFlowWrites } from './validate-readonly-flow-writes.js';
import { HOOK_API_UPDATE_READONLY_FIELD, HOOK_API_UPDATE_READONLY_WHEN_FIELD, validateReadonlyHookWrites } from './validate-readonly-hook-writes.js';
import { SORT_FIELD_UNKNOWN, SORT_FIELD_UNSORTABLE, validateSortableFields } from './validate-sortable-fields.js';
import { ACTION_API_UPDATE_READONLY_WHEN_FIELD, validateReadonlyActionWrites } from './validate-readonly-action-writes.js';
import { SEARCHABLE_FIELD_UNKNOWN, SEARCHABLE_FIELD_UNSEARCHABLE, validateSearchableFields } from './validate-searchable-fields.js';
import { FORM_FIELD_UNKNOWN, validateFormLayout } from './validate-form-layout.js';
import {
  NOTIFY_EMAIL_FIELD_NOT_EMAIL,
  NOTIFY_EMAIL_FIELD_UNKNOWN,
  validateNotifyEmailFieldRecipients,
} from './validate-notify-email-field-recipients.js';
import { PUBLIC_FORM_FILE_FIELD, validatePublicFormFileFields } from './validate-public-form-file-fields.js';
import {
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  validateFlowTemplatePaths,
} from './validate-flow-template-paths.js';
import { PAGE_VISUALIZATION_WITHOUT_BINDING, validatePageVisualizationBindings } from './validate-page-visualization-bindings.js';
import { AUTONUMBER_OPTIONAL_FIELD, AUTONUMBER_UNKNOWN_FIELD, lintAutonumberFormats } from './lint-autonumber-formats.js';
// [#16340] Read back the registry's OWN definition table to assert the graph
// derives its injected types rather than carrying a second copy of them.
import { injectedSystemColumnDefs } from '@objectstack/spec/data';

const stack = {
  objects: [
    {
      name: 'crm_opportunity',
      fields: {
        amount: { type: 'currency', label: 'Amount' },
        account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
        untargeted: { type: 'lookup', label: 'Dangling' },
      },
    },
    {
      name: 'crm_account',
      fields: {
        region: { type: 'text', label: 'Region' },
        // [#24808] A link to a person OBJECT is a `lookup`: a `user` field's
        // target is fixed to `sys_user`, and `FieldSchema` refuses a `user`
        // field naming another object (#24952).
        owner: { type: 'lookup', label: 'Owner', reference: 'crm_person' },
      },
    },
    { name: 'crm_person', fields: { email: { type: 'email', label: 'Email' } } },
    // No readable field map — ADR-0015 external / introspected.
    { name: 'ext_thing', datasource: 'remote' },
  ],
};

const graph = indexObjectGraph(stack);

describe('object-graph — resolveFieldPath verdicts', () => {
  it('resolves a base field', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'amount')).toMatchObject({
      kind: 'ok',
      object: 'crm_opportunity',
      field: 'amount',
    });
  });

  it('resolves a two-hop path onto the object the LEAF lives on', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'account.owner.email')).toMatchObject({
      kind: 'ok',
      object: 'crm_person',
      field: 'email',
    });
  });

  it('reports the leaf miss against the object it landed on', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'account.regionn')).toMatchObject({
      kind: 'field-unknown',
      object: 'crm_account',
      field: 'regionn',
    });
  });

  it('reports an unknown hop with its 0-based position', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'accunt.region')).toMatchObject({
      kind: 'hop-unknown',
      at: 0,
      segment: 'accunt',
      object: 'crm_opportunity',
    });
  });

  it('distinguishes a hop through a NON-relationship from an unknown one', () => {
    // The distinction is the whole reason the verdict is a union: "amount is
    // not a relationship" and "accunt is not a field" need different fixes.
    expect(resolveFieldPath(graph, 'crm_opportunity', 'amount.x')).toMatchObject({
      kind: 'hop-not-relationship',
      at: 0,
      segment: 'amount',
      type: 'currency',
    });
  });

  it('treats a relationship with no reference target as unanswerable', () => {
    const verdict = resolveFieldPath(graph, 'crm_opportunity', 'untargeted.x');
    expect(verdict).toMatchObject({ kind: 'hop-untargeted' });
    expect(isUnjudgeable(verdict)).toBe(true);
  });

  // [#16340] An injected leaf resolves WITH the registry's own definition. The
  // marker still says the object does not author the column — that is the #8116
  // provenance question — but `meta` answers the second question a caller asks
  // ("is it temporal?") exactly as it does on an authored field. Before this,
  // the leaf carried no `meta` at all and every such caller had to stay silent;
  // `filter-preset-comparand` did, on the two most-filtered columns in the
  // platform.
  it("resolves an injected leaf with the registry's own type, and marks it injected", () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'created_at')).toMatchObject({
      kind: 'ok', object: 'crm_opportunity', field: 'created_at', injected: true,
      meta: { type: 'datetime' },
    });
    expect(resolveFieldPath(graph, 'crm_opportunity', 'updated_at')).toMatchObject({
      kind: 'ok', injected: true, meta: { type: 'datetime' },
    });
    // An injected LOOKUP anchor carries its target too — read from the same
    // table, never re-declared here.
    expect(resolveFieldPath(graph, 'crm_opportunity', 'owner_id')).toMatchObject({
      kind: 'ok', injected: true, meta: { type: 'lookup', reference: 'sys_user' },
    });
  });

  // The type is DERIVED, never transcribed: it must equal the definition the
  // registry spreads at registration, byte for byte. Reading the spec table
  // here is the assertion — a hand-copied 'datetime' in this package would pass
  // a literal pin and drift the day the registry re-types the column.
  it('reports the type the registry injects, not a copy of it', () => {
    const defs = injectedSystemColumnDefs(stack.objects[0]);
    for (const [name, def] of Object.entries(defs)) {
      const verdict = resolveFieldPath(graph, 'crm_opportunity', name);
      expect(verdict).toMatchObject({ kind: 'ok', injected: true });
      expect((verdict as { meta?: { type?: string } }).meta?.type).toBe(def.type);
    }
    expect(Object.keys(defs).length).toBeGreaterThan(0); // lit control
  });

  // `id` is the one addressable column with NO definition behind it — the
  // DRIVER provisions the primary key. An empty slice is the truthful answer,
  // and it must stay distinguishable from "this column does not exist".
  it('resolves the primary key with an empty slice rather than a guessed type', () => {
    const verdict = resolveFieldPath(graph, 'crm_opportunity', 'id');
    expect(verdict).toMatchObject({ kind: 'ok', field: 'id', injected: true });
    expect((verdict as { meta?: { type?: string } }).meta?.type).toBeUndefined();
    expect(injectedSystemColumnDefs(stack.objects[0]).id).toBeUndefined(); // why
  });

  // The opt-out rows are the registry's, not this module's: an object that
  // opts out has no injected column to resolve, so the reference is a real
  // miss and must still be reported.
  it('reports an injected name on an object the registry opts out of', () => {
    const optedOut = indexObjectGraph({
      objects: [{ name: 'seed_rows', systemFields: false, fields: { note: { type: 'text' } } }],
    });
    expect(resolveFieldPath(optedOut, 'seed_rows', 'created_at')).toMatchObject({
      kind: 'field-unknown', object: 'seed_rows', field: 'created_at',
    });
    // …and the driver's primary key survives even that row.
    expect(resolveFieldPath(optedOut, 'seed_rows', 'id')).toMatchObject({ kind: 'ok', injected: true });
  });

  it('skips an object not in the stack, and one with no field map', () => {
    expect(isUnjudgeable(resolveFieldPath(graph, 'not_here', 'x'))).toBe(true);
    expect(resolveFieldPath(graph, 'not_here', 'x')).toMatchObject({ reason: 'object-not-in-stack' });
    expect(resolveFieldPath(graph, 'ext_thing', 'x')).toMatchObject({ reason: 'no-field-map' });
  });

  it('skips a hop through an injected column rather than guessing its target', () => {
    expect(resolveFieldPath(graph, 'crm_opportunity', 'owner_id.name')).toMatchObject({
      kind: 'unknowable',
      reason: 'injected-hop',
    });
  });

  it('answers undefined when there is nothing to resolve', () => {
    expect(resolveFieldPath(graph, undefined, 'amount')).toBeUndefined();
    expect(resolveFieldPath(graph, 'crm_opportunity', '')).toBeUndefined();
    expect(isUnjudgeable(undefined)).toBe(true);
  });

  it('reads the name-keyed collection shape', () => {
    const mapGraph = indexObjectGraph({ objects: { a: { fields: { n: { type: 'text' } } } } });
    expect(resolveFieldPath(mapGraph, 'a', 'n')).toMatchObject({ kind: 'ok' });
  });

  it('carries the relationship type set the platform traverses', () => {
    expect([...RELATIONSHIP_FIELD_TYPES].sort()).toEqual(['lookup', 'master_detail', 'tree', 'user']);
  });
});

describe('object-graph — suggestion helpers', () => {
  it('suggests within the budget and stays silent outside it', () => {
    expect(nearestName('regionn', ['region', 'amount'])).toBe('region');
    expect(nearestName('zzzzzzzz', ['region', 'amount'])).toBeUndefined();
  });

  it('lists names sorted, or `(none)`', () => {
    expect(listNames(['b', 'a'])).toBe('a, b');
    expect(listNames([])).toBe('(none)');
  });
});

describe('filter-walk — walkFilterFieldKeys across the three authored shapes', () => {
  const keys = (node: unknown): FilterFieldKey[] => {
    const out: FilterFieldKey[] = [];
    walkFilterFieldKeys(node, 'f', (k) => out.push(k));
    return out;
  };

  it('reads a Mongo condition object, operators and all', () => {
    expect(keys({ status: 'open', amount: { $gt: 10 } })).toEqual([
      { field: 'status', path: 'f.status' },
      { field: 'amount', path: 'f.amount' },
    ]);
  });

  it('descends combinators without reporting them as fields', () => {
    expect(keys({ $or: [{ a: 1 }, { $not: { b: 2 } }] })).toEqual([
      { field: 'a', path: 'f.$or[0].a' },
      { field: 'b', path: 'f.$or[1].$not.b' },
    ]);
  });

  it('composes a nested condition object into one relationship path', () => {
    expect(keys({ account: { region: 'emea' } })).toEqual([
      { field: 'account.region', path: 'f.account.region' },
    ]);
  });

  it('reports the hop itself when the nested object is empty', () => {
    expect(keys({ account: {} })).toEqual([{ field: 'account', path: 'f.account' }]);
  });

  it('reads the { field, operator, value } rule shape', () => {
    expect(keys([{ field: 'status', operator: 'equals', value: 'open' }])).toEqual([
      { field: 'status', path: 'f[0].field' },
    ]);
  });

  it('reads triples and their and/or groups', () => {
    expect(keys(['and', ['status', '=', 'open'], ['amount', '>', 1]])).toEqual([
      { field: 'status', path: 'f[1][0]' },
      { field: 'amount', path: 'f[2][0]' },
    ]);
  });

  it('does not descend an unrecognised $ operator', () => {
    expect(keys({ $weird: { a: 1 } })).toEqual([]);
  });

  it('tolerates non-filter input', () => {
    expect(keys(undefined)).toEqual([]);
    expect(keys('a string')).toEqual([]);
  });
});

describe('object-graph — a non-record entry in `stack.objects` (#15494)', () => {
  // The seam is the FIRST statement of every rule that resolves a field path,
  // so an unguarded read here threw before any member's own `if (!isRec(obj))
  // continue` could run — on the runtime publish door that is an exception on
  // a write path, not a skipped finding. Measured on `origin/main` at
  // 615fac3a0, `validateObjectFieldRefs({ objects: [null] })`:
  //   TypeError: Cannot read properties of null (reading 'name')
  //     at indexObjectGraph (src/object-graph.ts:159:30)
  // The entry is SKIPPED rather than reported: this module decides no
  // severities by contract, and a junk member is a shape defect the schema
  // owns — see `asArray`'s note for the three reasons and the measurement.

  it('drops a null entry instead of throwing, and still indexes the rest', () => {
    const valid = { name: 'crm_lead', fields: { name: { type: 'text' } } };
    expect(() => indexObjectGraph({ objects: [null] })).not.toThrow();
    const g = indexObjectGraph({ objects: [null, valid, undefined, 'junk', 42, []] });
    expect([...g.keys()]).toEqual(['crm_lead']);
    expect(resolveFieldPath(g, 'crm_lead', 'name')).toMatchObject({ kind: 'ok' });
  });

  it('drops a non-record FIELD entry too — the same read, one level down', () => {
    // `graphObjectOf` walks `obj.fields` through the identical helper, so
    // `fields: [null]` crashed at the same statement for the same reason.
    const g = indexObjectGraph({
      objects: [{ name: 'crm_lead', fields: [null, { name: 'amount', type: 'currency' }] }],
    });
    expect(resolveFieldPath(g, 'crm_lead', 'amount')).toMatchObject({ kind: 'ok' });
  });

  it('reads a name-keyed map whose VALUE is not a record as a nameless object', () => {
    // `{ a: 'junk' }` used to spread the string's indices into the record; the
    // verdict was already `no-field-map`, and it still is — the entry keeps
    // its key so an object declaring nothing stays distinguishable from one
    // this stack never defined (skip 2 vs. skip 1).
    const g = indexObjectGraph({ objects: { a: 'junk', b: { fields: { n: { type: 'text' } } } } });
    expect(resolveFieldPath(g, 'a', 'n')).toMatchObject({ kind: 'unknowable', reason: 'no-field-map' });
    expect(resolveFieldPath(g, 'b', 'n')).toMatchObject({ kind: 'ok' });
  });
});

describe('object-graph — packagesOf (#20206, ruling A on #15293 `5634034754`)', () => {
  // `packages` is declared `z.array(ArtifactPackageSchema).optional()` — array
  // or absent, never map-or-array like `objects`/`sections`/`tabs`. A PRESENT
  // non-array `packages` ({}, 0, 'x', a keyed object) is malformed, not
  // absent, and every reader refuses it. This is the ONE reader the five
  // `packages/lint` call sites now share, replacing five private copies of
  // `recordsOf(stack.packages)`.

  it('CONTROL — an array is read exactly as `recordsOf` read it: iterated, junk dropped', () => {
    const valid = { manifest: { id: 'com.example.a' } };
    expect(packagesOf({ packages: [valid] })).toEqual([valid]);
    expect(packagesOf({ packages: [null, valid, undefined, 'junk', 42, []] })).toEqual([valid]);
  });

  it('CONTROL — only an absent (`undefined`) `packages` stays silent — `[]`, not a refusal', () => {
    expect(packagesOf({})).toEqual([]);
    expect(packagesOf({ packages: undefined })).toEqual([]);
  });

  it.each([
    ['an empty object', {}],
    ['a keyed object (the shape `recordsOf` would have read as a map)', { a: { manifest: {} } }],
    ['a number', 0],
    ['a string', 'x'],
  ])('refuses a PRESENT non-array `packages` — %s', (_label, shape) => {
    expect(() => packagesOf({ packages: shape })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT_PACKAGES', status: 422 }),
    );
    // The message names the actual runtime type, so an author sees what they
    // wrote rather than a generic "malformed" sentence.
    expect(() => packagesOf({ packages: shape })).toThrow(
      new RegExp(`\`packages\` of type ${typeof shape}`),
    );
  });

  // [ruling A on #19926, `5805260775`] `null` is malformed, everywhere — it is
  // PRESENT, not absent, so it takes the same refusal as `{}`/`0`/`'x'`, not
  // the silent branch above. `typeof null` is `'object'`, which would name a
  // `{}` the author never wrote, so the message names `null` as itself
  // (matching `resolveArtifactPackageOrder` in `@objectstack/core`, PR #20228).
  it('refuses `packages: null` too — malformed, not absent (ruling `5805260775` on #19926)', () => {
    expect(() => packagesOf({ packages: null })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT_PACKAGES', status: 422 }),
    );
    expect(() => packagesOf({ packages: null })).toThrow(/`packages` of type null/);
    expect(() => packagesOf({ packages: null })).not.toThrow(/of type object/);
  });
});

/**
 * [#30303] The shared extension fold on junk input, beside the
 * `indexObjectGraph` and `packagesOf` cases above. Neither export refuses
 * anything: a malformed `packages` is {@link packagesOf}'s refusal, met by a
 * caller that reads the bodies through it (`validateSecurityPosture` does,
 * before either fold runs). Each shape below reads as "nothing to fold" for
 * the part that is junk, and never throws.
 */
describe('[#30303] object-graph — objectExtensionsByTarget / objectsAsServed on junk input', () => {
  const OBJ = { name: 'crm_contract', fields: { contract_no: { type: 'text' } } };
  const EXT = { extend: 'crm_contract', fields: { note: { type: 'text' } } };
  const served = (stack: unknown) =>
    objectsAsServed(stack).objects.map((o) => [o.name, (o.fields as Array<{ name: string }> | Record<string, unknown>)]);

  it('a null or non-record stack: no extensions, no objects', () => {
    for (const stack of [null, undefined, 'junk', 42, []]) {
      expect(objectExtensionsByTarget(stack).size, String(stack)).toBe(0);
      expect(objectsAsServed(stack), String(stack)).toEqual({ objects: [], tied: new Map() });
    }
  });

  it('packages: [null] and other non-record entries or bodies contribute nothing; a record body beside them still does', () => {
    expect(objectExtensionsByTarget({ packages: [null] }).size).toBe(0);
    const stack = {
      objects: [OBJ],
      packages: [null, 'junk', 42, [], { manifest: null }, { manifest: 'junk' }, { manifest: { objectExtensions: [EXT] } }],
    };
    expect([...objectExtensionsByTarget(stack).entries()].map(([t, list]) => [t, list.map((e) => [e.carrier, e.path])])).toEqual([
      ['crm_contract', [[6, 'packages[6].manifest.objectExtensions[0]']]],
    ]);
    expect(objectsAsServed(stack).objects[0].fields).toEqual([
      { name: 'contract_no', type: 'text' },
      { name: 'note', type: 'text' },
    ]);
  });

  it('a non-array objectExtensions folds nothing', () => {
    for (const objectExtensions of [null, 'junk', 42, { crm_contract: EXT }]) {
      const stack = { objects: [OBJ], objectExtensions };
      expect(objectExtensionsByTarget(stack).size, JSON.stringify(objectExtensions)).toBe(0);
      expect(objectsAsServed(stack).objects, JSON.stringify(objectExtensions)).toEqual([OBJ]);
    }
  });

  it('a non-record entry, or one whose extend is not a string, is skipped; the record entry beside it is read', () => {
    const stack = {
      objects: [OBJ],
      objectExtensions: [null, 'junk', 42, [], { extend: 7, fields: { x: { type: 'text' } } }, { fields: { y: {} } }, EXT],
    };
    expect([...objectExtensionsByTarget(stack).keys()]).toEqual(['crm_contract']);
    expect(objectExtensionsByTarget(stack).get('crm_contract')!.map((e) => e.path)).toEqual(['objectExtensions[6]']);
    expect(served(stack)).toEqual([['crm_contract', [{ name: 'contract_no', type: 'text' }, { name: 'note', type: 'text' }]]]);
  });

  it('junk fields add nothing: a non-collection, non-record members, a member with no name', () => {
    for (const fields of [null, 'junk', 42, [null, 'x', 3, { type: 'text' }, { name: '', type: 'text' }]]) {
      const stack = { objects: [OBJ], objectExtensions: [{ extend: 'crm_contract', fields }] };
      expect(() => objectsAsServed(stack), JSON.stringify(fields)).not.toThrow();
      expect(objectsAsServed(stack).objects[0].fields, JSON.stringify(fields)).toEqual([{ name: 'contract_no', type: 'text' }]);
    }
    // The array form is read by name, as the map form is.
    const arrayForm = { objects: [OBJ], objectExtensions: [{ extend: 'crm_contract', fields: [{ name: 'note', type: 'text' }] }] };
    expect(served(arrayForm)).toEqual([['crm_contract', [{ name: 'contract_no', type: 'text' }, { name: 'note', type: 'text' }]]]);
  });

  // `ObjectExtensionSchema.priority` is a number, so a parsed stack never
  // carries this shape; the fold reads a non-number as absent (the default 200,
  // as `SchemaRegistry.registerObjectExtension` does) rather than guessing.
  it('a string priority reads as the default 200 and never throws', () => {
    const stack = {
      objects: [OBJ],
      packages: [
        { manifest: { objectExtensions: [{ extend: 'crm_contract', priority: '100', fields: { note: { type: 'text', label: 'A' } } }] } },
        { manifest: { objectExtensions: [{ extend: 'crm_contract', priority: 150, fields: { note: { type: 'text', label: 'B' } } }] } },
      ],
    };
    expect(objectExtensionsByTarget(stack).get('crm_contract')!.map((e) => [e.carrier, e.priority])).toEqual([
      [1, 150],
      [0, 200],
    ]);
    // So the string-priority entry folds LAST and its definition wins, untied.
    const { objects, tied } = objectsAsServed(stack);
    expect((objects[0].fields as Array<Record<string, unknown>>).find((f) => f.name === 'note')?.label).toBe('A');
    expect(tied.size).toBe(0);
  });
});

/**
 * [#19289] A `{ type: 'user' }` field with no `reference` is TRAVERSABLE — the
 * third defect found by the implicit-target census, and the widest-reaching of
 * the four.
 *
 * `RELATIONSHIP_FIELD_TYPES` admits `user`, so `resolveFieldPath` hops through
 * one. The slice's `reference` came from `referenceCarrierOf`, which answers
 * what the CARRIER says — and `IMPLICIT_REFERENCE_TARGETS`
 * (`packages/spec/src/data/field-value.zod.ts`) declares a `user` field's
 * target "a CONSTANT OF THE TYPE", with metadata authored without `reference`
 * "fully specified, not under-specified". So a spec-complete field answered
 * `hop-untargeted`.
 *
 * ## Why that is the SILENT class, not a false positive
 *
 * `hop-untargeted` is `isUnjudgeable`, and `describeFieldPathVerdict` returns
 * `undefined` for it — "the graph could not answer". Every rule in this package
 * that resolves a field PATH therefore STOPPED JUDGING any path through an
 * author's "responsible person" column, reporting nothing at all. That is the
 * failure mode `isUnjudgeable`'s own docblock says this family exists to end:
 * "a missed report is silence".
 *
 * The repair is not an arbiter swap at the call — `graphFieldOf` synthesized
 * `{ reference: def.reference }` and threw `type` away before the arbiter could
 * see it. The field is now passed through whole.
 */
describe('[#19289] object-graph — a `user` field takes its target from the TYPE', () => {
  const implicitStack = {
    objects: [
      {
        name: 'crm_task',
        fields: {
          subject: { type: 'text', label: 'Subject' },
          // Spec-complete: no `reference`, because the type supplies it.
          assignee: { type: 'user', label: 'Assignee' },
          // The same field, with the constant materialized by hand.
          assignee_explicit: { type: 'user', label: 'Assignee', reference: 'sys_user' },
          // ⛔ The boundary: `lookup` has no constant, so it stays untargeted.
          orphan: { type: 'lookup', label: 'Orphan' },
        },
      },
      { name: 'sys_user', fields: { name: { type: 'text' }, email: { type: 'email' } } },
    ],
  };
  const implicitGraph = indexObjectGraph(implicitStack);

  it('THE DEFECT: `assignee.email` RESOLVES — it is no longer `hop-untargeted`', () => {
    const verdict = resolveFieldPath(implicitGraph, 'crm_task', 'assignee.email');
    expect(verdict).toMatchObject({ kind: 'ok', object: 'sys_user', field: 'email' });
    // The load-bearing half: an unjudgeable verdict is what made every
    // consuming rule fall silent, so this is what actually ended.
    expect(isUnjudgeable(verdict)).toBe(false);
  });

  it('the two legal spellings of one fully-specified field resolve identically', () => {
    expect(resolveFieldPath(implicitGraph, 'crm_task', 'assignee.email'))
      .toEqual(resolveFieldPath(implicitGraph, 'crm_task', 'assignee_explicit.email'));
  });

  it('a MISS through the implicit hop is now REPORTED, where it used to be swallowed', () => {
    // The other direction, and the one that proves judgement resumed rather
    // than merely changing shape: a typo'd leaf beyond the hop produces a real
    // finding instead of silence.
    const verdict = resolveFieldPath(implicitGraph, 'crm_task', 'assignee.emial');
    expect(verdict).toMatchObject({ kind: 'field-unknown', object: 'sys_user', field: 'emial' });
    expect(isUnjudgeable(verdict)).toBe(false);
  });

  it('control: `lookup` with no carrier is STILL `hop-untargeted` — only `user` has a constant', () => {
    const verdict = resolveFieldPath(implicitGraph, 'crm_task', 'orphan.x');
    expect(verdict).toMatchObject({ kind: 'hop-untargeted' });
    expect(isUnjudgeable(verdict)).toBe(true);
  });

  it('[#24952] a foreign carrier on a `user` field no longer wins: the hop lands on `sys_user`', () => {
    // `reference` MATERIALIZES the constant for `user`. Naming another object
    // with it is refused at parse, so it reaches the graph only unparsed, and
    // the arbiter answers the type's constant rather than what was written.
    const foreign = indexObjectGraph({
      objects: [
        { name: 'crm_account', fields: { owner: { type: 'user', label: 'Owner', reference: 'crm_person' } } },
        { name: 'crm_person', fields: { email: { type: 'email', label: 'Email' } } },
        { name: 'sys_user', fields: { email: { type: 'email', label: 'Email' } } },
      ],
    });
    expect(resolveFieldPath(foreign, 'crm_account', 'owner.email'))
      .toMatchObject({ kind: 'ok', object: 'sys_user', field: 'email' });
  });

  it('control: an UNREADABLE carrier still REFUSES at index time', () => {
    // `referenceTargetOf` reads the carrier through `referenceCarrierOf` before
    // it judges the type, so #13053's refusal is untouched — the implicit
    // target is not a fallback that swallows a broken carrier.
    const broken = { objects: [{ name: 'crm_task', fields: { assignee: { type: 'user', reference: { object: 'sys_user' } } } }] };
    expect(() => indexObjectGraph(broken)).toThrow(TypeError);
    expect(() => indexObjectGraph(broken)).toThrow(/`reference` is an object/);
  });
});

// [#30383] The field-path rules resolve through the fold above. One artifact
// for all of them: a module package (`mod`) adds fields to the app package's
// `xs_deal` through `objectExtensions`, the HotCRM shape. Per rule: a path
// naming an extension-added field passes, the same stack without the
// extension still refuses it (the pin is not vacuous), and a field no body
// declares or extends is refused under the same rule id as before.
describe('[#30383] the field-path rules read the objects as served', () => {
  type Rec = Record<string, unknown>;
  type Run = (stack: Rec) => ReadonlyArray<{ rule: string }>;
  const deal = { name: 'xs_deal', fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'xs_account' } } };
  const account = { name: 'xs_account', fields: { name: { type: 'text' }, tier: { type: 'text' } } };
  const note = { name: 'xs_note', fields: { body: { type: 'text' } } };
  const added = {
    region: { type: 'text' },
    score: { type: 'number' },
    closed_on: { type: 'date' },
    ref_no: { type: 'autonumber' },
    partner: { type: 'lookup', reference: 'xs_account' },
  };
  const extensions = [
    { extend: 'xs_deal', fields: added },
    { extend: 'xs_note', fields: { deal_id: { type: 'lookup', reference: 'xs_deal' } } },
  ];
  const artifact = (extra: Rec, objectExtensions: unknown[] = extensions): Rec => ({
    objects: [deal, account, note],
    packages: [
      { manifest: { id: 'app', objects: [deal, account, note] } },
      { manifest: { id: 'mod', objectExtensions } },
    ],
    ...extra,
  });
  const ids = (run: Run, stack: Rec) => run(stack).map((f) => f.rule);
  const dataset = (field: string) => ({
    name: 'deals', object: 'xs_deal', include: ['partner'],
    dimensions: [{ name: 'd', field }], measures: [{ name: 'n', aggregate: 'count' }],
  });
  const widget = (filter: Rec) => ({
    datasets: [dataset('name')],
    dashboards: [{ name: 'b', widgets: [{ id: 'w', type: 'metric', dataset: 'deals', values: ['n'], filter }] }],
  });

  // rule · its unknown-field id · the stack naming FIELD
  const existence: Array<[string, string, Run, (field: string) => Rec]> = [
    ['validate-dataset-references', DATASET_FIELD_UNKNOWN, validateDatasetReferences, (f) => ({ datasets: [dataset(f)] })],
    ['validate-report-runtime-filter', REPORT_FILTER_FIELD_UNKNOWN, validateReportRuntimeFilters, (f) => ({
      datasets: [dataset('name')],
      reports: [{ name: 'r', label: 'R', type: 'summary', dataset: 'deals', values: ['n'], rows: ['d'], runtimeFilter: { [f]: 'x' } }],
    })],
    ['validate-widget-bindings', WIDGET_FILTER_FIELD_UNKNOWN, validateWidgetBindings, (f) => widget({ [f]: 'x' })],
    ['validate-list-view-field-refs', LIST_VIEW_FIELD_UNKNOWN, validateListViewFieldRefs, (f) => ({
      views: [{ name: 'v', object: 'xs_deal', list: { type: 'grid', columns: ['name', f] } }],
    })],
    ['validate-object-field-refs', OBJECT_FIELD_REF_UNKNOWN, validateObjectFieldRefs, (f) => ({
      objects: [{ ...deal, highlightFields: ['name', f] }, account, note],
    })],
    ['validate-page-field-bindings', PAGE_FIELD_UNKNOWN, validatePageFieldBindings, (f) => ({
      pages: [{
        name: 'p', object: 'xs_deal',
        regions: [{ name: 'main', components: [{ type: 'record:highlights', properties: { fields: ['name', f] } }] }],
      }],
    })],
    ['validate-rls-predicate-enforceability', RLS_PREDICATE_UNKNOWN_FIELD, validateRlsPredicateEnforceability, (f) => ({
      permissions: [{ name: 's', label: 'S', rowLevelSecurity: [{ name: 'p', object: 'xs_deal', operation: 'select', using: `record.${f} == 'x'` }] }],
    })],
    ['validate-thank-you-record-fields', THANK_YOU_RECORD_FIELD, validateThankYouRecordFields, (f) => ({
      views: [{
        name: 'vv',
        form: {
          type: 'simple', data: { provider: 'object', object: 'xs_deal' }, sections: [{ name: 'a', fields: ['name'] }],
          submitBehavior: { kind: 'thank-you', title: 'T', message: `Ref {{record.${f}}}` },
        },
      }],
    })],
    ['validate-mapping-target-fields', MAPPING_TARGET_FIELD_UNKNOWN, validateMappingTargetFields, (f) => ({
      mappings: [{ name: 'm', targetObject: 'xs_deal', fieldMapping: [{ source: 'R', target: f }] }],
    })],
  ];
  // The per-package leg of `os build` (`packageBodyAsStack` in the cli): the
  // app body is the stack, its own collections at the top level and under
  // `manifest`, and the artifact's `packages[]` beside them.
  const perPackage = (extra: Rec, objectExtensions: unknown[] = extensions): Rec => {
    const body = { id: 'app', objects: [deal, account, note], ...extra };
    return { ...body, manifest: body, packages: [{ manifest: body }, { manifest: { id: 'mod', objectExtensions } }] };
  };
  it.each(existence)('%s: an extension-added field passes; a field nothing adds is still %s', (_rule, id, run, naming) => {
    // `ref_no` (an autonumber) is the one name every member admits, the
    // thank-you panel included.
    expect(ids(run, artifact(naming('ref_no')))).not.toContain(id);
    expect(ids(run, artifact(naming('ref_no'), []))).toContain(id);
    expect(ids(run, artifact(naming('nowhere')))).toContain(id);
  });

  it.each(existence)('%s, on the per-package leg: the same verdicts', (_rule, id, run, naming) => {
    expect(ids(run, perPackage(naming('ref_no')))).not.toContain(id);
    expect(ids(run, perPackage(naming('ref_no'), []))).toContain(id);
    expect(ids(run, perPackage(naming('nowhere')))).toContain(id);
  });

  it.each(existence)('%s: a field nothing adds is refused byte-for-byte as on the declared objects alone', (_rule, id, run, naming) => {
    const refusal = (stack: Rec) => run(stack)
      .filter((f) => f.rule === id)
      .map((f) => { const { severity, where, path, message } = f as Rec; return { severity, where, path, message }; });
    const served = refusal(artifact(naming('zq_absent')));
    expect(served).toHaveLength(1);
    expect(served).toEqual(refusal(artifact(naming('zq_absent'), [])));
  });

  it('validate-dataset-references: a path through an extension-added relationship resolves', () => {
    expect(ids(validateDatasetReferences, artifact({ datasets: [dataset('partner.tier')] }))).toEqual([]);
    expect(ids(validateDatasetReferences, artifact({ datasets: [dataset('partner.nowhere')] }))).toEqual([DATASET_FIELD_UNKNOWN]);
  });

  // The type arms judge an extension-added field on its served definition,
  // as they judge a declared one; a name nothing adds stays the existence
  // rules' finding, not theirs.
  it('validate-dataset-measure-aggregates: SUM over an extension-added field is judged on its served type', () => {
    const sum = (field: string) => ({ datasets: [{ name: 'deals', object: 'xs_deal', measures: [{ name: 's', aggregate: 'sum', field }] }] });
    expect(ids(validateDatasetMeasureAggregates, artifact(sum('score')))).toEqual([]);
    expect(ids(validateDatasetMeasureAggregates, artifact(sum('region')))).toEqual([MEASURE_AGGREGATE_FIELD_TYPE_REFUSED]);
    expect(ids(validateDatasetMeasureAggregates, artifact(sum('nowhere')))).toEqual([]);
  });

  it('validate-preset-comparands: a preset compared with an extension-added date field is judged as on a declared one', () => {
    expect(ids(validatePresetComparands, artifact(widget({ closed_on: 'last_30_days' })))).toEqual([FILTER_PRESET_COMPARAND]);
    expect(ids(validatePresetComparands, artifact(widget({ region: 'last_30_days' })))).toEqual([]);
  });

  it('validate-sharing-rule-enforceability: a criterion on an extension-added field is judged on its served type', () => {
    const rule = (condition: string) => ({ sharingRules: [{ name: 'sr', object: 'xs_deal', condition, sharedWith: { type: 'role', value: 'r' }, accessLevel: 'read' }] });
    expect(ids(validateSharingRuleEnforceability, artifact(rule('record.region == record.name')))).toEqual([]);
    expect(ids(validateSharingRuleEnforceability, artifact(rule('record.closed_on == record.name')))).toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
  });

  it('validate-field-consumers: a dataset path through an extension-added lookup credits the field it reaches', () => {
    const tierFindings = (stack: Rec) =>
      validateFieldConsumers(stack).filter((f) => f.object === 'xs_account' && f.field === 'tier').map((f) => f.rule);
    expect(tierFindings(artifact({ datasets: [dataset('partner.tier')] }))).toEqual([]);
    expect(tierFindings(artifact({ datasets: [dataset('name')] }))).toEqual([FIELD_NO_CONSUMERS]);
    // Extension-added fields are still not judged themselves (the header).
    expect(validateFieldConsumers(artifact({ datasets: [dataset('name')] })).filter((f) => f.field in added)).toEqual([]);
  });

  it('validate-related-list-refs, on the per-package leg: a child another body owns stays unjudged', () => {
    // `lib` owns `xs_note` and its FK; `mod` extends `xs_note` with something
    // else. The app body's leg holds neither declaration, so it must not read
    // `mod`'s extension as `xs_note`'s whole field set.
    const body = { id: 'app', objects: [{ ...deal, relatedLists: ['xs_note', 'xs_note.deal_id'] }, account] };
    const lib = { id: 'lib', objects: [{ name: 'xs_note', fields: { deal_id: { type: 'lookup', reference: 'xs_deal' } } }] };
    const mod = { id: 'mod', objectExtensions: [{ extend: 'xs_note', fields: { mood: { type: 'text' } } }] };
    const stack = { ...body, manifest: body, packages: [{ manifest: body }, { manifest: lib }, { manifest: mod }] };
    expect(ids(validateRelatedListRefs, stack)).toEqual([]);
  });

  it('validate-related-list-refs: an FK a sibling package adds is an inbound relationship', () => {
    const lists = (relatedLists: string[]) => ({ objects: [{ ...deal, relatedLists }, account, note] });
    expect(ids(validateRelatedListRefs, artifact(lists(['xs_note', 'xs_note.deal_id'])))).toEqual([]);
    expect(ids(validateRelatedListRefs, artifact(lists(['xs_note']), []))).toEqual([RELATED_LIST_REF_UNKNOWN]);
    expect(ids(validateRelatedListRefs, artifact(lists(['xs_note.nowhere'])))).toEqual([RELATED_LIST_REF_UNKNOWN]);
  });

  // The two retired private readers folded every entry additively; the shared
  // fold keeps the registry's one entry per package per target, so a later
  // entry of the same package replaces an earlier one whole.
  it('both retired readers now keep one entry per package per target, as the registry does', () => {
    const replaced = [
      { extend: 'xs_note', fields: { deal_id: { type: 'lookup', reference: 'xs_deal' } } },
      { extend: 'xs_note', fields: { body_html: { type: 'html' } } },
      { extend: 'xs_deal', fields: { region: { type: 'text' } } },
      { extend: 'xs_deal', fields: { score: { type: 'number' } } },
    ];
    const lists = { objects: [{ ...deal, relatedLists: ['xs_note'] }, account, note] };
    expect(ids(validateRelatedListRefs, artifact(lists, replaced))).toEqual([RELATED_LIST_REF_UNKNOWN]);
    const mapping = (target: string) => ({ mappings: [{ name: 'm', targetObject: 'xs_deal', fieldMapping: [{ source: 'R', target }] }] });
    expect(ids(validateMappingTargetFields, artifact(mapping('score'), replaced))).toEqual([]);
    expect(ids(validateMappingTargetFields, artifact(mapping('region'), replaced))).toEqual([MAPPING_TARGET_FIELD_UNKNOWN]);
  });

  // Two packages writing one field at the deciding priority: the name is
  // served, but which definition wins is registration order, which the stack
  // does not state. The type arms leave it unjudged; the thank-you panel,
  // shown to anonymous visitors, fails closed.
  describe('a field two packages tie on', () => {
    const tie = (a: Rec, b: Rec): Rec => ({
      objects: [deal, account, note],
      packages: [
        { manifest: { id: 'app', objects: [deal, account, note] } },
        { manifest: { id: 'mod', objectExtensions: [{ extend: 'xs_deal', fields: a }] } },
        { manifest: { id: 'mod2', objectExtensions: [{ extend: 'xs_deal', fields: b }] } },
      ],
    });
    // The fold keeps the LAST writer at a tied priority, so each pair below
    // lists the definition a type arm would refuse last: an arm that read the
    // kept definition instead of dropping the tie goes red.
    const numberOrText = (extra: Rec) => ({ ...tie({ score: { type: 'number' } }, { score: { type: 'text' } }), ...extra });
    const textOrDate = (extra: Rec) => ({ ...tie({ closed_on: { type: 'text' } }, { closed_on: { type: 'date' } }), ...extra });
    const numberOrPercent = (extra: Rec) => ({ ...tie({ score: { type: 'number' } }, { score: { type: 'percent' } }), ...extra });
    const stage = (values: string[]) => ({ stage: { type: 'select', options: values.map((value) => ({ value, label: value })) } });
    const abOrAc = (extra: Rec) => ({ ...tie(stage(['a', 'b']), stage(['a', 'c'])), ...extra });

    it('is still a served name for the existence rules', () => {
      expect(ids(validateDatasetReferences, numberOrText({ datasets: [{ ...dataset('score'), include: [] }] }))).toEqual([]);
      expect(ids(validateDatasetReferences, numberOrText({ datasets: [{ ...dataset('zq_absent'), include: [] }] }))).toEqual([DATASET_FIELD_UNKNOWN]);
    });

    it('is not judged on its type by measure aggregates', () => {
      const sum = { datasets: [{ name: 'deals', object: 'xs_deal', measures: [{ name: 's', aggregate: 'sum', field: 'score' }] }] };
      expect(ids(validateDatasetMeasureAggregates, numberOrText(sum))).toEqual([]);
      expect(ids(validateDatasetMeasureAggregates, { ...tie({ score: { type: 'text' } }, {}), ...sum }))
        .toEqual([MEASURE_AGGREGATE_FIELD_TYPE_REFUSED]);
    });

    it('is not judged on its type by preset comparands', () => {
      const preset = widget({ closed_on: 'last_30_days' });
      expect(ids(validatePresetComparands, textOrDate(preset))).toEqual([]);
      expect(ids(validatePresetComparands, { ...tie({ closed_on: { type: 'date' } }, {}), ...preset })).toEqual([FILTER_PRESET_COMPARAND]);
    });

    it('is not judged on its type by sharing-rule criteria', () => {
      const rule = { sharingRules: [{ name: 'sr', object: 'xs_deal', condition: 'record.closed_on == record.name', sharedWith: { type: 'role', value: 'r' }, accessLevel: 'read' }] };
      expect(ids(validateSharingRuleEnforceability, textOrDate(rule))).toEqual([]);
      expect(ids(validateSharingRuleEnforceability, { ...tie({ closed_on: { type: 'date' } }, {}), ...rule }))
        .toEqual([SHARING_RULE_UNLOWERABLE_CONDITION]);
    });

    it('is not judged on its type by the widget field-type map', () => {
      const sum = { datasets: [{ name: 'deals', object: 'xs_deal', measures: [{ name: 's', aggregate: 'sum', field: 'score' }] }] };
      expect(ids(validateWidgetBindings, numberOrPercent(sum))).toEqual([]);
      expect(ids(validateWidgetBindings, { ...tie({ score: { type: 'percent' } }, {}), ...sum })).toEqual([MEASURE_AGGREGATE_INCOHERENT]);
    });

    it('lends no options to a kanban lane check', () => {
      const lanes = {
        views: [{ name: 'v', object: 'xs_deal', list: { type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'], lanes: ['b'] } } }],
      };
      expect(ids(validateListViewFieldRefs, abOrAc(lanes))).toEqual([]);
      expect(ids(validateListViewFieldRefs, { ...tie(stage(['a', 'c']), {}), ...lanes })).toEqual([LIST_VIEW_KANBAN_LANE_UNKNOWN]);
    });

    it('is admitted on a thank-you panel only when every tied definition is engine-generated', () => {
      const panel = (stack: Rec) => ({
        ...stack,
        views: [{
          name: 'vv',
          form: {
            type: 'simple', data: { provider: 'object', object: 'xs_deal' }, sections: [{ name: 'a', fields: ['name'] }],
            submitBehavior: { kind: 'thank-you', title: 'T', message: 'Ref {{record.ref_no}}' },
          },
        }],
      });
      expect(ids(validateThankYouRecordFields, panel(tie({ ref_no: { type: 'autonumber' } }, { ref_no: { type: 'autonumber' } })))).toEqual([]);
      for (const [a, b] of [['autonumber', 'text'], ['text', 'autonumber']]) {
        const findings = validateThankYouRecordFields(panel(tie({ ref_no: { type: a } }, { ref_no: { type: b } })));
        expect(findings.map((f) => f.rule)).toEqual([THANK_YOU_RECORD_FIELD]);
        expect(findings[0].message).toContain('is a text field');
      }
    });
  });
});

// [#30471] The field-NAME indexes outside the graph read the same fold: the
// `record.FIELD` index of the expression passes (validations, formulas, flows,
// hooks, sharing-rule conditions), the write rules' index (flow nodes, action
// and hook bodies), a react page's field props and the translation universe.
// The #30383 artifact, plus one extension rule for the translation rung.
describe('[#30471] the field-name indexes read the objects as served', () => {
  type Rec = Record<string, unknown>;
  type Finding = { rule: string; severity?: unknown; where?: unknown; path?: unknown; message?: unknown };
  type Run = (stack: Rec) => ReadonlyArray<Finding>;
  const deal = { name: 'xs_deal', label: 'Deal', fields: { name: { type: 'text' }, amount: { type: 'number' } } };
  const account = { name: 'xs_account', label: 'Account', fields: { name: { type: 'text' } } };
  const added = { region: { type: 'text' }, score: { type: 'number' } };
  const extensions = [{
    extend: 'xs_deal',
    fields: added,
    validations: [{ name: 'region_set', type: 'script', condition: 'record.region == null', message: 'Set a region' }],
  }];
  const artifact = (extra: Rec, objectExtensions: unknown[] = extensions, objects: unknown[] = [deal, account]): Rec => ({
    objects,
    packages: [
      { manifest: { id: 'app', objects } },
      { manifest: { id: 'mod', objectExtensions } },
    ],
    ...extra,
  });
  // The per-package leg of `os build` (`packageBodyAsStack` in the cli).
  const perPackage = (extra: Rec, objectExtensions: unknown[] = extensions): Rec => {
    const body = { id: 'app', objects: [deal, account], ...extra };
    return { ...body, manifest: body, packages: [{ manifest: body }, { manifest: { id: 'mod', objectExtensions } }] };
  };
  const ids = (run: Run, stack: Rec) => run(stack).map((f) => f.rule);
  // The expression passes carry no rule id: every issue they raise on these
  // stacks is about the one expression each names, read as `expression`.
  const expressions: Run = (stack) => validateStackExpressions(stack).map((issue) => ({ ...issue, rule: 'expression' }));
  const validationOn = (condition: string): Rec => ({
    objects: [{ ...deal, validations: [{ name: 'v', type: 'script', condition, message: 'M' }] }, account],
  });
  const pageSort = (field: string): Rec => ({
    pages: [{ name: 'p', type: 'list', object: 'xs_deal', interfaceConfig: { source: 'xs_deal', sort: [{ field, order: 'asc' }] } }],
  });
  const viewSort = (field: string): Rec => ({
    views: [{ name: 'v', objectName: 'xs_deal', list: { type: 'grid', columns: ['name'], sort: [{ field, order: 'asc' }] } }],
  });

  // rule · its unknown-field id · the stack naming FIELD
  const existence: Array<[string, string, Run, (field: string) => Rec]> = [
    ['validate-expressions (a validation condition)', 'expression', expressions, (f) => validationOn(`record.${f} == 'x'`)],
    ['validate-expressions (a sharing-rule condition)', 'expression', expressions, (f) => ({
      sharingRules: [{ name: 'sr', object: 'xs_deal', condition: `record.${f} == 'x'`, sharedWith: { type: 'role', value: 'r' }, accessLevel: 'read' }],
    })],
    ['validate-flow-node-writes', FLOW_NODE_WRITE_UNKNOWN_FIELD, validateFlowNodeWrites, (f) => ({
      flows: [{ name: 'fl', nodes: [{ id: 'n', type: 'update_record', config: { objectName: 'xs_deal', fields: { [f]: 'x' } } }] }],
    })],
    ['validate-action-body-writes', ACTION_BODY_WRITE_UNKNOWN_FIELD, validateActionBodyWrites, (f) => ({
      actions: [{ name: 'act', label: 'Act', body: { language: 'js', source: `await ctx.api.object('xs_deal').updateById(id, { ${f}: 'x' });` } }],
    })],
    ['validate-hook-body-writes', HOOK_BODY_WRITE_UNKNOWN_FIELD, (stack) => validateHookBodyWrites(stack), (f) => ({
      hooks: [{ name: 'h', object: 'xs_deal', events: ['beforeInsert'], body: { language: 'js', source: `ctx.input.${f} = 'x';` } }],
    })],
    ['validate-react-page-props', PAGE_FIELD_UNKNOWN, validateReactPageProps, (f) => ({
      pages: [{
        name: 'p', kind: 'react',
        source: `function Page(){ return <ListView data={{ provider: 'object', object: 'xs_deal' }} columns={['name', '${f}']} />; }`,
      }],
    })],
    ['validate-translation-references', TRANSLATION_TARGET_UNKNOWN, validateTranslationReferences, (f) => ({
      translations: [{ 'zh-CN': { objects: { xs_deal: { fields: { [f]: { label: 'L' } } } } } }],
    })],
    ['validate-sortable-fields (a page sort)', PAGE_FIELD_UNKNOWN, validateSortableFields, (f) => pageSort(f)],
    ['validate-sortable-fields (a list-view sort)', SORT_FIELD_UNKNOWN, validateSortableFields, (f) => viewSort(f)],
  ];

  it.each(existence)('%s: an extension-added field passes; a field nothing adds is still refused', (_rule, id, run, naming) => {
    expect(ids(run, artifact(naming('region')))).not.toContain(id);
    expect(ids(run, artifact(naming('region'), []))).toContain(id);
    expect(ids(run, artifact(naming('nowhere')))).toContain(id);
  });

  it.each(existence)('%s, on the per-package leg: the same verdicts', (_rule, id, run, naming) => {
    expect(ids(run, perPackage(naming('region')))).not.toContain(id);
    expect(ids(run, perPackage(naming('region'), []))).toContain(id);
    expect(ids(run, perPackage(naming('nowhere')))).toContain(id);
  });

  it.each(existence)('%s: a field nothing adds is refused byte-for-byte as on the declared objects alone', (_rule, id, run, naming) => {
    const refusal = (stack: Rec) => run(stack)
      .filter((f) => f.rule === id)
      .map(({ severity, where, path, message }) => ({ severity, where, path, message }));
    const served = refusal(artifact(naming('zq_absent')));
    expect(served).toHaveLength(1);
    expect(served).toEqual(refusal(artifact(naming('zq_absent'), [])));
  });

  it('validate-translation-references: a `_validations` key for a rule an extension adds resolves', () => {
    const bundle = (rule: string) => ({ translations: [{ 'zh-CN': { objects: { xs_deal: { _validations: { [rule]: { message: 'M' } } } } } }] });
    expect(ids(validateTranslationReferences, artifact(bundle('region_set')))).toEqual([]);
    expect(ids(validateTranslationReferences, artifact(bundle('region_set'), []))).toEqual([TRANSLATION_TARGET_UNKNOWN]);
    expect(ids(validateTranslationReferences, artifact(bundle('nowhere')))).toEqual([TRANSLATION_TARGET_UNKNOWN]);
  });

  // The retired private reader kept every entry; the fold keeps one per
  // package per target, so a later entry of the same package replaces an
  // earlier one whole, its rules with its fields.
  it('validate-translation-references: a key only a replaced entry adds is an orphan, as the registry serves it', () => {
    const replaced = [...extensions, { extend: 'xs_deal', fields: { mood: { type: 'text' } } }];
    const keys = (fields: Rec, rules: Rec = {}) => ({ translations: [{ 'zh-CN': { objects: { xs_deal: { fields, _validations: rules } } } }] });
    expect(ids(validateTranslationReferences, artifact(keys({ mood: { label: 'M' } }), replaced))).toEqual([]);
    expect(ids(validateTranslationReferences, artifact(keys({ region: { label: 'R' } }), replaced))).toEqual([TRANSLATION_TARGET_UNKNOWN]);
    expect(ids(validateTranslationReferences, artifact(keys({}, { region_set: { message: 'M' } }), replaced))).toEqual([TRANSLATION_TARGET_UNKNOWN]);
  });

  // The two refusals the retired private reader did not raise, both at
  // `error`: it kept every entry, and read a top-level `objectExtensions`
  // beside `packages[]` too. The fold keeps one entry per package per target
  // and reads `packages[]` alone when there is one, as the registry does.
  it('validate-translation-references: the keys only the fold drops are refused at error', () => {
    const bundle = { translations: [{ 'zh-CN': { objects: { xs_deal: { fields: { region: { label: 'R' } }, _validations: { region_set: { message: 'M' } } } } } }] };
    const refused = [[TRANSLATION_TARGET_UNKNOWN, 'error'], [TRANSLATION_TARGET_UNKNOWN, 'error']];
    const verdicts = (stack: Rec) => validateTranslationReferences(stack).map((f) => [f.rule, f.severity]);
    const replaced = [...extensions, { extend: 'xs_deal', fields: { mood: { type: 'text' } } }];
    expect(verdicts(artifact(bundle, replaced))).toEqual(refused);
    expect(verdicts(perPackage(bundle, replaced))).toEqual(refused);
    const beside = { objects: [deal, account], objectExtensions: extensions, packages: [{ manifest: { id: 'app', objects: [deal, account] } }], ...bundle };
    expect(verdicts(beside)).toEqual(refused);
    // With no `packages[]`, the top level is the artifact's own and is read.
    const { packages: _packages, ...alone } = beside;
    expect(verdicts(alone)).toEqual([]);
  });

  // The write rules leave an object that declares no field unjudged (an
  // external, introspected schema): an extension adding to it does not make
  // its other fields knowable.
  it('the write rules keep an object that declares no field unjudged, extended or not', () => {
    const bare = { name: 'xs_deal', label: 'Deal', fields: {} };
    const write = { flows: [{ name: 'fl', nodes: [{ id: 'n', type: 'update_record', config: { objectName: 'xs_deal', fields: { remote_col: 'x' } } }] }] };
    expect(ids(validateFlowNodeWrites, artifact(write, extensions, [bare, account]))).toEqual([]);
    expect(ids(validateFlowNodeWrites, artifact(write, [], [bare, account]))).toEqual([]);
  });

  // A field two packages write at the deciding priority: its name is served,
  // its definition is registration order. The two definition questions of the
  // expression passes (its type, whether it is nullable) leave it unjudged;
  // the single-writer controls show both verdicts the tie would otherwise get.
  it('validate-expressions: a field two packages tie on is a served name, judged on no definition', () => {
    const tie = (a: Rec, b: Rec): Rec => ({
      ...validationOn('record.score + 1 > 2'),
      packages: [
        { manifest: { id: 'app', objects: [deal, account] } },
        { manifest: { id: 'mod', objectExtensions: [{ extend: 'xs_deal', fields: a }] } },
        { manifest: { id: 'mod2', objectExtensions: [{ extend: 'xs_deal', fields: b }] } },
      ],
    });
    const messages = (a: Rec, b: Rec) => validateStackExpressions(tie(a, b)).map((issue) => issue.message);
    const num = { score: { type: 'number' } };
    const text = { score: { type: 'text' } };
    expect(messages(num, text)).toEqual([]);
    expect(messages(text, num)).toEqual([]);
    expect(messages(text, {})).toEqual([expect.stringContaining('type mismatch'), expect.stringContaining('nullable')]);
    expect(messages(num, {})).toEqual([expect.stringContaining('nullable')]);
  });

  it('validate-expressions, on the per-package leg: a tied field is judged on no definition either', () => {
    const body = { id: 'app', objects: [{ ...deal, validations: [{ name: 'v', type: 'script', condition: 'record.score + 1 > 2', message: 'M' }] }, account] };
    const tie = (a: Rec, b: Rec): Rec => ({
      ...body,
      manifest: body,
      packages: [
        { manifest: body },
        { manifest: { id: 'mod', objectExtensions: [{ extend: 'xs_deal', fields: a }] } },
        { manifest: { id: 'mod2', objectExtensions: [{ extend: 'xs_deal', fields: b }] } },
      ],
    });
    const messages = (a: Rec, b: Rec) => validateStackExpressions(tie(a, b)).map((issue) => issue.message);
    const num = { score: { type: 'number' } };
    const text = { score: { type: 'text' } };
    expect(messages(num, text)).toEqual([]);
    expect(messages(text, num)).toEqual([]);
    expect(messages(text, {})).toEqual([expect.stringContaining('type mismatch'), expect.stringContaining('nullable')]);
  });

  // The readonly write rules judge an extension field's `readonly` /
  // `readonlyWhen` as a declared field's: without that, moving the existence
  // index above would have left such a write silent where `main` at least
  // refused the name. Readonly is the field's definition, so a tie is unjudged.
  describe('the readonly write rules read the served definition', () => {
    const lock = { locked: { type: 'text', readonly: true } };
    const gate = { gated: { type: 'number', readonlyWhen: "record.name == 'x'" } };
    // rule · its readonly id · the extension fields it needs · the stack writing them
    const readonly: Array<[string, string, Run, Rec, Rec]> = [
      ['validate-readonly-flow-writes', FLOW_UPDATE_READONLY_FIELD, validateReadonlyFlowWrites, lock, {
        flows: [{ name: 'fl', nodes: [{ id: 'n', type: 'update_record', config: { objectName: 'xs_deal', fields: { locked: 'x' } } }] }],
      }],
      ['validate-readonly-hook-writes', HOOK_API_UPDATE_READONLY_FIELD, (stack) => validateReadonlyHookWrites(stack), lock, {
        hooks: [{ name: 'h', object: 'xs_account', events: ['afterInsert'], body: { language: 'js', source: "await ctx.api.object('xs_deal').update({ id: dealId, locked: 'x' });" } }],
      }],
      ['validate-readonly-action-writes', ACTION_API_UPDATE_READONLY_WHEN_FIELD, validateReadonlyActionWrites, gate, {
        actions: [{ name: 'act', label: 'Act', objectName: 'xs_deal', body: { language: 'js', source: "await ctx.api.object('xs_deal').update({ id: ctx.recordId, gated: 1 });" } }],
      }],
    ];
    const plain = { locked: { type: 'text' }, gated: { type: 'number' } };
    const ext = (fields: Rec) => [{ extend: 'xs_deal', fields }];
    const tie = (a: Rec, b: Rec, extra: Rec, perPackageLeg = false): Rec => {
      const mods = [
        { manifest: { id: 'mod', objectExtensions: ext(a) } },
        { manifest: { id: 'mod2', objectExtensions: ext(b) } },
      ];
      if (!perPackageLeg) return { objects: [deal, account], packages: [{ manifest: { id: 'app', objects: [deal, account] } }, ...mods], ...extra };
      const body = { id: 'app', objects: [deal, account], ...extra };
      return { ...body, manifest: body, packages: [{ manifest: body }, ...mods] };
    };

    it.each(readonly)('%s: an extension field declared readonly is refused with the readonly id', (_rule, id, run, fields, writing) => {
      expect(ids(run, artifact(writing, ext(fields)))).toEqual([id]);
      expect(ids(run, perPackage(writing, ext(fields)))).toEqual([id]);
      // The same name added writable, or not added at all, is not this rule's.
      expect(ids(run, artifact(writing, ext(plain)))).toEqual([]);
      expect(ids(run, artifact(writing, []))).toEqual([]);
    });

    it.each(readonly)('%s: a field two packages tie on, one of them readonly, is unjudged', (_rule, id, run, fields, writing) => {
      for (const perPackageLeg of [false, true]) {
        expect(ids(run, tie(plain, fields, writing, perPackageLeg))).toEqual([]);
        expect(ids(run, tie(fields, plain, writing, perPackageLeg))).toEqual([]);
        expect(ids(run, tie(fields, {}, writing, perPackageLeg))).toEqual([id]);
      }
    });
  });

  // [#30608] A react page's `searchableFields` reads the served search index
  // (`indexServedSearchTargets`), as the metadata rule does: the override it
  // sends reaches the ingress gate, which resolves it against the registry's
  // merged object. So a field an extension adds passes, and one nothing adds
  // is still refused.
  it('validate-react-page-props: searchableFields reads the objects as served', () => {
    const search = (field: string) => ({
      pages: [{
        name: 'p', kind: 'react',
        source: `function Page(){ return <ListView data={{ provider: 'object', object: 'xs_deal' }} columns={['name']} searchableFields={['name', '${field}']} />; }`,
      }],
    });
    expect(ids(validateReactPageProps, artifact(search('region')))).toEqual([]);
    expect(ids(validateReactPageProps, artifact(search('region'), []))).toEqual([SEARCHABLE_FIELD_UNKNOWN]);
    expect(ids(validateReactPageProps, artifact(search('nowhere')))).toEqual([SEARCHABLE_FIELD_UNKNOWN]);
    expect(ids(validateReactPageProps, artifact(search('name')))).toEqual([]);
  });

  // Every refusal this change adds, one row each: a write or a sort naming an
  // extension field whose served definition the runtime refuses or drops. On
  // the declared objects alone (what `main` read) the same stack was the
  // existence rule's unknown name; now the existence rule passes it and the
  // definition rule owns it, at that rule's own severity. The hook rows are
  // the one severity move: `hook-body-write-unknown-field` was a warning.
  describe('each refusal this change adds is the definition rule\'s, at its own severity', () => {
    const lock = { locked: { type: 'text', readonly: true } };
    const gate = { gated: { type: 'number', readonlyWhen: "record.name == 'x'" } };
    const calc = { calc: { type: 'formula', expression: 'record.amount * 2' } };
    const flowNode = (type: string, field: string): Rec => ({
      flows: [{ name: 'fl', nodes: [{ id: 'n', type, config: { objectName: 'xs_deal', fields: { [field]: 'x' } } }] }],
    });
    const hookApi = (call: string): Rec => ({
      hooks: [{ name: 'h', object: 'xs_account', events: ['afterInsert'], body: { language: 'js', source: `await ctx.api.object('xs_deal').${call};` } }],
    });
    const actionApi = (field: string): Rec => ({
      actions: [{ name: 'act', label: 'Act', objectName: 'xs_deal', body: { language: 'js', source: `await ctx.api.object('xs_deal').update({ id: ctx.recordId, ${field}: 1 });` } }],
    });
    const hooks: Run = (stack) => validateReadonlyHookWrites(stack);
    const hookExistence: Run = (stack) => validateHookBodyWrites(stack);
    // the write · the rule judging it now · the extension fields · the stack ·
    // its id and severity now · the existence rule and the id it raised before
    const refusals: Array<[string, Run, Rec, Rec, string, string, Run, string]> = [
      ['a flow update_record of a readonly field', validateReadonlyFlowWrites, lock, flowNode('update_record', 'locked'),
        FLOW_UPDATE_READONLY_FIELD, 'error', validateFlowNodeWrites, FLOW_NODE_WRITE_UNKNOWN_FIELD],
      ['a flow create_record of a readonly field', validateReadonlyFlowWrites, lock, flowNode('create_record', 'locked'),
        FLOW_UPDATE_READONLY_FIELD, 'error', validateFlowNodeWrites, FLOW_NODE_WRITE_UNKNOWN_FIELD],
      ['a flow update_record of a readonlyWhen field', validateReadonlyFlowWrites, gate, flowNode('update_record', 'gated'),
        FLOW_UPDATE_READONLY_WHEN_FIELD, 'warning', validateFlowNodeWrites, FLOW_NODE_WRITE_UNKNOWN_FIELD],
      ['a hook ctx.api update of a readonly field', hooks, lock, hookApi("update({ id: dealId, locked: 'x' })"),
        HOOK_API_UPDATE_READONLY_FIELD, 'error', hookExistence, HOOK_BODY_WRITE_UNKNOWN_FIELD],
      ['a hook ctx.api insert of a readonly field', hooks, lock, hookApi("insert({ locked: 'x' })"),
        HOOK_API_UPDATE_READONLY_FIELD, 'error', hookExistence, HOOK_BODY_WRITE_UNKNOWN_FIELD],
      ['a hook ctx.api update of a readonlyWhen field', hooks, gate, hookApi('update({ id: dealId, gated: 1 })'),
        HOOK_API_UPDATE_READONLY_WHEN_FIELD, 'warning', hookExistence, HOOK_BODY_WRITE_UNKNOWN_FIELD],
      ['an action ctx.api update of a readonlyWhen field', validateReadonlyActionWrites, gate, actionApi('gated'),
        ACTION_API_UPDATE_READONLY_WHEN_FIELD, 'warning', validateActionBodyWrites, ACTION_BODY_WRITE_UNKNOWN_FIELD],
      ['a page sort by a formula field', validateSortableFields, calc, pageSort('calc'),
        SORT_FIELD_UNSORTABLE, 'error', validateSortableFields, PAGE_FIELD_UNKNOWN],
      ['a list-view sort by a formula field', validateSortableFields, calc, viewSort('calc'),
        SORT_FIELD_UNSORTABLE, 'error', validateSortableFields, SORT_FIELD_UNKNOWN],
    ];
    // The stack on both CLI legs (the union artifact, then the per-package
    // body), each extension list its own package.
    const onLegs = (extra: Rec, packages: unknown[][], objects: unknown[] = [deal, account]): Rec[] => {
      const mods = packages.map((objectExtensions, i) => ({ manifest: { id: `mod${i}`, objectExtensions } }));
      const body = { id: 'app', objects, ...extra };
      return [
        { objects, packages: [{ manifest: { id: 'app', objects } }, ...mods], ...extra },
        { ...body, manifest: body, packages: [{ manifest: body }, ...mods] },
      ];
    };
    const ext = (fields: Rec) => [{ extend: 'xs_deal', fields }];

    it.each(refusals)('%s', (_write, run, fields, stack, id, severity, existence, unknownId) => {
      for (const served of onLegs(stack, [ext(fields)])) {
        expect(run(served).map((f) => [f.rule, f.severity])).toEqual([[id, severity]]);
        expect(ids(existence, served)).not.toContain(unknownId);
      }
      for (const declared of onLegs(stack, [[]])) {
        expect(ids(existence, declared)).toContain(unknownId);
        expect(ids(run, declared)).not.toContain(id);
      }
    });

    it.each(refusals)('%s, on a field two packages tie on: unjudged', (_write, run, fields, stack, id) => {
      const plain = Object.fromEntries(Object.keys(fields).map((name) => [name, { type: 'text' }]));
      for (const [a, b] of [[plain, fields], [fields, plain]]) {
        for (const tied of onLegs(stack, [ext(a), ext(b)])) expect(ids(run, tied)).not.toContain(id);
      }
      for (const single of onLegs(stack, [ext(fields), ext({})])) expect(ids(run, single)).toContain(id);
    });

    // An object that declares no field (an introspected schema) is left
    // unjudged by the write rules and skip 2 of the sort rule; an extension
    // adding to it does not make it judgeable by the definition rules either.
    it.each(refusals)('%s, on an object that declares no field: unjudged, extended or not', (_write, run, fields, stack) => {
      const bare = { name: 'xs_deal', label: 'Deal', fields: {} };
      for (const packages of [[ext(fields)], [[]]]) {
        for (const s of onLegs(stack, packages, [bare, account])) expect(ids(run, s)).toEqual([]);
      }
    });

    // An extension that RE-DECLARES an owner's field replaces it whole, in the
    // fold as in the registry's `mergeObjectDefinitions`
    // (`{ ...base.fields, ...extension.fields }`), so the owner's field is
    // judged on the extension's definition. On the declared objects alone (what
    // `main` read) the owner's `amount: number` is known, sortable and writable,
    // and nothing is raised. ADR-0146 D10 refuses this shape on the extension;
    // no CLI door does.
    it.each<[string, Run, Rec, Rec, string]>([
      ['a list-view sort by an owner field re-declared as formula', validateSortableFields,
        { amount: { type: 'formula', expression: 'record.name' } }, viewSort('amount'), SORT_FIELD_UNSORTABLE],
      ['a flow update_record of an owner field re-declared readonly', validateReadonlyFlowWrites,
        { amount: { type: 'number', readonly: true } }, flowNode('update_record', 'amount'), FLOW_UPDATE_READONLY_FIELD],
    ])('%s: judged on the extension\'s definition', (_write, run, fields, stack, id) => {
      for (const served of onLegs(stack, [ext(fields)])) {
        expect(run(served).map((f) => [f.rule, f.severity])).toEqual([[id, 'error']]);
      }
      for (const declared of onLegs(stack, [[]])) expect(run(declared)).toEqual([]);
    });
  });
});

// [#30608] The seven field indexes #30471 left on the declared objects, and the
// list-view rule's declares-nothing skip, read the same fold. Each site: an
// extension-added field is no longer refused where the runtime serves it; an
// extension's re-declared field is judged on the extension's definition; a
// field two packages tie on is a served name judged on no definition; an
// object that declares no field stays unjudged where `main` skipped it,
// extended or not. Every stack runs on both CLI legs (the union artifact, then
// the per-package body), each extension list its own package.
describe('[#30608] the remaining field indexes read the objects as served', () => {
  type Rec = Record<string, unknown>;
  type Finding = { rule: string; severity?: unknown; where?: unknown; path?: unknown; message?: unknown };
  type Run = (stack: Rec) => ReadonlyArray<Finding>;
  const deal = (fields: Rec = {}, more: Rec = {}): Rec =>
    ({ name: 'xs_deal', label: 'Deal', fields: { name: { type: 'text' }, ...fields }, ...more });
  const bare = { name: 'xs_deal', label: 'Deal', fields: {} };
  const account = { name: 'xs_account', label: 'Account', fields: { name: { type: 'text' } } };
  const ext = (fields: Rec) => [{ extend: 'xs_deal', fields }];
  const onLegs = (extra: Rec, packages: unknown[][], objects: unknown[] = [deal(), account]): Rec[] => {
    const mods = packages.map((objectExtensions, i) => ({ manifest: { id: `mod${i}`, objectExtensions } }));
    const body = { id: 'app', objects, ...extra };
    return [
      { objects, packages: [{ manifest: { id: 'app', objects } }, ...mods], ...extra },
      { ...body, manifest: body, packages: [{ manifest: body }, ...mods] },
    ];
  };
  const verdicts = (run: Run, stack: Rec) => run(stack).map((f) => [f.rule, f.severity]);

  const form = (field: string, sharing?: Rec): Rec => ({
    views: [{
      name: 'vf',
      form: {
        type: 'simple', data: { provider: 'object', object: 'xs_deal' }, sections: [{ name: 's', fields: ['name', field] }],
        ...(sharing ? { sharing } : {}),
      },
    }],
  });
  const publicForm = (field: string) => form(field, { enabled: true, allowAnonymous: true, publicLink: 'intake' });
  const notify = (field: string): Rec => ({
    flows: [{
      name: 'fl',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'record-created', objectName: 'xs_deal' } },
        { id: 'n', type: 'notify', config: { recipients: { emailField: field }, title: 'T', message: 'M' } },
      ],
    }],
  });
  const template = (hole: string): Rec => ({
    flows: [{
      name: 'ft',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'record-created', objectName: 'xs_deal' } },
        { id: 'n', type: 'notify', config: { recipients: { users: ['u'] }, title: 'T', message: `Hi {{ ${hole} }}` } },
      ],
    }],
  });
  const gallery: Rec = {
    pages: [{ name: 'pg', type: 'list', object: 'xs_deal', interfaceConfig: { source: 'xs_deal', appearance: { allowedVisualizations: ['gallery'] } } }],
  };
  const listSearch = (field: string): Rec => ({
    views: [{ name: 'vs', objectName: 'xs_deal', list: { type: 'grid', columns: ['name'], searchableFields: ['name', field] } }],
  });
  const reactSearch = (field: string): Rec => ({
    pages: [{
      name: 'p', kind: 'react',
      source: `function Page(){ return <ListView data={{ provider: 'object', object: 'xs_deal' }} columns={['name']} searchableFields={['name', '${field}']} />; }`,
    }],
  });
  const autonumber = (format: string, more: Rec = {}) => [deal({ ref: { type: 'autonumber', autonumberFormat: format }, ...more }), account];
  const canonicalSearch = (field: string, more: Rec = {}) => [deal(more, { searchableFields: ['name', field] }), account];
  const autonumberRun: Run = (stack) => lintAutonumberFormats(stack);

  // rule · its unknown-field id · the stack naming FIELD · the objects · the extension fields adding FIELD
  const existence: Array<[string, string, Run, (field: string) => Rec, (field: string) => unknown[] | undefined, (field: string) => Rec]> = [
    ['validate-form-layout', FORM_FIELD_UNKNOWN, validateFormLayout, form, () => undefined, (f) => ({ [f]: { type: 'text' } })],
    ['validate-notify-email-field-recipients', NOTIFY_EMAIL_FIELD_UNKNOWN, validateNotifyEmailFieldRecipients, notify, () => undefined,
      (f) => ({ [f]: { type: 'email' } })],
    ['validate-flow-template-paths', FLOW_TEMPLATE_UNKNOWN_FIELD, validateFlowTemplatePaths, (f) => template(`record.${f}`), () => undefined,
      (f) => ({ [f]: { type: 'text' } })],
    ['validate-searchable-fields (an object\'s own set)', SEARCHABLE_FIELD_UNKNOWN, validateSearchableFields, () => ({}), (f) => canonicalSearch(f),
      (f) => ({ [f]: { type: 'text' } })],
    ['validate-searchable-fields (a list view\'s narrowing)', SEARCHABLE_FIELD_UNKNOWN, validateSearchableFields, listSearch, () => undefined,
      (f) => ({ [f]: { type: 'text', searchable: true } })],
    ['validate-react-page-props (searchableFields)', SEARCHABLE_FIELD_UNKNOWN, validateReactPageProps, reactSearch, () => undefined,
      (f) => ({ [f]: { type: 'text', searchable: true } })],
    ['lint-autonumber-formats', AUTONUMBER_UNKNOWN_FIELD, autonumberRun, () => ({}), (f) => autonumber(`{${f}}{000}`),
      (f) => ({ [f]: { type: 'text', required: true } })],
  ];

  it.each(existence)('%s: an extension-added field passes; with no extension, or a field nothing adds, it is refused', (_rule, id, run, naming, objects, adding) => {
    for (const s of onLegs(naming('region'), [ext(adding('region'))], objects('region'))) expect(verdicts(run, s)).toEqual([]);
    for (const s of onLegs(naming('region'), [[]], objects('region'))) expect(run(s).map((f) => f.rule)).toEqual([id]);
    for (const s of onLegs(naming('nowhere'), [ext(adding('region'))], objects('nowhere'))) expect(run(s).map((f) => f.rule)).toEqual([id]);
  });

  it.each(existence)('%s: a field nothing adds is refused byte-for-byte as on the declared objects alone', (_rule, id, run, naming, objects, adding) => {
    const refusal = (stack: Rec) => run(stack)
      .filter((f) => f.rule === id)
      .map(({ severity, where, path, message }) => ({ severity, where, path, message }));
    const [servedUnion, servedPerPackage] = onLegs(naming('zq_absent'), [ext(adding('region'))], objects('zq_absent'));
    const [declaredUnion, declaredPerPackage] = onLegs(naming('zq_absent'), [[]], objects('zq_absent'));
    expect(refusal(servedUnion)).toHaveLength(1);
    expect(refusal(servedUnion)).toEqual(refusal(declaredUnion));
    expect(refusal(servedPerPackage)).toEqual(refusal(declaredPerPackage));
  });

  // Every verdict this change adds or moves on a definition: the stack, the
  // objects, the extension fields; what `main` answered (the declared objects
  // alone, the same stack with no extension where the field is the owner's)
  // and what the served object answers now.
  const moved: Array<[string, Run, Rec, unknown[], Rec, unknown[][], unknown[][]]> = [
    ['notify: an added field typed text is not-email (was unknown)', validateNotifyEmailFieldRecipients, notify('contact_email'),
      [deal(), account], { contact_email: { type: 'text' } },
      [[NOTIFY_EMAIL_FIELD_UNKNOWN, 'error']], [[NOTIFY_EMAIL_FIELD_NOT_EMAIL, 'error']]],
    ['notify: an owner email field re-declared as text', validateNotifyEmailFieldRecipients, notify('contact_email'),
      [deal({ contact_email: { type: 'email' } }), account], { contact_email: { type: 'text' } },
      [], [[NOTIFY_EMAIL_FIELD_NOT_EMAIL, 'error']]],
    ['public form: an added image field', validatePublicFormFileFields, publicForm('photo'),
      [deal(), account], { photo: { type: 'image' } },
      [], [[PUBLIC_FORM_FILE_FIELD, 'error']]],
    ['public form: an owner text field re-declared as file', validatePublicFormFileFields, publicForm('doc'),
      [deal({ doc: { type: 'text' } }), account], { doc: { type: 'file' } },
      [], [[PUBLIC_FORM_FILE_FIELD, 'error']]],
    ['public form: an owner file field re-declared as text', validatePublicFormFileFields, publicForm('doc'),
      [deal({ doc: { type: 'file' } }), account], { doc: { type: 'text' } },
      [[PUBLIC_FORM_FILE_FIELD, 'error']], []],
    ['flow template: an owner text field re-declared as a lookup is a traversal', validateFlowTemplatePaths, template('record.account.name'),
      [deal({ account: { type: 'text' } }), account], { account: { type: 'lookup', reference: 'xs_account' } },
      [], [[FLOW_TEMPLATE_LOOKUP_TRAVERSAL, 'warning']]],
    ['flow template: an owner lookup re-declared as text is not', validateFlowTemplatePaths, template('record.account.name'),
      [deal({ account: { type: 'lookup', reference: 'xs_account' } }), account], { account: { type: 'text' } },
      [[FLOW_TEMPLATE_LOOKUP_TRAVERSAL, 'warning']], []],
    ['gallery page: an added image field binds', validatePageVisualizationBindings, gallery,
      [deal(), account], { photo: { type: 'image' } },
      [[PAGE_VISUALIZATION_WITHOUT_BINDING, 'error']], []],
    ['gallery page: an owner image field re-declared as text binds nothing', validatePageVisualizationBindings, gallery,
      [deal({ photo: { type: 'image' } }), account], { photo: { type: 'text' } },
      [], [[PAGE_VISUALIZATION_WITHOUT_BINDING, 'error']]],
    ['searchable: an owner text field re-declared as formula', validateSearchableFields, {},
      canonicalSearch('title', { title: { type: 'text' } }), { title: { type: 'formula', expression: 'record.name' } },
      [], [[SEARCHABLE_FIELD_UNSEARCHABLE, 'error']]],
    ['autonumber: a referenced field an extension adds optional (was unknown)', autonumberRun, {},
      autonumber('{region}{000}'), { region: { type: 'text' } },
      [[AUTONUMBER_UNKNOWN_FIELD, 'error']], [[AUTONUMBER_OPTIONAL_FIELD, 'warning']]],
    ['autonumber: a required owner field re-declared optional', autonumberRun, {},
      autonumber('{plan}{000}', { plan: { type: 'text', required: true } }), { plan: { type: 'text' } },
      [], [[AUTONUMBER_OPTIONAL_FIELD, 'warning']]],
    ['autonumber: an autonumber field an extension adds is checked', autonumberRun, {},
      [deal(), account], { ref2: { type: 'autonumber', autonumberFormat: '{nowhere}{000}' } },
      [], [[AUTONUMBER_UNKNOWN_FIELD, 'error']]],
    ['autonumber: an owner autonumber re-declared as text mints nothing', autonumberRun, {},
      autonumber('{nowhere}{000}'), { ref: { type: 'text' } },
      [[AUTONUMBER_UNKNOWN_FIELD, 'error']], []],
  ];

  it.each(moved)('%s', (_case, run, stack, objects, fields, before, after) => {
    for (const s of onLegs(stack, [[]], objects)) expect(verdicts(run, s)).toEqual(before);
    for (const s of onLegs(stack, [ext(fields)], objects)) expect(verdicts(run, s)).toEqual(after);
  });

  // A field two packages write at the deciding priority: its name is served,
  // its definition is registration order. Each definition question leaves it
  // unjudged in both orders; the definition that draws the verdict, written by
  // one package alone, still draws it.
  // rule · stack · objects · the drawing definition · the other · the id it draws
  const tied: Array<[string, Run, Rec, unknown[], Rec, Rec, string]> = [
    ['notify', validateNotifyEmailFieldRecipients, notify('contact_email'), [deal(), account],
      { contact_email: { type: 'text' } }, { contact_email: { type: 'email' } }, NOTIFY_EMAIL_FIELD_NOT_EMAIL],
    ['public form', validatePublicFormFileFields, publicForm('photo'), [deal(), account],
      { photo: { type: 'image' } }, { photo: { type: 'text' } }, PUBLIC_FORM_FILE_FIELD],
    ['flow template', validateFlowTemplatePaths, template('record.account.name'), [deal(), account],
      { account: { type: 'lookup', reference: 'xs_account' } }, { account: { type: 'text' } }, FLOW_TEMPLATE_LOOKUP_TRAVERSAL],
    ['gallery page', validatePageVisualizationBindings, gallery, [deal(), account],
      { photo: { type: 'text' } }, { photo: { type: 'image' } }, PAGE_VISUALIZATION_WITHOUT_BINDING],
    ['searchable', validateSearchableFields, {}, canonicalSearch('title'),
      { title: { type: 'formula', expression: 'record.name' } }, { title: { type: 'text' } }, SEARCHABLE_FIELD_UNSEARCHABLE],
    ['autonumber', autonumberRun, {}, autonumber('{region}{000}'),
      { region: { type: 'text' } }, { region: { type: 'text', required: true } }, AUTONUMBER_OPTIONAL_FIELD],
  ];

  it.each(tied)('%s: a field two packages tie on is unjudged', (_rule, run, stack, objects, drawing, other, id) => {
    for (const [a, b] of [[drawing, other], [other, drawing]]) {
      for (const s of onLegs(stack, [ext(a), ext(b)], objects)) expect(verdicts(run, s)).toEqual([]);
    }
    for (const s of onLegs(stack, [ext(drawing), ext({})], objects)) expect(run(s).map((f) => f.rule)).toEqual([id]);
  });

  // An object that declares no field (an introspected schema) is left
  // unjudged where `main` skipped it: an extension adding to it does not make
  // its other columns knowable, nor its added fields judgeable by these rules.
  const unjudged: Array<[string, Run, Rec, Rec]> = [
    ['notify', validateNotifyEmailFieldRecipients, notify('remote_col'), { contact_email: { type: 'text' } }],
    ['public form', validatePublicFormFileFields, publicForm('photo'), { photo: { type: 'image' } }],
    ['gallery page', validatePageVisualizationBindings, gallery, { name: { type: 'text' } }],
    ['searchable', validateSearchableFields, listSearch('remote_col'), { region: { type: 'text' } }],
    ['autonumber', autonumberRun, {}, { ref2: { type: 'autonumber', autonumberFormat: '{remote_col}{000}' } }],
    ['list-view columns', validateListViewFieldRefs, {
      views: [{ name: 'v', objectName: 'xs_deal', list: { type: 'grid', columns: ['remote_col'] } }],
    }, { region: { type: 'text' } }],
  ];

  it.each(unjudged)('%s: an object that declares no field is unjudged, extended or not', (_rule, run, stack, fields) => {
    for (const packages of [[ext(fields)], [[]]]) {
      for (const s of onLegs(stack, packages, [bare, account])) expect(verdicts(run, s)).toEqual([]);
    }
  });

  // Item 2 of the card, as measured: the list-view rule on an object that
  // declares no field, with and without the extension, and the control that a
  // declared object's unknown column is still refused at the same path.
  it('validate-list-view-field-refs: the declares-nothing skip holds once an extension adds to the object', () => {
    const empty = { name: 'xs_empty', label: 'Empty', fields: {} };
    const view = (column: string) => ({ views: [{ name: 'v', objectName: 'xs_empty', list: { type: 'grid', columns: [column] } }] });
    const extendEmpty = [{ extend: 'xs_empty', fields: { region: { type: 'text' } } }];
    for (const packages of [[extendEmpty], [[]]]) {
      for (const s of onLegs(view('name'), packages, [empty])) expect(validateListViewFieldRefs(s)).toEqual([]);
    }
    const titled = { name: 'xs_empty', label: 'Empty', fields: { title: { type: 'text' } } };
    for (const s of onLegs(view('nowhere'), [extendEmpty], [titled])) {
      expect(validateListViewFieldRefs(s).map((f) => [f.rule, f.severity, f.path])).toEqual([
        [LIST_VIEW_FIELD_UNKNOWN, 'error', 'views[0].list.columns[0]'],
      ]);
    }
    for (const s of onLegs(view('region'), [extendEmpty], [titled])) expect(validateListViewFieldRefs(s)).toEqual([]);
  });
});
