// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧ note of 2026-11-15] A permission set's own explicit
// `readable: false` row on a field binds that set's holders over the set's own
// View All vote: the set casts no read vote on the field. Everything else of
// the 2026-11-02 note (ruling of record 6573563853) stands, and is pinned here
// from the other side:
//
//   1. THE SET'S OWN ROW — a holder of the set alone is not served the field,
//      in both field merges;
//   2. REVERSE PINS — another set's View All or Modify All on the object still
//      reads the field, the shipped `admin_full_access` included;
//   3. UNCHANGED — Modify All votes on every field, the set's own rows
//      included, and an edit lock beside View All binds as it always did;
//   4. ROW-BLIND PARITY — `/auth/me/permissions`' merge answers what
//      `getFieldPermissions` answers on every pair above;
//   5. THE ROW-LEVEL BYPASS — the set still holds View All on the object.
//
// The fixtures follow `fls-superuser-vote.test.ts`, which keeps the pins of
// the ruling this note amends.

import { describe, it, expect } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec';
import { buildEffectiveFieldPermissions } from '@objectstack/core';
import { PermissionEvaluator } from './permission-evaluator.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'sys_business_unit';
const MASKED = ['code', 'kind', 'manager_user_id', 'active'] as const;

const shipped = (name: string): PermissionSet => {
  const found = defaultPermissionSets.find((s) => s.name === name);
  if (!found) throw new Error(`shipped set ${name} not found`);
  return found;
};

const set = (raw: Record<string, unknown>): PermissionSet => PermissionSetSchema.parse(raw);

/** The rows hiding every listed field, for a set that also holds a bypass bit on the object. */
const OWN_MASK = Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }]));

/** An app set with plain object read and the same rows: no bypass of its own. */
const APP_MASK = set({ name: 'app_member', objects: { [OBJ]: { allowRead: true } }, fields: OWN_MASK });

