// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Attachments v1 follow-ups (#2755) — the non-admin permission matrix the
// original E2E (#2742, seeded admin only) never exercised, plus the
// sys_file orphan-lifecycle proof, driven end-to-end through the REAL
// surfaces: better-auth sign-up members, the presigned three-step upload,
// the generic /data path, and the platform LifecycleService sweep.
//
// Matrix legend (letters reference the gap inventory in the #2755 plan):
//   (a) delete-anyone's-attachment  → uploader-or-parent-editor gate
//       (#21729: the parent-editor limb, reachable past the platform floor)
//   (b) attach-to-invisible-record  → parent read-visibility gate
//   (c) attachment LISTING does not inherit parent visibility — KNOWN GAP
//   (e) anonymous uploads           → session gate; anonymous downloads — KNOWN GAP
//   (f) spoofable uploaded_by       → server stamping
//   (g) tenant isolation            → multiTenant block
//
// @proof: attachments-permission-matrix
//
// [#21729] The matrix below boots ORG-BOUND, and the arming is the pin. The
// platform's wildcard row-level delete floor (`owner_only_deletes`:
// `created_by == current_user.id`, positions ['org_member']) binds only a
// principal holding `org_member`, and an org-less boot hands every sign-up
// `['everyone']` — so this file used to measure the delete gate in the one
// posture where the floor never applied. That is how a parent-record editor's
// delete of someone else's attachment was refused (403 `PERMISSION_DENIED`, by
// the floor, before the gate ran) in every org-bound deployment while case (a)
// accepted "either code" and stayed green. Booted org-bound, case (a) measures
// the composition a real member meets: the floor, the alternate match
// `service-storage` contributes beside its gate (delete limb only), and the gate.
// ⛔ Do not "simplify" the boot back to org-less. The `assertArmed` probe in
// `beforeAll` refuses such a boot outright; without it, the parent-editor 200
// and the readable-non-editor `ATTACHMENT_DELETE_DENIED` would both pass with
// neither the floor nor the alternate match ever in play — certifying the fix
// in the one posture where there was nothing to fix.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';
import { organizationsAvailable, warnIfUnavailable } from './enterprise-organizations.js';
import { assertArmed, principalArmed } from './armed.js';
import { SysAttachment } from '@objectstack/platform-objects/audit';

const SYS = { isSystem: true } as const;
const DAY_MS = 86_400_000;

/**
 * [#21729] The control case (a) measures, and the default that silences it —
 * named so a disarm fails the file saying what was disarmed.
 */
const DELETE_FLOOR =
  "the platform's wildcard row-level delete floor (`owner_only_deletes`, positions ['org_member']) " +
  "and the delete-only alternate match service-storage contributes beside the attachment gate";
const DELETE_FLOOR_DISARM =
  "an org-less harness: no organization ⇒ a fresh sign-up holds only ['everyone'] ⇒ the floor never " +
  "applies, so case (a) measures the gate alone and cannot see the floor pre-empt it. `orgContext: true` " +
  'in the matrix boot below is what arms it.';

/** Extract the created record id from a REST create response ({id} | {record:{id}}). */
async function createdId(res: Response): Promise<string> {
  const j = (await res.json()) as any;
  const id = j.id ?? j.record?.id ?? j.data?.id;
  if (!id) throw new Error(`create response carried no id: ${JSON.stringify(j)}`);
  return String(id);
}

function bootFixture(extra: { multiTenant?: boolean; orgContext?: boolean } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'att-dogfood-'));
  return {
    rootDir,
    stack: bootStack(attachmentsFixtureStack as never, {
      ...extra,
      security: attachmentsFixtureSecurity(),
      extraPlugins: [
        // The real `objectstack dev` pairing for the attachments surface:
        // storage (sys_file/sys_attachment + routes + lifecycle hooks) and
        // audit (the #2727 enable.files FILES_DISABLED gate).
        // `bindToSettings:false` keeps the constructor rootDir — the settings
        // live-wire would swap in a './storage' adapter and the fs asserts
        // below would point at the wrong directory.
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
      ],
    }),
  };
}

