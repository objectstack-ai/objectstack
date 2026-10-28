// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27010 — what an object row of the permission matrix draws, and
 * what an edit of it starts from (`objectRuleCell` / `objectRuleSeed` in
 * `permission-slice.ts`).
 *
 * The runtime resolves one entry per (set, object) — the object's own entry,
 * else the set's `'*'` entry where it applies to the object — and never merges
 * two (`resolveObjectPermission`, `@objectstack/plugin-security`). The rows
 * below are the same table plugin-security's `object-grant-wildcard.test.ts`
 * measures through a real `ObjectQL` and the real `SecurityPlugin`: change the
 * two together.
 */

import { describe, expect, it } from 'vitest';
import { objectPermissionGrants } from '@objectstack/spec/security';
import {
  mergePermissionSlice,
  objectRowGrantsAny,
  objectRuleCell,
  objectRuleSeed,
  scopePermissionSet,
  type ObjectPerm,
  type PermissionSetDraft,
} from './permission-slice';

const CRUD: ObjectPerm = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const SUPER: ObjectPerm = { ...CRUD, viewAllRecords: true, modifyAllRecords: true };

/** The sets of the table, by the shape of their `objects` map. */
const SETS: Record<string, Record<string, ObjectPerm>> = {
  wildcard: { '*': CRUD },
  superWildcard: { '*': SUPER },
  wildcardAndReadOnlyEntry: { '*': CRUD, a_project: { allowRead: true } },
  wildcardAndEmptyEntry: { '*': CRUD, a_project: {} },
  noWildcard: { other_object: CRUD },
};

type Posture = 'public' | 'private';

/**
 * May a holder of this set ALONE read / edit a record of the object? The
 * runtime's answer (plugin-security `object-grant-wildcard.test.ts`, the
 * `VERDICT` table there), with where the row's entry comes from.
 */
const RUNTIME: Record<string, Record<Posture, { source: 'entry' | 'wildcard' | 'none'; read: boolean; edit: boolean }>> = {
  wildcard: {
    public: { source: 'wildcard', read: true, edit: true },
    private: { source: 'none', read: false, edit: false },
  },
  superWildcard: {
    public: { source: 'wildcard', read: true, edit: true },
    private: { source: 'wildcard', read: true, edit: true },
  },
  wildcardAndReadOnlyEntry: {
    public: { source: 'entry', read: true, edit: false },
    private: { source: 'entry', read: true, edit: false },
  },
  wildcardAndEmptyEntry: {
    public: { source: 'entry', read: false, edit: false },
    private: { source: 'entry', read: false, edit: false },
  },
  noWildcard: {
    public: { source: 'none', read: false, edit: false },
    private: { source: 'none', read: false, edit: false },
  },
};

describe('objectRuleCell — an object row draws the entry the runtime applies (objectstack#27010)', () => {
  for (const [setName, objects] of Object.entries(SETS)) {
    for (const posture of ['public', 'private'] as const) {
      const want = RUNTIME[setName][posture];
      it(`${setName} × ${posture} object: ${want.source}, read ${want.read}, edit ${want.edit}`, () => {
        const cell = objectRuleCell(objects, 'a_project', posture);
        expect(cell.source).toBe(want.source);
        expect(cell.inherited).toBe(want.source === 'wildcard');
        expect(objectPermissionGrants({ ...cell.perm }, 'allowRead')).toBe(want.read);
        expect(objectPermissionGrants({ ...cell.perm }, 'allowEdit')).toBe(want.edit);
      });
    }
  }

  it('an object with no catalog posture reads as not private, as the runtime reads one without access.default', () => {
    expect(objectRuleCell(SETS.wildcard, 'a_project', undefined)).toEqual({
      source: 'wildcard',
      inherited: true,
      perm: CRUD,
    });
  });

  it('a row that draws the `*` entry draws its every key, scopes and Export included', () => {
    const wildcard: ObjectPerm = { allowRead: true, allowExport: true, readScope: 'own', writeScope: 'own' };
    expect(objectRuleCell({ '*': wildcard }, 'a_project', 'public').perm).toEqual(wildcard);
  });

  it('a row granting nothing counts as not granted; an inherited grant counts', () => {
    expect(objectRowGrantsAny(objectRuleCell(SETS.wildcard, 'a_project', 'private').perm)).toBe(false);
    expect(objectRowGrantsAny(objectRuleCell(SETS.wildcard, 'a_project', 'public').perm)).toBe(true);
    expect(objectRowGrantsAny(objectRuleCell(SETS.wildcardAndEmptyEntry, 'a_project', 'public').perm)).toBe(false);
  });
});

describe('objectRuleSeed — an edit starts from the drawn entry (objectstack#27010)', () => {
  it('on an inherited row: a fresh copy of the `*` entry', () => {
    const objects = { '*': SUPER };
    const seed = objectRuleSeed(objects, 'a_project', 'private');
    expect(seed).toEqual(SUPER);
    seed.allowEdit = false;
    expect(objects['*'].allowEdit).toBe(true);
  });

  it('on a row with its own entry: that entry; on a row nothing applies to: empty', () => {
    expect(objectRuleSeed(SETS.wildcardAndReadOnlyEntry, 'a_project', 'public')).toEqual({ allowRead: true });
    expect(objectRuleSeed(SETS.wildcard, 'a_project', 'private')).toEqual({});
  });
});

describe('the package slice carries the `*` entry for display and never writes it (objectstack#27010)', () => {
  const full: PermissionSetDraft = {
    name: 'sales_perms',
    objects: { '*': CRUD, a_account: { allowRead: true }, b_order: { allowRead: true } },
    fields: {},
  };

  it('scopePermissionSet keeps `*` beside the in-scope rows', () => {
    expect(Object.keys(scopePermissionSet(full, ['a_account']).objects).sort()).toEqual(['*', 'a_account']);
  });

  it('mergePermissionSlice takes `*` from the fresh base, whatever the edited slice holds', () => {
    const edited: PermissionSetDraft = {
      name: full.name,
      ...scopePermissionSet(full, ['a_account']),
    };
    edited.objects['*'] = { allowRead: true };
    edited.objects.a_account = { allowRead: true, allowEdit: true };
    const merged = mergePermissionSlice(full, edited, ['a_account']);
    expect(merged.objects['*']).toBe(full.objects['*']);
    expect(merged.objects.a_account).toEqual({ allowRead: true, allowEdit: true });
    expect(merged.objects.b_order).toBe(full.objects.b_order);
  });
});
