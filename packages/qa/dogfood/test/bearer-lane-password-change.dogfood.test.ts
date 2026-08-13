// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8049] `/auth/change-password` must behave IDENTICALLY on every transport.
 *
 * ## The defect this pins
 *
 * An admin-provisioned user (`mustChangePassword` defaults to true) is gated out
 * of every protected route with `403 PASSWORD_EXPIRED` until they rotate their
 * password. On the COOKIE lane the escape hatch worked. On the BEARER lane —
 * the documented API/agent/CLI lane — `/auth/change-password` answered **200**,
 * the password really rotated, and nothing else happened: `must_change_password`
 * stayed `true`, `password_changed_at` stayed `null`, and the caller stayed
 * locked out of every protected route by a success response.
 *
 * Measured on `origin/main` before the fix, all three of these were true at once
 * on the bearer lane and false on the cookie lane — which is the whole point:
 *
 *   must_change_password  true      password_changed_at  null
 *   protected read        403       previous_password_hashes  null
 *   reusing the previous password   ACCEPTED (200)
 *
 * ## Why it is `security`, not just a lockout
 *
 * That last line is the half that is easy to under-fix. ONE stash —
 * `ctx.context.__osPwChangeUserId`, set by the before-hook when it resolves the
 * acting user — gates all three behaviours: the `password_changed_at` /
 * `must_change_password` stamp, ADR-0069 D1's password-reuse REJECTION, and the
 * history append. Unresolved principal ⇒ none of them run. So the bearer lane
 * did not merely stay flagged; password history was **neither checked nor
 * recorded** there. A control enforced on one transport and silently absent on
 * the other is worse than one absent on both, because the console and every
 * pre-existing pin exercise the working lane.
 *
 * Hence this file asserts the SAME post-conditions on every lane rather than
 * asserting the bug's absence on one. A fix that cleared the flags but left the
 * reuse control transport-dependent passes a lockout test and fails this one.
 *
 * ## Root cause, for whoever changes the resolver next
 *
 * better-auth's `getHooks` (`api/dispatch.mjs`) pushes `options.hooks.before`
 * — the auth manager's global before-hook — ahead of every PLUGIN before-hook,
 * and `bearer()`'s before-hook is what rewrites `Authorization: Bearer` into a
 * session cookie. A bare `getSessionFromCtx(ctx)` in our hook therefore reads a
 * cookie that does not exist yet on the bearer lane and resolves null, while
 * better-auth's own password write — which runs after the conversion — succeeds.
 * That is the 200-with-nothing-stamped. The resolver now goes through the shared
 * hook-order-independent `resolveActor`, which falls back to explicit token
 * lookup.
 *
 * ## Why BOTH bearer spellings are driven
 *
 * `bearer()` hands clients the SIGNED `<token>.<sig>` in the `set-auth-token`
 * response header (this is what the issue's reproduction used) and accepts both
 * that and the raw `token` from the sign-in body. `sys_session.token` stores the
 * UNSIGNED value. A resolver that looked the credential up verbatim would work
 * for one spelling and silently resolve nothing for the other — the same
 * per-transport asymmetry one level down. Driving both is what keeps that
 * closed; drop the signed lane and half the fix can be reverted invisibly.
 *
 * Harness notes:
 *  - `/auth/admin/create-user` 501s unless better-auth's `admin` plugin is on,
 *    and `bootStack` exposes no auth-plugin override. `OS_SCIM_ENABLED` is the
 *    one env knob that reaches it (`buildPluginList` resolves
 *    `admin: pluginConfig.admin ?? scimEffective`), so it must precede
 *    `bootStack` — same shape as `admin-identity-audit-trail.dogfood.test.ts`.
 *  - `passwordHistoryCount` is 0 (off) by default, which would make every reuse
 *    assertion below vacuously green. It is set through `applyConfigPatch`, the
 *    same seam the settings service writes, so the reuse control is genuinely
 *    armed for all lanes.
 *  - Two different error envelopes are asserted, deliberately and distinctly:
 *    the gate refusal is the ADR-0112 REST envelope (`{error:{code}}`, 403)
 *    raised at the transport seam, while the reuse refusal is better-auth's own
 *    `APIError` (`{code}`, 400) surfaced through the proxied `/auth/*` route.
 *    They are different outcomes and a test that conflated them could not tell
 *    "reuse rejected" from "still locked out".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { assertArmed, authSettingArmed } from './armed.js';

const SYS = { context: { isSystem: true } };

/** Depth of the ADR-0069 D1 history ring this file arms. */
const HISTORY_COUNT = 3;

const FIRST_PASSWORD = 'BearerLane!First1';
const SECOND_PASSWORD = 'BearerLane!Second2';

/** Collect a response's Set-Cookie values into a single request Cookie header. */
function cookieHeader(res: Response): string {
  const jar = res.headers.getSetCookie?.() ?? [];
  return jar.map((c) => c.split(';')[0]).join('; ');
}

/**
 * One authenticated transport. `credential` is whatever the lane carries after
 * a sign-in; `headers` turns it into the request headers that lane would send.
 */
interface Lane {
  readonly name: string;
  /** Pick this lane's credential out of a sign-in response. */
  credential(res: Response, body: { token?: string }): string;
  /** The auth headers a request on this lane carries. */
  headers(credential: string): Record<string, string>;
}

const LANES: Lane[] = [
  {
    name: 'cookie',
    credential: (res) => cookieHeader(res),
    headers: (c) => ({ Cookie: c }),
  },
  {
    // The credential the issue's reproduction used: the `set-auth-token`
    // response header, which carries the SIGNED `<token>.<sig>` form.
    name: 'bearer (signed set-auth-token)',
    credential: (res) => res.headers.get('set-auth-token') ?? '',
    headers: (c) => ({ Authorization: `Bearer ${c}` }),
  },
  {
    // The other accepted spelling: the raw session token from the sign-in body.
    name: 'bearer (raw sign-in token)',
    credential: (_res, body) => body.token ?? '',
    headers: (c) => ({ Authorization: `Bearer ${c}` }),
  },
];

describe('#8049: /auth/change-password clears the force-change flag and enforces reuse on EVERY transport', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack, {});
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // Arm ADR-0069 D1's history ring. Default is 0 (off), under which every
    // reuse assertion in this file would pass without testing anything.
    const auth = await stack.kernel.getServiceAsync<any>('auth');
    auth.applyConfigPatch({ passwordHistoryCount: HISTORY_COUNT });

    // [#8074] …and READ IT BACK. Patching and trusting the patch is the same
    // bet the org-less fixture of #8023 lost: if this key is ever renamed,
    // clamped or dropped, `applyConfigPatch` still returns quietly and every
    // reuse assertion below silently returns to the vacuous state the header
    // warns about. From `beforeAll`, so a disarm leaves no green cells.
    await assertArmed([
      authSettingArmed({
        stack,
        setting: 'passwordHistoryCount',
        armed: (v) => Number(v) >= 1,
        control: "ADR-0069 D1's password-reuse rejection (and its history append)",
        disarmedBy:
          '`passwordHistoryCount` defaults to 0 (off): nothing is recorded, so "a reused ' +
          'password is refused" has nothing to reject against and certifies a control that ' +
          'was never exercised. Arm it through `applyConfigPatch`.',
      }),
    ]);

    adminToken = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  /** Sign in through the real route and hand back every lane's credential. */
  async function signIn(email: string, password: string) {
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = res.status === 200 ? ((await res.clone().json()) as { token?: string }) : {};
    return { res, body };
  }

  /** The `sys_user` row + its credential account, read with system context. */
  async function identity(email: string) {
    const user = (await ql.find('sys_user', { where: { email }, limit: 1 }, SYS))[0];
    const account = (
      await ql.find(
        'sys_account',
        { where: { user_id: String(user?.id), provider_id: 'credential' }, limit: 1 },
        SYS,
      )
    )[0];
    const raw = account?.previous_password_hashes;
    let history: string[] = [];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        throw new Error(`previous_password_hashes is not JSON: ${raw}`);
      }
    }
    return { user, history };
  }

  for (const lane of LANES) {
    // eslint-disable-next-line vitest/valid-title
    describe(`lane: ${lane.name}`, () => {
      // One provisioned user per lane — the flags are per-user, so sharing one
      // would let an earlier lane's successful change satisfy a later lane's
      // assertions and hide exactly the asymmetry this file exists to catch.
      const email = `bearer.lane.8049.${lane.name.replace(/[^a-z]/gi, '').toLowerCase()}@example.com`;
      let credential = '';

      it('an admin-provisioned user is gated out with 403 PASSWORD_EXPIRED', async () => {
        const created = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
          email,
          name: `Bearer Lane ${lane.name}`,
          password: FIRST_PASSWORD,
        });
        expect(created.status, await created.clone().text()).toBe(200);
        expect((await created.json()).data.mustChangePassword).toBe(true);

        const { res, body } = await signIn(email, FIRST_PASSWORD);
        expect(res.status, await res.clone().text()).toBe(200);
        credential = lane.credential(res, body);
        expect(credential, `${lane.name}: sign-in yielded no credential`).toBeTruthy();

        const read = await stack.api('/data/showcase_task?$top=1', { headers: lane.headers(credential) });
        // The gate refusal — asserted as code AND status, and distinctly from
        // the reuse refusal below (different envelope, different outcome).
        expect(read.status).toBe(403);
        expect((await read.json())?.error?.code).toBe('PASSWORD_EXPIRED');
      }, 120_000);

      it('POST /auth/change-password rotates the password AND clears the force-change flag', async () => {
        const changed = await stack.api('/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...lane.headers(credential) },
          body: JSON.stringify({ currentPassword: FIRST_PASSWORD, newPassword: SECOND_PASSWORD }),
        });
        expect(changed.status, await changed.clone().text()).toBe(200);

        // The rotation itself was never the broken half — it landed on every
        // lane, which is why the defect answered 200 and looked fine.
        const stale = await signIn(email, FIRST_PASSWORD);
        expect(stale.res.status).toBe(401);
        expect((await stale.res.json())?.code).toBe('INVALID_EMAIL_OR_PASSWORD');

        // …and the half that did NOT run on the bearer lane.
        const { user } = await identity(email);
        expect(user.must_change_password, `${lane.name}: must_change_password not cleared`).toBe(false);
        expect(user.password_changed_at, `${lane.name}: password_changed_at not stamped`).toBeTruthy();
        expect(Number.isFinite(new Date(user.password_changed_at as string).getTime())).toBe(true);
      }, 120_000);

      it('the caller can then reach protected routes with a fresh session', async () => {
        const { res, body } = await signIn(email, SECOND_PASSWORD);
        expect(res.status, await res.clone().text()).toBe(200);
        credential = lane.credential(res, body);

        const read = await stack.api('/data/showcase_task?$top=1', { headers: lane.headers(credential) });
        expect(read.status, await read.clone().text()).toBe(200);
      }, 120_000);

      it('ADR-0069 D1: the change RECORDED history and a reused password is REJECTED', async () => {
        // Recorded — the old hash landed in the bounded ring. On the unfixed
        // bearer lane this column stayed null, so a fixture that only checked
        // the flags would have called the security half fixed.
        const { history } = await identity(email);
        expect(history, `${lane.name}: no password history recorded`).toHaveLength(1);

        // …and checked. Reusing the password that was just rotated away must be
        // refused — code AND status, distinct from the 403 gate refusal above.
        const reuse = await stack.api('/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...lane.headers(credential) },
          body: JSON.stringify({ currentPassword: SECOND_PASSWORD, newPassword: FIRST_PASSWORD }),
        });
        expect(reuse.status, await reuse.clone().text()).toBe(400);
        const refusal = await reuse.json();
        expect(refusal?.code).toBe('PASSWORD_REUSE');
        expect(String(refusal?.message)).toContain(`last ${HISTORY_COUNT} passwords`);

        // The refusal must not have rotated anything: the ring is unchanged and
        // the current password still signs in.
        expect((await identity(email)).history).toHaveLength(1);
        const still = await signIn(email, SECOND_PASSWORD);
        expect(still.res.status).toBe(200);
      }, 120_000);
    });
  }
});
