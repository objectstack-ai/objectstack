/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `resolveAffordance('listNew')` verdict for a user with no Create grant.
 *
 * An auditor (read + View All) or a read-only finance user was offered New on
 * an object list, filled the form, and learned from the server's 403 that the
 * save could never land. The input that answered "allowed" was the permission
 * provider's polarity: `/me/permissions` serves only the bits a set grants (a
 * read-only `'*'` wildcard is served as `{ allowRead: true }`, an auditor's row
 * as `{ allowRead: true, viewAllRecords: true }`), and the provider read the
 * ABSENT `allowCreate` as allowed. The spec's `objectPermissionGrants`, which
 * the server's evaluator decides from, reads it as no grant.
 *
 * Pinned through the REAL `MePermissionsProvider` and the REAL map, for New and
 * for the record page's Edit and Delete on the same two fixtures, with the
 * controls that must not move: a user holding Create still gets New, and with
 * no provider mounted the verdict stays fail-open.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { resolveAffordance, type ConsoleAffordance } from '@object-ui/core';
import { MePermissionsProvider, usePermissions, type MePermissionsResponse } from '@object-ui/permissions';

afterEach(cleanup);

const OBJECT = 'invoice';

const envelope = (objects: MePermissionsResponse['objects']): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-auditor',
  tenantId: null,
  roles: ['auditor'],
  permissionSets: ['auditor'],
  objects,
  fields: {},
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

const verdict = (affordance: ConsoleAffordance, perms: ReturnType<typeof usePermissions>) =>
  resolveAffordance(affordance, { objectSchema: null, objectName: OBJECT, perms }).allowed;

describe.each([
  { shape: "read-only '*' wildcard", perms: envelope({ '*': { allowRead: true } }) },
  { shape: 'auditor (allowRead + viewAllRecords per object)', perms: envelope({ [OBJECT]: { allowRead: true, viewAllRecords: true } }) },
])('a user without Create — $shape', ({ perms }) => {
  it('is not offered New on the object list', () => {
    expect(verdict('listNew', principalUnder(perms))).toBe(false);
  });

  it("is not offered the record page's Edit or Delete either", () => {
    const p = principalUnder(perms);
    expect(verdict('recordEdit', p)).toBe(false);
    expect(verdict('recordDelete', p)).toBe(false);
  });
});

describe('controls', () => {
  it('a user holding Create is still offered New', () => {
    expect(verdict('listNew', principalUnder(envelope({ '*': { allowRead: true, allowCreate: true } })))).toBe(true);
    cleanup();
    expect(verdict('listNew', principalUnder(envelope({ [OBJECT]: { allowRead: true, allowCreate: true } })))).toBe(true);
  });

  it('with no permission provider mounted, New stays fail-open', () => {
    expect(verdict('listNew', principalUnder(null))).toBe(true);
  });
});
