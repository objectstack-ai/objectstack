// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17189] `systemPermissions` carries two unlike kinds of token, and only one
 * of them may block an `everyone` anchor binding (ADR-0090 D5).
 *
 * Every acceptance below is paired with the SAME definition judged without the
 * declaration list, which refuses — so no pin here can pass because the
 * predicate went blind. The platform floor is pinned against
 * `PLATFORM_CAPABILITY_NAMES` itself rather than a transcribed name, so a
 * renamed platform capability cannot leave the floor testing nothing.
 */

import { describe, it, expect } from 'vitest';

import { PLATFORM_CAPABILITY_NAMES } from './capabilities';
import { describeHighPrivilegeBits, describeAnchorForbiddenBits } from './high-privilege';

/** The app token from the filing consumer: declared by the app, gates its own nav. */
const APP_TOKEN = 'clm_requester.access';
/** A platform system permission — the other kind. */
const PLATFORM_TOKEN = 'manage_users';
/**
 * A platform capability that is spelled like an app token (dotted). It is the
 * reason the discriminator may not be a spelling rule: a name-shape heuristic
 * would hand this one to `everyone`.
 */
const DOTTED_PLATFORM_TOKEN = 'setup.access';

describe('describeHighPrivilegeBits — app-declared capability vs platform system permission (#17189)', () => {
  it('pins the platform names this suite reasons about (else the floor tests nothing)', () => {
    expect(PLATFORM_CAPABILITY_NAMES.has(PLATFORM_TOKEN)).toBe(true);
    expect(PLATFORM_CAPABILITY_NAMES.has(DOTTED_PLATFORM_TOKEN)).toBe(true);
    // The app token must NOT be a platform capability, or "newly accepted"
    // below would be measuring the floor instead of the excusal.
    expect(PLATFORM_CAPABILITY_NAMES.has(APP_TOKEN)).toBe(false);
  });

  // ---- STILL REFUSED: the pre-#17189 verdict is the default ----

  it('still refuses an app token when no declaration list is supplied', () => {
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN] })).toMatch(/system permissions/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN] }, {})).toMatch(/system permissions/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN] }, { declaredCapabilities: [] }))
      .toMatch(/system permissions/);
  });

  it('still refuses a token this stack did not declare', () => {
    expect(
      describeHighPrivilegeBits({ systemPermissions: ['other_app.access'] }, { declaredCapabilities: [APP_TOKEN] }),
    ).toMatch(/system permissions/);
  });

  // ---- NEWLY ACCEPTED: a token the stack declared is the app's own gate ----

  it('accepts a set whose only system permission is a capability this stack declared', () => {
    expect(
      describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN] }, { declaredCapabilities: [APP_TOKEN] }),
    ).toBeNull();
  });

  it('accepts declaration/registry rows as well as bare names', () => {
    expect(
      describeHighPrivilegeBits(
        { systemPermissions: [APP_TOKEN] },
        { declaredCapabilities: [{ name: APP_TOKEN, scope: 'org' }] },
      ),
    ).toBeNull();
    // An entry carrying no usable name excuses nothing.
    expect(
      describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN] }, { declaredCapabilities: [{}, { name: 42 }] }),
    ).toMatch(/system permissions/);
  });

  it('accepts the `sys_permission_set` JSON-string column shape too', () => {
    const row = { system_permissions: JSON.stringify([APP_TOKEN]) };
    expect(describeHighPrivilegeBits(row)).toMatch(/system permissions/);
    expect(describeHighPrivilegeBits(row, { declaredCapabilities: [APP_TOKEN] })).toBeNull();
  });

  it('accepts the filing consumer’s real shape: read grants plus its own nav token', () => {
    const clmRequester = {
      isDefault: true,
      objects: { contract: { allowRead: true, allowCreate: true, allowEdit: true } },
      systemPermissions: [APP_TOKEN],
    };
    expect(describeHighPrivilegeBits(clmRequester)).toMatch(/system permissions/);
    expect(describeHighPrivilegeBits(clmRequester, { declaredCapabilities: [APP_TOKEN] })).toBeNull();
  });

  // ---- THE PLATFORM FLOOR: declaring a platform name laundered nothing ----

  it('still refuses a platform system permission even when a package declares that name', () => {
    expect(
      describeHighPrivilegeBits({ systemPermissions: [PLATFORM_TOKEN] }, { declaredCapabilities: [PLATFORM_TOKEN] }),
    ).toMatch(/system permissions/);
  });

  it('is provenance, not spelling: a DOTTED platform capability is still refused when declared', () => {
    expect(
      describeHighPrivilegeBits(
        { systemPermissions: [DOTTED_PLATFORM_TOKEN] },
        { declaredCapabilities: [DOTTED_PLATFORM_TOKEN] },
      ),
    ).toMatch(/system permissions/);
  });

  it('still refuses a mixed set — one unexcused token is enough', () => {
    expect(
      describeHighPrivilegeBits(
        { systemPermissions: [APP_TOKEN, PLATFORM_TOKEN] },
        { declaredCapabilities: [APP_TOKEN, PLATFORM_TOKEN] },
      ),
    ).toMatch(/system permissions/);
  });

  it('never excuses a non-string entry, however the list is declared', () => {
    expect(
      describeHighPrivilegeBits(
        { systemPermissions: [{ name: APP_TOKEN }] },
        { declaredCapabilities: [APP_TOKEN, { name: APP_TOKEN }] },
      ),
    ).toMatch(/system permissions/);
  });

  // ---- THE REST OF THE D5 LIST IS UNTOUCHED ----

  it('leaves every other D5 bit refusing, declaration list or not', () => {
    const ctx = { declaredCapabilities: [APP_TOKEN] };
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN], objects: { a: { viewAllRecords: true } } }, ctx))
      .toMatch(/View\/Modify All/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN], objects: { a: { modifyAllRecords: true } } }, ctx))
      .toMatch(/View\/Modify All/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN], objects: { a: { allowDelete: true } } }, ctx))
      .toMatch(/delete\/purge\/transfer/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN], objects: { a: { allowTransfer: true } } }, ctx))
      .toMatch(/delete\/purge\/transfer/);
    expect(describeHighPrivilegeBits({ systemPermissions: [APP_TOKEN], objects: { a: { allowExport: true } } }, ctx))
      .toMatch(/bulk export/);
  });
});

