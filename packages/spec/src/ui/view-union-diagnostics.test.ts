// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6391] `ViewMetadataSchema`'s union: contractual member handles + a
 * branch-naming diagnostic entry, with the ACCEPTANCE face pinned unmoved.
 *
 * ## What was measured, and by whom
 *
 * objectui's metadata-admin editor validates `view` bodies against
 * `ViewMetadataSchema` (objectstack#5316's ruling). When that fails, zod raises
 * ONE root `invalid_union` issue and buries every per-field truth in nested
 * `errors[]`. objectui#3624 shipped an expansion for it — and could only reach
 * a branch BY MEMBER POSITION, because three of the four members were inline
 * expressions with no exported name. Position is a spec-internal detail nobody
 * promised, so that PR had to pin it with a CANARY test that rings on every
 * reorder. objectstack#6391 records the cost and asks spec to remove the need.
 *
 * ## What this file pins
 *
 * 1. **Identity by construction.** The union's `options` ARE
 *    {@link VIEW_METADATA_MEMBERS}' values, same objects, same order. This is
 *    the assertion objectui's canary was standing in for; it now lives on the
 *    side that can actually break it.
 * 2. **A branch names itself.** {@link diagnoseViewMetadata} returns the branch
 *    NAME and that branch's own leaf issues — no `errors[i]`, no position.
 * 3. ⛔ **The acceptance face did not move.** Every body below is asserted in
 *    BOTH directions: what parsed before parses now, what was refused before is
 *    refused now, and the refusals still carry their issue codes. The union
 *    gained a diagnostic dispatch, NOT a discriminant — a `z.discriminatedUnion`
 *    would refuse an unknown discriminant outright where this union still falls
 *    through all four members, which is a membership change and is exactly what
 *    #7025's sweep rule forbids.
 *
 * The expected values below were measured on `origin/main` @ `0f539bd` before
 * the change and re-measured after: 42 bodies, identical verdicts, identical
 * parse output, identical issue-code sets (report sha256
 * `fca9df8937bbb9f736f11895a6e1ddf23b7fb25d9b13cfa7e67c71c8dfaaf2b2`).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ViewMetadataSchema,
  ViewItemWireSchema,
  VIEW_METADATA_BRANCHES,
  VIEW_METADATA_MEMBERS,
  selectViewMetadataBranch,
  diagnoseViewMetadata,
  type ViewMetadataBranch,
} from './view.zod';

const LIST_CFG = { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] };
const FORM_CFG = { type: 'simple', sections: [{ label: 'Main', fields: ['name'] }] };

/** The union zod actually runs, unwrapped from the `z.preprocess` pipe. */
function unionOptions(): readonly unknown[] {
  const def = (ViewMetadataSchema as unknown as { _zod: { def: Record<string, any> } })._zod.def;
  const out = def.out ?? def;
  return (out._zod?.def?.options ?? []) as readonly unknown[];
}

describe('[#6391] the union members are contractual, not positional', () => {
  it('exposes exactly four branches, in the union\'s own order', () => {
    expect([...VIEW_METADATA_BRANCHES]).toEqual([
      'viewItem',
      'container',
      'listOverlay',
      'formOverlay',
    ]);
    expect(Object.keys(VIEW_METADATA_MEMBERS)).toEqual([...VIEW_METADATA_BRANCHES]);
  });

  // ⚠️ THE pin. Before this change member 2 was `ViewSchema.refine(…)` written
  // inline: key-for-key identical to the exported `ViewSchema` and NOT the same
  // object, so a consumer selecting "the container branch" was selecting a
  // resemblance. Now the union is BUILT from this record, so a reorder or a
  // swap cannot make the two disagree — it is one declaration.
  it('builds the union FROM the named members — same objects, same order', () => {
    const options = unionOptions();
    expect(options).toHaveLength(VIEW_METADATA_BRANCHES.length);
    VIEW_METADATA_BRANCHES.forEach((branch, index) => {
      expect(options[index]).toBe(VIEW_METADATA_MEMBERS[branch]);
    });
  });

  it('keeps member 1 identically the already-exported ViewItemWireSchema', () => {
    expect(VIEW_METADATA_MEMBERS.viewItem).toBe(ViewItemWireSchema);
  });

  it('lets a consumer validate against one named branch directly', () => {
    // The route objectui had to reach for `errors[2]` to approximate.
    expect(VIEW_METADATA_MEMBERS.container.safeParse({ object: 'crm_lead', list: LIST_CFG }).success).toBe(true);
    expect(VIEW_METADATA_MEMBERS.container.safeParse({ object: 'crm_lead', listViews: {} }).success).toBe(false);
    // [#7741] The overlay arms require the `object` + `viewKind` binding.
    expect(VIEW_METADATA_MEMBERS.listOverlay.safeParse({ type: 'grid', columns: ['name'], object: 'crm_lead', viewKind: 'list' }).success).toBe(true);
    expect(VIEW_METADATA_MEMBERS.listOverlay.safeParse({ type: 'grid', columns: ['name'] }).success).toBe(false);
    expect(VIEW_METADATA_MEMBERS.formOverlay.safeParse({ type: 'wizard', object: 'crm_lead', viewKind: 'form' }).success).toBe(true);
    expect(VIEW_METADATA_MEMBERS.formOverlay.safeParse({ type: 'wizard' }).success).toBe(false);
  });
});

