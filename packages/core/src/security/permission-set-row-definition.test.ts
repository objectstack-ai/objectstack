// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D10] The pin of `permissionSetDefinitionFromRow` — the mapping
 * the upgrade ceremony applies to turn a Setup-authored `sys_permission_set`
 * row into the definition it saves through the metadata door.
 *
 * The expected bodies are the outputs the module doc states, written out by
 * hand: this package cannot import the security plugin's copy, so the
 * byte-for-behaviour comparison with it was a one-time measurement, recorded on
 * the pull request that added this file.
 */

import { describe, expect, it } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { permissionSetDefinitionFromRow } from './permission-set-row-definition.js';

/** A row as `sys_permission_set` stores it: the facets are JSON text, and the state columns ride along. */
const storedRow = {
  id: 'ps_01',
  name: 'sales_ops',
  label: 'Sales Operations',
  description: 'Edits accounts and reads opportunities',
  object_permissions: JSON.stringify({ account: { allowRead: true, allowEdit: true }, opportunity: { allowRead: true } }),
  field_permissions: JSON.stringify({ 'account.annual_revenue': { readable: true, editable: false } }),
  system_permissions: JSON.stringify(['export_reports']),
  row_level_security: JSON.stringify([]),
  tab_permissions: JSON.stringify({ accounts: 'visible' }),
  admin_scope: JSON.stringify({ businessUnit: 'emea' }),
  active: false,
  managed_by: 'admin',
  customized: true,
  package_id: null,
  organization_id: 'org_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

/** Every body key the mapping can emit, in the order it emits them. */
const EVERY_BODY_KEY = [
  'name', 'label', 'description', 'objects', 'fields',
  'systemPermissions', 'rowLevelSecurity', 'tabPermissions', 'adminScope',
];

describe('permissionSetDefinitionFromRow', () => {
  it('turns the snake_case JSON facet columns into the camelCase body, key for key and in order', () => {
    const body = permissionSetDefinitionFromRow(storedRow);
    expect(body).toStrictEqual({
      name: 'sales_ops',
      label: 'Sales Operations',
      description: 'Edits accounts and reads opportunities',
      objects: { account: { allowRead: true, allowEdit: true }, opportunity: { allowRead: true } },
      fields: { 'account.annual_revenue': { readable: true, editable: false } },
      systemPermissions: ['export_reports'],
      rowLevelSecurity: [],
      tabPermissions: { accounts: 'visible' },
      adminScope: { businessUnit: 'emea' },
    });
    expect(Object.keys(body)).toEqual(EVERY_BODY_KEY);
  });

  it('every key it emits is one PermissionSetSchema declares, and none is filtered away (a spec rename reddens this)', () => {
    const declared = Object.keys((PermissionSetSchema as unknown as { shape: Record<string, unknown> }).shape);
    for (const key of EVERY_BODY_KEY) expect(declared, key).toContain(key);
    expect(Object.keys(permissionSetDefinitionFromRow(storedRow))).toHaveLength(EVERY_BODY_KEY.length);
  });

  it('a well-formed row answers a body the permission-set schema accepts', () => {
    const parsed = PermissionSetSchema.safeParse(permissionSetDefinitionFromRow(storedRow));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('never carries a row state, provenance or identity column', () => {
    const body = permissionSetDefinitionFromRow(storedRow);
    for (const column of ['id', 'active', 'managed_by', 'customized', 'package_id', 'organization_id', 'created_at', 'updated_at']) {
      expect(body, column).not.toHaveProperty(column);
    }
  });

  it('takes a facet a driver already parsed as it is', () => {
    const body = permissionSetDefinitionFromRow({
      name: 'parsed',
      object_permissions: { account: { allowRead: true } },
      system_permissions: ['manage_users'],
      admin_scope: { businessUnit: 'apac' },
    });
    expect(body.objects).toEqual({ account: { allowRead: true } });
    expect(body.systemPermissions).toEqual(['manage_users']);
    expect(body.adminScope).toEqual({ businessUnit: 'apac' });
  });

  it('an absent, null, empty, JSON-null or unparseable facet answers its default', () => {
    for (const stored of [undefined, null, '', 'null', '{not json']) {
      const body = permissionSetDefinitionFromRow({
        name: 'defaults',
        object_permissions: stored,
        field_permissions: stored,
        system_permissions: stored,
        row_level_security: stored,
        tab_permissions: stored,
      });
      expect(body, String(stored)).toStrictEqual({
        name: 'defaults',
        label: 'defaults',
        objects: {},
        fields: {},
        systemPermissions: [],
        rowLevelSecurity: [],
        tabPermissions: {},
      });
    }
  });

  it('answers a fresh default per call, never one shared object', () => {
    const first = permissionSetDefinitionFromRow({ name: 'a' });
    const second = permissionSetDefinitionFromRow({ name: 'b' });
    expect(first.objects).not.toBe(second.objects);
    expect(first.systemPermissions).not.toBe(second.systemPermissions);
  });

  it('the label falls back to the name only when the column is null or absent', () => {
    expect(permissionSetDefinitionFromRow({ name: 'n', label: null }).label).toBe('n');
    expect(permissionSetDefinitionFromRow({ name: 'n' }).label).toBe('n');
    expect(permissionSetDefinitionFromRow({ name: 'n', label: '' }).label).toBe('');
  });

  it('the description travels unless the column is null or absent', () => {
    expect(permissionSetDefinitionFromRow({ name: 'n', description: null })).not.toHaveProperty('description');
    expect(permissionSetDefinitionFromRow({ name: 'n' })).not.toHaveProperty('description');
    expect(permissionSetDefinitionFromRow({ name: 'n', description: '' }).description).toBe('');
  });

  it('the admin scope travels only when the column is set and reads to a value', () => {
    for (const stored of [undefined, null, '', 'null', 'false', '0', '{not json']) {
      expect(permissionSetDefinitionFromRow({ name: 'n', admin_scope: stored }), String(stored)).not.toHaveProperty('adminScope');
    }
    expect(permissionSetDefinitionFromRow({ name: 'n', admin_scope: '{"businessUnit":"emea"}' }).adminScope).toEqual({ businessUnit: 'emea' });
  });

  // [#23488] The ceremony saves through `saveMetaItem`, which replays no
  // conversion and validates against the current schema; spec 18 tombstones
  // `manageBindings` / `authorEnvironmentSets`, so a body still carrying either
  // is refused there (`422 INVALID_METADATA`, measured on the PR). A 17.x
  // projection carries both as the materialized default `false`.
  it('drops the two retired scope keys whatever they hold, so the body is one the door accepts', () => {
    for (const retired of [
      { manageBindings: false, authorEnvironmentSets: false },
      { manageBindings: true, authorEnvironmentSets: true },
      { manageBindings: 'yes' },
    ]) {
      const scope = { businessUnit: 'emea', includeSubtree: true, manageAssignments: true, assignablePermissionSets: ['sales_ops'] };
      const body = permissionSetDefinitionFromRow({ name: 'emea_admin', admin_scope: JSON.stringify({ ...scope, ...retired }) });
      // Every live key survives byte-for-byte; only the retired ones go.
      expect(body.adminScope, JSON.stringify(retired)).toStrictEqual(scope);
      expect(PermissionSetSchema.safeParse(body).success, JSON.stringify(retired)).toBe(true);
    }
    // CONTROL: the identical scope with the keys left in is refused by the
    // door's schema at the retired key — so the drop above is what makes the
    // body acceptable, not something else in it.
    const kept = { ...permissionSetDefinitionFromRow({ name: 'emea_admin' }), adminScope: { businessUnit: 'emea', manageBindings: false } };
    const refused = PermissionSetSchema.safeParse(kept);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path)).toEqual([['adminScope', 'manageBindings']]);
    // A scope with neither key is handed on as read, and a driver-parsed one too.
    expect(permissionSetDefinitionFromRow({ name: 'n', admin_scope: { businessUnit: 'emea' } }).adminScope).toEqual({ businessUnit: 'emea' });
  });

  it('a null or absent row answers the body of a row with every column absent', () => {
    const empty = {
      name: undefined,
      label: undefined,
      objects: {},
      fields: {},
      systemPermissions: [],
      rowLevelSecurity: [],
      tabPermissions: {},
    };
    expect(permissionSetDefinitionFromRow(null)).toStrictEqual(empty);
    expect(permissionSetDefinitionFromRow(undefined)).toStrictEqual(empty);
  });

  it('is pure: the row is read, never written, and the same row answers the same body', () => {
    const row = Object.freeze({ ...storedRow });
    const first = permissionSetDefinitionFromRow(row);
    expect(permissionSetDefinitionFromRow(row)).toStrictEqual(first);
    expect(row).toStrictEqual(storedRow);
  });
});
