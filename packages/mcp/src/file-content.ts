// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { inflateRawSync } from 'node:zlib';

/**
 * [#30892] What `read_file` hands an agent from a file a record carries: the
 * file's words, or the image itself, beside its size, the cap that applied
 * and a short-lived download link.
 *
 * ## The caps, each a named constant
 *
 *  - {@link READ_FILE_MAX_BYTES}: the largest file whose bytes are read at
 *    all. A larger file answers its size, the cap and the link, and nothing
 *    is extracted. Every extractor below runs only on bytes already within it.
 *  - {@link READ_FILE_TEXT_MAX_CHARS}: the most characters of text one answer
 *    carries; past it the text is cut and the answer says so.
 *  - {@link READ_FILE_PDF_MAX_PAGES}: the most PDF pages read.
 *  - {@link READ_FILE_DOCX_XML_MAX_BYTES}: the most bytes a `.docx` body may
 *    inflate to (a compressed body can expand far past its stored size).
 *
 * ## The extractors
 *
 *  - Text (`text/*`, JSON, XML, CSV, Markdown, YAML, SVG): decoded as UTF-8.
 *  - Images (PNG, JPEG, GIF, WebP): returned as an MCP image block, up to
 *    {@link READ_FILE_IMAGE_MAX_BYTES}.
 *  - PDF: `unpdf` 1.9.1 (pdf.js), loaded by dynamic import on the first PDF
 *    read, with pdf.js's `eval` path off (`isEvalSupported: false`) and its
 *    console output off. A file pdf.js cannot open answers a sentence, never a
 *    throw out of the tool.
 *  - Word (`.docx`): the ZIP's `word/document.xml`, inflated with `node:zlib`
 *    under {@link READ_FILE_DOCX_XML_MAX_BYTES}, its paragraphs as lines.
 *
 * Anything else answers its size and the link, and says it has no text this
 * tool reads.
 */

/** The largest file `read_file` reads the bytes of: 10 MiB. */
export const READ_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** The most characters of extracted text one `read_file` answer carries. */
export const READ_FILE_TEXT_MAX_CHARS = 100_000;

/** The most PDF pages `read_file` reads. */
export const READ_FILE_PDF_MAX_PAGES = 200;

/** The most bytes a `.docx` body (`word/document.xml`) may inflate to: 32 MiB. */
export const READ_FILE_DOCX_XML_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The largest image returned as an image block: 5 MiB, the most an MCP client
 * passes to a model as one image. A larger image answers its link.
 */
export const READ_FILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** The images an MCP image block carries; any other image answers its link. */
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The media types read as text, beside every `text/*`. */
const TEXT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/csv',
  'application/javascript',
  'application/sql',
  'image/svg+xml',
]);

/** The media type a name's extension stands for, for a file stored with none (or as bytes). */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX_TYPE,
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The file the bridge read, as `read_file` renders it. */
export interface McpReadFile {
  fileId: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  /** The file field that holds it, for a field file. */
  field?: string;
  /** The `sys_attachment` row, for an attachment. */
  attachmentId?: string;
  /** The byte cap the read was asked under. */
  maxBytes: number;
  /** The file's bytes, present only when the file is within {@link maxBytes}. */
  bytes?: Uint8Array;
  /** A short-lived download link, or `null` when the storage adapter can issue none. */
  download: { url: string; expiresAt: string } | null;
}

/** One file a record carries, as `read_file` lists it when no file is named. */
export interface McpRecordFileEntry {
  fileId: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  field?: string;
  attachmentId?: string;
}

/** Which of a record's files `read_file` reads: one a file field holds, or one attachment. */
export type McpRecordFileTarget = { field: string; fileId?: string } | { attachmentId: string };

/** Where a `create_upload_link` link lands: a file field, or the record's attachments. */
export type McpUploadLinkTarget = { field: string } | { attachments: true };

/** A single-use upload link, as the bridge mints it. */
export interface McpUploadLink {
  /** The absolute link the user opens. */
  url: string;
  /** When it stops working (ISO 8601). */
  expiresAt: string;
}

/**
 * [#30892] The file seam of the HTTP MCP tools, implemented by the runtime
 * over the storage plugin's `file-attachments` service. Every member runs AS
 * the authenticated principal and throws ADR-0112 coded refusals. OPTIONAL,
 * member by member, like {@link McpDataBridge.aggregate}: a host that cannot
 * reach a record's files omits them, and `read_file` / `create_upload_link`
 * are not registered.
 */
export interface McpFileBridge {
  /** The files the caller can read on the record. */
  listRecordFiles?(object: string, recordId: string): Promise<McpRecordFileEntry[]>;
  /** One of the record's files, with its bytes when within `maxBytes`, and a download link. */
  readRecordFile?(
    object: string,
    recordId: string,
    target: McpRecordFileTarget,
    options: { maxBytes: number },
  ): Promise<McpReadFile>;
  /** A single-use upload link bound to exactly this record and field (or its attachments). */
  createUploadLink?(object: string, recordId: string, target: McpUploadLinkTarget): Promise<McpUploadLink>;
}