/** Drive the REAL presigned three-step upload; returns the fileId. */
async function uploadFile(stack: VerifyStack, token: string | null, name = 'hello.txt'): Promise<string> {
  // Typed as a header record rather than inferred: the ternary would otherwise
  // widen to `{ Authorization?: undefined }` on the anonymous branch, which the
  // spread carries into `headers` and `HeadersInit` (Record< string, string >)
  // rightly refuses.
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const presignRes = await stack.api('/storage/upload/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ filename: name, mimeType: 'text/plain', size: 5, scope: 'attachments' }),
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

describe('attachments permission matrix (#2755)', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let lifecycle: any;
  let adminTok: string, memberATok: string, memberBTok: string, baselineTok: string;
  let adminId: string, memberAId: string, memberBId: string;
  let caseAId: string; // att_case record created by memberA
  let secretId: string; // att_secret record owned by admin

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const attach = (token: string, parentObject: string, parentId: string, fileId: string, extra: any = {}) =>
    stack.apiAs(token, 'POST', '/data/sys_attachment', {
      parent_object: parentObject,
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: 5,
      ...extra,
    });

  beforeAll(async () => {
    // [#21729] Org-bound on purpose — see the header.
    const boot = bootFixture({ orgContext: true });
    rootDir = boot.rootDir;
    stack = await boot.stack;
    adminTok = await stack.signIn();
    memberATok = await stack.signUp('att-member-a@verify.test');
    memberBTok = await stack.signUp('att-member-b@verify.test');
    baselineTok = await stack.signUp('att-baseline@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    lifecycle = await stack.kernel.getServiceAsync('lifecycle');
    adminId = await uid('admin@objectos.ai');
    memberAId = await uid('att-member-a@verify.test');
    memberBId = await uid('att-member-b@verify.test');

    // Domain grant (see attachmentManagerSet): memberA/memberB manage
    // attachments; the baseline member deliberately keeps only the
    // `member_default` everyone-anchor baseline (no delete bit anywhere).
    const managerSet = await ql.findOne('sys_permission_set', { where: { name: 'att_attachment_manager' }, context: SYS });
    expect(managerSet?.id, 'fixture permission set seeded').toBeTruthy();
    for (const userId of [memberAId, memberBId]) {
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: managerSet.id }, { context: { ...SYS } });
    }

    // [#21729] The precondition the header records, read off the live stack
    // before anything is measured: both members hold `org_member` (so the floor
    // binds them) and the delete bit (so a delete reaches row-level evaluation
    // at all, instead of passing case (a) on an RBAC refusal). memberA is the
    // UPLOADER whose attachment gets deleted, memberB the PARENT EDITOR (and the
    // non-editor elsewhere); a probe on one alone would leave the other free to
    // drift org-less and disarm half the case.
    await assertArmed([
      principalArmed({
        stack,
        token: memberATok,
        who: 'memberA (the uploader)',
        positions: ['org_member'],
        permissions: ['att_attachment_manager'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
      principalArmed({
        stack,
        token: memberBTok,
        who: 'memberB (the parent editor — and, on a record it cannot edit, the non-editor)',
        positions: ['org_member'],
        permissions: ['att_attachment_manager'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
    ]);

    // Parent records: a public case owned by memberA, a private secret owned by admin.
    const caseRes = await stack.apiAs(memberATok, 'POST', '/data/att_case', { name: 'public case' });
    expect(caseRes.status).toBeLessThan(300);
    caseAId = await createdId(caseRes);

    const secret = await ql.insert(
      'att_secret',
      { name: 'admin secret', owner_id: adminId },
      { context: { ...SYS } },
    );
    secretId = secret.id;
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  // ── (e) upload auth ──────────────────────────────────────────────────
  it('(e) anonymous presigned upload → 401 AUTH_REQUIRED', async () => {
    const res = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'x.txt', mimeType: 'text/plain', size: 1, scope: 'attachments' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error?.code).toBe('AUTH_REQUIRED');
  });

  it('(e) authenticated upload succeeds and sys_file.owner_id is server-stamped', async () => {
    const fileId = await uploadFile(stack, memberATok);
    const file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
    expect(file?.status).toBe('committed');
    expect(file?.scope).toBe('attachments');
    expect(file?.owner_id).toBe(memberAId);
  });

  // ── (#2727 gate, first e2e) ──────────────────────────────────────────
  it('(#2727) attaching to an object without enable.files → 403 FILES_DISABLED', async () => {
    const nofilesRes = await stack.apiAs(memberATok, 'POST', '/data/att_nofiles', { name: 'plain' });
    expect(nofilesRes.status).toBeLessThan(300);
    const nofilesId = await createdId(nofilesRes);
    const fileId = await uploadFile(stack, memberATok);
    const res = await attach(memberATok, 'att_nofiles', nofilesId, fileId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('FILES_DISABLED');
  });

  // ── (b) parent visibility + (f) provenance ───────────────────────────
  it('(f) member attaches to a readable record; uploaded_by is server-stamped over a spoofed value', async () => {
    const fileId = await uploadFile(stack, memberATok);
    const res = await attach(memberATok, 'att_case', caseAId, fileId, { uploaded_by: memberBId });
    expect(res.status).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
    expect(row?.uploaded_by, 'server identity wins over the spoofed uploaded_by').toBe(memberAId);
  });

  it('(b) member cannot attach to a record they cannot read → 403 ATTACHMENT_PARENT_ACCESS; the owner can', async () => {
    const fileId = await uploadFile(stack, memberATok);
    const denied = await attach(memberATok, 'att_secret', secretId, fileId);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).code).toBe('ATTACHMENT_PARENT_ACCESS');

    const adminFile = await uploadFile(stack, adminTok);
    const allowed = await attach(adminTok, 'att_secret', secretId, adminFile);
    expect(allowed.status).toBeLessThan(300);
  });

  // ── (item 3) edit-on-parent: read is not enough to attach ────────────
  it('(item 3) a member who can READ but not EDIT the parent cannot attach — yet can still list its attachments', async () => {
    // att_readonly is public_read: every member reads it, only the owner edits.
    const ro = await ql.insert('att_readonly', { name: 'ro', owner_id: adminId }, { context: { ...SYS } });

    // memberA can READ the record…
    const canRead = await stack.apiAs(memberATok, 'GET', `/data/att_readonly/${ro.id}`);
    expect(canRead.status).toBe(200);

    // …but attaching requires EDIT (Salesforce parity) → 403.
    const file = await uploadFile(stack, memberATok);
    const denied = await attach(memberATok, 'att_readonly', ro.id, file);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).code).toBe('ATTACHMENT_PARENT_ACCESS');

    // The owner (admin) can attach, and memberA — who can read the parent —
    // then sees that attachment in the list (read-visibility, item 1).
    const adminFile = await uploadFile(stack, adminTok);
    const attached = await attach(adminTok, 'att_readonly', ro.id, adminFile);
    expect(attached.status).toBeLessThan(300);
    const list = await stack.apiAs(memberATok, 'GET', '/data/sys_attachment');
    const rows = ((await list.json()) as any).records ?? [];
    expect(rows.some((r: any) => r.file_id === adminFile)).toBe(true);
  });

  // ── (a) delete gate ──────────────────────────────────────────────────
  it('(a, DOGFOOD FINDING pin) the everyone baseline carries NO delete bit: an ungranted member cannot delete even their OWN attachment (403 PERMISSION_DENIED)', async () => {
    // ADR-0090 D5 / #2753: `member_default` is the anchor-bound baseline and
    // deliberately omits `allowDelete`. Managing attachments therefore
    // requires a domain grant (attachmentManagerSet) — the RecordAttachments
    // panel's delete button 403s for rank-and-file members until the app
    // ships one. RBAC denies BEFORE the attachment-level gate is consulted.
    const fileId = await uploadFile(stack, baselineTok);
    const created = await attach(baselineTok, 'att_case', caseAId, fileId);
    expect(created.status, 'baseline member CAN attach (create is baseline)').toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });

    const denied = await stack.apiAs(baselineTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).code).toBe('PERMISSION_DENIED');

    // cleanup so later ref-counts stay per-test
    await ql.delete('sys_attachment', { where: { id: row.id }, context: { ...SYS } });
  });

  it('(a) granted member: uploader may delete their own attachment; a non-uploader without parent edit is denied', async () => {
    const row = await ql.findOne('sys_attachment', { where: { parent_object: 'att_secret', parent_id: secretId }, context: SYS });
    expect(row?.id, 'admin attachment on att_secret exists').toBeTruthy();

    // memberB holds the delete bit, but is neither the uploader nor able to
    // edit — nor even READ — the (admin-owned, private-model) parent → 403.
    //
    // [#21729] ONE code, and it is the platform's not-visible refusal, not the
    // gate's. An attachment's read visibility is its parent's, so to memberB
    // this row does not exist (its by-id GET is a 404, case (c)); the by-id
    // pre-image re-reads the target through the caller's own visibility and
    // refuses a row it cannot see ("you cannot mutate what you cannot see")
    // BEFORE the attachment gate runs. That ordering is what keeps the parent's
    // object and id — which the gate's refusal names — away from a caller who
    // cannot read that record. The gate's own code is pinned on a parent the
    // caller CAN read (the next case). This used to accept either code because
    // which one arrived depended on whether the boot was org-bound.
    //
    // Since the write doors' ruling A that refusal IS the read door's answer:
    // a row the caller cannot read answers what a nonexistent id answers.
    const denied = await stack.apiAs(memberBTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect(denied.status).toBe(404);
    expect(((await denied.json()) as any).code).toBe('RECORD_NOT_FOUND');
    expect(await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS })).toBeTruthy();

    // The uploader (admin) may delete it.
    const allowed = await stack.apiAs(adminTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect(allowed.status).toBeLessThan(300);

    // A granted member deletes their OWN attachment (uploader rule).
    const fileId = await uploadFile(stack, memberATok);
    const created = await attach(memberATok, 'att_case', caseAId, fileId);
    expect(created.status).toBeLessThan(300);
    const own = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
    const ownDelete = await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${own.id}`);
    expect(ownDelete.status).toBeLessThan(300);
  });

  // [#21729] The parent-editor limb of the gate's delete rule, past the floor.
  it('(a) a parent-record editor who is NOT the uploader may delete the attachment (200)', async () => {
    // att_case is public_read_write → memberB can edit memberA's case. memberA
    // uploads and attaches; memberB is neither the uploader nor the row's
    // creator, so `owner_only_deletes` does not admit it — only the alternate
    // match service-storage contributes beside its gate does, and then the gate
    // admits it on its parent-editor limb.
    const fileId = await uploadFile(stack, memberATok);
    const created = await attach(memberATok, 'att_case', caseAId, fileId);
    expect(created.status).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
    expect(row?.uploaded_by).toBe(memberAId);

    const removed = await stack.apiAs(memberBTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS })).toBeFalsy();
  });

  it('(a) a non-uploader who can READ the parent but not EDIT it is refused by the gate: 403 ATTACHMENT_DELETE_DENIED', async () => {
    // att_readonly is public_read: memberB reads the record (and so its
    // attachments) but only the owner (admin) edits it. With the floor no
    // longer answering for this limb, the refusal is the gate's — one code.
    const ro = await ql.insert('att_readonly', { name: 'ro for delete', owner_id: adminId }, { context: { ...SYS } });
    const adminFile = await uploadFile(stack, adminTok);
    const created = await attach(adminTok, 'att_readonly', ro.id, adminFile);
    expect(created.status).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: adminFile }, context: SYS });
    expect((await stack.apiAs(memberBTok, 'GET', `/data/sys_attachment/${row.id}`)).status).toBe(200);

    const denied = await stack.apiAs(memberBTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).code).toBe('ATTACHMENT_DELETE_DENIED');
    expect(await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS })).toBeTruthy();
  });

  it('(a) the EDIT limb is not widened: a parent editor who is not the uploader still cannot PATCH the attachment (403 PERMISSION_DENIED)', async () => {
    // ⛔ The ruling's boundary: the alternate match is DELETE only. The gate's
    // `beforeUpdate` would admit a parent editor, but the floor's update limb
    // (`owner_only_writes`) still answers first, exactly as before. If this
    // turns 200, an edit-limb relief rode in on the delete-limb ruling.
    const fileId = await uploadFile(stack, memberATok);
    const created = await attach(memberATok, 'att_case', caseAId, fileId, { description: 'memberA wrote this' });
    expect(created.status).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });

    const patched = await stack.apiAs(memberBTok, 'PATCH', `/data/sys_attachment/${row.id}`, { description: 'memberB rewrote this' });
    expect(patched.status).toBe(403);
    expect(((await patched.json()) as any).code).toBe('PERMISSION_DENIED');
    const after = await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS });
    expect(after?.description).toBe('memberA wrote this');
  });

  // ── (c) attachment LIST inherits parent visibility (#2970 item 1) ────
  it('(c) a member CANNOT list/read sys_attachment rows whose parent record they cannot read', async () => {
    const adminFile = await uploadFile(stack, adminTok);
    const created = await attach(adminTok, 'att_secret', secretId, adminFile);
    expect(created.status).toBeLessThan(300);
    const secretRow = await ql.findOne('sys_attachment', { where: { file_id: adminFile }, context: SYS });

    // memberB cannot read the att_secret PARENT…
    const parentRead = await stack.apiAs(memberBTok, 'GET', `/data/att_secret/${secretId}`);
    expect([403, 404]).toContain(parentRead.status);

    // …and now the join row is filtered out of the generic list too (the
    // read-visibility middleware inherits the parent's visibility, and the
    // list `total` is filtered identically via count()).
    const list = await stack.apiAs(memberBTok, 'GET', '/data/sys_attachment');
    expect(list.status).toBe(200);
    const body = (await list.json()) as any;
    const rows = body.records ?? [];
    expect(
      rows.some((r: any) => r.id === secretRow.id),
      'attachment of an invisible parent must not be listable',
    ).toBe(false);
    // total must not leak the hidden row's existence either.
    expect(rows.every((r: any) => r.parent_object !== 'att_secret' || r.parent_id !== secretId)).toBe(true);

    // A by-id read of the hidden attachment is a 404/403, not a leak.
    const byId = await stack.apiAs(memberBTok, 'GET', `/data/sys_attachment/${secretRow.id}`);
    expect([403, 404]).toContain(byId.status);

    // Control: memberB CAN still see attachments on a record they can read.
    const okFile = await uploadFile(stack, memberBTok);
    const okAttach = await attach(memberBTok, 'att_case', caseAId, okFile);
    expect(okAttach.status).toBeLessThan(300);
    const okList = await stack.apiAs(memberBTok, 'GET', '/data/sys_attachment');
    const okRows = ((await okList.json()) as any).records ?? [];
    expect(okRows.some((r: any) => r.file_id === okFile)).toBe(true);
  });

  // ── (e-read) attachment downloads inherit parent visibility (#2970 item 2) ──
  it('(e-read) attachments download requires auth AND read access to a parent record', async () => {
    // A file attached to the admin-owned, private att_secret record.
    const adminFile = await uploadFile(stack, adminTok);
    const linked = await attach(adminTok, 'att_secret', secretId, adminFile);
    expect(linked.status).toBeLessThan(300);

    // Anonymous → 401 (was a 200 capability URL before #2970).
    const anon = await stack.api(`/storage/files/${adminFile}/url`);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as any).error?.code).toBe('AUTH_REQUIRED');

    // memberB is authenticated but cannot read att_secret and is not the
    // owner → 403.
    const denied = await stack.apiAs(memberBTok, 'GET', `/storage/files/${adminFile}/url`);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).error?.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');

    // The owner (admin) → 200 with a signed URL, in the declared
    // `{ success: true, data: { url } }` envelope (#3689 — this route answered
    // a bare `{ url }` until then).
    const owner = await stack.apiAs(adminTok, 'GET', `/storage/files/${adminFile}/url`);
    expect(owner.status).toBe(200);
    const ownerBody = (await owner.json()) as any;
    expect(ownerBody.success).toBe(true);
    expect(ownerBody.data?.url).toBeTruthy();

    // Parent-inherited read: a file on the PUBLIC att_case record is
    // downloadable by any member who can read that record — even a
    // non-uploader (memberB downloads memberA's attachment).
    const caseFile = await uploadFile(stack, memberATok);
    const caseLink = await attach(memberATok, 'att_case', caseAId, caseFile);
    expect(caseLink.status).toBeLessThan(300);
    const inherited = await stack.apiAs(memberBTok, 'GET', `/storage/files/${caseFile}/url`);
    expect(inherited.status).toBe(200);

    // The stable 302 endpoint is gated the same way (anon → 401).
    const anon302 = await stack.api(`/storage/files/${adminFile}`);
    expect(anon302.status).toBe(401);
  });

  // ── Part 1: sys_file orphan lifecycle, end to end ─────────────────────
  describe('sys_file orphan lifecycle (ADR-0057 reap guard)', () => {
    it('tombstones on last-ref delete, keeps shared files alive, un-tombstones on re-attach', async () => {
      const fileId = await uploadFile(stack, memberATok);
      // Two join rows on the SAME file (ContentDocumentLink semantics).
      const caseB = await stack.apiAs(memberATok, 'POST', '/data/att_case', { name: 'case b' });
      const caseBId = await createdId(caseB);
      const a1 = await attach(memberATok, 'att_case', caseAId, fileId);
      const a2 = await attach(memberATok, 'att_case', caseBId, fileId);
      expect(a1.status).toBeLessThan(300);
      expect(a2.status).toBeLessThan(300);
      const rows = await ql.find('sys_attachment', { where: { file_id: fileId }, context: SYS });
      expect(rows).toHaveLength(2);

      // Delete ref #1 → file must stay committed (a second ref remains).
      await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${rows[0].id}`);
      let file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
      expect(file.status).toBe('committed');

      // Delete ref #2 (the LAST) → tombstoned.
      await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${rows[1].id}`);
      file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
      expect(file.status).toBe('deleted');
      expect(file.deleted_at).toBeTruthy();

      // Re-attach inside the grace window → back to committed.
      const re = await attach(memberATok, 'att_case', caseAId, fileId);
      expect(re.status).toBeLessThan(300);
      file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
      expect(file.status).toBe('committed');
      expect(file.deleted_at ?? null).toBeNull();
    });

    it('the sweep reaps expired tombstones AND their bytes; fresh tombstones, committed rows and NULL deleted_at survive', async () => {
      // Orphan an attachments file for real (upload → attach → detach).
      const fileId = await uploadFile(stack, memberATok);
      const created = await attach(memberATok, 'att_case', caseAId, fileId);
      expect(created.status).toBeLessThan(300);
      const joinRow = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
      await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${joinRow.id}`);

      const tombstoned = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
      expect(tombstoned.status).toBe('deleted');
      const key = tombstoned.key as string;
      await expect(fs.access(join(rootDir, key)), 'bytes exist before the sweep').resolves.toBeUndefined();

      // A CONTROL file: committed, NULL deleted_at — must survive every sweep.
      const controlId = await uploadFile(stack, memberATok, 'control.txt');
      const controlAttach = await attach(memberATok, 'att_case', caseAId, controlId);
      expect(controlAttach.status).toBeLessThan(300);

      // Fresh tombstone (inside the 30d grace window) — must survive too.
      const freshId = await uploadFile(stack, memberATok, 'fresh.txt');
      const freshAttach = await attach(memberATok, 'att_case', caseAId, freshId);
      expect(freshAttach.status).toBeLessThan(300);
      const freshJoin = await ql.findOne('sys_attachment', { where: { file_id: freshId }, context: SYS });
      await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${freshJoin.id}`);

      // Backdate ONLY the target tombstone past the 30d window (engine-level
      // update so the datetime lands driver-correct).
      await ql.update(
        'sys_file',
        { id: fileId, deleted_at: new Date(Date.now() - 31 * DAY_MS) },
        { context: { ...SYS } },
      );

      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);

      // Row gone, bytes gone.
      expect(await ql.findOne('sys_file', { where: { id: fileId }, context: SYS })).toBeNull();
      await expect(fs.access(join(rootDir, key)), 'bytes reclaimed by the guard').rejects.toThrow();

      // Survivors.
      expect((await ql.findOne('sys_file', { where: { id: controlId }, context: SYS }))?.status).toBe('committed');
      expect((await ql.findOne('sys_file', { where: { id: freshId }, context: SYS }))?.status).toBe('deleted');
    });

    it('sweep-time re-verification: a tombstone that regained a reference behind the hooks\' back is un-tombstoned, not reaped', async () => {
      const fileId = await uploadFile(stack, memberATok, 'undead.txt');
      const created = await attach(memberATok, 'att_case', caseAId, fileId);
      expect(created.status).toBeLessThan(300);
      const joinRow = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });
      await stack.apiAs(memberATok, 'DELETE', `/data/sys_attachment/${joinRow.id}`);
      expect((await ql.findOne('sys_file', { where: { id: fileId }, context: SYS })).status).toBe('deleted');

      // Hook-bypass re-reference: a DIRECT DRIVER insert (no engine hooks
      // fire, so afterInsert cannot un-tombstone) + a backdated tombstone.
      const driver = ql.getDriverForObject('sys_attachment');
      await driver.create('sys_attachment', {
        id: `bypass-${fileId}`,
        parent_object: 'att_case',
        parent_id: caseAId,
        file_id: fileId,
        created_at: new Date(),
      });
      await ql.update(
        'sys_file',
        { id: fileId, deleted_at: new Date(Date.now() - 31 * DAY_MS) },
        { context: { ...SYS } },
      );

      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);

      const file = await ql.findOne('sys_file', { where: { id: fileId }, context: SYS });
      expect(file, 'the guard must veto, not reap').toBeTruthy();
      expect(file.status).toBe('committed');
    });

    it('abandoned pending uploads are reaped after the 7d retention window', async () => {
      // Presign but never complete → status stays 'pending'.
      const presign = await stack.api('/storage/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberATok}` },
        body: JSON.stringify({ filename: 'abandoned.txt', mimeType: 'text/plain', size: 5, scope: 'attachments' }),
      });
      const { data } = (await presign.json()) as any;
      // Backdate creation past the 7d pending window.
      await ql.update(
        'sys_file',
        { id: data.fileId, created_at: new Date(Date.now() - 8 * DAY_MS) },
        { context: { ...SYS } },
      );

      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
      expect(await ql.findOne('sys_file', { where: { id: data.fileId }, context: SYS })).toBeNull();
    });

    it('(item 4 + multipart-abort guard) an abandoned chunked upload is reaped AND its uploaded parts are aborted', async () => {
      // Initiate a chunked upload (creates a sys_upload_session) and upload one
      // chunk — but never complete it. The chunk lands as a part on disk.
      const init = await stack.api('/storage/upload/chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberATok}` },
        body: JSON.stringify({ filename: 'big.bin', mimeType: 'application/octet-stream', totalSize: 10_485_760 }),
      });
      expect(init.status).toBe(200);
      const { uploadId, resumeToken } = ((await init.json()) as any).data;
      const session = await ql.findOne('sys_upload_session', { where: { id: uploadId }, context: SYS });
      expect(session?.id, 'session row created').toBeTruthy();

      const chunkRes = await stack.api(`/storage/upload/chunked/${uploadId}/chunk/0`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${memberATok}`,
          'Content-Type': 'application/octet-stream',
          'x-resume-token': resumeToken,
        },
        body: Buffer.from('a partial chunk of bytes'),
      });
      expect(chunkRes.status, await chunkRes.clone().text()).toBeLessThan(300);

      // The local adapter stores parts under `<rootDir>/.parts/<uploadId>/`.
      const partsDir = join(rootDir, '.parts', String(uploadId));
      await expect(fs.access(partsDir), 'part exists before the sweep').resolves.toBeUndefined();

      // Backdate expires_at past the 1d TTL grace.
      await ql.update(
        'sys_upload_session',
        { id: uploadId, expires_at: new Date(Date.now() - 2 * DAY_MS) },
        { context: { ...SYS } },
      );

      const report = await lifecycle.sweep();
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
      // Row gone AND the backend multipart parts aborted (dir removed).
      expect(await ql.findOne('sys_upload_session', { where: { id: uploadId }, context: SYS })).toBeNull();
      await expect(fs.access(partsDir), 'parts aborted by the reap guard').rejects.toThrow();
    });
  });
});

// ── (a′) without service-storage, the floor is the last word (#21729) ────
// The ruling's other half. `sys_attachment` is DEFINED in platform-objects and
// gated by service-storage, so the alternate match that relieves the delete
// floor is contributed beside the gate — and a composition that registers the
// object WITHOUT service-storage carries neither. Booted here: the object, the
// security plugin (whose seam is present and unused), org-bound members — and
// no gate. A parent-record editor's delete of another member's attachment is
// refused by the floor; the row's creator, whom the floor admits, may delete it.
/** Registers `sys_attachment` the way service-storage does, and installs nothing else. */
const sysAttachmentWithoutStorage = {
  name: 'com.dogfood.sys-attachment-without-storage',
  type: 'standard' as const,
  version: '0.0.0',
  optionalDependencies: ['com.objectstack.engine.objectql'],
  async init(ctx: any) {
    ctx.getService('manifest').register({
      id: 'com.dogfood.sys-attachment-without-storage',
      name: 'sys_attachment without service-storage',
      version: '0.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [SysAttachment],
    });
  },
  async start() {},
};

describe('attachments without service-storage (a′)', () => {
  let stack: VerifyStack;
  let ql: any;

  beforeAll(async () => {
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      extraPlugins: [sysAttachmentWithoutStorage as never],
      orgContext: true,
    });
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it("a parent editor's delete of another member's attachment is refused by the floor (403 PERMISSION_DENIED); the creator's is admitted", async () => {
    await stack.signIn();
    const uploaderTok = await stack.signUp('att-nostorage-a@verify.test');
    const editorTok = await stack.signUp('att-nostorage-b@verify.test');
    const uploaderId = (await ql.findOne('sys_user', { where: { email: 'att-nostorage-a@verify.test' }, context: SYS }))?.id;
    const editorId = (await ql.findOne('sys_user', { where: { email: 'att-nostorage-b@verify.test' }, context: SYS }))?.id;
    const managerSet = await ql.findOne('sys_permission_set', { where: { name: 'att_attachment_manager' }, context: SYS });
    for (const userId of [uploaderId, editorId]) {
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: managerSet.id }, { context: { ...SYS } });
    }
    await assertArmed([
      principalArmed({
        stack,
        token: editorTok,
        who: 'the parent editor',
        positions: ['org_member'],
        permissions: ['att_attachment_manager'],
        control: DELETE_FLOOR,
        disarmedBy: DELETE_FLOOR_DISARM,
      }),
    ]);

    // The seam is there; what is absent is the plugin that contributes to it.
    const security = await stack.kernel.getServiceAsync<any>('security');
    expect(typeof security?.contributeOwnershipFloorAlternates).toBe('function');

    const caseRes = await stack.apiAs(uploaderTok, 'POST', '/data/att_case', { name: 'no storage here' });
    expect(caseRes.status).toBeLessThan(300);
    const caseId = await createdId(caseRes);
    // Both members can edit this public_read_write case.
    expect((await stack.apiAs(editorTok, 'PATCH', `/data/att_case/${caseId}`, { name: 'edited by the editor' })).status).toBe(200);

    const linkRes = await stack.apiAs(uploaderTok, 'POST', '/data/sys_attachment', {
      parent_object: 'att_case',
      parent_id: caseId,
      file_id: 'file-without-storage',
      file_name: 'hello.txt',
    });
    expect(linkRes.status, await linkRes.clone().text()).toBeLessThan(300);
    const rowId = await createdId(linkRes);

    const refused = await stack.apiAs(editorTok, 'DELETE', `/data/sys_attachment/${rowId}`);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).code).toBe('PERMISSION_DENIED');
    expect(await ql.findOne('sys_attachment', { where: { id: rowId }, context: SYS })).toBeTruthy();

    // Control: the floor admits the row's creator, so the refusal above was the
    // floor's and not an RBAC or visibility refusal.
    const own = await stack.apiAs(uploaderTok, 'DELETE', `/data/sys_attachment/${rowId}`);
    expect(own.status, await own.clone().text()).toBe(200);
  });
});

// ── (g) tenant isolation — multi-org boot ────────────────────────────────
// #4700: this probe was a bare `import()` resolved against this file's realpath
// inside the framework workspace, so it was constant-false and block (g) had
// never executed. Shared host-app resolution + a declarative switch now decide
// it; see `enterprise-organizations.ts`.
warnIfUnavailable('attachments multi-tenant block');

describe.skipIf(!organizationsAvailable)('attachments cross-tenant isolation (g)', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;

  beforeAll(async () => {
    const boot = bootFixture({ multiTenant: true });
    rootDir = boot.rootDir;
    stack = await boot.stack;
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('a member outside the admin org cannot read or delete the admin\'s attachments through /data', async () => {
    const adminTok = await stack.signIn();
    const outsiderTok = await stack.signUp('att-outsider@verify.test');

    const caseRes = await stack.apiAs(adminTok, 'POST', '/data/att_case', { name: 'org case' });
    expect(caseRes.status).toBeLessThan(300);
    const caseId = await createdId(caseRes);
    const fileId = await uploadFile(stack, adminTok);
    const attachRes = await stack.apiAs(adminTok, 'POST', '/data/sys_attachment', {
      parent_object: 'att_case',
      parent_id: caseId,
      file_id: fileId,
      file_name: 'hello.txt',
    });
    expect(attachRes.status).toBeLessThan(300);
    const row = await ql.findOne('sys_attachment', { where: { file_id: fileId }, context: SYS });

    // Org-scoped list: the outsider must not see the admin org's join rows.
    const list = await stack.apiAs(outsiderTok, 'GET', '/data/sys_attachment');
    if (list.status === 200) {
      const rows = ((await list.json()) as any).records ?? [];
      expect(rows.some((r: any) => r.id === row.id)).toBe(false);
    } else {
      expect([403, 404]).toContain(list.status);
    }

    // …and must not be able to delete them.
    const del = await stack.apiAs(outsiderTok, 'DELETE', `/data/sys_attachment/${row.id}`);
    expect([403, 404]).toContain(del.status);
    expect(await ql.findOne('sys_attachment', { where: { id: row.id }, context: SYS })).toBeTruthy();
  });
});
