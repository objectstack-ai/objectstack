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
 * Out-of-row storage for large attachments (`storageKey`) is phase 2, tracked
 * by objectstack#5172. The element shape already declares that key so phase 2
 * adds a *producer* rather than migrating data — see
 * {@link PersistedEmailAttachment.storageKey}.
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
   * Reference to content held outside the row.
   *
   * **Phase 1 has no producer for this key** — nothing in this repo writes it
   * today, and {@link decodeAttachmentsFromRow} rejects a row that only has
   * it. It is declared now so that objectstack#5172 (large attachments via
   * storage, deferred by the maintainer) ships a producer + reader against an
   * already-persisted shape instead of migrating rows. Declared-not-yet-live
   * on purpose; not a liveness finding.
   */
  storageKey?: string;
}

/** Outcome of {@link encodeAttachmentsForRow}. */
export type EncodedAttachments =
  /** No attachments — the column is not written. */
  | { kind: 'none' }
  /** Within budget: `json` goes into `attachments_json`. */
  | { kind: 'inline'; json: string; totalBytes: number }
  /** Over {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES} — nothing is written to the row. */
  | { kind: 'over-limit'; totalBytes: number }
  /** Content this codec cannot represent; nothing is written to the row. */
  | { kind: 'unsupported'; detail: string };

/** `sha256:<hex>` of the raw bytes. */
function digestOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
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
  if (!attachments || attachments.length === 0) return { kind: 'none' };

  const parts: Array<{ att: EmailAttachment; bytes: Buffer; contentForm: 'string' | 'buffer' }> = [];
  for (const att of attachments) {
    const content = att?.content;
    if (typeof content === 'string') {
      parts.push({ att, bytes: Buffer.from(content, 'utf8'), contentForm: 'string' });
    } else if (Buffer.isBuffer(content)) {
      parts.push({ att, bytes: content, contentForm: 'buffer' });
    } else {
      return {
        kind: 'unsupported',
        detail: `attachment '${String(att?.filename ?? '(unnamed)')}' carries a 'content' value that is neither `
          + 'a string nor a Buffer, which is the whole of the EmailAttachment contract',
      };
    }
  }

  const totalBytes = parts.reduce((n, p) => n + p.bytes.byteLength, 0);
  if (totalBytes > SYS_EMAIL_ATTACHMENT_LIMIT_BYTES) return { kind: 'over-limit', totalBytes };

  const items: PersistedEmailAttachment[] = parts.map(({ att, bytes, contentForm }) => ({
    filename: String(att.filename ?? ''),
    ...(att.contentType ? { contentType: String(att.contentType) } : {}),
    size: bytes.byteLength,
    hash: digestOf(bytes),
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
 * Rebuild `attachments` from `sys_email.attachments_json`.
 *
 * Returns `undefined` for a row that has no such column (every row written
 * before #5177) — reading an old row must stay safe. Everything else is
 * verified: a column that is present but does not describe the message it
 * claims to describe throws, so the row lands at `failed` with the reason
 * rather than being delivered without the attachment.
 */
export function decodeAttachmentsFromRow(value: unknown): EmailAttachment[] | undefined {
  if (isAbsent(value)) return undefined;
  const parsed = parseJson('attachments_json', value);
  if (parsed == null) return undefined;
  if (!Array.isArray(parsed)) reject('attachments_json', 'must decode to an array of attachments');
  if (parsed.length === 0) return undefined;

  return parsed.map((raw: any, i: number): EmailAttachment => {
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
    if (typeof raw.inline !== 'string' || raw.inline === '') {
      if (typeof raw.storageKey === 'string' && raw.storageKey !== '') {
        reject(
          'attachments_json',
          `${at} references content by storageKey, which no producer writes and nothing reads yet — `
          + 'out-of-row attachment storage is objectstack#5172. Refusing rather than delivering the message '
          + 'without this attachment',
        );
      }
      reject('attachments_json', `${at} carries no content: neither 'inline' nor a readable reference`);
    }

    const bytes = Buffer.from(raw.inline, 'base64');
    if (bytes.byteLength !== raw.size) {
      reject(
        'attachments_json',
        `${at}.inline decodes to ${bytes.byteLength} byte(s) but the row records size ${raw.size} — the `
        + 'column was truncated or rewritten',
      );
    }
    const actual = digestOf(bytes);
    if (actual !== raw.hash) {
      reject(
        'attachments_json',
        `${at}.inline hashes to ${actual} but the row records ${String(raw.hash)} — the stored content is not `
        + 'the content that was sent',
      );
    }

    return {
      filename,
      content: raw.contentForm === 'string' ? bytes.toString('utf8') : bytes,
      ...(typeof raw.contentType === 'string' && raw.contentType ? { contentType: raw.contentType } : {}),
      ...(typeof raw.cid === 'string' && raw.cid ? { cid: raw.cid } : {}),
    };
  });
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
