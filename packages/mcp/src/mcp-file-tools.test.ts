// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30892] `read_file` and `create_upload_link`: an agent reads a file a
 * record carries (its text, or the image itself) and hands its user a
 * single-use link to upload a file onto a record.
 *
 * Pinned here, over a fake bridge (the access rules themselves are pinned in
 * `@objectstack/service-storage`'s `record-file-access.integration.test.ts`):
 * each tool registers only on a bridge that carries its member and only for
 * the scope of its family; the bridge is asked for exactly the target the
 * caller named, under the one byte cap; what comes back is rendered — text,
 * PDF and Word text extracted, images as an image block, an over-cap file as
 * its facts and link — and a damaged PDF or Word file answers a sentence, never
 * a crash; a refusal the bridge throws comes back as the coded tool error.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE } from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import {
  READ_FILE_DOCX_XML_MAX_BYTES,
  READ_FILE_IMAGE_MAX_BYTES,
  READ_FILE_MAX_BYTES,
  type McpFileBridge,
  type McpReadFile,
} from './file-content.js';
import { renderSkillMarkdown } from './skill-md.js';

const FILE_TOOLS = ['create_upload_link', 'read_file'];

type Call = [string, ...unknown[]];

function makeBridge(
  files: Partial<McpFileBridge> | null,
): McpDataBridge & McpFileBridge & { calls: Call[]; next?: Partial<McpReadFile> } {
  const calls: Call[] = [];
  const data: McpDataBridge = {
    async listObjects() { return []; },
    async describeObject() { return null; },
    async query() { return { records: [] }; },
    async get() { return null; },
    async create() { return {}; },
    async update() { return {}; },
    async remove() { return {}; },
  };
  return { ...data, ...(files ?? {}), calls };
}

/** A bridge carrying all three file members; `read` answers whatever the test sets on `bridge.next`. */
function fullBridge() {
  const bridge = makeBridge(null);
  Object.assign(bridge, {
    async listRecordFiles(object: string, recordId: string) {
      bridge.calls.push(['listRecordFiles', object, recordId]);
      return [{ fileId: 'f1', name: 'policy.pdf', mimeType: 'application/pdf', size: 10, field: 'policy' }];
    },
    async readRecordFile(object: string, recordId: string, target: unknown, options: unknown) {
      bridge.calls.push(['readRecordFile', object, recordId, target, options]);
      if (recordId === 'hidden') {
        throw Object.assign(new Error(`Record "hidden" not found in "${object}"`), { code: 'RECORD_NOT_FOUND', status: 404 });
      }
      return {
        fileId: 'f1',
        name: 'note.txt',
        mimeType: 'text/plain',
        size: 5,
        field: 'policy',
        maxBytes: (options as { maxBytes: number }).maxBytes,
        download: { url: 'https://acme.test/api/v1/storage/_local/raw/tok', expiresAt: '2026-11-06T12:05:00.000Z' },
        ...bridge.next,
      } satisfies McpReadFile;
    },
    async createUploadLink(object: string, recordId: string, target: unknown) {
      bridge.calls.push(['createUploadLink', object, recordId, target]);
      if (recordId === 'readonly') {
        throw Object.assign(new Error('You cannot attach a file to claim/readonly: you cannot edit that record.'), {
          code: 'PERMISSION_DENIED',
          status: 403,
        });
      }
      return { url: 'https://acme.test/api/v1/storage/upload-links/abc.def', expiresAt: '2026-11-06T12:10:00.000Z' };
    },
  } satisfies McpFileBridge);
  return bridge;
}

async function rpc(runtime: MCPServerRuntime, bridge: unknown, grantedScopes: string[] | undefined, body: unknown) {
  const req = new Request('http://localhost/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const res = await runtime.handleHttpRequest(req, {
    bridge: bridge as McpDataBridge,
    parsedBody: body,
    ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
  });
  return (await res.json()) as any;
}

async function toolNames(runtime: MCPServerRuntime, bridge: unknown, grantedScopes?: string[]): Promise<string[]> {
  const json = await rpc(runtime, bridge, grantedScopes, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return (json.result?.tools ?? []).map((t: { name: string }) => t.name);
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
};

async function callTool(runtime: MCPServerRuntime, bridge: unknown, name: string, args: Record<string, unknown>) {
  const json = await rpc(runtime, bridge, undefined, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  return json.result as ToolResult;
}

const textOf = (block: ToolResult['content'][number]) => (block.type === 'text' ? block.text : '');
const factsOf = (result: ToolResult) => JSON.parse(textOf(result.content[0]));

/** A one-page PDF whose page draws `text` in Helvetica, with a correct cross-reference table. */
function minimalPdf(text: string): Uint8Array {
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
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** A ZIP holding `entries`, each deflated, as a `.docx` is laid out. */
function zip(entries: Record<string, Buffer>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const docxBody = (paragraphs: string[]) =>
  Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
      '</w:body></w:document>',
  );

describe('the file tools register where the bridge carries them, for the scope of their family', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
  });

  it('a bridge with the file members lists both; one without lists neither', async () => {
    expect((await toolNames(runtime, fullBridge())).filter((n) => FILE_TOOLS.includes(n)).sort()).toEqual(FILE_TOOLS);
    expect((await toolNames(runtime, makeBridge(null))).filter((n) => FILE_TOOLS.includes(n))).toEqual([]);
  });

  it('read_file needs data:read and create_upload_link needs data:write', async () => {
    const read = await toolNames(runtime, fullBridge(), [MCP_OAUTH_SCOPE_DATA_READ]);
    expect(read).toContain('read_file');
    expect(read).not.toContain('create_upload_link');
    const write = await toolNames(runtime, fullBridge(), [MCP_OAUTH_SCOPE_DATA_WRITE]);
    expect(write).toContain('create_upload_link');
    expect(write).not.toContain('read_file');
  });
});