const VIEW_ALL = set({ name: 'auditor', objects: { [OBJ]: { allowRead: true, viewAllRecords: true } } });
const MODIFY_ALL = set({
  name: 'operator',
  objects: { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
});

/** View All on the object, and the set's own rows hiding fields of it. */
const VIEW_ALL_OWN_MASK = set({
  name: 'auditor_masked',
  objects: { [OBJ]: { allowRead: true, viewAllRecords: true } },
  fields: OWN_MASK,
});
/** The same pair through the set's `'*'` wildcard. */
const WILDCARD_VIEW_ALL_OWN_MASK = set({
  name: 'wildcard_auditor_masked',
  objects: { '*': { allowRead: true, viewAllRecords: true } },
  fields: OWN_MASK,
});
/** Modify All on the object beside the set's own rows. */
const MODIFY_ALL_OWN_MASK = set({
  name: 'operator_masked',
  objects: { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
  fields: OWN_MASK,
});

const evaluator = new PermissionEvaluator();
const merge = (sets: PermissionSet[]) => evaluator.getFieldPermissions(OBJ, sets);
/** The `fields` slot `/auth/me/permissions` serves for `sets`, projected to this object's fields. */
const rowBlind = (sets: PermissionSet[]) =>
  Object.fromEntries(
    Object.entries(buildEffectiveFieldPermissions(sets))
      .filter(([k]) => k.startsWith(`${OBJ}.`))
      .map(([k, v]) => [k.slice(OBJ.length + 1), v]),
  );

/**
 * The two merges every reading below is taken from: `getFieldPermissions`,
 * which every data door reads, and the `fields` slot `/auth/me/permissions`
 * serves. One `describe` per merge, so each is red or green on its own.
 */
const MERGES: Array<[string, (sets: PermissionSet[]) => Record<string, { readable: boolean; editable: boolean }>]> = [
  ['getFieldPermissions', merge],
  ['/auth/me/permissions', rowBlind],
];

describe.each(MERGES)('[ADR-0066 ⑧ note of 2026-11-15] a set\'s own readable: false row wins over its own View All vote · %s', (_merge, read) => {
  it('a holder of the set alone is not served the fields the set hides', () => {
    const fp = read([VIEW_ALL_OWN_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('the same holds when the set holds View All through its wildcard', () => {
    const fp = read([WILDCARD_VIEW_ALL_OWN_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('a plain co-held set changes nothing: only a vote reads a field', () => {
    const plain = set({ name: 'plain', objects: { [OBJ]: { allowRead: true, allowEdit: true } } });
    const fp = read([VIEW_ALL_OWN_MASK, plain]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('the set\'s View All still reads a field ANOTHER set hides', () => {
    const partial = set({
      name: 'auditor_partial',
      objects: { [OBJ]: { allowRead: true, viewAllRecords: true } },
      fields: { [`${OBJ}.code`]: { readable: false, editable: false } },
    });
    const fp = read([partial, APP_MASK]);
    expect(fp.code, 'code').toEqual({ readable: false, editable: false });
    for (const f of MASKED.filter((m) => m !== 'code')) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });

  it('[reverse pin, ruling 6573563853] a second set holding View All on the object still reads every field', () => {
    const fp = read([VIEW_ALL_OWN_MASK, VIEW_ALL]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
    // Resolution order does not matter.
    expect(read([VIEW_ALL, VIEW_ALL_OWN_MASK])).toEqual(fp);
  });

  it('[reverse pin, ruling 6573563853] a second set holding Modify All on the object still reads and edits every field', () => {
    for (const second of [MODIFY_ALL, shipped(ADMIN_FULL_ACCESS)]) {
      const fp = read([VIEW_ALL_OWN_MASK, second]);
      for (const f of MASKED) expect(fp[f], `${second.name} ${f}`).toEqual({ readable: true, editable: true });
      // Resolution order does not matter.
      expect(read([second, VIEW_ALL_OWN_MASK])).toEqual(fp);
    }
  });

  it('[unchanged] Modify All votes on every field, the set\'s own rows included', () => {
    const own = read([MODIFY_ALL_OWN_MASK]);
    for (const f of MASKED) expect(own[f], f).toEqual({ readable: true, editable: true });
    const readOnlyRows = set({
      name: 'operator_read_only_rows',
      objects: { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
      fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: true, editable: false }])),
    });
    const locked = read([readOnlyRows]);
    for (const f of MASKED) expect(locked[f], f).toEqual({ readable: true, editable: true });
    // Both bits on one entry: the Modify All vote is the one that counts.
    const both = set({
      name: 'both_bits_masked',
      objects: { [OBJ]: { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true } },
      fields: OWN_MASK,
    });
    const bothBits = read([both]);
    for (const f of MASKED) expect(bothBits[f], f).toEqual({ readable: true, editable: true });
  });

  it('[unchanged] an edit lock beside the set\'s own View All binds: View All never granted an edit', () => {
    const lock = set({
      name: 'auditor_read_only_rows',
      objects: { [OBJ]: { allowRead: true, allowEdit: true, viewAllRecords: true } },
      fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: true, editable: false }])),
    });
    const fp = read([lock]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });
});

describe('[ADR-0066 ⑧ note of 2026-11-15] the row-blind /auth/me/permissions merge agrees with getFieldPermissions', () => {
  const combos: Array<[string, PermissionSet[]]> = [
    ['viewAll with its own mask', [VIEW_ALL_OWN_MASK]],
    ['wildcard viewAll with its own mask', [WILDCARD_VIEW_ALL_OWN_MASK]],
    ['viewAll with its own mask + viewAll', [VIEW_ALL_OWN_MASK, VIEW_ALL]],
    ['viewAll with its own mask + modifyAll', [VIEW_ALL_OWN_MASK, MODIFY_ALL]],
    ['viewAll with its own mask + admin_full_access', [VIEW_ALL_OWN_MASK, shipped(ADMIN_FULL_ACCESS)]],
    ['viewAll with its own mask + the app mask', [VIEW_ALL_OWN_MASK, APP_MASK]],
    ['modifyAll with its own mask', [MODIFY_ALL_OWN_MASK]],
  ];

  it.each(combos)('%s', (_label, sets) => {
    expect(rowBlind(sets)).toEqual(merge(sets));
  });
});

describe('[ADR-0066 ⑧ note of 2026-11-15] the row-level bypass is untouched', () => {
  it('a View All set that hides a field of the object still holds View All on it', () => {
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'view' })).toEqual(['auditor_masked']);
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'modify' })).toEqual([]);
  });
});
