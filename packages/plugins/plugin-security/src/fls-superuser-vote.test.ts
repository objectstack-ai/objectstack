// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧ — ruling of record 6573563853, letter A] A permission set
// that holds the super-user bypass on an object votes in the field-permission
// merge on EVERY field of that object: `viewAllRecords` votes `readable: true`,
// `modifyAllRecords` votes `readable: true` and `editable: true`. Union without
// deny is otherwise unchanged.
//
// What the card measured: an app set grants `sys_business_unit` read and marks
// every field but `name` `readable: false`; a platform admin who also holds
// that set (beside `admin_full_access`) was served `name` only, because
// `admin_full_access` grants the object through its `'*'` super-user wildcard
// but declares no field entry, so it cast no vote and the app set's
// `readable: false` won.
//
// Four groups, each against the shipped `admin_full_access` where it applies,
// never a hand-rolled copy of it:
//
//   1. THE VOTE — the admin + app-set merge keeps every field the app masks;
//   2. CONTROLS — a caller holding only the app set is still masked, and a
//      `viewAllRecords`-only set never contributes an edit grant;
//   3. ONE PREDICATE — the vote is held exactly when `superuserBypassSets`
//      answers non-empty, so the field merge and the row-level bypass can never
//      disagree about who is a super-user on an object;
//   4. ROW-BLIND PARITY — `/auth/me/permissions`' merge
//      (`buildEffectiveFieldPermissions`, `@objectstack/core`) answers the same
//      bits as `getFieldPermissions` for the same sets;
//   5. THE SET'S OWN ROW (ADR-0066 D2 ⑧ note of 2026-11-15) — a View All set's
//      own `readable: false` row binds its holders in both merges; another
//      set's bypass still reads the field, and Modify All votes as before.
//
// The HTTP doors (list, sort, record read, `/auth/me/permissions`, explain) are
// pinned on a real boot in
// `packages/qa/dogfood/test/fls-superuser-vote.dogfood.test.ts`.

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
  const set = defaultPermissionSets.find((s) => s.name === name);
  if (!set) throw new Error(`shipped set ${name} not found`);
  return set;
};

const set = (raw: Record<string, unknown>): PermissionSet => PermissionSetSchema.parse(raw);

/** The card's app set: object read, every listed field withheld. */
const APP_MASK = set({
  name: 'app_member',
  objects: { [OBJ]: { allowRead: true } },
  fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }])),
});

/** A read-only app set: the fields served, edits withheld. */
const APP_READ_ONLY = set({
  name: 'app_reader',
  objects: { [OBJ]: { allowRead: true } },
  fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: true, editable: false }])),
});

const VIEW_ALL = set({ name: 'auditor', objects: { [OBJ]: { allowRead: true, viewAllRecords: true } } });
const MODIFY_ALL = set({
  name: 'operator',
  objects: { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
});
/** A super-user wildcard whose own explicit entry for the object shadows it (`resolveObjectPermission`). */
const SHADOWED_WILDCARD = set({
  name: 'shadowed',
  objects: { '*': { allowRead: true, viewAllRecords: true, modifyAllRecords: true }, [OBJ]: { allowRead: true } },
});

/** The field rows of {@link APP_MASK}, for a set that also holds a bypass bit on the object. */
const OWN_MASK = Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: false, editable: false }]));
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

