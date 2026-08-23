// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10792 — `/admin/remove-user` must answer the AUTHORIZATION question on a
// single-connection dialect, and answer it fast.
//
// `AuthManager.handleRequest` wraps the `SESSION_ERASURE_PATHS` members in
// `runSubjectErasureAtomically`, so the whole better-auth handler runs inside
// `engine.transaction(...)` — one unit of work, so a refused erasure cannot
// leave the session/account deletes committed. Inside that transaction the
// vendor's `adminMiddleware` re-reads the session, and plugin-auth's
// internal-field readback dereferences the session token through the engine's
// privileged `resolveInternalField` accessor. That accessor used to reach the
// driver with NO options, i.e. on a FRESH pooled connection.
//
// This harness boots the DEFAULT datasource, which is exactly the dialect that
// makes that fatal: sqlite-wasm's knex pool is `max: 1`. The erasure
// transaction holds the one connection; the privileged read waited for a
// connection that could not be freed until the transaction waiting on the read
// finished; knex's acquire timeout fired; and the vendor route degraded the
// failure into an AUTHENTICATION refusal. Measured before the fix, on this
// stack: `401` after ~120s for a caller the vendor's own gate ADMITS, with the
// target row still present — a dead capability AND, because the route answers
// an anonymous caller the same way, an unauthenticated-reachable way to pin a
// connection for two minutes per call. Postgres/MySQL (`max >= 10`) always
// conformed; they are the shape this file pins for SQLite too.
//
// Both halves are asserted deliberately. A fix that returns FAST but still
// answers `401` to the admitted admin would have repaired the exhaustion shape
// and left the capability dead — so `status` and `elapsed` are separate
// assertions, and the row's absence is a third.
//
// The admitted caller is a FIXTURE: better-auth's admin plugin authorizes on
// the legacy `user.role === 'admin'` scalar, which ADR-0068 D2 deliberately
// stopped synthesizing (the platform contributes `platform_admin` to
// `positions[]` instead). No caller on a stock boot passes the vendor gate, so
// the fixture places the scalar — otherwise the admitted-admin row of the
// matrix cannot be observed at all, and this file would only ever measure
// refusals.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from './harness';

const SYS = { isSystem: true };

// The route must answer well inside this. Before the fix it took ~120s (knex's
// pool-acquire timeout); the conforming dialects answered in 155ms. The bound
// is loose on purpose — this asserts "did not wait on a connection that will
// never come", not a latency budget, so ordinary CI noise cannot redden it.
const NOT_BLOCKED_MS = 30_000;

const app = {
  manifest: {
    id: 'com.example.erasure-authz',
    namespace: 'erasureauthz',
    version: '0.0.1',
    type: 'app',
    name: 'Erasure Authorization Fixture',
  },
  objects: [],
};

interface Answer { status: number; code?: string; ms: number; body: string }