describe('read_file', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
  });

  it('asks the bridge for exactly the named file, under the one cap, and answers its facts then its text', async () => {
    const bridge = fullBridge();
    bridge.next = { bytes: new Uint8Array(Buffer.from('hello')) };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(bridge.calls).toEqual([['readRecordFile', 'claim', 'c1', { field: 'policy' }, { maxBytes: READ_FILE_MAX_BYTES }]]);
    expect(result.isError).toBeUndefined();
    expect(factsOf(result)).toEqual({
      fileId: 'f1', name: 'note.txt', mimeType: 'text/plain', size: 5, field: 'policy', maxBytes: READ_FILE_MAX_BYTES,
      download: { url: 'https://acme.test/api/v1/storage/_local/raw/tok', expiresAt: '2026-11-06T12:05:00.000Z' },
      content: 'text', format: 'text/plain',
    });
    expect(result.content[1]).toEqual({ type: 'text', text: 'hello' });
  });

  it('names a file within a multi-file field, or an attachment, as the caller named it', async () => {
    const bridge = fullBridge();
    bridge.next = { bytes: new Uint8Array(Buffer.from('x')) };
    await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'photos', fileId: 'f9' });
    await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', attachmentId: 'a1' });
    expect(bridge.calls.map((c) => c[3])).toEqual([{ field: 'photos', fileId: 'f9' }, { attachmentId: 'a1' }]);
  });

  it('lists the record\'s files when no file is named', async () => {
    const bridge = fullBridge();
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1' });
    expect(JSON.parse(textOf(result.content[0]))).toEqual({
      files: [{ fileId: 'f1', name: 'policy.pdf', mimeType: 'application/pdf', size: 10, field: 'policy' }],
    });
  });

  it('refuses two files at once, and a fileId with no field, before asking the bridge', async () => {
    const bridge = fullBridge();
    const both = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy', attachmentId: 'a1' });
    const loose = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', fileId: 'f1' });
    expect(both.isError).toBe(true);
    expect(loose.isError).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  it('refuses a system object, as every object tool does', async () => {
    const bridge = fullBridge();
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'sys_user', recordId: 'u1', field: 'avatar' });
    expect(result.isError).toBe(true);
    expect(textOf(result.content[0])).toContain('system object');
    expect(bridge.calls).toEqual([]);
  });

  it('relays the record\'s own refusal with its code: no access means no file', async () => {
    const result = await callTool(runtime, fullBridge(), 'read_file', { objectName: 'claim', recordId: 'hidden', field: 'policy' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result.content[0]))).toEqual({
      error: { code: 'RECORD_NOT_FOUND', message: 'Record "hidden" not found in "claim"', status: 404 },
    });
  });

  it('a file over the cap answers its size, the cap and the link, and no content', async () => {
    const bridge = fullBridge();
    bridge.next = { name: 'big.pdf', mimeType: 'application/pdf', size: READ_FILE_MAX_BYTES + 1 };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(result.content).toHaveLength(1);
    const facts = factsOf(result);
    expect(facts).toMatchObject({ size: READ_FILE_MAX_BYTES + 1, maxBytes: READ_FILE_MAX_BYTES, content: 'none' });
    expect(facts.download.url).toBe('https://acme.test/api/v1/storage/_local/raw/tok');
    expect(facts.note).toContain(`over the ${READ_FILE_MAX_BYTES}-byte cap`);
  });

  it('an image comes back as an image block; one over the image cap answers its link', async () => {
    const bridge = fullBridge();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bridge.next = { name: 'photo.png', mimeType: 'image/png', size: png.length, bytes: new Uint8Array(png) };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'photos' });
    expect(factsOf(result).content).toBe('image');
    expect(result.content[1]).toEqual({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });

    const huge = new Uint8Array(READ_FILE_IMAGE_MAX_BYTES + 1);
    bridge.next = { name: 'photo.jpg', mimeType: 'image/jpeg', size: huge.length, bytes: huge };
    const over = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'photos' });
    expect(over.content).toHaveLength(1);
    expect(factsOf(over).note).toContain(`${READ_FILE_IMAGE_MAX_BYTES}-byte cap`);
  });

  it('extracts a PDF\'s text', async () => {
    const bridge = fullBridge();
    const pdf = minimalPdf('Policy 42 covers water damage');
    bridge.next = { name: 'policy.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(result)).toMatchObject({ content: 'text', format: 'application/pdf' });
    expect(textOf(result.content[1])).toContain('Policy 42 covers water damage');
  });

  it('a damaged PDF answers a sentence, never a crash, with the link', async () => {
    const bridge = fullBridge();
    const junk = new Uint8Array(Buffer.from('%PDF-1.4\nthis is not a pdf body at all'));
    bridge.next = { name: 'broken.pdf', mimeType: 'application/pdf', size: junk.length, bytes: junk };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(factsOf(result)).toMatchObject({
      content: 'none',
      note: 'This file could not be read as a PDF: it is damaged or not a PDF. Download it with the link instead.',
    });
    expect(factsOf(result).download).toBeTruthy();
  });

  it('extracts a Word document\'s paragraphs, and a damaged one answers a sentence', async () => {
    const bridge = fullBridge();
    const docx = zip({ '[Content_Types].xml': Buffer.from('<Types/>'), 'word/document.xml': docxBody(['Claim summary', 'Water &amp; mould']) });
    bridge.next = { name: 'summary.docx', mimeType: DOCX, size: docx.length, bytes: docx };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(result)).toMatchObject({ content: 'text', format: DOCX });
    expect(textOf(result.content[1])).toBe('Claim summary\nWater & mould');

    const junk = new Uint8Array(Buffer.from('PK not a zip'));
    bridge.next = { name: 'broken.docx', mimeType: DOCX, size: junk.length, bytes: junk };
    const broken = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(broken).note).toContain('could not be read as a Word document');
  });

  it('a Word body that inflates past its cap is refused with a sentence, not inflated', async () => {
    const bridge = fullBridge();
    const bomb = zip({ 'word/document.xml': Buffer.alloc(READ_FILE_DOCX_XML_MAX_BYTES + 1024, 0x20) });
    expect(bomb.length).toBeLessThan(READ_FILE_MAX_BYTES);
    bridge.next = { name: 'bomb.docx', mimeType: DOCX, size: bomb.length, bytes: bomb };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(result).note).toContain(`expands past ${READ_FILE_DOCX_XML_MAX_BYTES} bytes`);
  });

  it('a file of a type it does not read answers its link', async () => {
    const bridge = fullBridge();
    bridge.next = { name: 'archive.zip', mimeType: 'application/zip', size: 3, bytes: new Uint8Array([1, 2, 3]) };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(result)).toMatchObject({ content: 'none' });
    expect(factsOf(result).note).toContain('application/zip');
  });
});

