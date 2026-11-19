// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D2 ⑧ note of 2026-11-15] A set's own explicit `readable: false`
 * row is that set's vote on the field: its own View All casts no read vote
 * there. Another set's bypass still votes (the admin case of ruling of record
 * 6573563853), and a Modify All set still votes on every field, its own rows
 * included.
 *
 * Pinned on the row-blind merge (`buildEffectiveFieldPermissions`, the `fields`
 * slot of `/auth/me/permissions`) and on the one function both field merges
 * ask, `superuserFieldVote`. The evaluator's merge is pinned beside it in
 * plugin-security's `fls-own-field-mask-33828.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { buildEffectiveFieldPermissions, superuserFieldVote } from './effective-object-permissions.js';

describe('a set\'s own readable: false row and that set\'s own super-user vote', () => {
  const viewAll = (
    fields: Record<string, unknown>,
    objects: Record<string, unknown> = { deal: { allowRead: true, viewAllRecords: true } },
  ) => ({ objects, fields });
  const mask = { 'deal.amount': { readable: false, editable: false } };

  it('View All beside the set\'s own readable: false row: the row binds, by the object entry and by the wildcard', () => {
    expect(buildEffectiveFieldPermissions([viewAll(mask)])).toEqual({ 'deal.amount': { readable: false, editable: false } });
    expect(buildEffectiveFieldPermissions([viewAll(mask, { '*': { viewAllRecords: true } })])).toEqual({
      'deal.amount': { readable: false, editable: false },
    });
    // Two holders of the pair, each masking the field itself: nobody votes it readable.
    expect(buildEffectiveFieldPermissions([viewAll(mask), viewAll(mask)])).toEqual({
      'deal.amount': { readable: false, editable: false },
    });
  });

  it('the same set\'s View All still votes on the fields it does not mask itself', () => {
    // `deal.stage` is masked by ANOTHER set; this set's View All reads it as before.
    expect(buildEffectiveFieldPermissions([
      viewAll(mask),
      { objects: { deal: { allowRead: true } }, fields: { 'deal.stage': { readable: false, editable: false } } },
    ])).toEqual({
      'deal.amount': { readable: false, editable: false },
      'deal.stage': { readable: true, editable: false },
    });
  });

  it('reverse pin: another set\'s View All or Modify All on the object still reads the masked field', () => {
    expect(buildEffectiveFieldPermissions([viewAll(mask), { objects: { deal: { viewAllRecords: true } } }])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
    expect(buildEffectiveFieldPermissions([viewAll(mask), { objects: { '*': { viewAllRecords: true } } }])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
    expect(buildEffectiveFieldPermissions([viewAll(mask), { objects: { deal: { modifyAllRecords: true } } }])).toEqual({
      'deal.amount': { readable: true, editable: true },
    });
    // Another set's declared `readable: true` still out-votes the mask: union without deny.
    expect(buildEffectiveFieldPermissions([viewAll(mask), { fields: { 'deal.amount': { readable: true, editable: false } } }]))
      .toEqual({ 'deal.amount': { readable: true, editable: false } });
  });

  it('Modify All is unchanged: it votes on every field, the set\'s own rows included', () => {
    const modifyAll = { deal: { allowRead: true, allowEdit: true, modifyAllRecords: true } };
    expect(buildEffectiveFieldPermissions([{ objects: modifyAll, fields: mask }])).toEqual({
      'deal.amount': { readable: true, editable: true },
    });
    expect(buildEffectiveFieldPermissions([{ objects: modifyAll, fields: { 'deal.amount': { readable: true, editable: false } } }]))
      .toEqual({ 'deal.amount': { readable: true, editable: true } });
    // Both bits on one entry: the Modify All vote is the one that counts.
    expect(buildEffectiveFieldPermissions([
      { objects: { deal: { viewAllRecords: true, modifyAllRecords: true } }, fields: mask },
    ])).toEqual({ 'deal.amount': { readable: true, editable: true } });
  });

  it('an edit lock beside View All binds as it always did, and only an explicit false is a mask', () => {
    expect(buildEffectiveFieldPermissions([viewAll({ 'deal.amount': { readable: true, editable: false } })])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
    // An unparsed row that omits `readable` is not an explicit mask: the vote stands.
    expect(buildEffectiveFieldPermissions([viewAll({ 'deal.amount': { editable: false } })])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
  });

  it('superuserFieldVote: per field with a field name, object-wide without one', () => {
    const sets = [viewAll(mask)];
    expect(superuserFieldVote(sets, 'deal', 'amount')).toBeNull();
    expect(superuserFieldVote(sets, 'deal', 'stage')).toEqual({ readable: true, editable: false });
    expect(superuserFieldVote(sets, 'deal')).toEqual({ readable: true, editable: false });
    expect(superuserFieldVote([{ objects: { deal: { modifyAllRecords: true } }, fields: mask }], 'deal', 'amount'))
      .toEqual({ readable: true, editable: true });
    // The mask is read on the set that declares it, never on a sibling.
    expect(superuserFieldVote([{ objects: { deal: { viewAllRecords: true } } }, { fields: mask }], 'deal', 'amount'))
      .toEqual({ readable: true, editable: false });
  });
});
