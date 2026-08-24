// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11074 — the authenticated residual of #10776's fix.
//
// #10776 (pinned in `break-glass-guard-authentication-order.test.ts`) moved
// the break-glass guard to run only AFTER identity is established, closing
// the disclosure for an ANONYMOUS caller. Inside the guard, target resolution
// on `/delete-user` was left unchanged: a body-supplied `userId` still won
// over the resolved actor whenever one was present. `/delete-user` is the
// vendor's self-service delete — its contract names no target, the subject
// IS the caller — so that preference let ANY authenticated caller (no admin
// role required; `/delete-user` sits outside the `/admin/` lane) turn the
// guard's own refusal into a per-record answer about who else holds the
// break-glass credential.
//
// The fix: on `/delete-user`, the target is the resolved actor
// UNCONDITIONALLY — `ctx?.body?.userId` is never consulted for that path, not
// only as a fallback. `/admin/remove-user` and `/admin/ban-user` are
// unaffected — target-naming is their own contract, per the vendor and the
// ADR-0068 admin gate — and are not touched here.
//
// ── What this file pins, and why as a comparison ─────────────────────────────
//
// The substance of the finding is that the guard's refusal became a
// DISCRIMINATOR for an authenticated non-holder: naming the holder answered
// differently than naming anyone else. Pinning only "naming the holder no
// longer 409s" would not prove that — an implementation that refused
// everyone, or answered every case with a coin flip, could satisfy a lone
// assertion. So every describe-block below asserts the EQUALITY between two
// calls from the same caller, the way `break-glass-guard-authentication-order
// .test.ts` already does for the anonymous case. Real better-auth pipeline
// throughout, same precedent: requests go in as `Request` objects through
// `AuthManager.handleRequest`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { LAST_LOCAL_CREDENTIAL_CODE } from './last-local-credential';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-11074';
const BASE = 'http://localhost:3000/api/v1/auth';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
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
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON / empty body → no code */
  }
  return { status: res.status, code, text };
}

/**
 * One deployment:
 *
 *  - `owner` holds the ONLY local-password (`credential`) account — the
 *    break-glass escape hatch this guard exists to protect.
 *  - `caller` is a second, credential-less (IdP-managed) user — an
 *    authenticated caller who is NOT the break-glass holder, which is exactly
 *    the population the finding is about. `/delete-user` needs no admin role,
 *    so `caller` carries none.
 */
