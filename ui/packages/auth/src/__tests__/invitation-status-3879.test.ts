/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3879 — `AuthInvitation.status` is a CLOSED union, enforced at the wire
 * boundary.
 *
 * ## What was loose
 *
 * The field was declared `string` while its own doc comment enumerated four
 * members, and `createAuthClient` cast better-auth's `any` straight to
 * `AuthInvitation[]`. So the enumeration was advisory: a fifth wire value passed
 * through untouched and landed in `InvitationsPage`'s badge, where a
 * `default: 'secondary'` arm coloured it and `defaultValue: inv.status` printed
 * the raw wire string as UI copy — in all ten packs. #3546 slice seven pins the
 * detection half (its key-set assertion goes red when a fifth status appears);
 * this file pins the HANDLING half.
 *
 * ## What each half of the fix is pinned by, and where it fails
 *
 * The two halves fail at different gates, and saying so is the point:
 *
 *  - the **boundary** is runtime behaviour — these vitest cases go red if
 *    `asAuthInvitation` stops rejecting, or stops naming the offending value;
 *  - the **narrowing** is compile-time only — the `Assert` block and the
 *    `@ts-expect-error` below are erased before vitest ever runs, and are checked
 *    by this package's `tsc -p tsconfig.test.json` project (see that file's
 *    header). Widening `status` back to `string` leaves every runtime case green
 *    and turns the TYPE-CHECK gate red.
 *
 * ## Why the union is better-auth's and not four literals of ours
 *
 * better-auth's organization plugin is the producer (`sys_invitation.status`
 * holds what it writes) and it exports the union itself. Restating it here would
 * be a member-for-member copy — the state one upstream release away from
 * drifting — so `AuthInvitationStatus` BINDS `InvitationStatus`, and the
 * `Equal` pin below is what makes an upstream change land as a red build instead
 * of a silent gap in the guard.
 */

import { describe, it, expect, vi } from 'vitest';
import type { InvitationStatus } from 'better-auth/client/plugins';
import { createAuthClient } from '../createAuthClient';
import {
  AUTH_INVITATION_STATUSES,
  isAuthInvitationStatus,
  type AuthInvitationStatus,
} from '../invitation-status';
import type { AuthInvitation } from '../types';

/**
 * Route better-auth's organization calls onto canned bodies. Same shape as
 * `createAuthClient.test.ts`'s helper next door, kept local so this file's
 * fixtures cannot be perturbed by an edit made for another card.
 */
function mockFetchFor(handlers: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, body] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const clientWith = (handlers: Record<string, unknown>) =>
  createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: mockFetchFor(handlers) });

/** A row that is spec-shaped in every respect except the status under test. */
const rowWith = (status: string) => ({
  id: 'inv_1',
  organizationId: 'org_1',
  email: 'invitee@example.com',
  role: 'member',
  status,
  expiresAt: '2099-01-01T00:00:00.000Z',
  inviterId: 'usr_1',
});

describe('objectui#3879 — the invitation status vocabulary', () => {
  it('is the four members better-auth stores, and nothing else', () => {
    expect([...AUTH_INVITATION_STATUSES].sort()).toEqual([
      'accepted',
      'canceled',
      'pending',
      'rejected',
    ]);
  });

  it('the runtime list is derived from the compile-time map, so it cannot half-drift', () => {
    // Every member of the list narrows, and the list is exactly the guard's
    // domain — a member added to one and not the other fails one of these.
    for (const status of AUTH_INVITATION_STATUSES) {
      expect(isAuthInvitationStatus(status), status).toBe(true);
    }
    expect(AUTH_INVITATION_STATUSES).toHaveLength(4);
  });

  it('the guard refuses everything outside the set — including the near-misses', () => {
    // `cancelled` (two Ls) is the one a hand-written copy of this vocabulary
    // gets wrong; `Pending` is what a control plane that title-cases its enums
    // would send. Both must fail, or the guard is decorative.
    for (const value of ['cancelled', 'Pending', 'expired', '', 'PENDING']) {
      expect(isAuthInvitationStatus(value), value).toBe(false);
    }
    for (const value of [undefined, null, 0, {}, ['pending']]) {
      expect(isAuthInvitationStatus(value), String(value)).toBe(false);
    }
  });
});

