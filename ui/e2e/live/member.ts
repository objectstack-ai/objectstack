import { request, expect, type APIRequestContext } from '@playwright/test';

/**
 * A second, non-admin identity for the live suite (objectstack#27552).
 *
 * The global setup signs in as the seeded admin only, and the admin passes
 * every access check, so no spec signed in that way can see a Console⇄server
 * access defect. This module makes a member who holds ONE of the showcase's own
 * permission sets (plus the `everyone` baseline the dev server adds), signs it
 * in, and hands back a storageState a spec opens a browser context with.
 *
 * Why the admin creates the member rather than the member signing up: the dev
 * server's audience posture is `invite_only`, so `POST /auth/sign-up/email`
 * answers 403 `SELF_REGISTRATION_CLOSED` (measured on `objectstack dev --fresh`).
 * `POST /auth/admin/create-user` takes a password and the permission set to
 * grant in one call, which is the Setup "New user" door.
 *
 * One member per permission set, at a fixed address, so a re-run against a
 * long-lived backend signs the same member in again instead of piling up
 * users: an "already exists" answer is accepted. Whether that member really
 * holds the set is not taken on trust here; a spec states the access it relies
 * on through the server first (read answered, write refused), so a member
 * created some other way fails there, by name.
 *
 * The storageState has the same two halves `global-setup.ts` writes for the
 * admin: the better-auth cookie for the API origin and the Bearer token the
 * console adapter reads from the APP origin's localStorage. It is returned,
 * never written to disk, so no path has to be rooted.
 */
const APP = process.env.LIVE_APP_URL || 'http://localhost:5180';
const API = process.env.LIVE_API_URL || 'http://localhost:3000';
const MEMBER_PASSWORD = 'live-e2e-member-1';

export type MemberStorageState = {
  cookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
};

export interface LiveMember {
  email: string;
  /** The Bearer token the member's own API calls send. */
  token: string;
  /** Open a browser context with this to act as the member. */
  storageState: MemberStorageState;
}

/**
 * Create (or reuse) the member holding `permissionSet` and sign it in.
 * `admin` is a request context signed in as an administrator: a spec's
 * `request` fixture, which carries the global setup's admin cookie.
 */
export async function signInMember(admin: APIRequestContext, permissionSet: string): Promise<LiveMember> {
  const email = `live-e2e.${permissionSet}@objectos.ai`;
  const created = await admin.post(`${API}/api/v1/auth/admin/create-user`, {
    data: {
      email,
      password: MEMBER_PASSWORD,
      name: `Live E2E ${permissionSet}`,
      mustChangePassword: false,
      permissionSet,
    },
  });
  if (!created.ok()) {
    const body = await created.json().catch(() => ({}));
    expect(
      body?.error?.code,
      `create-user for ${email} answered ${created.status()}: ${JSON.stringify(body)}`,
    ).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
  }

  const ctx = await request.newContext();
  try {
    const res = await ctx.post(`${API}/api/v1/auth/sign-in/email`, {
      data: { email, password: MEMBER_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok(), `member sign-in for ${email} answered ${res.status()}`).toBe(true);
    const token = res.headers()['set-auth-token'];
    expect(token, 'member sign-in returned a `set-auth-token` header').toBeTruthy();
    const { cookies } = await ctx.storageState();
    return {
      email,
      token,
      storageState: {
        cookies,
        origins: [{ origin: APP, localStorage: [{ name: 'auth-session-token', value: token }] }],
      },
    };
  } finally {
    await ctx.dispose();
  }
}
