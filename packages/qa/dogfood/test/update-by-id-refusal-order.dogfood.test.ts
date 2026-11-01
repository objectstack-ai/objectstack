// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An update by id answers the same refusal whether or not the id exists, as
// delete does — measured at the HTTP data door of the stock showcase.
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// For a plain member (the everyone baseline only) on three object families
// the member may not update — a business junction object
// (`showcase_project_membership`), a platform grant object
// (`sys_user_permission_set`) and the two read-only federated objects
// (`showcase_ext_customer`, `showcase_ext_order`):
//
//   1. ⭐ `PATCH /data/:object/:id` answers the SAME status and body for an id
//      that names a row and for one that names none — the refusal the write
//      gets, judged before the row is looked up;
//   2. the bulk update doors (`updateMany`, `batch` with `operation: update`)
//      answer the same per-row refusal for both ids;
//   3. `DELETE` keeps the one answer it already gave for both;
//   4. ⭐ with a stale version token — `If-Match`, the PATCH body's
//      `expectedVersion`, the DELETE's `?expectedVersion` — PATCH and DELETE
//      answer the SAME status, code and sentence for both ids, and the answer
//      the same request gets without a token. So do two rows the member's row
//      scope hides on objects it reads (private OWD): an inquiry, which it may
//      not update, and a note, which it may update but not delete. The version
//      comparison answers only for a row the caller reads.
//
// Controls, so a green run is not "everything refuses":
//
//   - a member holding the object's edit grant (`showcase_ops`) updates an
//     in-scope row (200) and still gets `404 RECORD_NOT_FOUND` for an id that
//     names no row;
//   - a member holding edit with a row-level restriction
//     (`showcase_private_note`, private) gets one not-found answer for a row
//     out of its scope and for an id that names no row — the row-scope answer,
//     unchanged — and still updates its own row;
//   - the administrator updates (200) and gets `404` for an id that names no
//     row on an ordinary object; on a read-only federated object it gets the
//     write guard's refusal for both ids, as its DELETE does;
//   - with a stale token the edit-grant holder gets `409 CONCURRENT_UPDATE`
//     carrying the row, and with the current token it updates (200); the plain
//     member gets the same `409` on a row it reads but may not write;
//   - a refused write leaves the row untouched.
//
// The organization wall's half of item 4 — a row in another organization — is
// pinned in `occ-stale-token-organization-wall.dogfood.test.ts`.
//
// The engine-layer half of the order — the middleware chain's refusal comes
// before the by-id not-found gate — is pinned in
// `packages/objectql/src/engine-write-not-found-gate.test.ts`, and the data
// door's half in `packages/metadata-protocol/src/protocol.record-not-found.test.ts`
// and `protocol.bulk-record-not-found.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { onEnable } from '@objectstack/example-showcase';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';
import { catalogPermissionSet } from './catalog-permission-set.js';

const SYS = { isSystem: true } as const;
const MISSING = 'zz_no_such_row_0001';
const MEMBER = 'upd-order-member@verify.test';
const EDITOR = 'upd-order-editor@verify.test';

interface Answer { status: number; body: unknown }

/** The `code` of a flat (`{ code }`) or nested (`{ error: { code } }`) envelope. */
const codeOf = (a: Answer): unknown => (a.body as any)?.code ?? (a.body as any)?.error?.code;

/** The answer with the caller-supplied id written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer =>
  JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

/** A version token no row carries: one read before a write that moved the row on. */
const STALE = '2001-01-01T00:00:00.000Z';

/** Where a request carries its version token: nowhere, the `If-Match` header, or `expectedVersion`. */
type Carrier = 'none' | 'If-Match' | 'expectedVersion';

/** The id a create answered, wherever the envelope carries it. */
const createdId = (a: Answer): string => {
  const b = a.body as any;
  return String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');
};

/** The update payload each family is driven with — a value the object accepts. */
const PATCHES: Record<string, Record<string, unknown>> = {
  showcase_project_membership: { engagement: 'reviewer' },
  sys_user_permission_set: { reason: 'x' },
  showcase_ext_customer: { region: 'EU' },
  showcase_ext_order: { status: 'void' },
};

