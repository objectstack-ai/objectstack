// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Reclaiming out-of-row attachment content (objectstack#5172).
 *
 * ## The one job this does
 *
 * Attachment bytes written to the `storage` capability by
 * `attachment-storage.ts` are a **delivery artifact**: once the `sys_email`
 * row they belong to is terminal and a grace window has passed, nothing will
 * ever need them again. This module deletes them and rewrites the row's
 * `attachments_json` so the element says `contentReclaimedAt` instead of
 * `storageKey`. The audit metadata — filename, contentType, size, hash —
 * is untouched, forever. That asymmetry is the entire point of #5172: an
 * append-only mail log keeps growing, but it stops growing *binary*.
 *
 * ## Why a scheduled job and not a sweep
 *
 * The maintainer left the trigger open ("终态时同步删 vs 清扫式"). Neither of
 * the two obvious answers survives contact with this table:
 *
 *  - **Synchronous delete at the terminal transition** cannot honour a grace
 *    window at all, and the window is not decorative: the `email.send.async`
 *    subscriber re-reads and re-delivers a row that is sitting at `failed`, so
 *    deleting content the moment the row says `failed` deletes it out from
 *    under the queue's own retry.
 *  - **A sweep** (the #5161/#5191 shape) needs a query whose result set
 *    *shrinks*. `status IN ('sent','failed') AND old` does not: after the
 *    first pass, every row it returns is one it already reclaimed, so each
 *    boot re-scans the same page of ancient rows forever. Driving the sweep
 *    from the storage side instead — list the prefix, ask about each blob —
 *    is not portable: `LocalStorageAdapter.list` is a single-level `readdir`
 *    (it would not even see `…/<rowId>/<NNN>`), while the S3 adapter's is
 *    recursive and unpaginated. One mechanism that silently means two
 *    different things on the two shipped adapters is worse than no mechanism.
 *
 * So the trigger is a **delayed queue job**, published at the terminal
 * transition with `delay = ` {@link EMAIL_ATTACHMENT_RECLAIM_GRACE_MS} and an
 * idempotency key per row. That is durable (it is a `sys_job_queue` row, the
 * same substrate the delivery itself rides), exact (no scanning, no polling),
 * and available by construction — content only ever goes out of row when
 * durable queue delivery is in force, so the queue that must reclaim it is the
 * queue that queued the message.
 *
 * ## Why a deleted row cannot orphan its content
 *
 * This is the property the issue asks to be argued rather than asserted, so:
 * **the job payload carries the storage keys, not just the row id**
 * ({@link EmailAttachmentReclaimPayload}). When the job fires and the row is
 * gone — reaped by a future declarative `retention` policy in the #5192 shape,
 * purged by an operator, deleted by anything at all — the job still knows
 * exactly which bytes to delete, and deletes them. Row deletion is therefore
 * not a way to *lose* the content; it is the strongest possible signal to
 * reclaim it, because a row that no longer exists certainly has no delivery
 * left to do.
 *
 * Note what this does NOT depend on: it does not require the reclaim grace to
 * be shorter than the row's retention window, it does not require the row to
 * carry a reclamation flag, and it does not require reading the row at all in
 * the orphan case. `sys_email` is `lifecycle.class: 'record'` today, so the
 * spec actively forbids declaring `retention` on it (`object.zod.ts`: a
 * `record` class "is permanent business truth — retention/ttl/storage/archive
 * policies are not allowed on it"); the guarantee above is what makes it safe
 * for that to change later without anyone having to remember this file.
 *
 * ## What is deliberately left as a residual risk
 *
 * If the reclaim job itself is lost — a `purge()` of the queue, a DLQ entry
 * nobody replays — those bytes stay in the bucket. That is a byte leak, not a
 * correctness failure, it is *visible* (`listFailed` / the DLQ), and closing
 * it would mean adding the second scanner this module just argued against.
 * The honest trade is stated here rather than papered over with a sweep that
 * only works on one adapter.
 */

import {
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  deleteAttachmentKeys,
  type EmailAttachmentReclaimPayload,
  type EmailAttachmentStore,
} from './attachment-storage.js';
import { withContentReclaimed } from './sys-email-payload.js';

/** System context — reclamation is platform bookkeeping, not a user query. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** Backing object; a constant so the query and the log lines agree. */
export const RECLAIM_OBJECT = 'sys_email';

/**
 * `sys_email.status` values after which content is never needed again.
 *
 * `queued` is excluded and that is the whole guard: a row still at `queued`
 * has a delivery ahead of it, whatever this job was told a day ago.
 */
export const TERMINAL_EMAIL_STATUSES: readonly string[] = ['sent', 'failed'];

/**
 * The two engine operations reclamation issues, declared structurally.
 *
 * Same reasoning as #5210's `LifecycleFloorRegistrar`: this is a slot lookup's
 * worth of surface, and typing it is what makes a renamed or re-ordered engine
 * method a build error instead of a runtime throw inside a job that retries
 * silently until it dead-letters.
 */
export interface AttachmentReclaimEngine {
  find(object: string, options: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** Structural logger — same shape the outbox sweep uses. */
interface ReclaimLogger {
  info?: (msg: string, meta?: any) => void;
  /**
   * The GUARANTEED fallback channel (#9754). `error` stays optional — hosts do
   * inject reduced sinks — so `warn` is where a durability report lands when
   * `error` is absent, and a fallback that may itself be missing is not a
   * fallback. Call sites keep the `logger?.warn?.(…)` spelling as the backstop
   * for hosts the TYPE cannot reach; `SweepLogger` in plugin-email's
   * `outbox-sweep.ts` carries the full reasoning and the measurement.
   */
  warn: (msg: string, meta?: any) => void;
  error?: (msg: string, meta?: any) => void;
}

export interface ReclaimAttachmentContentOptions {
  engine: AttachmentReclaimEngine;
  /** The live storage capability; `undefined` ⇒ nothing can be deleted now. */
  store: EmailAttachmentStore | undefined;
  logger?: ReclaimLogger;
  /** Clock seam for tests. */
  now?: () => number;
  /** Override {@link EMAIL_ATTACHMENT_RECLAIM_GRACE_MS} (tests). */
  graceMs?: number;
  /**
   * Re-publish this job to fire again in `delayMs`. `undefined`, or a `false`
   * return, means the job could not be re-armed — reported loudly, because the
   * content then waits for nothing.
   */
  rearm?: (delayMs: number) => Promise<boolean>;
}

export type AttachmentReclaimOutcome =
  /** The row is terminal: content deleted, `attachments_json` rewritten. */
  | { kind: 'reclaimed'; rowId: string; keys: string[] }
  /** The row is gone: content deleted from the payload's keys alone. */
  | { kind: 'orphan-reclaimed'; rowId: string; keys: string[] }
  /** Not yet — the row is still in flight. Re-armed for another grace window. */
  | { kind: 'rearmed'; rowId: string; delayMs: number; reason: string }
  /** Not yet, and nothing re-armed it. The bytes are now waiting on nobody. */
  | { kind: 'stalled'; rowId: string; reason: string }
  /** Nothing to do — the payload named no keys. */
  | { kind: 'noop'; rowId: string };

/** Normalize the two `find()` return shapes ObjectQL hands back. */
function firstRow(raw: unknown): Record<string, any> | undefined {
  if (Array.isArray(raw)) return raw[0] as Record<string, any> | undefined;
  const data = (raw as any)?.data;
  return Array.isArray(data) ? (data[0] as Record<string, any> | undefined) : undefined;
}

/** Millisecond age of a row's last recorded change, or `undefined` if unknown. */
function msSinceLastChange(row: Record<string, any>, now: number): number | undefined {
  const stamp = row.updated_at ?? row.sent_at ?? row.created_at;
  if (stamp == null) return undefined;
  const t = new Date(String(stamp)).getTime();
  if (!Number.isFinite(t)) return undefined;
  return now - t;
}

/**
 * Run one reclamation job.
 *
 * Throws only for failures a retry can fix — a storage delete that did not
 * land, a row rewrite that did not land. Both adapters' `delete` are idempotent
 * for a key that is already gone (the local one swallows `ENOENT`, S3's
 * `DeleteObject` is idempotent by protocol), so the retry re-runs cleanly
 * rather than getting permanently stuck on the half it already finished.
 */
export async function reclaimAttachmentContent(
  payload: EmailAttachmentReclaimPayload,
  opts: ReclaimAttachmentContentOptions,
): Promise<AttachmentReclaimOutcome> {
  const rowId = String(payload?.rowId ?? '');
  const keys = Array.from(new Set((payload?.keys ?? []).filter((k) => typeof k === 'string' && k !== '')));
  const now = opts.now?.() ?? Date.now();
  const graceMs = opts.graceMs ?? EMAIL_ATTACHMENT_RECLAIM_GRACE_MS;

  if (keys.length === 0) return { kind: 'noop', rowId };

  if (!opts.store) {
    // The capability that HOLDS the bytes is not mounted on this process.
    // Deleting is impossible; re-arm so a process that has it can finish the
    // job, and say so if nothing can.
    return rearmOrStall(
      opts, rowId, graceMs,
      'the storage capability is not mounted on the process running the reclaim job, so the content '
      + 'cannot be deleted here',
    );
  }

  const found = await opts.engine.find(RECLAIM_OBJECT, {
    where: { id: rowId },
    limit: 1,
    context: SYSTEM_CTX,
  });
  const row = firstRow(found);

  // ── The row is gone ────────────────────────────────────────────────────
  // Nothing references these bytes any more and nothing ever will. Deleting
  // them from the payload's own key list is what makes row deletion incapable
  // of orphaning content — see the module header.
  if (!row) {
    await deleteOrThrow(opts.store, keys, rowId, 'the sys_email row no longer exists');
    opts.logger?.info?.(
      `EmailServicePlugin: reclaimed ${keys.length} out-of-row attachment object(s) for sys_email row `
      + `'${rowId}', which no longer exists — the content had no remaining reference.`,
    );
    return { kind: 'orphan-reclaimed', rowId, keys };
  }

  // ── The row is still in flight ─────────────────────────────────────────
  const status = String(row.status ?? '');
  if (!TERMINAL_EMAIL_STATUSES.includes(status)) {
    return rearmOrStall(
      opts, rowId, graceMs,
      `the sys_email row is still at '${status || '(unset)'}', so its content may still be needed for delivery`,
    );
  }

  // Belt-and-braces on top of the job's own delay: if the row changed inside
  // the grace window (a retry that re-stamped it, a clock the publisher and
  // the row do not share), wait out the remainder. This can only ever DELAY a
  // deletion, never bring one forward, which is the only direction a tolerance
  // on a destructive operation may point.
  const age = msSinceLastChange(row, now);
  if (age !== undefined && age < graceMs) {
    return rearmOrStall(
      opts, rowId, graceMs - age,
      `the sys_email row was last updated ${Math.round(age / 1000)}s ago, inside the `
      + `${Math.round(graceMs / 1000)}s reclaim grace window`,
    );
  }

  // ── Reclaim ────────────────────────────────────────────────────────────
  // Bytes first, row second. The other order would rewrite away the last
  // pointer to content a failed delete left behind — an orphan created by the
  // very function that exists to prevent them. This order's failure mode is a
  // row that names a key which 404s, which is loud on read (the decoder
  // verifies) and fixed by the job's next attempt.
  await deleteOrThrow(opts.store, keys, rowId, `the sys_email row is terminal ('${status}')`);

  const rewritten = withContentReclaimed(row.attachments_json, new Date(now).toISOString());
  if (rewritten !== undefined) {
    await opts.engine.update(
      RECLAIM_OBJECT,
      { id: rowId, attachments_json: rewritten },
      { context: SYSTEM_CTX },
    );
  }

  opts.logger?.info?.(
    `EmailServicePlugin: reclaimed ${keys.length} out-of-row attachment object(s) for sys_email row `
    + `'${rowId}' (status '${status}'). The row keeps filename/contentType/size/hash as audit evidence; only `
    + 'the delivery content was deleted.',
  );
  return { kind: 'reclaimed', rowId, keys };
}

/** Delete every key or throw naming what is left — the job's retry finishes it. */
async function deleteOrThrow(
  store: EmailAttachmentStore,
  keys: string[],
  rowId: string,
  because: string,
): Promise<void> {
  const { failed } = await deleteAttachmentKeys(store, keys);
  if (failed.length === 0) return;
  throw new Error(
    `reclaiming attachment content for sys_email row '${rowId}' (${because}) could not delete `
    + `${failed.length} of ${keys.length} storage object(s): `
    + failed.map((f) => `'${f.key}' (${f.error})`).join('; ')
    + '. Those bytes are still billed and no longer needed; the reclaim job will retry.',
  );
}

/** Re-arm the job, or report that nothing will look at this content again. */
async function rearmOrStall(
  opts: ReclaimAttachmentContentOptions,
  rowId: string,
  delayMs: number,
  reason: string,
): Promise<AttachmentReclaimOutcome> {
  const delay = Math.max(1000, Math.round(delayMs));
  if (opts.rearm && (await opts.rearm(delay))) {
    return { kind: 'rearmed', rowId, delayMs: delay, reason };
  }
  // `error`, not `warn`: from the outside nothing is wrong — the mail went
  // out, the row is fine — while attachment content that was supposed to be
  // temporary has just become permanent, silently, in a bucket somebody pays
  // for. That is the durability/consequence class AGENTS.md pins at `error`,
  // and the line owes both the consequence and the fix.
  opts.logger?.error?.(
    `EmailServicePlugin: out-of-row attachment content for sys_email row '${rowId}' could NOT be reclaimed and `
    + `could NOT be rescheduled — ${reason}. Those storage objects will now stay in the backend forever unless `
    + 'they are deleted by hand. Fix: keep the durable queue service (@objectstack/service-queue over an '
    + 'ObjectQL engine) and the storage capability (@objectstack/service-storage) mounted on the process '
    + `that consumes email jobs, then delete the leftovers under the row's key prefix.`,
  );
  return { kind: 'stalled', rowId, reason };
}
