// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// ViewItem spec conformance for the runtime persistence seam (objectui#3375,
// tail of objectui#3312 / objectstack#4959).
//
// `viewEnvelope` is the app-shell's SECOND ViewItem producer. The first one —
// `createBuildBody` for the metadata-admin `view` resource — is already pinned
// against the real spec by `metadata-admin/view-create-body.test.ts`; this file
// is the same-shaped pin for the runtime "create / save as view" path.
//
// Why a separate pin rather than more `toEqual` cases in
// `runtime-metadata-persistence.test.ts`: the sibling suite asserts the
// envelope's *literal* shape (which keys land where), which stays green even if
// `@objectstack/spec` tightens `ViewItemSchema` underneath us. This file asserts
// the envelope is something the RECORD GATE (ADR-0017 ViewItem) actually
// accepts, so a spec tightening surfaces here instead of at publish time.
//
// This is a ratchet, not a bug repro — every case below is expected GREEN on
// today's producer. A red here means either the producer drifted off-spec or
// the spec moved; read the surfaced zod issues before touching either.
//
// Fixtures are the two real call sites' payloads, not invented shapes:
//   * `ObjectView.handleViewCreate` — CreateViewDialog's `{ type, label, name,
//     [type]: subConfig }` payload, plus the kanban/gallery column massaging
//     that call site performs before handing the spec to `viewEnvelope`.
//   * `ObjectDataPage.handleSaveAsView` — the current list config plus the
//     resolved column list.

import { describe, it, expect } from 'vitest';
import { ViewItemSchema } from '@objectstack/spec/ui';
import { viewEnvelope } from './runtime-metadata-persistence';

/** Assert a produced envelope passes the real spec gate, surfacing zod's issues. */
function expectSpecValid(body: unknown) {
  const res = ViewItemSchema.safeParse(body);
  expect(
    res.success,
    `ViewItem rejected by spec: ${JSON.stringify(res.error?.issues)}\nbody=${JSON.stringify(body)}`,
  ).toBe(true);
}

// The default columns `ObjectView` prefills via `defaultListColumnsFromObject`.
const COLUMNS = ['name', 'stage', 'amount'];

describe('viewEnvelope output conforms to the spec ViewItem gate (objectui#3375)', () => {
  it('produces a spec-valid list ViewItem for the default grid create', () => {
    const env = viewEnvelope(
      'crm_task',
      { type: 'grid', label: 'My Grid', name: 'my_grid', columns: COLUMNS },
      { name: 'my_grid', label: 'My Grid' },
    );
    expect(env.viewKind).toBe('list');
    expect(env.name).toBe('crm_task.my_grid');
    expectSpecValid(env);
  });

  it('produces a spec-valid ViewItem for a kanban create (sub-config + mirrored columns)', () => {
    // `ObjectView` mirrors the resolved column list into `spec.kanban.columns`
    // before calling the seam; `groupByField` comes from CreateViewDialog's
    // REQUIRED_FIELDS_BY_TYPE. Both are required by the spec's kanban config.
    const env = viewEnvelope(
      'crm_task',
      {
        type: 'kanban',
        label: 'Board',
        name: 'board',
        columns: COLUMNS,
        kanban: { groupByField: 'stage', columns: COLUMNS },
      },
      { name: 'board', label: 'Board' },
    );
    expectSpecValid(env);
  });

  it('produces a spec-valid ViewItem for a gallery create (visibleFields mirror)', () => {
    const env = viewEnvelope(
      'crm_task',
      {
        type: 'gallery',
        label: 'Cards',
        name: 'cards',
        columns: COLUMNS,
        gallery: { visibleFields: COLUMNS },
      },
      { name: 'cards', label: 'Cards' },
    );
    expectSpecValid(env);
  });

  it('produces a spec-valid ViewItem for a calendar create (multi-key sub-config)', () => {
    const env = viewEnvelope(
      'crm_task',
      {
        type: 'calendar',
        label: 'Schedule',
        name: 'schedule',
        columns: COLUMNS,
        calendar: { startDateField: 'due_date', titleField: 'name' },
      },
      { name: 'schedule', label: 'Schedule' },
    );
    expectSpecValid(env);
  });

  it('produces a spec-valid ViewItem when the spec carries folded filter rules', () => {
    // `viewFilterFold.foldFilterGroupToSpecRules` is the builder's exit into
    // spec vocabulary: `{ field, operator, value }` with the operator already
    // canonicalised by `normalizeFilterOperator` (so `equals`, never `=`).
    const env = viewEnvelope(
      'crm_task',
      {
        type: 'grid',
        columns: ['name'],
        filter: [{ field: 'stage', operator: 'equals', value: 'open' }],
      },
      { name: 'mine', label: 'Mine' },
    );
    expectSpecValid(env);
  });

  it('stamps a spec-valid config.data binding', () => {
    // The `object` arm of `ViewDataSchema` declares exactly `provider` + `object`
    // and is strict since objectstack#4001, so this fixture no longer carries the
    // `pageSize: 25` it used to. That key was never part of the contract — it was
    // being DROPPED silently, and the assertion that it survived `viewEnvelope`
    // was pinning the leniency rather than a behaviour: the view rendered without
    // whatever the key was meant to configure, and nothing said so.
    //
    // `viewEnvelope` still spreads caller `data` keys through, and that is
    // deliberately left alone — no production caller supplies an extra one, and
    // the spec refusing an undeclared key by name is the loud failure the strict
    // arm exists to produce. What is pinned here is the part that IS the
    // function's job: stamping `provider` and `object` onto whatever it is given.
    const env = viewEnvelope(
      'acct',
      { type: 'grid', columns: [], data: {} },
      { name: 'big', label: 'Big' },
    );
    expect(env.config.data).toEqual({ provider: 'object', object: 'acct' });
    expectSpecValid(env);
  });

  it('stamps the binding even when the caller passes no data at all', () => {
    const env = viewEnvelope('acct', { type: 'grid', columns: [] }, { name: 'nodata', label: 'No data' });
    expect(env.config.data).toEqual({ provider: 'object', object: 'acct' });
    expectSpecValid(env);
  });

  it('keeps the last-resort CJK-label key spec-valid (#2767 P5 fallback path)', () => {
    // `slugify('看板')` is empty, so `deriveViewKey` mints `<type>_<base36>`.
    // That synthetic key still has to satisfy `ViewItemNameSchema`.
    const env = viewEnvelope(
      'crm_task',
      { type: 'kanban', columns: COLUMNS, kanban: { groupByField: 'stage', columns: COLUMNS } },
      { label: '看板' },
    );
    expect(env.name).toMatch(/^crm_task\.kanban_[a-z0-9]+$/);
    expectSpecValid(env);
  });
});

describe('viewEnvelope identity boundary the ViewItem gate enforces (objectui#3375)', () => {
  it('cannot mint a spec-valid ViewItem without an object binding', () => {
    // Documented boundary, not an endorsement: `ViewItemNameSchema` requires a
    // dotted `<object>.<key>` name, so an envelope built with no object name
    // yields a bare key the record gate rejects. Both call sites resolve an
    // object before reaching the seam; this pins WHY that precondition is load
    // bearing, so a future caller that drops it fails loudly here.
    const env = viewEnvelope(undefined, { type: 'grid', columns: COLUMNS }, { name: 'orphan' });
    expect(env.name).toBe('orphan');
    const res = ViewItemSchema.safeParse(env);
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path.join('.') === 'name')).toBe(true);
  });
});
