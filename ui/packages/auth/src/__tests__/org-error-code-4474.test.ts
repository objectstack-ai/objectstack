/**
 * objectui#4474 — the machine `code` survives the organization client boundary.
 *
 * ## Why this file exists separately from the console's mapping test
 *
 * Family 2 of #4474 is a two-link chain: better-auth answers a refused call with
 * `{ message, code }`, `createAuthClient` turns that into a thrown `Error`, and
 * the console maps `.code` to a translated sentence. The console test
 * (`packages/app-shell/src/console/organizations/__tests__/org-i18n-holdouts-4474.test.tsx`)
 * mocks `useAuth` and therefore constructs its own coded error — it pins the
 * SECOND link and is structurally blind to the first. Without this file the
 * producer could be reverted to `new Error(error.message ?? '…')`, the console
 * suite would stay entirely green, and the feature would be dead in the browser:
 * every code arrives `undefined`, every message degrades to verbatim English,
 * and nothing anywhere goes red.
 *
 * So this drives the REAL better-auth client through a mocked `fetch`, the same
 * way `createAuthClient.test.ts` next door does. The assertion is on `.code`,
 * because `.message` was already correct before the fix and cannot discriminate.
 *
 * ## What was wrong
 *
 * `toAuthError` — which preserves `code` — was wired to sign-in and sign-up
 * only. All sixteen `organization.*` methods threw a bare `Error`, dropping the
 * code at the one boundary that had it.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

/** A mocked fetch that answers one path with a better-auth error envelope. */
function rejectingFetch(pathFragment: string, status: number, body: unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes(pathFragment)) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const clientWith = (fetchFn: ReturnType<typeof rejectingFetch>) =>
  createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: fetchFn as unknown as typeof fetch });

/** Read `.code` off a rejection the way the console's mapping helper does. */
async function codeOf(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
    throw new Error('expected the call to reject, but it resolved');
  } catch (err) {
    const e = err as Error & { code?: string };
    return { code: e.code, message: e.message };
  }
}

describe('#4474 — organization rejections carry the machine code', () => {
  it('inviteMember preserves YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION', async () => {
    const client = clientWith(
      rejectingFetch('/organization/invite-member', 403, {
        message: 'You are not allowed to invite users to this organization',
        code: 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION',
      }),
    );
    const { code, message } = await codeOf(
      client.inviteMember({ organizationId: 'org-1', email: 'p@x.test', role: 'member' }),
    );
    expect(code).toBe('YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION');
    // MUST NOT CHANGE: the message is exactly what it was before the fix. This
    // change adds the code; it does not reword anything.
    expect(message).toBe('You are not allowed to invite users to this organization');
  });

  it('createOrganization preserves ORGANIZATION_ALREADY_EXISTS', async () => {
    const client = clientWith(
      rejectingFetch('/organization/create', 400, {
        message: 'Organization already exists',
        code: 'ORGANIZATION_ALREADY_EXISTS',
      }),
    );
    const { code, message } = await codeOf(
      client.createOrganization({ name: 'Acme', slug: 'acme' }),
    );
    expect(code).toBe('ORGANIZATION_ALREADY_EXISTS');
    expect(message).toBe('Organization already exists');
  });

  it('acceptInvitation preserves YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION', async () => {
    const client = clientWith(
      rejectingFetch('/organization/accept-invitation', 403, {
        message: 'You are not the recipient of the invitation',
        code: 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
      }),
    );
    const { code, message } = await codeOf(client.acceptInvitation('inv-1'));
    expect(code).toBe('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION');
    expect(message).toBe('You are not the recipient of the invitation');
  });

  it('a rejection with no code still throws the server message, unchanged', async () => {
    // The degrade leg at the producer: an error envelope without a `code` must
    // not grow one, and must keep its sentence for the console to show verbatim.
    const client = clientWith(
      rejectingFetch('/organization/accept-invitation', 500, { message: 'Upstream exploded' }),
    );
    const { code, message } = await codeOf(client.acceptInvitation('inv-1'));
    expect(code).toBeUndefined();
    expect(message).toBe('Upstream exploded');
  });

  it('an empty error envelope falls back to the method fallback message', async () => {
    // `toAuthError`'s new second argument. Before #4474 each org method spelled
    // this fallback inline; the behaviour is preserved exactly.
    const client = clientWith(rejectingFetch('/organization/accept-invitation', 500, {}));
    const { message } = await codeOf(client.acceptInvitation('inv-1'));
    expect(message).toBe('Failed to accept invitation');
  });
});
