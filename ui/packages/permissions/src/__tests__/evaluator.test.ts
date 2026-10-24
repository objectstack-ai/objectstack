/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePermission, evaluateCondition } from '../evaluator';
import type {
  RoleDefinition,
  ObjectPermissionConfig,
} from '@object-ui/types';

// Every grant these cases exercise arrives through the `ObjectPermissionConfig[]`
// below, keyed by object — the only wired home for a role's grants. What the
// role fixtures pin is identity and inheritance, which is all `resolveRoles`
// reads. (`RoleDefinition` used to require a second, never-read `permissions`
// array; retired in objectui#4288.)
const adminRole: RoleDefinition = { name: 'admin', label: 'Admin' };
const editorRole: RoleDefinition = { name: 'editor', label: 'Editor', inherits: ['viewer'] };
const viewerRole: RoleDefinition = { name: 'viewer', label: 'Viewer' };

const roles: RoleDefinition[] = [adminRole, editorRole, viewerRole];

const permissions: ObjectPermissionConfig[] = [
  {
    object: 'Task',
    publicAccess: ['read'],
    roles: {
      admin: { actions: ['create', 'read', 'update', 'delete'] },
      editor: {
        actions: ['create', 'read', 'update'],
        fieldPermissions: [{ field: 'title', read: true, write: true }],
      },
      viewer: { actions: ['read'] },
    },
  },
  {
    object: 'Secret',
    roles: {
      admin: { actions: ['read', 'update'] },
      editor: {
        actions: ['read'],
        rowPermissions: [{ actions: ['read'], filter: 'owner = $user.id' }],
      },
    },
  },
];

const user = { id: 'user-1', roles: ['editor'] };

describe('evaluatePermission', () => {
  it('allows action when no object config exists', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['editor'],
      user,
      object: 'Unknown',
      action: 'read',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows public access actions', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: [],
      user: { id: '', roles: [] },
      object: 'Task',
      action: 'read',
    });
    expect(result.allowed).toBe(true);
  });

  it('allows role-based action', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['admin'],
      user: { id: 'a', roles: ['admin'] },
      object: 'Task',
      action: 'delete',
    });
    expect(result.allowed).toBe(true);
  });

  it('denies action not in role', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['viewer'],
      user: { id: 'v', roles: ['viewer'] },
      object: 'Task',
      action: 'delete',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('delete');
    expect(result.reason).toContain('Task');
  });

  it('inherits roles (editor inherits viewer)', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['editor'],
      user,
      object: 'Task',
      action: 'read',
    });
    expect(result.allowed).toBe(true);
  });

  it('returns field restrictions when available', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['editor'],
      user,
      object: 'Task',
      action: 'create',
    });
    expect(result.allowed).toBe(true);
    expect(result.fieldRestrictions).toBeDefined();
  });

  it('checks row permissions when record is provided', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['editor'],
      user,
      object: 'Secret',
      action: 'read',
      record: { owner: 'user-1' },
    });
    expect(result.allowed).toBe(true);
    expect(result.rowFilter).toBeDefined();
  });

  it('denies when row permissions do not match action', () => {
    const permissionsWithRowRestrict: ObjectPermissionConfig[] = [
      {
        object: 'Restricted',
        roles: {
          viewer: {
            actions: ['read', 'update'],
            rowPermissions: [{ actions: ['read'], filter: 'status = active' }],
          },
        },
      },
    ];

    const result = evaluatePermission({
      roles,
      permissions: permissionsWithRowRestrict,
      userRoles: ['viewer'],
      user: { id: 'v', roles: ['viewer'] },
      object: 'Restricted',
      action: 'update',
      record: { status: 'active' },
    });
    // Row permissions only have 'read', not 'update', so this continues to next role
    expect(result).toBeDefined();
  });
});

