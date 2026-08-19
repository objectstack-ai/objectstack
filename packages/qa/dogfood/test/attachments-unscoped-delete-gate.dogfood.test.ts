// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.attach-requires-parent-edit — the delete gate under an
// UNSCOPED (predicate-less) multi-delete AST.
//
// ## What this file does and does not claim
//
// The item's clause C3 says an unscoped multi-delete — no id AND no where — is
// "refused outright (#4757)", on the reasoning that "nothing was ever queried"
// must not read as "nothing to authorize". `attachment-access-hooks.ts` carries
// exactly that refusal, and `attachment-access-hooks.test.ts` pins it by calling
// the handler directly.
//
// Driven end to end through `ObjectQL.delete`, the refusal does NOT fire: the
// engine's predicate path dispatches `beforeDelete` PER ROW with `input.id`
// bound to each matched row (dispatchPerRowBeforeHooks), so the hook always
// takes its by-id branch and never reaches the `where === undefined` check. The
// measurement is recorded on the issue this file was written for; it is a
// PRODUCT gap, not a test gap, and this file deliberately does NOT pin the
// current behaviour — asserting today's outcome would turn the eventual fix red.
//
// What IS pinned here is the half that does hold and is worth guarding: an
// unscoped AST is not a way around the per-row gate, and the refusal is
// authoritative rather than cosmetic (nothing is deleted). Both sides are
// asserted, because a delete suite that only shows denials stays green on a
// surface that has stopped deleting anything at all.
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

  it('an unscoped multi-delete cannot slip past the per-row gate, and deletes NOTHING', async () => {
    // `{ multi: true }` with neither id nor where composes an AST over the whole
    // table. The member is the uploader of one row and neither uploader nor
    // parent-editor of the other, so the operation must fail — and fail as a
    // unit. A partial delete that took the row it was entitled to would be the
    // worst outcome: a refusal the caller reads as "nothing happened".
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(ql.delete('sys_attachment', { multi: true, context: ctx })).rejects.toMatchObject({
      code: 'ATTACHMENT_DELETE_DENIED',
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

  it('an empty `where: {}` is treated the same way — an empty predicate is still every row', async () => {
    const before = await rowCount();
    const ctx = await authzFor(memberTok);

    await expect(
      ql.delete('sys_attachment', { where: {}, multi: true, context: ctx }),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_DELETE_DENIED' });

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
