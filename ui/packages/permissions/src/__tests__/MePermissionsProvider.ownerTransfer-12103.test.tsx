/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12103 — `checkField(object, owner, 'write')` answers the server's
 * whole update rule for the owner field, which includes the transfer grant.
 *
 * The server's security step refuses an update that writes the record's owner
 * (`SystemFieldName.OWNER_ID`) unless the caller holds `allowTransfer` or
 * `modifyAllRecords`; measured on a live backend, `/me/permissions` reports the
 * grant per object and the refusal is a 403. So the `write` question for that
 * one field needs the grant, read with the spec's own predicate, while `create`
 * (the insert rule, which stamps and accepts the caller's own id), `read`, and
 * every other field are untouched.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { SystemFieldName } from '@objectstack/spec/system';
import { MePermissionsProvider, type MePermissionsResponse } from '../MePermissionsProvider';
import { usePermissions } from '../usePermissions';
import type { PermissionContextValue } from '../PermissionContext';

afterEach(cleanup);

const OBJECT = 'crm_account';
const OWNER = SystemFieldName.OWNER_ID;
const EDITOR = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false };

function envelope(
  objects: MePermissionsResponse['objects'],
  fields: MePermissionsResponse['fields'] = {},
  authenticated = true,
): MePermissionsResponse {
  return { authenticated, userId: authenticated ? 'u1' : null, tenantId: null, roles: [], permissionSets: [], objects, fields };
}

function checkFieldUnder(perms: MePermissionsResponse): PermissionContextValue['checkField'] {
  let captured: PermissionContextValue['checkField'] | null = null;
  function Probe() {
    captured = usePermissions().checkField;
    return null;
  }
  render(
    <MePermissionsProvider initialPermissions={perms}>
      <Probe />
    </MePermissionsProvider>,
  );
  if (!captured) throw new Error('the probe did not render');
  return captured;
}

describe("checkField's write question for the owner field (objectui#12103)", () => {
  it('is refused without the transfer grant — false and absent alike', () => {
    expect(checkFieldUnder(envelope({ [OBJECT]: { ...EDITOR, allowTransfer: false } }))(OBJECT, OWNER, 'write')).toBe(false);
    expect(checkFieldUnder(envelope({ [OBJECT]: { ...EDITOR } }))(OBJECT, OWNER, 'write')).toBe(false);
  });

  it('is granted by allowTransfer, and by modifyAllRecords, which implies it', () => {
    expect(checkFieldUnder(envelope({ [OBJECT]: { ...EDITOR, allowTransfer: true } }))(OBJECT, OWNER, 'write')).toBe(true);
    expect(checkFieldUnder(envelope({ [OBJECT]: { ...EDITOR, modifyAllRecords: true } }))(OBJECT, OWNER, 'write')).toBe(true);
  });

  it('reads the wildcard entry for an object the answer does not name, as the object fallback does', () => {
    expect(checkFieldUnder(envelope({ '*': { ...EDITOR, modifyAllRecords: true } }))(OBJECT, OWNER, 'write')).toBe(true);
    expect(checkFieldUnder(envelope({ '*': { ...EDITOR, allowTransfer: false } }))(OBJECT, OWNER, 'write')).toBe(false);
  });

  it('keeps the unknown-object default: closed for a signed-in caller, open for an anonymous one', () => {
    expect(checkFieldUnder(envelope({}))(OBJECT, OWNER, 'write')).toBe(false);
    expect(checkFieldUnder(envelope({}, {}, false))(OBJECT, OWNER, 'write')).toBe(true);
  });

  it("an explicit editable: false entry still refuses it with the grant; the grant does not open the field's own refusal", () => {
    const check = checkFieldUnder(
      envelope({ [OBJECT]: { ...EDITOR, allowTransfer: true } }, { [`${OBJECT}.${OWNER}`]: { readable: true, editable: false } }),
    );
    expect(check(OBJECT, OWNER, 'write')).toBe(false);
  });

  it('CONTROL: create, read and every other field are untouched by the transfer grant', () => {
    const check = checkFieldUnder(envelope({ [OBJECT]: { ...EDITOR, allowTransfer: false } }));
    expect(check(OBJECT, OWNER, 'create')).toBe(true);
    expect(check(OBJECT, OWNER, 'read')).toBe(true);
    expect(check(OBJECT, 'name', 'write')).toBe(true);
  });
});
