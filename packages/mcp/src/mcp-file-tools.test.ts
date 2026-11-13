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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { MCP_OAUTH_SCOPE_DATA_READ, MCP_OAUTH_SCOPE_DATA_WRITE } from '@objectstack/spec/ai';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import {
  READ_FILE_CPU_BUDGET_MS_DEFAULT,
  READ_FILE_CPU_BUDGET_MS_ENV,
  READ_FILE_DOCX_XML_MAX_BYTES,
  READ_FILE_IMAGE_MAX_BYTES,
  READ_FILE_MAX_BYTES,
  READ_FILE_MAX_CONCURRENT_DEFAULT,
  READ_FILE_MAX_CONCURRENT_ENV,
  ReadFileExtractionBusyError,
  configureReadFileExtraction,
  extractFileContent,
  resolveReadFileExtractionLimits,
  type McpFileBridge,
  type McpReadFile,
} from './file-content.js';
import {
  configureExtractionWorkerEntry,
  extractionWorkerPoolStats,
  type ExtractionWorkerEntry,
} from './file-extraction-pool.js';
import { renderSkillMarkdown } from './skill-md.js';

/**
 * `unpdf` as it is, except that a test may hold every document open until it
 * lets go ({@link holdPdfOpens}): how the concurrency pins keep extractions in
 * flight without racing them. Unheld, every call passes straight through.
 */
const pdfGate = vi.hoisted(() => ({ held: undefined as Promise<void> | undefined }));
vi.mock('unpdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unpdf')>();
  return {
    ...actual,
    getDocumentProxy: async (...args: Parameters<typeof actual.getDocumentProxy>) => {
      if (pdfGate.held) await pdfGate.held;
      return actual.getDocumentProxy(...args);
    },
  };
});

/** Hold every PDF open from now until the returned function is called. */
function holdPdfOpens(): () => void {
  let release!: () => void;
  pdfGate.held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    pdfGate.held = undefined;
    release();
  };
}

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

