// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0066 D2 ⑧, v19, #36055] View All and Modify All widen records only and
 * cast no field vote. `viewAllFields` is the one "every field" channel: a read
 * vote, never an edit vote, and a set's own explicit `readable: false` row
 * beats its own bit (the own-row rule of the 2026-11-15 note, #33828).
 *
 * Pinned on the row-blind merge (`buildEffectiveFieldPermissions`, the `fields`
 * slot of `/auth/me/permissions`) and on the one function both field merges
 * ask, `viewAllFieldsReadVote`. The evaluator's merge is pinned beside it in
 * plugin-security's `fls-own-field-mask-33828.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEffectiveFieldPermissions,
  buildEffectiveObjectPermissions,
  viewAllFieldsReadVote,
} from './effective-object-permissions.js';

describe('[v19, #36055] View All and Modify All cast no field vote', () => {
  const hider = { objects: { deal: { allowRead: true } }, fields: { 'deal.amount': { readable: false, editable: false } } };
  const lock = { objects: { deal: { allowRead: true, allowEdit: true } }, fields: { 'deal.amount': { readable: true, editable: false } } };

  it('an unconverted set with View All alone no longer reads a field another set hides', () => {
    for (const objects of [{ deal: { allowRead: true, viewAllRecords: true } }, { '*': { allowRead: true, viewAllRecords: true } }]) {
      expect(buildEffectiveFieldPermissions([{ objects }, hider])).toEqual({ 'deal.amount': { readable: false, editable: false } });
      expect(viewAllFieldsReadVote([{ objects }], 'deal', 'amount')).toBe(false);
    }
  });

  it('Modify All opens neither the read nor the edit of a field another set hides or locks', () => {
    const modifyAll = { objects: { deal: { allowRead: true, allowEdit: true, modifyAllRecords: true } } };
    expect(buildEffectiveFieldPermissions([modifyAll, hider])).toEqual({ 'deal.amount': { readable: false, editable: false } });
    expect(buildEffectiveFieldPermissions([modifyAll, lock])).toEqual({ 'deal.amount': { readable: true, editable: false } });
    expect(viewAllFieldsReadVote([modifyAll], 'deal', 'amount')).toBe(false);
  });

  it('a set\'s own rows bind beside its own View All or Modify All', () => {
    for (const bits of [{ viewAllRecords: true }, { modifyAllRecords: true }]) {
      const own = { objects: { deal: { allowRead: true, allowEdit: true, ...bits } }, fields: hider.fields };
      expect(buildEffectiveFieldPermissions([own])).toEqual({ 'deal.amount': { readable: false, editable: false } });
      const ownLock = { objects: { deal: { allowRead: true, allowEdit: true, ...bits } }, fields: lock.fields };
      expect(buildEffectiveFieldPermissions([ownLock])).toEqual({ 'deal.amount': { readable: true, editable: false } });
    }
  });

  it('the conversion target: viewAllFields beside the bit restores the read, never the edit', () => {
    for (const bits of [{ viewAllRecords: true }, { modifyAllRecords: true }]) {
      const converted = { objects: { deal: { allowRead: true, allowEdit: true, ...bits, viewAllFields: true } } };
      expect(buildEffectiveFieldPermissions([converted, hider])).toEqual({ 'deal.amount': { readable: true, editable: false } });
      expect(buildEffectiveFieldPermissions([converted, lock])).toEqual({ 'deal.amount': { readable: true, editable: false } });
    }
  });

  it('a field no set names follows the object grant, so the bits change nothing there', () => {
    expect(buildEffectiveFieldPermissions([{ objects: { deal: { allowRead: true, modifyAllRecords: true } } }])).toEqual({});
  });
});

