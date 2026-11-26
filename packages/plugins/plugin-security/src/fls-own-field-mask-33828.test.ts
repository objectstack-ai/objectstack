// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0066 D2 ⑧, v19 #36055] View All and Modify All widen records only and
// cast no field vote, so a set's own `readable: false` row binds its holders
// beside its own View All or Modify All, and its own `editable: false` row
// binds beside its own Modify All. The own-row rule of the 2026-11-15 note
// (#33828) now lives on `viewAllFields`, the one "every field" vote:
//
//   1. THE SET'S OWN ROW — a holder of the set alone is not served the field,
//      in both field merges, beside View All or Modify All;
//   2. CROSS-SET — another set's View All or Modify All no longer reads the
//      field; another set's `viewAllFields` (the shipped `admin_full_access`
//      included) still reads it, read-only;
//   3. ROW-BLIND PARITY — `/auth/me/permissions`' merge answers what
//      `getFieldPermissions` answers on every pair above;
//   4. THE ROW-LEVEL BYPASS — the set still holds View All on the object.
//
// Below them, the field-axis split's `viewAllFields` (ruling of record
// 6912661484): the own-row rule on the read-only bit, and the step-3 pin for
// the built-in admin sets, which read every field through the bit alone.
//
// The fixtures follow `fls-superuser-vote.test.ts`.

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

/** The bit alone: plain object read and `viewAllFields`, no record bypass. */
const VIEW_ALL_FIELDS = set({ name: 'field_reader', objects: { [OBJ]: { allowRead: true, viewAllFields: true } } });
/** The bit beside the set's own rows hiding the same fields. */
const VIEW_ALL_FIELDS_OWN_MASK = set({
  name: 'field_reader_masked',
  objects: { [OBJ]: { allowRead: true, viewAllFields: true } },
  fields: OWN_MASK,
});
/** The bit on the set's wildcard. */
const WILDCARD_VIEW_ALL_FIELDS = set({ name: 'wildcard_field_reader', objects: { '*': { allowRead: true, viewAllFields: true } } });

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

describe.each(MERGES)('[v19 #36055] a set\'s own rows bind beside its own View All or Modify All · %s', (_merge, read) => {
  it('a holder of the set alone is not served the fields the set hides', () => {
    for (const s of [VIEW_ALL_OWN_MASK, WILDCARD_VIEW_ALL_OWN_MASK, MODIFY_ALL_OWN_MASK]) {
      const fp = read([s]);
      for (const f of MASKED) expect(fp[f], `${s.name} ${f}`).toEqual({ readable: false, editable: false });
    }
  });

  it('a plain co-held set changes nothing: only a vote reads a field', () => {
    const plain = set({ name: 'plain', objects: { [OBJ]: { allowRead: true, allowEdit: true } } });
    const fp = read([VIEW_ALL_OWN_MASK, plain]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });

  it('View All or Modify All no longer reads a field ANOTHER set hides', () => {
    for (const second of [VIEW_ALL, MODIFY_ALL]) {
      const fp = read([second, APP_MASK]);
      for (const f of MASKED) expect(fp[f], `${second.name} ${f}`).toEqual({ readable: false, editable: false });
      const both = read([VIEW_ALL_OWN_MASK, second]);
      for (const f of MASKED) expect(both[f], `${second.name} ${f}`).toEqual({ readable: false, editable: false });
    }
  });

  it('another set\'s viewAllFields still reads every field, read-only, the shipped admin_full_access included', () => {
    for (const second of [VIEW_ALL_FIELDS, shipped(ADMIN_FULL_ACCESS)]) {
      const fp = read([VIEW_ALL_OWN_MASK, second]);
      for (const f of MASKED) expect(fp[f], `${second.name} ${f}`).toEqual({ readable: true, editable: false });
      // Resolution order does not matter.
      expect(read([second, VIEW_ALL_OWN_MASK])).toEqual(fp);
    }
  });

  it('an edit lock beside the set\'s own View All or Modify All binds', () => {
    for (const bits of [{ viewAllRecords: true }, { modifyAllRecords: true }, { viewAllRecords: true, modifyAllRecords: true }]) {
      const lock = set({
        name: 'read_only_rows',
        objects: { [OBJ]: { allowRead: true, allowEdit: true, ...bits } },
        fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: true, editable: false }])),
      });
      const fp = read([lock]);
      for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
    }
  });
});

