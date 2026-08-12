// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5074 — `ViewItemSchema` wore two contracts; this splits them.
 *
 * The maintainer's ruling (2026-08-04, option A) and its scope addendum:
 *
 *  1. `ViewItemSchema` TIGHTENS for the authoring gate (`defineViewItem`,
 *     objectui's view-create form).
 *  2. `ViewMetadataSchema`'s member 1 becomes `ViewItemWireSchema` — a
 *     `.strip()`-reopened wire variant, following the file's OWN proven pattern
 *     for members 3/4 — with `isPinned`/`sortOrder` given a DECLARED home.
 *  3. ⚠️ The wire opening must be **recursive-effective**. `.strip()` no more
 *     recurses than `.strict()`, so re-opening member 1's top level protects
 *     nothing nested. The two known console-decorated nested blocks —
 *     `ListView.sort[].id` (批 18 rolled back, #5070) and `ViewFilterRule.id`
 *     (#5114's provisional hotfix) — must survive the WRITE path while closing
 *     for authoring.
 *  4. ⛔ Not solved by declaring `id` as authorable (批 18 Q1, two-axis
 *     rejection on record: a React list key on the authoring surface teaches AI
 *     authors to emit UUIDs).
 *
 * ## Reverse verification — the direction, decided before it was run
 *
 * For the two nested sites this is the **INVERTED** case, not the usual
 * before-green/after-red, and saying so is the point of writing it down. Before
 * this change `ViewFilterRuleSchema.safeParse(consoleRow)` was GREEN (the shape
 * was open) and after it is RED — the authoring gate now rejects `id` by name.
 * What must NOT move is the wire door: every console PUT body parses clean
 * before AND after. So the honest reverse check is per-door, not per-schema:
 * delete `stripViewConsoleDecorations` from `ViewMetadataSchema` and §3 below
 * goes red while §2 stays green — that gap is the finding. Re-open
 * `ViewFilterRuleSchema` instead and §2 goes red while §3 stays green.
 *
 * §5 covers the two landmines the ruling named by hand.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  ViewItemSchema,
  ViewItemWireSchema,
  ViewMetadataSchema,
  ViewFilterRuleSchema,
  ListViewSchema,
  defineViewItem,
  stripViewConsoleDecorations,
  VIEW_CONSOLE_ROW_DECORATIONS,
} from './view.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify((r.error as { issues?: unknown })?.issues ?? r.error ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } }, value: unknown): unknown {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data;
}

/** A canonical, spec-valid ViewItem record — what `defineViewItem` authors. */
const RECORD = {
  name: 'crm_lead.pipeline',
  object: 'crm_lead',
  viewKind: 'list' as const,
  label: 'Pipeline',
  config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
};

/** One filter row exactly as the console writes it (`filter-builder.tsx:228`). */
const CONSOLE_FILTER_ROW = {
  id: 'c0ffee00-dead-beef-cafe-000000000000',
  field: 'stage',
  operator: 'equals',
  value: 'won',
} as const;

/** One sort row exactly as the console writes it (`sort-builder.tsx:68`/`:94`). */
const CONSOLE_SORT_ROW = {
  id: '29200fa8-c416-471e-9ca3-913f9308ad89',
  field: 'estimate_hours',
  order: 'desc',
} as const;

/** The flattened personalization overlay (#2555) the console PUTs. */
const OVERLAY_BASE = {
  type: 'grid',
  data: { provider: 'object', object: 'showcase_task' },
  columns: ['title'],
  name: 'showcase_task.default',
  viewKind: 'list',
  object: 'showcase_task',
  label: 'All Tasks',
} as const;

// ===========================================================================
// 1. The doors — a posture is a property of a PARSE (#4583)
// ===========================================================================
describe('#5074 — the two doors, which is the whole point of the split', () => {
  it('the `view` metadata type resolves to a registered schema (the wire / 422 door)', () => {
    expect(getMetadataTypeSchema('view')).toBeDefined();
  });

  it('`defineViewItem()` is a real parse door — it throws on a malformed config', () => {
    expect(() =>
      defineViewItem({
        ...RECORD,
        config: { type: 'grid', columns: 'not-an-array' },
      } as never),
    ).toThrow();
  });

  it('controls parse — these tests fail closed, they do not reject everything', () => {
    accept(ViewItemSchema, RECORD);
    accept(ViewItemWireSchema, RECORD);
    accept(ViewMetadataSchema, RECORD);
  });
});

// ===========================================================================
// 2. The AUTHORING gate — tightened
// ===========================================================================
describe('#5074 — `ViewItemSchema` is the authoring gate and is now strict', () => {
  it('the one-letter `confg` typo is REJECTED, not stripped into an empty ViewItem', () => {
    // The failure the ruling turned on: before the split this parsed clean and
    // produced a ViewItem with no view configuration at all — #1535's
    // `workflows: [...]` replayed on the view surface.
    const { config: _dropped, ...withoutConfig } = RECORD;
    const msg = reject(ViewItemSchema, { ...withoutConfig, confg: RECORD.config });
    expect(msg).toContain('confg');
    expect(msg).toContain('config');
  });

  it('an undeclared key is rejected on BOTH arms, at the arm where it lives', () => {
    expect(reject(ViewItemSchema, { ...RECORD, notAViewItemKey: 1 })).toContain('notAViewItemKey');
    expect(
      reject(ViewItemSchema, {
        name: 'crm_lead.intake',
        object: 'crm_lead',
        viewKind: 'form',
        config: { type: 'simple', sections: [{ fields: ['name'] }] },
        notAViewItemKey: 1,
      }),
    ).toContain('notAViewItemKey');
  });

  it('the wire keys are rejected HERE, each with the prescription for its layer', () => {
    // Not a bare refusal: an author who wrote `sortOrder` in a `*.view.ts` is
    // pointed at `order`, the authored key that does mean what they wanted.
    expect(reject(ViewItemSchema, { ...RECORD, isPinned: true })).toContain('isPinned');
    expect(reject(ViewItemSchema, { ...RECORD, sortOrder: 3 })).toContain('`order`');
  });

  it('`defineViewItem` — the door, not just the schema — refuses the typo', () => {
    const { config: _dropped, ...withoutConfig } = RECORD;
    expect(() => defineViewItem({ ...withoutConfig, confg: RECORD.config } as never)).toThrow(/confg/);
  });

  it('every key objectui\'s `createBuildBody` emits still parses (the create form must not break)', () => {
    // Mirrors objectui `app-shell/src/views/metadata-admin/anchors.ts`
    // `createBuildBody`, guarded there by `view-create-body.test.ts`. Closing
    // this shape is only safe because that emitter writes declared keys only.
    accept(ViewItemSchema, {
      name: 'crm_lead.all_leads',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'All Leads',
      config: { type: 'grid', columns: [], data: { provider: 'object', object: 'crm_lead' } },
    });
    accept(ViewItemSchema, {
      name: 'crm_lead.intake',
      object: 'crm_lead',
      viewKind: 'form',
      label: 'Intake',
      config: { type: 'tabbed', data: { provider: 'object', object: 'crm_lead' }, sections: [] },
    });
  });

  it('the two nested console-decorated blocks now reject `id` at their own path', () => {
    // Strictness does not recurse, so each is probed where it lives — and each
    // rejection carries the reason, not a bare "unrecognized key".
    expect(reject(ViewFilterRuleSchema, CONSOLE_FILTER_ROW)).toContain('console row key');
    expect(reject(ListViewSchema, { columns: ['name'], sort: [CONSOLE_SORT_ROW] })).toContain('console row key');
  });

  it('…and `direction` is still answered with `order` — #4721, the silently REVERSED sort', () => {
    // `{ field, direction: 'desc' }` used to parse to `{ field, order: 'asc' }`.
    // This alias is why closing the sort entry was worth doing at all.
    expect(reject(ListViewSchema, { columns: ['name'], sort: [{ field: 'name', direction: 'desc' }] }))
      .toContain('`direction` → `order`');
  });

  it('`id` is NOT declared anywhere on the authoring surface (批 18 Q1)', () => {
    const filterKeys = Object.keys((ViewFilterRuleSchema as unknown as { shape: Record<string, unknown> }).shape);
    expect(filterKeys.sort()).toEqual(['field', 'operator', 'value']);
  });
});

// ===========================================================================
// 3. The WIRE door — every console PUT body still parses, at every depth
// ===========================================================================
describe('#5074 — the wire door accepts what the platform itself writes', () => {
  it('member 1 carries the pin round-trip: `{...storedItem, isPinned}` (`ObjectView.tsx:882`)', () => {
    accept(ViewItemWireSchema, { ...RECORD, isPinned: true, sortOrder: 3 });
    accept(ViewMetadataSchema, { ...RECORD, isPinned: true, sortOrder: 3 });
  });

  it('…and the aux keys are DECLARED, so they survive the parse instead of being dropped', () => {
    // The difference between "has a home" and "nobody closed this member".
    // `saveMetaItem` stores the original body either way; a declared key is the
    // one a JSON Schema consumer and an AI author can actually discover.
    const parsed = accept(ViewMetadataSchema, { ...RECORD, isPinned: true, sortOrder: 3 }) as Record<string, unknown>;
    expect(parsed.isPinned).toBe(true);
    expect(parsed.sortOrder).toBe(3);
  });

  it('…while a genuinely broken record is still NOT rescued by a lenient member', () => {
    // The flattened members pin `config` to undefined, so a record with a
    // broken config cannot slip through them with its payload stripped.
    expect(
      ViewMetadataSchema.safeParse({ ...RECORD, config: { type: 'grid', columns: 'not-an-array' } }).success,
    ).toBe(false);
  });

  it('an undeclared aux key still rides on the wire member (`.strip()`, as before)', () => {
    accept(ViewMetadataSchema, { ...RECORD, someFutureStudioAuxKey: 1 });
  });

  // ── the acceptance criteria named in the scope addendum ──────────────────
  it('ACCEPTANCE 1/2 — the console COLUMN-SORT PUT body parses clean', () => {
    accept(ViewMetadataSchema, { ...OVERLAY_BASE, sort: [CONSOLE_SORT_ROW] });
  });

  it('ACCEPTANCE 2/2 — the console FILTER-SAVE PUT body parses clean', () => {
    accept(ViewMetadataSchema, { ...OVERLAY_BASE, filter: [CONSOLE_FILTER_ROW] });
  });

  it.each([
    ['flattened overlay — `sort[]`', { ...OVERLAY_BASE, sort: [CONSOLE_SORT_ROW] }],
    ['flattened overlay — `filter[]`', { ...OVERLAY_BASE, filter: [CONSOLE_FILTER_ROW] }],
    ['flattened overlay — `tabs[].filter[]`', { ...OVERLAY_BASE, tabs: [{ name: 'won', label: 'Won', filter: [CONSOLE_FILTER_ROW] }] }],
    ['flattened overlay — `userFilters.tabs[].filter[]`', {
      ...OVERLAY_BASE,
      userFilters: { element: 'tabs', tabs: [{ name: 'won', label: 'Won', filter: [CONSOLE_FILTER_ROW] }] },
    }],
    ['ViewItem record — `config.sort[]`', { ...RECORD, config: { ...RECORD.config, sort: [CONSOLE_SORT_ROW] } }],
    ['ViewItem record — `config.filter[]`', { ...RECORD, config: { ...RECORD.config, filter: [CONSOLE_FILTER_ROW] } }],
    ['ViewItem record — pin + decorated config', {
      ...RECORD,
      isPinned: true,
      config: { ...RECORD.config, sort: [CONSOLE_SORT_ROW], filter: [CONSOLE_FILTER_ROW] },
    }],
    ['container — `list.sort[]`', { list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'], sort: [CONSOLE_SORT_ROW] } }],
  ])('RECURSIVE-effective: %s survives the wire door', (_case, body) => {
    // This is the addendum's hard requirement. A member-level `.strip()` can
    // only reach the TOP level; every one of these is nested, and several are
    // nested under a member that is itself strict.
    accept(ViewMetadataSchema, body);
  });

  // ── #5599: the identity precondition sits in FRONT of this whole door ────
  // It runs in the same `z.preprocess` stage as `stripViewConsoleDecorations`,
  // so it is the first thing every body above meets. These pin that it is inert
  // on the wire — the failure mode of a precondition is 422-ing our own writes.
  it('#5599 — the precondition does not disturb the decoration strip it shares a stage with', () => {
    // The strip runs only AFTER the identity check passes; a decorated body
    // must still arrive at the union stripped, not rejected.
    accept(ViewMetadataSchema, { ...OVERLAY_BASE, sort: [CONSOLE_SORT_ROW], filter: [CONSOLE_FILTER_ROW] });
  });

  it('#5599 — a body carrying ONLY an aux round-trip key still reaches the union', () => {
    // `updateView` PUTs `{ ...current, ...partial }`; when there is no stored
    // item to merge, `current` is empty and the body is the bare partial.
    // `isPinned`/`sortOrder` are declared on member 1, so they are vocabulary.
    //
    // [#7741] "Reaches the union" is still the claim — but the UNION now
    // refuses the baseline-less bare partial (no `object`/`viewKind` to inherit
    // means the saved row could never be served), so the pin is split in two:
    // the refusal must be the members' located binding guidance, never the
    // precondition's "not a view"; and the same partial as the write path
    // actually delivers it (identity inherited from the shadowed entry,
    // #2555) parses clean.
    for (const partial of [{ isPinned: true }, { sortOrder: 3 }]) {
      const msg = reject(ViewMetadataSchema, partial);
      expect(msg).not.toContain('Not a `view` body');
      expect(msg).toContain('names no `object`');
      accept(ViewMetadataSchema, { ...partial, object: 'showcase_task', viewKind: 'list' });
    }
  });

  it('#5599 — …but a body speaking NO view key is stopped before any member runs', () => {
    const r = ViewMetadataSchema.safeParse({ nope: 1 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
  });
});

// ===========================================================================
// 4. The strip removes the decoration and NOTHING else
// ===========================================================================
describe('#5074 — `stripViewConsoleDecorations`, the write-path mirror of `stripReadDecorations`', () => {
  it('declares its vocabulary rather than hard-coding a key at the call site', () => {
    expect([...VIEW_CONSOLE_ROW_DECORATIONS]).toEqual(['id']);
  });

  it('removes the row `id` at every carrier depth', () => {
    const out = stripViewConsoleDecorations({
      ...OVERLAY_BASE,
      sort: [CONSOLE_SORT_ROW],
      filter: [CONSOLE_FILTER_ROW],
      tabs: [{ name: 'won', filter: [CONSOLE_FILTER_ROW] }],
    }) as Record<string, any>;
    expect(out.sort[0]).toEqual({ field: 'estimate_hours', order: 'desc' });
    expect(out.filter[0]).toEqual({ field: 'stage', operator: 'equals', value: 'won' });
    expect(out.tabs[0].filter[0]).not.toHaveProperty('id');
  });

  it('leaves a TOP-LEVEL `id` alone — only builder ROWS are decorated', () => {
    // Scoped to the carriers that hold rows. A body-level `id` is somebody
    // else's contract and is not this function's to delete.
    const out = stripViewConsoleDecorations({ ...OVERLAY_BASE, id: 'row_1' }) as Record<string, unknown>;
    expect(out.id).toBe('row_1');
  });

  it('returns the SAME reference when there is nothing to strip', () => {
    const clean = { ...OVERLAY_BASE, sort: [{ field: 'a', order: 'asc' }] };
    expect(stripViewConsoleDecorations(clean)).toBe(clean);
  });

  it('does not mutate its input — `saveMetaItem` persists the ORIGINAL body', () => {
    // Load-bearing: the console reads its own ids back out of the store. If
    // this stripped in place, the round-trip would lose them.
    const body = { ...OVERLAY_BASE, filter: [{ ...CONSOLE_FILTER_ROW }] };
    stripViewConsoleDecorations(body);
    expect(body.filter[0].id).toBe(CONSOLE_FILTER_ROW.id);
  });

  it('passes non-objects through untouched', () => {
    expect(stripViewConsoleDecorations(null)).toBe(null);
    expect(stripViewConsoleDecorations('str')).toBe('str');
  });

  it('the operator vocabulary still bites through the wire door — openness is about UNKNOWN KEYS', () => {
    expect(
      ViewMetadataSchema.safeParse({ ...OVERLAY_BASE, filter: [{ ...CONSOLE_FILTER_ROW, operator: 'sorta_equals' }] }).success,
    ).toBe(false);
    expect(
      ViewMetadataSchema.safeParse({ ...OVERLAY_BASE, sort: [{ ...CONSOLE_SORT_ROW, order: 'sideways' }] }).success,
    ).toBe(false);
  });

  it('a still-CLOSED nested block that is NOT a console decoration still rejects', () => {
    // The control that keeps §3 honest: the strip is a named vocabulary, not a
    // blanket re-opening of the tree.
    expect(
      ViewMetadataSchema.safeParse({ ...OVERLAY_BASE, emptyState: { title: 'None', notAnEmptyStateKey: 1 } }).success,
    ).toBe(false);
  });
});

// ===========================================================================
// 5. The two landmines the ruling named
// ===========================================================================
describe('#5074 — landmine 1: `/api/v1/meta/types/view` must still get an `anyOf`', () => {
  it('the REGISTERED schema converts to a four-member `anyOf`, through the preprocess', () => {
    // Studio's SchemaForm is built from this. `z.preprocess` makes the root a
    // pipe; a pipe converts to its output side, so the union survives — but
    // that is a fact about zod, so it is asserted rather than assumed.
    const json = z.toJSONSchema(getMetadataTypeSchema('view')!, { unrepresentable: 'any' }) as Record<string, unknown>;
    expect(Array.isArray(json.anyOf)).toBe(true);
    expect((json.anyOf as unknown[]).length).toBe(4);
  });

  it('converts in the INPUT direction too — the form is built from what an author sends', () => {
    const json = z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
    expect(Array.isArray(json.anyOf)).toBe(true);
    expect((json.anyOf as unknown[]).length).toBe(4);
  });

  it('the emitted schema does NOT advertise `id` on a filter/sort row', () => {
    // The whole reason the strip exists instead of a declaration: whatever the
    // wire tolerates, the published contract must not teach an author to write
    // a UUID. Serialized-and-searched because the key could appear at any depth.
    const json = JSON.stringify(z.toJSONSchema(ViewItemSchema, { unrepresentable: 'any' }));
    expect(json).toContain('"operator"');
    expect(json).not.toContain('"console row key"');
  });

  it('#5599 — the identity precondition is invisible to the emitted contract', () => {
    // This is WHY the check reports through the existing preprocess's `ctx`
    // rather than as an extra pipe stage. `z.unknown().superRefine(…).pipe(union)`
    // would satisfy the output-direction assertion above and silently degrade
    // the INPUT direction to `{}` — Studio's SchemaForm would render nothing,
    // and no `anyOf`-length pin would have caught it. Reporting through `ctx`
    // changes no types, so both directions are unchanged from before #5599.
    // (Verified out-of-band as byte-identical to `origin/main` for both
    // directions; asserted here on the properties that make the form work.)
    for (const io of ['output', 'input'] as const) {
      const json = z.toJSONSchema(getMetadataTypeSchema('view')!, { unrepresentable: 'any', io }) as Record<string, unknown>;
      const members = json.anyOf as Array<Record<string, unknown>>;
      expect(members).toHaveLength(4);
      // Member 1 is the discriminated ViewItem record (a nested union); members
      // 2-4 are plain objects. A degraded emission loses exactly this shape.
      expect(Array.isArray(members[0]!.oneOf ?? members[0]!.anyOf)).toBe(true);
      for (const member of members.slice(1)) expect(member.type).toBe('object');
      // The form needs real property sets, not an empty permissive schema.
      expect(Object.keys((members[3]!.properties ?? {}) as object).length).toBeGreaterThan(10);
    }
  });
});

describe('#5074 — landmine 2: the lazySchema Proxy / ADR-0089 D3a trap', () => {
  // `lazySchema` returns a Proxy, and zod keys its `toJSONSchema` `seen` map on
  // the node it was handed. When a wrapper-type processor (pipe/lazy/optional)
  // then looks itself up by the REAL instance, the entry is missing and zod
  // throws `Cannot set properties of undefined (setting 'ref')`. This change
  // adds a pipe at the root of a lazy schema — exactly that shape — so each
  // new/changed schema is converted directly, not only through its parent.
  it.each([
    ['ViewMetadataSchema (lazy → pipe → union)', () => ViewMetadataSchema],
    ['ViewItemWireSchema (lazy → discriminatedUnion)', () => ViewItemWireSchema],
    ['ViewItemSchema (lazy → discriminatedUnion, strict arms)', () => ViewItemSchema],
    ['ViewFilterRuleSchema (lazy → strict object)', () => ViewFilterRuleSchema],
  ])('%s converts without the `seen`-map crash', (_name, get) => {
    expect(() => z.toJSONSchema(get(), { unrepresentable: 'any' })).not.toThrow();
  });

  it('converts twice in a row — the memoised `_zod` facade must be re-entrant', () => {
    expect(() => {
      z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any' });
      z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any' });
    }).not.toThrow();
  });
});
