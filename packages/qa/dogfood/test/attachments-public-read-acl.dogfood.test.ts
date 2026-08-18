// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// attachments-storage.download-authz-both-sides — clause C3.
//
// QA run #9401 scored this item PARTIAL: the pinned matrix proves the CLOSED
// side of the anonymous gate (401 anonymous, 403 parent-invisible, 200 for the
// entitled) and nothing else. C3 is the OPEN side — `acl: 'public_read'` opts a
// gated file back out to the stable anonymous capability URL, the explicit
// declaration that exists because `< img src>` cannot carry a bearer token.
//
// Why the positive side is the half that matters here: a download-authz suite
// made only of denials stays green when the surface denies EVERYTHING, which is
// the exact failure a `public_read` regression produces. So every assertion
// below is paired on ONE file — closed, opened, closed again — and the TTL
// branch is read back out of the minted URL so "it opened" cannot be satisfied
// by some other grant path (owner bypass, a widened gate) that happens to also
// answer 200.
//
// C4 (the browser's friendly denial copy, objectui's RecordAttachmentsPanel) is
// NOT pinned here and is not pinnable from this lane — it is a screenshot
// oracle over a console bundle this repo does not build. The item's ref says so
// in as many words.
//
// @proof: attachments-public-read-acl

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import {
  bootAttachmentsHarness,
  stopAttachmentsHarness,
  uploadFile,
  toPath,
  ttlSecondsOf,
  FILE_BYTES,
  type AttachmentsHarness,
} from './fixtures/attachments-authz-harness.js';

const SYS = { isSystem: true } as const;

