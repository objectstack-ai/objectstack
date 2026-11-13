// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Every member attaches files to the records they can edit, and sees the files
// of the records they can read, with no `sys_attachment` grant from the app.
//
// The member here holds only what a `create-objectstack` app ships: a set that
// names the app's own objects and nothing of `sys_attachment`. The grant comes
// from the storage service's own set (`storage_attachment_member`, read and
// create), which it hands to the member baseline beside the attachment row
// gates it installs. Driven end to end through the REAL surfaces, over the
// attachments fixture's four objects:
//
//   att_case     — public read/write: the member edits it, so they attach;
//                  and another user's attachment on it is visible to them.
//   att_readonly — public read: the member reads another user's record and
//                  cannot edit it, so the attach is refused ATTACHMENT_PARENT_ACCESS.
//   att_secret   — private: another user's record is unreadable, and so are
//                  its attachments, in the list and in its total.
//   att_nofiles  — no `enable.files`: still FILES_DISABLED.
//
// Both attach doors a member reaches are driven: the upload-complete door with
// `attachTo` (the record page's Attachments panel) and the single-use link the
// MCP `create_upload_link` tool mints with `attachments: true` — minted on the
// member's session and by an agent acting for the member on an OAuth token,
// which reaches what the member and its own scope both allow. The explainer
// names the storage set as the baseline that grants the object. And a host
// that composes `sys_attachment` WITHOUT the storage service, or without one of
// the attachment gates, hands a member no grant: the same member is refused 403.

import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { MCPServerPlugin } from '@objectstack/mcp';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SysAttachment } from '@objectstack/platform-objects/audit';
import { attachmentsFixtureStack } from './fixtures/attachments-fixture.js';

const SYS = { isSystem: true } as const;
const MEMBER_EMAIL = 'att-baseline-member@verify.test';
const STORAGE_SET = 'storage_attachment_member';
const MEMBER_PASSWORD = 'Member-Pass-123';
const REDIRECT_URI = 'http://127.0.0.1:33419/callback';
const WRITE_SCOPE = 'openid profile email offline_access data:read data:write';
const READ_SCOPE = 'openid profile email offline_access data:read';

