// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10235] The per-column sortability projection — the serve-time signal that
 * replaces every consumer-side "virtual ⇒ unsortable" re-derivation (2026-08-23
 * ruling, option A).
 *
 * What is pinned, and why each pin is load-bearing:
 *
 * - **The projection tracks the predicate** — the unsortable verdict is looped
 *   over `SEARCH_VIRTUAL_TYPES` itself, so a driver growing a second virtual
 *   type widens the projection with NO edit here; and the two computed types
 *   that sort correctly (`summary` / `autonumber`, measured #6924) are pinned
 *   `sortable: true`, the over-widening that would refuse working sorts.
 * - **Anti-vacuity** — ordinary persisted columns answer `sortable: true`, so
 *   the projection cannot go green by marking everything unsortable.
 * - **The #7865 anchor caveat** — unprovisioned injected anchors on an
 *   ADR-0015 `external` object stay `sortable: true` (the doors ACCEPT the
 *   sort) and carry the caveat (the measured silent drop); an author-declared
 *   column of the same name is the author's and carries none.
 * - **Wire validity** — every resolved projection parses under
 *   `ObjectSortabilitySchema`, the schema the REST envelope declares.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveObjectSortability,
  ObjectSortabilitySchema,
  FIELD_UNSORTABLE_VIRTUAL_TYPE,
  FIELD_SORTABLE_UNPROVISIONED_ANCHOR,
} from './sortability.zod';
import { SEARCH_VIRTUAL_TYPES } from '../data/search-fields';

/** The #10235 oracle shape: a formula column displayed in a shipped grid. */
const OPPORTUNITY_LIKE = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text' },
    amount: { type: 'currency' },
    expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
    close_date: { type: 'date' },
  },
};

describe('#10235 resolveObjectSortability — the closed category set', () => {
  it('marks a formula column unsortable with the refusal-backed reason', () => {
    const { fields } = resolveObjectSortability(OPPORTUNITY_LIKE);
    expect(fields.expected_revenue).toEqual({
      sortable: false,
      reason: FIELD_UNSORTABLE_VIRTUAL_TYPE,
    });
  });

  it('anti-vacuity: ordinary persisted columns are sortable', () => {
    const { fields } = resolveObjectSortability(OPPORTUNITY_LIKE);
    expect(fields.name).toEqual({ sortable: true });
    expect(fields.amount).toEqual({ sortable: true });
    expect(fields.close_date).toEqual({ sortable: true });
  });

  it('tracks the spec predicate: EVERY virtual type is unsortable, with no local type list', () => {
    // Loop over the predicate's own vocabulary, so widening
    // `SEARCH_VIRTUAL_TYPES` widens this pin — and the projection — together.
    expect(SEARCH_VIRTUAL_TYPES.size).toBeGreaterThan(0);
    for (const vtype of SEARCH_VIRTUAL_TYPES) {
      const { fields } = resolveObjectSortability({
        name: 'x',
        fields: { v: { type: vtype } },
      });
      expect(fields.v).toEqual({ sortable: false, reason: FIELD_UNSORTABLE_VIRTUAL_TYPE });
    }
  });

  it('does NOT widen to the write contract: summary and autonumber sort correctly', () => {
    // The `COMPUTED_VALUE_TYPES` trap `validate-sortable-fields` and the
    // ingress door both document: `summary` is an engine-maintained float
    // column, `autonumber` an engine-assigned string column — refusing them
    // is the false finding that makes the signal untrustworthy.
    const { fields } = resolveObjectSortability({
      name: 'x',
      fields: {
        total: { type: 'summary' },
        seq: { type: 'autonumber' },
      },
    });
    expect(fields.total).toEqual({ sortable: true });
    expect(fields.seq).toEqual({ sortable: true });
  });

  it('appends the driver-provisioned id, and never clobbers a declared one', () => {
    const { fields } = resolveObjectSortability(OPPORTUNITY_LIKE);
    expect(fields.id).toEqual({ sortable: true });
    // Degenerate but declared: an author field named `id` keeps its own verdict.
    const declared = resolveObjectSortability({
      name: 'x',
      fields: { id: { type: 'formula' } },
    });
    expect(declared.fields.id).toEqual({ sortable: false, reason: FIELD_UNSORTABLE_VIRTUAL_TYPE });
  });

  it('reads both served field-map shapes (record and array)', () => {
    const arrayShape = resolveObjectSortability({
      name: 'x',
      fields: [
        { name: 'plain', type: 'text' },
        { name: 'virtual', type: 'formula' },
      ],
    });
    expect(arrayShape.fields.plain).toEqual({ sortable: true });
    expect(arrayShape.fields.virtual).toEqual({ sortable: false, reason: FIELD_UNSORTABLE_VIRTUAL_TYPE });
  });
});

describe('#10235 the #7865 anchor category — accepted, caveated, never refused', () => {
  /** An ADR-0015 external object as the registry serves it: injected anchors present. */
  const EXTERNAL = {
    name: 'ext_customer',
    external: { datasource: 'remote_pg', table: 'customers' },
    fields: {
      name: { type: 'text' },
      // The platform's own injected anchors, byte-identical to the shipped
      // definitions is not required for THIS derivation: absence from the
      // authored map is the common pre-injection shape, and
      // `unprovisionedInjectedColumns` answers from the document either way.
    },
  };

  it('caveats the unprovisioned injected anchors on an external object', () => {
    const { fields } = resolveObjectSortability(EXTERNAL);
    // The audit family and owner/tenant anchors are registered with no
    // storage behind them (#7865): accepted by both doors, silently dropped
    // by the driver when the remote lacks the column (#10474's measurement).
    expect(fields.created_at).toEqual({
      sortable: true,
      caveat: FIELD_SORTABLE_UNPROVISIONED_ANCHOR,
    });
    expect(fields.owner_id).toEqual({
      sortable: true,
      caveat: FIELD_SORTABLE_UNPROVISIONED_ANCHOR,
    });
    // The author's own mapped column is plainly sortable — no caveat.
    expect(fields.name).toEqual({ sortable: true });
  });

  it('an author-DECLARED anchor name on an external object is the author\'s — no caveat', () => {
    // #7859's direction: declaring the column vouches for the remote schema.
    const { fields } = resolveObjectSortability({
      name: 'ext_customer',
      external: { datasource: 'remote_pg', table: 'customers' },
      fields: {
        created_at: { type: 'datetime', label: 'Remote creation time' },
      },
    });
    expect(fields.created_at).toEqual({ sortable: true });
  });

  it('platform-provisioned objects carry no caveat on their anchors', () => {
    const { fields } = resolveObjectSortability({
      name: 'local_obj',
      fields: {
        created_at: { type: 'datetime' },
        owner_id: { type: 'lookup' },
      },
    });
    expect(fields.created_at).toEqual({ sortable: true });
    expect(fields.owner_id).toEqual({ sortable: true });
  });
});

describe('#10235 wire validity — the projection parses under its own schema', () => {
  it.each([
    ['oracle-shaped object', OPPORTUNITY_LIKE],
    ['external object', {
      name: 'ext_customer',
      external: { datasource: 'remote_pg', table: 'customers' },
      fields: { name: { type: 'text' } },
    }],
    ['fieldless document', { name: 'bare' }],
  ])('%s', (_label, doc) => {
    const projection = resolveObjectSortability(doc);
    const parsed = ObjectSortabilitySchema.safeParse(projection);
    expect(parsed.success).toBe(true);
  });
});
