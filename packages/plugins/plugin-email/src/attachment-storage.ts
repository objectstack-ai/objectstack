// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Out-of-row attachment content — the `storageKey` producer phase 1 declared
 * and left empty (objectstack#5172, phase 2 of #5177/#5211).
 *
 * ## What this buys, in one sentence
 *
 * A message whose attachments exceed {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES}
 * used to be pushed back onto inline delivery — whole, but with none of the
 * durability queue delivery exists to provide. Its content now goes to the
 * `storage` capability, the row records a **reference** plus the audit
 * metadata, and the queue worker rebuilds the message by fetching the content
 * back. The messages most likely to matter (a signed contract, an exported
 * report) stop being the ones the platform is weakest about.
 *
 * ## The one asymmetry that shapes everything here
 *
 * `sys_email` is an append-only audit log; attachment content is a **delivery
 * artifact**. Those two have different lifetimes and the whole design is that
 * cut:
 *
 *  - `filename` / `contentType` / `size` / `hash` stay in the row **forever**.
 *    They are the evidence that a particular file was sent to a particular
 *    recipient, and they are ~100 bytes.
 *  - the bytes live in storage only until the row reaches a terminal state and
 *    a grace window has passed ({@link EMAIL_ATTACHMENT_RECLAIM_GRACE_MS}).
 *    Nothing needs them after that: the message was delivered.
 *
 * Without the cut, an append-only log grows binary content without bound. With
 * it, the log grows the way a log grows.
 *
 * ## Why the capability is declared here rather than imported
 *
 * {@link EmailAttachmentStore} names the three `IStorageService` methods this
 * package calls and nothing else. Declared in the *consumer* (the #5210
 * `LifecycleFloorRegistrar` shape) so the slot lookup carries a contract type:
 * `getService<any>('storage')` would switch off checking on the exact
 * calls whose failure is invisible — an upload that silently no-ops is a
 * message whose content is gone and whose row says it is there.
 *
 * ## Loudness
 *
 * Every failure on this path degrades to **inline delivery of the whole
 * message**, never to a queued message with content missing. `declared ≠
 * delivered` is the one outcome that is not allowed: the reader
 * ({@link fetchAttachmentContent} and the strict decoder it feeds) throws
 * rather than hand a transport a message with an attachment quietly absent.
 */

import type { EmailAttachment } from '@objectstack/spec/contracts';
import {
  SYS_EMAIL_ATTACHMENT_LIMIT_BYTES,
  collectAttachmentParts,
  type PersistedEmailAttachment,
} from './sys-email-payload.js';

/**
 * The slice of the `storage` capability (`IStorageService`) that
 * out-of-row attachment content actually uses.
 *
 * Declared structurally in this package on purpose (#5210): a slot lookup that
 * erases to `any` compiles against a renamed or re-ordered method and fails at
 * runtime inside the very `try` that is supposed to degrade gracefully — i.e.
 * large attachments would silently stop being durable while the log line said
 * "storage unavailable", which is indistinguishable from the deployment simply
 * not having storage. Typed, the mismatch is a build error.
 *
 * `list` / `getInfo` / presigned URLs are deliberately absent: nothing here
 * enumerates storage. (It could not portably — `LocalStorageAdapter.list` is a
 * single-level `readdir` while the S3 adapter's is a recursive, unpaginated
 * `ListObjectsV2` — so a listing-driven reclaimer would silently do different
 * things on the two shipped adapters. Reclamation is driven by the queue
 * instead; see {@link EMAIL_ATTACHMENT_RECLAIM_QUEUE}.)
 */
export interface EmailAttachmentStore {
  upload(key: string, data: Buffer, options?: { contentType?: string }): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Resolve the live store per use — never captured. See {@link EmailAttachmentStorage}. */
export interface EmailAttachmentStorage {
  /**
   * The store to use for THIS message, or `undefined` when the capability is
   * not mounted.
   *
   * A thunk for the same reason `EmailQueueDelivery.resolve` is one: the
   * storage service is a `SwappableStorageService` whose adapter is replaced
   * when the `storage` settings namespace changes, and it may register after
   * this plugin. A handle captured at wiring time would upload into the
   * adapter the operator just swapped away from.
   */
  resolve(): EmailAttachmentStore | undefined;
}

/**
 * Key prefix for every byte this package writes to the storage backend.
 *
 * Names the owning object, so an operator looking at a bucket can tell what
 * wrote these and which table decides when they die. Everything under it is
 * reclaimable delivery state, never business truth — the opposite of
 * `sys_file`, which is why this path deliberately does NOT go through the
 * `sys_file` metadata store: a permanent, compliance-visible row per
 * attachment would re-create the unbounded growth this design exists to avoid.
 */
export const EMAIL_ATTACHMENT_KEY_PREFIX = 'sys_email/attachments';

/**
 * Queue topic the content reclaimer is published to and consumed from.
 *
 * Separate from `email.send.async` on purpose: a reclaim job is scheduled a
 * day out and must not share a retry budget, a DLQ or a poll order with mail
 * that is trying to go out now.
 */
export const EMAIL_ATTACHMENT_RECLAIM_QUEUE = 'email.attachment.reclaim';

/**
 * How long after a `sys_email` row last changed its content may be reclaimed.
 *
 * 24 hours, a constant rather than a setting (same reasoning as
 * {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES}: a knob is a second place for a
 * storage budget to drift). The number has to clear three things at once and
 * this is the smallest round value that clears all of them:
 *
 *  1. **The queue's own retry span.** A row sits at `failed` between attempts
 *     — the `email.send.async` subscriber re-reads a `failed` row and delivers
 *     it again. With the backoff capped at 5 minutes, even a generous attempt
 *     budget is exhausted in well under an hour. Reclaiming inside that span
 *     would delete the content a retry is about to need.
 *  2. **A duplicate delivery.** A lease that expires mid-send lets a second
 *     worker re-read the row; that read must still find its content.
 *  3. **The operator.** "The invoice went out wrong, what exactly did we
 *     send?" is a same-day question. After a day it is answered from the
 *     audit metadata (filename / size / hash), which never goes away.
 *
 * It is also, deliberately, far shorter than any plausible row retention — see
 * the module header of `attachment-reclaim.ts` for why that ordering is
 * belt-and-braces rather than load-bearing.
 */
export const EMAIL_ATTACHMENT_RECLAIM_GRACE_MS = 24 * 60 * 60_000;

/**
 * Payload of an {@link EMAIL_ATTACHMENT_RECLAIM_QUEUE} job.
 *
 * `keys` is carried **in the payload** and not re-read from the row, and that
 * is the single most load-bearing decision in the reclamation design: it is
 * what makes orphaned content impossible. A job that finds its `sys_email` row
 * gone — deleted by a future declarative retention policy, by a purge, by an
 * operator — still knows exactly which bytes to delete. Had the job carried
 * only `rowId`, deleting the row would have severed the last pointer to the
 * content and left it in the bucket forever.
 */
export interface EmailAttachmentReclaimPayload {
  /** `sys_email.id` whose content this job reclaims. */
  rowId: string;
  /** Every storage key written for that row. Authoritative — see above. */
  keys: string[];
}

/** Characters a storage key segment may contain; everything else is folded. */
const KEY_SAFE = /[^A-Za-z0-9_-]/g;

/**
 * The key one attachment's content is stored under.
 *
 * `sys_email/attachments/<rowId>/<NNN>-<hash16>`
 *
 *  - **`<rowId>`** groups a message's parts under one folder, so purging one
 *    message by hand is one prefix and an operator reading a key can find the
 *    row it belongs to. It is folded to `[A-Za-z0-9_-]` first: a key is a path
 *    on the local adapter, and an id is not allowed to introduce a `/` or a
 *    `..` segment into one.
 *  - **`<NNN>`** is the element's index in `attachments_json`, zero-padded so
 *    keys sort the way the attachments do. Together with `<rowId>` it makes
 *    the key **deterministic**: a retried send of the same row overwrites its
 *    own bytes instead of leaving a second copy nobody references.
 *  - **`<hash16>`** is the first 16 hex characters of the content digest the
 *    row also records. It costs nothing and means a key can never be silently
 *    re-pointed at different content: the reader verifies the FULL digest
 *    anyway, so this is for the human reading a bucket listing.
 *
 * Note what is NOT in the key: the filename. Filenames are author-supplied
 * UTF-8 that may contain `/`, `..`, or control characters; they are audit
 * metadata and they live in the row, never in a path.
 */
export function attachmentStorageKey(rowId: string, index: number, hash: string): string {
  const safeRow = String(rowId).replace(KEY_SAFE, '_') || 'unknown';
  const hex = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
  const short = hex.replace(KEY_SAFE, '').slice(0, 16) || 'nohash';
  return `${EMAIL_ATTACHMENT_KEY_PREFIX}/${safeRow}/${String(index).padStart(3, '0')}-${short}`;
}

/** Outcome of {@link offloadAttachmentsToStorage}. */
export type AttachmentOffload =
  /** Content is in storage; `json` goes into `attachments_json`. */
  | { kind: 'storage'; json: string; keys: string[]; totalBytes: number }
  /**
   * Nothing was stored, and why. The caller's answer is always the same —
   * deliver the message inline, whole — but the sentence differs and the
   * operator needs it.
   */
  | { kind: 'unavailable'; detail: string };

/**
 * Upload one message's attachments and build the `attachments_json` elements
 * that reference them.
 *
 * Never throws. Every failure becomes `{ kind: 'unavailable' }` carrying a
 * sentence the caller logs, because the caller's response is to deliver the
 * message inline — which is what happens today and is always whole. Failing
 * the send instead would turn "this message is not durable" into "this message
 * does not go out", a strictly worse answer to a storage hiccup.
 *
 * **Partial uploads are cleaned up.** If attachment 3 of 5 fails, the two
 * already in the bucket are deleted before returning: no row will ever
 * reference them, so leaving them would be exactly the orphan this design
 * refuses to create.
 */
export async function offloadAttachmentsToStorage(
  attachments: EmailAttachment[] | undefined,
  rowId: string,
  store: EmailAttachmentStore,
): Promise<AttachmentOffload> {
  const collected = collectAttachmentParts(attachments);
  if (collected.kind === 'none') {
    // Unreachable through the one caller (a message is only offloaded because
    // its attachments are over budget, which needs attachments). Answered
    // rather than asserted so a future caller gets a verdict, not a crash.
    return { kind: 'unavailable', detail: 'the message has no attachments to store' };
  }
  if (collected.kind === 'unsupported') {
    return { kind: 'unavailable', detail: collected.detail };
  }
  const { parts, totalBytes } = collected;

  const items: PersistedEmailAttachment[] = [];
  const keys: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const { att, bytes, hash, contentForm } = parts[i]!;
    const key = attachmentStorageKey(rowId, i, hash);
    try {
      await store.upload(key, bytes, att.contentType ? { contentType: String(att.contentType) } : undefined);
    } catch (err: any) {
      await deleteAttachmentKeys(store, keys);
      return {
        kind: 'unavailable',
        detail:
          `uploading attachment '${String(att.filename ?? '(unnamed)')}' to the storage capability failed `
          + `(${String(err?.message ?? err)})`,
      };
    }
    keys.push(key);
    items.push({
      filename: String(att.filename ?? ''),
      ...(att.contentType ? { contentType: String(att.contentType) } : {}),
      size: bytes.byteLength,
      hash,
      ...(att.cid ? { cid: String(att.cid) } : {}),
      contentForm,
      storageKey: key,
    });
  }

  return { kind: 'storage', json: JSON.stringify(items), keys, totalBytes };
}

/**
 * Delete storage keys, tolerating keys that are already gone.
 *
 * Returns the keys that could NOT be deleted, so the caller can say so. A
 * delete that fails is a byte leak, not a correctness problem — the row is
 * either gone or no longer references the key — but it is exactly the kind of
 * leak that is invisible until a bucket bill arrives, so nothing here swallows
 * the list.
 *
 * "Already gone" is not distinguishable across adapters (S3 deletes are
 * idempotent, the local adapter's `unlink` throws `ENOENT`), so a failure is
 * reported and reconciled by the job's own retry rather than being classified
 * here on the basis of a message string.
 */
export async function deleteAttachmentKeys(
  store: EmailAttachmentStore,
  keys: readonly string[],
): Promise<{ deleted: string[]; failed: Array<{ key: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  for (const key of keys) {
    try {
      await store.delete(key);
      deleted.push(key);
    } catch (err: any) {
      failed.push({ key, error: String(err?.message ?? err) });
    }
  }
  return { deleted, failed };
}

/**
 * Fetch one attachment's content back from storage.
 *
 * Deliberately **not** wrapped in a `try`. The storage metadata layer was made
 * loud in #5216/#5232 precisely so a read outage stops looking like a miss;
 * re-swallowing it one layer up would hand the transport a message with the
 * attachment silently absent and mark the row `sent`. The throw propagates to
 * `deliverPersistedRow`, which records it on the row as `failed` with the
 * reason and lets the queue retry or dead-letter the job.
 */
export async function fetchAttachmentContent(
  store: EmailAttachmentStore,
  storageKey: string,
): Promise<Buffer> {
  const bytes = await store.download(storageKey);
  if (!Buffer.isBuffer(bytes)) {
    // A store that answers with something else has not answered at all; the
    // strict decoder downstream verifies size and digest, and this keeps the
    // failure at the layer that can name the key.
    throw new Error(
      `the storage capability returned a non-Buffer value for attachment content key '${storageKey}'`,
    );
  }
  return bytes;
}
