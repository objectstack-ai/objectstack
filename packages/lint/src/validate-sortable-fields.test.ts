// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SEARCH_VIRTUAL_TYPES, COMPUTED_VALUE_TYPES } from '@objectstack/spec/data';
import {
  validateSortableFields,
  checkSortDeclaration,
  SORT_FIELD_UNKNOWN,
  SORT_FIELD_UNSORTABLE,
  SORT_FIELD_UNPROVISIONED,
} from './validate-sortable-fields.js';
import { indexObjectSearchTargets } from './validate-searchable-fields.js';
import { indexUnprovisionedAnchors } from './system-fields.js';

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
    expect(findings[0].hint).toContain('400 INVALID_SORT');
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
    // reports (`unprovisionedAnchorCause`).
    expect(f.message).toContain('injected system column with NO storage behind it');
    expect(f.message).toContain('ADR-0015');
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
