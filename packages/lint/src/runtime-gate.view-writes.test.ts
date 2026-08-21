// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9313 — the two list-view FIELD rules at the runtime publish gate, on the
// flattened standalone list overlay. #10001 extends the same door onto the
// standalone ViewItem RECORD (`config.sort` / `config.searchableFields`, one
// level down) — the boundary marker #9313 left here is flipped in the record
// block below.
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
    // A regression pin on the FLATTENED shape, not the granularity
    // discriminator: `validateActionNameRefs` walks `views[].list` /
    // `views[].listViews.*` and has no flattened-overlay rung, so on THIS body
    // it stays silent even if its member declaration crossed onto `view`
    // (measured by ablation — crossing it left this test green). The
    // behavioural discriminator is the CONTAINER control below; the
    // declaration itself is pinned by the member-surface test.
    const result = gate(overlay({ rowActions: ['close_case'], bulkActions: ['mass_close'] }));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    // The suite RAN — the zero above is a dispatch decision, not a dead gate.
    expect(result.rulesRun).toContain('validateReferenceIntegrity');
  });

  it('does NOT refuse a CONTAINER view write naming a stack-level action — the phantom channel stays walled', () => {
    // THE behavioural control for the granularity decision, on the shape
    // where the channel is real. A container's `list.rowActions` IS walked by
    // `validateActionNameRefs` (`views[].list` rung), and the per-write
    // snapshot carries no `stack.actions` — so if the suite's widening let
    // that member ride onto `view` writes, this legitimate body would be
    // refused with `action-name-undefined` for every stack-level action it
    // names (measured: 1 finding on the snapshot shape, 0 with the full
    // stack). The member wall is what keeps this green.
    const container = {
      list: {
        type: 'grid',
        data: { provider: 'object', object: 'crm_case' },
        columns: ['name', 'status'],
        rowActions: ['stack_level_close_case'],
        bulkActions: ['stack_level_mass_close'],
      },
    };
    const result = gate(container);
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
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

  // ── [#10001] the ViewItem RECORD rung — the #9313 boundary marker, flipped ──
  //
  // The test that stood here pinned the opposite: "a ViewItem RECORD's nested
  // `config.sort` is not judged here — recorded scope, not a rung that fell
  // off". That marker kept the gap RECORDED until its own card; #10001 is that
  // card, and this block is the rung's proof. The record is
  // `ViewMetadataSchema`'s member 1 (`ViewItemWireSchema`,
  // `{ name, object, viewKind: 'list', config }`) — the shape a Studio-saved
  // view takes through `PUT /api/v1/meta/view`, and a hot one: objectui's
  // `updateView` GETs the stored record and PUTs `{ ...current, ...partial }`
  // (`view.zod.ts`'s #5074 trace), so every pin/reorder toggle round-trips the
  // whole record, `config` included.

  /** A ViewItem record as `saveMetaItem` stores it (original body, verbatim). */
  const record = (
    configPatch: Record<string, unknown>,
    patch: Record<string, unknown> = {},
  ) => ({
    name: 'crm_case.pipeline',
    object: 'crm_case',
    viewKind: 'list',
    config: { type: 'grid', columns: ['name'], ...configPatch },
    ...patch,
  });

  it('REFUSES a record\'s `config.sort` naming an unknown field — the flipped boundary marker (#10001)', () => {
    const { errors } = gate(record({ sort: [{ field: 'amout', order: 'desc' }] }));
    const f = errors.find((e) => e.rule === SORT_FIELD_UNKNOWN);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].config.sort[0]');
    expect(f!.where).toContain('ViewItem record');
  });

  it('REFUSES a record\'s `config.sort` naming a formula field — no column to ORDER BY (#10001)', () => {
    const { errors } = gate(record({ sort: [{ field: 'days_open', order: 'desc' }] }));
    const f = errors.find((e) => e.rule === SORT_FIELD_UNSORTABLE);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].config.sort[0]');
  });

  it('REFUSES a record\'s `config.searchableFields` entry that resolves to no field (#10001)', () => {
    const { errors } = gate(record({ searchableFields: ['name', 'budget'] }));
    const f = errors.find((e) => e.rule === SEARCHABLE_FIELD_UNKNOWN);
    expect(f, JSON.stringify(errors)).toBeDefined();
    expect(f!.path).toBe('views[0].config.searchableFields[1]');
  });

  it('honors the record config\'s own `data.object` binding over the record\'s `object` (#10001)', () => {
    // ADR-0047's explicit retarget, resolved on the CONFIG (where a record's
    // data binding lives), ahead of the record's top-level `object` — the
    // same order every other list-view rung reads.
    const { errors } = gate(record(
      { data: { provider: 'object', object: 'crm_case' }, sort: 'nonexistent_field desc' },
      { object: 'crm_other' },
    ));
    expect(errors.map((e) => e.rule)).toContain(SORT_FIELD_UNKNOWN);
  });

  it('a console-shaped record round-trip publishes clean — `updateView`\'s merged PUT, decorations and all (#10001)', () => {
    // `{ ...current, ...partial }`: `isPinned`/`sortOrder` at the top,
    // `config.sort[].id` carrying objectui's `crypto.randomUUID()` row ids
    // (#5074) — `saveMetaItem` persists the original body, so the gate judges
    // exactly this shape.
    const result = gate(record(
      {
        sort: [{ id: 'a2b4c86e-1111-4111-8111-000000000003', field: 'status', order: 'asc' }],
        searchableFields: ['name'],
      },
      { isPinned: true, sortOrder: 2 },
    ));
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(result.rulesRun).toContain('validateReferenceIntegrity');
  });

  it('judges a record on its `config` rung ONLY — a stray top-level `sort` is not judged as an overlay (#10001)', () => {
    // The rung-split control. The overlay rung's `!isRec(config)` guard keeps
    // record bodies out, and the record rung reads `config` alone — so a
    // record carrying a stray top-level `sort` (the wire schema strips the
    // key, but `saveMetaItem` persists the ORIGINAL body) yields exactly one
    // finding, on the config path. Two findings here = the rungs leaked into
    // each other's shapes; a top-level-path finding = the record was read as
    // an overlay. Both are the drift this control exists to catch.
    const { errors } = gate(record(
      { sort: [{ field: 'amout', order: 'desc' }] },
      { sort: [{ field: 'also_not_a_field', order: 'asc' }] },
    ));
    const sortFindings = errors.filter((e) => e.rule === SORT_FIELD_UNKNOWN);
    expect(sortFindings, JSON.stringify(errors)).toHaveLength(1);
    expect(sortFindings[0].path).toBe('views[0].config.sort[0]');
  });

  it('a FORM record\'s config declares no list-field surface and is not judged (#10001)', () => {
    // The rung keys on `viewKind: 'list'`, mirroring the overlay rung and the
    // wire union's own arms: a `form` record carries `FormViewSchema` config,
    // which has no `sort` / `searchableFields` — a stray one riding in the
    // stored body must not be judged by a list-view rule.
    const { errors } = gate({
      name: 'crm_case.edit',
      object: 'crm_case',
      viewKind: 'form',
      config: { type: 'simple', fields: ['name'], sort: [{ field: 'amout', order: 'desc' }] },
    });
    expect(errors, JSON.stringify(errors)).toEqual([]);
  });

  // ── positive control: the pre-#10001 rungs behave EXACTLY as before ──

  it('the flattened overlay is judged exactly once, on its top-level path — no record-rung leak (#10001)', () => {
    // Passes on origin/main BEFORE the record rung and must keep passing
    // after: one finding, top-level path. A `config`-rung leak into the
    // overlay shape would move the path; a double judgment would add one.
    const { errors } = gate(overlay({ sort: [{ field: 'amout', order: 'desc' }] }));
    const sortFindings = errors.filter((e) => e.rule === SORT_FIELD_UNKNOWN);
    expect(sortFindings, JSON.stringify(errors)).toHaveLength(1);
    expect(sortFindings[0].path).toBe('views[0].sort[0]');
    expect(sortFindings[0].where).toContain('flattened list overlay');
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
