/**
 * #26473 — `createAuthClient().getInvitationPreview(id)`, the client half of
 * the server's signed-out read `GET {authUrl}/organization/invitation-preview?id=ID`
 * (objectstack `plugin-auth` `invitation-preview.ts`).
 *
 * The server answers `{ success: true, data: { organizationName, inviterName,
 * email } }` for a pending, unexpired invitation (the address masked), and ONE
 * uniform 404 for every other id. The client maps those to the preview and to
 * `null`; every other answer is a failure and rejects, carrying the server's
 * `code` and the HTTP `status`, so a caller can tell "no such invitation" from
 * "the read did not happen". A 404 without the door's `RESOURCE_NOT_FOUND`
 * body — a server without the route — is the second kind (#27509).
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

const AUTH_URL = 'http://localhost/api/v1/auth';

function clientAnswering(status: number, body: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { client: createAuthClient({ baseURL: AUTH_URL, fetchFn }), calls };
}

describe('getInvitationPreview (#26473)', () => {
  it('found: returns exactly the three keys, from one GET keyed by the encoded id', async () => {
    const { client, calls } = clientAnswering(200, {
      success: true,
      data: { organizationName: 'Acme', inviterName: 'Ada', email: 'a***@acme.com' },
    });

    await expect(client.getInvitationPreview('inv 1/x')).resolves.toEqual({
      organizationName: 'Acme',
      inviterName: 'Ada',
      email: 'a***@acme.com',
    });
    expect(calls).toEqual([
      { url: `${AUTH_URL}/organization/invitation-preview?id=inv%201%2Fx`, method: 'GET' },
    ]);
  });

  it('found with no inviter name: keeps the null', async () => {
    const { client } = clientAnswering(200, {
      success: true,
      data: { organizationName: 'Acme', inviterName: null, email: 'a***@acme.com' },
    });

    await expect(client.getInvitationPreview('inv_1')).resolves.toEqual({
      organizationName: 'Acme',
      inviterName: null,
      email: 'a***@acme.com',
    });
  });

  it('the door\'s 404: resolves null — the invitation is no longer valid, which is an answer', async () => {
    const { client } = clientAnswering(404, {
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: 'Invitation not found.' },
    });

    await expect(client.getInvitationPreview('inv_gone')).resolves.toBeNull();
  });

  it('a 404 without the door\'s body (a server without the route) rejects instead of resolving null (#27509)', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404, statusText: 'Not Found' }));
    const client = createAuthClient({ baseURL: AUTH_URL, fetchFn });

    await expect(client.getInvitationPreview('inv_1')).rejects.toMatchObject({ status: 404 });
  });

  it('a 404 carrying another code is not the door\'s answer either (#27509)', async () => {
    const { client } = clientAnswering(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Not found' },
    });

    await expect(client.getInvitationPreview('inv_1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('a failed read rejects with the server code and the status', async () => {
    const { client } = clientAnswering(429, {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many invitation preview requests.' },
    });

    await expect(client.getInvitationPreview('inv_1')).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });

  it('a success body of the wrong shape rejects instead of returning a partial preview', async () => {
    const { client } = clientAnswering(200, { organizationName: 'Acme' });

    await expect(client.getInvitationPreview('inv_1')).rejects.toThrow(/getInvitationPreview/);
  });
});
