// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  COMPUTED_VALUE_TYPES,
  FieldType,
  SEARCH_VIRTUAL_TYPES,
  VIRTUAL_FIELD_AGGREGATE_REMEDY,
  isMultiValueField,
} from '@objectstack/spec/data';
import {
  validateSortableFields as validateSortableFieldsUnrecorded,
  checkSortDeclaration as checkSortDeclarationUnrecorded,
  SORT_FIELD_UNKNOWN,
  SORT_FIELD_UNSORTABLE,
  SORT_FIELD_UNPROVISIONED,
  GRID_AGGREGATION_FIELD_TYPE_REFUSED,
  PAGE_BLOCK_SORT_OBJECT_PROP,
  indexObjectSortability,
} from './validate-sortable-fields.js';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { COLUMN_SUMMARY_AGGREGATION, ComponentPropsMap } from '@objectstack/spec/ui';
import { LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED, validateListViewFieldRefs } from './validate-list-view-field-refs.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { indexObjectSearchTargets } from './validate-searchable-fields.js';
import { indexUnprovisionedAnchors } from './system-fields.js';
import { explainRule } from './rule-explanations.js';
import {
  PAGE_FIELD_UNKNOWN,
  PAGE_FIELD_UNPROVISIONED,
  validatePageFieldBindings,
} from './validate-page-field-bindings.js';

// [#22161] Each finding of the three ids is one verdict sentence; the reasoning
// it used to carry is the id's `os explain` entry. Every call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — so the pin covers every firing variant
// this suite exercises, not a chosen few. Run the whole file: those cases read
// what the cases above fired.
const SORT_IDS: readonly string[] = [SORT_FIELD_UNKNOWN, SORT_FIELD_UNSORTABLE, SORT_FIELD_UNPROVISIONED];
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateSortableFields: typeof validateSortableFieldsUnrecorded = (...args) => {
  const findings = validateSortableFieldsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};
const checkSortDeclaration: typeof checkSortDeclarationUnrecorded = (...args) => {
  const findings = checkSortDeclarationUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/** The `os explain` text of `rule`, one string. */
const explanationOf = (rule: string): string => explainRule(rule)?.paragraphs.join('\n') ?? '';

/**
 * The object the whole file judges against. It carries one field of each of the
 * three COMPUTED types on purpose — that trio is the rule's whole risk surface,
 * because the write contract groups them and STORAGE does not.
 */
const opportunityFields = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  probability: { type: 'percent', label: 'Probability' },
  stage: { type: 'select', label: 'Stage' },
  // Virtual — computed on read, no stored column on any driver.
  expected_revenue: { type: 'formula', label: 'Expected Revenue' },
  // Stored: `table.float`, maintained by the engine. Sorts correctly.
  open_task_count: { type: 'summary', label: 'Open Tasks' },
  // Stored: `table.string`, engine-assigned. Sorts correctly.
  opp_no: { type: 'autonumber', label: 'Opportunity No.' },
};

const withListView = (sort: unknown) => ({
  objects: [
    {
      name: 'crm_opportunity',
      fields: opportunityFields,
      listViews: { pipeline: { type: 'grid', sort } },
    },
  ],
});

describe('validateSortableFields — the virtuality verdict (#9257)', () => {
  it('flags a list-view sort naming a formula field', () => {
    const findings = validateSortableFields(
      withListView([{ field: 'expected_revenue', order: 'desc' }]),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toBe('object "crm_opportunity" › listViews.pipeline');
    // The index is part of the path so the author can go straight to the key.
    expect(findings[0].path).toBe('objects[0].listViews.pipeline.sort[0]');
    expect(findings[0].message).toContain('expected_revenue');
    expect(findings[0].message).toContain("'formula'");
    // The remedy is the engine door's own, so an author refused at authoring
    // time and one refused at request time are sent the same way.
    expect(findings[0].hint).toContain('Denormalise');
    // [#22161] That both runtime doors refuse it is `os explain`'s.
    expect(explanationOf(SORT_FIELD_UNSORTABLE)).toContain('`400 INVALID_SORT`');
  });

  it('flags it in the legacy string form too — the shape Zod cannot judge', () => {
    // `ListViewSchema.sort` is `z.union([z.string(), Array<{field, order}>])`,
    // so this parses clean and names a field that cannot be ordered by.
    const findings = validateSortableFields(withListView('expected_revenue desc'));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].path).toBe('objects[0].listViews.pipeline.sort');
  });

  it('reads the `-field` shorthand and the comma-separated multi-key string', () => {
    const findings = validateSortableFields(withListView('stage asc, -expected_revenue'));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].path).toBe('objects[0].listViews.pipeline.sort[1]');
  });

  it('flags every offending key, not just the first', () => {
    const findings = validateSortableFields(
      withListView([
        { field: 'stage', order: 'asc' },
        { field: 'expected_revenue', order: 'desc' },
        { field: 'no_such_field', order: 'asc' },
      ]),
    );

    expect(findings.map((f) => f.rule)).toEqual([SORT_FIELD_UNSORTABLE, SORT_FIELD_UNKNOWN]);
    expect(findings.map((f) => f.path)).toEqual([
      'objects[0].listViews.pipeline.sort[1]',
      'objects[0].listViews.pipeline.sort[2]',
    ]);
  });
});

/**
 * The second leg of the reverse verification, and the one that decides whether
 * this rule is worth having: a gate that also refused `summary` / `autonumber`
 * would reject metadata the runtime executes correctly.
 *
 * The trap is that the spec DOES group all three — `COMPUTED_VALUE_TYPES` is
 * `formula` / `summary` / `autonumber` — but that set is the WRITE contract
 * ("never client-written"), not a storage fact. `summary` is a `table.float`
 * the engine maintains and `autonumber` a `table.string` it assigns; both have
 * a real column and both sort. Only `formula` has none.
 */
