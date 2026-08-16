// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_comment record-level authorization (#4630) — the three repros from the
// issue, flipped, driven end-to-end through the REAL surfaces: better-auth
// sign-up members, the platform permission sets, the sharing service and the
// generic `/data` path.
//
// What the issue reported, on the SAME record with the SAME user:
//   GET  /data/cmt_private?$filter=…      → 200, 0 rows   (correct)
//   GET  /data/sys_attachment?parent_id=… → 200, 0 rows   (correct)
//   GET  /data/sys_comment?thread_id=…    → 200, 1 row    (the leak)
//   POST /data/sys_comment {thread_id:'cmt_private:'} → 201 (ungated write)
//
// Matrix legend:
//   (a) list/read a thread whose record the caller cannot read
//   (b) post to a thread whose record the caller cannot read
//   (c) malformed / dangling thread_id
//   (d) read is enough to comment; edit is what moderation needs
//   (e) author_id provenance stamping
//   (f) enable.feeds stays orthogonal, anonymous stays 401
//
// ⚠️ WHY THIS FILE IS ORG-BOUND, AND WHY THAT IS THE POINT ⚠️
//
// [#8408 / #8839] This file used to boot ORG-LESS, and the moderation half of
// case (d) — "a user who can EDIT the record may moderate anyone's comment on
// it" — was GREEN ONLY BECAUSE OF THAT. It was #8023's disarm, measured rather
// than suspected:
//
//   • the platform ships a wildcard row-level DELETE floor (`owner_only_deletes`,
//     object '*', `created_by == current_user.id`, positions ['org_member'] —
//     `plugin-security/src/objects/default-permission-sets.ts`);
//   • an org-less boot hands every sign-up `positions: ['everyone']`, so a
//     principal never held `org_member` and that floor NEVER APPLIED here;
//   • flipping the boot to `orgContext: true` and changing nothing else turned
//     the moderation assertion RED with `PERMISSION_DENIED` on `sys_comment`,
//     while the other 9 cases — including (d)'s FIRST half, the author deleting
//     their OWN comment — stayed green.
//
// So the capability `plugin-audit/src/comment-access-hooks.ts` describes as the
// "author-or-parent-editor rule" was refused by the platform floor before that
// rule was ever consulted, in every deployment that has an organization. The
// fixture was not evidence that moderation works; it was evidence that
// moderation works WHEN NOBODY IS AN ORG MEMBER.
//
// Maintainer ruling (2026-08-15, #8839 — reading 1): moderation is a declared,
// implemented capability and the platform delete floor must not pre-empt it.
// `member_default` now carries a per-object `sys_comment_moderation` delete
// policy (`id != null`, domained to `org_member`) contributing the alternate
// match, so the floor no longer answers first and plugin-audit's gate — the
// authority that can actually see the parent record — decides. The reading that
// case (d) over-claims a capability the platform does not offer was considered
// and REJECTED.
//
// This file is therefore now ARMED, and the arming is the pin: `orgContext:
// true` below plus `assertArmed`/`principalArmed` in `beforeAll`. ⛔ Do NOT
// "simplify" the boot back to org-less — that is not a cheaper fixture, it is
// this file certifying the moderation capability while structurally unable to
// observe the floor that used to kill it.
//
// What the 9 other cases are for, stated so nobody trims them: they are what
// demonstrates the widening is SCOPED to the moderation limb. Case (d)'s first
// half in particular — the author deleting their own comment, and a stranger
// without parent EDIT still refused — is the negative control. It is green both
// before and after the fix; only the refusal's PROVENANCE moves (the floor's
// `PERMISSION_DENIED` becomes the gate's `RECORD_NOT_ACCESSIBLE`), which is why
// it accepts either code.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { commentsFixtureStack, commentsFixtureSecurity } from './fixtures/comments-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;

/**
 * [#8074 / #8839] The control this file measures, and the default that silences
 * it. Named here so the failure message says what was disarmed rather than
 * which assertion happened to notice.
 */
const DELETE_FLOOR =
  "the platform's wildcard row-level DELETE floor (`owner_only_deletes`, " +
  "positions ['org_member']) and the `sys_comment_moderation` policy that now " +
  'contributes the author-or-parent-editor alternate match past it';
