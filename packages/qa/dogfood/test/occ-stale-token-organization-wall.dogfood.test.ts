// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A by-id PATCH or DELETE carrying a stale version token, aimed at a row in
// another organization, answers exactly what the same request answers without
// a token — measured at the HTTP data door of the showcase behind a real
// organization wall (`multiTenant: 'posture-only'`, the `isolated` posture).
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// A plain member of organization B (the showcase's everyone baseline only)
// aims at two rows of organization A, which the wall hides from its reads:
//
//   - an account (the member reads accounts and may not write them): PATCH
//     and DELETE answer the write refusal;
//   - a private note (the member may update notes and not delete them): PATCH
//     answers not-found, DELETE the write refusal.
//
// For each, with the token in `If-Match`, in the PATCH body's
// `expectedVersion` and in the DELETE's `?expectedVersion`, the answer —
// status, code and sentence — equals the answer without a token, and equals
// the answer for an id that names no row. The version comparison answers only
// for a row the caller reads.
//
// Controls, so a green run is not "every token is ignored":
//
//   - the wall is real (`isolated`, active, not degraded), the member is no
//     platform administrator, and it reads its own organization's rows and
//     neither of the other's;
//   - on rows of its own organization the member's stale token answers
//     `409 CONCURRENT_UPDATE` carrying the row — on the account it may not
//     write too — and the current token updates its own note (200);
//   - every refused write leaves the row as it was.
//
// The single-organization half (rows the row scope hides) is pinned in
// `update-by-id-refusal-order.dogfood.test.ts`, the data door's in
// `packages/metadata-protocol/src/protocol.record-not-found.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const OWNER_A = 'occ-wall-owner-a@verify.test';
const OWNER_B = 'occ-wall-owner-b@verify.test';
const MEMBER_B = 'occ-wall-member-b@verify.test';
const MISSING = 'zz_no_such_row_0001';
/** A version token no row carries: one read before a write that moved the row on. */
const STALE = '2001-01-01T00:00:00.000Z';

interface Answer { status: number; body: unknown }
type Carrier = 'none' | 'If-Match' | 'expectedVersion';

/** The `code` of a flat (`{ code }`) or nested (`{ error: { code } }`) envelope. */
const codeOf = (a: Answer): unknown => (a.body as any)?.code ?? (a.body as any)?.error?.code;

