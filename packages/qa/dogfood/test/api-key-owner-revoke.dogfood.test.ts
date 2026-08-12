// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8053 — an ordinary member revoking their OWN API key.
 *
 * The residual of #7727. That fix opened the METHOD gate (`apiMethods` gained
 * `update`) and registered the ADR-0092 D2 column whitelist (`revoked` alone),
 * and `api-key-revoke-lifecycle.dogfood.test.ts` pins both — but every
 * assertion in that file drives the seeded ADMIN. One layer down, in
 * object-CRUD, the platform `member_default` set granted only `allowRead` on
 * the `BETTER_AUTH_MANAGED_OBJECTS` list, so `update` on `sys_api_key`
 * resolved for `admin_full_access` and nobody else. A member could mint a
 * personal key, watch it authenticate, and then not revoke it: 403
 * PERMISSION_DENIED, row unchanged, key still live. Their only remedy for a
 * leaked credential that "acts as you" was to find an admin.
 *
 * ## Why this file exists SEPARATELY from the admin one
 *
 * The persona IS the gate, and it is the whole reason the defect survived its
 * own fix's test suite. A revoke assertion written as admin passes against the
 * unfixed build, passes against the fixed build, and certifies nothing about
 * the persona the checklist item names first. So this file signs up a plain
 * member (`stack.signUp` — the first user is the seeded admin, so a fresh
 * sign-up carries no roles or grants) and drives every case as them.
 *
 * `[persona]` below is not ceremony: it asserts the fixture's principal really
 * is an ordinary member resolving the platform baseline. Two ways this file
 * could go quietly vacuous, both live:
 *
 *  - the principal turns out to be privileged, so every case passes on the
 *    admin path this file exists to avoid;
 *  - `member_default` stops resolving for a showcase member at all, so the
 *    grant under test is not in force and the file proves nothing about it.
 *    The showcase declares its own `isDefault` profile
 *    (`showcase_member_default`), and #7555's `composeHumanBaselinePermissionSets`
 *    is the only reason that profile COMPOSES with the platform baseline
 *    instead of replacing it. If that composition regresses, this file must go
 *    red loudly rather than keep reporting green about a set nobody resolved.
 *
 * ## What is deliberately NOT widened
 *
 * The grant is owner-scoped-plus-one-column, and `sys_api_key` rows act as the
 * user — the console's mint screen says to treat one like a password. So the
 * refusals below are as load-bearing as the success:
 *
 *  - `[cross-owner]` — a member may not revoke the ADMIN's key. The row scope
 *    is the pre-existing `sys_api_key_self` RLS carve-out, not the grant.
 *  - `[column]` — a non-`revoked` column stays refused, as the owner.
 *  - `[method]` — `create` / `delete` stay 405 at the method gate.
 *
 * ⚠️ Read those three honestly: on the UNFIXED build they pass **vacuously**,
 * because nothing granted the member `update` at all and so every PATCH was
 * 403 regardless of row or column. They only become load-bearing once the
 * grant exists, which is precisely when they are the assertions that prove it
 * is narrow. A reverse verification of this file must therefore expect the
 * OWNER cases to move and these to sit still — their stillness is not evidence.
 *
 * Refusal cases assert `code` AND `status` (ADR-0112): a bare
 * `rejects.toThrow()` / status-only assertion stays green against an
 * implementation that throws a naked `Error`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('#8053: a member revokes their OWN sys_api_key', () => {
  let stack: VerifyStack;
  /** The seeded platform admin — used ONLY to mint the cross-owner key. */
  let adminToken: string;
  /** The persona under test: an ordinary member, no roles, no grants. */
  let memberToken: string;

  const MEMBER_EMAIL = 'apikey.owner.8053@verify.test';

  /** Mint a key through the ONE mint path, as whoever holds `token`. */
  const mintKey = async (token: string, name: string): Promise<{ id: string; raw: string }> => {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const body: any = await res.json();
    expect(body?.data?.id).toBeTruthy();
    expect(body?.data?.key).toBeTruthy();
    return { id: String(body.data.id), raw: String(body.data.key) };
  };

  /**
   * Does this key still authenticate? Asked through a real read with NO bearer
   * token, so the key is the only credential present. `showcase_task` is the
   * card's own probe and is readable by a member via `showcase_member_default`
   * — deliberately NOT `sys_api_key`, so a permission change on the object
   * under test can never be mistaken for a credential verdict.
   */
  const keyStillAuthenticates = async (raw: string): Promise<boolean> => {
    const res = await stack.api('/data/showcase_task?$top=1', { headers: { 'x-api-key': raw } });
    if (res.status === 200) return true;
    // 401 = credential rejected. Anything else (e.g. 403) would mean the key
    // WAS accepted and something later refused — a different fact entirely.
    expect(res.status, `revoked-key probe should be 401, got ${res.status}`).toBe(401);
    return false;
  };

  /** Read a key row back with the caller's own credentials. */
  const readKey = async (token: string, id: string) => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    const body: any = res.status === 200 ? await res.json() : {};
    return { status: res.status, row: body.record ?? body.data ?? {} };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(MEMBER_EMAIL);
  }, 180_000);

  afterAll(async () => { await stack?.stop?.(); });

  // ── the fixture's own preconditions ───────────────────────────────────────

  it('[persona] the principal is an ordinary member resolving the platform baseline', async () => {
    const res = await stack.apiAs(memberToken, 'GET', '/security/explain?object=sys_api_key&operation=read');
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();

    const setNames: string[] = (body.layers ?? [])
      .flatMap((l: any) => l.contributors ?? [])
      .filter((c: any) => c?.kind === 'permission_set')
      .map((c: any) => String(c.name));

    // The grant under test lives in `member_default`. If a showcase member
    // stops resolving it, every other assertion here would be measuring a set
    // that is not in force — the failure mode this guard exists to make loud.
    expect(
      setNames,
      'a showcase member must resolve the PLATFORM baseline `member_default` — ' +
        '#7555 composition (app `isDefault` profile ∪ platform baseline), not replacement',
    ).toContain('member_default');

    // …and must NOT be an admin, or this file silently re-tests the #7727 path.
    expect(
      setNames,
      'the fixture principal must not hold admin_full_access — that is the persona #7727 already covers',
    ).not.toContain('admin_full_access');
  });

  it('[persona] the member can SEE their own key row but that is a read grant, not a write one', async () => {
    const { id } = await mintKey(memberToken, 'visible-to-me');
    const { status, row } = await readKey(memberToken, id);
    // The `sys_api_key_self` RLS carve-out already made the row owner-visible;
    // the card's point is that no `allowEdit` came with it.
    expect(status).toBe(200);
    expect(row.name).toBe('visible-to-me');
  });

  // ── the defect ────────────────────────────────────────────────────────────

  it('[owner] revokes their OWN key through the declared route, and it stops authenticating', async () => {
    const { id, raw } = await mintKey(memberToken, 'my-leaked-key');

    // Baseline: without this the post-revoke 401 is unfalsifiable — a key that
    // never worked also "stops working".
    expect(await keyStillAuthenticates(raw)).toBe(true);

    // The exact request the `revoke_api_key` row action declares, issued by the
    // persona whose My Keys grid renders that action.
    const revoked = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(revoked.status, await revoked.clone().text()).toBe(200);

    // The consequence — a 200 that leaves the key live is the defect wearing a
    // success code, and would pass a status-only check.
    expect(await keyStillAuthenticates(raw)).toBe(false);

    const { row } = await readKey(memberToken, id);
    expect(row.revoked).toBe(true);
  });

  it('[owner] restores their own key through the same route', async () => {
    const { id, raw } = await mintKey(memberToken, 'my-restorable-key');

    const off = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(off.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(false);

    const on = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { revoked: false });
    expect(on.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('[explain] the object_crud layer now grants update, and names `member_default`', async () => {
    // The card's second measurement, and a second consumer of the same
    // decision: `/security/explain` read as that member said "No resolved
    // permission set grants update on sys_api_key". If the fix is right, this
    // output has to move with it or the two consumers disagree.
    const res = await stack.apiAs(memberToken, 'GET', '/security/explain?object=sys_api_key&operation=update');
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();

    const crud = (body.layers ?? []).find((l: any) => l.layer === 'object_crud');
    expect(crud, 'explain must report an object_crud layer').toBeTruthy();
    expect(crud.verdict).toBe('grants');
    expect(String(crud.detail)).not.toContain('No resolved permission set grants');
    expect(
      (crud.contributors ?? []).map((c: any) => String(c.name)),
      'the grant must be attributed to the platform baseline, not to an admin set',
    ).toContain('member_default');
  });

  // ── the "Not affected" list: still not affected ───────────────────────────

  it('[cross-owner] a member may NOT revoke the admin\'s key — 403, row unchanged, key still live', async () => {
    // The row scope is the pre-existing `sys_api_key_self` RLS carve-out. This
    // is the assertion that proves the new grant is OWNER-scoped and not a
    // table-wide `update` on a credential table.
    const { id, raw } = await mintKey(adminToken, 'admins-key');
    expect(await keyStillAuthenticates(raw)).toBe(true);

    const res = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code ?? body.error?.code).toBe('PERMISSION_DENIED');

    // Refused, not merely reported as refused: the admin's key is untouched.
    const { row } = await readKey(adminToken, id);
    expect(row.revoked).toBe(false);
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('[column] a non-`revoked` column is still refused for the owner — 403 PERMISSION_DENIED', async () => {
    // The grant opens the ROW, the ADR-0092 D2 whitelist opens the COLUMN, and
    // the two are independent. `name` is innocuous — it is refused because it
    // is not whitelisted, not because it is dangerous.
    const { id, raw } = await mintKey(memberToken, 'dont-rename-me');

    const res = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { name: 'renamed' });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code ?? body.error?.code).toBe('PERMISSION_DENIED');

    // Refused, not silently degraded into a timestamp touch.
    const { row } = await readKey(memberToken, id);
    expect(row.name).toBe('dont-rename-me');
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('[column] credential columns are stripped even when smuggled alongside a legal `revoked`', async () => {
    // The whitelist STRIPS non-listed keys rather than rejecting the payload,
    // so a mixed patch is what decides whether the opening is column-scoped in
    // practice — now on the OWNER path, where the whitelist had never run.
    const { id, raw } = await mintKey(memberToken, 'smuggle-mine');
    const before = await readKey(memberToken, id);
    const originalOwner = before.row.user_id;
    expect(originalOwner).toBeTruthy();

    const res = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, {
      revoked: true,
      key: 'forged-hash-value',
      user_id: 'usr_someone_else',
    });
    expect(res.status).toBe(200);

    const after = await readKey(memberToken, id);
    expect(after.row.user_id, 're-owning a key is privilege transfer').toBe(originalOwner);
    expect(after.row.revoked).toBe(true);

    // The decisive proof that `key` was stripped: the ORIGINAL secret is still
    // what the row hashes to. A forged value would make this key unrecognised
    // rather than recognised-and-revoked — both answer 401, so assert it from
    // the other side by restoring and re-authenticating.
    const restored = await stack.apiAs(memberToken, 'PATCH', `/data/sys_api_key/${id}`, { revoked: false });
    expect(restored.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('[method] create and delete stay closed for the member (405, method gate)', async () => {
    // `update` was opened for the owner; `create` / `delete` were opened for
    // nobody. Minting stays on `POST /api/v1/keys` and rows are retired by
    // revoking, not deleting.
    const { id } = await mintKey(memberToken, 'immortal-mine');

    const created = await stack.apiAs(memberToken, 'POST', '/data/sys_api_key', { name: 'forged' });
    expect(created.status).toBe(405);
    expect((await created.json()).code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');

    const deleted = await stack.apiAs(memberToken, 'DELETE', `/data/sys_api_key/${id}`);
    expect(deleted.status).toBe(405);
    expect((await deleted.json()).code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
  });
});
