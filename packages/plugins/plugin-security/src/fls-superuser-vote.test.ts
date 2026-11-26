// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧, v19 #36055] View All (`viewAllRecords`) and Modify All
// (`modifyAllRecords`) widen records only and cast no field vote. The one
// "every field" vote is `viewAllFields`: `readable: true` on every field of the
// object, never `editable: true` (the field-axis split, ruling 6912661484).
// Union without deny is otherwise unchanged.
//
// What the first card measured (ruling of record 6573563853): an app set
// grants `sys_business_unit` read and marks every field but `name`
// `readable: false`; a platform admin who also holds that set (beside
// `admin_full_access`) was served `name` only. The shipped admin set keeps
// reading every field through its `'*'` `viewAllFields`; from v19 it no longer
// edits a field another set it holds locks, because no bit votes an edit.
//
// Four groups, each against the shipped `admin_full_access` where it applies,
// never a hand-rolled copy of it:
//
//   1. THE VOTE — the admin + app-set merge reads every field the app masks,
//      read-only; View All and Modify All alone read none of them;
//   2. CONTROLS — a caller holding only the app set is still masked;
//   3. ONE PREDICATE — the read vote is held exactly when a set carries
//      `viewAllFields` on the object, and no set ever votes an edit;
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
import { buildEffectiveFieldPermissions, viewAllFieldsReadVote } from '@objectstack/core';
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
const VIEW_ALL_FIELDS = set({ name: 'reader_all', objects: { [OBJ]: { allowRead: true, viewAllFields: true } } });
/** The ADR-0087 conversion target: Modify All with `viewAllFields: true` beside it. */
const MODIFY_ALL_CONVERTED = set({
  name: 'operator_converted',
  objects: { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true, viewAllFields: true } },
});
/** A `viewAllFields` wildcard whose own explicit entry for the object shadows it (`resolveObjectPermission`). */
const SHADOWED_WILDCARD = set({
  name: 'shadowed',
  objects: { '*': { allowRead: true, viewAllRecords: true, modifyAllRecords: true, viewAllFields: true }, [OBJ]: { allowRead: true } },
});

const evaluator = new PermissionEvaluator();
const merge = (sets: PermissionSet[]) => evaluator.getFieldPermissions(OBJ, sets);

describe('[ADR-0066 ⑧, v19 #36055] viewAllFields reads every field of its object; View All and Modify All read none', () => {
  it('the shipped admin_full_access reaches the object through its wildcard, viewAllFields included (premise guard)', () => {
    // Without this, a future explicit `sys_business_unit` entry on the shipped
    // set would make the vote below vanish for a reason this file never names.
    const admin = shipped(ADMIN_FULL_ACCESS);
    expect(admin.objects?.[OBJ]).toBeUndefined();
    expect(admin.objects?.['*']).toMatchObject({ viewAllRecords: true, modifyAllRecords: true, viewAllFields: true });
    expect(Object.keys(admin.fields ?? {}).filter((k) => k.startsWith(`${OBJ}.`))).toEqual([]);
  });

  it('[the card] admin_full_access + the app mask: every masked field is readable, and no longer editable', () => {
    const fp = merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });

  it('[order] the vote does not depend on which set resolves first', () => {
    expect(merge([APP_MASK, shipped(ADMIN_FULL_ACCESS)])).toEqual(merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]));
  });

  it('[control] the app mask alone still withholds every field it names (union without deny is unchanged)', () => {
    const fp = merge([APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('[control] a set with plain object read and no bit casts no vote', () => {
    const plain = set({ name: 'plain', objects: { [OBJ]: { allowRead: true, allowEdit: true } } });
    const fp = merge([plain, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('viewAllRecords alone reads no field another set hides', () => {
    const masked = merge([VIEW_ALL, APP_MASK]);
    for (const f of MASKED) expect(masked[f], f).toEqual({ readable: false, editable: false });
  });

  it('modifyAllRecords alone reads no hidden field and edits no locked field', () => {
    const masked = merge([MODIFY_ALL, APP_MASK]);
    for (const f of MASKED) expect(masked[f], f).toEqual({ readable: false, editable: false });
    const readOnly = merge([MODIFY_ALL, APP_READ_ONLY]);
    for (const f of MASKED) expect(readOnly[f], f).toEqual({ readable: true, editable: false });
  });

  it('viewAllFields votes readable only — it never grants an edit, beside Modify All included', () => {
    for (const reader of [VIEW_ALL_FIELDS, MODIFY_ALL_CONVERTED]) {
      const masked = merge([reader, APP_MASK]);
      for (const f of MASKED) expect(masked[f], f).toEqual({ readable: true, editable: false });
      const readOnly = merge([reader, APP_READ_ONLY]);
      for (const f of MASKED) expect(readOnly[f], f).toEqual({ readable: true, editable: false });
    }
  });

  it('a wildcard shadowed by the same set\'s explicit entry casts no vote, as at row level', () => {
    const fp = merge([SHADOWED_WILDCARD, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('the vote reaches only the object it is held on', () => {
    const elsewhere = set({ name: 'elsewhere', objects: { other_object: { allowRead: true, viewAllFields: true } } });
    const fp = merge([elsewhere, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('an undeclared field stays absent: the vote adds no entry (absent already means unrestricted)', () => {
    const fp = merge([shipped(ADMIN_FULL_ACCESS), APP_MASK]);
    expect(Object.keys(fp).sort()).toEqual([...MASKED].sort());
  });
});

describe('[v19 #36055] one predicate: the read vote follows viewAllFields, and nothing votes an edit', () => {
  const cases: Array<[string, PermissionSet[], boolean]> = [
    ['admin_full_access', [shipped(ADMIN_FULL_ACCESS)], true],
    ['viewAllRecords', [VIEW_ALL], false],
    ['modifyAllRecords', [MODIFY_ALL], false],
    ['viewAllFields', [VIEW_ALL_FIELDS], true],
    ['modifyAllRecords + viewAllFields', [MODIFY_ALL_CONVERTED], true],
    ['shadowed wildcard', [SHADOWED_WILDCARD], false],
    ['plain object read and edit', [set({ name: 'plain_rw', objects: { [OBJ]: { allowRead: true, allowEdit: true } } })], false],
    ['member_default', [shipped('member_default')], false],
  ];

  it.each(cases)('%s: readable equals the viewAllFields answer, editable is the mask\'s false', (_label, sets, reads) => {
    const all = [...sets, APP_MASK];
    const fp = merge(all);
    for (const f of MASKED) {
      expect(viewAllFieldsReadVote(all, OBJ, f), `${f} vote`).toBe(reads);
      expect(fp[f].readable, `${f} readable`).toBe(reads);
      expect(fp[f].editable, `${f} editable`).toBe(false);
    }
  });
});

describe('[v19 #36055] the row-blind /auth/me/permissions merge agrees with getFieldPermissions', () => {
  const combos: Array<[string, PermissionSet[]]> = [
    ['admin_full_access + mask', [shipped(ADMIN_FULL_ACCESS), APP_MASK]],
    ['mask only', [APP_MASK]],
    ['viewAll + mask', [VIEW_ALL, APP_MASK]],
    ['modifyAll + read-only', [MODIFY_ALL, APP_READ_ONLY]],
    ['viewAllFields + mask', [VIEW_ALL_FIELDS, APP_MASK]],
    ['modifyAll converted + read-only', [MODIFY_ALL_CONVERTED, APP_READ_ONLY]],
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