/** The app's every-member set: its own objects, and nothing of `sys_attachment` or `sys_file`. */
const appMemberSet = PermissionSetSchema.parse({
  name: 'att_baseline_app_member',
  label: 'Attachments baseline — the app set',
  objects: {
    att_case: { allowRead: true, allowCreate: true, allowEdit: true },
    att_readonly: { allowRead: true, allowCreate: true, allowEdit: true },
    att_secret: { allowRead: true, allowCreate: true, allowEdit: true },
    att_nofiles: { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

const appSecurity = () =>
  new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, appMemberSet],
    fallbackPermissionSet: appMemberSet.name,
  });

const json = { 'Content-Type': 'application/json' };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createdId(res: Response): Promise<string> {
  const j = (await res.json()) as any;
  const id = j.id ?? j.record?.id ?? j.data?.id;
  if (!id) throw new Error(`create response carried no id: ${JSON.stringify(j)}`);
  return String(id);
}

describe('a member attaches to the records they edit and sees the files of the records they read, with no app grant', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let memberId: string;
  let adminId: string;
  let caseId: string;
  let readonlyId: string;
  let ownSecretId: string;
  let adminSecretId: string;
  let nofilesId: string;
  let adminAttachmentId: string;
  let adminCaseId: string;
  let adminCaseAttachmentId: string;
  let agentWriteTok: string;
  let agentReadTok: string;
  let priorOidc: string | undefined;

  /**
   * An access token for an MCP client the member connects (authorization code
   * with PKCE, on the member's own sign-in): the agent acts for the member,
   * within `scope`.
   */
  async function mintAgentToken(email: string, password: string, scope: string): Promise<string> {
    const authSvc: any = await stack.kernel.getServiceAsync('auth');
    const resource = authSvc.getMcpResourceUrl();
    const reg = await stack.api('/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'attachment agent', redirect_uris: [REDIRECT_URI], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native', scope }),
    });
    const regBody: any = await reg.json();
    expect(reg.status, JSON.stringify(regBody)).toBe(201);
    const signin = await stack.api('/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = ((signin.headers as any).getSetCookie() as string[]).map((c) => c.split(';')[0]).join('; ');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const qs = new URLSearchParams({ client_id: regBody.client_id, redirect_uri: REDIRECT_URI, response_type: 'code', scope, state: 'st', code_challenge: challenge, code_challenge_method: 'S256', resource });
    const az = await stack.api(`/auth/oauth2/authorize?${qs}`, { headers: { cookie }, redirect: 'manual' });
    const loc = az.headers.get('location') ?? '';
    let code = new URL(loc, 'http://localhost:3000').searchParams.get('code');
    if (!code) {
      const consent = await stack.api('/auth/oauth2/consent', { method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: 'http://localhost:3000' }, body: JSON.stringify({ accept: true, oauth_query: loc.slice(loc.indexOf('?')) }) });
      const cb: any = await consent.json().catch(() => null);
      code = new URL(cb?.redirect_uri ?? cb?.url).searchParams.get('code');
    }
    const tok = await stack.api('/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, client_id: regBody.client_id, code_verifier: verifier, resource }).toString(),
    });
    const tj: any = await tok.json();
    expect(tok.status, JSON.stringify(tj)).toBe(200);
    return String(tj.access_token);
  }

  /** The tool names an MCP caller is offered. */
  async function mcpToolNames(token: string): Promise<string[]> {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { ...json, Accept: 'application/json, text/event-stream', ...bearer(token) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status, 'tools/list').toBe(200);
    const rpc: any = await res.json();
    return ((rpc.result?.tools ?? []) as Array<{ name: string }>).map((t) => t.name);
  }

  /** Presign in the attachments scope and PUT the bytes: the panel's first two steps. */
  async function presignAndPut(token: string, name = 'notes.txt'): Promise<string> {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { ...json, ...bearer(token) },
      body: JSON.stringify({ filename: name, mimeType: 'text/plain', size: 5, scope: 'attachments' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    return String(data.fileId);
  }

  /** The upload-complete door with `attachTo`: the panel's third step. */
  async function completeOnto(token: string, parentObject: string, parentId: string) {
    const fileId = await presignAndPut(token);
    const res = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { ...json, ...bearer(token) },
      body: JSON.stringify({ fileId, attachTo: { parentObject, parentId } }),
    });
    return { fileId, status: res.status, body: (await res.json()) as any };
  }

  /** One MCP tools/call as `token`. */
  async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { ...json, Accept: 'application/json, text/event-stream', ...bearer(token) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status, `tools/call ${name}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `tools/call ${name} JSON-RPC error`).toBeUndefined();
    return { isError: rpc.result?.isError === true, json: JSON.parse(rpc.result?.content?.[0]?.text ?? 'null') };
  }

  const linksOn = (parentId: string) => ql.find('sys_attachment', { where: { parent_id: parentId }, context: SYS }) as Promise<any[]>;
  const listAs = async (token: string, query = '') => {
    const res = await stack.apiAs(token, 'GET', `/data/sys_attachment${query}`);
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    priorOidc = process.env.OS_OIDC_PROVIDER_ENABLED;
    process.env.OS_OIDC_PROVIDER_ENABLED = 'true';
    rootDir = mkdtempSync(join(tmpdir(), 'att-member-baseline-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: appSecurity(),
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
        new MCPServerPlugin(),
      ],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    adminTok = await stack.signIn();
    memberTok = await stack.signUp(MEMBER_EMAIL, MEMBER_PASSWORD);
    memberId = String((await ql.findOne('sys_user', { where: { email: MEMBER_EMAIL }, context: SYS }))?.id);
    adminId = String((await ql.findOne('sys_user', { where: { email: 'admin@objectos.ai' }, context: SYS }))?.id);

    const create = async (object: string, body: Record<string, unknown>) => {
      const res = await stack.apiAs(memberTok, 'POST', `/data/${object}`, body);
      expect(res.status, `member creates ${object}`).toBeLessThan(300);
      return createdId(res);
    };
    caseId = await create('att_case', { name: 'member case' });
    ownSecretId = await create('att_secret', { name: 'member secret', owner_id: memberId });
    nofilesId = await create('att_nofiles', { name: 'plain' });
    readonlyId = String((await ql.insert('att_readonly', { name: 'admin readonly', owner_id: adminId }, { context: SYS })).id);
    adminSecretId = String((await ql.insert('att_secret', { name: 'admin secret', owner_id: adminId }, { context: SYS })).id);

    // The admin attaches a file to their own secret record: a row the member must never see.
    const adminAttach = await completeOnto(adminTok, 'att_secret', adminSecretId);
    expect(adminAttach.status, JSON.stringify(adminAttach.body)).toBe(200);
    adminAttachmentId = String(adminAttach.body.data.attachmentId);
    // And one to their own case, which every member reads: another user's
    // attachment on a record the member can read.
    adminCaseId = String((await ql.insert('att_case', { name: 'admin case', owner_id: adminId }, { context: SYS })).id);
    const adminCaseAttach = await completeOnto(adminTok, 'att_case', adminCaseId);
    expect(adminCaseAttach.status, JSON.stringify(adminCaseAttach.body)).toBe(200);
    adminCaseAttachmentId = String(adminCaseAttach.body.data.attachmentId);

    agentWriteTok = await mintAgentToken(MEMBER_EMAIL, MEMBER_PASSWORD, WRITE_SCOPE);
    agentReadTok = await mintAgentToken(MEMBER_EMAIL, MEMBER_PASSWORD, READ_SCOPE);
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
    if (priorOidc === undefined) delete process.env.OS_OIDC_PROVIDER_ENABLED;
    else process.env.OS_OIDC_PROVIDER_ENABLED = priorOidc;
  });

  it('precondition: the member holds no app grant on sys_attachment — the storage set is what grants it, and explain says so', async () => {
    const res = await stack.apiAs(memberTok, 'GET', '/security/explain?object=sys_attachment&operation=create');
    expect(res.status).toBe(200);
    const decision = (await res.json()) as any;
    expect(decision.allowed).toBe(true);
    expect(decision.principal.permissionSets).toEqual(expect.arrayContaining([appMemberSet.name, 'member_default', STORAGE_SET]));
    const contributors = (decision.layers ?? []).flatMap((l: any) => l.contributors ?? []);
    expect(contributors).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'permission_set', name: STORAGE_SET, via: 'additive baseline (ADR-0090 D5)' })]),
    );
    expect(Object.keys(appMemberSet.objects)).not.toContain('sys_attachment');
    // The grant is read and create: no delete, no edit.
    const del = await stack.apiAs(memberTok, 'GET', '/security/explain?object=sys_attachment&operation=delete');
    expect(((await del.json()) as any).allowed).toBe(false);
  });

  it('attaches through the upload-complete door (attachTo) to a record they can edit, and lists it', async () => {
    const out = await completeOnto(memberTok, 'att_case', caseId);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.data).toMatchObject({ fileId: out.fileId, attachmentId: expect.any(String) });
    expect((await linksOn(caseId)).map((r) => r.uploaded_by)).toContain(memberId);
    const list = await listAs(memberTok, `?parent_id=${caseId}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(out.body.data.attachmentId);
  });

  it('attaches through the MCP create_upload_link door (attachments: true) to a record they can edit', async () => {
    const minted = await mcpCall(memberTok, 'create_upload_link', { objectName: 'att_secret', recordId: ownSecretId, attachments: true });
    expect(minted.isError, JSON.stringify(minted.json)).toBe(false);
    expect(minted.json).toMatchObject({ singleUse: true, attachments: true, recordId: ownSecretId });
    const put = await stack.raw(String(minted.json.url).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'x-file-name': 'via-mcp.txt', ...bearer(memberTok) },
      body: 'hello',
    });
    const body: any = await put.json();
    expect(put.status, JSON.stringify(body)).toBe(200);
    expect((await linksOn(ownSecretId)).map((r) => String(r.id))).toContain(String(body.data.attachmentId));
  });

  it('an agent acting for the member on an OAuth token attaches where the member and its scope both allow, and nowhere else', async () => {
    // Both allow: the member edits the case, and the token carries data:write.
    const minted = await mcpCall(agentWriteTok, 'create_upload_link', { objectName: 'att_case', recordId: caseId, attachments: true });
    expect(minted.isError, JSON.stringify(minted.json)).toBe(false);
    const put = await stack.raw(String(minted.json.url).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'x-file-name': 'via-agent.txt', ...bearer(memberTok) },
      body: 'hello',
    });
    const body: any = await put.json();
    expect(put.status, JSON.stringify(body)).toBe(200);
    const row = (await linksOn(caseId)).find((r) => String(r.id) === String(body.data.attachmentId));
    expect(row?.uploaded_by, 'stored as the member').toBe(memberId);

    // The member does not allow it: a record they read but may not edit.
    const onReadonly = await mcpCall(agentWriteTok, 'create_upload_link', { objectName: 'att_readonly', recordId: readonlyId, attachments: true });
    expect(onReadonly.isError).toBe(true);
    expect(onReadonly.json.error?.code).toBe('ATTACHMENT_PARENT_ACCESS');

    // The scope does not allow it: a read-only token is not offered the tool.
    expect(await mcpToolNames(agentWriteTok)).toContain('create_upload_link');
    expect(await mcpToolNames(agentReadTok)).not.toContain('create_upload_link');
  });

  it('a record they can read but not edit refuses the attach with ATTACHMENT_PARENT_ACCESS, and keeps nothing', async () => {
    expect((await stack.apiAs(memberTok, 'GET', `/data/att_readonly/${readonlyId}`)).status).toBe(200);
    const out = await completeOnto(memberTok, 'att_readonly', readonlyId);
    expect([out.status, out.body.error?.code]).toEqual([403, 'ATTACHMENT_PARENT_ACCESS']);
    expect(await linksOn(readonlyId)).toEqual([]);
    const link = await mcpCall(memberTok, 'create_upload_link', { objectName: 'att_readonly', recordId: readonlyId, attachments: true });
    expect(link.isError).toBe(true);
    expect(link.json.error?.code).toBe('ATTACHMENT_PARENT_ACCESS');
  });

  it("another user's attachment on a record they can read is visible to them: listed and readable by id", async () => {
    expect((await stack.apiAs(memberTok, 'GET', `/data/att_case/${adminCaseId}`)).status).toBe(200);
    const byParent = await listAs(memberTok, `?parent_id=${adminCaseId}`);
    expect(byParent.status).toBe(200);
    expect(JSON.stringify(byParent.body)).toContain(adminCaseAttachmentId);
    expect((await stack.apiAs(memberTok, 'GET', `/data/sys_attachment/${adminCaseAttachmentId}`)).status).toBe(200);
  });

  it("the attachments of a record they cannot read stay invisible: not listed, not counted, not readable by id", async () => {
    expect((await stack.apiAs(memberTok, 'GET', `/data/att_secret/${adminSecretId}`)).status).not.toBe(200);
    const all = await listAs(memberTok);
    expect(all.status).toBe(200);
    const ids = ((all.body.records ?? all.body.data ?? []) as any[]).map((r) => String(r.id));
    expect(ids).not.toContain(adminAttachmentId);
    const total = Number(all.body.total ?? ids.length);
    const stored = (await ql.find('sys_attachment', { where: {}, context: SYS })).length;
    expect(total, 'the total counts only the rows the member may read').toBe(stored - 1);
    const byParent = await listAs(memberTok, `?parent_id=${adminSecretId}`);
    expect(JSON.stringify(byParent.body)).not.toContain(adminAttachmentId);
    expect((await stack.apiAs(memberTok, 'GET', `/data/sys_attachment/${adminAttachmentId}`)).status).not.toBe(200);
  });

  it('an object without enable.files still refuses the attach with FILES_DISABLED', async () => {
    const out = await completeOnto(memberTok, 'att_nofiles', nofilesId);
    expect([out.status, out.body.error?.code]).toEqual([403, 'FILES_DISABLED']);
    expect(await linksOn(nofilesId)).toEqual([]);
  });
});

