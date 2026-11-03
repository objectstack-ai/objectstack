// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A completed password reset ends the account's other sessions — through the
 * showcase's own HTTP doors, the way a person does it: sign in, ask for a reset
 * by email, open the mail, set the new password through the link's token.
 *
 * The plugin's own pin (`plugin-auth/src/password-reset-ends-sessions.test.ts`)
 * drives the auth manager alone. This one boots the composed showcase, so the
 * session the reset must end is read back by the doors a client really uses:
 * the session door and a data read, both on the bearer lane.
 *
 * Pinned:
 *  - before the reset, the earlier session is served on both doors (so the
 *    refusal below is a change, not a fixture that never authenticated);
 *  - after the reset, the earlier session is refused on both (401 and the
 *    unauthenticated code);
 *  - the control: a fresh sign-in with the new password is served on both.
 *
 * ⛔ No link or token value appears in a test title, an assertion message or a
 * log line.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { context: { isSystem: true } } as const;
const EMAIL = 'reset-ends-sessions@verify.test';
const FIRST = 'Reset!Ends-Sessions-First1';
const SECOND = 'Reset!Ends-Sessions-Second2';
/** The codes a door answers a caller with no session (the anonymous floor's vocabulary). */
const UNAUTHENTICATED_CODES = ['UNAUTHENTICATED', 'AUTH_REQUIRED'];

type Row = Record<string, any>;

describe("a completed password reset ends the account's other sessions (showcase, HTTP doors)", () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /** Status and refusal code of a door read with `token` on the bearer lane. */
  async function door(token: string, path: string): Promise<{ status: number; code: unknown }> {
    const res = await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const code = (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;
    return { status: res.status, code };
  }

  const DOORS = ['/auth/get-session', '/data/showcase_task?$top=1'] as const;

  it('the session signed in before the reset is refused afterwards; a fresh sign-in is served', async () => {
    await stack.signUp(EMAIL, FIRST, 'Reset Ends Sessions');
    const earlier = await stack.signIn(EMAIL, FIRST);
    for (const path of DOORS) {
      const served = await door(earlier, path);
      expect(served.status, `${path} before the reset (code ${String(served.code)})`).toBe(200);
    }

    // Ask for the reset by email, then read the mail the way its recipient
    // does: the newest identity mail to this account carries the link.
    const [user] = (await ql.find('sys_user', { where: { email: EMAIL }, limit: 1, ...SYS })) as Row[];
    const prior = new Set(
      ((await ql.find('sys_identity_email', { where: { related_id: user.id }, limit: 100, ...SYS })) as Row[]).map((r) => r.id),
    );
    const requested = await stack.api('/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, redirectTo: '/reset-password' }),
    });
    expect(requested.status).toBe(200);
    let token = '';
    await vi.waitFor(async () => {
      const mails = (await ql.find('sys_identity_email', { where: { related_id: user.id }, limit: 100, ...SYS })) as Row[];
      const mail = mails.find((r) => !prior.has(r.id));
      token = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(String(mail?.body_text ?? ''))?.[1] ?? '';
      expect(token !== '', 'the reset mail carries a link').toBe(true);
    }, { timeout: 15_000 });

    const reset = await stack.api('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: SECOND }),
    });
    expect(reset.status).toBe(200);

    for (const path of DOORS) {
      const refused = await door(earlier, path);
      expect(refused.status, `${path} with the earlier session (code ${String(refused.code)})`).toBe(401);
      expect(UNAUTHENTICATED_CODES, `${path} with the earlier session`).toContain(refused.code);
    }

    // The control: the account works, with the password just set.
    const fresh = await stack.signIn(EMAIL, SECOND);
    for (const path of DOORS) {
      const served = await door(fresh, path);
      expect(served.status, `${path} with a fresh sign-in (code ${String(served.code)})`).toBe(200);
    }
  }, 300_000);
});
