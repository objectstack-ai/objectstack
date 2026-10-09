// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The `sys_attachment` and `sys_comment` parent gates judge a
// `controlled_by_parent` parent (ADR-0055) through its MASTER — the answer the
// parent's own `PATCH` gets — driven end-to-end through the REAL surfaces:
// better-auth sign-up members, the presigned upload, the generic `/data` path,
// plugin-sharing, plugin-security, service-storage and plugin-audit.
//
// ## What this suite pins
//
// Both gates ask the sharing service whether the caller may EDIT the parent.
// `effectiveSharingModel` maps `controlled_by_parent` to `public`, so
// `checkEdit` ABSTAINS on every such parent, and the gates used to read
// `canEdit`, which folds that abstention into `true`. A member holding the
// `sys_attachment` create or delete bit (or the `sys_comment` delete bit) then
// wrote on every master-detail child record of the org, including records whose
// own `PATCH` refuses them and records they cannot even read.
//
// The gates now read `checkEdit`, and on an abstention they ask the security
// service's master-detail write check (`checkControlledByParentWrite`), the
// check a by-id update of the parent runs. So each refusal below is pinned
// beside the `PATCH` of the same record by the same caller, which is the parity
// the fix promises, and beside the security service's own answer.
//
// ## Why the boot is org-bound
//
// The platform's wildcard delete floor binds `org_member` principals, and the
// alternate matches that service-storage and the `sys_comment_moderation`
// policy contribute are what let a delete reach the parent gates at all. An
// org-less boot would measure the gates in the one posture where no floor
// applies; `assertArmed` refuses it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAuthzContext } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { cpgStack, cpgSecurity } from './fixtures/cbp-parent-gates-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;

const DELETE_FLOOR =
  "the platform's wildcard row-level delete floor (`owner_only_deletes`, positions ['org_member']) " +
  'and the alternate matches that let a delete reach the attachment and comment parent gates';
const DELETE_FLOOR_DISARM =
  "an org-less harness: a fresh sign-up then holds only ['everyone'], so no floor applies and the " +
  'deletes below measure the gates in a posture no org-bound deployment has. `orgContext: true` arms it.';

async function createdId(res: Response): Promise<string> {
  const j = (await res.json()) as any;
  const id = j.id ?? j.record?.id ?? j.data?.id;
  if (!id) throw new Error(`create response carried no id: ${JSON.stringify(j)}`);
  return String(id);
}

/** Status plus the error code, for an assertion message that shows the whole answer. */
async function answer(res: Response): Promise<{ status: number; code: string | undefined; body: string }> {
  const body = await res.text();
  let code: string | undefined;
  try {
    const j = JSON.parse(body) as any;
    code = j?.code ?? j?.error?.code;
  } catch {
    code = undefined;
  }
  return { status: res.status, code, body };
}

/** Drive the REAL presigned three-step upload; returns the fileId. */
async function uploadFile(stack: VerifyStack, token: string): Promise<string> {
  const auth: Record<string, string> = { Authorization: `Bearer ${token}` };
  const presignRes = await stack.api('/storage/upload/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ filename: 'quote.pdf', mimeType: 'text/plain', size: 5, scope: 'attachments' }),
  });
  expect(presignRes.status, 'presign').toBe(200);
  const { data } = (await presignRes.json()) as any;
  const putPath = String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, '');
  const putRes = await stack.raw(putPath, {
    method: 'PUT',
    headers: data.headers ?? { 'content-type': 'text/plain' },
    body: 'hello',
  });
  expect(putRes.status, 'raw PUT').toBeLessThan(300);
  const completeRes = await stack.api('/storage/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ fileId: data.fileId }),
  });
  expect(completeRes.status, 'complete').toBe(200);
  return data.fileId as string;
}

