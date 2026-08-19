// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9313 — the two list-view FIELD rules at the runtime publish gate, on the
// flattened standalone list overlay.
//
// The card's own trap, restated because every test here exists to spring it:
// widening the reference-integrity suite's `runtimeTypes` to `view` is
// necessary and NOT sufficient. The rules' metadata walk read
// `objects[].listViews.*` and `views[].list` / `views[].listViews.*` — never a
// TOP-LEVEL flattened overlay, which is precisely the shape a standalone list
// view takes through `PUT /api/v1/meta/view` (the only door a Studio tenant or
// an MCP/AI author has) and the shape the gate snapshots as `views: [item]`.
// A dispatch-only widening is therefore a silent no-op that reads as coverage,
// and the refusal tests below are the ones that distinguish the two: they FAIL
// with the widening alone and pass only once the walk's self rung exists.
//
// Like `runtime-gate.test.ts`'s #7220 block, everything drives the REAL
// dispatch path — `runRuntimeAuthoringRules`, the function
// `packages/metadata-protocol/src/runtime-authoring-gate.ts` calls — with
// bodies shaped exactly as `saveMetaItem` stores them (identity stamped by
// `normalizeViewMetadata`, console `sort[].id` decorations intact: the store
// persists the ORIGINAL body, so the gate judges them too).

import { describe, it, expect } from 'vitest';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';
import { SORT_FIELD_UNKNOWN, SORT_FIELD_UNSORTABLE } from './validate-sortable-fields.js';
import { SEARCHABLE_FIELD_UNKNOWN } from './validate-searchable-fields.js';

/** The live object universe the gate resolves against (`RuntimeStackContext.objects`). */
const objects = [
  {
    name: 'crm_case',
    label: 'Case',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'select', label: 'Status', options: ['open', 'closed'] },
      // A REAL field with no stored column — existence passes, virtuality fails.
      days_open: { type: 'formula', label: 'Days Open' },
    },
  },
];

/**
 * A flattened standalone list overlay, as the wire carries it: a raw ListView
 * config at the TOP level, `object` + `viewKind` required (#7741), plus the
 * console decorations a personalization PUT persists — `sort[].id` is
 * objectui's `crypto.randomUUID()` row id (#5074), stored verbatim because
 * `saveMetaItem` persists the original body.
 */
const overlay = (patch: Record<string, unknown>) => ({
  name: 'crm_case.custom',
  object: 'crm_case',
  viewKind: 'list',
  type: 'grid',
  columns: ['name', 'status'],
  ...patch,
});

const gate = (item: unknown) => runRuntimeAuthoringRules({ type: 'view', item, context: { objects } });