async function seedDeployment() {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  for (const [email, name] of [
    ['owner.11074@example.com', 'Break Glass Owner'],
    ['caller.11074@example.com', 'Ordinary Caller'],
  ]) {
    // [#11739] default posture invite_only: users beyond the first enter
    // through the invitation carve-out (see audience-gate-test-support).
    inviteForAudienceGate(engine, email);
    const res = await post(manager, '/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = (engine.tables.get('sys_user') ?? []) as any[];
  const idFor = (email: string) => String(users.find((r) => r.email === email)!.id);
  const ownerId = idFor('owner.11074@example.com');
  const callerId = idFor('caller.11074@example.com');

  const callerSignIn = await post(manager, '/sign-in/email', {
    email: 'caller.11074@example.com',
    password: PASSWORD,
  });
  const callerBearer = callerSignIn.headers.get('set-auth-token');
  expect(callerBearer, 'the probe leg needs the non-holder caller signed in').toBeTruthy();

  const ownerSignIn = await post(manager, '/sign-in/email', {
    email: 'owner.11074@example.com',
    password: PASSWORD,
  });
  const ownerBearer = ownerSignIn.headers.get('set-auth-token');
  expect(ownerBearer, 'the evasion leg needs the holder signed in').toBeTruthy();

  // Strip the local password from everyone except `owner`, leaving exactly
  // one credential holder — the state the guard exists to protect, and what
  // makes `caller` a genuine non-holder.
  const accounts = (engine.tables.get('sys_account') ?? []) as any[];
  engine.tables.set(
    'sys_account',
    accounts.filter((r) => !(r.provider_id === 'credential' && String(r.user_id ?? '') !== ownerId)),
  );
  const remaining = (engine.tables.get('sys_account') ?? []).filter(
    (r: any) => r.provider_id === 'credential',
  );
  expect(
    remaining.map((r: any) => String(r.user_id)),
    'fixture invariant: `owner` must be the SOLE local-credential holder',
  ).toEqual([ownerId]);

  return { engine, manager, ownerId, callerId, callerBearer: callerBearer!, ownerBearer: ownerBearer! };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// The disclosure: an authenticated non-holder learns nothing per-record
// ───────────────────────────────────────────────────────────────────────────

describe('#11074 — /delete-user: an authenticated non-holder gets no per-record answer', () => {
  it('naming the holder vs. naming nobody-in-particular in body.userId: SAME answer', async () => {
    const { manager, ownerId, callerBearer } = await seedDeployment();

    const namedHolder = await verdict(await post(manager, '/delete-user', { userId: ownerId }, callerBearer));
    const namedOther = await verdict(
      await post(manager, '/delete-user', { userId: 'usr_no_such_user' }, callerBearer),
    );

    // Both fall through past the guard to the vendor's own disabled
    // `/delete-user` handler (#7735) — the caller is deleting THEMSELVES,
    // and they are not the break-glass holder. Neither leg is the guard's
    // distinctive refusal.
    expect(namedHolder.status, namedHolder.text).toBe(404);
    expect(namedOther.status, namedOther.text).toBe(404);
    expect(namedHolder.code).not.toBe(LAST_LOCAL_CREDENTIAL_CODE);
    expect(namedOther.code).not.toBe(LAST_LOCAL_CREDENTIAL_CODE);

    // The comparison IS the finding: pre-fix, naming the holder answered 409
    // here while naming anyone else answered 404 — a per-record oracle for
    // ANY authenticated caller, not only one acting on themselves. Restored:
    // what the body claims cannot move the answer at all.
    expect(namedHolder.status, 'the two arms must be indistinguishable').toBe(namedOther.status);
    expect(namedHolder.text, 'the two arms must be indistinguishable').toBe(namedOther.text);
  }, 60_000);

  it('naming the holder vs. omitting userId entirely: SAME answer too', async () => {
    // A caller need not even guess a real id to have probed under the old
    // code — any body.userId that resolved to SOME credential holder would
    // have done it. Omitting it entirely is the other natural shape of an
    // ordinary self-delete call, and must land the same place.
    const { manager, ownerId, callerBearer } = await seedDeployment();

    const named = await verdict(await post(manager, '/delete-user', { userId: ownerId }, callerBearer));
    const omitted = await verdict(await post(manager, '/delete-user', {}, callerBearer));

    expect(named.status, named.text).toBe(404);
    expect(omitted.status, omitted.text).toBe(404);
    expect(named.status).toBe(omitted.status);
    expect(named.text).toBe(omitted.text);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The load-bearing half: the invariant survives, in BOTH directions
// ───────────────────────────────────────────────────────────────────────────

describe('#11074 — the guard still does its job, and cannot be steered by the body', () => {
  it('still-refused: the holder deleting themselves via /delete-user is still 409', async () => {
    // ⛔ The leg that fails on an implementation that "fixed" the disclosure
    // by disabling the guard on this path entirely.
    const { manager, ownerBearer } = await seedDeployment();

    const v = await verdict(await post(manager, '/delete-user', {}, ownerBearer));

    expect(v.status, v.text).toBe(409);
    expect(v.code, v.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 60_000);

  it('the holder cannot evade the guard by naming a decoy target in body.userId', async () => {
    // The other direction of the same bug: unconditional actor-keying also
    // means the caller cannot point the guard AWAY from themselves by naming
    // someone else. Pre-fix, a holder POSTing `{ userId: <someone else> }`
    // would have had the guard check that OTHER user (who is not the sole
    // holder) and let the real self-delete proceed.
    const { manager, callerId, ownerBearer } = await seedDeployment();

    const decoy = await verdict(await post(manager, '/delete-user', { userId: callerId }, ownerBearer));
    const honest = await verdict(await post(manager, '/delete-user', {}, ownerBearer));

    expect(decoy.status, decoy.text).toBe(409);
    expect(decoy.code, decoy.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
    expect(honest.status).toBe(decoy.status);
    expect(honest.text).toBe(decoy.text);
  }, 60_000);
});