describe('[v19 #36055] the row-blind /auth/me/permissions merge agrees with getFieldPermissions', () => {
  const combos: Array<[string, PermissionSet[]]> = [
    ['viewAll with its own mask', [VIEW_ALL_OWN_MASK]],
    ['wildcard viewAll with its own mask', [WILDCARD_VIEW_ALL_OWN_MASK]],
    ['viewAll with its own mask + viewAll', [VIEW_ALL_OWN_MASK, VIEW_ALL]],
    ['viewAll with its own mask + modifyAll', [VIEW_ALL_OWN_MASK, MODIFY_ALL]],
    ['viewAll with its own mask + admin_full_access', [VIEW_ALL_OWN_MASK, shipped(ADMIN_FULL_ACCESS)]],
    ['viewAll with its own mask + viewAllFields', [VIEW_ALL_OWN_MASK, VIEW_ALL_FIELDS]],
    ['viewAll with its own mask + the app mask', [VIEW_ALL_OWN_MASK, APP_MASK]],
    ['modifyAll with its own mask', [MODIFY_ALL_OWN_MASK]],
  ];

  it.each(combos)('%s', (_label, sets) => {
    expect(rowBlind(sets)).toEqual(merge(sets));
  });
});

describe('[v19 #36055] the row-level bypass is untouched', () => {
  it('a View All set that hides a field of the object still holds View All on it', () => {
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'view' })).toEqual(['auditor_masked']);
    expect(evaluator.superuserBypassSets(OBJ, [VIEW_ALL_OWN_MASK], { bit: 'modify' })).toEqual([]);
  });
});

// ── [Field-axis split, ruling of record 6912661484, letter A] `viewAllFields` ──
//
// The read-only object-permission bit: a read vote on every field of the
// object, no edit vote, and a set's own `readable: false` row beats it. Both
// merges ask the one shared vote (`viewAllFieldsReadVote`), so each pin below
// is taken on both. Then the step-3 pin: the built-in admin sets read every
// field through the bit alone, so without it they would read none.

