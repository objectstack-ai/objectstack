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
//      bits as `getFieldPermissions` for the same sets.
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

const evaluator = new PermissionEvaluator();
const merge = (sets: PermissionSet[]) => evaluator.getFieldPermissions(OBJ, sets);

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
  ];

  it.each(combos)('%s', (_label, sets) => {
    const perObject = merge(sets);
    const rowBlind = buildEffectiveFieldPermissions(sets);
    const projected = Object.fromEntries(
      Object.entries(rowBlind)
        .filter(([k]) => k.startsWith(`${OBJ}.`))
        .map(([k, v]) => [k.slice(OBJ.length + 1), v]),
    );
    expect(projected).toEqual(perObject);
  });
});
