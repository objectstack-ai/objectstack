// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30892] An agent reads a record's files and attaches a file to a record
// through the MCP HTTP surface (`read_file`, `create_upload_link`) and the
// single-use upload link `create_upload_link` hands out — over a REAL showcase
// boot with the security, storage and MCP plugins composed as a deployment
// composes them.
//
// The package suites pin the parts over hand-wired fixtures:
// `service-storage/src/record-file-access.integration.test.ts` (the verbs and
// the link routes over a real ObjectQL), `mcp/src/mcp-file-tools.test.ts`
// (the tools, PDF and Word extraction), `runtime/src/mcp-record-file-bridge.test.ts`
// (the bridge). THIS file is where the composed chain runs: the member's
// bearer reaches `/api/v1/mcp`, the bridge reads the record through
// `get_record`'s door under the showcase's own owner RLS and
// `controlled_by_parent` derivation, the storage plugin answers, and the link
// is spent through the real `PUT /api/v1/storage/upload-links/:token` by the
// user it was minted for, signed in (the link is not an anonymous door: no
// session answers 401, as every other storage door does).
//
// The records: `showcase_invoice` (owner RLS on `created_by`, `enable.files`,
// so it holds attachments) and `showcase_invoice_line` (`controlled_by_parent`,
// a `receipt` file field). The member owns one invoice and its line; the admin
// owns the other pair, which the member can neither read nor edit.
//
// Not eligible for the shared showcase project: it boots its own plugins.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import { MCPServerPlugin } from '@objectstack/mcp';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema, RLS } from '@objectstack/spec/security';

const MEMBER_EMAIL = 'mcp-files-member@verify.test';
const ADMIN_EMAIL = 'admin@objectos.ai';
const SYS = { context: { isSystem: true } } as const;
const MIB = 1024 * 1024;
/** `READ_FILE_MAX_BYTES` in `@objectstack/mcp` — the cap `read_file` reports. */
const READ_CAP = 10 * MIB;
/** `UPLOAD_LINK_TTL_SECONDS` in `@objectstack/service-storage`. */
const LINK_TTL_MS = 600_000;
const UNUSABLE =
  'This upload link cannot be used: it was used already, it has expired, it was made for someone else, or it does not exist. Ask for a new link.';

