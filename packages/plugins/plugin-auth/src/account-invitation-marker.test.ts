// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23343] The four legs of the account-invitation marker, against the REAL
 * `@better-auth/core/context` request-state storage (native
 * `AsyncLocalStorage` on Node). The polyfill path — the synchronous,
 * process-global store `auth-manager.ts` installs on WebContainer — has its
 * own file, `account-invitation-marker.webcontainer.test.ts`, because it
 * replaces a process-wide slot.
 *
 * The end-to-end pins (the import sends the new key; a public reset never
 * does) are `admin-import-users-account-invitation.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { runWithRequestState } from '@better-auth/core/context';
import { readAccountInvitation, runAsAccountInvitation, type AccountInvitationMarker } from './account-invitation-marker.js';

const MARKER: AccountInvitationMarker = {
  email: 'Invitee@Acme.Example.com',
  inviter: { name: 'Ada Admin', email: 'ada@acme.example.com' },
};
const HTTP_REQUEST = () => new Request('https://acme.example.com/api/v1/auth/request-password-reset', { method: 'POST' });

describe('[#23343] readAccountInvitation', () => {
  it('inside the marker store, for the invited address and no Request, answers the marker', async () => {
    const read = await runAsAccountInvitation(MARKER, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return readAccountInvitation('invitee@acme.example.com', undefined);
    });
    expect(read).toEqual({ email: 'invitee@acme.example.com', inviter: MARKER.inviter });
  });

  it('leg 3: the same store, read for a call that carries a Request (any HTTP request), answers nothing', async () => {
    const read = await runAsAccountInvitation(MARKER, () => readAccountInvitation('invitee@acme.example.com', HTTP_REQUEST()));
    expect(read).toBeUndefined();
  });

  it('leg 4: the same store, read for another recipient, answers nothing', async () => {
    const read = await runAsAccountInvitation(MARKER, () => readAccountInvitation('someone-else@acme.example.com', undefined));
    expect(read).toBeUndefined();
  });

  it('leg 2: a store opened for another request (as handleRequest opens one per request) carries no marker', async () => {
    const read = await runAsAccountInvitation(MARKER, () =>
      runWithRequestState(new WeakMap(), () => readAccountInvitation('invitee@acme.example.com', undefined)),
    );
    expect(read).toBeUndefined();
  });

  it('outside any store, and after the marked call settled, answers nothing', async () => {
    expect(await readAccountInvitation('invitee@acme.example.com', undefined)).toBeUndefined();
    await runAsAccountInvitation(MARKER, async () => undefined);
    expect(await readAccountInvitation('invitee@acme.example.com', undefined)).toBeUndefined();
  });

  it('on Node, a task started OUTSIDE the store does not see it, even while the marked call is open', async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const outside = (async () => {
      await gate;
      return readAccountInvitation('invitee@acme.example.com', undefined);
    })();
    const [inside, seenOutside] = await runAsAccountInvitation(MARKER, async () => {
      openGate();
      const seen = await outside;
      return [await readAccountInvitation('invitee@acme.example.com', undefined), seen] as const;
    });
    expect(inside?.inviter).toEqual(MARKER.inviter);
    expect(seenOutside).toBeUndefined();
  });
});
