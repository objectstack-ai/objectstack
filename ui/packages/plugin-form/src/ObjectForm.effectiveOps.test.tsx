/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectForm — the managed-object blanket field lock vs the server's effective
 * API operation set (#3546).
 *
 * The form's blanket lock resolves the object's CRUD affordance for the CURRENT
 * mode (`edit` → `update`, `create` → `create`). #3546 intersects that with the
 * server-resolved effective operation set (`/me/permissions` `apiOperations`),
 * so the form never presents writable inputs for an operation the server would
 * 405 on submit.
 *
 * These assert the rendered input's `disabled` state — the user-visible outcome
 * — across the effective-set matrix, and pin the two invariants that make this
 * an intersection: a server grant never re-opens a bucket-locked object, and a
 * `userActions` opt-in never survives a server denial. A missing effective set
 * (unrestricted object / old backend / no PermissionProvider) preserves the
 * pre-#3546 behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// The stub must keep a STABLE identity across renders: ObjectForm carries
// `perms` in several `useMemo` dependency arrays, and the real `usePermissions`
// memoizes its return value for exactly that reason. Handing back a fresh
// object literal per call makes those memos churn every render and the form
// spins in an infinite update loop. `vi.hoisted` builds it before the hoisted
// `vi.mock` factory runs, and the accessor reads mutable state so tests can
// swap the effective set without changing the object's identity.
const { permsStub, state } = vi.hoisted(() => {
  const state: { effectiveOps: string[] | undefined } = { effectiveOps: undefined };
  return {
    state,
    // `isLoaded: false` keeps the FIELD-level permission filter out of the way
    // (ObjectForm fails open on it) so the blanket mode lock is the only variable.
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      // The caller's object grant (objectui#12082) holds every verb, so the
      // effective set stays the only variable, as the comment above says.
      can: () => true,
      getObjectApiOperations: () => state.effectiveOps,
    },
  };
});

// `usePermissions` is the only binding this module graph takes from the package.
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => permsStub,
  };
});

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const textField = { name: { type: 'text', label: 'Name', readonly: false } };
const record = { id: 'u1', name: 'Acme' };

const dsFor = (schema: any): any => ({
  getObjectSchema: vi.fn().mockResolvedValue(schema),
  findOne: vi.fn().mockResolvedValue(record),
  getRecord: vi.fn().mockResolvedValue(record),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  query: vi.fn(),
});

/** Render the object form in `mode` and report whether its input is locked. */
async function nameInputDisabled(schema: any, mode: 'edit' | 'create'): Promise<boolean> {
  const { container } = render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: schema.name,
          mode,
          ...(mode === 'edit' ? { recordId: 'u1' } : {}),
        } as any
      }
      dataSource={dsFor(schema)}
    />,
  );
  const el = await waitFor(() => {
    const found = container.querySelector('input[name="name"]') as HTMLInputElement | null;
    if (!found) throw new Error('name input not yet rendered');
    return found;
  });
  return el.disabled;
}

const platform = { name: 'crm_lead', managedBy: 'platform', fields: textField };

beforeEach(() => {
  state.effectiveOps = undefined;
  cleanup();
});

describe('ObjectForm — blanket lock vs effective API operations (#3546)', () => {
  it('edit mode, effective set WITH `update` → fields editable', async () => {
    state.effectiveOps = ['get', 'list', 'update'];
    expect(await nameInputDisabled(platform, 'edit')).toBe(false);
  });

  it('edit mode, effective set WITHOUT `update` → blanket lock engages', async () => {
    // The #3546 behavior change: pre-fix a platform object rendered enabled
    // inputs that the server would have rejected on submit.
    state.effectiveOps = ['get', 'list'];
    expect(await nameInputDisabled(platform, 'edit')).toBe(true);
  });

  it('edit mode, empty effective set ("expose nothing") → locked', async () => {
    state.effectiveOps = [];
    expect(await nameInputDisabled(platform, 'edit')).toBe(true);
  });

  it('edit mode, undefined effective set (unrestricted / old backend) → unchanged, editable', async () => {
    state.effectiveOps = undefined;
    expect(await nameInputDisabled(platform, 'edit')).toBe(false);
  });

  it('create mode keys off `create`, not `update`', async () => {
    // Server allows update but NOT create → the create form must lock, even
    // though the edit form on the same object would not.
    state.effectiveOps = ['get', 'list', 'update'];
    expect(await nameInputDisabled(platform, 'create')).toBe(true);

    cleanup();
    state.effectiveOps = ['get', 'list', 'create'];
    expect(await nameInputDisabled(platform, 'create')).toBe(false);
  });

  it('bucket-locked object stays locked even when the server allows `update`', async () => {
    // Intersection, never union. The bucket is `engine-owned`: protocol 17
    // split the old `'system'` (objectstack#3355), which now resolves to the
    // default-writable fallback and would lock nothing.
    const engineOwned = { name: 'sys_automation_run', managedBy: 'engine-owned', fields: textField };
    state.effectiveOps = ['get', 'list', 'create', 'update', 'delete'];
    expect(await nameInputDisabled(engineOwned, 'edit')).toBe(true);
  });

  it('userActions.edit opt-in still loses to a server denial', async () => {
    const sysUser = {
      name: 'sys_user',
      managedBy: 'better-auth',
      userActions: { edit: true },
      fields: textField,
    };
    state.effectiveOps = ['get', 'list', 'update'];
    expect(await nameInputDisabled(sysUser, 'edit')).toBe(false);

    cleanup();
    state.effectiveOps = ['get', 'list'];
    expect(await nameInputDisabled(sysUser, 'edit')).toBe(true);
  });
});
