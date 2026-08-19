// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_email.headers_json` / `sys_email.attachments_json` — the codec (#5177).
 *
 * ## What these two columns are for
 *
 * Everything durable about email delivery in this package hangs off ONE fact:
 * a queued (or stranded, or app-inserted) message is delivered from its
 * **`sys_email` row**, never from an in-memory object — `send()` publishes an
 * `{ rowId }` job (#5160), the boot sweep re-reads rows (#5161), and both end
 * at {@link rowToNormalized}. So a part of the message that no column can
 * carry is a part of the message that a row-based delivery **silently drops**.
 *
 * Before this module, custom headers and attachments were exactly that, and
 * the honest workaround was to refuse: a message carrying either was pushed
 * back onto inline delivery so it would at least go out whole. That trade
 * bought correctness by giving up durability for precisely the messages most
 * likely to matter (a signed receipt, a `List-Unsubscribe` header, an invoice
 * PDF). These columns buy it back.
 *
 * ## Why attachments are bounded, and why the bound is a constant
 *
 * `sys_email` is an append-only audit log, not a blob store. Base64 inflates
 * content by 4/3, so an unbounded attachment column would let one message
 * write an arbitrarily large row into a table nobody prunes. Phase 1 therefore
 * carries attachments **only up to {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES}
 * combined raw bytes** (~350 KB of base64 in the worst case) and leaves
 * anything larger on the pre-existing inline path — where it behaves exactly
 * as it does today. Over-limit is not an error; the worst outcome is the
 * status quo.
 *
 * The bound is a **constant, not a setting**, deliberately: a knob here would
 * be a second place for the row-size budget to drift, and there is no evidence
 * yet of a deployment that needs a different number. Raising it is a code
 * change with a reason attached, which is what a change to a storage budget
 * should cost.
 *
 * Out-of-row storage for large attachments (`storageKey`) is phase 2
 * (objectstack#5172), and it landed exactly as phase 1 predicted: a
 * *producer* for the key that was already declared, with no migration. Over
 * the budget, the content goes to the `storage` capability and the row
 * carries a reference plus the permanent audit metadata — see
 * `attachment-storage.ts`. Over the budget with no storage capability (or an
 * upload that fails), the pre-#5172 answer stands: inline delivery, whole,
 * loudly.
 *
 * ## Why decoding is strict
 *
 * Every failure mode here is "the recipient gets a message that is not the one
 * that was sent" — a stripped attachment, a header that vanished, bytes that
 * decoded to something else. None of it is visible from the outside: the row
 * says `sent`, the transport said 250. So a row whose payload columns do not
 * say exactly what they claim is **rejected loudly** (the row lands at
 * `failed` with the reason) instead of being delivered partially. That is
 * AGENTS.md Prime Directive #12 applied to data at rest: no `??`, no silent
 * coercion, no "best effort" reconstruction of a message.
 *
 * The strictness runs as far as re-hashing the content on read — `size` and
 * `hash` are not decoration, they are what turns a truncated or corrupted
 * column into an error instead of a wrong email.
 */

import { createHash } from 'node:crypto';
import type { EmailAttachment } from '@objectstack/spec/contracts';

/**
 * Combined **raw** (pre-base64) byte budget for ALL attachments on ONE
 * message, above which `sys_email` does not carry them.
 *
 * 256 KiB. A message at the limit stores ~350 KB of base64 in
 * `attachments_json`, which is the real bound on a `sys_email` row.
 *
 * Not configurable on purpose — see the module header.
 */
export const SYS_EMAIL_ATTACHMENT_LIMIT_BYTES = 256 * 1024;

/**
 * One element of `sys_email.attachments_json`.
 *
 * Shaped for phase 2 from the start: the content of an attachment is either
 * carried in the row ({@link inline}) or referenced out of it
 * ({@link storageKey}), and adding the second producer must not require
 * migrating rows written by the first.
 */
export interface PersistedEmailAttachment {
  /** `EmailAttachment.filename`, verbatim (UTF-8 — non-ASCII names included). */
  filename: string;
  /**
   * `EmailAttachment.contentType`, present **only when the sender supplied
   * one**.
   *
   * Deliberately optional rather than defaulted to `application/octet-stream`:
   * transports infer the type from the filename when it is absent (nodemailer
   * maps `report.pdf` → `application/pdf`), so writing a default here would
   * make a queued message arrive with a *different* MIME type than the same
   * message delivered inline. Recording only what the caller actually said is
   * what keeps the two paths byte-identical.
   */
  contentType?: string;
  /** Raw content size in bytes, before base64. Verified on read. */
  size: number;
  /**
   * Digest of the raw content, `sha256:<lowercase hex>`.
   *
   * Algorithm-tagged rather than a bare hex string so phase 2 can verify
   * storage-backed content without inferring which algorithm produced a
   * 64-character value.
   */
  hash: string;
  /** `EmailAttachment.cid` — an inline image in an HTML body is `cid:`-referenced and unusable without it. */
  cid?: string;
  /**
   * Which arm of the `content: string | Buffer` contract this attachment was
   * sent as, so the message is rebuilt as the same JS type it was sent with.
   *
   * Not cosmetic: nodemailer emits `Content-Type: text/plain; charset=utf-8`
   * for string content and omits the charset for a Buffer, so restoring a
   * text attachment as a Buffer would drop the charset declaration and let a
   * receiving client mis-decode a UTF-8 file it can no longer identify.
   * Required (not defaulted) because guessing it is exactly the silent
   * coercion this module refuses to do.
   */
  contentForm: 'string' | 'buffer';
  /** Base64 of the raw content, when the row carries it (phase 1's only producer). */
  inline?: string;
  /**
   * Reference to content held outside the row, in the `storage`
   * capability (objectstack#5172).
   *
   * Written instead of {@link inline} when the message is over
   * {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES} and queue delivery is in force —
   * see `attachment-storage.ts` for the key scheme. Mutually exclusive with
   * `inline` in practice, and a row carrying neither is rejected on read
   * rather than delivered without the attachment.
   *
   * **Removed when the content is reclaimed** (the row reached a terminal
   * state and the grace window passed), at which point
   * {@link contentReclaimedAt} takes its place. Everything else on this
   * element survives that: the metadata is the audit artifact, the bytes were
   * only the delivery artifact.
   */
  storageKey?: string;
  /**
   * ISO timestamp at which out-of-row content was deleted.
   *
   * Recorded so that "this row has no content" is a **statement** rather than
   * an absence to be guessed at: a reader can tell an attachment that was
   * reclaimed on schedule from one whose column was truncated, and says so in
   * the rejection. Never set on an element that still has content.
   */
  contentReclaimedAt?: string;
}

/** Outcome of {@link encodeAttachmentsForRow}. */
export type EncodedAttachments =
  /** No attachments — the column is not written. */
  | { kind: 'none' }
  /** Within budget: `json` goes into `attachments_json`. */
  | { kind: 'inline'; json: string; totalBytes: number }
  /**
   * Over {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES}.
   *
   * Nothing is written to the row **by this encoder**. The caller may still
   * offload the content to the `storage` capability (#5172); when it
   * cannot, `storageDetail` carries the sentence explaining why, so the one
   * log line the operator gets names the actual obstacle instead of only the
   * byte count.
   */
  | { kind: 'over-limit'; totalBytes: number; storageDetail?: string }
  /**
   * Content held out of the row, in the `storage` capability (#5172).
   * `json` goes into `attachments_json`; `keys` is what a later reclaim
   * deletes.
   */
  | { kind: 'storage'; json: string; keys: string[]; totalBytes: number }
  /** Content this codec cannot represent; nothing is written to the row. */
  | { kind: 'unsupported'; detail: string };

/** `sha256:<hex>` of the raw bytes. */
function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** One attachment reduced to the facts every encoder needs. */
export interface AttachmentPart {
  att: EmailAttachment;
  bytes: Buffer;
  /** `sha256:<hex>` of {@link bytes}. */
  hash: string;
  contentForm: 'string' | 'buffer';
}

/** Outcome of {@link collectAttachmentParts}. */
export type CollectedAttachments =
  | { kind: 'none' }
  | { kind: 'ok'; parts: AttachmentPart[]; totalBytes: number }
  | { kind: 'unsupported'; detail: string };

/**
 * Reduce a message's attachments to bytes + digest, once.
 *
 * Shared by the in-row encoder below and the storage offloader (#5172) so the
 * two producers of `attachments_json` cannot disagree about what an attachment
 * IS — which arm of `content: string | Buffer` it used, how many bytes it is,
 * what it hashes to. Two hand-written extractions would be two contracts, and
 * the digest is the thing the reader verifies against.
 */
export function collectAttachmentParts(
  attachments: EmailAttachment[] | undefined,
): CollectedAttachments {
  if (!attachments || attachments.length === 0) return { kind: 'none' };

  const parts: AttachmentPart[] = [];
  for (const att of attachments) {
    const content = att?.content;
    let bytes: Buffer;
    let contentForm: 'string' | 'buffer';
    if (typeof content === 'string') {
      bytes = Buffer.from(content, 'utf8');
      contentForm = 'string';
    } else if (Buffer.isBuffer(content)) {
      bytes = content;
      contentForm = 'buffer';
    } else {
      return {
        kind: 'unsupported',
        detail: `attachment '${String(att?.filename ?? '(unnamed)')}' carries a 'content' value that is neither `
          + 'a string nor a Buffer, which is the whole of the EmailAttachment contract',
      };
    }
    parts.push({ att, bytes, hash: digestOf(bytes), contentForm });
  }

  return { kind: 'ok', parts, totalBytes: parts.reduce((n, p) => n + p.bytes.byteLength, 0) };
}

/**
 * Encode a message's attachments for `sys_email.attachments_json`.
 *
 * Never throws: an attachment this codec cannot carry (too large, or a
 * `content` value outside the declared `string | Buffer` contract) is reported
 * as a verdict, because the caller's response is to fall back to inline
 * delivery — which is today's behaviour and always whole — not to fail the
 * send. Failing a send that works today would be a regression dressed as
 * strictness.
 */
export function encodeAttachmentsForRow(
  attachments: EmailAttachment[] | undefined,
): EncodedAttachments {
  const collected = collectAttachmentParts(attachments);
  if (collected.kind === 'none') return { kind: 'none' };
  if (collected.kind === 'unsupported') return { kind: 'unsupported', detail: collected.detail };

  const { parts, totalBytes } = collected;
  if (totalBytes > SYS_EMAIL_ATTACHMENT_LIMIT_BYTES) return { kind: 'over-limit', totalBytes };

  const items: PersistedEmailAttachment[] = parts.map(({ att, bytes, hash, contentForm }) => ({
    filename: String(att.filename ?? ''),
    ...(att.contentType ? { contentType: String(att.contentType) } : {}),
    size: bytes.byteLength,
    hash,
    ...(att.cid ? { cid: String(att.cid) } : {}),
    contentForm,
    inline: bytes.toString('base64'),
  }));
  return { kind: 'inline', json: JSON.stringify(items), totalBytes };
}

/** Shared prefix so every rejection names the column it came from. */
function reject(column: string, detail: string): never {
  throw new Error(`VALIDATION_FAILED: sys_email.${column} ${detail}`);
}

/** `null` / `undefined` / `''` — i.e. a row written before this column existed. */
function isAbsent(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function parseJson(column: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (err: any) {
    return reject(column, `is not valid JSON (${String(err?.message ?? err)})`);
  }
}

/**
 * One validated `attachments_json` element together with **where its content
 * is** — the seam between "is this row well-formed?" (synchronous, total) and
 * "can we get the bytes?" (asynchronous, needs the storage capability).
 *
 * The split exists so there is still exactly ONE validator. The alternative —
 * a second async decoder that re-implements the checks — is how the two halves
 * of a codec drift, and here the checks ARE the feature: size and digest are
 * what turn a truncated column into an error instead of a wrong email.
 */
export type AttachmentSource =
  /** Content is in the row; already base64-decoded. */
  | { kind: 'inline'; element: PersistedEmailAttachment; bytes: Buffer }
  /** Content is in the `storage` capability under `storageKey` (#5172). */
  | { kind: 'storage'; element: PersistedEmailAttachment; storageKey: string };

/**
 * Validate `sys_email.attachments_json` and say, per element, where its
 * content lives. Throws on anything that does not describe what it claims to.
 *
 * `undefined` for a row with no such column (every row written before #5177).
 */
export function readAttachmentColumn(value: unknown): AttachmentSource[] | undefined {
  if (isAbsent(value)) return undefined;
  const parsed = parseJson('attachments_json', value);
  if (parsed == null) return undefined;
  if (!Array.isArray(parsed)) reject('attachments_json', 'must decode to an array of attachments');
  if (parsed.length === 0) return undefined;

  return parsed.map((raw: any, i: number): AttachmentSource => {
    const at = `[${i}]`;
    if (!raw || typeof raw !== 'object') reject('attachments_json', `${at} is not an object`);
    const filename = raw.filename;
    if (typeof filename !== 'string' || filename === '') {
      reject('attachments_json', `${at}.filename is required and must be a non-empty string`);
    }
    if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size < 0) {
      reject('attachments_json', `${at}.size is required and must be a non-negative number`);
    }
    if (typeof raw.hash !== 'string' || raw.hash === '') {
      reject('attachments_json', `${at}.hash is required and must be a non-empty string`);
    }
    if (raw.contentForm !== 'string' && raw.contentForm !== 'buffer') {
      reject(
        'attachments_json',
        `${at}.contentForm must be 'string' or 'buffer' — it says which arm of the EmailAttachment `
        + "`content: string | Buffer` contract to rebuild, and guessing it would change the attachment's "
        + 'declared charset',
      );
    }

    const element: PersistedEmailAttachment = {
      filename,
      ...(typeof raw.contentType === 'string' && raw.contentType ? { contentType: raw.contentType } : {}),
      size: raw.size,
      hash: raw.hash,
      ...(typeof raw.cid === 'string' && raw.cid ? { cid: raw.cid } : {}),
      contentForm: raw.contentForm,
    };

    if (typeof raw.inline === 'string' && raw.inline !== '') {
      return { kind: 'inline', element, bytes: Buffer.from(raw.inline, 'base64') };
    }
    if (typeof raw.storageKey === 'string' && raw.storageKey !== '') {
      return { kind: 'storage', element, storageKey: raw.storageKey };
    }
    if (typeof raw.contentReclaimedAt === 'string' && raw.contentReclaimedAt !== '') {
      // The one "no content" case that is not damage. Still a refusal: the
      // metadata is audit evidence, not something a transport can send.
      reject(
        'attachments_json',
        `${at} ('${filename}') had its out-of-row content reclaimed at ${raw.contentReclaimedAt}, after this `
        + 'row reached a terminal state — the message it belonged to was already delivered, and the remaining '
        + 'filename/size/hash are audit evidence, not a payload. Refusing to re-send this row without the '
        + 'attachment it declares',
      );
    }
    reject('attachments_json', `${at} carries no content: neither 'inline' nor a readable reference`);
  });
}

/**
 * Turn one validated element plus its raw bytes into an `EmailAttachment`,
 * verifying that the bytes are the ones the row describes.
 *
 * This is where `size` and `hash` earn their place, and it runs identically
 * whether the bytes came out of the row or out of storage — a storage backend
 * that returns a truncated object is exactly as unacceptable as a truncated
 * column, and used to be exactly as invisible.
 */
export function materializeAttachment(
  element: PersistedEmailAttachment,
  bytes: Buffer,
  origin: string,
): EmailAttachment {
  if (bytes.byteLength !== element.size) {
    reject(
      'attachments_json',
      `${origin} for '${element.filename}' is ${bytes.byteLength} byte(s) but the row records size `
      + `${element.size} — the content was truncated or rewritten`,
    );
  }
  const actual = digestOf(bytes);
  if (actual !== element.hash) {
    reject(
      'attachments_json',
      `${origin} for '${element.filename}' hashes to ${actual} but the row records ${element.hash} — the `
      + 'stored content is not the content that was sent',
    );
  }
  return {
    filename: element.filename,
    content: element.contentForm === 'string' ? bytes.toString('utf8') : bytes,
    ...(element.contentType ? { contentType: element.contentType } : {}),
    ...(element.cid ? { cid: element.cid } : {}),
  };
}

/**
 * Rebuild `attachments` from `sys_email.attachments_json`, **from the row
 * alone**.
 *
 * Returns `undefined` for a row that has no such column (every row written
 * before #5177) — reading an old row must stay safe. Everything else is
 * verified: a column that is present but does not describe the message it
 * claims to describe throws, so the row lands at `failed` with the reason
 * rather than being delivered without the attachment.
 *
 * An element whose content is **out of the row** (`storageKey`, #5172) throws
 * here rather than being skipped: this function has no way to fetch it, and a
 * caller that reaches this path without a storage capability wired must get an
 * error, not a message missing an attachment. Use
 * {@link decodeAttachmentsFromRowAsync} on any path that can fetch.
 */
export function decodeAttachmentsFromRow(value: unknown): EmailAttachment[] | undefined {
  const sources = readAttachmentColumn(value);
  if (!sources) return undefined;
  return sources.map((source, i) => {
    if (source.kind === 'storage') {
      reject(
        'attachments_json',
        `[${i}] ('${source.element.filename}') holds its content out of the row under storageKey `
        + `'${source.storageKey}', and this delivery path has no storage capability to fetch it from. `
        + 'Fix: mount the storage capability (@objectstack/service-storage) on the process that delivers '
        + 'sys_email rows. Refusing rather than delivering the message without this attachment',
      );
    }
    return materializeAttachment(source.element, source.bytes, `[${i}].inline`);
  });
}

/**
 * Rebuild `attachments`, fetching out-of-row content through `fetchContent`.
 *
 * `fetchContent` is `undefined` when no storage capability is available; a row
 * that needs one then fails exactly as it does in
 * {@link decodeAttachmentsFromRow}. A fetch that throws is **not** caught here
 * — the storage layer was made loud in #5216/#5232 so a read outage stops
 * looking like a miss, and re-swallowing it would put a message with a missing
 * attachment on the wire.
 */
export async function decodeAttachmentsFromRowAsync(
  value: unknown,
  fetchContent?: (storageKey: string) => Promise<Buffer>,
): Promise<EmailAttachment[] | undefined> {
  const sources = readAttachmentColumn(value);
  if (!sources) return undefined;
  const out: EmailAttachment[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    if (source.kind === 'inline') {
      out.push(materializeAttachment(source.element, source.bytes, `[${i}].inline`));
      continue;
    }
    if (!fetchContent) {
      reject(
        'attachments_json',
        `[${i}] ('${source.element.filename}') holds its content out of the row under storageKey `
        + `'${source.storageKey}', but no storage capability is mounted on this process. Fix: mount it `
        + '(@objectstack/service-storage) wherever sys_email rows are delivered. Refusing rather than '
        + 'delivering the message without this attachment',
      );
    }
    const bytes = await fetchContent(source.storageKey);
    out.push(materializeAttachment(
      source.element,
      bytes,
      `[${i}] content fetched from storageKey '${source.storageKey}'`,
    ));
  }
  return out;
}

/**
 * The storage keys an `attachments_json` column references, in element order.
 *
 * Tolerant by design, and this is the one place in this module where that is
 * right: it feeds **deletion**, so a column too damaged to deliver from must
 * still give up whatever keys it can name. Refusing to parse would strand the
 * bytes forever — the failure mode has no upside.
 */
export function storageKeysInColumn(value: unknown): string[] {
  if (isAbsent(value)) return [];
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keys: string[] = [];
  for (const raw of parsed) {
    const key = (raw as any)?.storageKey;
    if (typeof key === 'string' && key !== '') keys.push(key);
  }
  return keys;
}

/**
 * Rewrite an `attachments_json` column for a row whose out-of-row content has
 * been deleted: `storageKey` out, {@link PersistedEmailAttachment.contentReclaimedAt}
 * in, **everything else untouched**.
 *
 * Returns `undefined` when the column references no storage content, so the
 * caller can skip a pointless write (and so a second reclaim of the same row
 * is a no-op rather than a re-stamp of the timestamp).
 */
export function withContentReclaimed(value: unknown, at: string): string | undefined {
  if (isAbsent(value)) return undefined;
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  let changed = false;
  const next = parsed.map((raw: any) => {
    if (!raw || typeof raw !== 'object') return raw;
    const key = raw.storageKey;
    if (typeof key !== 'string' || key === '') return raw;
    changed = true;
    const { storageKey: _dropped, ...rest } = raw;
    return { ...rest, contentReclaimedAt: at };
  });
  return changed ? JSON.stringify(next) : undefined;
}

/**
 * Encode custom headers for `sys_email.headers_json`, or `undefined` when
 * there are none (the column stays unwritten rather than storing `{}`).
 */
export function encodeHeadersForRow(headers: Record<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const keys = Object.keys(headers);
  if (keys.length === 0) return undefined;
  return JSON.stringify(headers);
}

/**
 * Rebuild `headers` from `sys_email.headers_json`.
 *
 * `undefined` for a row without the column (pre-#5177 rows read safely).
 * A present-but-malformed column throws: a message whose `List-Unsubscribe`
 * or `X-Campaign` header quietly disappeared is not the message that was sent.
 */
export function decodeHeadersFromRow(value: unknown): Record<string, string> | undefined {
  if (isAbsent(value)) return undefined;
  const parsed = parseJson('headers_json', value);
  if (parsed == null) return undefined;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject('headers_json', 'must decode to an object of header name → value');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [name, v] of entries) {
    if (typeof v !== 'string') {
      reject('headers_json', `['${name}'] must be a string (headers are Record< string, string >), got ${typeof v}`);
    }
    out[name] = v;
  }
  return out;
}