describe('[#6391] selectViewMetadataBranch reads the members\' own discriminants', () => {
  const CASES: Array<[string, unknown, ViewMetadataBranch | null]> = [
    ['a nested config is a ViewItem record', { viewKind: 'list', config: LIST_CFG }, 'viewItem'],
    ['…even when the config is the broken part', { viewKind: 'list', config: { type: 'grid', columns: 1 } }, 'viewItem'],
    ['a container slot is a container', { object: 'a', list: LIST_CFG }, 'container'],
    ['listViews too', { object: 'a', listViews: {} }, 'container'],
    ['an inherited viewKind settles a flat overlay', { viewKind: 'form', title: 'T' }, 'formOverlay'],
    ['so does a list-family type', { type: 'kanban' }, 'listOverlay'],
    ['and a form-family type', { type: 'wizard' }, 'formOverlay'],
    ['nothing settles a bare aux PUT', { isPinned: true }, null],
    ['nor an unknown type', { type: 'sideways' }, null],
    ['non-objects claim nothing', 'nope', null],
  ];

  for (const [label, body, expected] of CASES) {
    it(label, () => expect(selectViewMetadataBranch(body)).toBe(expected));
  }

  // The `type` enums are read off the member schemas, never re-listed here, so
  // a new view type cannot make the dispatch disagree with the members.
  it('covers every declared list/form type', () => {
    const listTypes = ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'map', 'chart', 'tree'];
    const formTypes = ['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal'];
    for (const type of listTypes) expect(selectViewMetadataBranch({ type })).toBe('listOverlay');
    for (const type of formTypes) expect(selectViewMetadataBranch({ type })).toBe('formOverlay');
  });
});

