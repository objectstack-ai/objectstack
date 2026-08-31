// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10776 — the break-glass last-local-credential guard must run AFTER identity
// is established, not before it.
//
// The guard is registered as a better-auth `hooks.before` keyed on `ctx.path`.
// A `before` hook runs ahead of the endpoint's own `use: [adminMiddleware]`,
// which is the only layer that establishes identity on that lane. The guard
// therefore decided — and answered — a per-record question for a caller nobody
// had authenticated. Maintainer ruling 2026-08-22 (decision-inbox digest,
// accepted verbatim 「接受所有」): **Option A, authentication before the
// guard**, so an unauthenticated caller hears only the ordinary refusal that
// every other route on this lane gives. Option B (keep the guard early and
// disguise its answer) was the fallback and is not taken; option C (accept the
// disclosure) is not taken.
//
// ── Why this file drives the REAL seam ──────────────────────────────────────
//
// `break-glass-local-credential.test.ts` drives the before-hook directly with a
// synthetic `ctx`. That is the right shape for the guard's own predicate, and
// it is structurally blind to the defect this file pins: hook ORDER relative to
// endpoint middleware does not exist in a synthetic call. So every assertion
// here goes through `AuthManager.handleRequest` on the then-installed better-auth
// 1.7.1, where the vendor's own middleware really runs, and reads a status and
// a code off a real `Response`.
//
// ── The load-bearing half ───────────────────────────────────────────────────
//
// ⛔ An implementation that simply DELETED the guard would satisfy every
// disclosure assertion below while destroying the protection the guard exists
// for. Two describe-blocks exist to make that impossible to pass vacuously:
// the still-refused leg (an AUTHENTICATED admin removing the genuine last
// local credential still gets 409 `LAST_LOCAL_CREDENTIAL`) and the admission
// leg (the same admin removing an ordinary user still succeeds, so the
// still-refused leg cannot be satisfied by refusing everyone).
//
// ADR-0112 is `code` AND `status`; every refusal assertion below carries both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { LAST_LOCAL_CREDENTIAL_CODE } from './last-local-credential';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10776';
const BASE = 'http://localhost:3000/api/v1/auth';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { admin: true },
  } as any);

const post = (manager: AuthManager, path: string, body: unknown, bearer?: string) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/** Status + whatever error code the body carries, in either envelope shape. */
async function verdict(res: Response): Promise<{ status: number; code?: string; text: string }> {
  const text = await res.text();
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    // ObjectStack's ADR-0112 envelope nests it; better-auth's flat shape does not.
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON body → no code */
  }
  return { status: res.status, code, text };
}

/**
 * One deployment, staged to the exact posture the guard exists to protect:
 *
 *  - `owner` holds the ONLY local-password (`credential`) account — the
 *    break-glass escape hatch itself.
 *  - `admin` is an IdP-managed platform admin holding NO local credential
 *    (their credential row is removed after they sign in, which is what
 *    enforced SSO looks like: a managed team with a live session and no
 *    password). Their session keeps working, so they can act as the
 *    authenticated caller.
 *  - `ordinary` is a second credential-less managed user — the removable one,
 *    so the admission direction is testable on the same fixture.
 *
 * `/admin/remove-user` is better-auth's own endpoint and still authorizes on
 * the legacy `role` scalar (only `/admin/impersonate-user` was re-pointed at
 * ObjectStack's predicate, see `auth-manager.ts`), so the scalar is what is
 * set here.
 */