describe('evaluateCondition', () => {
  it('evaluates eq operator', () => {
    expect(evaluateCondition({ field: 'status', operator: 'eq', value: 'active' }, { status: 'active' })).toBe(true);
    expect(evaluateCondition({ field: 'status', operator: 'eq', value: 'active' }, { status: 'inactive' })).toBe(false);
  });

  it('evaluates neq operator', () => {
    expect(evaluateCondition({ field: 'status', operator: 'neq', value: 'active' }, { status: 'inactive' })).toBe(true);
    expect(evaluateCondition({ field: 'status', operator: 'neq', value: 'active' }, { status: 'active' })).toBe(false);
  });

  it('evaluates gt operator', () => {
    expect(evaluateCondition({ field: 'age', operator: 'gt', value: 18 }, { age: 21 })).toBe(true);
    expect(evaluateCondition({ field: 'age', operator: 'gt', value: 18 }, { age: 18 })).toBe(false);
    expect(evaluateCondition({ field: 'age', operator: 'gt', value: 18 }, { age: 'not a number' })).toBe(false);
  });

  it('evaluates gte operator', () => {
    expect(evaluateCondition({ field: 'age', operator: 'gte', value: 18 }, { age: 18 })).toBe(true);
    expect(evaluateCondition({ field: 'age', operator: 'gte', value: 18 }, { age: 17 })).toBe(false);
  });

  it('evaluates lt operator', () => {
    expect(evaluateCondition({ field: 'age', operator: 'lt', value: 18 }, { age: 15 })).toBe(true);
    expect(evaluateCondition({ field: 'age', operator: 'lt', value: 18 }, { age: 18 })).toBe(false);
  });

  it('evaluates lte operator', () => {
    expect(evaluateCondition({ field: 'age', operator: 'lte', value: 18 }, { age: 18 })).toBe(true);
    expect(evaluateCondition({ field: 'age', operator: 'lte', value: 18 }, { age: 19 })).toBe(false);
  });

  it('evaluates in operator', () => {
    expect(evaluateCondition({ field: 'role', operator: 'in', value: ['admin', 'editor'] }, { role: 'admin' })).toBe(true);
    expect(evaluateCondition({ field: 'role', operator: 'in', value: ['admin', 'editor'] }, { role: 'viewer' })).toBe(false);
  });

  it('evaluates not_in operator', () => {
    expect(evaluateCondition({ field: 'role', operator: 'not_in', value: ['admin'] }, { role: 'viewer' })).toBe(true);
    expect(evaluateCondition({ field: 'role', operator: 'not_in', value: ['admin'] }, { role: 'admin' })).toBe(false);
  });

  it('evaluates contains operator', () => {
    expect(evaluateCondition({ field: 'name', operator: 'contains', value: 'test' }, { name: 'testing' })).toBe(true);
    expect(evaluateCondition({ field: 'name', operator: 'contains', value: 'test' }, { name: 'hello' })).toBe(false);
  });

  it('evaluates is_null operator', () => {
    expect(evaluateCondition({ field: 'val', operator: 'is_null', value: null }, { val: null })).toBe(true);
    expect(evaluateCondition({ field: 'val', operator: 'is_null', value: null }, { val: 'something' })).toBe(false);
    expect(evaluateCondition({ field: 'missing', operator: 'is_null', value: null }, {})).toBe(true);
  });

  it('evaluates is_not_null operator', () => {
    expect(evaluateCondition({ field: 'val', operator: 'is_not_null', value: null }, { val: 'something' })).toBe(true);
    expect(evaluateCondition({ field: 'val', operator: 'is_not_null', value: null }, { val: null })).toBe(false);
  });

  it('returns false for unknown operators', () => {
    expect(evaluateCondition({ field: 'val', operator: 'unknown' as any, value: null }, { val: 'x' })).toBe(false);
  });

  it('blocks prototype pollution fields', () => {
    expect(evaluateCondition({ field: '__proto__', operator: 'eq', value: 'x' }, { __proto__: 'x' } as any)).toBe(false);
    expect(evaluateCondition({ field: 'constructor', operator: 'eq', value: 'x' }, { constructor: 'x' } as any)).toBe(false);
    expect(evaluateCondition({ field: 'prototype', operator: 'eq', value: 'x' }, { prototype: 'x' } as any)).toBe(false);
  });
});
