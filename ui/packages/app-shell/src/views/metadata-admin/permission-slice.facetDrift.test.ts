// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4302 — the package door must persist EVERY facet the editor can
 * author, not just the five keys the slice used to name.
 *
 * `mergePermissionSlice` rebuilds the record from a freshly-read `base` so other
 * packages' object/field rows survive byte-for-byte (ADR-0086 P0). It used to
 * return `{...base, name, label, isDefault, objects, fields}` — a whitelist that
 * had drifted behind the editor: `rowLevelSecurity`, `tabPermissions`,
 * `adminScope` and `systemPermissions` were taken from `base` even when the
 * author had just edited them, so a row-level-security policy authored in Studio
 * was silently reverted while Save reported success.
 *
 * The direction that matters for these pins is the one the defect needs:
 * `edited` and `base` must DISAGREE. A fixture where both carry the same facet
 * value cannot see the bug at all — that is exactly why it survived the original
 * P0 suite, whose `edited` fixtures carry no advanced facets.
 */

import { describe, expect, it } from 'vitest';
import { mergePermissionSlice, type PermissionSetDraft } from './permission-slice';

const SCOPE_A = ['a_account', 'a_contact'];

/** The record as the server holds it at Save time (the fresh `layered` read). */
function baseRecord(): PermissionSetDraft {
  return {
    name: 'sales_perms',
    label: 'Sales permissions',
    systemPermissions: ['api_enabled'],
    tabPermissions: { a_account: 'visible', b_order: 'default_on' },
    rowLevelSecurity: [
      { name: 'stored_policy', object: 'a_account', operation: 'all', using: 'true', enabled: true },
    ],
    adminScope: { businessUnit: 'stored_bu', includeSubtree: false },
    objects: {
      a_account: { allowRead: true },
      b_order: { allowRead: true, allowEdit: true },
    },
    fields: { 'b_order.total': { readable: true, editable: true } },
  };
}

/**
 * What the editor holds after the author edited the panel: the in-scope slice
 * plus EVERY advanced facet, because the load path narrows `objects`/`fields`
 * only (`resetDraftBaseline({...full, objects: sliced, fields: sliced})`) and
 * hands the rest of the record to the facet editors unscoped.
 */
function editedDraft(): PermissionSetDraft {
  return {
    name: 'sales_perms',
    label: 'Sales permissions',
    systemPermissions: ['api_enabled', 'bulk_api'],
    tabPermissions: { a_account: 'hidden', b_order: 'default_on' },
    rowLevelSecurity: [
      { name: 'stored_policy', object: 'a_account', operation: 'all', using: 'true', enabled: true },
      {
        name: 'qa_st2_rls',
        object: 'a_account',
        operation: 'all',
        using: 'organization_id == current_user.organization_id',
        enabled: true,
      },
    ],
    adminScope: { businessUnit: 'authored_bu', includeSubtree: true },
    objects: { a_account: { allowRead: true, allowEdit: true } },
    fields: {},
  };
}

describe('mergePermissionSlice — the package door carries every authored facet (objectui#4302)', () => {
  it('persists an RLS policy authored in the editor instead of reverting to the stored list', () => {
    const merged = mergePermissionSlice(baseRecord(), editedDraft(), SCOPE_A);

    const policies = merged.rowLevelSecurity as Array<Record<string, unknown>>;
    expect(policies).toHaveLength(2);
    expect(policies.map((p) => p.name)).toEqual(['stored_policy', 'qa_st2_rls']);
    expect(policies[1]).toEqual({
      name: 'qa_st2_rls',
      object: 'a_account',
      operation: 'all',
      using: 'organization_id == current_user.organization_id',
      enabled: true,
    });
  });

  it('persists authored tab visibility', () => {
    const merged = mergePermissionSlice(baseRecord(), editedDraft(), SCOPE_A);
    expect(merged.tabPermissions).toEqual({ a_account: 'hidden', b_order: 'default_on' });
  });

  it('persists an authored delegated-admin scope', () => {
    const merged = mergePermissionSlice(baseRecord(), editedDraft(), SCOPE_A);
    expect(merged.adminScope).toEqual({ businessUnit: 'authored_bu', includeSubtree: true });
  });

  it('persists authored system permissions (capability picker)', () => {
    const merged = mergePermissionSlice(baseRecord(), editedDraft(), SCOPE_A);
    expect(merged.systemPermissions).toEqual(['api_enabled', 'bulk_api']);
  });

  it('persists the REMOVAL of a facet — an emptied policy list does not resurrect from base', () => {
    // Deleting the last policy leaves `[]` in the draft (the facet editor always
    // writes a value), so an empty array is an authored value, not an absence.
    const edited = { ...editedDraft(), rowLevelSecurity: [], tabPermissions: {} };
    const merged = mergePermissionSlice(baseRecord(), edited, SCOPE_A);
    expect(merged.rowLevelSecurity).toEqual([]);
    expect(merged.tabPermissions).toEqual({});
  });

  it('leaves a facet the edited body does not carry at all to `base`', () => {
    // A caller that never modelled the facet (a partial `edited`) must not be
    // able to erase it — absence is "not authored", not "cleared". This is the
    // contract the original ADR-0086 P0 suite pins, kept unchanged.
    const edited: PermissionSetDraft = {
      name: 'sales_perms',
      objects: { a_account: { allowRead: true } },
      fields: {},
    };
    const merged = mergePermissionSlice(baseRecord(), edited, SCOPE_A);
    expect(merged.rowLevelSecurity).toEqual(baseRecord().rowLevelSecurity);
    expect(merged.tabPermissions).toEqual(baseRecord().tabPermissions);
    expect(merged.adminScope).toEqual(baseRecord().adminScope);
    expect(merged.systemPermissions).toEqual(['api_enabled']);
    expect(merged.label).toBe('Sales permissions');
  });

  it('still preserves another package\'s rows byte-for-byte (ADR-0086 P0)', () => {
    const base = baseRecord();
    const merged = mergePermissionSlice(base, editedDraft(), SCOPE_A);
    expect(merged.objects.b_order).toBe(base.objects.b_order);
    expect(merged.fields!['b_order.total']).toBe(base.fields!['b_order.total']);
    expect(merged.objects.a_account).toEqual({ allowRead: true, allowEdit: true });
  });
});