describe.each(MERGES)('[ruling 6912661484] viewAllFields is a read vote on every field, and only a read vote · %s', (_merge, read) => {
  it('it alone opens, read-only, every field another set hides', () => {
    for (const sets of [[VIEW_ALL_FIELDS, APP_MASK], [APP_MASK, VIEW_ALL_FIELDS], [WILDCARD_VIEW_ALL_FIELDS, APP_MASK]]) {
      const fp = read(sets);
      for (const f of MASKED) expect(fp[f], `${sets.map((s) => s.name).join('+')} ${f}`).toEqual({ readable: true, editable: false });
    }
  });

  it('it casts no edit vote: an explicit editable: false row elsewhere stays an edit lock', () => {
    const lock = set({
      name: 'app_read_only_rows',
      objects: { [OBJ]: { allowRead: true, allowEdit: true } },
      fields: Object.fromEntries(MASKED.map((f) => [`${OBJ}.${f}`, { readable: true, editable: false }])),
    });
    const fp = read([lock, set({ name: 'editor', objects: { [OBJ]: { allowRead: true, allowEdit: true, viewAllFields: true } } })]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });

  it('an explicit editable: true row still grants the edit beside it', () => {
    const rows = set({
      name: 'field_reader_editor',
      objects: { [OBJ]: { allowRead: true, allowEdit: true, viewAllFields: true } },
      fields: { [`${OBJ}.code`]: { readable: true, editable: true } },
    });
    const fp = read([rows, APP_MASK]);
    expect(fp.code).toEqual({ readable: true, editable: true });
    for (const f of MASKED.filter((m) => m !== 'code')) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });

  it('inside one set, the set\'s own readable: false row beats its own viewAllFields', () => {
    const fp = read([VIEW_ALL_FIELDS_OWN_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
    // …and it is the own row that binds, not a sibling's: another set's bit still reads the field.
    const both = read([VIEW_ALL_FIELDS_OWN_MASK, VIEW_ALL_FIELDS]);
    for (const f of MASKED) expect(both[f], f).toEqual({ readable: true, editable: false });
  });

  it('a set\'s explicit object entry is its whole answer: its wildcard bit does not reach an object it names', () => {
    const named = set({
      name: 'wildcard_reader_naming_obj',
      objects: { '*': { allowRead: true, viewAllFields: true }, [OBJ]: { allowRead: true } },
    });
    const fp = read([named, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: false, editable: false });
  });
});

describe('[ruling 6912661484] viewAllFields: the row-blind merge agrees with getFieldPermissions, and the bit is no record bypass', () => {
  const combos: Array<[string, PermissionSet[]]> = [
    ['viewAllFields + the app mask', [VIEW_ALL_FIELDS, APP_MASK]],
    ['wildcard viewAllFields + the app mask', [WILDCARD_VIEW_ALL_FIELDS, APP_MASK]],
    ['viewAllFields with its own mask', [VIEW_ALL_FIELDS_OWN_MASK]],
    ['viewAllFields with its own mask + viewAllFields', [VIEW_ALL_FIELDS_OWN_MASK, VIEW_ALL_FIELDS]],
    ['viewAllFields with its own mask + modifyAll', [VIEW_ALL_FIELDS_OWN_MASK, MODIFY_ALL]],
  ];
  it.each(combos)('%s', (_label, sets) => {
    expect(rowBlind(sets)).toEqual(merge(sets));
  });

  it('a set holding only viewAllFields holds neither row-level bypass', () => {
    for (const s of [VIEW_ALL_FIELDS, WILDCARD_VIEW_ALL_FIELDS]) {
      expect(evaluator.superuserBypassSets(OBJ, [s], { bit: 'view' }), s.name).toEqual([]);
      expect(evaluator.superuserBypassSets(OBJ, [s], { bit: 'modify' }), s.name).toEqual([]);
    }
  });
});

describe('[ruling 6912661484, step 3, #36055] the built-in admin sets read every field through viewAllFields alone', () => {
  const withoutBit = (s: PermissionSet): PermissionSet => {
    const objects = Object.fromEntries(
      Object.entries(s.objects ?? {}).map(([k, v]) => {
        const { viewAllFields: _f, ...rest } = v as Record<string, unknown>;
        return [k, rest];
      }),
    );
    return { ...s, objects } as PermissionSet;
  };
  const withBit = (s: PermissionSet): PermissionSet =>
    ({ ...s, objects: { ...(s.objects ?? {}), '*': { ...((s.objects ?? {})['*'] ?? {}), viewAllFields: true } } }) as PermissionSet;

  it('admin_full_access and organization_admin carry it on their wildcard; the wall-less variant does not', () => {
    expect((shipped(ADMIN_FULL_ACCESS).objects?.['*'] as Record<string, unknown>).viewAllFields).toBe(true);
    expect((shipped('organization_admin').objects?.['*'] as Record<string, unknown>).viewAllFields).toBe(true);
    expect('viewAllFields' in (shipped('organization_admin_no_bypass').objects?.['*'] as Record<string, unknown>)).toBe(false);
  });

  for (const name of ['organization_admin', ADMIN_FULL_ACCESS]) {
    for (const [mergeLabel, read] of MERGES) {
      it(`${name} + the app mask: read-only with the bit, hidden without it · ${mergeLabel}`, () => {
        const withIt = read([shipped(name), APP_MASK]);
        for (const f of MASKED) expect(withIt[f], f).toEqual({ readable: true, editable: false });
        const without = read([withoutBit(shipped(name)), APP_MASK]);
        for (const f of MASKED) expect(without[f], f).toEqual({ readable: false, editable: false });
      });
    }
  }

  it('control: the bit WOULD change the wall-less variant, which is why its derivation drops it', () => {
    const variant = shipped('organization_admin_no_bypass');
    expect(merge([withBit(variant), APP_MASK])).not.toEqual(merge([variant, APP_MASK]));
  });
});

describe('[ruling 6912661484] a wildcard viewAllFields is posture-blind: it votes on a private object\'s fields and grants no object · getFieldPermissions', () => {
  it('the wildcard does not cover the object when it is private, and its read vote on the fields stands', () => {
    // The object axis honours the posture: a plain `'*'` (no View All, no
    // Modify All) covers a public object and not a private one.
    expect(evaluator.checkObjectPermission('find', OBJ, [WILDCARD_VIEW_ALL_FIELDS], { isPrivate: false })).toBe(true);
    expect(evaluator.checkObjectPermission('find', OBJ, [WILDCARD_VIEW_ALL_FIELDS], { isPrivate: true })).toBe(false);
    // The field axis takes no posture: the bit votes on every field of the
    // object, so it re-opens what the set that DOES grant the object hides.
    // Control first: a plain wildcard leaves the fields hidden. The row-blind
    // merge is pinned beside it in core's `superuser-field-vote-33828.test.ts`.
    const plainWildcard = set({ name: 'wildcard_plain', objects: { '*': { allowRead: true } } });
    const hidden = merge([plainWildcard, APP_MASK]);
    for (const f of MASKED) expect(hidden[f], f).toEqual({ readable: false, editable: false });
    const fp = merge([WILDCARD_VIEW_ALL_FIELDS, APP_MASK]);
    for (const f of MASKED) expect(fp[f], f).toEqual({ readable: true, editable: false });
  });
});