describe('create_upload_link', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
  });

  it('mints a link for exactly the named record and field, and says it works once until its expiry', async () => {
    const bridge = fullBridge();
    const result = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(bridge.calls).toEqual([['createUploadLink', 'claim', 'c1', { field: 'policy' }]]);
    expect(JSON.parse(textOf(result.content[0]))).toMatchObject({
      url: 'https://acme.test/api/v1/storage/upload-links/abc.def',
      expiresAt: '2026-11-06T12:10:00.000Z',
      singleUse: true,
      objectName: 'claim',
      recordId: 'c1',
      field: 'policy',
    });
  });

  it('mints an attachments link', async () => {
    const bridge = fullBridge();
    await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', recordId: 'c1', attachments: true });
    expect(bridge.calls).toEqual([['createUploadLink', 'claim', 'c1', { attachments: true }]]);
  });

  it('refuses neither or both destinations before asking the bridge', async () => {
    const bridge = fullBridge();
    const neither = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', recordId: 'c1' });
    const both = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', recordId: 'c1', field: 'policy', attachments: true });
    expect(neither.isError).toBe(true);
    expect(both.isError).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  it('relays the attach rule\'s refusal with its code', async () => {
    const result = await callTool(runtime, fullBridge(), 'create_upload_link', { objectName: 'claim', recordId: 'readonly', field: 'policy' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result.content[0])).error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });
});

describe('the skill teaches the file tools exactly where they register', () => {
  it('names both for a host that carries them, and each only for the scope that registers it', () => {
    const all = renderSkillMarkdown({ fileTools: true });
    for (const name of FILE_TOOLS) expect(all).toContain(name);
    const read = renderSkillMarkdown({ fileTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] });
    expect(read).toContain('read_file');
    expect(read).not.toContain('create_upload_link');
    const write = renderSkillMarkdown({ fileTools: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] });
    expect(write).toContain('create_upload_link');
    expect(write).not.toContain('read_file');
  });

  it('names neither for a host that does not', () => {
    const md = renderSkillMarkdown();
    for (const name of FILE_TOOLS) expect(md).not.toContain(name);
  });
});