/** One MCP tool-result content block `read_file` answers with. */
export type FileContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** The content a file yields: its text, its image, or a sentence on why there is neither. */
export type ExtractedContent =
  | { kind: 'text'; text: string; truncated: boolean; format: string }
  | { kind: 'image'; data: string; mimeType: string }
  | { kind: 'none'; reason: string };

/** The media type to read the file as: the stored one, else the name's extension, lower-cased and without parameters. */
export function effectiveMimeType(mimeType: string | null, name: string): string {
  const stored = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (stored && stored !== 'application/octet-stream') return stored;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return TYPE_BY_EXTENSION[ext] ?? (stored || 'application/octet-stream');
}

function isTextType(type: string): boolean {
  return type.startsWith('text/') || TEXT_TYPES.has(type) || type.endsWith('+json') || type.endsWith('+xml');
}

function bounded(text: string): { text: string; truncated: boolean } {
  return text.length > READ_FILE_TEXT_MAX_CHARS
    ? { text: text.slice(0, READ_FILE_TEXT_MAX_CHARS), truncated: true }
    : { text, truncated: false };
}

/**
 * The content of a file's bytes, by its media type. Never throws: a file an
 * extractor cannot read answers `{ kind: 'none' }` with the sentence.
 */
export async function extractFileContent(bytes: Uint8Array, mimeType: string | null, name: string): Promise<ExtractedContent> {
  const type = effectiveMimeType(mimeType, name);
  if (INLINE_IMAGE_TYPES.has(type)) {
    if (bytes.byteLength > READ_FILE_IMAGE_MAX_BYTES) {
      return {
        kind: 'none',
        reason: `The image is ${bytes.byteLength} bytes, over the ${READ_FILE_IMAGE_MAX_BYTES}-byte cap for showing an image. Download it with the link instead.`,
      };
    }
    return { kind: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: type };
  }
  if (isTextType(type)) {
    return { kind: 'text', format: type, ...bounded(new TextDecoder('utf-8').decode(bytes)) };
  }
  if (type === 'application/pdf') return extractPdfText(bytes);
  if (type === DOCX_TYPE) return extractDocxText(bytes);
  return {
    kind: 'none',
    reason: `A ${type} file has no text read_file can read. Download it with the link instead.`,
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────

/** The slice of pdf.js's text item a page's text is read from. */
interface PdfTextItem {
  str?: unknown;
  hasEOL?: unknown;
}

/** The slice of pdf.js's document proxy read here. */
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }>; cleanup?(): unknown }>;
  destroy(): Promise<void>;
}

/** The slice of `unpdf` used, typed here so pdf.js's own types stay out of this package's surface. */
interface UnpdfModule {
  getDocumentProxy(data: Uint8Array, options?: Record<string, unknown>): Promise<PdfDocument>;
}

let unpdfModule: Promise<UnpdfModule> | undefined;

/** `unpdf`, imported on the first PDF read, never at load. */
function loadUnpdf(): Promise<UnpdfModule> {
  unpdfModule ??= import('unpdf').then((m) => m as unknown as UnpdfModule);
  return unpdfModule;
}

async function extractPdfText(bytes: Uint8Array): Promise<ExtractedContent> {
  let doc: PdfDocument;
  try {
    const unpdf = await loadUnpdf();
    // pdf.js keeps the buffer it is handed; it gets a copy.
    doc = await unpdf.getDocumentProxy(new Uint8Array(bytes), {
      isEvalSupported: false,
      // Errors only: pdf.js warns through `console.log`, which on a stdio
      // transport is the protocol stream.
      verbosity: 0,
      disableFontFace: true,
      useSystemFonts: false,
    });
  } catch (err) {
    const passworded = (err as { name?: unknown })?.name === 'PasswordException';
    return {
      kind: 'none',
      reason: passworded
        ? 'This PDF is password-protected, so its text cannot be read. Download it with the link instead.'
        : 'This file could not be read as a PDF: it is damaged or not a PDF. Download it with the link instead.',
    };
  }
  try {
    const pages = Math.min(doc.numPages, READ_FILE_PDF_MAX_PAGES);
    const parts: string[] = [];
    let length = 0;
    let read = 0;
    for (let n = 1; n <= pages && length <= READ_FILE_TEXT_MAX_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        pageText += item.str + (item.hasEOL === true ? '\n' : '');
      }
      page.cleanup?.();
      parts.push(pageText.trim());
      length += pageText.length + 2;
      read = n;
    }
    const joined = parts.join('\n\n').trim();
    if (!joined) {
      return {
        kind: 'none',
        reason: 'This PDF has no text layer (it may be a scan), so there is no text to read. Download it with the link instead.',
      };
    }
    const { text, truncated } = bounded(joined);
    return { kind: 'text', format: 'application/pdf', text, truncated: truncated || read < doc.numPages };
  } catch {
    return {
      kind: 'none',
      reason: 'This PDF could not be read to the end: it is damaged. Download it with the link instead.',
    };
  } finally {
    try {
      await doc.destroy();
    } catch {
      // Releasing the document is best-effort; the answer is already decided.
    }
  }
}

