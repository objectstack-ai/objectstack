// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7987 — `sys_account`'s three OAuth credential columns must not come back on
 * the generic data path.
 *
 * `access_token`, `refresh_token` and `id_token` hold the user's LIVE bearer
 * credentials for someone else's service (Google, GitHub, an OIDC IdP), stored
 * in cleartext — better-auth's `account.encryptOAuthTokens` is not set, so
 * `setTokenUtil` writes the value verbatim. On `origin/main` they were plain
 * `Field.textarea` on an object declaring `apiEnabled: true,
 * apiMethods: ['get','list']`, and nothing masked them: the engine's credential
 * mask collects by field TYPE, and it also EXEMPTS objects with
 * `managedBy: 'better-auth'` — which this object is. Two independent reasons
 * the one applicable collector could never have reached these columns.
 *
 * ## Why this object's persona story is worse than its `sys_session` sibling
 *
 * #7823's disclosure was admin-cross-user. This one has that arm AND a
 * self-service arm: the `sys_account_self` RLS policy grants a MEMBER `select`
 * on `user_id == current_user.id`, so an ordinary authenticated user could read
 * their own row — and their own row holds a long-lived third-party REFRESH
 * token. That converts a short-lived, revocable ObjectStack session bearer into
 * a credential this platform cannot revoke at all. Both arms are pinned below;
 * `memberReadsOwnRow` is the one that has no analogue in #7823.
 *
 * ## What makes this fixture non-vacuous (read this before adding to it)
 *
 * A credential-account row — what `signUp` creates — has all three columns
 * EMPTY. So "the API response has no `refresh_token` key" is true on such a row
 * whether or not the fix exists, and a fixture built on sign-up rows alone
 * would certify nothing while printing green. Two deliberate choices close
 * that:
 *
 *  1. the fixture PLANTS real token values on the member's account row through
 *     the engine (the write better-auth's OAuth callback would perform), so
 *     there is something to leak;
 *  2. `assertArmed` (#8074) re-reads those values back out of STORAGE through
 *     the privileged accessor before a single assertion runs. If the plant did
 *     not land, the file fails in `beforeAll` rather than passing hollowly.
 *
 * The other direction is pinned too: `storageAndFilteringUntouched` proves the
 * values are still on disk and still usable as a server-side predicate, and
 * `signInStillWorks` proves the strip did not break authentication. Without
 * those, a change that simply deleted the columns would satisfy every
 * "absent" assertion here.
 *
 * ## What this fixture does NOT prove, stated plainly
 *
 * The end-to-end OAuth token-exchange routes (`/get-access-token`,
 * `/account-info`, `/refresh-token`) need a configured social provider and a
 * live IdP, which this stack has neither of. Their dependency on the readback
 * seam — better-auth reads `account.refreshToken` off an adapter result row, so
 * the read strip alone would answer `REFRESH_TOKEN_NOT_FOUND` — is pinned at
 * the unit level in `plugin-auth/src/internal-field-readback.test.ts`. What
 * IS covered here end-to-end is the sign-in path, which really does read a
 * `sys_account` row back through the same seam
 * (`internalAdapter.findCredentialAccount`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { assertArmed, armedWhen } from './armed.js';

const MEMBER_EMAIL = 'account-oauth-member@verify.test';
const MEMBER_PASSWORD = 'Member-Pass-123';

/** The values planted on the member's account row — distinctive on purpose. */
const PLANTED = {
  access_token: 'ya29.PLANTED-ACCESS-TOKEN-7987',
  refresh_token: '1//PLANTED-REFRESH-TOKEN-7987',
  id_token: 'eyJhbGciOiJSUzI1NiJ9.PLANTED-ID-TOKEN-7987',
} as const;

const TOKEN_COLUMNS = ['access_token', 'refresh_token', 'id_token'] as const;

describe('#7987: sys_account OAuth tokens never serialize on the generic data path', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let memberToken: string;
  let memberUserId: string;
  let memberAccountId: string;

  /** Every `sys_account` row the admin can see. */
  const listAccountsAsAdmin = async (query = ''): Promise<any[]> => {
    const res = await stack.apiAs(adminToken, 'GET', `/data/sys_account${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as any).records ?? [];
  };

  /** Read a column straight out of storage, below the strip (#8118's accessor). */
  const storedValue = async (field: string): Promise<unknown> => {
    const map = await ql.resolveInternalField('sys_account', [memberAccountId], field);
    return map.get(memberAccountId);
  };

  const assertNoTokenColumns = (record: Record<string, unknown>): void => {
    // OMIT, not mask: the key must be ABSENT. `toBeUndefined()` would also pass
    // on a masked value of `undefined`, which still ships a key whose presence
    // says "this user has a linked provider credential".
    for (const column of TOKEN_COLUMNS) expect(Object.keys(record)).not.toContain(column);
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD);

    const memberMe: any = await (await stack.apiAs(memberToken, 'GET', '/auth/get-session')).json();
    memberUserId = String(memberMe?.user?.id ?? '');
    expect(memberUserId, 'could not resolve the member id').toBeTruthy();

    // The account row better-auth created for the member at sign-up. Read as
    // system, because the read path this fixture is about would hide the very
    // columns we are planting.
    const accounts: any[] = await ql.find('sys_account', {
      where: { user_id: memberUserId },
      context: { isSystem: true },
    });
    expect(accounts.length, 'sign-up must create a sys_account row').toBeGreaterThan(0);
    memberAccountId = String(accounts[0].id);

    // Plant the credentials an OAuth link would have written. This is the whole
    // reason the assertions below mean anything: a credential account's token
    // columns are empty, so without this the file would assert the absence of
    // values that never existed.
    await ql.update(
      'sys_account',
      { id: memberAccountId, ...PLANTED },
      { context: { isSystem: true } },
    );

    await assertArmed([
      armedWhen({
        control: '#7987 — the member account row really holds live OAuth tokens',
        disarmedBy:
          'the plant above not landing (a rejected system write, or a renamed column) — the ' +
          'token columns would then be empty and every "absent from the API response" ' +
          'assertion in this file would pass without a credential to leak',
        observe: async () => ({
          access_token: await storedValue('access_token'),
          refresh_token: await storedValue('refresh_token'),
          id_token: await storedValue('id_token'),
        }),
        armed: (observed) =>
          observed.access_token === PLANTED.access_token &&
          observed.refresh_token === PLANTED.refresh_token &&
          observed.id_token === PLANTED.id_token,
        describe: (observed) =>
          `stored: access=${String(observed.access_token)} refresh=${String(observed.refresh_token)} ` +
          `id=${String(observed.id_token)}`,
      }),
      armedWhen({
        control: '#7987 — sys_account is reachable on the data API at all',
        disarmedBy:
          "the object's `apiEnabled`/`apiMethods` being narrowed — the columns would stop " +
          'serializing because the OBJECT stopped serializing, which is a different fix and ' +
          'would make this fixture blind to a regression in the field flag itself',
        observe: async () => (await stack.apiAs(adminToken, 'GET', '/data/sys_account')).status,
        armed: (status) => status === 200,
        describe: (status) => `GET /data/sys_account as admin ⇒ ${status}`,
      }),
    ]);
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('admin list omits all three token columns, and keeps the rest of the row', async () => {
    const rows = await listAccountsAsAdmin();

    // The admin sees other users' account rows — the cross-user arm.
    expect(rows.length).toBeGreaterThan(0);
    const memberRow = rows.find((r: any) => String(r.id) === memberAccountId);
    expect(memberRow, "admin must still SEE the member's account row").toBeTruthy();

    for (const row of rows) assertNoTokenColumns(row);

    // Falsifiability: these are real, populated rows — not empty objects that
    // would satisfy any absence assertion.
    expect(rows.every((r: any) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(memberRow.provider_id).toBeTruthy();
    expect(String(memberRow.user_id)).toBe(memberUserId);
  });

  it("admin get-by-id on another user's account omits them — the cross-user arm", async () => {
    const res = await stack.apiAs(adminToken, 'GET', `/data/sys_account/${memberAccountId}`);
    expect(res.status).toBe(200);
    const record = ((await res.json()) as any).record ?? {};

    assertNoTokenColumns(record);

    // The row is still readable and still identifies the link — admins keep the
    // account-management surface, they just stop receiving the credentials.
    expect(record.id).toBe(memberAccountId);
    expect(String(record.user_id)).toBe(memberUserId);
    expect(record.provider_id).toBeTruthy();
  });

  it('a MEMBER reading their OWN row does not get their own OAuth tokens back', async () => {
    // The arm with no analogue in #7823. `sys_account_self` grants this read,
    // and it is a legitimate read — the row is theirs. What must not come with
    // it is the long-lived third-party refresh token, because that turns any
    // session bearer (or any XSS on the console) into a credential ObjectStack
    // cannot revoke.
    const res = await stack.apiAs(memberToken, 'GET', '/data/sys_account');
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as any).records ?? [];

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => String(r.user_id) === memberUserId)).toBe(true);
    for (const row of rows) assertNoTokenColumns(row);

    const own = await stack.apiAs(memberToken, 'GET', `/data/sys_account/${memberAccountId}`);
    expect(own.status).toBe(200);
    const record = ((await own.json()) as any).record ?? {};
    assertNoTokenColumns(record);
    expect(record.id).toBe(memberAccountId);
  });

  it('an EXPLICIT `?select=` naming the columns does not bypass the strip', async () => {
    // `select` gates only on whether a field is KNOWN, and all three are known,
    // so naming them is a LEGAL request that must come back without them —
    // stripped, not refused. A strip that only touched the default projection
    // would ship looking complete and still leak to any client that spells the
    // column out.
    const rows = await listAccountsAsAdmin('?select=id,access_token,refresh_token,id_token');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) assertNoTokenColumns(row);
    expect(rows.every((r: any) => typeof r.id === 'string')).toBe(true);

    const byId = await stack.apiAs(
      adminToken,
      'GET',
      `/data/sys_account/${memberAccountId}?select=id,refresh_token`,
    );
    expect(byId.status).toBe(200);
    const record = ((await byId.json()) as any).record ?? {};
    assertNoTokenColumns(record);
    expect(record.id).toBe(memberAccountId);

    // And the member cannot spell their way to their own refresh token either.
    const memberSelect = await stack.apiAs(
      memberToken,
      'GET',
      '/data/sys_account?select=id,refresh_token',
    );
    expect(memberSelect.status).toBe(200);
    for (const row of ((await memberSelect.json()) as any).records ?? []) {
      assertNoTokenColumns(row);
    }
  });

  it('the system read path is stripped too — there is no `isSystem` carve-out', async () => {
    // #7728's design: the omission has no escape hatch, because an escape
    // hatch nobody needs is a hole in a non-exposure guarantee. The legitimate
    // system reader uses the privileged accessor instead, which is what the
    // next test asserts.
    const rows: any[] = await ql.find('sys_account', {
      where: { id: memberAccountId },
      context: { isSystem: true },
    });
    expect(rows.length).toBe(1);
    assertNoTokenColumns(rows[0]);
    expect(rows[0].id).toBe(memberAccountId);
  });

  it('storage, filtering and the privileged accessor are UNTOUCHED', async () => {
    // The negative direction. The strip runs on rows the driver has already
    // produced, so the value is still on disk, still indexable and still
    // usable as a server-side predicate — which is exactly what better-auth's
    // own lookups depend on. A change that deleted the columns outright would
    // pass every absence assertion above and fail here.
    expect(await storedValue('refresh_token')).toBe(PLANTED.refresh_token);
    expect(await storedValue('access_token')).toBe(PLANTED.access_token);
    expect(await storedValue('id_token')).toBe(PLANTED.id_token);

    // The predicate still resolves the row server-side…
    const byToken: any[] = await ql.find('sys_account', {
      where: { refresh_token: PLANTED.refresh_token },
      context: { isSystem: true },
    });
    expect(byToken.length).toBe(1);
    expect(String(byToken[0].id)).toBe(memberAccountId);
    // …while that same row comes back with no token columns on it.
    assertNoTokenColumns(byToken[0]);
  });

  it('⛔ the accessor refuses a column that is not flagged — `password` stays unreachable', async () => {
    // The card's scope guard, held mechanically. `password` and
    // `previous_password_hashes` are better-auth one-way hashes (ADR-0100's
    // third channel) and are deliberately NOT `internal`; dereferencing one
    // through this accessor would be a mask bypass rather than a read of the
    // internal channel, so the engine refuses it (ADR-0112 code + status).
    const err: any = await ql
      .resolveInternalField('sys_account', [memberAccountId], 'password')
      .then(() => null, (e: any) => e);
    expect(err, 'resolveInternalField must refuse a non-internal column').toBeTruthy();
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
  });

  it('sign-in still works — the account read path is on the authentication route', async () => {
    // The liveness arm that matters for THIS object. better-auth's
    // `findCredentialAccount` reads a `sys_account` row back through the same
    // adapter seam the strip runs on, on every password sign-in — so a readback
    // seam that threw, or returned a mangled row, would take authentication
    // down with it (the sibling card measured exactly that shape for
    // `sys_session.token`: `verify signIn: no token in response`).
    const fresh = await stack.signIn(MEMBER_EMAIL, MEMBER_PASSWORD);
    expect(typeof fresh).toBe('string');
    expect(fresh.length).toBeGreaterThan(8);

    const me = await stack.apiAs(fresh, 'GET', '/auth/get-session');
    expect(me.status).toBe(200);
    const body: any = await me.json();
    expect(String(body?.user?.id)).toBe(memberUserId);

    // A brand-new user signs up and authenticates as well — the account WRITE
    // path is unaffected by a read-side flag.
    const newcomer = await stack.signUp('account-oauth-newcomer@verify.test');
    const newcomerMe = await stack.apiAs(newcomer, 'GET', '/auth/get-session');
    expect(newcomerMe.status).toBe(200);
  });
});