describe('validateSortableFields — what it must NOT flag', () => {
  it('does not flag a summary sort — a real stored column the engine maintains', () => {
    expect(validateSortableFields(withListView([{ field: 'open_task_count', order: 'desc' }])))
      .toEqual([]);
  });

  it('does not flag an autonumber sort — a real stored column the engine assigns', () => {
    expect(validateSortableFields(withListView([{ field: 'opp_no', order: 'asc' }])))
      .toEqual([]);
  });

  it('pins the predicate boundary the two cases above stand on', () => {
    // If this ever fails, the two assertions above stopped meaning anything:
    // the rule reads `SEARCH_VIRTUAL_TYPES`, and its distance from
    // `COMPUTED_VALUE_TYPES` is the entire reason those two sorts stay legal.
    expect([...SEARCH_VIRTUAL_TYPES]).toEqual(['formula']);
    expect([...COMPUTED_VALUE_TYPES].sort()).toContain('summary');
    expect([...COMPUTED_VALUE_TYPES].sort()).toContain('autonumber');
  });

  it('does not flag an ordinary stored field', () => {
    expect(validateSortableFields(withListView([{ field: 'amount', order: 'desc' }]))).toEqual([]);
  });

  it('does not flag a registry-injected system column', () => {
    // `created_at` never appears in authored `fields` and is the single most
    // common ordering in the platform's own list views. Flagging it would be
    // the false finding ADR-0072 D1 warns about.
    expect(validateSortableFields(withListView([{ field: 'created_at', order: 'desc' }])))
      .toEqual([]);
  });

  it('says nothing about an object it cannot see', () => {
    const findings = validateSortableFields({
      objects: [
        {
          name: 'crm_opportunity',
          fields: opportunityFields,
          listViews: {
            // Retargeted at an object no stack in view declares — a field map
            // we cannot read cannot be judged.
            partner: {
              data: { provider: 'object', object: 'billing_invoice' },
              sort: [{ field: 'whatever', order: 'asc' }],
            },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('says nothing about an object that declares no field map', () => {
    // External / datasource-introspected: columns resolve at runtime.
    const findings = validateSortableFields({
      objects: [
        { name: 'ext_orders', datasource: 'erp', listViews: { all: { sort: 'total desc' } } },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('ignores a declaration that names no field, and an absent one', () => {
    expect(validateSortableFields(withListView(undefined))).toEqual([]);
    expect(validateSortableFields(withListView(''))).toEqual([]);
    expect(validateSortableFields(withListView([]))).toEqual([]);
    // Shape errors belong to the schema, not to a reference rule.
    expect(validateSortableFields(withListView([{ order: 'desc' }]))).toEqual([]);
    expect(validateSortableFields(withListView([42]))).toEqual([]);
  });
});

describe('validateSortableFields — the existence verdict', () => {
  it('flags a sort naming no field at all, and suggests the near miss', () => {
    const findings = validateSortableFields(withListView([{ field: 'amont', order: 'desc' }]));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('Did you mean "amount"?');
    expect(findings[0].message).toContain('400 INVALID_SORT');
  });

  it('judges a dotted path on its HEAD, exactly as the ingress gate does', () => {
    // Unknown head → the unknown verdict, with the relation-crossing remedy.
    const unknownHead = validateSortableFields(
      withListView([{ field: 'account.name', order: 'asc' }]),
    );
    expect(unknownHead).toHaveLength(1);
    expect(unknownHead[0].rule).toBe(SORT_FIELD_UNKNOWN);
    expect(unknownHead[0].hint).toContain('never a related record');
    // A KNOWN head is left to the ingress gate's own dotted verdict — see the
    // module note on why this rule does not add a third finding for it.
    expect(validateSortableFields(withListView([{ field: 'stage.label', order: 'asc' }])))
      .toEqual([]);
  });
});

describe('validateSortableFields — the surfaces it walks', () => {
  const fields = { name: { type: 'text' }, score: { type: 'formula' } };

  it('walks a defineView aggregate\'s default list', () => {
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'lead_views',
          objectName: 'crm_lead',
          list: { type: 'grid', sort: [{ field: 'score', order: 'desc' }] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('view "lead_views" › list');
    expect(findings[0].path).toBe('views[0].list.sort[0]');
  });

  it('walks a defineView aggregate\'s named list views', () => {
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'lead_views',
          object: 'crm_lead',
          listViews: { hot: { type: 'grid', sort: 'score desc' } },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('view "lead_views" › listViews.hot');
    expect(findings[0].path).toBe('views[0].listViews.hot.sort');
  });

  it('honors a list view\'s own `data.object` binding over the container\'s', () => {
    const findings = validateSortableFields({
      objects: [
        { name: 'crm_lead', fields: { name: { type: 'text' } } },
        { name: 'crm_task', fields: { due_at: { type: 'datetime' }, age: { type: 'formula' } } },
      ],
      views: [
        {
          name: 'lead_views',
          objectName: 'crm_lead',
          listViews: {
            tasks: {
              data: { provider: 'object', object: 'crm_task' },
              sort: [{ field: 'age', order: 'desc' }],
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_task');
  });

  it('returns nothing for an empty stack', () => {
    expect(validateSortableFields({})).toEqual([]);
  });

  // ── [#9313] the SELF rung: a flattened standalone list overlay ──
  //
  // The `PUT /api/v1/meta/view` shape (`ViewMetadataSchema`'s list-overlay
  // member): a raw ListView config at the TOP of the `views[]` entry, with
  // `object` + `viewKind: 'list'` required (#7741). The runtime publish gate
  // snapshots a `view` write as `views: [item]`, so this rung is the half of
  // #9313 that makes the dispatch widening mean anything.

  it('walks a flattened list overlay\'s top-level `sort` (#9313)', () => {
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'crm_lead.hot',
          object: 'crm_lead',
          viewKind: 'list',
          type: 'grid',
          columns: ['name'],
          // The console-decorated row shape a personalization PUT persists
          // (#5074): `id` is objectui's randomUUID and must not confuse the read.
          sort: [{ id: 'a2b4c86e-9313-4111-8111-000000000001', field: 'score', order: 'desc' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].where).toBe('view "crm_lead.hot" (flattened list overlay)');
    expect(findings[0].path).toBe('views[0].sort[0]');
  });

  it('honors the overlay\'s `data.object` retarget over its top-level `object` (#9313)', () => {
    const findings = validateSortableFields({
      objects: [
        { name: 'crm_lead', fields: { name: { type: 'text' } } },
        { name: 'crm_task', fields: { age: { type: 'formula' } } },
      ],
      views: [
        {
          name: 'crm_lead.tasks',
          object: 'crm_lead',
          viewKind: 'list',
          data: { provider: 'object', object: 'crm_task' },
          sort: [{ field: 'age', order: 'desc' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_task');
  });

  // ── [#10001] the RECORD rung: a standalone ViewItem record ──
  //
  // `{ name, object, viewKind: 'list', config }` is `ViewMetadataSchema`'s
  // member 1 (`ViewItemWireSchema`) — the shape a Studio-saved view takes
  // through `PUT /api/v1/meta/view`, whose `sort` lives one level down in
  // `config`. The test that stood here pinned the #9313 boundary ("its sort
  // lives in `config`, a rung this rule deliberately does not walk"); #10001
  // closes that recorded scope, and the rung is recognised by the wire
  // schema's own member discrimination: `viewKind: 'list'` AND a
  // record-shaped `config` — the exact complement of the overlay rung's
  // `!isRec(config)` guard.

  it('walks a ViewItem record\'s nested `config.sort` (#10001)', () => {
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'crm_lead.pipeline',
          object: 'crm_lead',
          viewKind: 'list',
          config: { type: 'grid', columns: ['name'], sort: [{ field: 'score', order: 'desc' }] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].where).toBe('view "crm_lead.pipeline" (ViewItem record)');
    expect(findings[0].path).toBe('views[0].config.sort[0]');
  });

  it('honors the record config\'s `data.object` retarget over the record\'s `object` (#10001)', () => {
    const findings = validateSortableFields({
      objects: [
        { name: 'crm_lead', fields: { name: { type: 'text' } } },
        { name: 'crm_task', fields: { age: { type: 'formula' } } },
      ],
      views: [
        {
          name: 'crm_lead.tasks',
          object: 'crm_lead',
          viewKind: 'list',
          config: {
            type: 'grid',
            data: { provider: 'object', object: 'crm_task' },
            sort: [{ field: 'age', order: 'desc' }],
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_task');
  });

  it('still does NOT read a ViewItem record\'s top level as an overlay (#10001)', () => {
    // The rung-split half the record rung must not disturb: a record carrying
    // a stray top-level `sort` (`saveMetaItem` persists the original body) is
    // judged on `config.sort` alone — the overlay rung's `!isRec(config)`
    // guard keeps the record's top level out, exactly as before #10001.
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'crm_lead.pipeline',
          object: 'crm_lead',
          viewKind: 'list',
          sort: [{ field: 'not_a_field', order: 'asc' }],
          config: { type: 'grid', columns: ['name'], sort: [{ field: 'name', order: 'asc' }] },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('a FORM record\'s config is not judged — the rung keys on viewKind \'list\' (#10001)', () => {
    // `FormViewSchema` declares no `sort`; a stray one riding in the stored
    // body (the store keeps the original) must not be judged by a list rule.
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        {
          name: 'crm_lead.edit',
          object: 'crm_lead',
          viewKind: 'form',
          config: { type: 'simple', sort: [{ field: 'score', order: 'desc' }] },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('each list-view rung is judged exactly once — no rung double-judges another\'s shape (#10001)', () => {
    // One bad sort per rung in a single stack: object listView, container
    // `list`, flattened overlay, ViewItem record. Exactly four findings, one
    // per declared path — a leak or double judgment changes the census.
    const findings = validateSortableFields({
      objects: [
        {
          name: 'crm_lead',
          fields,
          listViews: { aging: { type: 'grid', sort: [{ field: 'score', order: 'desc' }] } },
        },
      ],
      views: [
        {
          name: 'lead_views',
          objectName: 'crm_lead',
          list: { type: 'grid', sort: [{ field: 'score', order: 'desc' }] },
        },
        {
          name: 'crm_lead.hot',
          object: 'crm_lead',
          viewKind: 'list',
          type: 'grid',
          sort: [{ field: 'score', order: 'desc' }],
        },
        {
          name: 'crm_lead.pipeline',
          object: 'crm_lead',
          viewKind: 'list',
          config: { type: 'grid', sort: [{ field: 'score', order: 'desc' }] },
        },
      ],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'objects[0].listViews.aging.sort[0]',
      'views[0].list.sort[0]',
      'views[1].sort[0]',
      'views[2].config.sort[0]',
    ]);
  });

  it('a form overlay has no sort surface and is not judged (#9313)', () => {
    // `FormViewSchema` tombstones `sort` — a related list sorts by its own
    // list view's sort — so the rung keys on `viewKind: 'list'` alone.
    const findings = validateSortableFields({
      objects: [{ name: 'crm_lead', fields }],
      views: [
        { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', sort: 'score desc' },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('checkSortDeclaration — the shared core', () => {
  it('resolves against the same object index the search axis uses', () => {
    const stack = { objects: [{ name: 'crm_opportunity', fields: opportunityFields }] };
    const findings = checkSortDeclaration(
      [{ field: 'expected_revenue', order: 'desc' }],
      'crm_opportunity',
      indexObjectSearchTargets(stack),
      'page "pipeline"',
      'pages[0].sort',
      'page sort',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(findings[0].where).toBe('page "pipeline"');
    expect(findings[0].message).toContain('page sort');
  });

  it('says nothing when the caller cannot name an object', () => {
    expect(
      checkSortDeclaration(
        [{ field: 'anything', order: 'asc' }],
        undefined,
        indexObjectSearchTargets({ objects: [] }),
        'somewhere',
        'x.sort',
        'sort',
      ),
    ).toEqual([]);
  });
});

// ── [#10474] PROVENANCE — the SORT twin of #8404's SEARCH wiring ────────────
//
// The census (#8999) recorded this rule as not asking the #8116 provenance
// question, on the reason that an ADR-0015 external object never reaches the
// union branch (skip ② was believed to catch it). That reason was measured
// wrong: `declaredFieldTarget` keys on "declares no field map", never on
// `external`, so the SHIPPED shape — an external object with a mapped field
// map — is indexed like any other and lands in skip ③.
//
// ⚠️ The LOCAL twin is asserted in every case below, and it is the load-bearing
// half. A wiring that warned on `created_at` for EVERY object would satisfy the
// positive direction alone while flagging the single most common list-view
// ordering in the platform's own objects — the ADR-0072 D1 false finding this
// package's whole system-fields indirection exists to prevent. Only the
// negative direction can catch that, so it is asserted every time.

/** The showcase's own federated object: `external` + a mapped field map. */
const externalObject = {
  name: 'showcase_ext_customer',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'text', label: 'Email' },
    region: { type: 'text', label: 'Region' },
  },
};

/** Its local twin — identical in every way EXCEPT `external`. */
const localTwin = {
  name: 'showcase_customer',
  fields: {
    name: { type: 'text', label: 'Name' },
    email: { type: 'text', label: 'Email' },
    region: { type: 'text', label: 'Region' },
  },
};

/** Both objects, each with a list view ordering by the same injected anchor. */
const twinStack = (sort: unknown) => ({
  objects: [
    { ...externalObject, listViews: { recent: { type: 'grid', sort } } },
    { ...localTwin, listViews: { recent: { type: 'grid', sort } } },
  ],
});

describe('validateSortableFields — the provenance verdict (#10474)', () => {
  it('warns on a list-view sort ordering by an unprovisioned injected anchor', () => {
    const findings = validateSortableFields(twinStack([{ field: 'created_at', order: 'desc' }]));

    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.rule).toBe(SORT_FIELD_UNPROVISIONED);
    // WARNING, not error: no runtime door refuses this, and the remote schema
    // is invisible to this pass. The runtime publish gate sorts on severity —
    // `error` would turn an unprovable suspicion into a refused write.
    expect(f.severity).toBe('warning');
    expect(f.where).toBe('object "showcase_ext_customer" › listViews.recent');
    expect(f.path).toBe('objects[0].listViews.recent.sort[0]');
    expect(f.message).toContain('created_at');
    // The CAUSE clause is the package-shared sentence, not a re-typed one:
    // a rule that re-words it drifts from the runtime guards whose verdict it
    // reports — [#22161] the one-clause `unprovisionedAnchorVerdict`, whose long
    // form (ADR-0015 federation) is the id's `os explain` entry.
    expect(f.message).toBe(
      "list-view sort: 'created_at' is an injected column with no storage on external object " +
        "'showcase_ext_customer', so its ORDER BY is dropped and every fetch returns rows in an " +
        'arbitrary order',
    );
    // The SORT-axis consequence, which is this rule's own half of the sentence.
    expect(f.message).toContain('ORDER BY');
    expect(f.hint).toContain('columnMap');
  });

  it('THE NEGATIVE DIRECTION: says nothing about the identical sort on the LOCAL twin', () => {
    // `objects[1]` is the local twin and carries the identical declaration.
    // The single finding above is proof enough only alongside this.
    const findings = validateSortableFields(twinStack([{ field: 'created_at', order: 'desc' }]));
    expect(findings.map((x) => x.path)).not.toContain('objects[1].listViews.recent.sort[0]');
    expect(
      validateSortableFields({
        objects: [{ ...localTwin, listViews: { recent: { type: 'grid', sort: 'created_at desc' } } }],
      }),
    ).toEqual([]);
  });

  it('covers every anchor the injection registers, not just the audit family', () => {
    // `owner_id` is the one no managed DDL ever creates either, so it is the
    // clearest case; asserting the set keeps a narrowing of the derivation
    // visible here rather than only in the spec's own test.
    for (const anchor of ['created_at', 'created_by', 'updated_at', 'owner_id', 'organization_id']) {
      const findings = validateSortableFields(twinStack([{ field: anchor, order: 'asc' }]));
      expect(findings.map((x) => x.rule), anchor).toEqual([SORT_FIELD_UNPROVISIONED]);
      expect(findings[0].message, anchor).toContain(anchor);
    }
  });

  it('reads the legacy string sort form too, not only the structured array', () => {
    const findings = validateSortableFields(twinStack('created_at desc'));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNPROVISIONED);
    // The string form has no index suffix.
    expect(findings[0].path).toBe('objects[0].listViews.recent.sort');
  });

  it("SECURITY DIRECTION: an author-DECLARED anchor on the federated object is silent", () => {
    // #7859's recorded reasoning — a federated object may expose a REAL remote
    // `created_at`, which the author vouches for through the binding's
    // columnMap. `unprovisionedInjectedColumnsFor` excludes it, so declaring
    // the column is the first remedy the shared hint prescribes AND the thing
    // that silences the finding.
    const declared = {
      ...externalObject,
      fields: { ...externalObject.fields, created_at: { type: 'datetime', label: 'Remote Created' } },
      listViews: { recent: { type: 'grid', sort: [{ field: 'created_at', order: 'desc' }] } },
    };
    expect(validateSortableFields({ objects: [declared] })).toEqual([]);
  });

  it('respects the injection opt-outs — `systemFields: false` leaves no anchor to warn about', () => {
    const optedOut = {
      ...externalObject,
      systemFields: false,
      listViews: { recent: { type: 'grid', sort: [{ field: 'created_at', order: 'desc' }] } },
    };
    expect(validateSortableFields({ objects: [optedOut] })).toEqual([]);
  });

  it('DOTTED heads are NOT asked — the ingress gate already refuses them loudly', () => {
    // The one place this axis departs from the SEARCH twin, deliberately: a
    // dotted SORT name is a `400 INVALID_SORT` on every fetch, so the silent
    // degradation this finding reports cannot happen there, and answering
    // would give the SORT axis its own dotted verdict (the posture the module
    // note records as shared with FILTER/PROJECTION).
    const findings = validateSortableFields(twinStack([{ field: 'created_at.year', order: 'asc' }]));
    expect(findings).toEqual([]);
  });

  it('is additive: the existence verdict on a real typo still fires beside it', () => {
    const findings = validateSortableFields(
      twinStack([{ field: 'created_at', order: 'desc' }, { field: 'nope', order: 'asc' }]),
    );
    const external = findings.filter((x) => x.path.startsWith('objects[0]'));
    expect(external.map((x) => x.rule)).toEqual([SORT_FIELD_UNPROVISIONED, SORT_FIELD_UNKNOWN]);
    // …and the local twin still gets the typo, and ONLY the typo.
    const local = findings.filter((x) => x.path.startsWith('objects[1]'));
    expect(local.map((x) => x.rule)).toEqual([SORT_FIELD_UNKNOWN]);
  });

  it('reaches the `defineView` aggregate and standalone list-view rungs too', () => {
    const base = { objects: [externalObject] };
    const sort = [{ field: 'created_at', order: 'desc' }];
    const rungs: Array<[string, unknown[]]> = [
      ['aggregate list', [{ name: 'v', objectName: 'showcase_ext_customer', list: { sort } }]],
      ['aggregate listViews', [{ name: 'v', objectName: 'showcase_ext_customer', listViews: { a: { sort } } }]],
      ['flattened overlay', [{ name: 'v', object: 'showcase_ext_customer', viewKind: 'list', sort }]],
      ['ViewItem record', [{ name: 'v', object: 'showcase_ext_customer', viewKind: 'list', config: { sort } }]],
    ];
    for (const [label, views] of rungs) {
      const findings = validateSortableFields({ ...base, views });
      expect(findings.map((x) => x.rule), label).toEqual([SORT_FIELD_UNPROVISIONED]);
    }
  });
});

describe('checkSortDeclaration — the provenance parameter is OPTIONAL (#10474)', () => {
  const stack = { objects: [externalObject] };

  it('asks nothing when the caller does not build the index (pre-#10474 behaviour)', () => {
    // The exported core is public surface; an out-of-repo caller that never
    // built the index must keep the answers it had.
    expect(
      checkSortDeclaration(
        [{ field: 'created_at', order: 'desc' }],
        'showcase_ext_customer',
        indexObjectSearchTargets(stack),
        'page "customers"',
        'pages[0].sort',
        'page sort',
      ),
    ).toEqual([]);
  });

  it('asks once the caller passes it', () => {
    const findings = checkSortDeclaration(
      [{ field: 'created_at', order: 'desc' }],
      'showcase_ext_customer',
      indexObjectSearchTargets(stack),
      'page "customers"',
      'pages[0].sort',
      'page sort',
      indexUnprovisionedAnchors(stack),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SORT_FIELD_UNPROVISIONED);
    expect(findings[0].where).toBe('page "customers"');
    expect(findings[0].message).toContain('page sort');
  });
});

/**
 * [#30023] The author-declared verdict: a stored field whose author wrote
 * `sortable: false`. Since #29896 the Data API list door refuses a sort on it
 * (`400 INVALID_SORT`, reason `author-declared`), judged by the served
 * sortability projection, and this rule reads the same projection.
 */
const ticketFields = {
  subject: { type: 'text', label: 'Subject' },
  // The author's own refusal: a stored column the list does not offer as a sort.
  body: { type: 'textarea', label: 'Body', sortable: false },
  // An explicit `true` is the default spelled out.
  priority: { type: 'number', label: 'Priority', sortable: true },
  // Virtual AND declared: the projection keeps the storage reason.
  score: { type: 'formula', label: 'Score', sortable: false },
};
const ticket = { name: 'help_ticket', fields: ticketFields };
const ticketListView = (sort: unknown) => ({
  objects: [{ ...ticket, listViews: { inbox: { type: 'grid', sort } } }],
});

describe('validateSortableFields — the author-declared verdict (#30023)', () => {
  it('refuses a list-view sort naming a `sortable: false` field, with the door\'s field and reason', () => {
    const findings = validateSortableFields(ticketListView([{ field: 'body', order: 'asc' }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SORT_FIELD_UNSORTABLE,
      where: 'object "help_ticket" › listViews.inbox',
      path: 'objects[0].listViews.inbox.sort[0]',
    });
    expect(findings[0].message).toBe(
      'list-view sort orders by "body", a field on object "help_ticket" that declares `sortable: false`, ' +
        'so every load answers 400 INVALID_SORT',
    );
    expect(findings[0].hint).toBe('Sort by another field, or remove `sortable: false` from "body" to make it sortable');
  });

  it('reads the legacy string form and the `-field` shorthand', () => {
    const findings = validateSortableFields(ticketListView('subject asc, -body'));
    expect(findings.map((f) => f.path)).toEqual(['objects[0].listViews.inbox.sort[1]']);
  });

  it('refuses it on the standalone view door shapes too (flattened overlay, ViewItem record)', () => {
    const overlay = validateSortableFields({
      objects: [ticket],
      views: [{ name: 'inbox', object: 'help_ticket', viewKind: 'list', type: 'grid', sort: [{ field: 'body' }] }],
    });
    expect(overlay.map((f) => [f.rule, f.path])).toEqual([[SORT_FIELD_UNSORTABLE, 'views[0].sort[0]']]);
    const record = validateSortableFields({
      objects: [ticket],
      views: [{ name: 'inbox', object: 'help_ticket', viewKind: 'list', config: { sort: [{ field: 'body' }] } }],
    });
    expect(record.map((f) => [f.rule, f.path])).toEqual([[SORT_FIELD_UNSORTABLE, 'views[0].config.sort[0]']]);
  });

  it('controls: no `sortable` key and `sortable: true` sort as before', () => {
    expect(validateSortableFields(ticketListView([{ field: 'subject' }, { field: 'priority', order: 'desc' }]))).toEqual([]);
  });

  it('a virtual field that also declares `sortable: false` keeps its own (storage) verdict', () => {
    const [f, ...rest] = validateSortableFields(ticketListView([{ field: 'score' }]));
    expect(rest).toEqual([]);
    expect(f.rule).toBe(SORT_FIELD_UNSORTABLE);
    expect(f.message).toContain("a virtual 'formula' field");
    expect(f.message).not.toContain('sortable: false');
  });

  it('judges by the projection the door serves, for every field the object declares', () => {
    // The rule's index IS `resolveObjectSortability` over the authored object,
    // so the two cannot disagree about which name is refused or why.
    expect(indexObjectSortability({ objects: [ticket] }).get('help_ticket')).toEqual(
      resolveObjectSortability(ticket).fields,
    );
    expect(resolveObjectSortability(ticket).fields.body).toEqual({ sortable: false, reason: 'author-declared' });
  });

  it('the exported core answers it only when the caller passes the projection (out-of-repo posture)', () => {
    const stack = { objects: [ticket] };
    const targets = indexObjectSearchTargets(stack);
    const anchors = indexUnprovisionedAnchors(stack);
    const core = (field: string, sortability?: ReturnType<typeof indexObjectSortability>) =>
      checkSortDeclaration([{ field }], 'help_ticket', targets, 'x', 'x.sort', 'sort', anchors, sortability);
    expect(core('body')).toEqual([]);
    // The virtual verdict is still answered without it, as before.
    expect(core('score')).toHaveLength(1);
    expect(core('body', indexObjectSortability(stack)).map((f) => f.path)).toEqual(['x.sort[0]']);
  });
});

const pageStack = (page: Record<string, unknown>) => ({ objects: [ticket, { name: 'crm_opportunity', fields: opportunityFields }], pages: [page] });
const region = (...components: unknown[]) => ({ name: 'p', type: 'record', object: 'crm_opportunity', regions: [{ name: 'main', components }] });

describe('validateSortableFields — stored PAGE sorts (#30023)', () => {
  it('refuses a `sortable: false` sort at every page slot that reaches the list door', () => {
    const page = {
      ...region(
        { type: 'record:related_list', properties: { objectName: 'help_ticket', relationshipField: 'subject', sort: [{ field: 'body' }] } },
        {
          type: 'record:related_list',
          dataSource: { object: 'help_ticket', sort: [{ field: 'body', order: 'desc' }] },
          properties: { relationshipField: 'subject', parentDataSource: { object: 'help_ticket', sort: [{ field: 'body' }] } },
        },
        { type: 'object-grid', properties: { objectName: 'help_ticket', sort: [{ field: 'subject' }, { field: 'body' }] } },
        { type: 'record:line_items', properties: { childObject: 'help_ticket', sort: [{ field: 'body' }] } },
        { type: 'list-view', properties: { type: 'grid', data: { provider: 'object', object: 'help_ticket' }, sort: [{ field: 'body' }] } },
        { type: 'element:number', dataSource: { object: 'help_ticket', sort: [{ field: 'body' }] }, properties: { field: 'priority' } },
      ),
      interfaceConfig: { source: 'help_ticket', sort: [{ field: 'body' }] },
      record: { object: 'help_ticket', sort: [{ field: 'body' }] },
    };
    const findings = validateSortableFields(pageStack(page));
    expect(findings.every((f) => f.rule === SORT_FIELD_UNSORTABLE && f.severity === 'error')).toBe(true);
    expect(findings.every((f) => f.message.includes('"body", a field on object "help_ticket" that declares `sortable: false`'))).toBe(true);
    expect(findings.map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.sort[0]',
      'pages[0].regions[0].components[1].dataSource.sort[0]',
      'pages[0].regions[0].components[1].properties.parentDataSource.sort[0]',
      'pages[0].regions[0].components[2].properties.sort[1]',
      'pages[0].regions[0].components[3].properties.sort[0]',
      'pages[0].regions[0].components[4].properties.sort[0]',
      'pages[0].regions[0].components[5].dataSource.sort[0]',
      'pages[0].interfaceConfig.sort[0]',
      'pages[0].record.sort[0]',
    ]);
    expect(findings.map((f) => f.where)).toContain('page "p" · record:related_list');
    expect(findings.map((f) => f.where)).toContain('page "p" · interfaceConfig');
  });

  it('binds a block\'s own `sort` to its `dataSource.object` first, then the block\'s object prop', () => {
    const findings = validateSortableFields(pageStack(region({
      type: 'object-grid',
      dataSource: { object: 'help_ticket' },
      properties: { objectName: 'crm_opportunity', sort: [{ field: 'body' }] },
    })));
    expect(findings.map((f) => f.path)).toEqual(['pages[0].regions[0].components[0].properties.sort[0]']);
  });

  it('a list page with no `source` binds the page object', () => {
    const findings = validateSortableFields(pageStack({ name: 'p', type: 'list', object: 'help_ticket', interfaceConfig: { sort: [{ field: 'body' }] } }));
    expect(findings.map((f) => f.path)).toEqual(['pages[0].interfaceConfig.sort[0]']);
  });

  it('refuses a formula sort on a page slot too — the same projection\'s other reason', () => {
    const findings = validateSortableFields(pageStack(region({
      type: 'record:related_list',
      properties: { objectName: 'crm_opportunity', relationshipField: 'name', sort: [{ field: 'expected_revenue' }] },
    })));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("a virtual 'formula' field");
  });

  it('controls: no key, `true`, a dotted path, a system column and another package\'s object are not this rule\'s', () => {
    const findings = validateSortableFields(pageStack({
      ...region(
        {
          type: 'record:related_list',
          properties: {
            objectName: 'help_ticket',
            relationshipField: 'subject',
            // A dotted path is refused by the door as its own verdict; neither
            // family judges it. An unknown name is #30093's (below).
            sort: [{ field: 'subject' }, { field: 'priority' }, { field: 'owner.name' }, { field: 'created_at' }],
          },
        },
        { type: 'object-grid', properties: { objectName: 'not_in_this_stack', sort: [{ field: 'body' }] } },
        // A block with no `sort` prop of its own is not read for one.
        { type: 'record:highlights', properties: { object: 'help_ticket', sort: [{ field: 'body' }] } },
      ),
      record: { object: 'help_ticket', sort: [{ field: 'priority' }] },
    }));
    expect(findings).toEqual([]);
  });

  it('a source-authored page\'s cached regions are not walked', () => {
    expect(validateSortableFields(pageStack({
      ...region({ type: 'object-grid', properties: { objectName: 'help_ticket', sort: [{ field: 'body' }] } }),
      kind: 'react',
    }))).toEqual([]);
  });
});

/**
 * [#30093] Existence and provenance on every stored page sort slot. The list
 * door answers an unknown sort name `400 INVALID_SORT` on every load, so a page
 * slot naming one is graded `error`, like a list view's `sort-field-unknown`,
 * under the page family's id. Before #30093 two slots warned (from
 * `validate-page-field-bindings`) and the rest were read by nothing.
 */
describe('validateSortableFields — an unknown field on a stored PAGE sort (#30093)', () => {
  const everySlot = (field: string) => ({
    ...region(
      { type: 'record:related_list', properties: { objectName: 'help_ticket', relationshipField: 'subject', sort: [{ field }] } },
      {
        type: 'record:related_list',
        dataSource: { object: 'help_ticket', sort: [{ field, order: 'desc' }] },
        properties: { relationshipField: 'subject', parentDataSource: { object: 'help_ticket', sort: [{ field }] } },
      },
      { type: 'object-grid', properties: { objectName: 'help_ticket', sort: [{ field: 'subject' }, { field }] } },
      { type: 'record:line_items', properties: { childObject: 'help_ticket', sort: [{ field }] } },
      { type: 'list-view', properties: { type: 'grid', data: { provider: 'object', object: 'help_ticket' }, sort: [{ field }] } },
      { type: 'element:number', dataSource: { object: 'help_ticket', sort: [{ field }] }, properties: { field: 'priority' } },
    ),
    interfaceConfig: { source: 'help_ticket', sort: [{ field }] },
    record: { object: 'help_ticket', sort: [{ field }] },
  });
  const SLOT_PATHS = [
    'pages[0].regions[0].components[0].properties.sort[0]',
    'pages[0].regions[0].components[1].dataSource.sort[0]',
    'pages[0].regions[0].components[1].properties.parentDataSource.sort[0]',
    'pages[0].regions[0].components[2].properties.sort[1]',
    'pages[0].regions[0].components[3].properties.sort[0]',
    'pages[0].regions[0].components[4].properties.sort[0]',
    'pages[0].regions[0].components[5].dataSource.sort[0]',
    'pages[0].interfaceConfig.sort[0]',
    'pages[0].record.sort[0]',
  ];

  it('refuses it at every page slot, as `page-field-unknown` at `error`, at the slot path', () => {
    const findings = validateSortableFields(pageStack(everySlot('subjcet')));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual(
      SLOT_PATHS.map((path) => [PAGE_FIELD_UNKNOWN, 'error', path]),
    );
    expect(findings[0].message).toBe(
      'field "subjcet" is not a field on object "help_ticket" — the record:related_list sort orders by it, ' +
        'so every load answers 400 INVALID_SORT.',
    );
    expect(findings[0].hint).toBe('Fix the field name, or add "subjcet" to help_ticket. Did you mean "subject"?');
    expect(findings.map((f) => f.where)).toContain('page "p" · record');
  });

  it('is the one reader of a page sort: validate-page-field-bindings reports none of those slots', () => {
    const stack = pageStack(everySlot('subjcet'));
    const bindingPaths = validatePageFieldBindings(stack).map((f) => f.path);
    expect(bindingPaths.filter((p) => /\.sort(\[|\.|$)/.test(p))).toEqual([]);
    // Non-vacuity: the same walk still reads a related list's other child refs.
    const withColumn = pageStack(region({
      type: 'record:related_list',
      properties: { objectName: 'help_ticket', relationshipField: 'subject', columns: ['subjcet'], sort: [{ field: 'subjcet' }] },
    }));
    expect(validatePageFieldBindings(withColumn).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.columns[0]',
    ]);
  });

  it('binds each slot to the object its renderer reads', () => {
    // `body` is a help_ticket field and not a crm_opportunity one.
    const blockOnDataSource = validateSortableFields(pageStack(region({
      type: 'object-grid',
      dataSource: { object: 'crm_opportunity' },
      properties: { objectName: 'help_ticket', sort: [{ field: 'subject' }] },
    })));
    expect(blockOnDataSource.map((f) => [f.rule, f.path])).toEqual([
      [PAGE_FIELD_UNKNOWN, 'pages[0].regions[0].components[0].properties.sort[0]'],
    ]);
    expect(blockOnDataSource[0].message).toContain('object "crm_opportunity"');
    const listPageOnPageObject = validateSortableFields(pageStack({
      name: 'p', type: 'list', object: 'crm_opportunity', interfaceConfig: { sort: [{ field: 'subject' }] },
    }));
    expect(listPageOnPageObject.map((f) => f.message)).toEqual([expect.stringContaining('object "crm_opportunity"')]);
  });

  it('judges the head of the legacy string form, its `-field` shorthand and each comma-separated key', () => {
    const listPage = (sort: unknown) => pageStack({ name: 'p', type: 'list', object: 'help_ticket', interfaceConfig: { sort } });
    expect(validateSortableFields(listPage('subject desc'))).toEqual([]);
    const bad = validateSortableFields(listPage('ghost_col desc'));
    expect(bad.map((f) => [f.rule, f.path])).toEqual([[PAGE_FIELD_UNKNOWN, 'pages[0].interfaceConfig.sort']]);
    expect(bad[0].message).toContain('"ghost_col"');
    expect(bad[0].message).not.toContain('ghost_col desc');
    expect(validateSortableFields(listPage('-ghost_col')).map((f) => f.rule)).toEqual([PAGE_FIELD_UNKNOWN]);
    expect(validateSortableFields(listPage('subject asc, ghost_col desc')).map((f) => f.path)).toEqual([
      'pages[0].interfaceConfig.sort[1]',
    ]);
  });

  it('skips what the family cannot judge: a dotted path, another package\'s object, an object with no field map', () => {
    const findings = validateSortableFields({
      objects: [ticket, { name: 'introspected_table' }],
      pages: [region(
        { type: 'object-grid', properties: { objectName: 'help_ticket', sort: [{ field: 'ghost.name' }] } },
        { type: 'object-grid', properties: { objectName: 'not_in_this_stack', sort: [{ field: 'ghost' }] } },
        { type: 'object-grid', properties: { objectName: 'introspected_table', sort: [{ field: 'ghost' }] } },
      )],
    });
    expect(findings).toEqual([]);
  });

  it('asks provenance of an injected anchor on an external object, at `warning`, and not on the local twin', () => {
    const page = (object: string) => ({ name: 'p', type: 'list', object, interfaceConfig: { sort: [{ field: 'created_at' }] } });
    const external = validateSortableFields({ objects: [externalObject], pages: [page('showcase_ext_customer')] });
    expect(external.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [PAGE_FIELD_UNPROVISIONED, 'warning', 'pages[0].interfaceConfig.sort[0]'],
    ]);
    expect(external[0].message).toContain('so its ORDER BY is dropped');
    expect(external[0].hint).toContain('columnMap');
    expect(validateSortableFields({ objects: [localTwin], pages: [page('showcase_customer')] })).toEqual([]);
  });

  it('an author-declared field of a system name is the author\'s column, judged by the projection', () => {
    const owned = { name: 'help_ticket', fields: { ...ticketFields, created_at: { type: 'datetime', label: 'Created', sortable: false } } };
    const findings = validateSortableFields({
      objects: [owned],
      pages: [{ name: 'p', type: 'list', object: 'help_ticket', interfaceConfig: { sort: [{ field: 'created_at' }] } }],
    });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[SORT_FIELD_UNSORTABLE, 'pages[0].interfaceConfig.sort[0]']]);
  });
});

/** As much of a zod (v4) node as the drift pin below reads. */
interface ZodDefLite { type?: string; shape?: Record<string, unknown>; in?: unknown; getter?: () => unknown; innerType?: unknown }
const defOf = (node: unknown): ZodDefLite | undefined => (node as { _zod?: { def?: ZodDefLite } } | undefined)?._zod?.def;
function shapeOf(schema: unknown): Record<string, unknown> | undefined {
  let def = defOf(schema);
  for (let hops = 0; def && !def.shape && hops < 4; hops++) {
    if (def.type === 'pipe') def = defOf(def.in);
    else if (def.type === 'lazy' && def.getter) def = defOf(def.getter());
    else break;
  }
  return def?.shape;
}
function isLive(prop: unknown): boolean {
  let def = defOf(prop);
  for (let hops = 0; def && hops < 6; hops++) {
    if (def.type === 'never') return false;
    if (def.innerType === undefined) return true;
    def = defOf(def.innerType);
  }
  return true;
}

describe('PAGE_BLOCK_SORT_OBJECT_PROP — pinned against ComponentPropsMap (#30023)', () => {
  it('lists exactly the components whose props declare a live `sort`, each with a live object prop', () => {
    const declaring = Object.entries(ComponentPropsMap as Record<string, unknown>)
      .filter(([, schema]) => { const shape = shapeOf(schema); return !!shape && 'sort' in shape && isLive(shape.sort); })
      .map(([type]) => type)
      .sort();
    // Non-vacuity: the detector sees a tombstone as dead and a live key as live.
    const picker = shapeOf((ComponentPropsMap as Record<string, unknown>)['element:record_picker']);
    expect(picker && isLive(picker.sort)).toBe(false);
    expect(declaring).toEqual(Object.keys(PAGE_BLOCK_SORT_OBJECT_PROP).sort());
    for (const [type, objectProp] of Object.entries(PAGE_BLOCK_SORT_OBJECT_PROP)) {
      const shape = shapeOf((ComponentPropsMap as Record<string, unknown>)[type])!;
      const head = objectProp.split('.')[0];
      expect(head in shape && isLive(shape[head]), `${type}.${objectProp}`).toBe(true);
    }
  });
});

// [#32144] An `object-grid` block's `aggregations` — `sum` / `avg` over a field
// the aggregate × field-type table refuses is refused at authoring, by the
// table's own predicate (the one the engine's `aggregate` door refuses by).
const gridTaskFields = {
  title: { type: 'text', label: 'Title' },
  notes: { type: 'textarea', label: 'Notes' },
  due_on: { type: 'date', label: 'Due' },
  closed_at: { type: 'datetime', label: 'Closed' },
  stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }] },
  account: { type: 'lookup', label: 'Account', reference: 'crm_opportunity' },
  done: { type: 'boolean', label: 'Done' },
  pinned: { type: 'toggle', label: 'Pinned' },
  hours: { type: 'number', label: 'Hours' },
  cost: { type: 'currency', label: 'Cost' },
  rate: { type: 'percent', label: 'Rate' },
  score: { type: 'formula', label: 'Score', expression: 'hours * 2', returnType: 'number' },
  labels: { type: 'tags', label: 'Labels' },
  legacy_count: { type: 'integer', label: 'Legacy count' },
  payload: { type: 'json', label: 'Payload' },
  watchers: { type: 'lookup', label: 'Watchers', reference: 'crm_opportunity', multiple: true },
};
const gridStack = (aggregations: unknown, extra: Record<string, unknown> = {}) => ({
  objects: [{ name: 'grid_task', fields: gridTaskFields }, { name: 'crm_opportunity', fields: opportunityFields }],
  pages: [{
    name: 'board',
    type: 'app',
    regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', aggregations, ...extra } }] }],
  }],
});
const gridFindings = (aggregations: unknown, extra?: Record<string, unknown>) =>
  validateSortableFields(gridStack(aggregations, extra)).filter((f) => f.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED);

describe('validateSortableFields — object-grid aggregations over a refused field type (#32144)', () => {
  it.each([
    ['text', 'sum', 'title'],
    ['text', 'avg', 'notes'],
    ['date', 'sum', 'due_on'],
    ['datetime', 'avg', 'closed_at'],
    ['date (a registry-injected column)', 'sum', 'created_at'],
    ['option', 'sum', 'stage'],
    ['reference', 'avg', 'account'],
    ['multi-option (JSON-stored)', 'sum', 'labels'],
  ])('refuses `%s` family: %s over "%s", at `error`, at the entry\'s path', (_family, type, field) => {
    const findings = gridFindings([{ field: 'hours', type: 'sum' }, { field, type }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: GRID_AGGREGATION_FIELD_TYPE_REFUSED,
      where: 'page "board" · object-grid',
      path: 'pages[0].regions[0].components[0].properties.aggregations[1]',
    });
    expect(findings[0].message).toContain(`"${type}" over "${field}"`);
    expect(findings[0].message).toContain('400 INVALID_FIELD on the server');
  });

  it('names the aggregates the field\'s type accepts, read off the table', () => {
    const [onDate] = gridFindings([{ field: 'due_on', type: 'avg' }]);
    expect(onDate.hint).toBe('Point "avg" at a numeric field, or aggregate "due_on" with one its `date` type accepts: count, count_distinct, min, max.');
    const [onText] = gridFindings([{ field: 'title', type: 'sum' }]);
    expect(onText.hint.endsWith('accepts: count, count_distinct.')).toBe(true);
  });

  it('refuses a `formula` (virtual) field with the spec\'s one remedy, and `sum` over a `percent` (a rate does not add)', () => {
    const [onFormula] = gridFindings([{ field: 'score', type: 'sum' }]);
    expect(onFormula.hint).toBe(VIRTUAL_FIELD_AGGREGATE_REMEDY);
    expect(gridFindings([{ field: 'rate', type: 'sum' }]).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.aggregations[0]',
    ]);
  });

  it('passes what the table accepts: numeric sum / avg, `avg` over a percent, and booleans (ruled: they aggregate as numbers)', () => {
    expect(gridFindings([
      { field: 'hours', type: 'sum' },
      { field: 'cost', type: 'avg' },
      { field: 'rate', type: 'avg' },
      { field: 'done', type: 'sum' },
      { field: 'done', type: 'avg' },
      { field: 'pinned', type: 'avg' },
    ])).toEqual([]);
  });

  it('`count` over any field passes', () => {
    expect(gridFindings([
      { field: 'title', type: 'count' },
      { field: 'score', type: 'count' },
      { field: 'payload', type: 'count' },
      { field: 'watchers', type: 'count' },
    ])).toEqual([]);
  });

  // [#32449] The table's other rows, on this surface: the door refuses them too.
  it.each([
    ['min / max over a string-class field', 'min', 'title', '`text`'],
    ['min / max over an option field', 'max', 'stage', '`select`'],
    ['min / max over a JSON-stored field', 'max', 'labels', '`tags`'],
    ['count_distinct over a structured-JSON field', 'count_distinct', 'payload', '`json`'],
    ['count_distinct over a multi-option field', 'count_distinct', 'labels', '`tags`'],
    ['count_distinct over a multi-value declaration', 'count_distinct', 'watchers', '`lookup` with `multiple: true`'],
  ])('[#32449] refuses %s: %s over "%s", at `error`', (_family, type, field, declared) => {
    const findings = gridFindings([{ field: 'due_on', type: 'min' }, { field, type }]);
    expect(findings.map((f) => [f.severity, f.path])).toEqual([
      ['error', 'pages[0].regions[0].components[0].properties.aggregations[1]'],
    ]);
    expect(findings[0].message).toContain(`"${type}" over "${field}" (${declared} on "grid_task") is refused by the aggregate door`);
  });

  it('[#32449] passes the accepted controls of those rows: min / max over a date, a datetime, a number, a boolean; count_distinct over a scalar', () => {
    expect(gridFindings([
      { field: 'due_on', type: 'min' },
      { field: 'closed_at', type: 'max' },
      { field: 'hours', type: 'max' },
      { field: 'done', type: 'min' },
      { field: 'pinned', type: 'max' },
      { field: 'title', type: 'count_distinct' },
      { field: 'stage', type: 'count_distinct' },
      { field: 'account', type: 'count_distinct' },
    ])).toEqual([]);
  });

  it('[#32449] the remedy names where to point each row, and what the declaration accepts', () => {
    const [onText] = gridFindings([{ field: 'title', type: 'max' }]);
    expect(onText.hint).toBe('Point "max" at a numeric, date/time or boolean field, or aggregate "title" with one its `text` type accepts: count, count_distinct.');
    const [onJson] = gridFindings([{ field: 'payload', type: 'count_distinct' }]);
    expect(onJson.hint).toBe('Point "count_distinct" at a field that stores one scalar value, or aggregate "payload" with one its `json` type accepts: count.');
    const [onMulti] = gridFindings([{ field: 'watchers', type: 'count_distinct' }]);
    expect(onMulti.hint).toBe('Point "count_distinct" at a field that stores one scalar value, or aggregate "watchers" with one its `lookup` with `multiple: true` declaration accepts: count.');
  });

  it('[#32449] agrees with the table and `isMultiValueField` on every function over every declared `FieldType`', () => {
    for (const fn of Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY)) {
      for (const type of FieldType.options) {
        for (const multiple of [false, true]) {
          const stack = {
            objects: [{ name: 'grid_task', fields: { probe: { type, label: 'Probe', ...(multiple ? { multiple } : {}) } } }],
            pages: [{ name: 'board', type: 'app', regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', aggregations: [{ field: 'probe', type: fn }] } }] }] }],
          };
          const findings = validateSortableFields(stack).filter((f) => f.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED);
          const accepted = (AGGREGATE_FIELD_TYPE_COMPATIBILITY as Record<string, readonly string[]>)[fn].includes(type)
            && !(fn === 'count_distinct' && isMultiValueField({ type, multiple }));
          expect(findings.length, `${fn} over ${type}${multiple ? ' (multiple)' : ''}`).toBe(accepted ? 0 : 1);
        }
      }
    }
  });

  it('[#32449] the longest declaration spelling (`multiple: true`) leaves room for ordinary names within 200 characters', () => {
    const stack = {
      objects: [{ name: 'crm_opportunity_snapshot', fields: { opportunity_watchers_list: { type: 'lookup', label: 'W', reference: 'crm_opportunity', multiple: true } } }],
      pages: [{ name: 'board', type: 'app', regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'crm_opportunity_snapshot', aggregations: [{ field: 'opportunity_watchers_list', type: 'count_distinct' }] } }] }] }],
    };
    const [f] = validateSortableFields(stack).filter((x) => x.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED);
    expect(f.message.length, f.message).toBeLessThanOrEqual(200);
    expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
  });

  it('[#32449] a `type` outside the table\'s vocabulary is the schema\'s refusal, not this verdict', () => {
    expect(gridFindings([{ field: 'title', type: 'median' }, { field: 'title', type: ['sum'] }])).toEqual([]);
  });

  it('skips what it cannot judge: an unknown field, a dotted path, an object the stack does not define, no binding', () => {
    expect(gridFindings([{ field: 'nope', type: 'sum' }, { field: 'account.amount', type: 'avg' }])).toEqual([]);
    expect(gridFindings([{ field: 'title', type: 'sum' }], { objectName: 'elsewhere_object' })).toEqual([]);
    expect(gridFindings([{ field: 'title', type: 'sum' }], { objectName: undefined })).toEqual([]);
  });

  it('skips a field with no declared type (`id`) and a type outside `FieldType`, as the door does', () => {
    expect(gridFindings([{ field: 'id', type: 'sum' }, { field: 'legacy_count', type: 'avg' }])).toEqual([]);
  });

  it('judges a field an `objectExtensions` entry adds, and leaves a field two packages tie on unjudged', () => {
    const ext = (label: string) => ({ manifest: { objectExtensions: [{ extend: 'grid_task', priority: 200, fields: { remark: { type: 'text', label } } }] } });
    const once = { ...gridStack([{ field: 'remark', type: 'sum' }]), packages: [ext('A')] };
    expect(validateSortableFields(once).filter((f) => f.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED).map((f) => f.path))
      .toEqual(['pages[0].regions[0].components[0].properties.aggregations[0]']);
    const tied = { ...gridStack([{ field: 'remark', type: 'sum' }]), packages: [ext('A'), ext('B')] };
    expect(validateSortableFields(tied).filter((f) => f.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED)).toEqual([]);
  });

  it('binds the block by its `dataSource.object` first, then `properties.objectName`', () => {
    const stack = gridStack([{ field: 'name', type: 'sum' }]);
    const grid = (stack.pages[0].regions[0].components[0] as Record<string, unknown>);
    // `name` is a text field on crm_opportunity and does not exist on grid_task.
    expect(validateSortableFields(stack).filter((f) => f.rule === GRID_AGGREGATION_FIELD_TYPE_REFUSED)).toEqual([]);
    grid.dataSource = { object: 'crm_opportunity' };
    expect(validateSortableFields(stack).map((f) => f.rule)).toEqual([GRID_AGGREGATION_FIELD_TYPE_REFUSED]);
  });

  it('`os explain` carries the reasoning the verdict leaves out', () => {
    const text = explanationOf(GRID_AGGREGATION_FIELD_TYPE_REFUSED);
    for (const fact of ['`AGGREGATE_FIELD_TYPE_COMPATIBILITY`', '`400 INVALID_FIELD`', 'boolean and toggle', 'STORED', 'collation', '`multiple: true`']) {
      expect(text, fact).toContain(fact);
    }
  });
});

// [#32503] An `object-grid` block's `properties.columns[].summary` — the list
// view's own column entry, on a third carrier — is judged by the list view's
// own verdict and reported under the list view's id, from the grid walk.
const columnGridStack = (columns: unknown, extra: Record<string, unknown> = {}) => ({
  objects: [{ name: 'grid_task', fields: gridTaskFields }, { name: 'crm_opportunity', fields: opportunityFields }],
  pages: [{
    name: 'board',
    type: 'app',
    regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', columns, ...extra } }] }],
  }],
});
const columnFindings = (columns: unknown, extra?: Record<string, unknown>) =>
  validateSortableFields(columnGridStack(columns, extra)).filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED);
const COLUMN_PATH = 'pages[0].regions[0].components[0].properties.columns';

describe('validateSortableFields — object-grid column summaries over a refused field type (#32503)', () => {
  it('refuses `sum` over a text column, at `error`, under the list view\'s id, at the summary\'s path', () => {
    const findings = columnFindings([{ field: 'hours', summary: 'sum' }, { field: 'title', summary: 'sum' }]);
    expect(findings.map((f) => [f.severity, f.rule, f.where, f.path])).toEqual([
      ['error', LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED, 'page "board" · object-grid › columns[1].summary', `${COLUMN_PATH}[1].summary`],
    ]);
    expect(findings[0].message).toContain('summary "sum" over "title" (`text`) is refused by the aggregate door');
  });

  it.each([
    ['the object form aggregates `summary.field`, not the column', { field: 'hours', summary: { type: 'avg', field: 'notes' } }, '"avg" over "notes"'],
    ['`count_unique` lowers to `count_distinct`, refused over a JSON-stored field', { field: 'labels', summary: 'count_unique' }, '"count_unique" over "labels"'],
    ['`min` over a string-class field', { field: 'stage', summary: 'min' }, '"min" over "stage"'],
    ['`count_unique` over a multi-value declaration', { field: 'watchers', summary: { type: 'count_unique' } }, '"count_unique" over "watchers"'],
    ['`sum` over a `formula` (virtual) field', { field: 'score', summary: 'sum' }, '"sum" over "score"'],
  ])('refuses %s', (_case, column, spelled) => {
    const findings = columnFindings([column]);
    expect(findings.map((f) => f.path)).toEqual([`${COLUMN_PATH}[0].summary`]);
    expect(findings[0].message).toContain(spelled);
  });

  it('passes what the door accepts: `sum` over a number, `min` / `max` over a date, `avg` over a percent, `sum` over a boolean', () => {
    expect(columnFindings([
      { field: 'hours', summary: 'sum' },
      { field: 'due_on', summary: 'min' },
      { field: 'closed_at', summary: { type: 'max' } },
      { field: 'rate', summary: 'avg' },
      { field: 'done', summary: 'sum' },
      { field: 'title', summary: { type: 'sum', field: 'cost' } },
      { field: 'stage', summary: 'count_unique' },
    ])).toEqual([]);
  });

  it('judges nothing that compares no value: `none`, `count`, the filled / empty members, a string column list', () => {
    expect(columnFindings([
      { field: 'title', summary: 'none' },
      { field: 'title', summary: 'count' },
      { field: 'payload', summary: 'count_filled' },
      { field: 'labels', summary: 'percent_empty' },
    ])).toEqual([]);
    expect(columnFindings(['title', 'notes'])).toEqual([]);
  });

  it('skips what it cannot judge: an unknown field, a dotted path, an object the stack does not define, no binding', () => {
    expect(columnFindings([{ field: 'nope', summary: 'sum' }, { field: 'account.amount', summary: 'avg' }])).toEqual([]);
    expect(columnFindings([{ field: 'title', summary: 'sum' }], { objectName: 'elsewhere_object' })).toEqual([]);
    expect(columnFindings([{ field: 'title', summary: 'sum' }], { objectName: undefined })).toEqual([]);
  });

  it('binds the block by its `dataSource.object` first, then `properties.objectName`', () => {
    const stack = columnGridStack([{ field: 'name', summary: 'sum' }]);
    const grid = (stack.pages[0].regions[0].components[0] as Record<string, unknown>);
    expect(validateSortableFields(stack).filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED)).toEqual([]);
    grid.dataSource = { object: 'crm_opportunity' };
    expect(validateSortableFields(stack).map((f) => f.rule)).toEqual([LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED]);
  });

  it('judges the columns and the aggregations of one block side by side, each under its own id', () => {
    const findings = validateSortableFields(columnGridStack(
      [{ field: 'title', summary: 'sum' }],
      { aggregations: [{ field: 'notes', type: 'avg' }] },
    ));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED, `${COLUMN_PATH}[0].summary`],
      [GRID_AGGREGATION_FIELD_TYPE_REFUSED, 'pages[0].regions[0].components[0].properties.aggregations[0]'],
    ]);
  });

  it('gives the verdict, the words and the fix a list view\'s column gives, for every member over every declared `FieldType`', () => {
    let refused = 0;
    for (const member of Object.keys(COLUMN_SUMMARY_AGGREGATION)) {
      for (const type of FieldType.options) {
        for (const multiple of [false, true]) {
          const fields = { probe: { type, label: 'Probe', ...(multiple ? { multiple } : {}) } };
          const column = { field: 'probe', summary: member };
          const onGrid = validateSortableFields({
            objects: [{ name: 'grid_task', fields }],
            pages: [{ name: 'board', type: 'app', regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', columns: [column] } }] }] }],
          }).filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED);
          const onListView = validateListViewFieldRefs({
            objects: [{ name: 'grid_task', fields, listViews: { all: { type: 'grid', columns: [column] } } }],
          }).filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED);
          const label = `${member} over ${type}${multiple ? ' (multiple)' : ''}`;
          expect(onGrid.map((f) => [f.severity, f.message, f.hint]), label)
            .toEqual(onListView.map((f) => [f.severity, f.message, f.hint]));
          refused += onGrid.length;
        }
      }
    }
    // Non-vacuity: the sweep refused pairs on both carriers, not zero against zero.
    expect(refused).toBeGreaterThan(0);
  });

  it('is refused at the page publish door', () => {
    const page = {
      name: 'board',
      type: 'app',
      regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', columns: [{ field: 'title', summary: 'sum' }] } }] }],
    };
    const context = { objects: [{ name: 'grid_task', fields: gridTaskFields }] };
    const refused = runRuntimeAuthoringRules({ type: 'page', item: page, context }).errors
      .filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED);
    expect(refused).toHaveLength(1);
    const accepted = { ...page, regions: [{ name: 'main', components: [{ type: 'object-grid', properties: { objectName: 'grid_task', columns: [{ field: 'hours', summary: 'sum' }] } }] }] };
    expect(runRuntimeAuthoringRules({ type: 'page', item: accepted, context }).errors
      .filter((f) => f.rule === LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED)).toEqual([]);
  });

  it('`os explain` names the object-grid carrier', () => {
    const text = explanationOf(LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED);
    for (const fact of ['`object-grid`', '`properties.columns`', 'saved']) expect(text, fact).toContain(fact);
  });
});

describe('[#22161] one-line verdicts — the three sort ids', () => {
  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    // The coverage control first: each id fired at least once, so the shape
    // assertion below cannot pass over an empty record.
    // [#30093] Page sort slots answer existence and provenance under the page
    // family's ids, so those fire from this module too and are held to the
    // same one-line shape.
    // [#32144] The grid-aggregation verdict rides the same member and is held
    // to the same shape.
    expect([...new Set(fired.map((f) => f.rule))].sort()).toEqual(
      [
        ...SORT_IDS, PAGE_FIELD_UNKNOWN, PAGE_FIELD_UNPROVISIONED, GRID_AGGREGATION_FIELD_TYPE_REFUSED,
        // [#32503] The grid's column summaries, under the list view's id.
        LIST_VIEW_SUMMARY_FIELD_TYPE_REFUSED,
      ].sort(),
    );
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('the virtual verdict states the storage fact in the SEARCH axis\' wording', () => {
    const [f] = validateSortableFields(withListView([{ field: 'expected_revenue', order: 'desc' }]));
    expect(f.message).toBe(
      "list-view sort orders by \"expected_revenue\" on object \"crm_opportunity\", a virtual 'formula' " +
        'field: its value is computed on read and never stored, so there is no column to ORDER BY',
    );
  });

  // What each verdict stopped saying, which `os explain RULE_ID` now prints.
  const MOVED: Record<string, readonly string[]> = {
    [SORT_FIELD_UNKNOWN]: ['FIRST fetch', '`assertSortFieldsExist`', 'HEAD segment', 'flattened list overlay', 'introspected datasource'],
    [SORT_FIELD_UNSORTABLE]: ['byte-identical', '`assertOrderByIsMaterializable`', '`SEARCH_VIRTUAL_TYPES`', '`COMPUTED_VALUE_TYPES`'],
    [SORT_FIELD_UNPROVISIONED]: ['ADR-0015', 'byte-identical', 'judge only `formula`', '`limit` / `offset`', 'warning'],
  };

  it('covers exactly the three ids', () => {
    expect(Object.keys(MOVED).sort()).toEqual([...SORT_IDS].sort());
  });

  it.each([...SORT_IDS])('`os explain %s` carries what its verdict no longer says', (rule) => {
    expect(explainRule(rule), `no \`os explain ${rule}\` entry`).toBeDefined();
    const text = explanationOf(rule);
    for (const fact of MOVED[rule]) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });

  it('the explanation\'s virtual-type claim matches the spec predicate it names', () => {
    // The explanation module imports nothing, so the one fact it states about
    // the predicate is held to the predicate here.
    expect([...SEARCH_VIRTUAL_TYPES]).toEqual(['formula']);
    expect(explanationOf(SORT_FIELD_UNSORTABLE)).toContain('`formula` alone');
  });
});

// [#22161] Slice 14: the `fix:` line of the three ids. Each names its remedy in
// one line; that both runtime doors refuse a formula sort, and how to vouch for
// or opt out of an unprovisioned anchor, are the explanations'. The field roster
// is not echoed: the verdict's "Did you mean" names the near miss.
describe('[#22161] one-line fixes — the three sort ids', () => {
  it('every `fix:` line the cases above fired is one line of at most 200 characters', () => {
    // Coverage control: every arm fired — both unknown arms, the formula field
    // and the anchor.
    const hints = fired.map((f) => f.hint);
    expect(hints.some((h) => h.startsWith('Fix the name, or add "')), 'unknown name').toBe(true);
    expect(hints.some((h) => h.startsWith("'sort' reaches only")), 'dotted').toBe(true);
    expect(hints.some((h) => h.startsWith('Denormalise the value onto "')), 'formula').toBe(true);
    expect(hints.some((h) => h.startsWith("If the remote table carries '")), 'anchor').toBe(true);
    for (const f of fired) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  const MOVED_FROM_FIX: Record<string, readonly string[]> = {
    [SORT_FIELD_UNKNOWN]: ["`sort` reaches only the object's own columns"],
    [SORT_FIELD_UNSORTABLE]: ['`400 INVALID_SORT`', '`assertSortFieldsExist`', '`assertOrderByIsMaterializable`'],
    [SORT_FIELD_UNPROVISIONED]: ['`columnMap`', "`ownership: 'none'`", '`systemFields: { audit: false }`'],
  };

  it.each([...SORT_IDS])('`os explain %s` carries what its `fix:` line no longer says', (rule) => {
    const text = explanationOf(rule);
    for (const fact of MOVED_FROM_FIX[rule]) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });
});
