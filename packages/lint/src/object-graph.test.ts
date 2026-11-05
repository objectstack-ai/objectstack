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
