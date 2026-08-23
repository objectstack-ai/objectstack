// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.attach-requires-parent-edit — the delete gate under an
// UNSCOPED (predicate-less) multi-delete AST.
//
// ## What this file claims
//
// The item's clause C3 says an unscoped multi-delete — no id AND no where — is
// "refused outright (#4757)", on the reasoning that "nothing was ever queried"
// must not read as "nothing to authorize". `attachment-access-hooks.ts` carries
// exactly that refusal, and `attachment-access-hooks.test.ts` pins it against a
// wired engine (#9797). This file pins it END TO END, on the real stack, where
// RBAC and plugin-sharing are in the path and the session is a real one.
//
// ## History — this file's original verdict has been OVERTAKEN, twice
//
// As first written, this file recorded that the refusal did NOT fire end to
// end: the engine's predicate path dispatched `beforeDelete` PER ROW with
// `input.id` bound, so the hook always took its by-id branch and never reached
// the `where === undefined` check. That was a PRODUCT gap (#9719), and this
// file deliberately declined to pin the behaviour of the day.
//
// It has since been fixed. #9719/PR #9797 added an opt-in whole-operation
// dispatch to the engine, which #9974 renamed `dispatchUnscopedMultiWrite` when
// it was ruled onto `beforeUpdate` as well. `attachment-access-hooks.ts`
// declares it on both sys_attachment write registrations, so the #4757 refusal
// now fires OUTRIGHT — dispatched once, before any row is resolved, zero-match
// included — with its own envelope (ATTACHMENT_DELETE_DENIED / 403 / the
// "Refusing an unscoped multi-…" message). Clause C3 is therefore pinnable as
// written, and is pinned here.
//
// ## The distinction this file exists to hold, and why the FIRST block cannot
//
// "Refused outright" and "the per-row gate refused every row" are different
// properties that look identical on a fixture whose rows split entitled/not —
// which is exactly the fixture the first block below uses. Measured on this
// suite: with `dispatchUnscopedMultiWrite` removed from BOTH registrations and
// service-storage rebuilt (the pre-#9797 world), the first block stays 5/5
// GREEN. It cannot see the refusal it is named for.
//
// So the second block seeds the ONE fixture that separates them: a caller who
// is the uploader of EVERY matched row, whom the per-row gate would happily
// let through. That is #9719's measured wipe (2 rows before, resolves, 0
// after), and it is the case that goes red without the dispatch.
//
// Both sides are asserted throughout, because a delete suite that only shows
// denials stays green on a surface that has stopped deleting anything at all.
//
// @proof: attachments-unscoped-delete-gate

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { resolveAuthzContext } from '@objectstack/core';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;