describe('[field-axis split, ruling 6912661484] viewAllFields: a read vote, never an edit vote', () => {
  const hider = { objects: { deal: { allowRead: true } }, fields: { 'deal.amount': { readable: false, editable: false } } };
  const reader = (objects: Record<string, unknown>, fields?: Record<string, unknown>) => ({ objects, fields });

  it('alone it reads every field another set hides, read-only, by the object entry and by the wildcard', () => {
    for (const objects of [{ deal: { allowRead: true, viewAllFields: true } }, { '*': { allowRead: true, viewAllFields: true } }]) {
      expect(buildEffectiveFieldPermissions([reader(objects), hider])).toEqual({ 'deal.amount': { readable: true, editable: false } });
      expect(viewAllFieldsReadVote([reader(objects)], 'deal', 'amount')).toBe(true);
    }
  });

  it('the set\'s own readable: false row beats its own viewAllFields; another set\'s bit still reads the field', () => {
    const own = reader({ deal: { allowRead: true, viewAllFields: true } }, { 'deal.amount': { readable: false, editable: false } });
    expect(buildEffectiveFieldPermissions([own])).toEqual({ 'deal.amount': { readable: false, editable: false } });
    expect(viewAllFieldsReadVote([own], 'deal', 'amount')).toBe(false);
    expect(viewAllFieldsReadVote([own], 'deal', 'stage')).toBe(true);
    expect(buildEffectiveFieldPermissions([own, reader({ deal: { viewAllFields: true } })]))
      .toEqual({ 'deal.amount': { readable: true, editable: false } });
    // The mask is read on the set that declares it, never on a sibling.
    expect(viewAllFieldsReadVote([reader({ deal: { viewAllFields: true } }), { fields: own.fields }], 'deal', 'amount')).toBe(true);
  });

  it('an edit lock beside it binds, and only an explicit false is a mask', () => {
    const bit = { deal: { allowRead: true, allowEdit: true, viewAllFields: true } };
    expect(buildEffectiveFieldPermissions([reader(bit, { 'deal.amount': { readable: true, editable: false } })])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
    // An unparsed row that omits `readable` is not an explicit mask: the vote stands.
    expect(buildEffectiveFieldPermissions([reader(bit, { 'deal.amount': { editable: false } })])).toEqual({
      'deal.amount': { readable: true, editable: false },
    });
  });

  it('an explicit entry is the set\'s whole answer: a wildcard bit does not reach an object the set names', () => {
    const named = reader({ '*': { viewAllFields: true }, deal: { allowRead: true } });
    expect(buildEffectiveFieldPermissions([named, hider])).toEqual({ 'deal.amount': { readable: false, editable: false } });
  });
});

describe('[field-axis split, ruling 6912661484] a wildcard viewAllFields is posture-blind: it votes on a private object\'s fields and grants no object', () => {
  // `vault` is private-posture, `deal` is public. The wildcard set carries a
  // plain read grant and the bit: no super-user bit, so its `'*'` does not
  // cover a private object.
  const schemas = [{ name: 'vault', access: { default: 'private' } }, { name: 'deal' }];
  const wildcard = { objects: { '*': { allowRead: true, viewAllFields: true } } };
  // Another set grants `vault` by name and hides one field of it.
  const hider = { objects: { vault: { allowRead: true } }, fields: { 'vault.pin': { readable: false, editable: false } } };

  it('the object axis: the wildcard grants the public object and nothing on the private one', () => {
    const objects = buildEffectiveObjectPermissions([wildcard], { allSchemas: () => schemas });
    expect(objects.deal?.allowRead).toBe(true);
    expect(objects.vault).toBeUndefined();
  });

  it('the field axis: the same wildcard still casts its read vote on the private object\'s field', () => {
    expect(viewAllFieldsReadVote([wildcard], 'vault', 'pin')).toBe(true);
    // Control: without the bit the field stays hidden, so the vote below is the bit's.
    expect(buildEffectiveFieldPermissions([{ objects: { '*': { allowRead: true } } }, hider])).toEqual({
      'vault.pin': { readable: false, editable: false },
    });
    expect(buildEffectiveFieldPermissions([wildcard, hider])).toEqual({ 'vault.pin': { readable: true, editable: false } });
  });
});