/** A PDF with one page per entry of `texts`, each page drawing its text in Helvetica. */
function multiPagePdf(texts: string[]): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids: string[] = [];
  texts.forEach((text, i) => {
    const pageId = 4 + i * 2;
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    kids.push(`${pageId} 0 R`);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${texts.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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

/** [#32686] A bridge that also serves a link for a record not yet created. */
function newRecordBridge() {
  const bridge = fullBridge();
  Object.assign(bridge, {
    async createUploadLinkForNewRecord(object: string, target: { field: string }) {
      bridge.calls.push(['createUploadLinkForNewRecord', object, target]);
      if (object === 'locked') {
        throw Object.assign(new Error('You cannot upload a file for a new locked: you cannot create locked records.'), {
          code: 'PERMISSION_DENIED',
          status: 403,
        });
      }
      return {
        url: 'https://acme.test/api/v1/storage/upload-links/f9.sec',
        expiresAt: '2026-11-13T12:10:00.000Z',
        fileIds: ['f9'],
      };
    },
  } satisfies McpFileBridge);
  return bridge;
}

async function uploadLinkSchema(runtime: MCPServerRuntime, bridge: unknown) {
  const json = await rpc(runtime, bridge, undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tool = (json.result?.tools ?? []).find((t: { name: string }) => t.name === 'create_upload_link');
  return tool as { description: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } };
}

describe('[#32686] create_upload_link for a record not yet created', () => {
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
  });

  it('with no recordId and a field, mints through the bridge and answers the file id the create names', async () => {
    const bridge = newRecordBridge();
    const result = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'expense_line', field: 'invoice' });
    expect(result.isError).toBeFalsy();
    expect(bridge.calls).toEqual([['createUploadLinkForNewRecord', 'expense_line', { field: 'invoice' }]]);
    const facts = factsOf(result);
    expect(facts).toMatchObject({
      url: 'https://acme.test/api/v1/storage/upload-links/f9.sec',
      expiresAt: '2026-11-13T12:10:00.000Z',
      singleUse: true,
      objectName: 'expense_line',
      field: 'invoice',
      fileIds: ['f9'],
    });
    expect(facts).not.toHaveProperty('recordId');
    expect(facts.instructions).toContain('fileIds[0]');
  });

  it('with a recordId, still asks for that record\'s link, never the new-record one', async () => {
    const bridge = newRecordBridge();
    await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(bridge.calls).toEqual([['createUploadLink', 'claim', 'c1', { field: 'policy' }]]);
  });

  it('refuses an attachments link with no record before asking the bridge', async () => {
    const bridge = newRecordBridge();
    const result = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'claim', attachments: true });
    expect(result.isError).toBe(true);
    expect(textOf(result.content[0])).toContain('An attachment needs its record');
    expect(bridge.calls).toEqual([]);
  });

  it('relays the minting refusal with its code', async () => {
    const result = await callTool(runtime, newRecordBridge(), 'create_upload_link', { objectName: 'locked', field: 'invoice' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result.content[0])).error).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('lists recordId as optional, and says how, only where the bridge serves it', async () => {
    const served = await uploadLinkSchema(runtime, newRecordBridge());
    expect(served.inputSchema.required ?? []).not.toContain('recordId');
    expect(served.description).toContain('omit recordId and name the field');
    const notServed = await uploadLinkSchema(runtime, fullBridge());
    expect(notServed.inputSchema.required).toContain('recordId');
    expect(notServed.description).not.toContain('omit recordId');
  });

  it('a bridge without it refuses a call with no recordId, asking nothing', async () => {
    const bridge = fullBridge();
    const result = await callTool(runtime, bridge, 'create_upload_link', { objectName: 'expense_line', field: 'invoice' });
    expect(result.isError).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  it('the skill teaches the two-call flow only where the host says the bridge serves it, and only with data:write', () => {
    const marker = 'omit `recordId` and name `field`';
    expect(renderSkillMarkdown({ fileTools: true, newRecordUploadLinks: true })).toContain(marker);
    expect(renderSkillMarkdown({ fileTools: true })).not.toContain(marker);
    expect(renderSkillMarkdown({ fileTools: true, newRecordUploadLinks: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_READ] })).not.toContain(marker);
    expect(renderSkillMarkdown({ fileTools: true, newRecordUploadLinks: true, grantedScopes: [MCP_OAUTH_SCOPE_DATA_WRITE] })).toContain(marker);
    expect(renderSkillMarkdown({ newRecordUploadLinks: true })).not.toContain(marker);
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

describe('read_file bounds PDF and Word extraction by the host\'s CPU budget and concurrency cap', () => {
  let runtime: MCPServerRuntime;
  const DEFAULTS = { cpuBudgetMs: READ_FILE_CPU_BUDGET_MS_DEFAULT, maxConcurrent: READ_FILE_MAX_CONCURRENT_DEFAULT };
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
    configureReadFileExtraction(DEFAULTS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    configureReadFileExtraction(DEFAULTS);
  });

  /**
   * Process CPU time that advances `stepMs` on every read, so "the budget is
   * spent" is decided by how many times the clock is read, never by how fast
   * this machine is.
   */
  function steppingCpuClock(stepMs: number) {
    let now = 0;
    return vi.spyOn(process, 'cpuUsage').mockImplementation((previous?: NodeJS.CpuUsage) => {
      now += stepMs * 1000;
      return previous ? { user: now - previous.user - previous.system, system: 0 } : { user: now, system: 0 };
    });
  }

  const PAGES = ['Page one opens', 'Page two follows', 'Page three closes'];

  it('the two host variables: unset reads the defaults, a positive integer is taken, anything else fails naming the variable', () => {
    expect(resolveReadFileExtractionLimits({})).toEqual(DEFAULTS);
    expect(
      resolveReadFileExtractionLimits({ [READ_FILE_CPU_BUDGET_MS_ENV]: ' 750 ', [READ_FILE_MAX_CONCURRENT_ENV]: '2' }),
    ).toEqual({ cpuBudgetMs: 750, maxConcurrent: 2 });
    for (const bad of ['0', '-5', '1.5', 'abc', '2s']) {
      expect(() => resolveReadFileExtractionLimits({ [READ_FILE_CPU_BUDGET_MS_ENV]: bad })).toThrow(
        `${READ_FILE_CPU_BUDGET_MS_ENV} must be a positive integer`,
      );
      expect(() => resolveReadFileExtractionLimits({ [READ_FILE_MAX_CONCURRENT_ENV]: bad })).toThrow(
        `${READ_FILE_MAX_CONCURRENT_ENV} must be a positive integer`,
      );
    }
  });

  it('CONTROL: under the defaults a small PDF and a small Word document read in full, as before', async () => {
    const bridge = fullBridge();
    const pdf = multiPagePdf(PAGES);
    bridge.next = { name: 'three.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    const fromPdf = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(fromPdf.isError).toBeUndefined();
    expect(factsOf(fromPdf).truncated).toBeUndefined();
    expect(factsOf(fromPdf).note).toBeUndefined();
    expect(textOf(fromPdf.content[1])).toBe(PAGES.join('\n\n'));

    const docx = zip({ 'word/document.xml': docxBody(['Claim summary', 'Water &amp; mould']) });
    bridge.next = { name: 'summary.docx', mimeType: DOCX, size: docx.length, bytes: docx };
    const fromDocx = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(fromDocx).truncated).toBeUndefined();
    expect(textOf(fromDocx.content[1])).toBe('Claim summary\nWater & mould');
  });

  it('a PDF out of CPU budget answers the pages read so far, truncated, with a note naming the budget and the link', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 1, maxConcurrent: 4 });
    steppingCpuClock(1);
    const bridge = fullBridge();
    const pdf = multiPagePdf(PAGES);
    bridge.next = { name: 'three.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(result.isError).toBeUndefined();
    expect(factsOf(result)).toMatchObject({ content: 'text', format: 'application/pdf', truncated: true });
    expect(factsOf(result).note).toBe(
      'Reading stopped at the CPU-time budget for one file (1 ms) after page 1 of 3, so the text is partial. '
        + 'Download the file with the link for the rest.',
    );
    expect(factsOf(result).download).toBeTruthy();
    expect(textOf(result.content[1])).toBe('Page one opens');
  });

  it('a Word document out of CPU budget answers the paragraphs read so far, stopping between paragraphs', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 1, maxConcurrent: 4 });
    steppingCpuClock(1);
    const bridge = fullBridge();
    const paragraphs = Array.from({ length: 200 }, (_, i) => `P${i + 1}`);
    const docx = zip({ 'word/document.xml': docxBody(paragraphs) });
    bridge.next = { name: 'long.docx', mimeType: DOCX, size: docx.length, bytes: docx };
    const result = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(result)).toMatchObject({ content: 'text', format: DOCX, truncated: true });
    expect(factsOf(result).note).toContain('CPU-time budget for one file (1 ms) after 64 paragraphs');
    expect(textOf(result.content[1])).toBe(paragraphs.slice(0, 64).join('\n'));
  });

  it('one extraction over the process-wide cap is refused at once with a retryable SERVICE_UNAVAILABLE, never queued', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 3000, maxConcurrent: 2 });
    const pdf = minimalPdf('Held open');
    const release = holdPdfOpens();
    const held = [
      extractFileContent(pdf, 'application/pdf', 'a.pdf'),
      extractFileContent(pdf, 'application/pdf', 'b.pdf'),
    ];
    try {
      const bridge = fullBridge();
      bridge.next = { name: 'policy.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
      const refused = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
      expect(refused.isError).toBe(true);
      expect(JSON.parse(textOf(refused.content[0])).error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'The server is already reading 2 files, the most it reads at once, so this file was not read. Try again in about 3 seconds.',
        details: { retryAfterSeconds: 3 },
      });
      // A text file is no document extraction: the cap does not touch it.
      bridge.next = { name: 'note.txt', mimeType: 'text/plain', size: 2, bytes: new Uint8Array(Buffer.from('ok')) };
      const text = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
      expect(text.isError).toBeUndefined();
    } finally {
      // Let the held two finish even when an assertion above failed, so no
      // slot stays taken into the next test.
      release();
      await Promise.allSettled(held);
    }
    for (const done of await Promise.all(held)) expect(done).toMatchObject({ kind: 'text', text: 'Held open' });
    // The held two finished, so their slots are free again.
    await expect(extractFileContent(pdf, 'application/pdf', 'c.pdf')).resolves.toMatchObject({ kind: 'text' });
  });

  it('the cap counts every extraction in flight: N run, the N+1th is refused', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 1000, maxConcurrent: 3 });
    const pdf = minimalPdf('Counted');
    const docx = zip({ 'word/document.xml': docxBody(['Counted']) });
    const release = holdPdfOpens();
    const attempts = [1, 2, 3, 4].map((n) => extractFileContent(pdf, 'application/pdf', `${n}.pdf`).then(
      (content) => ({ content }),
      (error: unknown) => ({ error }),
    ));
    release();
    const settled = await Promise.all(attempts);
    expect(settled.slice(0, 3).every((s) => 'content' in s)).toBe(true);
    expect(settled[3]).toEqual({ error: expect.any(ReadFileExtractionBusyError) });
    // Word extraction holds a slot too, and is refused the same way when none is free.
    configureReadFileExtraction({ cpuBudgetMs: 1000, maxConcurrent: 1 });
    const holdOne = holdPdfOpens();
    const pdfInFlight = extractFileContent(pdf, 'application/pdf', 'held.pdf');
    await expect(extractFileContent(docx, DOCX, 'w.docx')).rejects.toBeInstanceOf(ReadFileExtractionBusyError);
    holdOne();
    await pdfInFlight;
  });

  it('an extraction that throws releases its slot', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 1000, maxConcurrent: 1 });
    vi.spyOn(process, 'cpuUsage').mockImplementationOnce(() => {
      throw new Error('clock unavailable');
    });
    const bridge = fullBridge();
    const pdf = minimalPdf('After the throw');
    bridge.next = { name: 'policy.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    const thrown = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(factsOf(thrown)).toMatchObject({ content: 'none', note: 'The file\'s content could not be read. Download it with the link instead.' });
    const next = await callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
    expect(next.isError).toBeUndefined();
    expect(textOf(next.content[1])).toBe('After the throw');
  });
});