describe('describeAnchorForbiddenBits — the excusal is the `everyone` tier’s alone (ADR-0090 D9)', () => {
  const declaredOnly = { systemPermissions: [APP_TOKEN] };
  const ctx = { declaredCapabilities: [APP_TOKEN] };

  it('lets a declared app token bind to `everyone`', () => {
    expect(describeAnchorForbiddenBits(declaredOnly, 'everyone')).toMatch(/system permissions/);
    expect(describeAnchorForbiddenBits(declaredOnly, 'everyone', ctx)).toBeNull();
  });

  it('still refuses it for `guest` — the strictest tier does not honour the D5 excusal', () => {
    expect(describeAnchorForbiddenBits(declaredOnly, 'guest', ctx)).toMatch(/system permissions/);
    // Lit control: the guest tier CAN return null, so the line above is a
    // verdict about the token and not about the tier refusing everything.
    expect(describeAnchorForbiddenBits({ objects: { a: { allowRead: true } } }, 'guest')).toBeNull();
  });

  it('leaves the guest tier’s own rules exactly as they were', () => {
    expect(describeAnchorForbiddenBits({ objects: { '*': { allowRead: true } } }, 'guest', ctx)).toMatch(/wildcard/);
    expect(describeAnchorForbiddenBits({ objects: { a: { allowEdit: true } } }, 'guest', ctx)).toMatch(/read-only/);
    expect(describeAnchorForbiddenBits({ objects: { a: { allowEdit: true } } }, 'everyone', ctx)).toBeNull();
  });
});