// A host that composes `sys_attachment` WITHOUT the storage service: the object
// is there, its row gates are not, and so no grant is handed out. A stand-in
// under the storage service's registered name keeps the always-on slate from
// mounting the real plugin; a second plugin registers the object as the
// storage service would.
const noStorageService = {
  name: 'com.objectstack.service.storage',
  type: 'standard' as const,
  version: '0.0.0',
  async init() {},
  async start() {},
};
const sysAttachmentWithoutStorage = {
  name: 'com.dogfood.member-attachment-without-storage',
  type: 'standard' as const,
  version: '0.0.0',
  optionalDependencies: ['com.objectstack.engine.objectql'],
  async init(ctx: any) {
    ctx.getService('manifest').register({
      id: 'com.dogfood.member-attachment-without-storage',
      name: 'sys_attachment without service-storage',
      version: '0.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [SysAttachment],
    });
  },
  async start() {},
};

describe('a host composing sys_attachment without the storage service hands members no attachment grant', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: appSecurity(),
      extraPlugins: [noStorageService as never, sysAttachmentWithoutStorage as never, new AuditPlugin()],
    });
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the same member is refused the attachment create (403 PERMISSION_DENIED), and explain names no storage set', async () => {
    await stack.signIn();
    const tok = await stack.signUp('att-baseline-nostorage@verify.test');
    const caseRes = await stack.apiAs(tok, 'POST', '/data/att_case', { name: 'no storage here' });
    expect(caseRes.status).toBeLessThan(300);
    const caseId = await createdId(caseRes);
    const res = await stack.apiAs(tok, 'POST', '/data/sys_attachment', {
      parent_object: 'att_case',
      parent_id: caseId,
      file_id: 'file-without-storage',
      file_name: 'hello.txt',
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('PERMISSION_DENIED');
    const explain = (await (await stack.apiAs(tok, 'GET', '/security/explain?object=sys_attachment&operation=create')).json()) as any;
    expect(explain.allowed).toBe(false);
    expect(explain.principal.permissionSets).not.toContain(STORAGE_SET);
  });
});

