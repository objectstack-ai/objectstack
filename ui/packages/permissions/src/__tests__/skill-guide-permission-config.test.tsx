/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4812 — the `PermissionProvider` setup example in
 * `skills/objectui/guides/auth-permissions.md` had four shapes that no
 * exported type in `@object-ui/types` accepts, and copying it made `check()`
 * throw rather than deny:
 *
 *   1. `roles[].permissions` — retired with `RoleDefinition` in objectui#4288.
 *   2. `fieldPermissions` / `rowPermissions` at the top level of a permission
 *      entry instead of nested under `roles.<roleName>`, with the required
 *      `roles` member absent entirely. This is the one that threw: the
 *      evaluator read `objectConfig.roles[roleName]` off `undefined`.
 *   3. `RowLevelPermission.filter` given as an object; it is a `string`.
 *   4. `FieldLevelPermission.roles` — that type has no `roles` member.
 *
 * The suite has three halves, after PR #4792:
 *
 *   - COMPILE-TIME. The example below is real code, annotated with the real
 *     exported types and compiled by this package's `tsconfig.test.json`.
 *     This is the only half that can catch a wrong *value* on a legal key
 *     (defect 3, the object-valued `filter`) — no key-name check can see it.
 *   - DOC-SAMENESS. The same lines are lifted out of this file by marker and
 *     asserted to appear, contiguously, in the guide. Without this half the
 *     compile-time half only type-checks a snippet nobody ships.
 *   - BEHAVIOUR. The example is fed to the real evaluator and the real
 *     provider, pinning that the documented config denies rather than throws,
 *     and that `filter` comes back verbatim.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';
import { evaluatePermission } from '../evaluator';
import { PermissionProvider } from '../PermissionProvider';
import { usePermissions } from '../usePermissions';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const GUIDE = path.join(repoRoot, 'skills/objectui/guides/auth-permissions.md');

// --- 8< --- guide example begin --- 8< ---
// A role definition carries identity and inheritance only. Its grants live in
// `ObjectPermissionConfig.roles` below, keyed by object — that is the single
// wired home for "what may this role do".
const roles: RoleDefinition[] = [
  { name: 'admin', label: 'Administrator' },
  { name: 'viewer', label: 'Viewer', inherits: ['base'] },  // Role inheritance
];

const permissions: ObjectPermissionConfig[] = [
  {
    object: 'contacts',
    publicAccess: ['read'],  // Public actions (no auth needed)
    // `roles` is required, and it is the level that decides *who* a rule
    // applies to. Field and row rules nest under the role name; they carry
    // no `roles` member of their own.
    roles: {
      admin: {
        actions: ['create', 'read', 'update', 'delete', 'export'],
      },
      viewer: {
        actions: ['read'],
        // Only admin sees salary: the restriction is declared on the role
        // it restricts, and admin simply has no entry for the field.
        fieldPermissions: [{ field: 'salary', read: false, mask: '****' }],
      },
      owner: {
        actions: ['read', 'update', 'delete'],
        // `filter` is a string, and it is handed back to you verbatim.
        rowPermissions: [
          { filter: 'ownerId = ${user.id}', actions: ['update', 'delete'] },
        ],
      },
    },
  },
  {
    object: 'orders',
    roles: {
      admin: { actions: ['create', 'read', 'update', 'delete'] },
      viewer: { actions: ['read'] },
    },
  },
];
// --- 8< --- guide example end --- 8< ---

const BEGIN = '// --- 8< --- guide example begin --- 8< ---';
const END = '// --- 8< --- guide example end --- 8< ---';

/** The example above, lifted from this file's own source. */
function exampleLines(): string[] {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const from = self.findIndex((l) => l.trim() === BEGIN);
  const to = self.findIndex((l) => l.trim() === END);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return self.slice(from + 1, to);
}

