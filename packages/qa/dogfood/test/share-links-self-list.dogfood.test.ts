// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21328 — `GET /share-links` is SELF-SCOPED for every signed-in caller, as
 * ADR-0111's surface table rules it ("list is self-scoped"), not only for a
 * caller whose permission sets happen to grant `sys_share_link`.
 *
 * ## The defect
 *
 * Both share-link doors force `createdBy` to the caller and hand the list to
 * `ShareLinkService.listLinks`, which read `sys_share_link` under the CALLER's
 * context. The platform `member_default` set grants nothing on that object, so
 * every plain member's list was refused at the object-CRUD gate — with no
 * filter and with any object — and the console's Share dialog, which loads
 * this list on open, showed an error for every plain member on every record.
 * An admin's list answered 200, so an admin-driven test was green throughout:
 * the persona IS the gate, which is why every case here runs as a member.
 *
 * ## The fix under test, and what it must NOT do
 *
 * The service reads under the system context ONLY when the caller has a
 * non-empty user identity AND the creator filter is that identity, and returns
 * only rows the caller created — by the one creator rule `revokeLink` also
 * adjudicates with. So the refusals below are as load-bearing as the success:
 *
 *  - `[foreign]` member B's links and the admin's, minted on the SAME record,
 *    never appear in member A's list: not through the record filter, not
 *    without it, and not with a `createdBy` query parameter naming B (the door
 *    ignores it and forces the caller's own id).
 *  - `[no-grant]` the member still holds no `sys_share_link` grant: the fix is
 *    a scoped system read, never a permission-set widening, so the generic
 *    data door keeps refusing them the table.
 *  - `[admin]` the admin's list is unchanged: their own links only.
 *  - `[anonymous]` a caller with no identity never reaches the service.
 *  - `[secret]` the member's row carries its token (the console builds the URL
 *    from it) and never the password hash.
 *
 * ⚠️ Read `[foreign]`, `[admin]`, `[anonymous]` and `[no-grant]` honestly: on
 * the unfixed build they pass too — the member's list was refused outright,
 * so it could not show anyone's rows. They become load-bearing once the
 * member's list answers, which is exactly when they prove it answers narrowly.
 * A reverse verification of this file therefore expects the `[own]` / `[empty]`
 * / `[secret]` cases to move and the others to sit still.
 *
 * ## Why the members' links are minted through the service, not the route
 *
 * A plain showcase member can SEE no `publicSharing` object, and minting
 * through the route re-reads the record under the minter's context — so a
 * route mint would need a permission set that makes the member not plain.
 * Minting is not this file's subject (who may mint is a separate, open
 * question); listing is. So each member's links are minted through the very
 * service instance the door calls, under a system context that carries the
 * member's identity — `createLink` stamps `created_by` from it. The admin's
 * link goes through the real mint route.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_client_brief';
/** The seeded brief that satisfies the object's `eligibility` predicate. */
const PUBLISHED_BRIEF = 'Northwind — Website Relaunch brief';

const A_EMAIL = 'share-links.member-a.21328@verify.test';
const B_EMAIL = 'share-links.member-b.21328@verify.test';
const C_EMAIL = 'share-links.member-c.21328@verify.test';