describe('[ADR-0066 ⑧, ruling 6573563853] a super-user set votes on every field of its object', () => {
  it('the shipped admin_full_access reaches the object through its wildcard super-user bits (premise guard)', () => {
    // Without this, a future explicit `sys_business_unit` entry on the shipped
    // set would make the vote below vanish for a reason this file never names.
    const admin = shipped(ADMIN_FULL_ACCESS);
    expect(admin.objects?.[OBJ]).toBeUndefined();
    expect(admin.objects?.['*']).toMatchObject({ viewAllRecords: true, modifyAllRecords: true });
    expect(Object.keys(admin.fields ?? {}).filter((k) => k.startsWith(`${OBJ}.`))).toEqual([]);
  });

  it('[the card] admin_full_access + the app mask: every masked field is readable and editable', () => {
    const fp = merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: true });
  });

  it('[order] the vote does not depend on which set resolves first', () => {
    expect(merge([APP_MASK, shipped(ADMIN_FULL_ACCESS)])).toEqual(merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]));
  });

  it('[control] the app mask alone still withholds every field it names (union without deny is unchanged)', () => {
    const fp = merge([APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('[control] a set with plain object read and no super-user bit casts no vote', () => {
    const plain = set({ name: 'plain', objects: { [OBJ]: { allowRead: true, allowEdit: true } } });
    const fp = merge([plain, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('viewAllRecords votes readable only — it never grants an edit', () => {
    const masked = merge([VIEW_ALL, APP_MASK]);
    for (const f of MASKED) expect(masked[f], f).toEqual({ readable: true, editable: false });
    const readOnly = merge([VIEW_ALL, APP_READ_ONLY]);
    for (const f of MASKED) expect(readOnly[f], f).toEqual({ readable: true, editable: false });
  });

  it('modifyAllRecords votes readable and editable', () => {
    const fp = merge([MODIFY_ALL, APP_READ_ONLY]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: true });
  });

  it('a super-user wildcard shadowed by the same set\'s explicit entry casts no vote, as at row level', () => {
    const fp = merge([SHADOWED_WILDCARD, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('the vote reaches only the object it is held on', () => {
    const elsewhere = set({ name: 'elsewhere', objects: { other_object: { allowRead: true, modifyAllRecords: true } } });
    const fp = merge([elsewhere, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('an undeclared field stays absent: the vote adds no entry (absent already means unrestricted)', () => {
    const fp = merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]);
    expect(Object.keys(fp).sort()).toEqual([...MASKED].sort());
  });
});

describe('[ruling 6573563853] one super-user predicate: the field vote follows superuserBypassSets', () => {
  const cases: Array<[string, PermissionSet[]]> = [
    ['admin_full_access', [shipped(ADMIN_FULL_ACCESS)]],
    ['viewAllRecords', [VIEW_ALL]],
    ['modifyAllRecords', [MODIFY_ALL]],
    ['shadowed wildcard', [SHADOWED_WILDCARD]],
    ['plain object read and edit', [set({ name: 'plain_rw', objects: { [OBJ]: { allowRead: true, allowEdit: true } } })]],
    ['member_default', [shipped('member_default')]],
  ];

  it.each(cases)('%s: readable/editable votes equal the view/modify bypass answers', (_label, sets) => {
    const all = [...sets, APP_MASK];
    const fp = merge(all);
    const view = evaluator.superuserBypassSets(OBJ, all, { bit: 'view' }).length > 0;
    const modify = evaluator.superuserBypassSets(OBJ, all, { bit: 'modify' }).length > 0;
    for (const f of MASKED) {
      expect(fp[f].readable, `${f} readable`).toBe(view);
      expect(fp[f].editable, `${f} editable`).toBe(modify);
    }
  });

  it.each([false, true])('the private posture never changes the super-user answer (isPrivate: %s)', (isPrivate) => {
    // The posture withholds only a wildcard WITHOUT the bits, so the field
    // merge, which takes no posture, reads the same sets as the row bypass.
    for (const [, sets] of cases) {
      for (const bit of ['view', 'modify'] as const) {
        expect(evaluator.superuserBypassSets(OBJ, sets, { bit, isPrivate }))
          .toEqual(evaluator.superuserBypassSets(OBJ, sets, { bit }));
      }
    }
  });
});

describe('[ruling 6573563853] the row-blind /auth/me/permissions merge agrees with getFieldPermissions', () => {
  const combos: Array<[string, PermissionSet[]]> = [
    ['admin_full_access + mask', [shipped(ADMIN_FULL_ACCESS), APP_MASK]],
    ['mask only', [APP_MASK]],
    ['viewAll + mask', [VIEW_ALL, APP_MASK]],
    ['viewAll + read-only', [VIEW_ALL, APP_READ_ONLY]],
    ['modifyAll + read-only', [MODIFY_ALL, APP_READ_ONLY]],
    ['shadowed wildcard + mask', [SHADOWED_WILDCARD, APP_MASK]],
    ['member_default + mask', [shipped('member_default'), APP_MASK]],
    ['viewAll with its own mask', [VIEW_ALL_OWN_MASK]],
    ['viewAll with its own mask + viewAll', [VIEW_ALL_OWN_MASK, VIEW_ALL]],
    ['viewAll with its own mask + modifyAll', [VIEW_ALL_OWN_MASK, MODIFY_ALL]],
    ['viewAll with its own mask + admin_full_access', [VIEW_ALL_OWN_MASK, shipped(ADMIN_FULL_ACCESS)]],
    ['modifyAll with its own mask', [MODIFY_ALL_OWN_MASK]],
  ];

  it.each(combos)('%s', (_label, sets) => {
    expect(rowBlind(sets)).toEqual(merge(sets));
  });
});

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

describe('[ADR-0066 ⑧ note of 2026-11-15] the row-level bypass is untouched', () => {
  it('a View All set that hides a field of the object still holds View All on it', () => {
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'view' })).toEqual(['auditor_masked']);
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'modify' })).toEqual([]);
  });
});
