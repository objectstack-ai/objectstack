// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { inflateRawSync } from 'node:zlib';

import { runExtractionInWorker } from './file-extraction-pool.js';

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
 *
 * ## Off the request thread, under two host bounds (ADR-0102 D1)
 *
 * PDF and Word extraction runs on a bounded `worker_threads` pool
 * (`file-extraction-pool.ts`, entry `file-extraction-worker.ts`), so the
 * request thread keeps serving every other request while a file is read (the
 * #31100 ruling, phase 2). Two host-configured bounds keep one caller's files
 * from holding the process (phase 1):
 *
 *  - a CPU-time budget per extraction ({@link READ_FILE_CPU_BUDGET_MS_ENV},
 *    default {@link READ_FILE_CPU_BUDGET_MS_DEFAULT}), checked between PDF
 *    pages and between Word paragraphs, never mid-page. In a worker it is the
 *    worker thread's own CPU time; in-process it is process CPU time
 *    (`process.cpuUsage()` deltas), which charges an extraction for work
 *    interleaved with it, so the error is to stop early, never late. Out of
 *    budget, the answer is the text read so far, `truncated: true`, and a note
 *    naming the budget and the download link. A worker that does not reach a
 *    checkpoint within {@link READ_FILE_WALL_CEILING_MULTIPLE} budgets of wall
 *    time is terminated and replaced, and the answer is the same shape over the
 *    pages it had already sent back.
 *  - a process-wide cap on extractions in flight
 *    ({@link READ_FILE_MAX_CONCURRENT_ENV}, default
 *    {@link READ_FILE_MAX_CONCURRENT_DEFAULT}), which is also the pool's size.
 *    Over it, the call is refused on the request thread at once, before any
 *    worker is touched, never queued: {@link ReadFileExtractionBusyError}, a
 *    retryable `SERVICE_UNAVAILABLE`.
 *
 * A host where the worker cannot start (one that bundled this package into a
 * single file, so the worker entry is not beside it) extracts in-process under
 * the same two bounds, said once at `warn` with the reason.
 *
 * Both are read once at boot ({@link configureReadFileExtraction}, called by
 * the plugin's `init`) and a malformed value is a boot fault naming the
 * variable, never a bound that is silently off.
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

/** The host variable naming the CPU-time budget of one PDF or Word extraction, in milliseconds. */
export const READ_FILE_CPU_BUDGET_MS_ENV = 'OS_MCP_READ_FILE_CPU_BUDGET_MS';

/** The host variable naming how many PDF or Word extractions may run at once in the process. */
export const READ_FILE_MAX_CONCURRENT_ENV = 'OS_MCP_READ_FILE_MAX_CONCURRENT';

/**
 * 2000 ms of CPU per extraction. Well above what any file within the other
 * caps was measured to take (a 9 MiB, 200-page PDF dense in drawing operators:
 * about 300–650 ms), so a self-hosted deployment reads every such file in full
 * as before; it stops only a file built to take seconds.
 */
export const READ_FILE_CPU_BUDGET_MS_DEFAULT = 2000;

/**
 * 4 extractions in flight. More than one person's assistant reads at once on a
 * self-hosted deployment, and few enough that a burst holds the process for at
 * most four budgets.
 */
export const READ_FILE_MAX_CONCURRENT_DEFAULT = 4;

/**
 * A worker's wall-clock ceiling per extraction, as a multiple of the CPU
 * budget: 5, so 10 s under the default budget. A worker checks its CPU budget
 * between pages, so the ceiling only catches one that does not reach a
 * checkpoint (a single page that runs long). Five is the share of one core a
 * worker still gets when every slot of the default pool (4) and the request
 * thread run on a single core: under that load a worker that is still
 * reaching its checkpoints has used its budget before the ceiling, so the
 * ceiling never cuts a read the budget would have let finish.
 */
export const READ_FILE_WALL_CEILING_MULTIPLE = 5;

/** The two host bounds on PDF and Word extraction. */
export interface ReadFileExtractionLimits {
  /** CPU time one extraction may use, in milliseconds, checked between pages or paragraphs. */
  cpuBudgetMs: number;
  /** Extractions that may run at once in the process, and the size of the worker pool; one more is refused. */
  maxConcurrent: number;
}

function readPositiveIntegerVar(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const text = raw.trim();
  const n = Number(text);
  // A typo here must not be the thing that switches the bound off: an
  // unreadable value fails loudly instead of reading as unset.
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n <= 0) {
    throw new Error(
      `${name} must be a positive integer; got ${JSON.stringify(raw)}. `
      + `Unset it for the default (${fallback}), or set a whole number.`,
    );
  }
  return n;
}

/**
 * The host's bounds on PDF and Word extraction, from `env` (default
 * `process.env`). An unset variable takes its default; a value that is not a
 * positive integer throws, naming the variable.
 */
export function resolveReadFileExtractionLimits(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): ReadFileExtractionLimits {
  return {
    cpuBudgetMs: readPositiveIntegerVar(env, READ_FILE_CPU_BUDGET_MS_ENV, READ_FILE_CPU_BUDGET_MS_DEFAULT),
    maxConcurrent: readPositiveIntegerVar(env, READ_FILE_MAX_CONCURRENT_ENV, READ_FILE_MAX_CONCURRENT_DEFAULT),
  };
}

let extractionLimits: ReadFileExtractionLimits | undefined;

/**
 * Fix the bounds every extraction in this process runs under: `limits`, or
 * the host's ({@link resolveReadFileExtractionLimits}). The plugin's `init`
 * calls it once, so a malformed variable fails the boot; a process that never
 * calls it reads the host's on its first extraction.
 */
export function configureReadFileExtraction(limits?: ReadFileExtractionLimits): ReadFileExtractionLimits {
  extractionLimits = limits ?? resolveReadFileExtractionLimits();
  return extractionLimits;
}

function activeExtractionLimits(): ReadFileExtractionLimits {
  extractionLimits ??= resolveReadFileExtractionLimits();
  return extractionLimits;
}

/** PDF and Word extractions running now, process-wide. */
let extractionsInFlight = 0;

/**
 * The refusal of an extraction over the process-wide cap: ADR-0112
 * `SERVICE_UNAVAILABLE` (503), retryable. The process is busy reading other
 * files, which says nothing about this caller or this file, so the answer is
 * "try again shortly", with the seconds to wait.
 */
export class ReadFileExtractionBusyError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE' as const;
  readonly status = 503;
  constructor(
    readonly maxConcurrent: number,
    /** Seconds to wait before retrying: about one extraction's budget. */
    readonly retryAfterSeconds: number,
  ) {
    super(
      `The server is already reading ${maxConcurrent} files, the most it reads at once, so this file was not read. `
      + `Try again in about ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
    );
    this.name = 'ReadFileExtractionBusyError';
  }
}

/** CPU time spent since a start reading, against one extraction's budget. */
export interface CpuBudget {
  readonly budgetMs: number;
  /** True once the extraction has used its budget. */
  spent(): boolean;
}

/** The in-process budget: process CPU time, which stops early, never late. */
function startCpuBudget(budgetMs: number): CpuBudget {
  const start = process.cpuUsage();
  return {
    budgetMs,
    spent() {
      const used = process.cpuUsage(start);
      return (used.user + used.system) / 1000 >= budgetMs;
    },
  };
}

/** The note an answer cut by the CPU budget carries. */
function cpuBudgetNote(budgetMs: number, read: string): string {
  return (
    `Reading stopped at the CPU-time budget for one file (${budgetMs} ms) after ${read}, so the text is partial. `
    + 'Download the file with the link for the rest.'
  );
}

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
  | {
      kind: 'text';
      text: string;
      truncated: boolean;
      format: string;
      /** Why the text is cut, when it was cut by something other than the length and page caps. */
      note?: string;
    }
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
 * The content of a file's bytes, by its media type. A file an extractor cannot
 * read answers `{ kind: 'none' }` with the sentence. Throws one thing: a PDF or
 * Word file met while the process already runs as many extractions as the host
 * allows is refused with {@link ReadFileExtractionBusyError}.
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
  if (type === 'application/pdf') return withExtractionSlot('pdf', bytes);
  if (type === DOCX_TYPE) return withExtractionSlot('docx', bytes);
  return {
    kind: 'none',
    reason: `A ${type} file has no text read_file can read. Download it with the link instead.`,
  };
}

/** The two documents read by extraction rather than decoding. */
export type DocumentKind = 'pdf' | 'docx';

/**
 * Run one document extraction inside the process-wide cap. Over the cap it is
 * refused at once, on this thread, before any worker is touched, never
 * queued. Within it, the extraction runs on a pool worker under the CPU
 * budget and the wall-clock ceiling; where no worker can start, in-process
 * under the CPU budget. The slot is released in `finally`, so an extraction
 * that throws (or whose worker crashed) frees it too.
 */
async function withExtractionSlot(kind: DocumentKind, bytes: Uint8Array): Promise<ExtractedContent> {
  const limits = activeExtractionLimits();
  if (extractionsInFlight >= limits.maxConcurrent) {
    throw new ReadFileExtractionBusyError(limits.maxConcurrent, Math.max(1, Math.ceil(limits.cpuBudgetMs / 1000)));
  }
  extractionsInFlight++;
  try {
    const outcome = await runExtractionInWorker(
      { kind, bytes, cpuBudgetMs: limits.cpuBudgetMs },
      { poolSize: limits.maxConcurrent, ceilingMs: limits.cpuBudgetMs * READ_FILE_WALL_CEILING_MULTIPLE },
    );
    if (outcome.status === 'done') return outcome.result;
    if (outcome.status === 'overrun') return stoppedExtractionAnswer(kind, outcome.progress, limits.cpuBudgetMs);
    return await extractDocument(kind, bytes, startCpuBudget(limits.cpuBudgetMs));
  } finally {
    extractionsInFlight--;
  }
}

/**
 * What an extraction has read so far, sent as it reads, so a worker stopped
 * part-way still answers the text it had already sent back.
 */
export type ExtractionProgress =
  /** The PDF opened, with this many pages. */
  | { kind: 'pdf-open'; numPages: number }
  /** The next PDF page's text, trimmed, in page order. */
  | { kind: 'pdf-page'; text: string }
  /** The Word body's text since the last report, as read, and the paragraphs read in all. */
  | { kind: 'docx-paragraphs'; text: string; paragraphs: number };

/** A sink an extractor reports its progress to; in-process there is none. */
export type ProgressSink = (progress: ExtractionProgress) => void;

/** One document's text, read under `budget`, reporting progress to `onProgress` as it goes. */
export async function extractDocument(
  kind: DocumentKind,
  bytes: Uint8Array,
  budget: CpuBudget,
  onProgress?: ProgressSink,
): Promise<ExtractedContent> {
  return kind === 'pdf' ? extractPdfText(bytes, budget, onProgress) : extractDocxText(bytes, budget, onProgress);
}

/**
 * The answer of an extraction stopped part-way at the wall-clock ceiling: the
 * text its progress carried, `truncated: true`, and the CPU-budget note, the
 * same shape an extraction stopped at its budget answers.
 */
export function stoppedExtractionAnswer(kind: DocumentKind, progress: readonly ExtractionProgress[], budgetMs: number): ExtractedContent {
  if (kind === 'pdf') {
    let numPages: number | undefined;
    const pages: string[] = [];
    for (const p of progress) {
      if (p.kind === 'pdf-open') numPages = p.numPages;
      else if (p.kind === 'pdf-page') pages.push(p.text);
    }
    const read = numPages === undefined ? `page ${pages.length}` : `page ${pages.length} of ${numPages}`;
    return pdfAnswer(pages, numPages ?? pages.length, cpuBudgetNote(budgetMs, read));
  }
  let text = '';
  let paragraphs = 0;
  for (const p of progress) {
    if (p.kind !== 'docx-paragraphs') continue;
    text += p.text;
    paragraphs = p.paragraphs;
  }
  return docxAnswer(text, false, cpuBudgetNote(budgetMs, `${paragraphs} paragraphs`));
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

/**
 * A PDF's answer from the pages read, in order: their text joined, cut at the
 * length cap, `truncated` when fewer than `numPages` were read, and the budget
 * note when reading stopped at the budget (which always truncates).
 */
function pdfAnswer(parts: readonly string[], numPages: number, budgetNote: string | undefined): ExtractedContent {
  const joined = parts.join('\n\n').trim();
  if (!joined) {
    return {
      kind: 'none',
      reason:
        budgetNote ??
        'This PDF has no text layer (it may be a scan), so there is no text to read. Download it with the link instead.',
    };
  }
  const { text, truncated } = bounded(joined);
  return {
    kind: 'text',
    format: 'application/pdf',
    text,
    truncated: truncated || parts.length < numPages || budgetNote !== undefined,
    ...(budgetNote !== undefined ? { note: budgetNote } : {}),
  };
}

async function extractPdfText(bytes: Uint8Array, budget: CpuBudget, onProgress?: ProgressSink): Promise<ExtractedContent> {
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
    onProgress?.({ kind: 'pdf-open', numPages: doc.numPages });
    const pages = Math.min(doc.numPages, READ_FILE_PDF_MAX_PAGES);
    const parts: string[] = [];
    let length = 0;
    let read = 0;
    let outOfBudget = false;
    for (let n = 1; n <= pages && length <= READ_FILE_TEXT_MAX_CHARS; n++) {
      // Between pages, never mid-page: the first page is always read.
      if (n > 1 && budget.spent()) {
        outOfBudget = true;
        break;
      }
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        pageText += item.str + (item.hasEOL === true ? '\n' : '');
      }
      page.cleanup?.();
      parts.push(pageText.trim());
      onProgress?.({ kind: 'pdf-page', text: parts[parts.length - 1] });
      length += pageText.length + 2;
      read = n;
    }
    const budgetNote = outOfBudget ? cpuBudgetNote(budget.budgetMs, `page ${read} of ${doc.numPages}`) : undefined;
    return pdfAnswer(parts, doc.numPages, budgetNote);
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

const DOCX_PARAGRAPH_END = '</w:p>';

/** How many `.docx` paragraphs are read between two reads of the CPU clock. */
const DOCX_BUDGET_CHECK_EVERY = 64;

/** One stretch of a `.docx` body as text: tabs and breaks kept, a paragraph end as a line end, every other tag dropped. */
function docxChunkText(xml: string): string {
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text);
}

/**
 * A `.docx` body's text: paragraphs as lines, tabs and breaks kept, every
 * other tag dropped. Read paragraph by paragraph, stopping at a paragraph end
 * once the CPU budget is spent; `paragraphs` counts those read and `complete`
 * says whether the body was read to its end.
 */
function docxXmlText(
  xml: string,
  budget: CpuBudget,
  onProgress?: ProgressSink,
): { text: string; complete: boolean; outOfBudget: boolean; paragraphs: number } {
  const parts: string[] = [];
  let reported = 0;
  let at = 0;
  let paragraphs = 0;
  let outOfBudget = false;
  while (at < xml.length) {
    const end = xml.indexOf(DOCX_PARAGRAPH_END, at);
    const next = end < 0 ? xml.length : end + DOCX_PARAGRAPH_END.length;
    parts.push(docxChunkText(xml.slice(at, next)));
    at = next;
    if (end >= 0) paragraphs++;
    if (at >= xml.length) break;
    // Between paragraphs, never mid-paragraph; every DOCX_BUDGET_CHECK_EVERY
    // paragraphs, so the clock read stays a rounding error on a long body.
    if (paragraphs % DOCX_BUDGET_CHECK_EVERY === 0) {
      if (onProgress) {
        onProgress({ kind: 'docx-paragraphs', text: parts.slice(reported).join(''), paragraphs });
        reported = parts.length;
      }
      if (budget.spent()) {
        outOfBudget = true;
        break;
      }
    }
  }
  return {
    text: parts.join(''),
    complete: at >= xml.length,
    outOfBudget,
    paragraphs,
  };
}

/**
 * A Word document's answer from its body's text as read: blank runs folded,
 * cut at the length cap, `truncated` when the body was not read to its end,
 * and the budget note when reading stopped at the budget.
 */
function docxAnswer(read: string, complete: boolean, budgetNote: string | undefined): ExtractedContent {
  const whole = read.replace(/\n{3,}/g, '\n\n').trim();
  if (!whole) return { kind: 'none', reason: budgetNote ?? 'This Word document has no text.' };
  const { text, truncated } = bounded(whole);
  return {
    kind: 'text',
    format: DOCX_TYPE,
    text,
    truncated: truncated || !complete,
    ...(budgetNote !== undefined ? { note: budgetNote } : {}),
  };
}

function extractDocxText(bytes: Uint8Array, budget: CpuBudget, onProgress?: ProgressSink): ExtractedContent {
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
  // The inflate above is one call and cannot stop part-way; its output is
  // bounded by READ_FILE_DOCX_XML_MAX_BYTES. The budget is checked between
  // the body's paragraphs.
  const read = docxXmlText(xml.toString('utf8'), budget, onProgress);
  const budgetNote = read.outOfBudget ? cpuBudgetNote(budget.budgetMs, `${read.paragraphs} paragraphs`) : undefined;
  return docxAnswer(read.text, read.complete, budgetNote);
}

// ── The answer ───────────────────────────────────────────────────────────

/**
 * `read_file`'s content blocks: first the file's facts as JSON (what it is,
 * its size, the cap, the link and how the content was read), then its text or
 * its image when there is one. Throws {@link ReadFileExtractionBusyError} when
 * the process already runs as many extractions as the host allows.
 */
export async function renderReadFile(file: McpReadFile): Promise<FileContentBlock[]> {
  // Outside the extractors' net: a host variable that is malformed fails the
  // call naming the variable, never reads as "could not be read".
  activeExtractionLimits();
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
    } catch (err) {
      // The process-wide cap's refusal is the one throw that is the answer:
      // the door renders it as a coded, retryable tool error.
      if (err instanceof ReadFileExtractionBusyError) throw err;
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
      facts.note =
        extracted.note ??
        `The text is cut at ${READ_FILE_TEXT_MAX_CHARS} characters (or ${READ_FILE_PDF_MAX_PAGES} PDF pages); download the file for the rest.`;
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