/**
 * [#31828] The same `read_file` answers, read on the extraction worker pool:
 * the request thread keeps running while a heavy PDF is read; a worker past
 * its wall-clock ceiling is terminated, the pages it sent back are the
 * answer, and the next call gets a fresh worker; a crashed worker fails only
 * its own call; the over-cap refusal is decided on the request thread as
 * before; and where no worker can start, the in-process answer is the same.
 *
 * Under vitest the pool's own module is the TypeScript source, which has no
 * built worker beside it, so every describe above this one runs the
 * in-process path (the phase-1 pins, unedited). Here the pool is pointed at
 * the worker's source, started through the repo's `tsx` loader.
 */
describe('read_file extracts PDF and Word text on a worker pool, off the request thread', { timeout: 60_000 }, () => {
  const SOURCE_WORKER: ExtractionWorkerEntry = {
    url: new URL('./file-extraction-worker.ts', import.meta.url),
    execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],
  };
  const DEFAULTS = { cpuBudgetMs: READ_FILE_CPU_BUDGET_MS_DEFAULT, maxConcurrent: READ_FILE_MAX_CONCURRENT_DEFAULT };
  let runtime: MCPServerRuntime;
  beforeEach(() => {
    runtime = new MCPServerRuntime({ name: 'file-tools', version: '0.0.0' });
    configureReadFileExtraction(DEFAULTS);
    configureExtractionWorkerEntry(SOURCE_WORKER);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    configureExtractionWorkerEntry(undefined);
    configureReadFileExtraction(DEFAULTS);
  });

  /** A PDF whose pages each say `Page N text`, plus `drawOps(N)` path operators (what makes a page slow to read). */
  function heavyPdf(pages: number, drawOps: (page: number) => number): Uint8Array {
    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    const kids: string[] = [];
    for (let i = 0; i < pages; i++) {
      const pageId = 4 + i * 2;
      const draw: string[] = [];
      for (let k = 0; k < drawOps(i + 1); k++) draw.push(`${(k * 7) % 600} ${(k * 13) % 780} m ${(k * 11) % 600} ${(k * 17) % 780} l S`);
      const stream = `BT /F1 12 Tf 72 720 Td (Page ${i + 1} text) Tj ET\n${draw.join('\n')}`;
      kids.push(`${pageId} 0 R`);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
      objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }
    objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(out, 'latin1'));
  }
  const pageTexts = (n: number) => Array.from({ length: n }, (_, i) => `Page ${i + 1} text`);

  async function readFile(bridge: ReturnType<typeof fullBridge>, file: Partial<McpReadFile>) {
    bridge.next = file;
    return callTool(runtime, bridge, 'read_file', { objectName: 'claim', recordId: 'c1', field: 'policy' });
  }

  it('CONTROL: a small PDF and a small Word document read in full on a worker, the same answer the in-process path gives', async () => {
    const bridge = fullBridge();
    const pdf = multiPagePdf(['Page one opens', 'Page two follows', 'Page three closes']);
    const docx = zip({ 'word/document.xml': docxBody(['Claim summary', 'Water &amp; mould']) });
    const pdfFile = { name: 'three.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    const docxFile = { name: 'summary.docx', mimeType: DOCX, size: docx.length, bytes: docx };

    const onWorker = [await readFile(bridge, pdfFile), await readFile(bridge, docxFile)];
    expect(extractionWorkerPoolStats().started).toBeGreaterThanOrEqual(1);
    expect(textOf(onWorker[0].content[1])).toBe('Page one opens\n\nPage two follows\n\nPage three closes');
    expect(factsOf(onWorker[0]).truncated).toBeUndefined();
    expect(textOf(onWorker[1].content[1])).toBe('Claim summary\nWater & mould');

    // The in-process path: under vitest the built entry is not beside the
    // pool's source, so no worker starts, said once at warn with the reason.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureExtractionWorkerEntry(undefined);
    const inProcess = [await readFile(bridge, pdfFile), await readFile(bridge, docxFile)];
    expect(inProcess).toEqual(onWorker);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('not a built .js or .cjs file');
    expect(String(warn.mock.calls[0][0])).toContain('The CPU budget and the cap on extractions in flight still apply.');
  });

  it('an entry that fails before it is ready falls back to in-process, said once, and answers the same', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configureExtractionWorkerEntry({ url: new URL('data:text/javascript,throw new Error("no extraction here")') });
    const bridge = fullBridge();
    const pdf = minimalPdf('Read in-process');
    const first = await readFile(bridge, { name: 'a.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf });
    const second = await readFile(bridge, { name: 'a.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf });
    expect(textOf(first.content[1])).toBe('Read in-process');
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('no extraction here');
  });

  it('the request thread keeps ticking while a heavy PDF is read', async () => {
    const pdf = heavyPdf(120, () => 2250);
    const bridge = fullBridge();
    const file = { name: 'heavy.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    await readFile(bridge, file); // warm: the worker starts and loads unpdf
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
    }, 1);
    const started = performance.now();
    const result = await readFile(bridge, file);
    const wallMs = performance.now() - started;
    clearInterval(interval);
    expect(textOf(result.content[1])).toBe(pageTexts(120).join('\n\n'));
    expect(factsOf(result).truncated).toBeUndefined();
    // In-process this count is 0 (pdf.js never yields a macrotask while it
    // reads). On the pool a 1 ms timer fires through the read: at least one
    // tick per 4 ms of wall time, and at least 20.
    expect({ ticks, enough: ticks >= 20 && ticks >= wallMs / 4 }).toMatchObject({ enough: true });
  });

  it('out of CPU budget on the worker: the pages read so far, truncated, with the budget note, as in-process', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 30, maxConcurrent: 4 });
    const pdf = heavyPdf(120, () => 2250);
    const bridge = fullBridge();
    const file = { name: 'heavy.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
    await readFile(bridge, minimalPdfFile()); // warm, so unpdf's load is not charged here
    const result = await readFile(bridge, file);
    const facts = factsOf(result);
    expect(facts).toMatchObject({ content: 'text', format: 'application/pdf', truncated: true });
    const read = /^Reading stopped at the CPU-time budget for one file \(30 ms\) after page (\d+) of 120, so the text is partial\. Download the file with the link for the rest\.$/.exec(facts.note);
    expect(read).not.toBeNull();
    const pages = Number(read![1]);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThan(120);
    expect(textOf(result.content[1])).toBe(pageTexts(pages).join('\n\n'));
    expect(facts.download).toBeTruthy();

    const paragraphs = Array.from({ length: 60_000 }, (_, i) => `Paragraph ${i + 1}`);
    const docx = zip({ 'word/document.xml': docxBody(paragraphs) });
    const word = await readFile(bridge, { name: 'long.docx', mimeType: DOCX, size: docx.length, bytes: docx });
    const wordFacts = factsOf(word);
    expect(wordFacts).toMatchObject({ content: 'text', format: DOCX, truncated: true });
    const count = Number(/after (\d+) paragraphs, so the text is partial/.exec(wordFacts.note)?.[1]);
    expect(count % 64).toBe(0);
    expect(count).toBeLessThan(paragraphs.length);
    // The length cap still applies to what was read.
    expect(textOf(word.content[1])).toBe(paragraphs.slice(0, count).join('\n').slice(0, 100_000));
  });

  function minimalPdfFile(text = 'Small') {
    const pdf = minimalPdf(text);
    return { name: 'small.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf };
  }

  it('a worker past its wall-clock ceiling is terminated: the pages it sent back are the answer, and the next call gets a fresh worker', async () => {
    // Ceiling = 5 x 40 ms. Page 2 alone takes far longer, and a page is never
    // cut by the budget (it is checked between pages), so only the ceiling
    // can stop this read.
    configureReadFileExtraction({ cpuBudgetMs: 40, maxConcurrent: 1 });
    const bridge = fullBridge();
    await readFile(bridge, minimalPdfFile()); // warm the one worker
    expect(extractionWorkerPoolStats()).toEqual({ started: 1, idle: 1 });
    const pdf = heavyPdf(3, (page) => (page === 2 ? 600_000 : 0));
    const stopped = await readFile(bridge, { name: 'stuck.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf });
    expect(stopped.isError).toBeUndefined();
    expect(factsOf(stopped)).toMatchObject({
      content: 'text',
      format: 'application/pdf',
      truncated: true,
      note: 'Reading stopped at the CPU-time budget for one file (40 ms) after page 1 of 3, so the text is partial. '
        + 'Download the file with the link for the rest.',
    });
    expect(textOf(stopped.content[1])).toBe('Page 1 text');
    // The overrun worker is gone, not back in the pool.
    expect(extractionWorkerPoolStats()).toEqual({ started: 1, idle: 0 });

    const next = await readFile(bridge, minimalPdfFile('Served next'));
    expect(textOf(next.content[1])).toBe('Served next');
    expect(extractionWorkerPoolStats()).toEqual({ started: 2, idle: 1 });
  });

  it('a worker that crashes fails only its own call, with the could-not-read answer, and is replaced', async () => {
    // A stand-in worker: it crashes on a file whose first byte is "X", and
    // otherwise answers the bytes as text, so the pool's own handling is what
    // is pinned.
    const standIn = [
      "import { parentPort } from 'node:worker_threads';",
      "parentPort.on('message', (job) => {",
      '  if (job.bytes[0] === 88) process.exit(7);',
      "  parentPort.postMessage({ type: 'done', result: { kind: 'text', format: 'application/pdf', text: new TextDecoder().decode(job.bytes), truncated: false } });",
      '});',
      "parentPort.postMessage({ type: 'ready' });",
    ].join('\n');
    configureExtractionWorkerEntry({ url: new URL(`data:text/javascript,${encodeURIComponent(standIn)}`) });
    configureReadFileExtraction({ cpuBudgetMs: 1000, maxConcurrent: 1 });
    const bridge = fullBridge();
    const crash = new Uint8Array(Buffer.from('X marks the crash'));
    const crashed = await readFile(bridge, { name: 'boom.pdf', mimeType: 'application/pdf', size: crash.length, bytes: crash });
    expect(factsOf(crashed)).toMatchObject({
      content: 'none',
      note: 'The file\'s content could not be read. Download it with the link instead.',
    });
    expect(extractionWorkerPoolStats()).toEqual({ started: 1, idle: 0 });
    const fine = new Uint8Array(Buffer.from('fine'));
    const next = await readFile(bridge, { name: 'fine.pdf', mimeType: 'application/pdf', size: fine.length, bytes: fine });
    expect(textOf(next.content[1])).toBe('fine');
    expect(extractionWorkerPoolStats()).toEqual({ started: 2, idle: 1 });
  });

  it('over the cap is refused on the request thread, at once, with the same retryable answer, while workers read', async () => {
    configureReadFileExtraction({ cpuBudgetMs: 3000, maxConcurrent: 2 });
    const pdf = heavyPdf(40, () => 2250);
    const inFlight = [
      extractFileContent(pdf, 'application/pdf', 'a.pdf'),
      extractFileContent(pdf, 'application/pdf', 'b.pdf'),
    ];
    try {
      const bridge = fullBridge();
      const refused = await readFile(bridge, { name: 'c.pdf', mimeType: 'application/pdf', size: pdf.length, bytes: pdf });
      expect(refused.isError).toBe(true);
      expect(JSON.parse(textOf(refused.content[0])).error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'The server is already reading 2 files, the most it reads at once, so this file was not read. Try again in about 3 seconds.',
        details: { retryAfterSeconds: 3 },
      });
    } finally {
      await Promise.allSettled(inFlight);
    }
    for (const done of await Promise.all(inFlight)) expect(done).toMatchObject({ kind: 'text', text: pageTexts(40).join('\n\n') });
    // Both slots are free again, and the two workers wait in the pool.
    expect(extractionWorkerPoolStats()).toEqual({ started: 2, idle: 2 });
    await expect(extractFileContent(minimalPdf('Free'), 'application/pdf', 'd.pdf')).resolves.toMatchObject({ text: 'Free' });
  });
});