const DELETE_FLOOR_DISARM =
  'an org-less harness: no organization ⇒ no `sys_member` row ⇒ a fresh sign-up holds only ' +
  "`['everyone']` ⇒ neither the floor nor the moderation policy applies, and case (d)'s " +
  'moderation limb passes without ever exercising either. `orgContext: true` in the boot ' +
  'options below is what arms it.';

/** Extract the created record id from a REST create response ({id} | {record:{id}}). */
async function createdId(res: Response): Promise<string> {
  const j = (await res.json()) as any;
  const id = j.id ?? j.record?.id ?? j.data?.id;
  if (!id) throw new Error(`create response carried no id: ${JSON.stringify(j)}`);
  return String(id);
}

const rowsOf = async (res: Response): Promise<any[]> => ((await res.json()) as any).records ?? [];

describe('sys_comment permission matrix (#4630)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string, memberATok: string, memberBTok: string;
  let adminId: string, memberAId: string, memberBId: string;
  let openId: string; // cmt_open record — everyone reads AND edits
  let privateId: string; // cmt_private record owned by admin — only admin reads
  let readonlyId: string; // cmt_readonly record owned by admin — everyone reads, admin edits

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const comment = (token: string, threadId: string, body: string, extra: any = {}) =>
    stack.apiAs(token, 'POST', '/data/sys_comment', { thread_id: threadId, body, ...extra });

  beforeAll(async () => {
    stack = await bootStack(commentsFixtureStack as never, {
      security: commentsFixtureSecurity(),
      // AuditPlugin owns sys_comment: the #2707 enable.feeds gate AND the
      // #4630 record-level gates both ride on it.
      extraPlugins: [new AuditPlugin()],
      // [#8839] Org-bound on purpose — see the header. A `sys_member` row is
      // what makes a sign-up hold `org_member`, which is what brings BOTH the
      // wildcard delete floor and the `sys_comment_moderation` policy into
      // scope. Org-less, case (d)'s moderation limb measures neither.
      orgContext: true,
    });
    adminTok = await stack.signIn();
    memberATok = await stack.signUp('cmt-member-a@verify.test');
    memberBTok = await stack.signUp('cmt-member-b@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');
    memberAId = await uid('cmt-member-a@verify.test');
    memberBId = await uid('cmt-member-b@verify.test');

    // Domain grant (see commentManagerSet): both members may DELETE comments;
    // the everyone-anchor baseline carries no delete bit.
    const managerSet = await ql.findOne('sys_permission_set', { where: { name: 'cmt_comment_manager' }, context: SYS });
    expect(managerSet?.id, 'fixture permission set seeded').toBeTruthy();
    for (const userId of [memberAId, memberBId]) {
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: managerSet.id }, { context: { ...SYS } });
    }

    // [#8074 / #8839] The precondition the header records in prose, now read off
    // the live stack and enforced BEFORE anything is measured. Asserted here
    // rather than in an `it()` on purpose: a disarmed fixture must produce ZERO
    // green cells, and #8023's harm was exactly one green cell in a matrix that
    // otherwise looked healthy.
    //
    // BOTH members are probed, because they play both sides of the limb this
    // file exists to pin: memberA is the AUTHOR whose comment gets moderated,
    // memberB is the MODERATOR whose parent-EDIT right the floor used to
    // ignore. A probe on one of them alone would leave the other free to drift
    // org-less and re-disarm half the matrix. `cmt_comment_manager` is checked
    // too — without the delete BIT the request never reaches row-level
    // evaluation at all, and case (d) would pass on an RBAC refusal while
    // reading as a moderation result.
    await assertArmed([
      principalArmed({
        stack,
        token: memberATok,
        who: 'memberA (the comment AUTHOR)',
        positions: ['org_member'],
        permissions: ['cmt_comment_manager'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
      principalArmed({
        stack,
        token: memberBTok,
        who: 'memberB (the MODERATOR — parent-editor, not the author)',
        positions: ['org_member'],
        permissions: ['cmt_comment_manager'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
    ]);

    const openRes = await stack.apiAs(memberATok, 'POST', '/data/cmt_open', { name: 'open record' });
    expect(openRes.status).toBeLessThan(300);
    openId = await createdId(openRes);

    privateId = (await ql.insert('cmt_private', { name: 'admin only', owner_id: adminId }, { context: { ...SYS } })).id;
    readonlyId = (await ql.insert('cmt_readonly', { name: 'read all', owner_id: adminId }, { context: { ...SYS } })).id;
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── (a) the reported leak: LIST / READ ───────────────────────────────
  it('(a) a member CANNOT list or read comments whose record they cannot read', async () => {
    // Admin — who owns the private record — posts on its thread.
    const posted = await comment(adminTok, `cmt_private:${privateId}`, 'kickoff call booked with Apex procurement');
    expect(posted.status, await posted.text()).toBeLessThan(300);
    const row = await ql.findOne('sys_comment', { where: { thread_id: `cmt_private:${privateId}` }, context: SYS });
    expect(row?.id).toBeTruthy();

    // memberB cannot read the PARENT record — the control the issue points at.
    const parentRead = await stack.apiAs(memberBTok, 'GET', `/data/cmt_private/${privateId}`);
    expect([403, 404]).toContain(parentRead.status);

    // …so the thread is not listable either (unscoped list),
    const list = await stack.apiAs(memberBTok, 'GET', '/data/sys_comment');
    expect(list.status).toBe(200);
    expect((await rowsOf(list)).some((r: any) => r.id === row.id), 'comment on an invisible record must not be listable').toBe(false);

    // …nor via the exact query from the issue (scoped by thread_id),
    const scoped = await stack.apiAs(
      memberBTok,
      'GET',
      `/data/sys_comment?$filter=${encodeURIComponent(JSON.stringify(['thread_id', '=', `cmt_private:${privateId}`]))}`,
    );
    expect(scoped.status).toBe(200);
    expect(await rowsOf(scoped)).toHaveLength(0);

    // …nor by id.
    const byId = await stack.apiAs(memberBTok, 'GET', `/data/sys_comment/${row.id}`);
    expect([403, 404]).toContain(byId.status);

    // Control: the owner still sees their own thread.
    const ownerList = await stack.apiAs(adminTok, 'GET', '/data/sys_comment');
    expect((await rowsOf(ownerList)).some((r: any) => r.id === row.id)).toBe(true);
  });

  it('(a) the list total does not leak the hidden rows either', async () => {
    const list = await stack.apiAs(memberBTok, 'GET', '/data/sys_comment');
    const body = (await list.json()) as any;
    const rows = body.records ?? [];
    if (typeof body.total === 'number') expect(body.total).toBe(rows.length);
  });

  // ── (b) the reported ungated write ───────────────────────────────────
  it('(b) a member CANNOT post to a thread whose record they cannot read → 403', async () => {
    const denied = await comment(memberBTok, `cmt_private:${privateId}`, 'memberB should not be here');
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).code).toBe('RECORD_NOT_ACCESSIBLE');
    // and nothing was written
    const rows = await ql.find('sys_comment', { where: { body: 'memberB should not be here' }, context: SYS });
    expect(rows).toHaveLength(0);
  });

  // ── (c) the issue's literal payload: an empty record id ──────────────
  it('(c) a dangling or free-form thread_id is refused (the issue POSTed `cmt_private:` and got 201)', async () => {
    for (const threadId of [`cmt_private:`, 'watercooler', ':orphan', 'sys_comment:whatever']) {
      const res = await comment(memberATok, threadId, `dangling ${threadId}`);
      expect(res.status, `thread_id ${JSON.stringify(threadId)}`).toBe(403);
      expect(((await res.json()) as any).code).toBe('RECORD_NOT_ACCESSIBLE');
    }
    const written = await ql.find('sys_comment', { where: { thread_id: 'watercooler' }, context: SYS });
    expect(written).toHaveLength(0);
  });

  // ── (d) read is enough to comment; edit is what moderation needs ─────
  it('(d) a member who can only READ the record may still comment on it', async () => {
    // cmt_readonly is public_read: memberA reads it, only admin (owner) edits.
    const canRead = await stack.apiAs(memberATok, 'GET', `/data/cmt_readonly/${readonlyId}`);
    expect(canRead.status).toBe(200);
    const posted = await comment(memberATok, `cmt_readonly:${readonlyId}`, 'commenting without edit rights');
    expect(posted.status, await posted.clone().text()).toBeLessThan(300);
    // …and memberB, who can also read that record, sees it.
    const list = await stack.apiAs(memberBTok, 'GET', '/data/sys_comment');
    expect((await rowsOf(list)).some((r: any) => r.body === 'commenting without edit rights')).toBe(true);
  });

  it('(d) the author may delete their own comment; a stranger without parent EDIT may not', async () => {
    const posted = await comment(memberATok, `cmt_readonly:${readonlyId}`, 'memberA owns these words');
    expect(posted.status).toBeLessThan(300);
    const row = await ql.findOne('sys_comment', { where: { body: 'memberA owns these words' }, context: SYS });

    // memberB holds the delete bit and can READ the record, but is neither the
    // author nor able to EDIT the (admin-owned, public_read) parent → 403.
    // Which layer fires first (RBAC/RLS pre-image vs this gate) decides the
    // code; both are the fail-closed contract, as in the attachments matrix.
    const denied = await stack.apiAs(memberBTok, 'DELETE', `/data/sys_comment/${row.id}`);
    expect(denied.status).toBe(403);
    expect(['RECORD_NOT_ACCESSIBLE', 'PERMISSION_DENIED']).toContain(((await denied.json()) as any).code);
    expect(await ql.findOne('sys_comment', { where: { id: row.id }, context: SYS })).toBeTruthy();

    // The author may.
    const allowed = await stack.apiAs(memberATok, 'DELETE', `/data/sys_comment/${row.id}`);
    expect(allowed.status).toBeLessThan(300);
    expect(await ql.findOne('sys_comment', { where: { id: row.id }, context: SYS })).toBeFalsy();
  });

  it('(d) a user who can EDIT the record may moderate anyone\'s comment on it', async () => {
    // cmt_open is public_read_write → every member canEdit it.
    const posted = await comment(memberATok, `cmt_open:${openId}`, 'memberA on the open record');
    expect(posted.status).toBeLessThan(300);
    const row = await ql.findOne('sys_comment', { where: { body: 'memberA on the open record' }, context: SYS });
    const moderated = await stack.apiAs(memberBTok, 'DELETE', `/data/sys_comment/${row.id}`);
    expect(moderated.status, await moderated.clone().text()).toBeLessThan(300);
  });

  // ── (e) provenance ───────────────────────────────────────────────────
  it('(e) author_id is server-stamped from the session, overwriting a spoofed value', async () => {
    const posted = await comment(memberATok, `cmt_open:${openId}`, 'who wrote this?', { author_id: adminId });
    expect(posted.status).toBeLessThan(300);
    const row = await ql.findOne('sys_comment', { where: { body: 'who wrote this?' }, context: SYS });
    expect(row?.author_id, 'server identity wins over the spoofed author_id').toBe(memberAId);
  });

  // ── (f) the neighbours are unchanged ─────────────────────────────────
  it('(f) enable.feeds:false still answers FEEDS_DISABLED — the capability gate is orthogonal', async () => {
    const rec = await stack.apiAs(memberATok, 'POST', '/data/cmt_nofeeds', { name: 'no feeds' });
    expect(rec.status).toBeLessThan(300);
    const recId = await createdId(rec);
    // The caller CAN read and edit this record — only the capability gate refuses.
    const res = await comment(memberATok, `cmt_nofeeds:${recId}`, 'should be refused by the feeds gate');
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('FEEDS_DISABLED');
  });

  it('(f) anonymous is still refused before any of this (401)', async () => {
    const read = await stack.api('/data/sys_comment');
    expect(read.status).toBe(401);
    const write = await stack.api('/data/sys_comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: `cmt_open:${openId}`, body: 'anon' }),
    });
    expect(write.status).toBe(401);
  });
});
