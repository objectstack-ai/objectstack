/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  buildExpandFields,
  isExpandableFieldType,
  EXPANDABLE_FIELD_TYPES,
} from '../expand-fields';

describe('buildExpandFields', () => {
  const sampleFields = {
    name: { type: 'text', label: 'Name' },
    email: { type: 'email', label: 'Email' },
    account: { type: 'lookup', label: 'Account', reference_to: 'accounts' },
    parent: { type: 'master_detail', label: 'Parent', reference_to: 'contacts' },
    status: { type: 'select', label: 'Status' },
  };

  it('should return lookup and master_detail field names', () => {
    const result = buildExpandFields(sampleFields);
    expect(result).toEqual(['account', 'parent']);
  });

  it('should return empty array when no lookup/master_detail fields exist', () => {
    const fields = {
      name: { type: 'text' },
      age: { type: 'number' },
    };
    expect(buildExpandFields(fields)).toEqual([]);
  });

  it('should return empty array for null/undefined schema', () => {
    expect(buildExpandFields(null)).toEqual([]);
    expect(buildExpandFields(undefined)).toEqual([]);
  });

  it('should return empty array for empty fields object', () => {
    expect(buildExpandFields({})).toEqual([]);
  });

  it('should filter by string columns when provided', () => {
    const result = buildExpandFields(sampleFields, ['name', 'account']);
    expect(result).toEqual(['account']);
  });

  it('should filter by ListColumn objects with field property', () => {
    const columns = [
      { field: 'name', label: 'Name' },
      { field: 'parent', label: 'Parent Contact' },
    ];
    const result = buildExpandFields(sampleFields, columns);
    expect(result).toEqual(['parent']);
  });

  it('should support columns with name property', () => {
    const columns = [
      { name: 'account', label: 'Account' },
    ];
    const result = buildExpandFields(sampleFields, columns);
    expect(result).toEqual(['account']);
  });

  it('should support columns with fieldName property', () => {
    const columns = [
      { fieldName: 'parent', label: 'Parent' },
    ];
    const result = buildExpandFields(sampleFields, columns);
    expect(result).toEqual(['parent']);
  });

  it('should return empty array when columns have no lookup fields', () => {
    const result = buildExpandFields(sampleFields, ['name', 'email']);
    expect(result).toEqual([]);
  });

  it('should handle mixed string and object columns', () => {
    const columns = [
      'name',
      { field: 'account' },
      'parent',
    ];
    const result = buildExpandFields(sampleFields, columns);
    expect(result).toEqual(['account', 'parent']);
  });

  it('should return all lookup fields when columns is empty array', () => {
    // Empty columns array does not satisfy the length > 0 check,
    // so no column restriction is applied → all lookup fields returned
    const result = buildExpandFields(sampleFields, []);
    expect(result).toEqual(['account', 'parent']);
  });

  it('should handle malformed field definitions gracefully', () => {
    const fields = {
      name: null,
      account: { type: 'lookup' },
      broken: 'not-an-object',
      empty: {},
    };
    const result = buildExpandFields(fields as any);
    expect(result).toEqual(['account']);
  });

  it('should handle only lookup fields', () => {
    const fields = {
      ref1: { type: 'lookup', reference_to: 'obj1' },
      ref2: { type: 'lookup', reference_to: 'obj2' },
    };
    expect(buildExpandFields(fields)).toEqual(['ref1', 'ref2']);
  });

  it('should handle only master_detail fields', () => {
    const fields = {
      detail1: { type: 'master_detail', reference_to: 'obj1' },
    };
    expect(buildExpandFields(fields)).toEqual(['detail1']);
  });

  // ── Reference-bearing types beyond lookup/master_detail ────────────────────
  // A list/grid that shows a `user` or `tree` relation column must still
  // request `$expand` for it, or the cell receives a bare id and renders "—".
  // This is the regression these cases lock in: previously only `lookup` /
  // `master_detail` were collected, so `user`/`tree` columns silently broke.
  const relationalZoo = {
    name: { type: 'text', label: 'Name' },
    f_lookup: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
    f_master_detail: { type: 'master_detail', label: 'Project', reference: 'showcase_project' },
    // No `reference`: a `tree` field's `reference` is OPTIONAL and, when
    // present, must name the DECLARING object — a hierarchy is parent/child
    // within one object (objectstack#14892, `refuseForeignTreeReference`).
    // This map declares no object, so there is no name to point at, and
    // `buildExpandFields` reads `type` and never the target anyway. It used
    // to carry a foreign one copied from the showcase zoo, which is exactly
    // how it went stale when upstream corrected the zoo (objectui#7839).
    f_tree: { type: 'tree', label: 'Category' },
    f_user: { type: 'user', label: 'Assignee', reference: 'sys_user' },
    status: { type: 'select', label: 'Status' },
    cover: { type: 'image', label: 'Cover' },
  };

  it('should include user and tree reference types (not just lookup/master_detail)', () => {
    expect(buildExpandFields(relationalZoo)).toEqual([
      'f_lookup',
      'f_master_detail',
      'f_tree',
      'f_user',
    ]);
  });

  it('should NOT include non-reference field types in $expand', () => {
    const result = buildExpandFields(relationalZoo);
    expect(result).not.toContain('name');
    expect(result).not.toContain('status');
    expect(result).not.toContain('cover');
  });

  it('should scope to ONLY the visible reference columns (the default behavior)', () => {
    // A grid showing [name, f_lookup, f_user, status] must expand exactly the
    // two visible reference columns — never the unshown f_master_detail / f_tree.
    const columns = ['name', 'f_lookup', 'f_user', 'status'];
    expect(buildExpandFields(relationalZoo, columns)).toEqual(['f_lookup', 'f_user']);
  });

  it('should produce an EMPTY set when no visible column is a reference (omit $expand)', () => {
    expect(buildExpandFields(relationalZoo, ['name', 'status', 'cover'])).toEqual([]);
  });

  it('should expand a lone user-type column once it is visible', () => {
    // The exact bug: a `user` column ("technician") shown in a list view.
    const fields = { title: { type: 'text' }, technician: { type: 'user', reference: 'sys_user' } };
    expect(buildExpandFields(fields, ['title'])).toEqual([]);
    expect(buildExpandFields(fields, ['title', 'technician'])).toEqual(['technician']);
  });
});

describe('EXPANDABLE_FIELD_TYPES / isExpandableFieldType', () => {
  it('covers exactly the reference-bearing types', () => {
    expect([...EXPANDABLE_FIELD_TYPES].sort()).toEqual(
      ['lookup', 'master_detail', 'tree', 'user'].sort(),
    );
  });

  it('treats reference field defs as expandable', () => {
    for (const type of ['lookup', 'master_detail', 'tree', 'user']) {
      expect(isExpandableFieldType({ type })).toBe(true);
    }
  });

  it('treats scalar/non-reference field defs as NOT expandable', () => {
    for (const type of ['text', 'number', 'select', 'image', 'formula', 'summary', 'date']) {
      expect(isExpandableFieldType({ type })).toBe(false);
    }
  });

  it('is null/shape safe', () => {
    expect(isExpandableFieldType(null)).toBe(false);
    expect(isExpandableFieldType(undefined)).toBe(false);
    expect(isExpandableFieldType('lookup')).toBe(false);
    expect(isExpandableFieldType({})).toBe(false);
  });
});