describe('a flattened list overlay at the runtime publish gate (#9313)', () => {
  // ── the refusals the card exists for — red without the walk's self rung ──

  it('REFUSES a top-level `sort` naming an unknown field', () => {
    const { errors } = gate(overlay({
      sort: [{ id: 'a2b4c86e-1111-4111-8111-000000000001', field: 'amout', order: 'desc' }],
    }));
    const f = errors.find((e) => e.rule === SORT_FIELD_UNKNOWN);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].sort[0]');
    expect(f!.where).toContain('flattened list overlay');
  });

  it('REFUSES a top-level `sort` naming a formula field — no column to ORDER BY', () => {
    const { errors } = gate(overlay({ sort: [{ field: 'days_open', order: 'desc' }] }));
    const f = errors.find((e) => e.rule === SORT_FIELD_UNSORTABLE);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].sort[0]');
  });

  it('REFUSES a top-level `searchableFields` entry that resolves to no field', () => {
    const { errors } = gate(overlay({ searchableFields: ['name', 'budget'] }));
    const f = errors.find((e) => e.rule === SEARCHABLE_FIELD_UNKNOWN);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].searchableFields[1]');
  });

  it('honors the overlay\'s own `data.object` binding over its top-level `object`', () => {
    // ADR-0047's explicit retarget, the same resolution order every other
    // list-view rung reads: `days_open` is real on crm_case, so a finding here
    // proves the rung resolved against the RETARGETED object, not the identity
    // binding.
    const { errors } = gate(overlay({
      object: 'crm_other',
      data: { provider: 'object', object: 'crm_case' },
      sort: 'nonexistent_field desc',
    }));
    expect(errors.map((e) => e.rule)).toContain(SORT_FIELD_UNKNOWN);
  });

  // ── what must keep publishing ──

  it('a console-shaped personalization PUT publishes clean — UUID row ids and all', () => {
    const result = gate(overlay({
      sort: [{ id: 'a2b4c86e-1111-4111-8111-000000000002', field: 'status', order: 'asc' }],
      searchableFields: ['name'],
      isPinned: true,
      sortOrder: 3,
    }));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    // "clean" and "nothing ran" must stay distinguishable.
    expect(result.rulesRun).toContain('validateReferenceIntegrity');
  });

  it('a system-column sort publishes clean — the platform\'s own most common ordering', () => {
    const { errors } = gate(overlay({ sort: [{ field: 'created_at', order: 'desc' }] }));
    expect(errors, JSON.stringify(errors)).toEqual([]);
  });

  it('an overlay bound to an object outside the live universe is not judged', () => {
    // Skip ① — the same cross-package posture every walked surface takes.
    const { errors } = gate(overlay({ object: 'pkg_external_case', sort: 'no_such_field' }));
    expect(errors, JSON.stringify(errors)).toEqual([]);
  });

  // ── the granularity wall: exactly two members cross, nothing rides along ──

  it('does NOT refuse an overlay for a rowAction naming a stack-level action — no member rides along', () => {
    // THE control for the whole-suite granularity decision.
    // `validateActionNameRefs` (error-tier) resolves `rowActions[]` against
    // `stack.actions` — a collection the per-write snapshot does not carry —
    // so if the suite's widening let it ride onto `view` writes, this
    // legitimate body would be refused for every stack-level action it names.
    // Its member declaration keeps it on `flow` snapshots; the registry entry
    // comment in `authoring-rules.ts` carries the measurement.
    const result = gate(overlay({ rowActions: ['close_case'], bulkActions: ['mass_close'] }));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    // The suite RAN — the zero above is a dispatch decision, not a dead gate.
    expect(result.rulesRun).toContain('validateReferenceIntegrity');
  });

  it('pins the member surface: exactly the two list-view field rules declare `view`', () => {
    const crossed = REFERENCE_INTEGRITY_RULES
      .filter((r) => (r.runtimeTypes ?? ['flow']).includes('view'))
      .map((r) => r.name);
    expect(crossed).toEqual(['validateSearchableFields', 'validateSortableFields']);
    // And every member still judges flow snapshots — the #4463 P1 surface is
    // not narrowed by the member axis existing.
    const offFlow = REFERENCE_INTEGRITY_RULES
      .filter((r) => !(r.runtimeTypes ?? ['flow']).includes('flow'))
      .map((r) => r.name);
    expect(offFlow).toEqual([]);
  });

  // ── the shapes this card deliberately does not judge ──

  it('a ViewItem RECORD\'s nested `config.sort` is not judged here — recorded scope, not a rung that fell off', () => {
    // `{ name, object, viewKind, config }` is `ViewMetadataSchema`'s member 1;
    // its bad sort lives one level down, in `config`, which no walk reads.
    // #9313's scope is the flattened overlay (the fence in the claim), and the
    // record shape is filed as its own follow-up — this pin is the boundary
    // marker that keeps the gap RECORDED instead of rediscovered.
    const record = {
      name: 'crm_case.pipeline',
      object: 'crm_case',
      viewKind: 'list',
      config: { type: 'grid', columns: ['name'], sort: [{ field: 'amout', order: 'desc' }] },
    };
    const { errors } = gate(record);
    expect(errors, JSON.stringify(errors)).toEqual([]);
  });

  // ── the D4 differential, on the newly reachable rules ──

  it('does not blame a `view` write for a stored object\'s own bad list view', () => {
    // A context object whose built-in list view already violates the sort rule:
    // present in BOTH gate passes, so its finding cancels in the differential
    // and only the write's own (clean) declaration is judged.
    const dirtyContext = [
      {
        ...objects[0],
        listViews: { aging: { type: 'grid', sort: [{ field: 'days_open', order: 'desc' }] } },
      },
    ];
    const result = runRuntimeAuthoringRules({
      type: 'view',
      item: overlay({ sort: [{ field: 'name', order: 'asc' }] }),
      context: { objects: dirtyContext },
    });
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
  });

  // ── the flow door is untouched by the member axis ──

  it('a flow write is still judged by the suite\'s NON-view members', () => {
    // `validateFlowNodeWrites` declares nothing and so keeps the default
    // `flow` surface: a flow whose update_record node writes an unknown field
    // is still refused. If the member axis had narrowed flow snapshots to the
    // two view members, this zero-cost control would go green.
    const badFlow = {
      name: 'close_stale',
      label: 'Close stale',
      trigger: { type: 'record_change', object: 'crm_case', events: ['create'] },
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'upd',
          type: 'update_record',
          config: { object: 'crm_case', fields: { no_such_field: 'x' } },
        },
      ],
    };
    const result = runRuntimeAuthoringRules({ type: 'flow', item: badFlow, context: { objects } });
    expect(result.errors.map((e) => e.rule), JSON.stringify(result.errors)).toContain(
      'flow-node-write-unknown-field',
    );
  });
});