describe('objectui#3879 — the wire boundary in createAuthClient', () => {
  it('listInvitations passes the four known statuses through unchanged', async () => {
    const rows = AUTH_INVITATION_STATUSES.map((s, i) => ({ ...rowWith(s), id: `inv_${i}` }));
    const client = clientWith({ '/organization/list-invitations': rows });

    const out = await client.listInvitations('org_1');

    expect(out.map((inv) => inv.status)).toEqual([...AUTH_INVITATION_STATUSES]);
    expect(out).toHaveLength(4);
  });

  it('listInvitations rejects an unknown status LOUDLY, naming the value it refused', async () => {
    const client = clientWith({
      '/organization/list-invitations': [rowWith('pending'), rowWith('expired')],
    });

    // The behaviour this card is about: before the fix this resolved, and
    // `expired` reached the badge as English UI copy in ten locales.
    await expect(client.listInvitations('org_1')).rejects.toThrow(/unexpected invitation status/);
    // The value has to be IN the message — a generic "invalid response" would
    // leave the next reader to diff the payload by hand.
    await expect(client.listInvitations('org_1')).rejects.toThrow(/"expired"/);
    // And the message says what WAS acceptable, so the fix is obvious from the
    // error alone.
    await expect(client.listInvitations('org_1')).rejects.toThrow(/pending \| accepted/);
  });

  it('a missing status is refused too — the shape better-auth would send if it dropped the column', async () => {
    const { status: _dropped, ...withoutStatus } = rowWith('pending');
    const client = clientWith({ '/organization/list-invitations': [withoutStatus] });

    await expect(client.listInvitations('org_1')).rejects.toThrow(/unexpected invitation status/);
  });

  it('guards every invitation-returning route, not just the one the card named', async () => {
    // `listInvitations` is the card's site, but the declared type is the same on
    // all four producers — a boundary on one of four would leave the union
    // unenforced exactly where the next screen reads it.
    const bad = rowWith('expired');
    await expect(
      clientWith({ '/organization/get-invitation': bad }).getInvitation('inv_1'),
    ).rejects.toThrow(/getInvitation: unexpected invitation status/);
    await expect(
      clientWith({ '/organization/list-user-invitations': [bad] }).listUserInvitations(),
    ).rejects.toThrow(/listUserInvitations: unexpected invitation status/);
    await expect(
      clientWith({ '/organization/invite-member': bad }).inviteMember({
        organizationId: 'org_1',
        email: 'invitee@example.com',
        role: 'member',
      }),
    ).rejects.toThrow(/inviteMember: unexpected invitation status/);
  });

  it('the same four routes accept a well-formed row', async () => {
    const good = rowWith('pending');
    await expect(
      clientWith({ '/organization/get-invitation': good }).getInvitation('inv_1'),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      clientWith({ '/organization/list-user-invitations': [good] }).listUserInvitations(),
    ).resolves.toHaveLength(1);
    await expect(
      clientWith({ '/organization/invite-member': good }).inviteMember({
        organizationId: 'org_1',
        email: 'invitee@example.com',
        role: 'member',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.     */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('objectui#3879 — the narrowing itself (checked by tsc, erased before vitest)', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: an `any` on either side makes every
    // assertion below vacuous (objectstack#4171, same reasoning as
    // auth-spec-parity.test.ts).
    type _BetterAuthUnionNotAny = Assert<Equal<IsAny<InvitationStatus>, false>>;
    type _OursNotAny = Assert<Equal<IsAny<AuthInvitationStatus>, false>>;

    // The binding: ours IS better-auth's, both directions. A fifth member
    // upstream — or a hand-written copy here — fails right here.
    type _IsBetterAuths = Assert<Equal<AuthInvitationStatus, InvitationStatus>>;

    // The field carries the union, not `string`. This is the assertion that goes
    // red if `AuthInvitation.status` is ever widened back.
    type _FieldIsUnion = Assert<Equal<AuthInvitation['status'], AuthInvitationStatus>>;
    type _FieldIsNotString = Assert<Equal<Equal<AuthInvitation['status'], string>, false>>;

    expect(true).toBe(true);
  });

  it('refuses a foreign literal where the field is assigned', () => {
    // The `@ts-expect-error` IS the assertion: widen `status` back to `string`
    // and this line stops erroring, which makes the directive unused — a tsc
    // error in its own right. It cannot go quietly green.
    // @ts-expect-error — 'expired' is outside the closed set
    const status: AuthInvitationStatus = 'expired';
    expect(status).toBe('expired');
  });
});
