// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The console Attachments panel's flow, at the HTTP level, on the showcase
// boot: presigned upload → raw PUT → the upload-complete door with `attachTo`,
// which commits the file and writes its `sys_attachment` row as one unit, as
// the signed-in member (`FileAttachmentService.attachUploadAs`).
//
// The member holds what a real app grants a member who may attach files: the
// app's own `showcase_contributor` (they read and edit their own invoices) and
// a set with `sys_attachment` read and create, and nothing on `sys_file`. A
// `sys_attachment` create through the generic data door names `file_id` as
// any `lookup` value, which the caller must be able to read, so that member's
// two-step attach (complete, then `POST /data/sys_attachment`) is refused
// `reference_not_found`. The attach on completion vouches for the one upload
// it commits, and is what the panel calls.
//
// Controls: another user's upload id, an id that names no file, a record the
// member may not attach to, the generic door's direct create (still refused),
// and a member whose set reads every object (`'*'`), for whom both flows work.
//
// `showcase_invoice` declares `enable.files`; its select RLS
// (`owner == current_user.email`) hides another user's invoice from a
// contributor.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyStack } from '@objectstack/verify';
import type { IDataEngine } from '@objectstack/spec/contracts';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { SecurityPlugin, appSecurityPluginOptions, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import showcaseStack from '@objectstack/example-showcase';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const BYTES = 'hello';

/** The grant an app ships to let members attach files: `sys_attachment` only, nothing on `sys_file`. */
const attacherSet = PermissionSetSchema.parse({
  name: 'browser_attach_dogfood_attacher',
  label: 'Browser attach dogfood: attach files',
  objects: { sys_attachment: { allowRead: true, allowCreate: true } },
});
/** A set that reads every object, `sys_file` included — the posture the permission-matrix fixture grants. */
const wildcardReaderSet = PermissionSetSchema.parse({
  name: 'browser_attach_dogfood_wildcard_reader',
  label: 'Browser attach dogfood: read everything',
  objects: { '*': { allowRead: true }, sys_attachment: { allowRead: true, allowCreate: true } },
});

describe('the Attachments panel’s upload flow on a real showcase boot: the upload’s own completion attaches, as the member', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: IDataEngine;
  let attacherToken: string;
  let otherToken: string;
  let wildcardToken: string;
  let attacherId: string;
  let attacherInvoice: string;
  let othersInvoice: string;
  let wildcardInvoice: string;

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'browser-attach-dogfood-'));
    stack = await bootShowcase({
      security: new SecurityPlugin({
        ...appSecurityPluginOptions(showcaseStack),
        defaultPermissionSets: [...securityDefaultPermissionSets, attacherSet, wildcardReaderSet],
      }),
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
      ],
    });
    ql = stack.kernel.getService<IDataEngine>('objectql');
    const member = async (email: string, sets: string[]) => {
      const token = await stack.signUp(email);
      const user = await ql.findOne('sys_user', { where: { email } }, { context: SYS });
      for (const permission_set of sets) {
        await ql.insert('sys_user_permission_set', { user_id: user!.id, permission_set }, { context: SYS });
      }
      return { token, id: String(user!.id) };
    };
    const attacher = await member('browser-attacher@dogfood.test', ['showcase_contributor', attacherSet.name]);
    attacherToken = attacher.token;
    attacherId = attacher.id;
    otherToken = (await member('browser-other@dogfood.test', ['showcase_contributor', attacherSet.name])).token;
    wildcardToken = (await member('browser-wildcard@dogfood.test', ['showcase_contributor', wildcardReaderSet.name])).token;
    const [seeded] = await ql.find('showcase_invoice', { limit: 1 }, { context: SYS });
    const invoice = async (name: string, owner: string) =>
      String((await ql.insert('showcase_invoice', { name, owner, account: seeded.account, status: 'draft' }, { context: SYS })).id);
    attacherInvoice = await invoice('INV-BROWSER-ATTACHER', 'browser-attacher@dogfood.test');
    othersInvoice = await invoice('INV-BROWSER-OTHER', 'someone-else@dogfood.test');
    wildcardInvoice = await invoice('INV-BROWSER-WILDCARD', 'browser-wildcard@dogfood.test');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(rootDir, { recursive: true, force: true });
  });

  const json = { 'Content-Type': 'application/json' };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Steps 1 and 2 of the panel's flow: presign in the attachments scope, then PUT the bytes. */
  async function presignAndPut(token: string): Promise<string> {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { ...json, ...bearer(token) },
      body: JSON.stringify({ filename: 'notes.txt', mimeType: 'text/plain', size: BYTES.length, scope: 'attachments' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'text/plain' },
      body: BYTES,
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    return String(data.fileId);
  }

  /** Step 3: the upload-complete door, with or without `attachTo`. */
  async function complete(token: string, fileId: string, attachTo?: { parentObject: string; parentId: string }) {
    const res = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { ...json, ...bearer(token) },
      body: JSON.stringify(attachTo ? { fileId, attachTo } : { fileId }),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  const onInvoice = (parentId: string) => ({ parentObject: 'showcase_invoice', parentId });
  const fileRow = (id: string) => ql.findOne('sys_file', { where: { id } }, { context: SYS }) as Promise<any>;
  const linksOf = (fileId: string) =>
    ql.find('sys_attachment', { where: { file_id: fileId } }, { context: SYS }) as Promise<any[]>;

  it('precondition: the member cannot read sys_file through the data door', async () => {
    const res = await stack.apiAs(attacherToken, 'GET', '/data/sys_file');
    expect(res.status).toBe(403);
  });

  it('the member attaches end to end: presign 200, PUT, complete with attachTo 200 — one committed file, one attachment in their name', async () => {
    const fileId = await presignAndPut(attacherToken);
    const out = await complete(attacherToken, fileId, onInvoice(attacherInvoice));
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.data).toMatchObject({ fileId, name: 'notes.txt', attachmentId: expect.any(String) });
    expect(await fileRow(fileId)).toMatchObject({ status: 'committed', scope: 'attachments', owner_id: attacherId });
    const links = await linksOf(fileId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      id: out.body.data.attachmentId, parent_object: 'showcase_invoice', parent_id: attacherInvoice, uploaded_by: attacherId,
    });
    // The panel's list read sees it, and the member downloads it.
    const list = await stack.apiAs(attacherToken, 'GET', `/data/sys_attachment?parent_id=${attacherInvoice}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain(out.body.data.attachmentId);
    const url = await stack.api(`/storage/files/${fileId}/url`, { headers: bearer(attacherToken) });
    expect(url.status).toBe(200);
    // No wider read: sys_file stays refused to them.
    expect((await stack.apiAs(attacherToken, 'GET', `/data/sys_file/${fileId}`)).status).toBe(403);
  });

  it('control: the generic data door keeps its rule — the member’s two-step attach naming their own completed upload is refused reference_not_found', async () => {
    const fileId = await presignAndPut(attacherToken);
    expect((await complete(attacherToken, fileId)).status).toBe(200);
    const res = await stack.apiAs(attacherToken, 'POST', '/data/sys_attachment', {
      parent_object: 'showcase_invoice', parent_id: attacherInvoice, file_id: fileId, file_name: 'notes.txt',
    });
    expect(res.status).toBe(400);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('VALIDATION_FAILED');
    expect(body).toContain('reference_not_found');
    expect(await linksOf(fileId)).toEqual([]);
  });

  it('control: another user’s upload id is refused, and their upload stays pending and unattached', async () => {
    const othersFile = await presignAndPut(otherToken);
    const out = await complete(attacherToken, othersFile, onInvoice(attacherInvoice));
    expect([out.status, out.body.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect((await fileRow(othersFile)).status).toBe('pending');
    expect(await linksOf(othersFile)).toEqual([]);
  });

  it('control: an id that names no file is refused FILE_NOT_FOUND / 404', async () => {
    const out = await complete(attacherToken, 'no-such-upload', onInvoice(attacherInvoice));
    expect([out.status, out.body.error?.code]).toEqual([404, 'FILE_NOT_FOUND']);
  });

  it('control: a record the member may not attach to (another user’s invoice) is refused, and the upload stays pending and unattached', async () => {
    const fileId = await presignAndPut(attacherToken);
    const out = await complete(attacherToken, fileId, onInvoice(othersInvoice));
    expect(out.status).toBeGreaterThanOrEqual(403);
    expect(out.status).toBeLessThan(500);
    expect(['ATTACHMENT_PARENT_ACCESS', 'RECORD_NOT_FOUND']).toContain(out.body.error?.code);
    expect((await fileRow(fileId)).status).toBe('pending');
    expect(await linksOf(fileId)).toEqual([]);
  });

  it('control: an upload already attached cannot be attached again on completion', async () => {
    const fileId = await presignAndPut(attacherToken);
    expect((await complete(attacherToken, fileId, onInvoice(attacherInvoice))).status).toBe(200);
    const again = await complete(attacherToken, fileId, onInvoice(attacherInvoice));
    expect([again.status, again.body.error?.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(await linksOf(fileId)).toHaveLength(1);
  });

  it('control: a member whose set reads every object keeps working — through the attach on completion and through the generic two-step', async () => {
    const viaComplete = await presignAndPut(wildcardToken);
    const out = await complete(wildcardToken, viaComplete, onInvoice(wildcardInvoice));
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(await linksOf(viaComplete)).toHaveLength(1);

    const viaDataDoor = await presignAndPut(wildcardToken);
    expect((await complete(wildcardToken, viaDataDoor)).status).toBe(200);
    const res = await stack.apiAs(wildcardToken, 'POST', '/data/sys_attachment', {
      parent_object: 'showcase_invoice', parent_id: wildcardInvoice, file_id: viaDataDoor, file_name: 'notes.txt',
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBeLessThan(300);
    expect(await linksOf(viaDataDoor)).toHaveLength(1);
  });
});
