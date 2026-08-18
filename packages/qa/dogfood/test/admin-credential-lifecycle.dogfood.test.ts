// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// C1 + C2 of `identity-auth.admin-lifecycle-operations` (#9482) — the two admin
// credential operations a platform admin can actually drive on this stack, both
// sides, with the stored state read back.
//
//   C2  admin create-user mints a LOGIN-CAPABLE account, and an EXPLICIT
//       password WINS over `generatePassword: true` (#3031/#3033).
//   C1  admin set-user-password ROTATES the credential: the new password signs
//       in and the old one is refused.
//
// ── Why only these two, when the item has ten clauses ────────────────────────
//
// `/admin/create-user` and `/admin/set-user-password` are ObjectStack mounts:
// `auth-plugin.ts` registers them on the raw Hono app ahead of better-auth's
// catch-all, and they run the ADR-0068 platform-admin gate
// (`isPlatformAdmin` / `positions[]` / legacy `role`). They are therefore the
// admin lifecycle operations a real platform admin can complete.
//
// The item's other API clauses — ban/unban (C0), set-role (C3),
// revoke-user-sessions (C4), remove-user's owner_id cascade (C5) and
// impersonation attribution (C6) — ride better-auth's OWN admin endpoints,
// which authorize on the legacy `user.role === 'admin'` scalar that ADR-0068 D2
// deliberately stopped synthesizing. Measured on this stack: the seeded dev
// admin carries `sys_user.role = 'user'` with `positions =
// ['user','platform_admin']`, and every one of those routes answers the
// PLATFORM ADMIN `403 YOU_ARE_NOT_ALLOWED_TO_*`. Confirmed by construction:
// writing `role = 'admin'` onto that same admin row flips ban-user, unban-user,
// list-users and impersonate-user to 200 in the same boot. Those clauses are
// therefore not automatable without a product decision, and #9482's report
// carries it rather than this file pretending. `admin-user-endpoints.ts` states
// the same mechanism as the reason the two routes below exist as ObjectStack
// mounts at all.
//
// ── Both sides, on the same route and fixture ───────────────────────────────
//
// A credential suite that only proved "the old password stops working" would
// stay green if NOTHING signed in — the account locked, the credential row
// dropped, the whole sign-in path broken. So every refusal below is paired with
// the positive on the SAME account: the new password signs in, and the refused
// admin call is followed by a read proving the stored credential did not move.
//
// ── The fixture is authored at runtime ──────────────────────────────────────
//
// The stock showcase seeds no disposable second member with a known password
// (#9308 is the open card for stock fixtures). Each account below is created
// through the real routes inside this test's own stack; the showcase's
// committed metadata is untouched.
//
// @proof: admin-credential-lifecycle

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true };

interface Ql {
  find(object: string, query: unknown, ctx: unknown): Promise<unknown>;
}

const rowsOf = (r: unknown): Array<Record<string, unknown>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, unknown>> })?.records ?? []);

