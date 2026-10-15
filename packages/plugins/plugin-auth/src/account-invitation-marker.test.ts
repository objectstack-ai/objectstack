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
 *
 * [#23598] The delivery receipt the same store carries, by the same legs: it
 * settles only inside the import's store, for the address it names, on a call
 * with no Request; nothing settled reads `unconfirmed`. The import-door pins
 * are `admin-import-users-invite-delivery-failure.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { runWithRequestState } from '@better-auth/core/context';
import {
  readAccountInvitation,
  runImportPasswordReset,
  settleImportResetDelivery,
  type AccountInvitationMarker,
} from './account-invitation-marker.js';

const MARKER: AccountInvitationMarker = {
  email: 'Invitee@Acme.Example.com',
  inviter: { name: 'Ada Admin', email: 'ada@acme.example.com' },
};
const HTTP_REQUEST = () => new Request('https://acme.example.com/api/v1/auth/request-password-reset', { method: 'POST' });

/** The import's opener, answering what `fn` returned. */
async function insideImportReset<T>(marker: AccountInvitationMarker, fn: () => Promise<T>): Promise<T> {
  return (await runImportPasswordReset(marker, fn)).result;
}

describe('[#23343] readAccountInvitation', () => {
  it('inside the marker store, for the invited address and no Request, answers the marker', async () => {
    const read = await insideImportReset(MARKER, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return readAccountInvitation('invitee@acme.example.com', undefined);
    });
    expect(read).toEqual({ email: 'invitee@acme.example.com', inviter: MARKER.inviter });
  });

  it('leg 3: the same store, read for a call that carries a Request (any HTTP request), answers nothing', async () => {
    const read = await insideImportReset(MARKER, () => readAccountInvitation('invitee@acme.example.com', HTTP_REQUEST()));
    expect(read).toBeUndefined();
  });

  it('leg 4: the same store, read for another recipient, answers nothing', async () => {
    const read = await insideImportReset(MARKER, () => readAccountInvitation('someone-else@acme.example.com', undefined));
    expect(read).toBeUndefined();
  });

  it('leg 2: a store opened for another request (as handleRequest opens one per request) carries no marker', async () => {
    const read = await insideImportReset(MARKER, () =>
      runWithRequestState(new WeakMap(), () => readAccountInvitation('invitee@acme.example.com', undefined)),
    );
    expect(read).toBeUndefined();
  });

  it('outside any store, and after the marked call settled, answers nothing', async () => {
    expect(await readAccountInvitation('invitee@acme.example.com', undefined)).toBeUndefined();
    await insideImportReset(MARKER, async () => undefined);
    expect(await readAccountInvitation('invitee@acme.example.com', undefined)).toBeUndefined();
  });

  it('on Node, a task started OUTSIDE the store does not see it, even while the marked call is open', async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const outside = (async () => {
      await gate;
      return readAccountInvitation('invitee@acme.example.com', undefined);
    })();
    const [inside, seenOutside] = await insideImportReset(MARKER, async () => {
      openGate();
      const seen = await outside;
      return [await readAccountInvitation('invitee@acme.example.com', undefined), seen] as const;
    });
    expect(inside?.inviter).toEqual(MARKER.inviter);
    expect(seenOutside).toBeUndefined();
  });
});

describe('[#23598] the import delivery receipt', () => {
  const INVITEE = 'invitee@acme.example.com';
  const failingSend = async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    throw new Error('550 mailbox unavailable');
  };

  it('a send that succeeds, inside the import\'s store, settles accepted', async () => {
    const { delivery } = await runImportPasswordReset({ email: INVITEE }, () =>
      settleImportResetDelivery(INVITEE, undefined, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }),
    );
    expect(delivery).toEqual({ status: 'accepted' });
  });

  it('a send that throws settles failed with its reason, and the throw still reaches better-auth', async () => {
    let rethrown: unknown;
    const { delivery } = await runImportPasswordReset({ email: INVITEE }, async () => {
      // better-auth's `runInBackgroundOrAwait`: catch and log.
      try {
        await settleImportResetDelivery('Invitee@Acme.Example.com', undefined, failingSend);
      } catch (e) {
        rethrown = e;
      }
    });
    expect(delivery).toEqual({ status: 'failed', reason: '550 mailbox unavailable' });
    expect((rethrown as Error)?.message).toBe('550 mailbox unavailable');
  });

  it('the receipt rides its own slot: no inviter, no marker, still a receipt', async () => {
    const { result, delivery } = await runImportPasswordReset({ email: INVITEE }, async () => {
      const marker = await readAccountInvitation(INVITEE, undefined);
      await settleImportResetDelivery(INVITEE, undefined, async () => undefined);
      return marker;
    });
    expect(result).toBeUndefined();
    expect(delivery.status).toBe('accepted');
  });

  it('nothing settled is unconfirmed, never accepted', async () => {
    const { delivery } = await runImportPasswordReset({ email: INVITEE }, async () => ({ status: true }));
    expect(delivery).toEqual({ status: 'unconfirmed' });
  });

  it('a call that carries a Request gets the same promise back and settles nothing', async () => {
    const pending = Promise.resolve('sent');
    let handedBack: unknown;
    const { delivery } = await runImportPasswordReset({ email: INVITEE }, async () => {
      handedBack = settleImportResetDelivery(INVITEE, HTTP_REQUEST(), () => pending);
      await handedBack;
    });
    expect(handedBack).toBe(pending);
    expect(delivery).toEqual({ status: 'unconfirmed' });
  });

  it('a send for another recipient settles nothing, and its failure still propagates', async () => {
    const { delivery } = await runImportPasswordReset({ email: INVITEE }, async () => {
      await expect(settleImportResetDelivery('someone-else@acme.example.com', undefined, failingSend))
        .rejects.toThrow('550 mailbox unavailable');
    });
    expect(delivery).toEqual({ status: 'unconfirmed' });
  });

  it('outside any store, a send runs and propagates as before', async () => {
    await expect(settleImportResetDelivery(INVITEE, undefined, async () => 'ok')).resolves.toBe('ok');
    await expect(settleImportResetDelivery(INVITEE, undefined, failingSend)).rejects.toThrow('550 mailbox unavailable');
  });
});