describe('sys_attachment delete gate under an unscoped multi-delete (#9483)', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string, memberTok: string;
  let adminId: string, memberId: string;
  let caseId: string, readonlyId: string;
  /** The member's OWN attachment on a parent they may edit. */
  let ownAttachmentId: string;
  /** Admin's attachment on a parent the member may READ but not EDIT. */
  let foreignAttachmentId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    return resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${token}` }),
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  const attach = async (token: string, parentObject: string, parentId: string) => {
    const fileId = await uploadFile(stack, token);
    const res = await stack.apiAs(token, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    });
    expect(res.status, `attach to ${parentObject}`).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
    return String(row.id);
  };

  const rowCount = () => ql.count('sys_attachment', { context: { ...SYS } });

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('att-unscoped-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');
    memberId = await uid('att-unscoped-member@verify.test');

    // The delete BIT first. Without it RBAC refuses ahead of the attachment
    // hook with PERMISSION_DENIED, and every assertion below would be green for
    // the wrong reason — a denial from a layer this file is not about.
    const managerSet = await ql.findOne('sys_permission_set', {
      where: { name: 'att_attachment_manager' },
      context: SYS,
    });
    expect(managerSet?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert(
      'sys_user_permission_set',
      { user_id: memberId, permission_set_id: managerSet.id },
      { context: { ...SYS } },
    );

    const caseRes = await stack.apiAs(memberTok, 'POST', '/data/att_case', { name: 'del case' });
    expect(caseRes.status).toBeLessThan(300);
    const caseBody = (await caseRes.json()) as any;
    caseId = String(caseBody.id ?? caseBody.record?.id ?? caseBody.data?.id);

    // att_readonly is public_read: the member READS it but only the owner
    // EDITS it — so admin's attachment on it is one the member may not detach.
    const ro = await ql.insert(
      'att_readonly',
      { name: 'del ro', owner_id: adminId },
      { context: { ...SYS } },
    );
    readonlyId = ro.id;

    ownAttachmentId = await attach(memberTok, 'att_case', caseId);
    foreignAttachmentId = await attach(adminTok, 'att_readonly', readonlyId);
  }, 180_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('control: the member holds the delete bit and the two rows really do split entitled/not', async () => {
    // Asserting the premise rather than assuming it. If the member lost the
    // delete grant, every refusal below would still be a refusal — from RBAC,
    // about a different question.
    expect(await rowCount()).toBe(2);
    const readsParent = await stack.apiAs(memberTok, 'GET', `/data/att_readonly/${readonlyId}`);
    expect(readsParent.status, 'the member CAN read the foreign parent').toBe(200);

    const own = await ql.findOne('sys_attachment', { where: { id: ownAttachmentId }, context: SYS });
    expect(own.uploaded_by, 'and uploaded one of the two rows').toBe(memberId);
  });

  it('an unscoped multi-delete is refused OUTRIGHT — on its shape — and deletes NOTHING', async () => {
    // `{ multi: true }` with neither id nor where composes an AST over the whole
    // table. Since #9797 the refusal that answers is #4757's whole-operation
    // one, dispatched BEFORE any row is resolved — not the per-row gate, which
    // on this fixture would also have refused (the member is the uploader of
    // one row and neither uploader nor parent-editor of the other).
    //
    // The MESSAGE is what tells the two apart, so it is asserted: without it
    // this case is satisfied by either rule and cannot detect the loss of the
    // one it is named for. Code + status pin the ADR-0112 envelope; the first
    // sentence IS the declared contract.
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(ql.delete('sys_attachment', { multi: true, context: ctx })).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
      message: expect.stringContaining('Refusing an unscoped multi-delete of attachments'),
    });

    expect(await rowCount(), 'the refusal is authoritative, not cosmetic').toBe(before);
    expect(
      await ql.findOne('sys_attachment', { where: { id: foreignAttachmentId }, context: SYS }),
    ).toBeTruthy();
    expect(
      await ql.findOne('sys_attachment', { where: { id: ownAttachmentId }, context: SYS }),
      'not even the row the caller WAS entitled to is taken',
    ).toBeTruthy();
  });

  it('an empty `where: {}` reaches the same verdict by a DIFFERENT rule — the per-row gate', async () => {
    // ⚠️ Same outcome, deliberately different mechanism, and the difference is
    // load-bearing. #9797 scoped the whole-operation dispatch to a delete with
    // NO `where` at all; a match-all `where: {}` is a real query, so it is NOT
    // refused on shape — it is refused here only because this caller cannot
    // have the foreign row. Asserting the per-row message is what keeps that
    // boundary honest: if #4757's refusal ever widened to swallow `where: {}`,
    // this case goes red instead of silently agreeing.
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(
      ql.delete('sys_attachment', { where: {}, multi: true, context: ctx }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
      message: expect.stringContaining('Cannot delete attachment'),
    });

    expect(await rowCount()).toBe(before);
  });

  it('a predicate that MATCHES NOTHING is allowed through — "nothing matched" is not a refusal', async () => {
    // The distinction the #4757 reasoning draws, and the half of it that is
    // live: a real query that resolved zero rows has genuinely nothing to
    // authorize, so it must not be refused. Without this case, a suite could be
    // satisfied by a surface that refuses every multi-delete outright — which
    // would look identical on the denial cases above.
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(
      ql.delete('sys_attachment', {
        where: { parent_id: 'no-such-parent-id' },
        multi: true,
        context: ctx,
      }),
    ).resolves.toBeDefined();

    expect(await rowCount(), 'and it removed nothing').toBe(before);
  });

  it('the caller is not globally denied: a SCOPED delete of their own row succeeds', async () => {
    // The positive side. Every assertion above is a denial, and denials alone
    // are satisfied by a delete path that is simply broken. This is the same
    // caller, the same object, the same session — differing only in scope.
    const before = await rowCount();
    const res = await stack.apiAs(memberTok, 'DELETE', `/data/sys_attachment/${ownAttachmentId}`);
    expect(res.status, 'the uploader may detach their own attachment').toBeLessThan(300);

    expect(await rowCount()).toBe(before - 1);
    expect(
      await ql.findOne('sys_attachment', { where: { id: ownAttachmentId }, context: SYS }),
    ).toBeFalsy();
    expect(
      await ql.findOne('sys_attachment', { where: { id: foreignAttachmentId }, context: SYS }),
      'and the row they were never entitled to is still there',
    ).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixture the block above cannot build: a caller entitled to EVERY row.
//
// Every assertion above is satisfied whether the refusal came from #4757's
// whole-operation rule or from the per-row gate, because that fixture holds one
// row the caller may not touch. Here the caller uploaded BOTH rows, so the
// per-row gate has nothing to refuse — anything that still refuses is refusing
// the SHAPE. Pre-#9797 this exact call resolved and emptied the table.
// ─────────────────────────────────────────────────────────────────────────────

describe('sys_attachment unscoped multi-delete is refused on its SHAPE, not on entitlement (#9483)', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let memberTok: string;
  let memberId: string;
  let caseId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const authzFor = async (token: string) => {
    const authService: any = await stack.kernel.getServiceAsync('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    return resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${token}` }),
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
  };

  const attach = async (token: string, parentObject: string, parentId: string) => {
    const fileId = await uploadFile(stack, token);
    const res = await stack.apiAs(token, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    });
    expect(res.status, `attach to ${parentObject}`).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
    return String(row.id);
  };

  const rowCount = () => ql.count('sys_attachment', { context: { ...SYS } });

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    await stack.signIn();
    memberTok = await stack.signUp('att-outright-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    memberId = await uid('att-outright-member@verify.test');

    // Same RBAC premise as the block above: without the delete bit the refusals
    // below would come from RBAC, about a different question entirely.
    const managerSet = await ql.findOne('sys_permission_set', {
      where: { name: 'att_attachment_manager' },
      context: SYS,
    });
    expect(managerSet?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert(
      'sys_user_permission_set',
      { user_id: memberId, permission_set_id: managerSet.id },
      { context: { ...SYS } },
    );

    const caseRes = await stack.apiAs(memberTok, 'POST', '/data/att_case', {
      name: 'outright case',
    });
    expect(caseRes.status).toBeLessThan(300);
    const caseBody = (await caseRes.json()) as any;
    caseId = String(caseBody.id ?? caseBody.record?.id ?? caseBody.data?.id);

    // BOTH rows uploaded by the member, on a parent the member owns and edits.
    await attach(memberTok, 'att_case', caseId);
    await attach(memberTok, 'att_case', caseId);
  }, 180_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('control: the caller uploaded EVERY row in the table, so the per-row gate has nothing to refuse', async () => {
    // The premise that makes this block different from the one above, asserted
    // rather than assumed. If a stray row the member cannot touch existed here,
    // the refusal below would prove nothing — it would be the per-row gate again.
    expect(await rowCount(), 'exactly the two rows this block seeded').toBe(2);
    const rows = await ql.find('sys_attachment', { context: { ...SYS } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.uploaded_by, 'every row is the caller’s own upload').toBe(memberId);
      expect(r.parent_id, 'and hangs off the parent they own').toBe(caseId);
    }
  });

  it('refuses `{ multi: true }` with no id and no where — even though the caller may delete every matched row', async () => {
    // #9719's measured wipe, end to end: before PR #9797 this call RESOLVED and
    // took both rows (2 -> 0). The per-row gate licenses each row individually,
    // so nothing but the whole-operation #4757 rule can refuse here — which is
    // what makes this the case that detects its removal.
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(ql.delete('sys_attachment', { multi: true, context: ctx })).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
      message: expect.stringContaining('Refusing an unscoped multi-delete of attachments'),
    });

    expect(await rowCount(), 'the refusal is authoritative, not cosmetic').toBe(before);
  });

  it('both sides: the SAME caller sweeps the SAME rows with a scoped predicate and succeeds', async () => {
    // Without this the block above is satisfied by a surface that refuses every
    // multi-delete, and by one where this caller simply cannot delete at all.
    // Same caller, same session, same rows — only the SHAPE differs.
    const ctx = await authzFor(memberTok);

    await expect(
      ql.delete('sys_attachment', { where: { parent_id: caseId }, multi: true, context: ctx }),
    ).resolves.toBeDefined();

    expect(await rowCount(), 'the sweep really did remove them').toBe(0);
  });

  it('refuses on an EMPTY table too — "nothing was ever queried" is not "nothing to authorize"', async () => {
    // The zero-match limb (#9719's fourth): the per-row dispatch is gated on
    // matched rows, so a handler-only fix can never fire here. A caller probing
    // against an empty table would otherwise see success and ship the unscoped
    // delete against a full one.
    expect(await rowCount(), 'the previous case emptied it').toBe(0);
    const ctx = await authzFor(memberTok);

    await expect(ql.delete('sys_attachment', { multi: true, context: ctx })).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
      status: 403,
      message: expect.stringContaining('Refusing an unscoped multi-delete of attachments'),
    });
  });

  it('control: the empty table is not refused per se — a scoped `where: {}` over it resolves', async () => {
    // Proves the refusal above measures the SHAPE and not the emptiness: the
    // same empty table, queried for real, deletes zero rows quietly.
    const ctx = await authzFor(memberTok);

    await expect(
      ql.delete('sys_attachment', { where: {}, multi: true, context: ctx }),
    ).resolves.toBeDefined();
  });
});
