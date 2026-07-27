// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D7] Collision guard for extension fields on better-auth-managed
 * objects.
 *
 * Extending a better-auth table is established practice (`sys_user.manager_id`,
 * `sys_organization.require_mfa`, and now the D6 group-structure fields). The
 * hazard is a NAME COLLISION: if a better-auth upgrade introduces a field with
 * the same name, ownership of that column silently changes hands — our writes
 * start clobbering better-auth state, or better-auth's start clobbering ours,
 * with no error anywhere and no test failing.
 *
 * So the guard derives better-auth's REAL field surface from `getAuthTables()`
 * at the pinned version, rather than trusting a hand-maintained list, and fails
 * on any overlap. The upgrade that would cause the collision is the moment
 * someone finds out.
 */

import { describe, it, expect } from 'vitest';
import { getAuthTables } from 'better-auth/db';
import { organization } from 'better-auth/plugins';

import {
  MANAGED_EXTENSION_FIELDS,
  MANAGED_EXTENSION_EDITABLE_FIELDS,
  managedExtensionFields,
  managedExtensionEditableFields,
} from './managed-extension-fields.js';

/** better-auth model name → the ObjectStack object it materializes as. */
const MODEL_TO_OBJECT: Record<string, string> = {
  user: 'sys_user',
  session: 'sys_session',
  account: 'sys_account',
  verification: 'sys_verification',
  organization: 'sys_organization',
  member: 'sys_member',
  invitation: 'sys_invitation',
  team: 'sys_team',
  teamMember: 'sys_team_member',
};

/** better-auth authors fields in camelCase; ObjectStack columns are snake_case. */
function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Every field better-auth owns, per ObjectStack object name, in BOTH spellings
 * — comparing only one would let `parentOrganizationId` slip past a check on
 * `parent_organization_id`.
 */
function betterAuthFieldsByObject(): Record<string, Set<string>> {
  // `teams: { enabled: true }` mirrors the auth-manager default. Without it
  // better-auth omits the team models entirely, so the sys_team /
  // sys_team_member entries below would be absent and any extension field
  // added to those objects would collide silently. (#3624)
  const tables = getAuthTables({
    plugins: [organization({ teams: { enabled: true } })],
  } as never);
  const out: Record<string, Set<string>> = {};
  for (const [model, table] of Object.entries(tables ?? {})) {
    const object = MODEL_TO_OBJECT[model];
    if (!object) continue;
    const names = new Set<string>();
    for (const field of Object.keys((table as { fields?: object }).fields ?? {})) {
      names.add(field);
      names.add(toSnakeCase(field));
    }
    // better-auth always owns the primary key, whatever the table.
    names.add('id');
    out[object] = names;
  }
  return out;
}

describe('managed extension fields (ADR-0105 D7)', () => {
  const byObject = betterAuthFieldsByObject();

  it('derives a non-empty better-auth surface (the guard must not pass vacuously)', () => {
    expect(Object.keys(byObject).length).toBeGreaterThan(0);
    expect(byObject.sys_organization?.size ?? 0).toBeGreaterThan(0);
    expect(byObject.sys_user?.size ?? 0).toBeGreaterThan(0);
  });

  it('no declared extension field collides with better-auth\'s own schema', () => {
    const collisions: string[] = [];
    for (const [object, fields] of Object.entries(MANAGED_EXTENSION_FIELDS)) {
      const owned = byObject[object];
      if (!owned) continue;
      for (const field of fields) {
        if (owned.has(field)) collisions.push(`${object}.${field}`);
      }
    }
    expect(
      collisions,
      `these extension fields collide with better-auth's own schema at the pinned version: ` +
        `${collisions.join(', ')} — better-auth now owns those columns, so ObjectStack must rename ` +
        `its field (and migrate) or drop the extension. Silently sharing a column means one side ` +
        `clobbers the other with no error.`,
    ).toEqual([]);
  });

  it('editable extension fields are a SUBSET of declared extension fields', () => {
    // Listing a field as ours must not be what makes it editable — the two
    // tiers are separate decisions (ADR-0092 D1).
    for (const [object, editable] of Object.entries(MANAGED_EXTENSION_EDITABLE_FIELDS)) {
      const declared = managedExtensionFields(object);
      for (const field of editable) {
        expect(declared.has(field), `${object}.${field} is editable but not declared`).toBe(true);
      }
    }
  });

  it('the ADR-0105 D6 group-structure fields are declared and editable', () => {
    expect(managedExtensionFields('sys_organization')).toContain('parent_organization_id');
    expect(managedExtensionEditableFields('sys_organization')).toContain('parent_organization_id');
    expect(managedExtensionEditableFields('sys_organization')).toContain('sort_order');
  });

  it('admin-surface-only sys_user fields are declared but NOT generically editable', () => {
    // `manager_id` / `ai_access` drive authorization and AI seating;
    // `primary_business_unit_id` is a projection plugin-sharing maintains.
    for (const field of ['manager_id', 'ai_access', 'primary_business_unit_id']) {
      expect(managedExtensionFields('sys_user')).toContain(field);
      expect(managedExtensionEditableFields('sys_user')).not.toContain(field);
    }
  });

  it('returns empty sets for an object with no extensions', () => {
    expect(managedExtensionFields('sys_session').size).toBe(0);
    expect(managedExtensionEditableFields('sys_session').size).toBe(0);
  });
});