describe('[#6391] diagnoseViewMetadata names the failing branch', () => {
  // The worked example from the issue: a flattened list overlay whose `columns`
  // is a string. Before this change the ONLY structural route to that leaf was
  // `error.issues[0].errors[2]` — member position 2 — while the rendered
  // message came from the CONTAINER branch (fewest issues wins) and told the
  // author to wrap the body in `defineView`, which is not the defect.
  // ([#7741] carries the binding pair so the ONE defect under test stays the
  // broken `columns`, not a missing binding.)
  const BAD_OVERLAY = { type: 'grid', columns: 'not-an-array', object: 'crm_lead', viewKind: 'list' };

  it('reports the leaf issue under the branch that owns it', () => {
    const d = diagnoseViewMetadata(BAD_OVERLAY);
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('listOverlay');
    expect(d.issues).toHaveLength(1);
    expect(d.issues[0]!.path).toEqual(['columns']);
  });

  it('still shows the union hiding it behind member POSITION', () => {
    // Kept as the contrast the fix exists for: this is what a consumer had to
    // write, and what it no longer has to write.
    const root = ViewMetadataSchema.safeParse(BAD_OVERLAY).error!.issues[0] as unknown as {
      code: string;
      errors: unknown[][];
    };
    expect(root.code).toBe('invalid_union');
    expect(root.errors).toHaveLength(4);
    expect(root.errors[2]).toMatchObject([{ path: ['columns'] }]);
  });

  it('names the branch on success too', () => {
    const d = diagnoseViewMetadata({ object: 'crm_lead', list: LIST_CFG });
    expect(d.success).toBe(true);
    if (!d.success) return;
    expect(d.branch).toBe('container');
  });

  it('reports a broken ViewItem config against the viewItem branch', () => {
    const d = diagnoseViewMetadata({
      name: 'a.b',
      object: 'a',
      viewKind: 'list',
      config: { type: 'grid', columns: 'nope' },
    });
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('viewItem');
    expect(d.issues.some((i) => i.path.includes('config'))).toBe(true);
  });

  it('reports an empty container against the container branch', () => {
    const d = diagnoseViewMetadata({ object: 'crm_lead', listViews: {} });
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('container');
    expect(d.issues[0]!.message).toContain('must define at least one of');
  });

  // #5599's identity precondition short-circuits the pipe before the union
  // runs. Naming a branch here would send the author to fix a shape they were
  // never writing, so the contract is `branch: null`.
  it('names NO branch for a body that is not a view at all', () => {
    for (const body of [{ nope: 1 }, {}, { id: 'x' }, { name: 'garbage_view' }]) {
      const d = diagnoseViewMetadata(body);
      expect(d.success).toBe(false);
      if (d.success) continue;
      expect(d.branch).toBeNull();
      expect(d.issues[0]!.message).toContain('Not a `view` body');
    }
  });

  it('falls back to the least-complaining member when nothing settles the claim', () => {
    // `{ isPinned: true, columns: 'nope' }` claims no branch by discriminant —
    // every member is tried and the one with the fewest issues is reported,
    // the same ranking `selectUnionBranches` uses for this family.
    const d = diagnoseViewMetadata({ isPinned: true, columns: 'nope' });
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(VIEW_METADATA_BRANCHES).toContain(d.branch!);
    expect(d.issues.length).toBeGreaterThan(0);
  });

  // ⛔ The invariant that keeps this a DIAGNOSTIC and not a second gate.
  it('never disagrees with ViewMetadataSchema about acceptance', () => {
    const bodies: unknown[] = [
      { name: 'a.b', object: 'a', viewKind: 'list', config: LIST_CFG },
      { object: 'a', form: FORM_CFG },
      { type: 'grid', columns: ['name'] },
      { type: 'wizard' },
      { isPinned: true },
      { nope: 1 },
      {},
      'nope',
      42,
      null,
      [LIST_CFG],
    ];
    for (const body of bodies) {
      expect(diagnoseViewMetadata(body).success).toBe(ViewMetadataSchema.safeParse(body).success);
    }
  });
});