describe('#10792 — the erasure route answers authorization on a pool max=1 dialect', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let priorScim: string | undefined;
  let admittedAdminToken = '';
  let memberToken = '';
  const targets: string[] = [];

  const fire = async (
    method: string,
    path: string,
    body: unknown,
    token?: string,
  ): Promise<Answer> => {
    const t0 = Date.now();
    const res = token
      ? await stack.apiAs(token, method, path, body)
      : await stack.api(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const ms = Date.now() - t0;
    const text = await res.text();
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { code?: string; error?: { code?: string } };
      code = parsed?.error?.code ?? parsed?.code;
    } catch { /* a bodyless or non-JSON refusal */ }
    return { status: res.status, code, ms, body: text.slice(0, 160) };
  };

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    // The better-auth admin plugin — which serves /admin/remove-user — is
    // mounted behind this flag, the same boot the dogfood admin-route sweep uses.
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(app);
    ql = await stack.kernel.getServiceAsync('objectql');

    await stack.signIn(); // seed the dev admin first, so the sign-ups below are plain members
    memberToken = await stack.signUp('e10792.member@example.com', 'Member-Pass-123');

    await stack.signUp('e10792.admitted@example.com', 'Admitted-Pass-123');
    const [admitted] = await ql.find(
      'sys_user', { where: { email: 'e10792.admitted@example.com' }, limit: 1 }, { context: SYS },
    );
    await ql.update('sys_user', { id: String(admitted.id), role: 'admin' }, { context: SYS });
    admittedAdminToken = await stack.signIn('e10792.admitted@example.com', 'Admitted-Pass-123');

    for (let i = 0; i < 3; i++) {
      const email = `e10792.target${i}@example.com`;
      await stack.signUp(email, 'Target-Pass-123');
      const [t] = await ql.find('sys_user', { where: { email }, limit: 1 }, { context: SYS });
      targets.push(String(t.id));
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('the fixture caller really is one the vendor gate admits — control', async () => {
    // Without this control the matrix below is unreadable: a caller the vendor
    // refuses everywhere would produce the same refusals for a reason that has
    // nothing to do with the transaction. These neighbouring /admin/ routes are
    // NOT erasure paths, so they run unwrapped and were never affected.
    const listed = await fire('GET', '/auth/admin/list-users?limit=1', undefined, admittedAdminToken);
    expect(listed.status, `admitted admin list-users: ${listed.body}`).toBe(200);
    const updated = await fire(
      'POST', '/auth/admin/update-user',
      { userId: targets[0], data: { name: 'Renamed' } }, admittedAdminToken,
    );
    expect(updated.status, `admitted admin update-user: ${updated.body}`).toBe(200);
  }, 120_000);

  it('an admitted admin gets 200 and the row is DELETED — not an authentication refusal', async () => {
    const answer = await fire('POST', '/auth/admin/remove-user', { userId: targets[1] }, admittedAdminToken);

    // The dead-capability half. `401` here is the defect's own signature: the
    // vendor route degrading a blocked read into "Sign in first" for a caller
    // it had already admitted on every neighbouring route above.
    expect(answer.status, `admitted admin remove-user: ${answer.status} ${answer.body}`).toBe(200);

    // The row must actually be gone — a 200 over an erasure that rolled back
    // would read as a pass and leave the capability just as dead.
    const survivors = await ql.find('sys_user', { where: { id: targets[1] }, limit: 1 }, { context: SYS });
    expect(survivors.length, 'the target row must be deleted').toBe(0);

    // The resource-exhaustion half, asserted separately on purpose.
    expect(answer.ms, `remove-user took ${answer.ms}ms — a blocked pool acquire`).toBeLessThan(NOT_BLOCKED_MS);
  }, 300_000);

  it('a signed-in plain member gets the AUTHORIZATION refusal, not 401', async () => {
    const answer = await fire('POST', '/auth/admin/remove-user', { userId: targets[2] }, memberToken);
    expect(answer.status, `member remove-user: ${answer.status} ${answer.body}`).toBe(403);
    // The vendor's own denial vocabulary. Asserting only the status would let a
    // 403 from some unrelated gate stand in for the authorization answer.
    expect(answer.code).toBe('YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS');
    expect(answer.ms).toBeLessThan(NOT_BLOCKED_MS);
    // …and the member's target survives: a refusal must erase nothing.
    const survivors = await ql.find('sys_user', { where: { id: targets[2] }, limit: 1 }, { context: SYS });
    expect(survivors.length, 'a refused erasure must not delete').toBe(1);
  }, 300_000);

  it('an anonymous caller still gets the authentication refusal — unchanged', async () => {
    const answer = await fire('POST', '/auth/admin/remove-user', { userId: targets[2] }, undefined);
    expect(answer.status, `anon remove-user: ${answer.status} ${answer.body}`).toBe(401);
    expect(answer.code).toBe('UNAUTHENTICATED');
    expect(answer.ms).toBeLessThan(NOT_BLOCKED_MS);
  }, 300_000);
});
