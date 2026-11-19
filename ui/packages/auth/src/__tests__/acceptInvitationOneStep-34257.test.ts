/**
 * #34257 — `createAuthClient().acceptInvitationOneStep(input)`, the client
 * half of objectstack's one-step invitation acceptance
 * (`POST {authUrl}/organization/accept-invitation-one-step`).
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

const AUTH_URL = 'http://localhost/api/v1/auth';

function clientAnswering(status: number, body: unknown) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { client: createAuthClient({ baseURL: AUTH_URL, fetchFn }), calls };
}

describe('acceptInvitationOneStep (#34257)', () => {
  it('posts the input to the one-step door and answers the accepted outcome', async () => {
    const { client, calls } = clientAnswering(200, { success: true, data: { outcome: 'accepted', organizationId: 'org_1' } });
    const input = { invitationId: 'inv_1', proof: 'p1', name: 'Ada', password: 'S3cure!pass' };

    await expect(client.acceptInvitationOneStep(input)).resolves.toEqual({
      outcome: 'accepted',
      organizationId: 'org_1',
    });
    expect(calls).toEqual([
      { url: `${AUTH_URL}/organization/accept-invitation-one-step`, method: 'POST', body: input },
    ]);
  });

  it('answers the sign-in and verify-email outcomes as they are', async () => {
    await expect(
      clientAnswering(200, { success: true, data: { outcome: 'sign_in' } }).client.acceptInvitationOneStep({ invitationId: 'inv_1', proof: 'p' }),
    ).resolves.toEqual({ outcome: 'sign_in' });
    await expect(
      clientAnswering(200, { success: true, data: { outcome: 'verify_email' } }).client.acceptInvitationOneStep({ invitationId: 'inv_1' }),
    ).resolves.toEqual({ outcome: 'verify_email' });
  });

  it('a refusal rejects with the server code and status', async () => {
    const { client } = clientAnswering(400, { code: 'INVALID_TOKEN', message: 'no' });
    await expect(client.acceptInvitationOneStep({ invitationId: 'inv_1', proof: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 400,
    });
  });

  it('an answer outside the outcome vocabulary rejects', async () => {
    const { client } = clientAnswering(200, { success: true, data: { outcome: 'something_else' } });
    await expect(client.acceptInvitationOneStep({ invitationId: 'inv_1', proof: 'p' })).rejects.toThrow(
      /unexpected response body/,
    );
  });
});