describe('objectui#4812 — the guide example is the shape the types declare', () => {
  it('is published verbatim in the guide (contiguous lines)', () => {
    const guide = fs.readFileSync(GUIDE, 'utf8').split('\n').map((l) => l.trimEnd());
    const want = exampleLines().map((l) => l.trimEnd());

    const start = guide.findIndex((l) => l === want[0]);
    expect(
      start,
      `first line of the pinned example not found in ${path.relative(repoRoot, GUIDE)}`,
    ).toBeGreaterThan(-1);
    expect(guide.slice(start, start + want.length)).toEqual(want);
  });

  it('leaves none of the four retired/mis-levelled shapes in the guide example', () => {
    const want = exampleLines().join('\n');
    // 1: no role-direct grants. 4: no `roles` member on a field rule.
    expect(want).not.toMatch(/permissions:\s*\{/);
    expect(want).not.toMatch(/field:.*roles:/);
    // 2: the required `roles` member is present on every entry.
    expect(permissions.every((p) => p.roles !== undefined)).toBe(true);
    // 3: every `filter` is a string, never an object.
    const filters = permissions.flatMap((p) =>
      Object.values(p.roles).flatMap((r) => r.rowPermissions ?? []),
    );
    expect(filters.length).toBeGreaterThan(0);
    for (const rp of filters) expect(typeof rp.filter).toBe('string');
  });

  it('denies instead of throwing on the action the guide itself goes on to check', () => {
    // The guide derives `canDeleteContacts` from `check('contacts', 'delete')`.
    // `publicAccess` covers only `read`, so this is the call that used to hit
    // the unguarded `objectConfig.roles[roleName]`.
    const asViewer = () =>
      evaluatePermission({
        roles,
        permissions,
        userRoles: ['viewer'],
        user: { id: 'v', roles: ['viewer'] },
        object: 'contacts',
        action: 'delete',
      });
    expect(asViewer).not.toThrow();
    expect(asViewer().allowed).toBe(false);

    expect(
      evaluatePermission({
        roles,
        permissions,
        userRoles: ['admin'],
        user: { id: 'a', roles: ['admin'] },
        object: 'contacts',
        action: 'delete',
      }).allowed,
    ).toBe(true);
  });

  it('returns the row filter verbatim — the package interpolates nothing', () => {
    const result = evaluatePermission({
      roles,
      permissions,
      userRoles: ['owner'],
      user: { id: 'u-1', roles: ['owner'] },
      object: 'contacts',
      action: 'update',
      record: { ownerId: 'u-1' },
    });
    expect(result.allowed).toBe(true);
    // Not `ownerId = u-1`: the placeholder reaches the caller unresolved.
    expect(result.rowFilter).toBe('ownerId = ${user.id}');
  });
});

function Probe() {
  const { check, checkField, getFieldPermissions, getRowFilter } = usePermissions();
  return (
    <div>
      <span data-testid="delete">{String(check('contacts', 'delete').allowed)}</span>
      <span data-testid="read">{String(check('contacts', 'read').allowed)}</span>
      <span data-testid="salary">{String(checkField('contacts', 'salary', 'read'))}</span>
      <span data-testid="fieldPerms">{String(getFieldPermissions('contacts').length)}</span>
      <span data-testid="rowFilter">{String(getRowFilter('contacts'))}</span>
    </div>
  );
}

/**
 * objectui#4812 task B — a config missing the required `roles` must deny, not
 * crash. `ObjectPermissionConfig` declares `roles` required, so this fixture
 * has to be cast: the point is precisely the config the compiler never saw
 * (plain JS, or metadata loaded at runtime). Both polarities are pinned, since
 * a guard that denied everything would also pass the first half alone.
 */
const ROLELESS = [
  { object: 'contacts', publicAccess: ['read'] } as unknown as ObjectPermissionConfig,
];

describe('objectui#4812 — a malformed config denies rather than crashing the render', () => {
  it('evaluator: non-public action on a roles-less config is a denial, not a TypeError', () => {
    const call = () =>
      evaluatePermission({
        roles,
        permissions: ROLELESS,
        userRoles: ['viewer'],
        user: { id: 'v', roles: ['viewer'] },
        object: 'contacts',
        action: 'delete',
      });
    expect(call).not.toThrow();
    expect(call().allowed).toBe(false);
    expect(call().reason).toContain('delete');
  });

  it('evaluator: the publicAccess channel still answers first', () => {
    expect(
      evaluatePermission({
        roles,
        permissions: ROLELESS,
        userRoles: ['viewer'],
        user: { id: 'v', roles: ['viewer'] },
        object: 'contacts',
        action: 'read',
      }).allowed,
    ).toBe(true);
  });

  it('provider: every read survives a roles-less config', () => {
    render(
      <PermissionProvider roles={roles} permissions={ROLELESS} userRoles={['viewer']}>
        <Probe />
      </PermissionProvider>,
    );
    expect(screen.getByTestId('delete').textContent).toBe('false');
    expect(screen.getByTestId('read').textContent).toBe('true');
    // `checkField` / `getFieldPermissions` / `getRowFilter` keep their own
    // documented defaults (allow / none / none); the guard removed the crash,
    // it did not change what they mean.
    expect(screen.getByTestId('salary').textContent).toBe('true');
    expect(screen.getByTestId('fieldPerms').textContent).toBe('0');
    expect(screen.getByTestId('rowFilter').textContent).toBe('undefined');
  });

  it('provider: a well-formed config is unaffected by the guard', () => {
    render(
      <PermissionProvider roles={roles} permissions={permissions} userRoles={['viewer']}>
        <Probe />
      </PermissionProvider>,
    );
    expect(screen.getByTestId('delete').textContent).toBe('false');
    expect(screen.getByTestId('read').textContent).toBe('true');
    expect(screen.getByTestId('salary').textContent).toBe('false');
    expect(screen.getByTestId('fieldPerms').textContent).toBe('1');
  });
});