// ⛔ #7025's red line, asserted directly. A discriminated union changes error
// SHAPE, not membership — so membership is what this block pins, in both
// directions, on the corpus the before/after diff was measured over.
//
// [#7741] The acceptance face DID move once since #7025, deliberately and by
// ruling (2026-08-12, direction B): the two flattened overlay arms now require
// the `object` + `viewKind` binding, so every unbound overlay/PUT entry in the
// measured corpus flipped from ACCEPTED to REFUSED. The corpus keeps both
// generations: the bound spelling (what the write path actually delivers after
// `normalizeViewMetadata` inherits identity, #2555) stays in ACCEPTED with its
// parse output re-measured, and the unbound original moves to REFUSED so the
// flip itself is pinned rather than silently absorbed.
describe('[#7025] the acceptance face of ViewMetadataSchema — as re-ruled by #7741', () => {
  const SECTION = { label: 'Main', collapsible: false, collapsed: false, columns: 1, fields: ['name'] };
  /** [#7741] The binding pair the write path inherits onto a shadowing overlay. */
  const BOUND_LIST = { object: 'crm_lead', viewKind: 'list' } as const;
  const BOUND_FORM = { object: 'crm_lead', viewKind: 'form' } as const;

  /**
   * Every entry is a verdict MEASURED before and after — never a verdict
   * predicted from reading the schema. Some of them are surprising, and they
   * are in the table precisely because a surprising accept is the one a
   * refactor silently loses:
   *
   * - `overlay.badOperator` / `overlay.console*Id` ACCEPT with the payload
   *   stripped to the binding + `{type:'simple'}` — the form overlay does not
   *   declare `filter`/`sort`, and `.strip()` drops them. Pre-existing,
   *   load-bearing for Studio's round-trip, and untouched by #7741 (openness
   *   is about unknown keys; the binding is about required ones).
   * - `overlay.list.min` (`{type:'grid'}` alone) REJECTS.
   * - `container.empty` REJECTS with `custom`, not `invalid_union`: when
   *   exactly one branch is non-aborted zod's `handleUnionResults` returns THAT
   *   branch's issues verbatim instead of wrapping them — one more reason a
   *   consumer cannot rely on the wrapper's shape, which is #6391's point.
   */
  const ACCEPTED: Array<[string, unknown, unknown]> = [
    ['viewItem.list', { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', config: LIST_CFG },
      { viewKind: 'list', config: LIST_CFG, name: 'crm_lead.all', object: 'crm_lead' }],
    ['viewItem.form', { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', config: FORM_CFG },
      { viewKind: 'form', config: { type: 'simple', sections: [SECTION] }, name: 'crm_lead.edit', object: 'crm_lead' }],
    ['viewItem.wire.aux', { name: 'a.b', object: 'a', viewKind: 'list', config: LIST_CFG, isPinned: true, sortOrder: 3 },
      { viewKind: 'list', config: LIST_CFG, name: 'a.b', object: 'a', isPinned: true, sortOrder: 3 }],
    ['container.list', { object: 'crm_lead', list: LIST_CFG }, { object: 'crm_lead', list: LIST_CFG }],
    ['container.form', { object: 'crm_lead', form: FORM_CFG }, { object: 'crm_lead', form: { type: 'simple', sections: [SECTION] } }],
    ['container.listViews', { object: 'crm_lead', listViews: { my: LIST_CFG } }, { object: 'crm_lead', listViews: { my: LIST_CFG } }],
    ['container.formViews', { object: 'crm_lead', formViews: { my: FORM_CFG } },
      { object: 'crm_lead', formViews: { my: { type: 'simple', sections: [SECTION] } } }],
    ['overlay.list.columns', { columns: ['name', 'stage'], ...BOUND_LIST },
      { type: 'grid', columns: ['name', 'stage'], ...BOUND_LIST }],
    ['overlay.list.aux', { type: 'grid', columns: ['name'], isDefault: true, order: 2, hidden: false, ...BOUND_LIST },
      { type: 'grid', columns: ['name'], isDefault: true, order: 2, hidden: false, ...BOUND_LIST }],
    ['overlay.form.min', { type: 'simple', ...BOUND_FORM }, { type: 'simple', ...BOUND_FORM }],
    ['overlay.form.sections', { sections: [{ label: 'Main', fields: ['name'] }], ...BOUND_FORM },
      { type: 'simple', sections: [SECTION], ...BOUND_FORM }],
    ['overlay.form.identity', { name: 'x', object: 'crm_lead', viewKind: 'form', type: 'wizard' },
      { type: 'wizard', name: 'x', object: 'crm_lead', viewKind: 'form' }],
    ['overlay.badOperator', { filter: [{ field: 'name', operator: 'sorta_equals', value: 'x' }], ...BOUND_FORM },
      { type: 'simple', ...BOUND_FORM }],
    ['overlay.consoleSortId', { sort: [{ id: 'row-1', field: 'name', order: 'asc' }], ...BOUND_FORM },
      { type: 'simple', ...BOUND_FORM }],
    ['overlay.consoleFilterId', { filter: [{ id: 'row-1', field: 'name', operator: '=', value: 'x' }], ...BOUND_FORM },
      { type: 'simple', ...BOUND_FORM }],
    ['put.isPinned', { isPinned: true, ...BOUND_LIST }, { type: 'simple', ...BOUND_LIST }],
    ['put.sortOrder', { sortOrder: 3, ...BOUND_LIST }, { type: 'simple', ...BOUND_LIST }],
    ['put.hidden', { hidden: true, ...BOUND_FORM }, { type: 'simple', hidden: true, ...BOUND_FORM }],
    ['put.pinAndOrder', { isPinned: true, sortOrder: 3, ...BOUND_LIST }, { type: 'simple', ...BOUND_LIST }],
  ];

  const REFUSED: Array<[string, unknown, string[]]> = [
    ['viewItem.badKind', { name: 'a.b', object: 'a', viewKind: 'chart', config: LIST_CFG }, ['invalid_union']],
    ['viewItem.badConfig', { name: 'a.b', object: 'a', viewKind: 'list', config: { type: 'grid', columns: 'nope' } }, ['invalid_union']],
    ['viewItem.typoConfg', { name: 'a.b', object: 'a', viewKind: 'list', confg: LIST_CFG }, ['custom']],
    ['viewItem.consoleDecor', { name: 'a.b', object: 'a', viewKind: 'list', config: { ...LIST_CFG, filter: [{ id: 'x', field: 'name', operator: '=', value: 'q' }] } }, ['invalid_union']],
    ['container.empty', { object: 'crm_lead', listViews: {} }, ['custom']],
    ['container.withAux', { object: 'crm_lead', list: LIST_CFG, isPinned: true }, ['invalid_union']],
    ['container.badInner', { object: 'crm_lead', list: { type: 'nope' } }, ['invalid_union']],
    ['overlay.list.min', { type: 'grid' }, ['invalid_union']],
    ['overlay.list.identity', { name: 'x', object: 'crm_lead', viewKind: 'list', type: 'kanban', groupByField: 'stage' }, ['invalid_union']],
    ['overlay.badType', { type: 'sideways' }, ['invalid_union']],
    ['overlay.badColumns', { type: 'grid', columns: 'not-an-array' }, ['invalid_union']],
    ['overlay.emptyState.badKey', { type: 'grid', emptyState: { title: 'None', notAnEmptyStateKey: 1 } }, ['invalid_union']],
    // [#7741] The corpus's former unbound ACCEPTED entries, each re-measured:
    // an overlay that names no `object`/`viewKind` would be stored as a row no
    // object-bound read path can serve, so the members now refuse it with the
    // located binding guidance (ruled 2026-08-12, direction B).
    ['unbound.overlay.list.columns', { columns: ['name', 'stage'] }, ['invalid_union']],
    ['unbound.overlay.list.aux', { type: 'grid', columns: ['name'], isDefault: true, order: 2, hidden: false }, ['invalid_union']],
    ['unbound.overlay.form.min', { type: 'simple' }, ['invalid_union']],
    ['unbound.overlay.form.sections', { sections: [{ label: 'Main', fields: ['name'] }] }, ['invalid_union']],
    ['unbound.overlay.badOperator', { filter: [{ field: 'name', operator: 'sorta_equals', value: 'x' }] }, ['invalid_union']],
    ['unbound.overlay.consoleSortId', { sort: [{ id: 'row-1', field: 'name', order: 'asc' }] }, ['invalid_union']],
    ['unbound.overlay.consoleFilterId', { filter: [{ id: 'row-1', field: 'name', operator: '=', value: 'x' }] }, ['invalid_union']],
    ['unbound.put.isPinned', { isPinned: true }, ['invalid_union']],
    ['unbound.put.sortOrder', { sortOrder: 3 }, ['invalid_union']],
    ['unbound.put.hidden', { hidden: true }, ['invalid_union']],
    ['unbound.put.pinAndOrder', { isPinned: true, sortOrder: 3 }, ['invalid_union']],
    ['identity.nope', { nope: 1 }, ['custom']],
    ['identity.empty', {}, ['custom']],
    ['identity.idOnly', { id: 'x' }, ['custom']],
    ['identity.nameOnly', { name: 'garbage_view' }, ['custom']],
    ['identity.stampedOnly', { name: 'v', viewKind: 'list', object: 'a', label: 'L' }, ['custom']],
    ['scalar.string', 'nope', ['invalid_union']],
    ['scalar.number', 42, ['invalid_union']],
    ['scalar.null', null, ['invalid_union']],
    ['scalar.undefined', undefined, ['invalid_union']],
    ['scalar.array', [LIST_CFG], ['invalid_union']],
    ['scalar.date', new Date(0), ['custom']],
  ];

  for (const [label, body, output] of ACCEPTED) {
    it(`still ACCEPTS ${label}`, () => {
      const r = ViewMetadataSchema.safeParse(body);
      expect(r.success).toBe(true);
      // The parse OUTPUT is pinned too, not just the verdict: three of these
      // bodies are accepted only because a member strips most of them away, and
      // "accepted" alone would not notice that stopping.
      expect(r.data).toEqual(output);
    });
  }

  for (const [label, body, codes] of REFUSED) {
    it(`still REFUSES ${label}`, () => {
      const r = ViewMetadataSchema.safeParse(body);
      expect(r.success).toBe(false);
      // The refusal's SHAPE is what a better diagnostic is allowed to change;
      // its issue codes are the envelope other consumers key on, so they are
      // pinned too (ADR-0112 / #6142's "a better diagnostic never weakens the
      // envelope", read at the issue level).
      expect([...new Set(r.error!.issues.map((i) => i.code))].sort()).toEqual(codes);
    });
  }

  // The JSON-Schema face the `/api/v1/meta/types/view` endpoint serves is
  // pinned in `view-metadata-schema.test.ts`; re-asserted here in the one
  // dimension this change could have moved — the member COUNT.
  it('still emits an anyOf of exactly four members', () => {
    const json = z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any', io: 'input' }) as {
      anyOf?: unknown[];
    };
    expect(json.anyOf).toHaveLength(4);
  });
});
