/**
 * objectstack#33650 — the HTTP status survives the client boundary.
 *
 * better-auth 1.7.12's `GET /organization/get-invitation` answers an unknown,
 * used, expired or revoked invitation with a 400 whose body is
 * `{ message: "Invitation not found!" }` and no `code`. The console tells that
 * answer apart by route, status and the missing code (never the English), so
 * the thrown error has to carry the status. This drives the REAL client over a
 * mocked `fetch`, like `org-error-code-4474.test.ts` next door.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

function answering(pathFragment: string, status: number, body: unknown) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new Response(JSON.stringify(url.includes(pathFragment) ? body : {}), {
      status: url.includes(pathFragment) ? status : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { code?: string; status?: number };
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('#33650 — organization rejections carry the HTTP status', () => {
  it('getInvitation: the code-less not-found carries status 400 and no code', async () => {
    const fetchFn = answering('/organization/get-invitation', 400, { message: 'Invitation not found!' });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: fetchFn as unknown as typeof fetch });

    const err = await rejectionOf(client.getInvitation('inv-1'));
    expect(err.status).toBe(400);
    expect(err.code).toBeUndefined();
    // MUST NOT CHANGE: the message is what it was before.
    expect(err.message).toBe('Invitation not found!');
  });

  it('inviteMember: a coded refusal carries its status beside the code', async () => {
    const fetchFn = answering('/organization/invite-member', 400, {
      code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
      message: 'User is already a member of this organization',
    });
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: fetchFn as unknown as typeof fetch });

    const err = await rejectionOf(client.inviteMember({ organizationId: 'org-1', email: 'p@x.test', role: 'member' }));
    expect(err.code).toBe('USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION');
    expect(err.status).toBe(400);
  });
});
