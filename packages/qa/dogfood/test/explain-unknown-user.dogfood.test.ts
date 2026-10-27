// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26641 — `POST /security/explain` naming a `userId` that no `sys_user` row
 * has is refused `404 RECORD_NOT_FOUND`, naming the id, on the showcase boot.
 *
 * ## The defect
 *
 * The explainer builds the explained principal through the authorization
 * resolver, which synthesises the baseline anchor and sets for ANY id. So the
 * seed admin explaining `no_such_user_qa_123` was answered `200 allowed: true`
 * with principal `positions: ["everyone"]` and the member baseline sets, while
 * `GET /data/sys_user/no_such_user_qa_123` answered 404: a verdict about a
 * person who does not exist.
 *
 * ## The order of checks, pinned with the refusal
 *
 * The existence read runs only after the caller is admitted to explain someone
 * else, so the explain door cannot be used to learn which ids exist:
 *
 *  - `[anonymous]` no session → 401, whatever id the body names.
 *  - `[unprivileged]` a plain member naming the unknown id gets the same 403
 *    `PERMISSION_DENIED` it gets naming a user who exists.
 *  - `[unknown]` the seed admin naming the unknown id → 404 `RECORD_NOT_FOUND`
 *    naming it, for `read` and `create`, consistent with the data door's 404.
 *  - `[existing]` the seed admin explaining the member who exists is answered
 *    as before (200, the principal is that member), and explaining yourself is
 *    unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const SYS = { isSystem: true } as const;
const OBJECT = 'showcase_task';
const GHOST = 'no_such_user_qa_123';
const MEMBER_EMAIL = 'explain-unknown-user.member.26641@verify.test';

describe('#26641: security explain refuses a userId no sys_user row has', () => {
  let stack: VerifyStack;
  let adminTok = '';
  let memberTok = '';
  let adminId = '';
  let memberId = '';

  /** `POST /security/explain` as whoever holds `token` (`null` = no session). */
  const explain = async (token: string | null, body: Record<string, unknown>) => {
    const res = token === null
      ? await stack.api('/security/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      : await stack.apiAs(token, 'POST', '/security/explain', body);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* the status still reports */ }
    return { status: res.status, text, json };
  };

  beforeAll(async () => {
    stack = await bootShowcase({ security: showcaseAppDefaultSecurity() });
    adminTok = await stack.signIn(); // the seeded admin first, so the sign-up below is a plain member
    memberTok = await stack.signUp(MEMBER_EMAIL);
    const ql: any = await stack.kernel.getServiceAsync('objectql');
    memberId = String((await ql.findOne('sys_user', { where: { email: MEMBER_EMAIL }, context: SYS }))?.id ?? '');
    expect(memberId, 'the signed-up member exists').toBeTruthy();
    expect(await ql.findOne('sys_user', { where: { id: GHOST }, context: SYS }), 'no row carries the probe id').toBeFalsy();
    const me = await explain(adminTok, { object: OBJECT, operation: 'read' });
    expect(me.status, `admin self-explain: ${me.text}`).toBe(200);
    adminId = String(me.json?.principal?.userId ?? '');
    expect(adminId, 'the admin self-explanation names its principal').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('[control] the data door answers 404 for the same id', async () => {
    const res = await stack.apiAs(adminTok, 'GET', `/data/sys_user/${GHOST}`);
    expect(res.status).toBe(404);
  });

  it('[unknown] the seed admin is refused 404 RECORD_NOT_FOUND naming the id, for read and create', async () => {
    for (const operation of ['read', 'create']) {
      const r = await explain(adminTok, { object: OBJECT, operation, userId: GHOST });
      expect(r.status, `${operation}: ${r.text}`).toBe(404);
      expect(r.json?.success, r.text).toBe(false);
      expect(r.json?.error?.code, r.text).toBe('RECORD_NOT_FOUND');
      expect(String(r.json?.error?.message ?? ''), r.text).toContain(GHOST);
      expect(r.json?.allowed, 'no verdict is answered').toBeUndefined();
    }
  });

  it('[anonymous] no session is refused 401 before anything about the id', async () => {
    const r = await explain(null, { object: OBJECT, operation: 'read', userId: GHOST });
    expect(r.status, r.text).toBe(401);
  });

  it('[unprivileged] a plain member gets the same 403 for the unknown id as for a user who exists', async () => {
    const unknown = await explain(memberTok, { object: OBJECT, operation: 'read', userId: GHOST });
    const existing = await explain(memberTok, { object: OBJECT, operation: 'read', userId: adminId });
    for (const [label, r] of [['unknown id', unknown], ['existing user', existing]] as const) {
      expect(r.status, `${label}: ${r.text}`).toBe(403);
      expect(r.json?.error?.code, `${label}: ${r.text}`).toBe('PERMISSION_DENIED');
    }
  });

  it('[existing] the seed admin explaining the member who exists, and anyone explaining themselves, is answered', async () => {
    const other = await explain(adminTok, { object: OBJECT, operation: 'read', userId: memberId });
    expect(other.status, other.text).toBe(200);
    expect(other.json?.principal?.userId).toBe(memberId);
    expect(typeof other.json?.allowed).toBe('boolean');
    for (const body of [{ object: OBJECT, operation: 'read' }, { object: OBJECT, operation: 'read', userId: memberId }]) {
      const self = await explain(memberTok, body);
      expect(self.status, self.text).toBe(200);
      expect(self.json?.principal?.userId).toBe(memberId);
    }
  });
});