// A host that runs the storage service and the security plugin but whose
// composition lacks the per-object attachment opt-in gate: one of the four
// gates is missing, so no grant is handed out, and the same member is refused
// before any attachment row is judged.
describe('a host lacking one of the attachment gates hands members no attachment grant', () => {
  let stack: VerifyStack;
  let rootDir: string;

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'att-member-baseline-nogate-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: appSecurity(),
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false })],
    });
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('the member is refused the attach (403 PERMISSION_DENIED), and explain names no storage set', async () => {
    // Control: the storage service runs here, so this is the missing gate and not a missing service.
    expect(stack.kernel.getService('storage')).toBeTruthy();
    expect(() => stack.kernel.getService('audit')).toThrow();
    await stack.signIn();
    const tok = await stack.signUp('att-baseline-nogate@verify.test');
    const caseRes = await stack.apiAs(tok, 'POST', '/data/att_case', { name: 'missing gate here' });
    expect(caseRes.status).toBeLessThan(300);
    const caseId = await createdId(caseRes);

    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: { ...json, ...bearer(tok) },
      body: JSON.stringify({ filename: 'notes.txt', mimeType: 'text/plain', size: 5, scope: 'attachments' }),
    });
    expect(presign.status, 'presign').toBe(200);
    const { data } = (await presign.json()) as any;
    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: data.headers ?? { 'content-type': 'text/plain' },
      body: 'hello',
    });
    expect(put.status, 'raw PUT').toBeLessThan(300);
    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: { ...json, ...bearer(tok) },
      body: JSON.stringify({ fileId: data.fileId, attachTo: { parentObject: 'att_case', parentId: caseId } }),
    });
    const body = (await complete.json()) as any;
    expect([complete.status, body.error?.code ?? body.code]).toEqual([403, 'PERMISSION_DENIED']);

    const explain = (await (await stack.apiAs(tok, 'GET', '/security/explain?object=sys_attachment&operation=create')).json()) as any;
    expect(explain.allowed).toBe(false);
    expect(explain.principal.permissionSets).not.toContain(STORAGE_SET);
  });
});
