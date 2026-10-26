/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An object row's CRUD bit that `/me/permissions` leaves OUT is not a grant.
 *
 * The spec's `objectPermissionGrants` (`@objectstack/spec/security`) is the one
 * fold the server's `PermissionEvaluator.checkObjectPermission` answers from: a
 * bit grants only when it is `=== true` (plus the super-user bypasses), and "an
 * ABSENT entry is `false`". The server's plain-wildcard coverage copies only
 * the `true` bits onto each object it covers, so a read-only set
 * `'*': { allowRead: true }` is served as `{ allowRead: true }` with no
 * `allowCreate`, and an auditor (`allowRead` + `viewAllRecords`) is served with
 * no write bit at all. The provider used to read such a row with
 * `bit !== false`, so it offered New / Edit / Delete that the server then
 * refused with 403.
 *
 * Unchanged, and pinned here as controls: an explicit `true` still grants, an
 * anonymous session keeps its permissive default, and a tree with no provider
 * keeps the fail-open `can`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';
import { usePermissions } from '../usePermissions';

afterEach(cleanup);

const envelope = (objects: MePermissionsResponse['objects']): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-auditor',
  tenantId: null,
  roles: ['auditor'],
  permissionSets: ['auditor'],
  objects,
  fields: {},
});

/** A read-only permission set, as the server serves it: the wildcard's `true` bits only. */
const READ_ONLY_WILDCARD = envelope({ '*': { allowRead: true } });

/** An auditor set, per object: read plus View All, no write bit served. */
const AUDITOR = envelope({
  account: { allowRead: true, viewAllRecords: true },
  invoice: { allowRead: true, viewAllRecords: true },
});

function principalUnder(perms: MePermissionsResponse | null): ReturnType<typeof usePermissions> {
  let captured: ReturnType<typeof usePermissions> | null = null;
  function Probe() {
    captured = usePermissions();
    return null;
  }
  render(perms ? (
    <MePermissionsProvider initialPermissions={perms}>
      <Probe />
    </MePermissionsProvider>
  ) : (
    <Probe />
  ));
  if (!captured) throw new Error('the probe did not render');
  return captured;
}

const WRITE_ACTIONS = ['create', 'update', 'delete', 'import'] as const;
const READ_ACTIONS = ['read', 'export'] as const;

describe.each([
  { shape: "read-only '*'", perms: READ_ONLY_WILDCARD },
  { shape: 'auditor (allowRead + viewAllRecords)', perms: AUDITOR },
])('an absent CRUD bit denies — $shape', ({ perms }) => {
  it('check: every write action is denied with the permission-set reason', () => {
    const p = principalUnder(perms);
    for (const action of WRITE_ACTIONS) {
      expect(p.check('account', action), action).toEqual({ allowed: false, reason: 'denied-by-permission-set' });
      expect(p.can('account', action), action).toBe(false);
    }
  });

  it('check: the read actions stay allowed (CONTROL — the row is honoured, not ignored)', () => {
    const p = principalUnder(perms);
    for (const action of READ_ACTIONS) {
      expect(p.can('account', action), action).toBe(true);
    }
  });

  it("checkField's object-level fallback: create and write denied, read allowed", () => {
    const p = principalUnder(perms);
    expect(p.checkField('account', 'name', 'create')).toBe(false);
    expect(p.checkField('account', 'name', 'write')).toBe(false);
    expect(p.checkField('account', 'name', 'read')).toBe(true);
  });
});

describe("a served row is read through the spec's fold", () => {
  it('a row granting only Create grants Create and nothing else', () => {
    const p = principalUnder(envelope({ account: { allowRead: true, allowCreate: true } }));
    expect(p.can('account', 'create')).toBe(true);
    expect(p.can('account', 'update')).toBe(false);
    expect(p.can('account', 'delete')).toBe(false);
  });

  it('Modify All widens edit and delete, never create', () => {
    const p = principalUnder(envelope({ '*': { modifyAllRecords: true } }));
    expect(p.can('account', 'read')).toBe(true);
    expect(p.can('account', 'update')).toBe(true);
    expect(p.can('account', 'delete')).toBe(true);
    expect(p.can('account', 'create')).toBe(false);
    expect(p.checkField('account', 'name', 'write')).toBe(true);
    expect(p.checkField('account', 'name', 'create')).toBe(false);
  });

  it('an object key is matched case-insensitively, as checkField already matches it', () => {
    const p = principalUnder(envelope({ '*': { allowRead: true }, account: { allowRead: true, allowCreate: true } }));
    expect(p.can('Account', 'create')).toBe(true);
    expect(p.can('Account', 'update')).toBe(false);
  });
});

describe('what an absent bit does not change (controls)', () => {
  it('an explicit `true` bit still grants', () => {
    const p = principalUnder(envelope({ '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } }));
    for (const action of WRITE_ACTIONS) expect(p.can('account', action), action).toBe(true);
    expect(p.checkField('account', 'name', 'create')).toBe(true);
    expect(p.checkField('account', 'name', 'write')).toBe(true);
  });

  it('an anonymous session keeps the permissive default', () => {
    const p = principalUnder({ authenticated: false } as MePermissionsResponse);
    for (const action of WRITE_ACTIONS) expect(p.can('showcase_inquiry', action), action).toBe(true);
    expect(p.checkField('showcase_inquiry', 'message', 'create')).toBe(true);
  });

  it('with no provider mounted, can() stays fail-open', () => {
    const p = principalUnder(null);
    expect(p.isLoaded).toBe(false);
    for (const action of WRITE_ACTIONS) expect(p.can('account', action), action).toBe(true);
  });
});
