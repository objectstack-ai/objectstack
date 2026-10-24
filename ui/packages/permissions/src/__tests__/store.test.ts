/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { createPermissionStore } from '../store';
import type { RoleDefinition, ObjectPermissionConfig } from '@object-ui/types';

// A role carries identity and inheritance only; every grant these cases
// exercise arrives through the `ObjectPermissionConfig[]` below, which is the
// only wired home for role grants (objectui#4288).
const roles: RoleDefinition[] = [
  { name: 'admin', label: 'Admin' },
  { name: 'viewer', label: 'Viewer' },
];

const permissions: ObjectPermissionConfig[] = [
  {
    object: 'Task',
    roles: {
      admin: { actions: ['create', 'read', 'update', 'delete'] },
      viewer: { actions: ['read'] },
    },
  },
];

describe('createPermissionStore', () => {
  it('creates a store with check, setUserRoles, setPermissions methods', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['admin'] });
    expect(store.check).toBeTypeOf('function');
    expect(store.setUserRoles).toBeTypeOf('function');
    expect(store.setPermissions).toBeTypeOf('function');
  });

  it('allows admin to delete', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['admin'] });
    const result = store.check('Task', 'delete');
    expect(result.allowed).toBe(true);
  });

  it('denies viewer from deleting', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['viewer'] });
    const result = store.check('Task', 'delete');
    expect(result.allowed).toBe(false);
  });

  it('allows viewer to read', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['viewer'] });
    const result = store.check('Task', 'read');
    expect(result.allowed).toBe(true);
  });

  it('updates user roles dynamically', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['viewer'] });
    expect(store.check('Task', 'delete').allowed).toBe(false);

    store.setUserRoles(['admin']);
    expect(store.check('Task', 'delete').allowed).toBe(true);
  });

  it('updates permissions dynamically', () => {
    const store = createPermissionStore({ roles, permissions, userRoles: ['admin'] });
    expect(store.check('Task', 'delete').allowed).toBe(true);

    store.setPermissions([{
      object: 'Task',
      roles: {
        admin: { actions: ['read'] },
      },
    }]);
    expect(store.check('Task', 'delete').allowed).toBe(false);
  });

  it('works with user provided', () => {
    const store = createPermissionStore({
      roles,
      permissions,
      userRoles: ['admin'],
      user: { id: 'user-1' },
    });
    const result = store.check('Task', 'read');
    expect(result.allowed).toBe(true);
  });

  it('works without user provided', () => {
    const store = createPermissionStore({
      roles,
      permissions,
      userRoles: ['admin'],
    });
    const result = store.check('Task', 'read');
    expect(result.allowed).toBe(true);
  });
});