describe('update by id: one refusal whether or not the id exists, as delete', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let editorTok: string;
  const existing = new Map<string, string>();
  let foreignNoteId = '';
  let ownNoteId = '';
  let foreignInquiryId = '';
  let accountId = '';

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

  const stored = (object: string, id: string) => ql.findOne(object, { where: { id }, context: SYS });

  /**
   * A by-id PATCH or DELETE carrying `version` the way `carrier` names: the
   * PATCH body's `expectedVersion`, the DELETE's `?expectedVersion`, or the
   * `If-Match` header on either.
   */
  const versioned = (
    token: string,
    method: 'PATCH' | 'DELETE',
    object: string,
    id: string,
    patch: Record<string, unknown>,
    carrier: Carrier,
    version = STALE,
  ): Promise<Answer> => {
    const headers: Record<string, string> = carrier === 'If-Match' ? { 'If-Match': version } : {};
    if (method === 'PATCH') {
      const body = carrier === 'expectedVersion' ? { ...patch, expectedVersion: version } : patch;
      return call(token, 'PATCH', `/data/${object}/${id}`, body, headers);
    }
    const query = carrier === 'expectedVersion' ? `?expectedVersion=${encodeURIComponent(version)}` : '';
    return call(token, 'DELETE', `/data/${object}/${id}${query}`, undefined, headers);
  };

  beforeAll(async () => {
    // The federated objects' remote tables — the showcase's own fixture
    // provisioner, run the way `showcase-external-autoconnect` runs it.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    memberTok = await stack.signUp(MEMBER);
    editorTok = await stack.signUp(EDITOR);
    const ops = await catalogPermissionSet(ql, 'showcase_ops');
    expect(ops, 'showcase_ops served by the security catalog').toBeTruthy();
    const editorId = (await ql.findOne('sys_user', { where: { email: EDITOR }, context: SYS }))?.id;
    expect(editorId, 'editor provisioned').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: editorId, permission_set: ops.name }, { context: SYS });

    for (const object of Object.keys(PATCHES)) {
      const id = String((await ql.find(object, { limit: 1, context: SYS }))?.[0]?.id ?? '');
      expect(id, `a seeded ${object} row`).toBeTruthy();
      existing.set(object, id);
    }

    const foreign = await call(adminTok, 'POST', '/data/showcase_private_note', { title: 'admin note' });
    expect(foreign.status, `admin note created — ${JSON.stringify(foreign.body)}`).toBeLessThan(300);
    foreignNoteId = createdId(foreign);
    const own = await call(memberTok, 'POST', '/data/showcase_private_note', { title: 'member note' });
    expect(own.status, `member note created — ${JSON.stringify(own.body)}`).toBeLessThan(300);
    ownNoteId = createdId(own);
    expect(foreignNoteId && ownNoteId, 'both notes carry an id').toBeTruthy();

    const inquiry = await call(adminTok, 'POST', '/data/showcase_inquiry', {
      name: 'Admin inquiry', email: 'admin-inquiry@verify.test', message: 'owned by the administrator',
    });
    expect(inquiry.status, `admin inquiry created — ${JSON.stringify(inquiry.body)}`).toBeLessThan(300);
    foreignInquiryId = createdId(inquiry);
    accountId = String((await ql.find('showcase_account', { limit: 1, context: SYS }))?.[0]?.id ?? '');
    expect(foreignInquiryId && accountId, 'an inquiry and an account to aim at').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  for (const [object, patch] of Object.entries(PATCHES)) {
    it(`${object}: PATCH by id answers one refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const before = await stored(object, id);
      const hit = await call(memberTok, 'PATCH', `/data/${object}/${id}`, patch);
      const miss = await call(memberTok, 'PATCH', `/data/${object}/${MISSING}`, patch);

      expect(hit.status, `the member may not update ${object} — ${JSON.stringify(hit.body)}`).toBe(403);
      expect(withoutId(miss, MISSING), 'the answer for no row').toEqual(withoutId(hit, id));
      expect(await stored(object, id), 'a refused write leaves the row as it was').toEqual(before);
    });

    it(`${object}: DELETE by id keeps its one refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const hit = await call(memberTok, 'DELETE', `/data/${object}/${id}`);
      const miss = await call(memberTok, 'DELETE', `/data/${object}/${MISSING}`);

      expect(hit.status, JSON.stringify(hit.body)).toBe(403);
      expect(withoutId(miss, MISSING)).toEqual(withoutId(hit, id));
      expect(await stored(object, id), 'a refused delete leaves the row').toBeTruthy();
    });

    it(`${object}: the bulk update doors answer one per-row refusal for a row and for no row`, async () => {
      const id = existing.get(object)!;
      const many = (rid: string) =>
        call(memberTok, 'POST', `/data/${object}/updateMany`, { records: [{ id: rid, data: patch }] });
      const batch = (rid: string) =>
        call(memberTok, 'POST', `/data/${object}/batch`, { operation: 'update', records: [{ id: rid, data: patch }] });

      const manyHit = await many(id);
      expect((manyHit.body as any)?.results?.[0]?.errors?.[0]?.httpStatus, JSON.stringify(manyHit.body)).toBe(403);
      expect(withoutId(await many(MISSING), MISSING)).toEqual(withoutId(manyHit, id));
      const batchHit = await batch(id);
      expect((batchHit.body as any)?.results?.[0]?.errors?.[0]?.httpStatus, JSON.stringify(batchHit.body)).toBe(403);
      expect(withoutId(await batch(MISSING), MISSING)).toEqual(withoutId(batchHit, id));
    });
  }

  it('guard the guard: the member reads neither hidden row, and reads the account it may not write', async () => {
    for (const [object, id] of [['showcase_inquiry', foreignInquiryId], ['showcase_private_note', foreignNoteId]]) {
      const got = await call(memberTok, 'GET', `/data/${object}/${id}`);
      expect(got.status, `${object} — ${JSON.stringify(got.body)}`).toBe(404);
      expect(await stored(object, id), `${object}: the row is there`).toBeTruthy();
    }
    const account = await call(memberTok, 'GET', `/data/showcase_account/${accountId}`);
    expect(account.status, JSON.stringify(account.body)).toBe(200);
  });

  it('with a stale version token, PATCH and DELETE answer one status, code and sentence for a row and for no row — the answer without a token', async () => {
    const families: Array<{ object: string; id: string; patch: Record<string, unknown>; status: { PATCH: number; DELETE: number } }> = [
      { object: 'showcase_project_membership', id: existing.get('showcase_project_membership')!, patch: PATCHES.showcase_project_membership, status: { PATCH: 403, DELETE: 403 } },
      { object: 'sys_user_permission_set', id: existing.get('sys_user_permission_set')!, patch: PATCHES.sys_user_permission_set, status: { PATCH: 403, DELETE: 403 } },
      // Rows the member's row scope hides, on objects it reads: no update grant on
      // the inquiry, and update without delete on the note.
      { object: 'showcase_inquiry', id: foreignInquiryId, patch: { message: 'x' }, status: { PATCH: 403, DELETE: 403 } },
      { object: 'showcase_private_note', id: foreignNoteId, patch: { title: 'x' }, status: { PATCH: 404, DELETE: 403 } },
    ];
    for (const { object, id, patch, status } of families) {
      const before = await stored(object, id);
      for (const method of ['PATCH', 'DELETE'] as const) {
        const noToken = await versioned(memberTok, method, object, id, patch, 'none');
        expect(noToken.status, `${method} ${object} without a token — ${JSON.stringify(noToken.body)}`).toBe(status[method]);
        for (const carrier of ['If-Match', 'expectedVersion'] as const) {
          const where = `${method} ${object} (${carrier})`;
          const hit = await versioned(memberTok, method, object, id, patch, carrier);
          const miss = await versioned(memberTok, method, object, MISSING, patch, carrier);
          expect(withoutId(hit, id), `${where}: the answer without a token`).toEqual(withoutId(noToken, id));
          expect(withoutId(miss, MISSING), `${where}: the answer for no row`).toEqual(withoutId(hit, id));
        }
      }
      expect(await stored(object, id), `${object}: refused writes leave the row as it was`).toEqual(before);
    }
  });

  it('control: a stale token on a row the caller reads still answers 409 carrying the row; the current token updates', async () => {
    const id = existing.get('showcase_project_membership')!;
    const read = await call(editorTok, 'GET', `/data/showcase_project_membership/${id}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const current = String((read.body as any)?.record?.updated_at ?? '');
    expect(current, 'the row serves a version token').toBeTruthy();
    for (const carrier of ['If-Match', 'expectedVersion'] as const) {
      const stale = await versioned(editorTok, 'PATCH', 'showcase_project_membership', id, { engagement: 'reviewer' }, carrier);
      expect({ status: stale.status, code: codeOf(stale) }, `${carrier} — ${JSON.stringify(stale.body)}`).toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
      expect((stale.body as any)?.currentRecord?.id).toBe(id);
    }
    const fresh = await versioned(editorTok, 'PATCH', 'showcase_project_membership', id, { engagement: 'reviewer' }, 'If-Match', current);
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);

    // The plain member reads the account and may not write it: the 409 stays, and
    // the row it carries is one the member reads anyway.
    const before = await stored('showcase_account', accountId);
    for (const method of ['PATCH', 'DELETE'] as const) {
      const stale = await versioned(memberTok, method, 'showcase_account', accountId, { name: 'x' }, 'If-Match');
      expect({ status: stale.status, code: codeOf(stale) }, `${method} — ${JSON.stringify(stale.body)}`).toEqual({ status: 409, code: 'CONCURRENT_UPDATE' });
      expect((stale.body as any)?.currentRecord?.id).toBe(accountId);
    }
    expect(await stored('showcase_account', accountId)).toEqual(before);
  });

  it('control: a caller holding the edit grant updates an in-scope row and gets 404 for no row', async () => {
    const id = existing.get('showcase_project_membership')!;
    const ok = await call(editorTok, 'PATCH', `/data/showcase_project_membership/${id}`, { engagement: 'reviewer' });
    const miss = await call(editorTok, 'PATCH', `/data/showcase_project_membership/${MISSING}`, { engagement: 'reviewer' });

    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(miss.status, JSON.stringify(miss.body)).toBe(404);
    expect(codeOf(miss)).toBe('RECORD_NOT_FOUND');
  });

  it('control: edit with a row-level restriction keeps one not-found for a foreign row and for no row', async () => {
    const hit = await call(memberTok, 'PATCH', `/data/showcase_private_note/${foreignNoteId}`, { title: 'x' });
    const miss = await call(memberTok, 'PATCH', `/data/showcase_private_note/${MISSING}`, { title: 'x' });
    const own = await call(memberTok, 'PATCH', `/data/showcase_private_note/${ownNoteId}`, { title: 'mine, renamed' });

    expect(hit.status, JSON.stringify(hit.body)).toBe(404);
    expect(codeOf(hit)).toBe('RECORD_NOT_FOUND');
    expect(withoutId(miss, MISSING)).toEqual(withoutId(hit, foreignNoteId));
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((await stored('showcase_private_note', foreignNoteId))?.title).toBe('admin note');
  });

  it('control: the administrator updates, gets 404 for no row, and gets the write guard for both ids on a read-only federated object', async () => {
    const id = existing.get('showcase_project_membership')!;
    const ok = await call(adminTok, 'PATCH', `/data/showcase_project_membership/${id}`, { engagement: 'owner' });
    const miss = await call(adminTok, 'PATCH', `/data/showcase_project_membership/${MISSING}`, { engagement: 'owner' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(miss.status, JSON.stringify(miss.body)).toBe(404);
    expect(codeOf(miss)).toBe('RECORD_NOT_FOUND');

    const extId = existing.get('showcase_ext_customer')!;
    const extHit = await call(adminTok, 'PATCH', `/data/showcase_ext_customer/${extId}`, { region: 'EU' });
    const extMiss = await call(adminTok, 'PATCH', `/data/showcase_ext_customer/${MISSING}`, { region: 'EU' });
    const extDeleteMiss = await call(adminTok, 'DELETE', `/data/showcase_ext_customer/${MISSING}`);
    expect(extHit.status, JSON.stringify(extHit.body)).toBe(403);
    expect(codeOf(extHit)).toBe('EXTERNAL_WRITE_FORBIDDEN');
    expect(withoutId(extMiss, MISSING)).toEqual(withoutId(extHit, extId));
    expect({ status: extDeleteMiss.status, code: codeOf(extDeleteMiss) }).toEqual({ status: 403, code: 'EXTERNAL_WRITE_FORBIDDEN' });
  });
});
