// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5114 — `ViewFilterRuleSchema` stays OPEN: the console stamps a UI row `id`
 * into every filter rule it writes.
 *
 * This is the third of the three places the verdict is recorded (the others:
 * the JSDoc on the shape itself, and the `ui/` row in
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md`), and it is the same
 * verdict #4001 批 18 reached one block over on `ListView.sort` (#5070) —
 * reached there by the full suite, and here by measuring `main`.
 *
 * WHAT WENT WRONG. An earlier wave closed this shape with `strictObject`. The
 * filter builder objectui renders stamps `id: crypto.randomUUID()` on every row
 * it creates (`components/src/custom/filter-builder.tsx:228`; the same value is
 * re-stamped when a stored filter is read back into the builder,
 * `plugin-view/src/config/view-config-utils.ts:146`/`:160`), and `saveMetaItem`
 * persists the authored body VERBATIM — it validates, then stores what was sent,
 * so the `id` is on the wire and in the store. A closed shape therefore turns
 * every filter write that carries one into a 422.
 *
 * THE MECHANISM, which is worth more than this one site: **`.strip()` does not
 * recurse, any more than `.strict()` does.** `ViewMetadataSchema` re-opens its
 * flattened personalization member so Studio's round-trip aux keys ride along —
 * but that re-opens the TOP level only. This block is reached THROUGH that
 * member, so closing it here 422s a console-stamped key regardless of the
 * member's own posture. 批 18 pinned that property in
 * `view-strictness-batch18.test.ts`; this file pins the consequence for the
 * filter surface, which is the one live path it broke.
 *
 * WHY `id` IS NOT DECLARED. It is a React list key, not protocol. Declaring it
 * would put a UI artifact on the authorable surface and tell an AI author to
 * generate a UUID for a filter rule — the "declared = encouraged" failure this
 * campaign exists to remove. A schema-shaped `??` fallback is still a `??`
 * fallback. So the shape stays open rather than half-closed against the
 * platform's own writes, and the real close is #5074's authoring/wire split
 * applied to this block: an authoring variant that rejects `id` and a wire
 * variant that tolerates it, with the re-opening able to REACH a nested block.
 */

import { describe, it, expect } from 'vitest';

import {
  ViewFilterRuleSchema,
  ListViewSchema,
  ViewMetadataSchema,
} from './view.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/**
 * One filter row exactly as the console writes it: the three declared keys plus
 * the `crypto.randomUUID()` the builder stamps for React.
 */
const CONSOLE_FILTER_ROW = {
  id: 'c0ffee00-dead-beef-cafe-000000000000',
  field: 'stage',
  operator: 'equals',
  value: 'won',
} as const;

/**
 * The flattened personalization overlay (#2555) minus the filter — identity
 * inherited from the entry it shadows. Shape 3 of the three `ViewMetadataSchema`
 * runtime shapes. Kept filter-free so the mechanism controls in section 4 stay
 * independent of the fix under test.
 */
const OVERLAY_BASE = {
  type: 'grid',
  data: { provider: 'object', object: 'showcase_task' },
  columns: ['title'],
  name: 'showcase_task.default',
  viewKind: 'list',
  object: 'showcase_task',
  label: 'All Tasks',
} as const;

/** …and the body the console actually PUTs when a filter is saved. */
const CONSOLE_PUT_BODY = { ...OVERLAY_BASE, filter: [CONSOLE_FILTER_ROW] } as const;

// ===========================================================================
// 1. The door — a parse must exist, or none of the rest means anything
// ===========================================================================
describe('#5114 — the door this shape is reached through', () => {
  it('the `view` metadata type resolves to a registered schema (the save-time 422 door)', () => {
    // `saveMetaItem` validates the PUT body against this schema and answers 422
    // on failure. Without this door the rest of the file would be theory.
    expect(getMetadataTypeSchema('view')).toBeDefined();
  });
});

// ===========================================================================
// 2. The regression itself — all three paths the console body travels
// ===========================================================================
describe('#5114 — a console-written filter row parses on every path', () => {
  it('1/3 `ViewFilterRuleSchema` accepts the row directly', () => {
    expect(ViewFilterRuleSchema.safeParse(CONSOLE_FILTER_ROW).success).toBe(true);
  });

  it('2/3 `ListViewSchema.filter` accepts an array of them', () => {
    expect(
      ListViewSchema.safeParse({ columns: ['name'], filter: [CONSOLE_FILTER_ROW] }).success,
    ).toBe(true);
  });

  it('3/3 `ViewMetadataSchema` accepts the flattened overlay the console PUTs', () => {
    // The path that actually 422'd the user. It reaches this block through the
    // flattened member, whose `.strip()` re-opens the top level ONLY.
    expect(ViewMetadataSchema.safeParse(CONSOLE_PUT_BODY).success).toBe(true);
  });

  it('and the same row rides along on a view TAB filter (`ViewTabSchema.filter`)', () => {
    // The second carrier of `ViewFilterRuleSchema` in this file — the per-tab
    // filter Studio writes through the SAME builder widget, so it stamps the
    // same `id`. Probed at its own path because strictness does not recurse in
    // either direction.
    expect(
      ViewMetadataSchema.safeParse({
        ...CONSOLE_PUT_BODY,
        tabs: [{ name: 'won', label: 'Won', filter: [CONSOLE_FILTER_ROW] }],
      }).success,
    ).toBe(true);
  });
});

// ===========================================================================
// 3. Open is not undefended — what reopening did NOT give away
// ===========================================================================
describe('#5114 — reopening dropped the unknown-key gate, and nothing else', () => {
  it('`id` is DROPPED from the parsed result, not declared onto the surface', () => {
    // The distinction the fix turns on. Declaring `id` would make it authorable
    // (and teach an AI author to emit a UUID); stripping leaves the authorable
    // surface exactly three keys. `saveMetaItem` stores the ORIGINAL body, so
    // the console's `id` still round-trips to the renderer either way.
    const parsed = ViewFilterRuleSchema.parse(CONSOLE_FILTER_ROW) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['field', 'operator', 'value']);
    expect('id' in parsed).toBe(false);
  });

  it('the operator vocabulary still bites — an invented operator is still rejected', () => {
    // Reopening is about UNKNOWN KEYS. Every declared key keeps its own
    // validation, so this is not a shape that accepts anything now.
    expect(
      ViewFilterRuleSchema.safeParse({ ...CONSOLE_FILTER_ROW, operator: 'sorta_equals' }).success,
    ).toBe(false);
  });

  it('a missing required `field` is still rejected', () => {
    expect(ViewFilterRuleSchema.safeParse({ operator: 'equals', value: 'won' }).success).toBe(false);
  });

  it('legacy operator spellings still fold to canonical on parse', () => {
    // `z.preprocess(normalizeFilterOperator, …)` is untouched by the posture
    // change — the one vocabulary is still one vocabulary. Probed on a bare
    // row so this measures the folding, not the `id` tolerance.
    expect(ViewFilterRuleSchema.parse({ field: 'amount', operator: 'gte', value: 1 }).operator)
      .toBe('greater_than_or_equal');
  });
});

// ===========================================================================
// 4. The mechanism, pinned where it bit — `.strip()` does not recurse
// ===========================================================================
describe('#5114 — why the flattened member could not rescue this block', () => {
  // Both assertions here run on the FILTER-FREE overlay on purpose: they are
  // controls for the member's own posture, so they must hold whichever way
  // `ViewFilterRuleSchema` is written. Re-close the fix and case 3/3 above goes
  // red while these two stay green — that gap IS the finding.
  it('the flattened member re-opens the TOP level: an unknown aux key rides along', () => {
    expect(
      ViewMetadataSchema.safeParse({ ...OVERLAY_BASE, someStudioAuxKey: 1 }).success,
    ).toBe(true);
  });

  it('…but a still-CLOSED nested block rejects through that same member', () => {
    // `emptyState` was closed at 批 18 and stays closed. The top level rides,
    // the nested block does not: `.strip()` re-opened one level, not the tree.
    expect(
      ViewMetadataSchema.safeParse({
        ...OVERLAY_BASE,
        emptyState: { title: 'None', notAnEmptyStateKey: 1 },
      }).success,
    ).toBe(false);
  });
});
