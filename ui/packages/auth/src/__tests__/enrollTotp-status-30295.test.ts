/**
 * objectstack#30295 — an enrollment refusal keeps its HTTP `status` and
 * machine `code` through `enrollTotp` / `verifyTotp`.
 *
 * The `/two-factor/*` endpoints are mounted only while two-factor is on for the
 * deployment, so `POST /two-factor/enable` answers 404 there. The client threw
 * `new Error('Two-factor enable failed (404)')`, and the enrollment screen
 * showed that English text: the status was in the message and nowhere else, so
 * the screen had nothing to translate on. This drives the real better-auth
 * client through a mocked `fetch`, as `changePassword-code-27869.test.ts` does.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

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

type Rejection = Error & { code?: string; status?: number };

async function rejectionOf(run: () => Promise<unknown>): Promise<Rejection> {
  return run().then(
    () => {
      throw new Error('expected the call to reject, but it resolved');
    },
    (err: unknown) => err as Rejection,
  );
}

const clientWith = (fetchFn: ReturnType<typeof rejectingFetch>) =>
  createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn: fetchFn as unknown as typeof fetch });

describe('#30295 — enrollment rejections carry the status and the code', () => {
  it('enrollTotp against a deployment with two-factor off rejects with status 404', async () => {
    const client = clientWith(rejectingFetch('/two-factor/enable', 404, {}));
    const rejection = await rejectionOf(() => client.enrollTotp('admin123'));
    expect(rejection.status).toBe(404);
    // The message is unchanged for every other caller.
    expect(rejection.message).toBe('Two-factor enable failed (404)');
  });

  it('enrollTotp keeps a wrong password’s code beside its status', async () => {
    const client = clientWith(
      rejectingFetch('/two-factor/enable', 400, { message: 'Invalid password', code: 'INVALID_PASSWORD' }),
    );
    const rejection = await rejectionOf(() => client.enrollTotp('wrong'));
    expect(rejection.code).toBe('INVALID_PASSWORD');
    expect(rejection.status).toBe(400);
    expect(rejection.message).toBe('Invalid password');
  });

  it('verifyTotp against a deployment with two-factor off rejects with status 404', async () => {
    const client = clientWith(rejectingFetch('/two-factor/verify-totp', 404, {}));
    const rejection = await rejectionOf(() => client.verifyTotp('123456'));
    expect(rejection.status).toBe(404);
    expect(rejection.message).toBe('Two-factor verification failed (404)');
  });
});
