/**
 * objectstack#36987 — `AuthClient.updateUser` declares what it returns.
 *
 * better-auth's `POST /update-user` answers the receipt `{ status: true }`
 * (`better-auth/dist/api/routes/update-user.mjs`), never the user. The
 * published `AuthClient` used to declare `Promise<AuthUser>` and the client
 * cast the receipt to that type, so a caller that trusted it read a "user"
 * with no `id`, `name` or `email` (objectstack#36972 was the in-repo case).
 *
 * The declaration is now `Promise<void>`, the same as `AuthContext.updateUser`
 * and the client's other writes, and the call resolves with nothing. The type
 * leg is erased at runtime: `tsc -p tsconfig.test.json` (the package's
 * `type-check`) is what holds it.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';
import type { AuthClient } from '../types';

describe('updateUser declares and returns nothing (objectstack#36987)', () => {
  it('declares Promise<void> on the published AuthClient', () => {
    expectTypeOf<ReturnType<AuthClient['updateUser']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<ReturnType<typeof createAuthClient>['updateUser']>>().toEqualTypeOf<
      Promise<void>
    >();
  });

  it('resolves with undefined on better-auth\'s receipt instead of passing it on', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = createAuthClient({ baseURL: 'http://localhost/api/auth', fetchFn });

    const answer: unknown = await client.updateUser({ name: 'Grace' });

    expect(answer).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