// ── Word (.docx) ─────────────────────────────────────────────────────────

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
/** The end record is 22 bytes plus a comment of at most 65535. */
const ZIP_END_SEARCH_SPAN = 22 + 0xffff;
const DOCX_BODY_ENTRY = 'word/document.xml';

const NOT_A_DOCX =
  'This file could not be read as a Word document: it is damaged or not a .docx. Download it with the link instead.';

/** The stored bytes of one ZIP entry and how they are compressed, or `null` when the archive has no such entry. */
function zipEntry(buf: Buffer, wanted: string): { method: number; data: Buffer } | null {
  const searchFrom = Math.max(0, buf.length - ZIP_END_SEARCH_SPAN);
  let end = -1;
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('no end of central directory');
  const entries = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  for (let k = 0; k < entries; k++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== ZIP_CENTRAL_DIRECTORY_HEADER) throw new Error('bad central directory');
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === wanted) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_HEADER) {
        throw new Error('bad local header');
      }
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      if (start + compressedSize > buf.length) throw new Error('truncated entry');
      return { method, data: buf.subarray(start, start + compressedSize) };
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16), whole);
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), whole);
    return XML_ENTITIES[body] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** A `.docx` body's text: paragraphs as lines, tabs and breaks kept, every other tag dropped. */
function docxXmlText(xml: string): string {
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

function extractDocxText(bytes: Uint8Array): ExtractedContent {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let entry: { method: number; data: Buffer } | null;
  try {
    entry = zipEntry(buf, DOCX_BODY_ENTRY);
  } catch {
    return { kind: 'none', reason: NOT_A_DOCX };
  }
  if (!entry) return { kind: 'none', reason: NOT_A_DOCX };
  let xml: Buffer;
  try {
    if (entry.method === 0) xml = entry.data;
    else if (entry.method === 8) xml = inflateRawSync(entry.data, { maxOutputLength: READ_FILE_DOCX_XML_MAX_BYTES });
    else return { kind: 'none', reason: NOT_A_DOCX };
  } catch (err) {
    const tooLarge = (err as { code?: unknown })?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError;
    return {
      kind: 'none',
      reason: tooLarge
        ? `This Word document's text expands past ${READ_FILE_DOCX_XML_MAX_BYTES} bytes, more than read_file reads. Download it with the link instead.`
        : NOT_A_DOCX,
    };
  }
  if (xml.length > READ_FILE_DOCX_XML_MAX_BYTES) {
    return {
      kind: 'none',
      reason: `This Word document's text is more than ${READ_FILE_DOCX_XML_MAX_BYTES} bytes, more than read_file reads. Download it with the link instead.`,
    };
  }
  const text = docxXmlText(xml.toString('utf8'));
  if (!text) return { kind: 'none', reason: 'This Word document has no text.' };
  return { kind: 'text', format: DOCX_TYPE, ...bounded(text) };
}

// ── The answer ───────────────────────────────────────────────────────────

/**
 * `read_file`'s content blocks: first the file's facts as JSON (what it is,
 * its size, the cap, the link and how the content was read), then its text or
 * its image when there is one.
 */
export async function renderReadFile(file: McpReadFile): Promise<FileContentBlock[]> {
  const facts: Record<string, unknown> = {
    fileId: file.fileId,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    ...(file.field !== undefined ? { field: file.field } : {}),
    ...(file.attachmentId !== undefined ? { attachmentId: file.attachmentId } : {}),
    maxBytes: file.maxBytes,
    download: file.download,
  };
  let extracted: ExtractedContent;
  if (!file.bytes) {
    extracted = {
      kind: 'none',
      reason:
        file.size !== null && file.size > file.maxBytes
          ? `The file is ${file.size} bytes, over the ${file.maxBytes}-byte cap read_file reads, so its content is not included. Download it with the link instead.`
          : 'The file\'s content could not be read here. Download it with the link instead.',
    };
  } else {
    try {
      extracted = await extractFileContent(file.bytes, file.mimeType, file.name);
    } catch {
      // Every extractor answers its own sentence; this is the net under them,
      // so a file never fails the tool.
      extracted = { kind: 'none', reason: 'The file\'s content could not be read. Download it with the link instead.' };
    }
  }
  if (extracted.kind === 'text') {
    facts.content = 'text';
    facts.format = extracted.format;
    if (extracted.truncated) {
      facts.truncated = true;
      facts.note = `The text is cut at ${READ_FILE_TEXT_MAX_CHARS} characters (or ${READ_FILE_PDF_MAX_PAGES} PDF pages); download the file for the rest.`;
    }
    return [
      { type: 'text', text: JSON.stringify(facts, null, 2) },
      { type: 'text', text: extracted.text },
    ];
  }
  if (extracted.kind === 'image') {
    facts.content = 'image';
    return [
      { type: 'text', text: JSON.stringify(facts, null, 2) },
      { type: 'image', data: extracted.data, mimeType: extracted.mimeType },
    ];
  }
  facts.content = 'none';
  facts.note = extracted.reason;
  return [{ type: 'text', text: JSON.stringify(facts, null, 2) }];
}