async function seedDeployment() {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  for (const [email, name] of [
    ['owner.10776@example.com', 'Break Glass Owner'],
    ['admin.10776@example.com', 'Managed Admin'],
    ['ordinary.10776@example.com', 'Ordinary User'],
  ]) {
    // [#11739] default posture invite_only: users beyond the first enter
    // through the invitation carve-out (see audience-gate-test-support).
    inviteForAudienceGate(engine, email);
    const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = (engine.tables.get('sys_user') ?? []) as any[];
  const idFor = (email: string) => String(users.find((r) => r.email === email)!.id);
  const ownerId = idFor('owner.10776@example.com');
  const adminId = idFor('admin.10776@example.com');
  const ordinaryId = idFor('ordinary.10776@example.com');

  // The vendor `/admin/` lane's own authorization scalar.
  users.find((r) => String(r.id) === adminId)!.role = 'admin';

  const signIn = await post(manager, '/sign-in/email', {
    email: 'admin.10776@example.com',
    password: PASSWORD,
  });
  const bearer = signIn.headers.get('set-auth-token');
  expect(bearer, 'sign-in must mint a bearer or the authenticated legs prove nothing').toBeTruthy();

  const ownerSignIn = await post(manager, '/sign-in/email', {
    email: 'owner.10776@example.com',
    password: PASSWORD,
  });
  const ownerBearer = ownerSignIn.headers.get('set-auth-token');
  expect(ownerBearer, 'the self-service leg needs the owner signed in').toBeTruthy();

  // Strip the local password from everyone except `owner`, leaving exactly one
  // credential holder. This is the state the guard guards.
  const accounts = (engine.tables.get('sys_account') ?? []) as any[];
  engine.tables.set(
    'sys_account',
    accounts.filter(
      (r) => !(r.provider_id === 'credential' && String(r.user_id ?? '') !== ownerId),
    ),
  );
  const remaining = (engine.tables.get('sys_account') ?? []).filter(
    (r: any) => r.provider_id === 'credential',
  );
  expect(
    remaining.map((r: any) => String(r.user_id)),
    'fixture invariant: `owner` must be the SOLE local-credential holder',
  ).toEqual([ownerId]);

  return { engine, manager, ownerId, adminId, ordinaryId, bearer: bearer!, ownerBearer: ownerBearer! };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// The disclosure: an unauthenticated caller learns nothing per-record
// ───────────────────────────────────────────────────────────────────────────

describe('#10776 — an anonymous caller gets the ordinary refusal, never a per-record answer', () => {
  it('arm 1: naming the break-glass holder answers 401 UNAUTHENTICATED, not the guard‘s 409', async () => {
    const { manager, ownerId } = await seedDeployment();

    const v = await verdict(await post(manager, '/admin/remove-user', { userId: ownerId }));

    // Status AND code (ADR-0112). The status alone was the whole defect: a 409
    // where every sibling route answers 401 IS the per-record answer.
    expect(v.status, v.text).toBe(401);
    expect(v.code, v.text).toBe('UNAUTHENTICATED');
    expect(v.code, 'the guard‘s code must not reach an unauthenticated caller').not.toBe(
      LAST_LOCAL_CREDENTIAL_CODE,
    );
    expect(v.status, 'the guard‘s status must not reach an unauthenticated caller').not.toBe(409);
  }, 60_000);

  it('arm 2: naming an ordinary user answers 401 UNAUTHENTICATED — measured, not read off the source', async () => {
    // The card filed this arm as an unmeasured reading. It is measured here so
    // the before/after is a real comparison: if this arm did NOT already land
    // on 401, the disclosure would be wider than the card states.
    const { manager, ordinaryId } = await seedDeployment();

    const v = await verdict(await post(manager, '/admin/remove-user', { userId: ordinaryId }));

    expect(v.status, v.text).toBe(401);
    expect(v.code, v.text).toBe('UNAUTHENTICATED');
  }, 60_000);

  it('arm 2b: a userId nobody holds answers the same 401 — no existence oracle either', async () => {
    const { manager } = await seedDeployment();

    const v = await verdict(await post(manager, '/admin/remove-user', { userId: 'usr_no_such_user' }));

    expect(v.status, v.text).toBe(401);
    expect(v.code, v.text).toBe('UNAUTHENTICATED');
  }, 60_000);

  it('the two arms are INDISTINGUISHABLE to the anonymous caller', async () => {
    // The substance of the card asserted directly rather than inferred from two
    // assertions that merely happen to agree today: whatever the platform says,
    // it must say the SAME thing for the break-glass holder and for anyone else.
    const { manager, ownerId, ordinaryId } = await seedDeployment();

    const holder = await verdict(await post(manager, '/admin/remove-user', { userId: ownerId }));
    const other = await verdict(await post(manager, '/admin/remove-user', { userId: ordinaryId }));

    expect(holder.status).toBe(other.status);
    expect(holder.text).toBe(other.text);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The load-bearing half: the invariant survives the move
// ───────────────────────────────────────────────────────────────────────────

describe('#10776 — the break-glass invariant is unchanged for an AUTHENTICATED admin', () => {
  it('still-refused: removing the genuine last local credential is still 409 LAST_LOCAL_CREDENTIAL', async () => {
    // ⛔ The leg that fails on an implementation that "fixed" the disclosure by
    // deleting the guard. Everything in the block above stays green there.
    const { manager, ownerId, bearer } = await seedDeployment();

    const v = await verdict(
      await post(manager, '/admin/remove-user', { userId: ownerId }, bearer),
    );

    expect(v.status, v.text).toBe(409);
    expect(v.code, v.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 60_000);

  it('admission: the same admin removing an ordinary user still succeeds', async () => {
    // Without this, the still-refused leg above is satisfiable by refusing
    // every caller — the failure mode this lane has already paid for twice.
    const { manager, ordinaryId, bearer } = await seedDeployment();

    const res = await post(manager, '/admin/remove-user', { userId: ordinaryId }, bearer);
    const v = await verdict(res);

    expect(v.status, v.text).toBe(200);
    expect(v.code, v.text).not.toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The self-service path, whose TIMING moves with the guard
// ───────────────────────────────────────────────────────────────────────────

describe('#10776 — /delete-user sits under the same guard and is covered here', () => {
  it('anonymous: no per-record answer, and specifically not the guard‘s 409', async () => {
    const { manager, ownerId } = await seedDeployment();

    const v = await verdict(await post(manager, '/delete-user', { userId: ownerId }));

    // Measured: the vendor's own session middleware refuses first, in
    // better-auth's flat envelope. That is deliberate and is NOT the #10349
    // envelope's business — `/delete-user` is not an `/admin/` path, and that
    // card's normalizer is scoped to `/admin/` on purpose. What matters here is
    // that the answer is an AUTHENTICATION refusal and carries nothing about
    // the named user.
    expect(v.status, v.text).toBe(401);
    expect(v.code, v.text).toBe('UNAUTHORIZED');
    expect(v.code, v.text).not.toBe(LAST_LOCAL_CREDENTIAL_CODE);
    expect(v.status, v.text).not.toBe(409);
  }, 60_000);

  it('anonymous: the self-service path is INDISTINGUISHABLE across the two arms too', async () => {
    const { manager, ownerId, ordinaryId } = await seedDeployment();

    const holder = await verdict(await post(manager, '/delete-user', { userId: ownerId }));
    const other = await verdict(await post(manager, '/delete-user', { userId: ordinaryId }));

    expect(holder.status).toBe(other.status);
    expect(holder.text).toBe(other.text);
  }, 60_000);

  it('authenticated: the OUTCOME for the break-glass holder is unchanged — still 409', async () => {
    // Triage asked whether the ordering change alters this path's outcome or
    // only its timing. This is that question, pinned.
    const { manager, ownerId, ownerBearer } = await seedDeployment();

    const v = await verdict(await post(manager, '/delete-user', { userId: ownerId }, ownerBearer));

    expect(v.status, v.text).toBe(409);
    expect(v.code, v.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 60_000);
});