/** The answer with the caller-supplied id written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer =>
  JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');

describe('behind the organization wall, a stale version token on another organization\'s row answers what no token answers', () => {
  let stack: VerifyStack;
  let ql: any;
  let memberTok: string;
  let orgA = '';
  let orgB = '';
  let accountA = '';
  let noteA = '';
  let accountB = '';
  let noteB = '';

  const call = async (
    token: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Answer> => {
    const res = await stack.api(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };

  /**
   * A by-id PATCH or DELETE carrying `version` the way `carrier` names: the
   * PATCH body's `expectedVersion`, the DELETE's `?expectedVersion`, or the
   * `If-Match` header on either.
   */
  const versioned = (
    method: 'PATCH' | 'DELETE',
    object: string,
    id: string,
    patch: Record<string, unknown>,
    carrier: Carrier,
    version = STALE,
  ): Promise<Answer> => {
    const headers = carrier === 'If-Match' ? { 'If-Match': version } : {};
    if (method === 'PATCH') {
      const body = carrier === 'expectedVersion' ? { ...patch, expectedVersion: version } : patch;
      return call(memberTok, 'PATCH', `/data/${object}/${id}`, body, headers);
    }
    const query = carrier === 'expectedVersion' ? `?expectedVersion=${encodeURIComponent(version)}` : '';
    return call(memberTok, 'DELETE', `/data/${object}/${id}${query}`, undefined, headers);
  };

  const stored = (object: string, id: string) => ql.findOne(object, { where: { id }, context: SYS });
  const userId = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');

  /** A new organization, created and made active by its owner. */
  const organization = async (ownerEmail: string, name: string, slug: string): Promise<string> => {
    const owner = await stack.signUp(ownerEmail);
    const created = await stack.apiAs(owner, 'POST', '/auth/organization/create', { name, slug });
    expect(created.status, `org create ${slug}: ${await created.clone().text()}`).toBe(200);
    const id = String(((await created.json()) as { id: string }).id);
    const active = await stack.apiAs(owner, 'POST', '/auth/organization/set-active', { organizationId: id });
    expect(active.status, `set-active ${slug}: ${await active.clone().text()}`).toBe(200);
    return id;
  };

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync('objectql');

    orgA = await organization(OWNER_A, 'OCC Wall A', 'occ-wall-a');
    orgB = await organization(OWNER_B, 'OCC Wall B', 'occ-wall-b');

    // A plain member of organization B, active in it.
    memberTok = await stack.signUp(MEMBER_B);
    const memberId = await userId(MEMBER_B);
    expect(memberId, 'member provisioned').toBeTruthy();
    await ql.insert('sys_member', { user_id: memberId, organization_id: orgB, role: 'member' }, { context: SYS });
    const active = await stack.apiAs(memberTok, 'POST', '/auth/organization/set-active', { organizationId: orgB });
    expect(active.status, `member set-active: ${await active.clone().text()}`).toBe(200);

    // Organization A's rows, which the wall hides from the member.
    const ownerA = await userId(OWNER_A);
    accountA = idOf(await ql.insert('showcase_account', { name: 'Wall A account', status: 'active', organization_id: orgA }, { context: SYS }));
    noteA = idOf(await ql.insert('showcase_private_note', { title: 'Wall A note', owner_id: ownerA, organization_id: orgA }, { context: SYS }));

    // Organization B's rows, which the member reads.
    accountB = idOf(await ql.insert('showcase_account', { name: 'Wall B account', status: 'active', organization_id: orgB }, { context: SYS }));
    const own = await call(memberTok, 'POST', '/data/showcase_private_note', { title: 'Wall B note' });
    expect(own.status, `member note created — ${JSON.stringify(own.body)}`).toBeLessThan(300);
    noteB = idOf(own.body);
    expect(accountA && noteA && accountB && noteB, 'every row carries an id').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: a real wall, a member of B who is no platform administrator, reading B\'s rows and neither of A\'s', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean; degraded: boolean }>('tenancy');
    expect([tenancy.posture, tenancy.isolationActive, tenancy.degraded]).toEqual(['isolated', true, false]);
    expect(orgA).not.toBe(orgB);
    const session = (await (await stack.apiAs(memberTok, 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.isPlatformAdmin).not.toBe(true);
    expect(session.session?.activeOrganizationId).toBe(orgB);

    for (const [object, id] of [['showcase_account', accountA], ['showcase_private_note', noteA]]) {
      const got = await call(memberTok, 'GET', `/data/${object}/${id}`);
      expect(got.status, `${object} of A — ${JSON.stringify(got.body)}`).toBe(404);
      expect((await stored(object, id))?.organization_id, `${object}: the row lives in A`).toBe(orgA);
    }
    for (const [object, id] of [['showcase_account', accountB], ['showcase_private_note', noteB]]) {
      const got = await call(memberTok, 'GET', `/data/${object}/${id}`);
      expect(got.status, `${object} of B — ${JSON.stringify(got.body)}`).toBe(200);
    }
  });

  it('a row of A answers a stale token exactly as it answers no token, and as an id naming no row does', async () => {
    const families = [
      { object: 'showcase_account', id: accountA, patch: { name: 'x' }, status: { PATCH: 403, DELETE: 403 } },
      { object: 'showcase_private_note', id: noteA, patch: { title: 'x' }, status: { PATCH: 404, DELETE: 403 } },
    ];
    for (const { object, id, patch, status } of families) {
      const before = await stored(object, id);
      for (const method of ['PATCH', 'DELETE'] as const) {
        const noToken = await versioned(method, object, id, patch, 'none');
        expect(noToken.status, `${method} ${object} without a token — ${JSON.stringify(noToken.body)}`).toBe(status[method]);
        for (const carrier of ['If-Match', 'expectedVersion'] as const) {
          const where = `${method} ${object} (${carrier})`;
          const hit = await versioned(method, object, id, patch, carrier);
          const miss = await versioned(method, object, MISSING, patch, carrier);
          expect(withoutId(hit, id), `${where}: the answer without a token`).toEqual(withoutId(noToken, id));
          expect(withoutId(miss, MISSING), `${where}: the answer for no row`).toEqual(withoutId(hit, id));
        }
      }
      expect(await stored(object, id), `${object}: refused writes leave the row as it was`).toEqual(before);
    }
  });

  it('control: on rows of B the stale token still answers 409 carrying the row, and the current token updates', async () => {
    const accountBefore = await stored('showcase_account', accountB);
    for (const method of ['PATCH', 'DELETE'] as const) {
      const stale = await versioned(method, 'showcase_account', accountB, { name: 'x' }, 'If-Match');
      expect({ status: stale.status, code: codeOf(stale) }, `${method} account — ${JSON.stringify(stale.body)}`)
        .toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
      expect((stale.body as any)?.currentRecord?.id).toBe(accountB);
    }
    expect(await stored('showcase_account', accountB)).toEqual(accountBefore);

    const read = await call(memberTok, 'GET', `/data/showcase_private_note/${noteB}`);
    const current = String((read.body as any)?.record?.updated_at ?? '');
    expect(current, `the note serves a version token — ${JSON.stringify(read.body)}`).toBeTruthy();
    for (const carrier of ['If-Match', 'expectedVersion'] as const) {
      const stale = await versioned('PATCH', 'showcase_private_note', noteB, { title: 'x' }, carrier);
      expect({ status: stale.status, code: codeOf(stale) }, `${carrier} — ${JSON.stringify(stale.body)}`)
        .toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
      expect((stale.body as any)?.currentRecord?.id).toBe(noteB);
    }
    const fresh = await versioned('PATCH', 'showcase_private_note', noteB, { title: 'Wall B note, renamed' }, 'If-Match', current);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
    expect((await stored('showcase_private_note', noteB))?.title).toBe('Wall B note, renamed');
  });
});
