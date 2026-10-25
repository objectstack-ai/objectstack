// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0086 P0 — the Access matrix, when opened inside a package, must edit only
 * that package's slice and, on Save, leave every other package's contributed
 * rows byte-for-byte intact. These pin both halves of the contract:
 *   • scoping (what the panel shows), and
 *   • slice-merge (what Save writes back).
 */

import { describe, expect, it } from 'vitest';
import {
  fieldKeyObject,
  mergePermissionSlice,
  scopePermissionSet,
  type PermissionSetDraft,
} from './permission-slice';

// A permission set two packages have contributed to. Package A owns
// `a_account` / `a_contact`; package B owns `b_order`.
const full: PermissionSetDraft = {
  name: 'sales_perms',
  label: 'Sales permissions',
  isProfile: false,
  systemPermissions: ['api_enabled'],
  tabPermissions: { a_account: 'visible', b_order: 'default_on' },
  objects: {
    a_account: { allowRead: true, allowCreate: true },
    a_contact: { allowRead: true },
    b_order: { allowRead: true, allowEdit: true, viewAllRecords: true },
  },
  fields: {
    'a_account.name': { readable: true, editable: true },
    'a_contact.email': { readable: true, editable: false },
    'b_order.total': { readable: true, editable: true },
  },
};

const SCOPE_A = ['a_account', 'a_contact'];

describe('fieldKeyObject', () => {
  it('extracts the object name up to the first dot', () => {
    expect(fieldKeyObject('a_account.name')).toBe('a_account');
    expect(fieldKeyObject('lonely')).toBe('lonely');
  });
});

describe('scopePermissionSet — panel shows only the package slice', () => {
  it('keeps only in-scope object + field rows (no environment leak)', () => {
    const sliced = scopePermissionSet(full, SCOPE_A);
    expect(Object.keys(sliced.objects).sort()).toEqual(['a_account', 'a_contact']);
    expect(Object.keys(sliced.fields).sort()).toEqual([
      'a_account.name',
      'a_contact.email',
    ]);
    // Package B's rows are absent from the panel.
    expect(sliced.objects.b_order).toBeUndefined();
    expect(sliced.fields['b_order.total']).toBeUndefined();
  });

  it('tolerates a missing fields map', () => {
    const sliced = scopePermissionSet({ objects: { a_account: {} } }, SCOPE_A);
    expect(sliced.fields).toEqual({});
  });
});

describe('mergePermissionSlice — Save preserves other packages byte-for-byte', () => {
  it("re-grants package A while package B's rows stay identical", () => {
    // Panel loaded package A's slice, user edited it (grant edit on a_account,
    // drop a_contact entirely).
    const edited: PermissionSetDraft = {
      ...scopePermissionSet(full, SCOPE_A),
      name: full.name,
      label: full.label,
      isProfile: full.isProfile,
    };
    edited.objects.a_account = { allowRead: true, allowCreate: true, allowEdit: true };
    delete edited.objects.a_contact;
    delete edited.fields!['a_contact.email'];

    const merged = mergePermissionSlice(full, edited, SCOPE_A);

    // Package B's object + field rows are the SAME reference (untouched).
    expect(merged.objects.b_order).toBe(full.objects.b_order);
    expect(merged.fields!['b_order.total']).toBe(full.fields!['b_order.total']);

    // Package A's edits landed.
    expect(merged.objects.a_account.allowEdit).toBe(true);
    expect(merged.objects.a_contact).toBeUndefined(); // removed grant gone
    expect(merged.fields!['a_contact.email']).toBeUndefined();

    // Set-level extras this `edited` does not carry AT ALL survive from base.
    // (objectui#4302: a facet the edited draft DOES carry now comes from the
    // edited draft — pinned in permission-slice.facetDrift.test.ts. This case
    // pins the other half: absence means "not modelled", never "cleared".)
    expect(merged.systemPermissions).toEqual(['api_enabled']);
    expect(merged.tabPermissions).toEqual(full.tabPermissions);
  });

  it("editing package B does not disturb package A's slice", () => {
    const scopeB = ['b_order'];
    const editedB: PermissionSetDraft = {
      ...scopePermissionSet(full, scopeB),
      name: full.name,
    };
    editedB.objects.b_order = { allowRead: true }; // narrow B's grant

    const merged = mergePermissionSlice(full, editedB, scopeB);

    expect(merged.objects.a_account).toBe(full.objects.a_account);
    expect(merged.objects.a_contact).toBe(full.objects.a_contact);
    expect(merged.fields!['a_account.name']).toBe(full.fields!['a_account.name']);
    expect(merged.objects.b_order).toEqual({ allowRead: true });
  });

  it('a fresh base (no other packages yet) round-trips the edited slice', () => {
    const base: PermissionSetDraft = { name: 'sales_perms', objects: {}, fields: {} };
    const edited: PermissionSetDraft = {
      name: 'sales_perms',
      objects: { a_account: { allowRead: true } },
      fields: { 'a_account.name': { readable: true } },
    };
    const merged = mergePermissionSlice(base, edited, SCOPE_A);
    expect(merged.objects).toEqual({ a_account: { allowRead: true } });
    expect(merged.fields).toEqual({ 'a_account.name': { readable: true } });
  });
});