describe('controlled_by_parent parent gates: sys_attachment and sys_comment judge the master (ADR-0055)', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let adminId: string;
  let memberId: string;
  /** Admin-owned `public_read` master: the member reads it and may not edit it. */
  let adminAccountId: string;
  /** A child of it: the member reads it and its own PATCH refuses them. */
  let contractId: string;
  /** Member-owned master and its child: the member may edit both. */
  let memberContractId: string;
  /** A child of an admin-owned PRIVATE master: the member cannot read it at all. */
  let vaultItemId: string;
  /** The control: a `public_read_write` parent. */
  let boardId: string;

  const uid = async (email: string) => (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const attach = (token: string, parentObject: string, parentId: string, fileId: string) =>
    stack.apiAs(token, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'quote.pdf',
      mime_type: 'text/plain',
      size: 5,
    });

  /** The security service's own master-detail answer for this caller, read through the real request path. */
  const memberAnswer = async (token: string, object: string, recordId: string) => {
    const authService = await stack.kernel.getServiceAsync<any>('auth');
    let api: any = authService?.api;
    if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
    const context = await resolveAuthzContext({
      ql,
      headers: new Headers({ authorization: `Bearer ${token}` }),
      getSession: async (h: any) => api?.getSession?.({ headers: h }),
    });
    const security = await stack.kernel.getServiceAsync<any>('security');
    expect(typeof security?.checkControlledByParentWrite, 'the security service serves the master-detail write check').toBe(
      'function',
    );
    return security.checkControlledByParentWrite(object, recordId, context);
  };

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'cpg-dogfood-'));
    stack = await bootStack(cpgStack as never, {
      security: cpgSecurity(),
      orgContext: true,
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
      ],
    });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('cpg-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');
    memberId = await uid('cpg-member@verify.test');

    const domainSet = await ql.findOne('sys_permission_set', { where: { name: 'cpg_files_and_threads' }, context: SYS });
    expect(domainSet?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: memberId, permission_set_id: domainSet.id }, { context: { ...SYS } });

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member (attachment and comment manager, not the master owner)',
        positions: ['org_member'],
        permissions: ['cpg_files_and_threads'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
    ]);

    adminAccountId = (await ql.insert('cpg_account', { name: 'admin account', owner_id: adminId }, { context: { ...SYS } })).id;
    contractId = (await ql.insert('cpg_contract', { name: 'executed contract', account: adminAccountId }, { context: { ...SYS } })).id;
    const memberAccountId = (await ql.insert('cpg_account', { name: 'member account', owner_id: memberId }, { context: { ...SYS } })).id;
    memberContractId = (
      await ql.insert('cpg_contract', { name: 'member contract', account: memberAccountId }, { context: { ...SYS } })
    ).id;
    const vaultId = (await ql.insert('cpg_vault', { name: 'admin vault', owner_id: adminId }, { context: { ...SYS } })).id;
    vaultItemId = (await ql.insert('cpg_vault_item', { name: 'vault item', vault: vaultId }, { context: { ...SYS } })).id;
    const boardRes = await stack.apiAs(adminTok, 'POST', '/data/cpg_board', { name: 'open board' });
    expect(boardRes.status, 'board create').toBeLessThan(300);
    boardId = await createdId(boardRes);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('precondition: the member reads the master and the child, and the PATCH of either refuses them', async () => {
    expect((await stack.apiAs(memberTok, 'GET', `/data/cpg_account/${adminAccountId}`)).status, 'member reads the master').toBe(200);
    expect((await stack.apiAs(memberTok, 'GET', `/data/cpg_contract/${contractId}`)).status, 'member reads the child').toBe(200);
    const patchMaster = await answer(await stack.apiAs(memberTok, 'PATCH', `/data/cpg_account/${adminAccountId}`, { name: 'x' }));
    expect(patchMaster.status, `member PATCH of the master: ${patchMaster.body}`).toBe(403);
    const patchChild = await answer(await stack.apiAs(memberTok, 'PATCH', `/data/cpg_contract/${contractId}`, { name: 'x' }));
    expect(patchChild.status, `member PATCH of the child: ${patchChild.body}`).toBe(403);
    expect(patchChild.code).toBe('PERMISSION_DENIED');
  });

  it('PATCH parity: the security service answers the child as its PATCH does, for the member and for the owner', async () => {
    // The member's PATCH of the child is refused by the master check, on the
    // leg the security service names: the platform's ownership floor on the
    // master (`created_by`, org_member) stands, because record sharing gives
    // the member no basis to lift it, so the master's write row-level security
    // excludes the row.
    const patchChild = await answer(await stack.apiAs(memberTok, 'PATCH', `/data/cpg_contract/${contractId}`, { name: 'x' }));
    expect(patchChild.status, `member PATCH of the child: ${patchChild.body}`).toBe(403);
    expect(patchChild.body).toContain('requires edit access to its master record');
    expect(patchChild.body).toContain('(row-level security)');
    expect(await memberAnswer(memberTok, 'cpg_contract', contractId)).toEqual({ outcome: 'deny', leg: 'row_level_security' });
    expect(await memberAnswer(adminTok, 'cpg_contract', contractId)).toEqual({ outcome: 'allow' });
    expect(await memberAnswer(memberTok, 'cpg_contract', memberContractId)).toEqual({ outcome: 'allow' });
    expect(await memberAnswer(memberTok, 'cpg_board', boardId)).toEqual({ outcome: 'not_applicable' });

    const ownerPatch = await answer(await stack.apiAs(adminTok, 'PATCH', `/data/cpg_contract/${contractId}`, { name: 'executed contract' }));
    expect(ownerPatch.status, `owner PATCH of the child: ${ownerPatch.body}`).toBe(200);
    const memberOwnPatch = await answer(
      await stack.apiAs(memberTok, 'PATCH', `/data/cpg_contract/${memberContractId}`, { name: 'member contract' }),
    );
    expect(memberOwnPatch.status, `member PATCH of a child under their own master: ${memberOwnPatch.body}`).toBe(200);
  });

  it('attach on a child whose master the member cannot edit is REFUSED (403 ATTACHMENT_PARENT_ACCESS), and nothing is attached', async () => {
    const fileId = await uploadFile(stack, memberTok);
    const res = await answer(await attach(memberTok, 'cpg_contract', contractId, fileId));
    expect(res.status, `attach on the child: ${res.body}`).toBe(403);
    expect(res.code).toBe('ATTACHMENT_PARENT_ACCESS');
    expect(await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS })).toBeNull();
  });

  it('attach on a child the member cannot even read is REFUSED (403 ATTACHMENT_PARENT_ACCESS)', async () => {
    const read = await stack.apiAs(memberTok, 'GET', `/data/cpg_vault_item/${vaultItemId}`);
    expect(read.status, 'precondition: the member cannot read the vault item').toBe(404);
    const fileId = await uploadFile(stack, memberTok);
    const res = await answer(await attach(memberTok, 'cpg_vault_item', vaultItemId, fileId));
    expect(res.status, `attach on the unreadable child: ${res.body}`).toBe(403);
    expect(res.code).toBe('ATTACHMENT_PARENT_ACCESS');
    expect(await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS })).toBeNull();
  });

  it('control: the master owner attaches to the child, and the member attaches to a child of their own master', async () => {
    const ownerFile = await uploadFile(stack, adminTok);
    const owner = await answer(await attach(adminTok, 'cpg_contract', contractId, ownerFile));
    expect(owner.status, `owner attach: ${owner.body}`).toBe(201);
    const memberFile = await uploadFile(stack, memberTok);
    const member = await answer(await attach(memberTok, 'cpg_contract', memberContractId, memberFile));
    expect(member.status, `member attach under their own master: ${member.body}`).toBe(201);
  });

  it('control: a public_read_write parent still admits the member (abstention there is permission)', async () => {
    const fileId = await uploadFile(stack, memberTok);
    const res = await answer(await attach(memberTok, 'cpg_board', boardId, fileId));
    expect(res.status, `attach on the public_read_write board: ${res.body}`).toBe(201);
  });

  it("delete of another user's file on the child is REFUSED (403 ATTACHMENT_DELETE_DENIED), and the file stays", async () => {
    const ownerFile = await uploadFile(stack, adminTok);
    const attached = await answer(await attach(adminTok, 'cpg_contract', contractId, ownerFile));
    expect(attached.status, `owner attach: ${attached.body}`).toBe(201);
    const row = await ql.findOne('sys_attachment', { where: { file_id: ownerFile }, context: SYS });
    expect(row?.id).toBeTruthy();

    const res = await answer(await stack.apiAs(memberTok, 'DELETE', `/data/sys_attachment/${row.id}`));
    expect(res.status, `member delete of the owner's file: ${res.body}`).toBe(403);
    expect(res.code).toBe('ATTACHMENT_DELETE_DENIED');
    expect(await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS }), 'the file survives').not.toBeNull();
  });

  it('control: the uploader deletes their own file on that child', async () => {
    const fileId = await uploadFile(stack, memberTok);
    const own = await ql.insert(
      'sys_attachment',
      {
        parent_object: 'cpg_contract',
        parent_id: contractId,
        file_id: fileId,
        file_name: 'quote.pdf',
        mime_type: 'text/plain',
        size: 5,
        uploaded_by: memberId,
      },
      { context: { ...SYS } },
    );
    const res = await answer(await stack.apiAs(memberTok, 'DELETE', `/data/sys_attachment/${own.id}`));
    expect(res.status, `uploader delete: ${res.body}`).toBe(200);
  });

  it("comment delete of another user's comment on the child is REFUSED (403 RECORD_NOT_ACCESSIBLE), and the comment stays", async () => {
    const posted = await answer(
      await stack.apiAs(adminTok, 'POST', '/data/sys_comment', { thread_id: `cpg_contract:${contractId}`, body: 'executed by legal' }),
    );
    expect(posted.status, `owner comment: ${posted.body}`).toBeLessThan(300);
    const row = await ql.findOne('sys_comment', { where: { body: 'executed by legal' }, context: SYS });
    expect(row?.id).toBeTruthy();

    const res = await answer(await stack.apiAs(memberTok, 'DELETE', `/data/sys_comment/${row.id}`));
    expect(res.status, `member delete of the owner's comment: ${res.body}`).toBe(403);
    expect(res.code).toBe('RECORD_NOT_ACCESSIBLE');
    expect(await ql.findOne('sys_comment', { where: { id: row.id }, context: SYS }), 'the comment survives').not.toBeNull();
  });

  it('control: the author deletes their own comment on that child, and the master owner moderates it', async () => {
    const mine = await answer(
      await stack.apiAs(memberTok, 'POST', '/data/sys_comment', { thread_id: `cpg_contract:${contractId}`, body: 'member note one' }),
    );
    expect(mine.status, `member comment: ${mine.body}`).toBeLessThan(300);
    const own = await ql.findOne('sys_comment', { where: { body: 'member note one' }, context: SYS });
    const authorDelete = await answer(await stack.apiAs(memberTok, 'DELETE', `/data/sys_comment/${own.id}`));
    expect(authorDelete.status, `author delete: ${authorDelete.body}`).toBe(200);

    const second = await answer(
      await stack.apiAs(memberTok, 'POST', '/data/sys_comment', { thread_id: `cpg_contract:${contractId}`, body: 'member note two' }),
    );
    expect(second.status, `member comment: ${second.body}`).toBeLessThan(300);
    const moderated = await ql.findOne('sys_comment', { where: { body: 'member note two' }, context: SYS });
    const ownerDelete = await answer(await stack.apiAs(adminTok, 'DELETE', `/data/sys_comment/${moderated.id}`));
    expect(ownerDelete.status, `master owner moderates: ${ownerDelete.body}`).toBe(200);
  });
});
