/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';
import {
  AUDIT_FIELD_BY_ROLE,
  AUDIT_FIELD_NAMES,
  isSystemManagedField,
  SYSTEM_MANAGED_FIELD_NAMES,
} from '../index';

describe('isSystemManagedField', () => {
  it('treats fields flagged `system: true` as system-managed (the single source of truth)', () => {
    expect(isSystemManagedField('anything_custom', { system: true })).toBe(true);
    // Flag wins even for a name that is not in the canonical set — covers
    // future framework-injected fields without editing the name list.
    expect(isSystemManagedField('brand_new_injected_field', { system: true })).toBe(true);
  });

  it('classifies the injected owner_id as system-managed by flag AND by name', () => {
    expect(isSystemManagedField('owner_id', { system: true })).toBe(true); // stamped by registry
    expect(isSystemManagedField('owner_id', {})).toBe(true);               // name fallback (no flag)
    expect(isSystemManagedField('owner_id')).toBe(true);                   // name fallback (no field)
  });

  it('classifies audit / identity / tenancy columns by name when no flag is present', () => {
    for (const name of ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'organization_id']) {
      expect(isSystemManagedField(name, {})).toBe(true);
    }
  });

  it('does NOT classify author-declared business fields as system-managed', () => {
    expect(isSystemManagedField('name', {})).toBe(false);
    expect(isSystemManagedField('f_email', { system: false })).toBe(false);
    expect(isSystemManagedField('amount')).toBe(false);
  });

  it('exposes owner_id and the tenancy FKs in the canonical name set', () => {
    expect(SYSTEM_MANAGED_FIELD_NAMES.has('owner_id')).toBe(true);
    expect(SYSTEM_MANAGED_FIELD_NAMES.has('organization_id')).toBe(true);
    expect(SYSTEM_MANAGED_FIELD_NAMES.has('created_at')).toBe(true);
    expect(SYSTEM_MANAGED_FIELD_NAMES.has('name')).toBe(false);
  });
});

describe('AUDIT_FIELD_BY_ROLE / AUDIT_FIELD_NAMES (single audit vocabulary, objectui#3017)', () => {
  it('pins the four provenance columns — edits must be deliberate', () => {
    // A deliberate second statement: RecordMetaFooter renders exactly these,
    // RecordDetailView excludes exactly these from body sections, and the
    // framework injects them via `applySystemFields`. Changing the list is a
    // cross-surface decision, not a drive-by — re-pin after reviewing both
    // consumers (and the framework's registry, which owns the wire names).
    expect(AUDIT_FIELD_BY_ROLE).toEqual({
      createdAt: 'created_at',
      createdBy: 'created_by',
      updatedAt: 'updated_at',
      updatedBy: 'updated_by',
    });
    expect([...AUDIT_FIELD_NAMES].sort()).toEqual(
      Object.values(AUDIT_FIELD_BY_ROLE).sort(),
    );
  });

  it('stays within the display-oriented system-managed superset', () => {
    for (const name of AUDIT_FIELD_NAMES) {
      expect(SYSTEM_MANAGED_FIELD_NAMES.has(name), `${name} missing from SYSTEM_MANAGED_FIELD_NAMES`).toBe(true);
    }
  });

  it('stays within the spec-published system-field vocabulary (cross-repo tripwire)', () => {
    // FIELD_GROUP_SYSTEM_FIELDS is the spec's own list of the columns the
    // framework injects. If the framework renames an audit column (say
    // created_at → createdAt), the spec set moves and this fails — turning a
    // silent cross-repo drift into a red test.
    for (const name of AUDIT_FIELD_NAMES) {
      expect(FIELD_GROUP_SYSTEM_FIELDS.has(name), `spec no longer lists '${name}' as a system field`).toBe(true);
    }
  });
});