describe('attachments download authz — acl=public_read reopens the anonymous capability URL (#9483)', () => {
  let harness: AttachmentsHarness;
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string, memberTok: string;
  let adminId: string;
  let secretId: string;

  /** The file under test: attachments-scope, attached to a PRIVATE parent. */
  let gatedFile: string;
  /** A second file on the same parent, whose acl is never touched. */
  let siblingFile: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const setAcl = (fileId: string, acl: 'private' | 'public_read') =>
    ql.update('sys_file', { acl }, { where: { id: fileId }, context: { ...SYS } });

  const attach = (token: string, parentId: string, fileId: string) =>
    stack.apiAs(token, 'POST', '/data/sys_attachment', {
      parent_object: 'att_secret',
      parent_id: parentId,
      file_id: fileId,
      file_name: 'hello.txt',
      mime_type: 'text/plain',
      size: FILE_BYTES.length,
    });

  beforeAll(async () => {
    harness = await bootAttachmentsHarness();
    stack = harness.stack;
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('att-acl-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');

    // att_secret is the fixture's PRIVATE, owner-anchored parent: a fresh
    // member can neither read it nor edit it, so every file hanging off it is
    // gated for that member. Admin owns it and uploads both files, so the
    // member is never the file owner (the authorizer's owner bypass would
    // otherwise answer `allow` before the gate is consulted).
    const secret = await ql.insert(
      'att_secret',
      { name: 'acl secret', owner_id: adminId },
      { context: { ...SYS } },
    );
    secretId = secret.id;

    gatedFile = await uploadFile(stack, adminTok);
    expect((await attach(adminTok, secretId, gatedFile)).status).toBeLessThan(300);
    siblingFile = await uploadFile(stack, adminTok, 'sibling.txt');
    expect((await attach(adminTok, secretId, siblingFile)).status).toBeLessThan(300);
  }, 120_000);

  afterAll(async () => {
    await stopAttachmentsHarness(harness);
  });

  it('BEFORE the flip: the gated file is closed to anonymous on both download routes', async () => {
    const file = await ql.findOne('sys_file', { where: { id: gatedFile }, context: SYS });
    expect(file?.scope, 'the file is attachments-scope, i.e. gated').toBe('attachments');
    expect(file?.acl ?? 'private', 'and starts NOT public_read').not.toBe('public_read');

    const url = await stack.api(`/storage/files/${gatedFile}/url`);
    expect(url.status).toBe(401);
    expect(((await url.json()) as any).error?.code).toBe('AUTH_REQUIRED');

    const redirect = await stack.api(`/storage/files/${gatedFile}`);
    expect(redirect.status).toBe(401);
    expect(((await redirect.json()) as any).error?.code).toBe('AUTH_REQUIRED');
  });

  it('BEFORE the flip: an authenticated member who cannot read the parent is refused 403', async () => {
    const denied = await stack.apiAs(memberTok, 'GET', `/storage/files/${gatedFile}/url`);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as any).error?.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');
  });

  it('AFTER the flip: acl=public_read 302s anonymously to the REAL BYTES, on the same file', async () => {
    await setAcl(gatedFile, 'public_read');

    const redirect = await stack.api(`/storage/files/${gatedFile}`);
    expect(redirect.status, 'the stable capability URL is reopened').toBe(302);
    const location = redirect.headers.get('location');
    expect(location, 'a 302 with no Location is not a capability URL').toBeTruthy();

    // Follow it ANONYMOUSLY. A 302 whose target refuses the same caller would
    // be a redirect into a wall — the clause is about bytes, not a status.
    const bytes = await stack.raw(toPath(String(location)));
    expect(bytes.status, 'the redirect target serves the bytes').toBe(200);
    expect(await bytes.text()).toBe(FILE_BYTES);
  });

  it('AFTER the flip: the JSON sibling route is reopened too, in its declared envelope', async () => {
    const res = await stack.api(`/storage/files/${gatedFile}/url`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data?.url).toBeTruthy();

    const bytes = await stack.raw(toPath(String(body.data.url)));
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe(FILE_BYTES);
  });

  it('the opt-out is per FILE: the sibling on the same parent stays closed', async () => {
    // Same parent, same uploader, same scope — only `acl` differs. Without
    // this pair a global fail-open would satisfy every assertion above.
    const anon = await stack.api(`/storage/files/${siblingFile}`);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as any).error?.code).toBe('AUTH_REQUIRED');

    const member = await stack.apiAs(memberTok, 'GET', `/storage/files/${siblingFile}/url`);
    expect(member.status).toBe(403);
    expect(((await member.json()) as any).error?.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');
  });

  it('the acl VALUE is the cause: flipping back to private re-closes both routes', async () => {
    // The state oracle for a persistence-shaped clause. Everything above could
    // in principle be explained by state accrued during the earlier requests
    // (a cached verdict, a warmed authorizer); only the round trip back to 401
    // shows the acl column is what the gate reads, every time.
    await setAcl(gatedFile, 'private');

    const redirect = await stack.api(`/storage/files/${gatedFile}`);
    expect(redirect.status).toBe(401);
    expect(((await redirect.json()) as any).error?.code).toBe('AUTH_REQUIRED');

    const url = await stack.api(`/storage/files/${gatedFile}/url`);
    expect(url.status).toBe(401);

    await setAcl(gatedFile, 'public_read'); // leave it open for the TTL case
  });

  it('public_read takes the UNGATED ttl branch, while an entitled gated caller gets the short one', async () => {
    // `authorizeDownload` returns `presignedTtl` (3600s) on the public_read
    // early return and `downloadTtl` (300s) after an `allow` verdict. Same
    // file, same route, two callers — so a widened gate that let the anonymous
    // request through the AUTHORIZED path (rather than the opt-out) would show
    // up here as the short TTL, even though the status code stayed 302.
    const anon = await stack.api(`/storage/files/${gatedFile}`);
    expect(anon.status).toBe(302);
    const anonTtl = ttlSecondsOf(String(anon.headers.get('location')));

    const owner = await stack.apiAs(adminTok, 'GET', `/storage/files/${siblingFile}/url`);
    expect(owner.status, 'the uploader may always download').toBe(200);
    const ownerTtl = ttlSecondsOf(String(((await owner.json()) as any).data.url));

    expect(anonTtl, 'public_read → presignedTtl (3600s)').toBeGreaterThan(3000);
    expect(ownerTtl, 'an authorized gated grant → downloadTtl (300s)').toBeLessThanOrEqual(300);
    expect(anonTtl - ownerTtl, 'the two branches are not the same branch').toBeGreaterThan(1000);
  });

  it('a FIELD-owned file opts out the same way, and its closed side carries the other deny code', async () => {
    // The second gating class in `authorizeDownload`: `ref_object`/`ref_id`
    // (ADR-0104 D3 wave 2) rather than a sys_attachment join row. Stamping the
    // reference is the system write the item's own steps prescribe; what is
    // being pinned is the ROUTE's treatment of a field-owned file, and the
    // distinct deny code is the evidence that the field-owned branch — not the
    // attachments branch — is the one that ran.
    const fieldFile = await uploadFile(stack, adminTok, 'receipt.txt');
    await ql.update(
      'sys_file',
      // `scope` moves off `attachments` so this is a PURELY field-owned file:
      // it carries no sys_attachment join row, and the attachments-scope arm of
      // `gated` cannot be what admits it.
      { ref_object: 'att_secret', ref_id: secretId, scope: 'private' },
      { where: { id: fieldFile }, context: { ...SYS } },
    );

    const anonBefore = await stack.api(`/storage/files/${fieldFile}`);
    expect(anonBefore.status).toBe(401);
    expect(((await anonBefore.json()) as any).error?.code).toBe('AUTH_REQUIRED');

    const memberBefore = await stack.apiAs(memberTok, 'GET', `/storage/files/${fieldFile}/url`);
    expect(memberBefore.status).toBe(403);
    expect(
      ((await memberBefore.json()) as any).error?.code,
      'field-owned denies say FILE_DOWNLOAD_DENIED, not ATTACHMENT_DOWNLOAD_DENIED',
    ).toBe('FILE_DOWNLOAD_DENIED');

    await setAcl(fieldFile, 'public_read');
    const anonAfter = await stack.api(`/storage/files/${fieldFile}`);
    expect(anonAfter.status).toBe(302);
    const bytes = await stack.raw(toPath(String(anonAfter.headers.get('location'))));
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe(FILE_BYTES);
  });
});
