// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7823 — `sys_session.token` must not come back on the generic read path,
 * because its own declaration says it never does:
 *
 *   description: 'Opaque session token — never exposed in UI'
 *
 * On `origin/main` that sentence was false, for the same structural reason as
 * its `sys_api_key.key` sibling (#7728): the engine's read mask collects by
 * field TYPE (`collectMaskedReadFields`), and `token` is `text`, so nothing
 * collected it. `hidden: true` is not the contract that was broken — spec
 * defines it as "Hidden from default UI", not "stripped from serialization".
 * The fix is the `internal: true` flag, honoured at the same post-hook choke
 * point as the credential mask.
 *
 * **What makes this card different from its sibling, and worse.** `key` is a
 * stored SHA-256 hash; `token` is a LIVE BEARER CREDENTIAL. The measurement on
 * the card was replay-proven: a member's token, read off the data API by an
 * ADMIN, authenticates as that member when replayed as `Authorization: Bearer`.
 * So the disclosure is impersonation, not merely exposure — which is why
 * `crossUserTokenIsNotRecoverable` below is the assertion this file exists for.
 *
 * **Scope the persona precisely.** This is an ADMIN-CROSS-USER disclosure, not
 * an any-authenticated-caller one. A member's own reads are self-scoped and the
 * `sys_session_self` RLS policy already answers 404 across users — that arm is
 * pinned here (`memberCannotReachAnotherSession`) so a future change to the
 * strip cannot quietly be credited with holding a line RLS was already holding,
 * and so a regression in RLS itself is attributed to RLS.
 *
 * **This file has to drive BOTH directions**, and the negative one is the
 * load-bearing half: a change that broke authentication outright would satisfy
 * every "absent" assertion here. So the liveness arms are asserted at the
 * moment they would break —
 *
 *  - sessions still MINT (`signIn`/`signUp` still hand back a working bearer);
 *  - that bearer still AUTHENTICATES (`GET /auth/get-session` ⇒ 200);
 *  - the by-token session lookup still RESOLVES server-side, i.e. the value is
 *    still in STORAGE and still filterable — the strip runs on result rows,
 *    after the driver has evaluated the predicate and used the unique index.
 *
 * The `?select=` arm is its own test. `select` gates only on whether a field is
 * KNOWN (`assertProjectionFieldsExist`) and `token` is known, so a strip that
 * only touched the default projection would ship looking complete and still
 * leak to any client that spells the column out.
 *
 * Falsifiability: `id` / `user_id` / `expires_at` are asserted PRESENT
 * throughout. Without them a "delete every column" bug reads as a pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const MEMBER_EMAIL = 'session-token-member@verify.test';

describe('#7823: sys_session.token (a live bearer) never serializes on the generic read path', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;
  let adminUserId: string;
  let memberUserId: string;

  /**
   * Does this bearer still authenticate? Asked through the real auth surface,
   * with the token as the ONLY credential present. This is the negative
   * direction — it must stay `true` for a token the fix merely stopped
   * serializing.
   */
  const stillAuthenticates = async (bearer: string): Promise<boolean> => {
    const res = await stack.apiAs(bearer, 'GET', '/auth/get-session');
    if (res.status !== 200) return false;
    const body: any = await res.json();
    return Boolean(body?.user?.id);
  };

  /** Every `sys_session` row the admin can see. */
  const listSessionsAsAdmin = async (query = ''): Promise<any[]> => {
    const res = await stack.apiAs(adminToken, 'GET', `/data/sys_session${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as any).records ?? [];
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(MEMBER_EMAIL);

    const adminMe: any = await (await stack.apiAs(adminToken, 'GET', '/auth/get-session')).json();
    adminUserId = String(adminMe?.user?.id ?? '');
    const memberMe: any = await (await stack.apiAs(memberToken, 'GET', '/auth/get-session')).json();
    memberUserId = String(memberMe?.user?.id ?? '');

    expect(adminUserId, 'could not resolve the seeded admin id').toBeTruthy();
    expect(memberUserId, 'could not resolve the member id').toBeTruthy();
    expect(adminUserId).not.toBe(memberUserId);
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('admin list omits `token` on every row, and keeps the other columns', async () => {
    const rows = await listSessionsAsAdmin();

    // The measurement on the card saw the token on THREE rows here — the
    // admin's own and every other user's. Assert we still see multiple users'
    // rows, so this is the same broad read that leaked, not a narrowed one.
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r: any) => String(r.user_id))).size).toBeGreaterThan(1);

    // OMIT, not mask (maintainer ruling 2026-08-12): `token` is
    // `required: true`, so a "a value is set" mask carries zero bits while
    // still shipping a value under a field whose description promises none.
    // `toBeUndefined()` alone would pass on a masked value of `undefined`; the
    // key must be ABSENT from the object.
    for (const row of rows) expect(Object.keys(row)).not.toContain('token');

    // Falsifiability: these are real rows, not empty objects.
    expect(rows.every((r: any) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(rows.every((r: any) => Boolean(r.user_id))).toBe(true);
    expect(rows.some((r: any) => Boolean(r.expires_at))).toBe(true);
  });

  it("admin get-by-id on ANOTHER user's session omits `token` — the disclosure this card closes", async () => {
    // The exact shape that was replay-proven: the admin reads the MEMBER's
    // session row by id and, before this fix, got that member's live bearer
    // verbatim. Resolve the row through the admin's own list, the way the
    // measurement did.
    const rows = await listSessionsAsAdmin();
    const memberRow = rows.find((r: any) => String(r.user_id) === memberUserId);
    expect(memberRow, "admin must still be able to SEE the member's session row").toBeTruthy();

    const res = await stack.apiAs(adminToken, 'GET', `/data/sys_session/${memberRow.id}`);
    expect(res.status).toBe(200);
    const record = ((await res.json()) as any).record ?? {};

    expect(Object.keys(record)).not.toContain('token');

    // The read still WORKS and still identifies the session — admin keeps the
    // session-management surface (`revoked_at`, expiry, client fingerprint),
    // it just stops receiving the credential itself.
    expect(record.id).toBe(memberRow.id);
    expect(String(record.user_id)).toBe(memberUserId);
    expect(record.expires_at).toBeTruthy();

    // And the credential the admin can no longer read is still the member's
    // working credential — the fix removed a disclosure, not a session.
    expect(await stillAuthenticates(memberToken)).toBe(true);
  });

  it('an EXPLICIT `?select=id,token` projection does not bypass the strip', async () => {
    // `select` only gates on whether a field is KNOWN, and `token` is known, so
    // naming it is a LEGAL request that must come back WITHOUT it — stripped,
    // not refused, so a client asking for a legal-but-omitted column still gets
    // its other columns.
    const rows = await listSessionsAsAdmin('?select=id,token');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row)).not.toContain('token');
    // The projection was honoured, not silently downgraded to something that
    // never contained `token` anyway.
    expect(rows.every((r: any) => typeof r.id === 'string')).toBe(true);

    const withOther = await listSessionsAsAdmin('?select=id,token,user_id');
    expect(withOther.length).toBeGreaterThan(0);
    for (const row of withOther) expect(Object.keys(row)).not.toContain('token');
    expect(withOther.every((r: any) => Boolean(r.user_id))).toBe(true);

    const target = withOther[0];
    const byId = await stack.apiAs(adminToken, 'GET', `/data/sys_session/${target.id}?select=id,token`);
    expect(byId.status).toBe(200);
    const record = ((await byId.json()) as any).record ?? {};
    expect(Object.keys(record)).not.toContain('token');
    expect(record.id).toBe(target.id);
  });

  it('a member self-scoped read omits `token` too', async () => {
    const res = await stack.apiAs(memberToken, 'GET', '/data/sys_session');
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as any).records ?? [];

    // Self-scoped: the member sees their own session(s) and nobody else's.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => String(r.user_id) === memberUserId)).toBe(true);
    for (const row of rows) expect(Object.keys(row)).not.toContain('token');

    // A member could not read their own token off this path either — worth
    // pinning, because "you may only see your own credential" is still a
    // serialization the declaration forbids.
    const own = await stack.apiAs(memberToken, 'GET', `/data/sys_session/${rows[0].id}`);
    expect(own.status).toBe(200);
    const record = ((await own.json()) as any).record ?? {};
    expect(Object.keys(record)).not.toContain('token');
    expect(record.id).toBe(rows[0].id);
  });

  it("a member still cannot reach another user's session at all — RLS is untouched", async () => {
    // The member arm was never a disclosure: `sys_session_self` answers 404
    // across users. Pinned so a regression HERE is attributed to RLS rather
    // than to the strip, and so the strip cannot be credited with a line it
    // does not hold.
    const adminRows = await listSessionsAsAdmin();
    const adminRow = adminRows.find((r: any) => String(r.user_id) === adminUserId);
    expect(adminRow, "could not resolve the admin's own session row").toBeTruthy();

    const res = await stack.apiAs(memberToken, 'GET', `/data/sys_session/${adminRow.id}`);
    expect(res.status).toBe(404);
  });

  it('sessions still MINT and the minted bearer still AUTHENTICATES', async () => {
    // The negative direction, at its most direct: a change that broke
    // authentication would satisfy every absence assertion above.
    expect(await stillAuthenticates(adminToken)).toBe(true);
    expect(await stillAuthenticates(memberToken)).toBe(true);

    // A NEW session, minted after the strip is in force, is equally usable —
    // proves the mint path still writes a token the auth path can resolve.
    const freshMember = await stack.signUp('session-token-fresh@verify.test');
    expect(typeof freshMember).toBe('string');
    expect(freshMember.length).toBeGreaterThan(8);
    expect(await stillAuthenticates(freshMember)).toBe(true);

    const freshAdmin = await stack.signIn();
    expect(typeof freshAdmin).toBe('string');
    expect(await stillAuthenticates(freshAdmin)).toBe(true);
  });

  it('the session LIFECYCLE still works — sign-out and revoke-other-sessions', async () => {
    // The deepest negative arm, and the one that decides whether this flag is
    // applicable to this column at all.
    //
    // better-auth's storage adapter is implemented OVER the objectql engine
    // (`plugin-auth/src/objectql-adapter.ts` → `dataEngine.findOne`), which is
    // the very path `omitInternalFields` runs on, and better-auth then reads
    // `session.session.token` back OFF that row — to re-sign the session cookie
    // (`api/routes/session.mjs:143`), to delete the session on sign-out (:197),
    // to extend it on refresh (:234) and to pick the sessions to drop in
    // revoke-other-sessions (:512). A `where`-only analysis misses all four,
    // because the token is BOTH the filter and a value read back.
    //
    // So: does the lifecycle still land? Asked by observing the ROW, not the
    // response code — a handler that no-ops on an undefined token still
    // answers 200.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const victim = await stack.signUp('session-token-lifecycle@verify.test');
    expect(await stillAuthenticates(victim)).toBe(true);

    const rowsFor = async (bearer: string): Promise<any[]> =>
      (await ql.find('sys_session', {
        where: { token: bearer },
        context: { isSystem: true },
      })) as any[];

    expect((await rowsFor(victim)).length).toBe(1);

    const signOut = await stack.apiAs(victim, 'POST', '/auth/sign-out', {});
    expect([200, 204]).toContain(signOut.status);

    // The row must actually be gone (or tombstoned) — this is the assertion a
    // silently-undefined `deleteSession(session.token)` fails.
    const after = await rowsFor(victim);
    const stillLive = after.filter((r: any) => r.revoked_at == null);
    expect(stillLive.length, 'sign-out must remove/tombstone the session row').toBe(0);

    // …and the bearer must stop working, which is the user-visible half.
    expect(await stillAuthenticates(victim)).toBe(false);
  });

  it('revoke-other-sessions ACTUALLY revokes — the other session stops authenticating (#7823 Q2)', async () => {
    // The measured composition defect: with the read strip in place and no
    // readback seam, better-auth's revoke-other-sessions filtered
    // `listSessions(userId)` rows by a `token` every row had lost — so it
    // answered `200 {"status":true}` while the user's OTHER session kept
    // authenticating. A security control reporting success while doing
    // nothing. The fix routes the adapter's session reads through
    // `Engine.resolveInternalField` (#8118); this arm holds it there.
    //
    // Asserted on the OTHER SESSION'S LIVENESS, not the status code — the
    // status code is exactly what lied.
    const email = 'session-token-revoke-others@verify.test';
    const olderSession = await stack.signUp(email);
    const currentSession = await stack.signIn(email, 'Member-Pass-123');
    expect(olderSession).not.toBe(currentSession);
    expect(await stillAuthenticates(olderSession)).toBe(true);
    expect(await stillAuthenticates(currentSession)).toBe(true);

    const res = await stack.apiAs(currentSession, 'POST', '/auth/revoke-other-sessions', {});
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body?.status).toBe(true);

    // The half that was silently false before: the other session is GONE…
    expect(await stillAuthenticates(olderSession)).toBe(false);
    // …and the caller kept their own — revoke-OTHER, not revoke-all.
    expect(await stillAuthenticates(currentSession)).toBe(true);
  });

  it('expired-session cleanup still lands — the expired row is removed, not just refused (#7823 Q2)', async () => {
    // Same seam, second consumer: when bearer validation meets an EXPIRED
    // row, better-auth deletes it by `session.token` read back off the row it
    // just fetched through the adapter. Token-less rows turn that into a
    // refusal that leaves the credential row in storage forever. Observe the
    // ROW, not the response — the refusal looks identical either way.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const bearer = await stack.signUp('session-token-expired-cleanup@verify.test');
    expect(await stillAuthenticates(bearer)).toBe(true);

    const rowsFor = async (): Promise<any[]> =>
      (await ql.find('sys_session', {
        where: { token: bearer },
        context: { isSystem: true },
      })) as any[];
    expect((await rowsFor()).length).toBe(1);

    // Expire the row in place (system write — the identity write guard admits
    // the platform's own maintenance writes, and this is storage state, not a
    // route behaviour).
    const [row] = await rowsFor();
    await ql.update(
      'sys_session',
      { id: row.id, expires_at: new Date(Date.now() - 60_000).toISOString() },
      { where: { id: row.id }, context: { isSystem: true } },
    );

    // Bearer validation on the expired session must refuse…
    expect(await stillAuthenticates(bearer)).toBe(false);
    // …and the cleanup must have LANDED: the row is deleted (or tombstoned),
    // which is precisely the write that no-ops when `token` is missing. A row
    // still sitting there un-revoked is the silent-no-op state — the refusal
    // above looks identical whether or not the delete happened, so the ROW is
    // the only honest witness.
    const lingering = (await rowsFor()).filter((r: any) => r.revoked_at == null);
    expect(lingering.length, 'expired-session cleanup must remove/tombstone the row, not silently no-op').toBe(0);
  });

  it('the by-token session lookup still resolves server-side — the value is still in STORAGE', async () => {
    // The load-bearing negative assertion. `internal` is a SERIALIZATION
    // contract, not a storage one: the strip runs on rows the driver has
    // already produced, so the predicate has been evaluated and the unique
    // index on `token` used before the engine sees anything. If this stopped
    // matching, every authenticated request in the product would 401.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    expect(ql, 'objectql service must be available').toBeTruthy();

    const rows = (await ql.find('sys_session', {
      where: { token: memberToken },
      context: { isSystem: true },
    })) as any[];

    // The filter MATCHED — proof the plaintext is still stored under `token`.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(String(rows[0].user_id)).toBe(memberUserId);

    // …and the row it handed back STILL has no `token` key. Both halves in one
    // assertion: filterable in storage, absent from the result. That is exactly
    // the line `internal` draws, and the reason authentication keeps working.
    expect(Object.keys(rows[0])).not.toContain('token');
  });

  it('the declaration that makes all of the above required is on the REGISTERED schema', async () => {
    // The original defect was a DECLARATION disagreeing with the runtime, so
    // pin the declaration from the REGISTERED schema — what the runtime serves,
    // not what the source file says.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const schema = ql?.getSchema?.('sys_session');
    expect(schema, 'sys_session schema must be registered').toBeTruthy();

    const token = schema.fields?.token;
    expect(token, 'sys_session.token must stay declared').toBeTruthy();
    expect(token.internal).toBe(true);

    // Still a plain `text` column: the fix does NOT retype it. `secret` would
    // encrypt at rest and destroy the by-token session lookup asserted above;
    // `password` is inert on a `managedBy: 'better-auth'` object and is
    // collected by TYPE anyway, which a `text` column never satisfies.
    expect(token.type).toBe('text');

    // The neighbouring flags are unchanged — `internal` is an ADDITION, not a
    // re-declaration. `hidden` stays a UI contract, `readonly` the write one.
    expect(token.hidden).toBe(true);
    expect(token.readonly).toBe(true);
    expect(token.required).toBe(true);

    // The description this card exists to make true — unchanged by the fix, so
    // the generated translation bundles that mirror it do not churn.
    expect(String(token.description)).toContain('never exposed in UI');
  });
});
