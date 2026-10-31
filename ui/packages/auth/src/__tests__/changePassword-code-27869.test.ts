/**
 * objectstack#27869 — a wrong current password keeps its machine `code`
 * through `changePassword`.
 *
 * The console's ChangePasswordForm maps `INVALID_PASSWORD` to a translated
 * sentence, and its test mocks `useAuth` with a coded error, so it is blind to
 * this boundary. `changePassword` used to throw `new Error(error.message)`,
 * which dropped the code: the mapping never fired and a French user still read
 * better-auth's English "Invalid password". This drives the real better-auth
 * client through a mocked `fetch`, as `org-error-code-4474.test.ts` does, and
 * asserts on `.code`, because `.message` was already right before the fix.
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

describe('#27869 — changePassword rejections carry the machine code', () => {
  it('a wrong current password rejects with code INVALID_PASSWORD', async () => {
    // better-auth's /change-password refuses a wrong current password with
    // APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_PASSWORD).
    const fetchFn = rejectingFetch('/change-password', 400, {
      message: 'Invalid password',
      code: 'INVALID_PASSWORD',
    });
    const client = createAuthClient({
      baseURL: 'http://localhost/api/auth',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const rejection = await client.changePassword('wrong-temp', 'N3w-password!').then(
      () => {
        throw new Error('expected the call to reject, but it resolved');
      },
      (err: unknown) => err as Error & { code?: string },
    );

    expect(rejection.code).toBe('INVALID_PASSWORD');
    // The message is unchanged: this keeps the code, it rewords nothing.
    expect(rejection.message).toBe('Invalid password');
  });
});