// The member's set: CRUD on the invoice graph, so a request reaches the RLS
// layer, plus an OWNER policy on the master invoice. The line carries no RLS of
// its own — `controlled_by_parent` derives it from the invoice. `sys_attachment`
// is the grant an app ships when it lets members attach files; without it the
// attach door refuses (`403 PERMISSION_DENIED`), link or no link.
const memberSet = PermissionSetSchema.parse({
  name: 'showcase_mcp_files_member',
  label: 'Showcase MCP Files Member',
  objects: {
    showcase_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_product: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_invoice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    showcase_invoice_line: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    sys_attachment: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [RLS.ownerPolicy('showcase_invoice', 'created_by')],
});

/** A one-page PDF whose text layer says `text`. */
function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Strip the origin off an absolute URL so it can be injected. */
const toPath = (url: string): string => url.replace(/^https?:\/\/[^/]+/, '');

describe('[#30892] showcase: an agent reads and attaches a record\'s files over MCP', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: any;
  let storage: { setLimitsSnapshot(s: unknown): void };
  let adminToken: string;
  let memberToken: string;
  let memberInvoice: string;
  let adminInvoice: string;
  let memberLine: string;
  let adminLine: string;

  const mcp = (token: string, method: string, params?: unknown) =>
    stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params !== undefined ? { params } : {}) }),
    });

  /** A tools/call's result: its content blocks and whether it is an error. */
  async function call(token: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; content: any[] }> {
    const res = await mcp(token, 'tools/call', { name, arguments: args });
    expect(res.status, `tools/call ${name}: ${res.status} ${await res.clone().text()}`).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, `tools/call ${name} JSON-RPC error: ${JSON.stringify(rpc.error)}`).toBeUndefined();
    return { isError: rpc.result?.isError === true, content: rpc.result?.content ?? [] };
  }

  /** The JSON a successful call's first text block carries. */
  async function ok(token: string, name: string, args: Record<string, unknown>): Promise<{ json: any; content: any[] }> {
    const r = await call(token, name, args);
    expect(r.isError, `${name} answered an error: ${r.content[0]?.text}`).toBe(false);
    return { json: JSON.parse(r.content[0].text), content: r.content };
  }

  /** The `{ code, message, status }` a refused call carries. */
  async function refused(token: string, name: string, args: Record<string, unknown>): Promise<any> {
    const r = await call(token, name, args);
    expect(r.isError, `${name} should be refused: ${r.content[0]?.text}`).toBe(true);
    return JSON.parse(r.content[0].text).error;
  }

  /** Mint a link as the member and answer its path and its parsed answer. */
  async function mint(args: Record<string, unknown>, token = memberToken): Promise<{ path: string; answer: any }> {
    const { json } = await ok(token, 'create_upload_link', args);
    expect(json.url, 'the link is absolute').toMatch(/^https?:\/\/[^/]+\/api\/v1\/storage\/upload-links\//);
    return { path: toPath(json.url), answer: json };
  }

  /** The credential a link request carries: the member's unless named, none for `null`. */
  const authOf = (token: string | null): Record<string, string> => (token === null ? {} : { Authorization: `Bearer ${token}` });
  /** Open a link's page, signed in as `token`'s user. */
  const open = (path: string, token: string | null = memberToken) => stack.raw(path, { headers: authOf(token) });
  /** Spend a link: a PUT of `body`, signed in as `token`'s user, as the page's script or `curl -T` sends it. */
  const put = (path: string, body: Buffer, headers: Record<string, string> = {}, token: string | null = memberToken) =>
    stack.raw(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'receipt.pdf', ...headers, ...authOf(token) },
      body,
    });

  const line = (id: string) => ql.findOne('showcase_invoice_line', { where: { id }, ...SYS });
  /** The file id a line's `receipt` holds; a read expands a file reference to its file. */
  const receiptOf = async (id: string): Promise<string | null> => {
    const value = (await line(id))?.receipt;
    return value == null ? null : String(typeof value === 'object' ? value.id : value);
  };
  const fileRow = (id: string) => ql.findOne('sys_file', { where: { id }, ...SYS });

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'mcp-record-files-'));
    stack = await bootShowcase({
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, memberSet],
        fallbackPermissionSet: 'showcase_mcp_files_member',
      }),
      extraPlugins: [
        new MCPServerPlugin(),
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
      ],
    });
    adminToken = await stack.signIn();
    memberToken = await stack.signUp(MEMBER_EMAIL);
    ql = await stack.kernel.getServiceAsync('objectql');
    storage = await stack.kernel.getServiceAsync('file-storage');

    const users = (await ql.find('sys_user', { where: { email: { $in: [ADMIN_EMAIL, MEMBER_EMAIL] } }, ...SYS })) as Array<{ id: string; email: string }>;
    const adminId = users.find((u) => u.email === ADMIN_EMAIL)!.id;
    const memberId = users.find((u) => u.email === MEMBER_EMAIL)!.id;
    const idOf = (r: any) => r?.id ?? r?.record?.id ?? r;

    // Setup by system insert, to sidestep the showcase's authoring rules (not
    // what is under test); everything after this runs as a caller over HTTP.
    const acc = idOf(await ql.insert('showcase_account', { name: 'Files Co', status: 'prospect' }, SYS));
    const prod = idOf(await ql.insert('showcase_product', { name: 'Gadget' }, SYS));
    memberInvoice = idOf(await ql.insert('showcase_invoice', { name: 'INV-FILES-MEMBER', account: acc, status: 'draft', created_by: memberId }, SYS));
    adminInvoice = idOf(await ql.insert('showcase_invoice', { name: 'INV-FILES-ADMIN', account: acc, status: 'draft', created_by: adminId }, SYS));
    memberLine = idOf(await ql.insert('showcase_invoice_line', { invoice: memberInvoice, product: prod, quantity: 1, unit_price: 10, description: 'member line' }, SYS));
    adminLine = idOf(await ql.insert('showcase_invoice_line', { invoice: adminInvoice, product: prod, quantity: 1, unit_price: 20, description: 'admin line' }, SYS));
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('precondition: the member cannot read the admin\'s invoice or its line, and reads their own', async () => {
    expect((await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice/${adminInvoice}`)).status).not.toBe(200);
    expect((await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice_line/${adminLine}`)).status).not.toBe(200);
    expect((await stack.apiAs(memberToken, 'GET', `/data/showcase_invoice_line/${memberLine}`)).status).toBe(200);
  });

  it('both tools are listed for a signed-in member', async () => {
    const rpc: any = await (await mcp(memberToken, 'tools/list')).json();
    const names: string[] = (rpc.result?.tools ?? []).map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'create_upload_link']));
  });

  describe('a file field (`showcase_invoice_line.receipt`)', () => {
    const pdf = minimalPdf('Receipt 42 paid');
    let fileId: string;

    it('mints a single-use link bound to the line and the field, expiring in ten minutes', async () => {
      const before = Date.now();
      const { path, answer } = await mint({ objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      expect(answer).toMatchObject({ singleUse: true, objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      const ttl = Date.parse(answer.expiresAt) - before;
      expect(ttl).toBeGreaterThan(LINK_TTL_MS - 60_000);
      expect(ttl).toBeLessThanOrEqual(LINK_TTL_MS + 5_000);

      // The page a person opens: no cache, no referrer, a CSP, and nothing
      // about the record or the user on it.
      const page = await open(path);
      expect(page.status).toBe(200);
      expect(page.headers.get('cache-control')).toContain('no-store');
      expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await page.text();
      expect(html).not.toContain(memberLine);
      expect(html).not.toContain(MEMBER_EMAIL);

      // The upload names a different record and field in every way a client
      // could; the link's binding decides where it lands.
      const res = await put(`${path}?object=showcase_invoice&recordId=${adminInvoice}&field=description`, pdf, {
        'x-object': 'showcase_invoice_line',
        'x-record-id': adminLine,
        'x-field': 'description',
      });
      const body: any = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.data).toMatchObject({ field: 'receipt', size: pdf.length });
      fileId = body.data.fileId;

      expect(await receiptOf(memberLine)).toBe(fileId);
      expect(await receiptOf(adminLine)).toBeNull();
      expect((await line(adminLine)).description).toBe('admin line');
      expect((await line(memberLine)).description).toBe('member line');
    });

    it('the upload is a committed file of its byte size, owned by the line — what a host counts toward quota', async () => {
      const row = await fileRow(fileId);
      expect(row).toMatchObject({ status: 'committed', size: pdf.length, ref_object: 'showcase_invoice_line', ref_id: memberLine, ref_field: 'receipt' });
    });

    it('refuses a second use, and the page answers the same 404 after it', async () => {
      const { path } = await mint({ objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      expect((await put(path, pdf)).status).toBe(200);
      const again = await put(path, minimalPdf('Replaced'));
      expect(again.status).toBe(404);
      expect(((await again.json()) as any).error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UNUSABLE });
      expect((await open(path)).status).toBe(404);
      // An unknown token answers exactly the same.
      const unknown = await put('/api/v1/storage/upload-links/00000000-0000-4000-8000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', pdf);
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as any).error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UNUSABLE });
      fileId = (await receiptOf(memberLine))!;
    });

    it('works only for the member, signed in: anonymous is 401, another signed-in user the same 404, and neither spends it', async () => {
      const { path } = await mint({ objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      const held = await receiptOf(memberLine);
      for (const res of [await open(path, null), await put(path, minimalPdf('Anonymous'), {}, null)]) {
        expect(res.status).toBe(401);
        expect(((await res.json()) as any).error.code).toBe('AUTH_REQUIRED');
      }
      expect((await open(path, adminToken)).status).toBe(404);
      const stranger = await put(path, minimalPdf('Not yours'), {}, adminToken);
      expect(stranger.status).toBe(404);
      expect(((await stranger.json()) as any).error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UNUSABLE });
      expect(await receiptOf(memberLine)).toBe(held);
      // Still open: the member spends it.
      const own = await put(path, pdf);
      expect(own.status).toBe(200);
      fileId = ((await own.json()) as any).data.fileId;
      expect(await receiptOf(memberLine)).toBe(fileId);
    });

    it('expires: past ten minutes the page and the upload answer the same 404, and nothing lands', async () => {
      const { path } = await mint({ objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      const held = await receiptOf(memberLine);
      const now = Date.now();
      const spy = vi.spyOn(Date, 'now').mockReturnValue(now + LINK_TTL_MS + 1_000);
      try {
        expect((await open(path)).status).toBe(404);
        const late = await put(path, minimalPdf('Late'));
        expect(late.status).toBe(404);
        expect(((await late.json()) as any).error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: UNUSABLE });
      } finally {
        spy.mockRestore();
      }
      expect(await receiptOf(memberLine)).toBe(held);
    });

    it('read_file answers the PDF\'s text, the cap, and a download link that serves the bytes', async () => {
      const { json, content } = await ok(memberToken, 'read_file', { objectName: 'showcase_invoice_line', recordId: memberLine, field: 'receipt' });
      expect(json).toMatchObject({ fileId, field: 'receipt', size: pdf.length, maxBytes: READ_CAP, content: 'text', format: 'application/pdf' });
      expect(content[1].text).toContain('Receipt 42 paid');
      expect(json.download.url).toMatch(/^https?:\/\//);
      const bytes = await stack.raw(toPath(json.download.url));
      expect(bytes.status).toBe(200);
      expect(Buffer.from(await bytes.arrayBuffer()).equals(pdf)).toBe(true);
    });

    it('access follows the record: the admin\'s line is refused with get_record\'s answer, on both tools, and nothing lands', async () => {
      const door = await refused(memberToken, 'get_record', { objectName: 'showcase_invoice_line', recordId: adminLine });
      const read = await refused(memberToken, 'read_file', { objectName: 'showcase_invoice_line', recordId: adminLine, field: 'receipt' });
      const attach = await refused(memberToken, 'create_upload_link', { objectName: 'showcase_invoice_line', recordId: adminLine, field: 'receipt' });
      expect(read.code).toBe('RECORD_NOT_FOUND');
      expect(read.status).toBe(404);
      expect(read.code).toBe(door.code);
      expect(attach).toEqual(read);
      expect(await receiptOf(adminLine)).toBeNull();
    });
  });

  describe('the attachments list (`showcase_invoice`, `enable.files`)', () => {
    let attachmentId: string;
    let adminAttachmentId: string;

    it('a link minted for the attachments list lands one attachment on the invoice, once, even raced', async () => {
      const { path, answer } = await mint({ objectName: 'showcase_invoice', recordId: memberInvoice, attachments: true });
      expect(answer).toMatchObject({ singleUse: true, attachments: true, recordId: memberInvoice });
      const bytes = Buffer.from('signed delivery note');
      const [a, b] = await Promise.all([
        put(path, bytes, { 'content-type': 'text/plain', 'x-file-name': 'note-a.txt' }),
        put(path, bytes, { 'content-type': 'text/plain', 'x-file-name': 'note-b.txt' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 404]);
      const won: any = await (a.status === 200 ? a : b).json();
      attachmentId = won.data.attachmentId;
      expect(attachmentId).toBeTruthy();
      expect((await fileRow(won.data.fileId))).toMatchObject({ status: 'committed', size: bytes.length });
    });

    it('read_file lists the record\'s files with no target, and reads an attachment by id', async () => {
      const { json: listing } = await ok(memberToken, 'read_file', { objectName: 'showcase_invoice', recordId: memberInvoice });
      expect(listing.files.map((f: any) => f.attachmentId)).toContain(attachmentId);
      const { json, content } = await ok(memberToken, 'read_file', { objectName: 'showcase_invoice', recordId: memberInvoice, attachmentId });
      expect(json).toMatchObject({ attachmentId, content: 'text' });
      expect(content[1].text).toBe('signed delivery note');
    });

    it('access follows the record: the admin\'s invoice is refused, and its attachment cannot be read through the member\'s own invoice', async () => {
      const { path } = await mint({ objectName: 'showcase_invoice', recordId: adminInvoice, attachments: true }, adminToken);
      const res = await put(path, Buffer.from('admin only'), { 'content-type': 'text/plain', 'x-file-name': 'admin.txt' }, adminToken);
      expect(res.status).toBe(200);
      adminAttachmentId = ((await res.json()) as any).data.attachmentId;

      const read = await refused(memberToken, 'read_file', { objectName: 'showcase_invoice', recordId: adminInvoice, attachmentId: adminAttachmentId });
      expect(read).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
      const attach = await refused(memberToken, 'create_upload_link', { objectName: 'showcase_invoice', recordId: adminInvoice, attachments: true });
      expect(attach).toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
      // The member's own record does not open another record's attachment.
      const across = await refused(memberToken, 'read_file', { objectName: 'showcase_invoice', recordId: memberInvoice, attachmentId: adminAttachmentId });
      expect(across.status).toBe(404);
      expect(JSON.stringify(across)).not.toContain('admin only');
    });

    it('counts against the upload limit before the link is spent: 413, then a smaller file lands through the same link', async () => {
      const { path } = await mint({ objectName: 'showcase_invoice', recordId: memberInvoice, attachments: true });
      storage.setLimitsSnapshot({ maxUploadMb: { value: 1, authored: true } });
      try {
        const over = await put(path, Buffer.alloc(MIB + 1, 7), { 'content-type': 'application/octet-stream', 'x-file-name': 'big.bin' });
        expect(over.status).toBe(413);
        expect(((await over.json()) as any).error.code).toBe('PAYLOAD_TOO_LARGE');
        const small = await put(path, Buffer.alloc(1024, 7), { 'content-type': 'application/octet-stream', 'x-file-name': 'small.bin' });
        const body: any = await small.json();
        expect(small.status, JSON.stringify(body)).toBe(200);
        expect(await fileRow(body.data.fileId)).toMatchObject({ status: 'committed', size: 1024 });
      } finally {
        storage.setLimitsSnapshot({});
      }
    });
  });
});