/** The listed link ids, sorted — compared as a set, never as a count. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const idsOf = (rows: any[]): string[] => rows.map((r) => String(r?.id)).sort();

describe('#21328: GET /share-links is self-scoped for a plain member', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shareLinks: any;
  let adminTok = '';
  let aTok = '';
  let bTok = '';
  let cTok = '';
  let bId = '';
  let briefId = '';
  /** Member A's links: one password-protected, one plain. */
  let aLinks: string[] = [];
  let aProtected: { id: string; token: string } = { id: '', token: '' };
  let bLinks: string[] = [];
  let adminLinks: string[] = [];

  const userIdOf = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  /** Mint through the service the door calls, attributed to `userId`. */
  const mintFor = async (userId: string, extra: Record<string, unknown> = {}) =>
    shareLinks.createLink({ object: OBJECT, recordId: briefId, ...extra }, { isSystem: true, userId });

  /** `GET /share-links<query>` as whoever holds `token`. */
  const list = async (token: string | null, query = '') => {
    const path = `/share-links${query}`;
    const res = token === null ? await stack.api(path) : await stack.apiAs(token, 'GET', path);
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* the status still reports */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    return { status: res.status, text, body, rows };
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn(); // the seeded admin first, so the sign-ups below are plain members
    aTok = await stack.signUp(A_EMAIL);
    bTok = await stack.signUp(B_EMAIL);
    cTok = await stack.signUp(C_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    shareLinks = await stack.kernel.getServiceAsync(SHARE_LINK_SERVICE);
    expect(shareLinks, 'the sharing plugin registers the share-link service').toBeTruthy();

    const aId = await userIdOf(A_EMAIL);
    bId = await userIdOf(B_EMAIL);
    expect(aId && bId, 'both members exist').toBeTruthy();

    briefId = String((await ql.findOne(OBJECT, { where: { title: PUBLISHED_BRIEF }, context: SYS }))?.id ?? '');
    expect(briefId, 'the seeded published brief').toBeTruthy();

    const protectedLink = await mintFor(aId, { password: 'pw-21328', label: 'a-protected' });
    const plainLink = await mintFor(aId, { label: 'a-plain' });
    aProtected = { id: String(protectedLink.id), token: String(protectedLink.token) };
    aLinks = [String(protectedLink.id), String(plainLink.id)].sort();
    bLinks = [String((await mintFor(bId, { label: 'b-plain' })).id)];

    // The admin's link goes through the real mint door, on the SAME record.
    const minted = await stack.apiAs(adminTok, 'POST', '/share-links', { object: OBJECT, recordId: briefId });
    const mintedText = await minted.text();
    expect(minted.status, `admin mint: ${mintedText}`).toBe(201);
    adminLinks = [String(JSON.parse(mintedText)?.data?.id)];
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── the fixture's own preconditions ───────────────────────────────────────

  it('[persona] the member resolves the platform baseline, is no admin, and is denied sys_share_link at object CRUD', async () => {
    const res = await stack.apiAs(aTok, 'GET', '/security/explain?object=sys_share_link&operation=read');
    const text = await res.text();
    expect(res.status, text).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = JSON.parse(text)?.layers ?? [];
    const setNames = layers.flatMap((l) => l.contributors ?? []).map((c: { name?: unknown }) => String(c?.name));
    expect(setNames, 'a showcase member resolves the platform `member_default`').toContain('member_default');
    expect(setNames, 'the persona must not be an admin').not.toContain('admin_full_access');
    expect(
      layers.find((l) => l.layer === 'object_crud')?.verdict,
      'no set the member holds grants read on sys_share_link — the fix must not depend on one',
    ).toBe('denies');
  });

  it('[no-grant] the member holds no sys_share_link grant — the generic data door still refuses the table', async () => {
    const res = await stack.apiAs(aTok, 'GET', '/data/sys_share_link');
    const text = await res.text();
    expect(res.status, `the member must stay ungranted on sys_share_link: ${text}`).toBe(403);
    // The data door's refusal carries `code` at the top level.
    expect(JSON.parse(text)).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('[fixture] every link sits on the same record, so a record filter cannot separate them', async () => {
    const rows = await ql.find('sys_share_link', { where: { record_id: briefId }, context: SYS });
    expect(idsOf(rows)).toEqual([...aLinks, ...bLinks, ...adminLinks].sort());
  });

  // ── the defect ────────────────────────────────────────────────────────────

  it('[own] a plain member lists exactly their own links, with no filter', async () => {
    const res = await list(aTok);
    expect(res.status, res.text).toBe(200);
    expect(idsOf(res.rows)).toEqual(aLinks);
  });

  it('[own] the Share dialog\'s request — object + record — answers exactly the member\'s links on that record', async () => {
    const res = await list(aTok, `?object=${OBJECT}&recordId=${encodeURIComponent(briefId)}`);
    expect(res.status, res.text).toBe(200);
    expect(idsOf(res.rows), 'B\'s and the admin\'s links on the same record are absent').toEqual(aLinks);
  });

  it('[empty] a plain member with no links gets an empty list, not a refusal', async () => {
    const res = await list(cTok, `?object=${OBJECT}&recordId=${encodeURIComponent(briefId)}`);
    expect(res.status, res.text).toBe(200);
    expect(res.rows).toEqual([]);
  });

  it('[secret] the member\'s row carries its token and never the password hash', async () => {
    const res = await list(aTok);
    expect(res.status, res.text).toBe(200);
    const row = res.rows.find((r) => String(r?.id) === aProtected.id);
    expect(row, 'the password-protected link is listed').toBeTruthy();
    expect(row.token, 'the console builds the URL from the token').toBe(aProtected.token);
    expect(Object.keys(row), 'the hash is an internal column and never leaves').not.toContain('password_hash');
  });

  // ── what it must NOT widen ────────────────────────────────────────────────

  it('[foreign] a createdBy query naming another member is ignored — still only the caller\'s own links', async () => {
    const res = await list(aTok, `?createdBy=${encodeURIComponent(bId)}`);
    expect(res.status, res.text).toBe(200);
    expect(idsOf(res.rows)).toEqual(aLinks);
  });

  it('[foreign] member B sees only B\'s link, never A\'s', async () => {
    const res = await list(bTok);
    expect(res.status, res.text).toBe(200);
    expect(idsOf(res.rows)).toEqual(bLinks);
  });

  it('[admin] the admin\'s list is unchanged — their own link only', async () => {
    const res = await list(adminTok);
    expect(res.status, res.text).toBe(200);
    expect(idsOf(res.rows)).toEqual(adminLinks);
  });

  it('[anonymous] no identity never reaches the service', async () => {
    const res = await list(null);
    expect(res.status, res.text).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });
});