describe('#9482 C1/C2: admin credential lifecycle, both sides', () => {
  let stack: VerifyStack;
  let ql: Ql;
  let adminToken: string;
  let memberToken: string;
  let priorScim: string | undefined;

  /** Sign in through the real route, returning status + parsed body. */
  async function signIn(email: string, password: string) {
    const res = await stack.api('/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON body — kept in `text` for the failure message */
    }
    return { status: res.status, body: text.slice(0, 300), json: parsed };
  }

  async function userRow(email: string): Promise<Record<string, unknown> | undefined> {
    const rows = rowsOf(await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS }));
    return rows[0];
  }

  /** The credential `sys_account` rows that make an account able to sign in. */
  async function credentialAccounts(userId: string): Promise<Array<Record<string, unknown>>> {
    const rows = rowsOf(await ql.find('sys_account', { where: {}, limit: 500 }, { context: SYS }));
    return rows.filter((a) => String(a.user_id ?? a.userId) === String(userId));
  }

  beforeAll(async () => {
    // `/admin/` 501s unless better-auth's admin plugin is on, and `bootStack`
    // exposes no auth-plugin override. `OS_SCIM_ENABLED` is the one env knob
    // that reaches it — `buildPluginList` resolves `admin: pluginConfig.admin ??
    // scimEffective` (ADR-0071). Read at auth-manager construction, so it must
    // precede boot. Same derivation `admin-identity-audit-trail` uses.
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    memberToken = await stack.signUp('credlife.member@example.com', 'Member-Pass-123');
    ql = await stack.kernel.getServiceAsync<Ql>('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  // ── C2 ────────────────────────────────────────────────────────────────

  it('create-user with BOTH an explicit password and generatePassword:true applies the EXPLICIT one', async () => {
    const email = 'credlife.explicit@example.com';
    const explicit = 'Explicit-Wins-123';

    // The console dialog sends both: `generatePassword` defaults true and the
    // input is labelled "leave empty to generate". #3031/#3033 is the defect
    // where the generated one was applied anyway.
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      name: 'Explicit Password User',
      password: explicit,
      generatePassword: true,
    });
    const body = await res.text();
    expect(res.status, `create-user: ${body}`).toBe(200);

    // The generated password is never returned for an EXPLICIT request — if it
    // were, that is the tell that one was minted and applied.
    const created = JSON.parse(body) as { data?: { user?: { id?: string }; password?: string; temporaryPassword?: string } };
    expect(
      created.data?.password ?? created.data?.temporaryPassword,
      'an explicit-password create returned a generated password — the generated one was minted',
    ).toBeUndefined();

    const userId = String(created.data?.user?.id);
    expect(userId, 'create-user returned no user id').toBeTruthy();

    // Login-capable: the credential `sys_account` row exists. A `sys_user`
    // without it is exactly the un-signin-able account the ObjectStack mount
    // exists to prevent.
    const accounts = await credentialAccounts(userId);
    expect(
      accounts.map((a) => a.provider_id ?? a.providerId),
      `no credential account row for the created user: ${JSON.stringify(accounts)}`,
    ).toContain('credential');

    // The EXPLICIT password signs in — the clause's positive half.
    const ok = await signIn(email, explicit);
    expect(ok.status, `explicit password should sign in: ${ok.body}`).toBe(200);
    expect(ok.json.token, 'a successful sign-in carries a token').toBeTruthy();
  }, 300_000);

  it('a generated-password create is the contrast: the returned password is the one that works', async () => {
    // The control for the case above. Without it, "the explicit password signs
    // in" is consistent with `generatePassword` being inert altogether, and the
    // #3031 clause would be pinned by an assertion that cannot tell the two
    // apart.
    const email = 'credlife.generated@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      name: 'Generated Password User',
      generatePassword: true,
    });
    const body = await res.text();
    expect(res.status, `create-user (generated): ${body}`).toBe(200);

    const parsed = JSON.parse(body) as { data?: { password?: string; temporaryPassword?: string } };
    const generated = parsed.data?.password ?? parsed.data?.temporaryPassword;
    expect(
      generated,
      `a generatePassword-only create must surface the temporary password once: ${body}`,
    ).toBeTruthy();

    const ok = await signIn(email, String(generated));
    expect(ok.status, `the generated password should sign in: ${ok.body}`).toBe(200);
  }, 300_000);

  // ── C1 ────────────────────────────────────────────────────────────────

  it('set-user-password rotates the credential: the new password signs in, the old is refused', async () => {
    const email = 'credlife.rotate@example.com';
    const original = 'Original-Pass-123';
    const rotated = 'Rotated-Pass-456';

    const create = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      name: 'Rotation Target',
      password: original,
    });
    expect(create.status, `create-user: ${await create.clone().text()}`).toBe(200);
    const userId = String(((await create.json()) as { data?: { user?: { id?: string } } }).data?.user?.id);

    // Baseline: the original password works BEFORE the rotation. Without this
    // the "old password is refused" assertion below cannot distinguish a
    // rotation from a password that never worked.
    const before = await signIn(email, original);
    expect(before.status, `the original password should work before rotation: ${before.body}`).toBe(200);

    const rotate = await stack.apiAs(adminToken, 'POST', '/auth/admin/set-user-password', {
      userId,
      newPassword: rotated,
    });
    const rotateBody = await rotate.text();
    expect(rotate.status, `set-user-password: ${rotateBody}`).toBe(200);

    // Both halves of the rotation, on the same account.
    const withNew = await signIn(email, rotated);
    expect(withNew.status, `the NEW password should sign in: ${withNew.body}`).toBe(200);

    const withOld = await signIn(email, original);
    expect(withOld.status, `the OLD password must be refused: ${withOld.body}`).toBe(401);
    expect(withOld.json.code, 'the old password is refused with the named credential error').toBe(
      'INVALID_EMAIL_OR_PASSWORD',
    );
  }, 300_000);

  // ── the gate on both routes, with the state read back ─────────────────

  it('a non-admin cannot create a user or rotate a password, and neither leaves a trace', async () => {
    const forgedEmail = 'credlife.forged@example.com';

    // create-user, forged.
    const forgedCreate = await stack.apiAs(memberToken, 'POST', '/auth/admin/create-user', {
      email: forgedEmail,
      name: 'Should Not Exist',
      password: 'Forged-Pass-123',
    });
    const forgedCreateBody = await forgedCreate.text();
    expect(forgedCreate.status, `member create-user: ${forgedCreateBody}`).toBe(403);
    expect(JSON.parse(forgedCreateBody)?.error?.code).toBe('PERMISSION_DENIED');
    // State oracle: the refusal left no user behind.
    expect(
      await userRow(forgedEmail),
      'a refused create-user still created the account',
    ).toBeUndefined();

    // set-user-password, forged against a real account whose password we know.
    const victimEmail = 'credlife.victim@example.com';
    const victimPass = 'Victim-Pass-123';
    const create = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email: victimEmail,
      name: 'Rotation Victim',
      password: victimPass,
    });
    expect(create.status, `create-user: ${await create.clone().text()}`).toBe(200);
    const victimId = String(((await create.json()) as { data?: { user?: { id?: string } } }).data?.user?.id);

    const forgedRotate = await stack.apiAs(memberToken, 'POST', '/auth/admin/set-user-password', {
      userId: victimId,
      newPassword: 'Hijacked-Pass-789',
    });
    const forgedRotateBody = await forgedRotate.text();
    expect(forgedRotate.status, `member set-user-password: ${forgedRotateBody}`).toBe(403);
    expect(JSON.parse(forgedRotateBody)?.error?.code).toBe('PERMISSION_DENIED');

    // State oracle, both directions: the hijack password does NOT work and the
    // victim's real password still does. A refusal that had quietly rotated the
    // credential would pass a status-only assertion.
    const hijack = await signIn(victimEmail, 'Hijacked-Pass-789');
    expect(hijack.status, `the forged rotation took effect: ${hijack.body}`).toBe(401);
    const intact = await signIn(victimEmail, victimPass);
    expect(intact.status, `the victim's real password stopped working: ${intact.body}`).toBe(200);
  }, 300_000);

  it('an anonymous caller is refused both routes before any state is touched', async () => {
    const email = 'credlife.anon@example.com';
    const res = await stack.api('/auth/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Anon Created', password: 'Anon-Pass-123' }),
    });
    const body = await res.text();
    expect(res.status, `anonymous create-user: ${body}`).toBe(401);
    expect(JSON.parse(body)?.error?.code).toBe('UNAUTHENTICATED');
    expect(await userRow(email), 'an anonymous create-user still created the account').toBeUndefined();
  }, 300_000);
});
