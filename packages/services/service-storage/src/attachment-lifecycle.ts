// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IStorageService } from '@objectstack/spec/contracts';

/**
 * sys_file orphan lifecycle (#2755, ADR-0057).
 *
 * The generic Attachments surface (#2727) separates file storage
 * (`sys_file`) from "where the file is attached" (`sys_attachment` join
 * rows, Salesforce ContentDocumentLink pattern). Deleting an attachment
 * deletes only the join row — one file can back many attachments, so no
 * naive cascade. This module closes the resulting orphan leak:
 *
 *  1. Tombstone hooks (this file, installed on `sys_attachment`): when the
 *     LAST join row referencing an attachments-scope file goes away, the
 *     `sys_file` row is marked `status='deleted'` + `deleted_at=now`. A join
 *     row goes away two ways, and both are covered: it is DELETED, or an
 *     UPDATE re-points its `file_id` at some other file (#10171).
 *     Re-attaching before the grace window expires un-tombstones it.
 *  2. The `lifecycle` declaration on `sys_file` (system-file.object.ts):
 *     the platform LifecycleService reaps tombstones `30d` after
 *     `deleted_at`, and never-completed `pending` uploads after `7d`.
 *  3. The reap guard (this file, registered with the LifecycleService):
 *     re-verifies zero references at sweep time (hook races, direct-driver
 *     writes, future trash restore) and reclaims the storage bytes before
 *     confirming the row delete. Detection and scheduling stay inside the
 *     single platform sweep — ADR-0057 §3.3, no bespoke sweeper.
 *
 * The hooks in THIS file only ever tombstone `scope === 'attachments'` files:
 * `Field.file` / `Field.image` / avatar uploads use other scopes and reference
 * files from record columns the join-row count cannot see. Field-owned files
 * have their own tombstone seam — `releaseOwnership` in
 * `file-reference-lifecycle.ts`, active only on a deployment that has verified
 * its file-as-reference migration (#3617) — and the reap guard below
 * re-verifies their ownership columns, and re-reads that deployment flag, at
 * sweep time (#3459 PR-5b).
 */

/** Engine surface these installers need — duck-typed like the other
 * service-storage seams so tests can fake it. */
export interface AttachmentLifecycleEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: {
      object?: string;
      packageId?: string;
      /**
       * [#9719, both write verbs since #9974] Opt-in: the engine ALSO
       * dispatches this handler once with the whole-operation context when a
       * `multi: true` write carries no `where` at all — before any row is
       * resolved. The #4757 unscoped-multi-delete refusal in
       * `attachment-access-hooks.ts` declares it on its `beforeDelete`
       * registration; nothing else here does, and no attachment guard declares
       * it on update. `beforeUpdate` / `beforeDelete` registrations only.
       */
      dispatchUnscopedMultiWrite?: boolean;
    },
  ): void;
  /** Onion-model data middleware (runs for find/findOne/count/aggregate AND
   * writes) — the only seam that filters `count()` (→ list `total`)
   * identically to `find()`. Used for polymorphic parent-visibility on reads.
   * Optional: only the read-visibility installer needs it. */
  registerMiddleware?(
    fn: (ctx: AttachmentReadMiddlewareCtx, next: () => Promise<void>) => Promise<void>,
    options?: { object?: string },
  ): void;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

/** Minimal shape of the engine `OperationContext` the read middleware reads. */
export interface AttachmentReadMiddlewareCtx {
  object: string;
  operation: 'find' | 'findOne' | 'insert' | 'update' | 'delete' | 'count' | 'aggregate';
  ast?: { object?: string; where?: unknown } & Record<string, unknown>;
  context?: { userId?: string; tenantId?: string; positions?: string[]; permissions?: string[]; isSystem?: boolean } & Record<string, unknown>;
}

export interface AttachmentLifecycleLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

const PACKAGE_ID = 'com.objectstack.service.storage';
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Tombstone every id in `fileIds` that no longer has a join row — the orphan
 * rule, in ONE place because two write verbs now ask it (`afterDelete`, and
 * `afterUpdate` for a `file_id` re-point). Two copies of "is this file an
 * orphan, and may I tombstone it" is exactly the drift #10171 was filed
 * against; the verbs differ only in how they name the departed file id.
 *
 * Best-effort throughout: a failure here must never fail the user's write.
 */
async function tombstoneOrphanedFiles(
  engine: AttachmentLifecycleEngine,
  logger: AttachmentLifecycleLogger,
  fileIds: readonly string[],
): Promise<void> {
  for (const fileId of fileIds) {
    try {
      const remaining = await engine.find('sys_attachment', {
        where: { file_id: fileId },
        limit: 1,
        context: { ...SYSTEM_CTX },
      });
      if (remaining?.length) continue;
      const file = await engine.findOne('sys_file', { where: { id: fileId }, context: { ...SYSTEM_CTX } });
      if (!file || file.scope !== 'attachments' || file.status !== 'committed') continue;
      await engine.update(
        'sys_file',
        { id: fileId, status: 'deleted', deleted_at: new Date().toISOString() },
        { context: { ...SYSTEM_CTX } },
      );
      logger.debug?.(`[storage] attachment lifecycle: tombstoned orphan sys_file ${fileId}`);
    } catch (err) {
      logger.warn(
        `[storage] attachment lifecycle: failed to tombstone sys_file ${fileId} (${(err as Error)?.message ?? err})`,
      );
    }
  }
}

/**
 * Install the tombstone hooks on `sys_attachment`. Lifecycle bookkeeping
 * must never block or fail a user's delete/insert/update — every handler is
 * best-effort and only logs on failure.
 */
export function installAttachmentLifecycleHooks(
  engine: AttachmentLifecycleEngine,
  logger: AttachmentLifecycleLogger,
): void {
  // afterDelete: the join row is gone, so the file it pointed at may now be an
  // orphan — tombstone it if (and only if) it is an attachments-scope
  // committed file with no remaining references.
  //
  // ── Why the departed id comes from `ctx.previous`, and NOT from a
  //    `beforeDelete` stash (#10240) ─────────────────────────────────────────
  // This pair used to hand its ids over on the hook context itself
  // (`ctx['__attachmentFileIds']`, written in a `beforeDelete` that resolved
  // the doomed rows), on the premise — stated in its own comment — that "the
  // engine passes the SAME HookContext object to both events". That was true
  // of the pre-#5574 batch dispatch and is FALSE for a predicate write: since
  // #5574 (ADR-0058 Addendum II, D1/D2) a `multi: true` write dispatches ONE
  // CONTEXT PER MATCHED ROW, and those row contexts are fresh objects spread
  // from the batch context in each phase independently
  // (`dispatchPerRowBeforeHooks` / `buildPerRowAfterContexts` in objectql's
  // `engine.ts`, which says so outright: "a per-row context is a fresh object,
  // so a stash written on the context itself dies with the row that held it").
  //
  // So on a PREDICATE delete the stash never arrived, `fileIds` was `[]`, and
  // NO TOMBSTONE WAS EVER WRITTEN. That is not the module's "fail toward
  // retention" bias, which buys a second look later: `sys_file`'s declared
  // lifecycle nominates a sweep candidate only via `ttl { field: 'deleted_at' }`
  // or `retention { onlyWhen: { status: 'pending' } }`, and an untombstoned
  // orphan matches NEITHER — so it is never a candidate, the reap guard is
  // never asked about it, and the bytes are stranded PERMANENTLY. Measured on
  // the wired engine for #10240, both verbs in one run:
  //
  //   DELETE by-id      (dispatch record) : f1    -> status "deleted"   OK
  //   DELETE predicate  (dispatch per-row): f1    -> status "committed" LEAK
  //   UPDATE by-id      (dispatch record) : f_old -> status "deleted"   OK
  //   UPDATE predicate  (dispatch per-row): f_old -> status "deleted"   OK
  //
  // The two UPDATE rows are green because #10171 had already reached this
  // conclusion for its verb; this handler now reads the id the same way, so
  // the file carries ONE mechanism for "what file did this join row point at
  // before?" rather than two that drift apart.
  //
  // `previous` has neither problem: the engine binds it to the row's PRE-IMAGE
  // on BOTH phases and BOTH paths — by-id unconditionally since #7867 (the
  // read that also produces the 404, so it is never skipped), per-row from the
  // batch's single doomed-row read (#5038/#5574 D7). It costs no extra round
  // trip on either path for the same reason.
  //
  // ── The `MULTI_DELETE_RESOLVE_LIMIT` limb that went with the stash ────────
  // The old `beforeDelete` had a second branch — `else if
  // (ctx.input.options.where)`, resolving the doomed set itself under a
  // 1_000-row cap — for a batch-shaped context that binds no `input.id`. It is
  // removed here as a producer that never existed (the shape #5906 removed
  // from `afterInsert` in this same file), and unreachability was MEASURED
  // rather than assumed, with the sibling branch as the positive control.
  // Both limbs of the live handler were counted while every delete shape the
  // engine offers was driven through the wired engine:
  //
  //   shape                             id-limb  where-limb
  //   by-id                                1         0
  //   predicate multi (1 row)              1         0
  //   predicate multi (3 rows)             3         0
  //   multi, where { id: { $in: [..] } }   2         0
  //   multi, where {} (match-all)          2         0
  //   multi, NO where (unscoped)           2         0
  //   non-multi, non-id where           engine refuses: "Delete requires an ID
  //                                     or options.multi=true"
  //
  // Zero hits on the branch under test, while the control branch fires on the
  // very predicate path the removed branch was written for. The mechanism
  // agrees: all three sites that dispatch `beforeDelete` bind `input.id` to a
  // scalar — by-id from `resolveEngineDeleteDispatch`, per-row to `row.id`,
  // and the unscoped-multi dispatch (#9719) reaches only registrations that
  // declared `dispatchUnscopedMultiWrite`, which this file never did, and by
  // definition carries no `where` at all.
  engine.registerHook(
    'afterDelete',
    async (ctx: any) => {
      // No pre-image (an engine that does not bind it) means the departed id
      // is unknowable — tombstone nothing and KEEP the file. Retention-biased
      // on purpose and identically to the `afterUpdate` leg below: a missed
      // tombstone leaves an orphan lingering, while a tombstone written off a
      // guess puts real bytes on the reap path.
      const fileId = ctx?.previous?.file_id;
      if (fileId === undefined || fileId === null || fileId === '') return;
      await tombstoneOrphanedFiles(engine, logger, [String(fileId)]);
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );

  // afterInsert: re-attaching a tombstoned file (grace window not yet
  // expired) brings it back to life.
  engine.registerHook(
    'afterInsert',
    async (ctx: any) => {
      try {
        // An after-insert context carries the stored row on `ctx.result`, and the
        // written payload under `input.data` — `data` is the ONLY spelling any
        // engine path produces, measured and pinned by objectql's
        // `hook-input-shape-contract.test.ts` ("insert carries `data` — never
        // `doc`", #5273). An `input.doc` alias limb used to sit between these two
        // for a producer that never existed; removed in #5906 (same family as
        // #5671) rather than left as a second de-facto contract (PD #12).
        const row: any = ctx?.result ?? ctx?.input?.data;
        const fileId = row?.file_id;
        if (!fileId) return;
        const file = await engine.findOne('sys_file', { where: { id: String(fileId) }, context: { ...SYSTEM_CTX } });
        if (!file || file.status !== 'deleted') return;
        await engine.update(
          'sys_file',
          { id: String(fileId), status: 'committed', deleted_at: null },
          { context: { ...SYSTEM_CTX } },
        );
        logger.debug?.(`[storage] attachment lifecycle: un-tombstoned re-attached sys_file ${fileId}`);
      } catch (err) {
        logger.warn(
          `[storage] attachment lifecycle: failed to un-tombstone on re-attach (${(err as Error)?.message ?? err})`,
        );
      }
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );

  // afterUpdate: an UPDATE that re-points a join row's `file_id` detaches the
  // PRIOR file exactly the way a delete of that row would — and until #10171
  // nothing said so, leaving a file with zero join rows sitting at
  // `status='committed'`. That is not the module's "fail toward retention"
  // bias, which buys a second look later: `sys_file`'s declared lifecycle
  // makes a row a sweep candidate only via `ttl { field: 'deleted_at' }` or
  // `retention { onlyWhen: { status: 'pending' } }`, and an untombstoned
  // orphan matches NEITHER — so it is never a candidate, the reap guard is
  // never asked about it, and the bytes are stranded permanently.
  //
  // ── Why the departed id comes from `ctx.previous`, and NOT from a
  //    beforeUpdate stash ────────────────────────────────────────────────────
  // Since #5574 (ADR-0058 Addendum II D1/D2) a PREDICATE write dispatches ONE
  // CONTEXT PER MATCHED ROW, and those row contexts are fresh objects spread
  // from the batch context in both phases (`dispatchPerRowBeforeHooks` /
  // `buildPerRowAfterContexts` in objectql's `engine.ts`) — so a property a
  // `before*` handler writes onto its own row context dies with that row and
  // never reaches the `after*` phase. Measured on the wired engine for #10171:
  // a stash set in `beforeUpdate` arrives in `afterUpdate` on the by-id path
  // (`dispatch.mode === 'record'`) and is LOST on the predicate path
  // (`dispatch.mode === 'per-row'`). A stash-based shape would therefore have
  // been silently half-dead on exactly the multi-row updates that orphan the
  // most files. The delete pair above WAS that shape and was exactly that
  // half-dead until #10240; both verbs now read the same slot.
  //
  // `previous` has neither problem: the engine binds it to the row's PRE-IMAGE
  // on BOTH phases and BOTH paths (by-id since #7867 unconditionally, per-row
  // from the batch's prior-row read). It also costs no extra round trip — the
  // prior-row read is memoized per operation and already demanded, because
  // `attachment-access-hooks.ts` registers a `beforeUpdate` on this same
  // object and the engine asks that demand PER OBJECT, not per handler.
  //
  // ── Why there is no revival leg here (deliberate, measured) ──────────────
  // #10171 also asked for an `afterInsert`-style revival when an update points
  // a row AT a tombstoned file. There is none, because the reap guard below
  // already owns that question: it re-verifies references at sweep time and,
  // finding the re-pointed join row, un-tombstones the file and vetoes the
  // reap instead of reclaiming the bytes (`createSysFileReapGuard`, pinned by
  // "vetoes and un-tombstones a row that regained references"). Measured for
  // #10171: after a re-point onto a tombstoned file the guard confirms nothing
  // and deletes no bytes. A second revival mechanism here would be a duplicate
  // answer to a question that already has one — the failure mode being two
  // implementations that drift apart, not a missing feature.
  engine.registerHook(
    'afterUpdate',
    async (ctx: any) => {
      // Only a payload that actually re-points `file_id` can detach anything.
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object' || !('file_id' in data)) return;
      // No pre-image (an engine that does not bind it, a row that was not
      // there) means the prior id is unknowable — tombstone nothing and keep
      // the file, which is the retention-biased side of the trade.
      const priorFileId = ctx?.previous?.file_id;
      if (priorFileId === undefined || priorFileId === null || priorFileId === '') return;
      // A write that re-states the same id detaches nothing.
      if (String(priorFileId) === String(data.file_id)) return;
      await tombstoneOrphanedFiles(engine, logger, [String(priorFileId)]);
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );
}

/**
 * Which surface still holds a file — `null` when nothing does.
 *
 * Two surfaces can hold one `sys_file`, and they are not interchangeable:
 * `sys_attachment` join rows (the Attachments surface, #2727) and the
 * `ref_*` ownership columns (field-file lineage, ADR-0104 / #3459 PR-5b).
 * A file with ZERO join rows may still be owned through the columns.
 */
export type FileHolder = 'attachment' | 'field-owner' | null;

/**
 * The ownership half of the hold question: do the `ref_*` columns name an
 * owner? Exactly the predicate the reap guard has always applied — `ref_field`
 * is deliberately NOT consulted, because a slot is identified by (object,
 * record) and a missing field name must not read as "unowned".
 */
export function hasFieldReferenceOwner(row: Record<string, unknown>): boolean {
  return row.ref_object != null && row.ref_id != null && row.ref_id !== '';
}

/**
 * "Is anything still holding this file?" — asked in ONE place because a second
 * asker now exists (the stranded-orphan inventory, #10950).
 *
 * The reap guard asks it at sweep time before reclaiming bytes; the inventory
 * asks it to decide whether a file with no join rows is genuinely stranded.
 * The maintainer's ruling on #10950 requires the inventory to apply "the same
 * `ref_*` ownership re-verification the reap guard uses — never a weaker
 * question", and the only way to make "the same" a property of the code rather
 * than a claim in a comment is for both callers to run this function. Two
 * copies of an ownership test that authorises byte deletion is the drift
 * #10171 was filed against, one seam over.
 *
 * ⚠️ Weakening this — dropping the `ref_*` limb, or asking only for a join-row
 * count — makes live, field-owned files read as orphans. That is why the check
 * is a union and not a choice.
 */
export async function findFileHolder(
  engine: Pick<AttachmentLifecycleEngine, 'find'>,
  fileId: string | number,
  row: Record<string, unknown>,
): Promise<FileHolder> {
  const refs = await engine.find('sys_attachment', {
    where: { file_id: String(fileId) },
    limit: 1,
    context: { ...SYSTEM_CTX },
  });
  if (refs?.length) return 'attachment';
  return hasFieldReferenceOwner(row) ? 'field-owner' : null;
}

/**
 * The BATCHED form of {@link findFileHolder} — "which of these files is still
 * held?" — for callers holding many rows at once (#11427).
 *
 * Record file-field hydration is such a caller: it must reach the same verdict
 * the download path reaches (#10246) or one `sys_file` row gets two answers,
 * but it runs over many rows per read, so asking {@link findFileHolder} per
 * file would be N queries per read. This asks the SAME union in at most one
 * extra query for the whole batch.
 *
 * ⚠️ Same union, same limbs, deliberately in the cheaper order. {@link
 * findFileHolder} asks the join-row limb first because it must NAME the
 * surface; this one only needs "held or not", so it takes the free limb first:
 * {@link hasFieldReferenceOwner} is a pure column test on rows the caller has
 * already read, and every id it settles is an id the join-row query never has
 * to carry. `||` commutes, so the verdict is identical either way — pinned as
 * an equivalence in `tombstone-hydration-download-agreement.test.ts` rather
 * than asserted here.
 *
 * Cost, stated rather than assumed:
 *   - no rows, or every row settled by the columns → ZERO queries;
 *   - otherwise → exactly ONE `$in` read of `sys_attachment`, whatever the
 *     number of files or records involved.
 */
export async function findHeldFiles(
  engine: Pick<AttachmentLifecycleEngine, 'find'>,
  rows: Array<Record<string, unknown>>,
): Promise<Set<string>> {
  const held = new Set<string>();
  const needJoinCheck: string[] = [];
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    // The free limb first — a pure test on a row already in hand.
    if (hasFieldReferenceOwner(row)) held.add(id);
    else needJoinCheck.push(id);
  }
  if (needJoinCheck.length === 0) return held;
  const refs = await engine.find('sys_attachment', {
    where: { file_id: { $in: needJoinCheck } },
    context: { ...SYSTEM_CTX },
  });
  for (const ref of refs ?? []) {
    if (ref?.file_id != null) held.add(String(ref.file_id));
  }
  return held;
}

/**
 * The `sys_file` reap guard ({@link LifecycleReapGuard} shape from
 * `@objectstack/objectql`, duck-typed here to avoid the dependency).
 * Candidates arrive from the two declared policies — tombstones past the
 * TTL and `pending` uploads past retention — and each is either confirmed
 * (bytes reclaimed first) or vetoed (kept this sweep):
 *
 *  - `pending`: the upload was never completed; bytes may or may not exist.
 *    Best-effort byte delete, then confirm.
 *  - `deleted`: re-verify at sweep time that nothing holds the file on
 *    EITHER surface — zero `sys_attachment` join rows AND empty ownership
 *    columns (`ref_*`). Either found (hook bypass, restore, re-claim) →
 *    un-tombstone and veto. A tombstone outside the `attachments` scope is
 *    field-file lineage (#3459 PR-5b) and additionally requires this
 *    deployment's `adr-0104-file-references` flag to authorise an
 *    IRREVERSIBLE action — re-read fresh each sweep via `isCollectionOpen`,
 *    so anything recorded since stops already-written tombstones from
 *    becoming byte deletes, without a restart. Two things close it: a later
 *    failing migration run clearing `verified_at`, and a deviation observed
 *    on a still-verified deployment — a value an `OS_ALLOW_LAX_*` escape
 *    hatch admitted against the very contract the certificate asserts
 *    (#4797). The second is why the caller supplies `mayActIrreversibly`
 *    rather than `isDataMigrationVerified`: the recoverable consumers of the
 *    same flag keep running on the certificate, and only the byte delete
 *    stops. A closed gate vetoes but does NOT un-tombstone: the observed
 *    release stands; only the permission to delete is withheld.
 *    Clear on both counts → delete bytes; a byte-delete failure vetoes so
 *    the row is retried next sweep (the row is the only pointer to the
 *    bytes — dropping it first would leak the bytes forever).
 *  - anything else: veto (shouldn't be a candidate; fail toward retention).
 *
 * `isCollectionOpen` absent (an older caller, a test fake) reads as "gate
 * closed": field-file tombstones are kept, attachments behave as always.
 */
export function createSysFileReapGuard(
  engine: AttachmentLifecycleEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: AttachmentLifecycleLogger,
  isCollectionOpen?: () => Promise<boolean>,
): (object: string, rows: Array<Record<string, unknown>>) => Promise<Array<string | number>> {
  return async (_object, rows) => {
    const confirmed: Array<string | number> = [];
    const storage = getStorage();
    // One fresh flag read per sweep batch, taken lazily so a batch with no
    // field-file tombstone costs nothing.
    let gate: Promise<boolean> | undefined;
    const collectionOpen = () =>
      (gate ??= (async () => {
        if (typeof isCollectionOpen !== 'function') return false;
        try {
          return (await isCollectionOpen()) === true;
        } catch {
          return false; // unreadable evidence → the gate is closed
        }
      })());
    let keptGateClosed = 0;
    for (const row of rows) {
      const id = row?.id as string | number | undefined;
      if (id === undefined || id === null) continue;

      if (row.status === 'pending') {
        try {
          if (storage && typeof row.key === 'string' && row.key) await storage.delete(row.key);
          confirmed.push(id);
        } catch (err) {
          logger.warn(
            `[storage] reap guard: byte delete failed for pending sys_file ${id} (${(err as Error)?.message ?? err}); retrying next sweep`,
          );
        }
        continue;
      }

      if (row.status === 'deleted') {
        try {
          const holder = await findFileHolder(engine, id, row);
          if (holder) {
            await engine.update(
              'sys_file',
              { id, status: 'committed', deleted_at: null },
              { context: { ...SYSTEM_CTX } },
            );
            logger.info(
              `[storage] reap guard: sys_file ${id} regained ${holder === 'attachment' ? 'references' : 'an owner'} since tombstoning — un-tombstoned, not reaped`,
            );
            continue;
          }
          if (row.scope !== 'attachments' && !(await collectionOpen())) {
            keptGateClosed += 1;
            continue;
          }
          if (storage && typeof row.key === 'string' && row.key) await storage.delete(row.key);
          confirmed.push(id);
        } catch (err) {
          logger.warn(
            `[storage] reap guard: reclaim failed for sys_file ${id} (${(err as Error)?.message ?? err}); retrying next sweep`,
          );
        }
        continue;
      }
      // Not a state this guard reaps — veto (fail toward retention).
    }
    if (keptGateClosed > 0) {
      // The guard is handed a boolean, so it cannot name WHICH of the two
      // closed the gate — and naming only the first was wrong once #4797
      // added the second: a deployment whose `verified_at` is plainly set
      // would be told its migration "is not verified" and sent hunting. Both
      // causes are stated, and they share one remedy, so the instruction is
      // unambiguous either way. `sys_migration` has the answer.
      logger.info(
        `[storage] reap guard: kept ${keptGateClosed} released field file(s) — this deployment's ` +
          `file-as-reference migration is not verified, or a deviation has been observed since it ` +
          `was (a value an OS_ALLOW_LAX_* escape hatch admitted against the migration's own ` +
          `contract). Either way: fix the data, then run \`os migrate files-to-references --apply\`. ` +
          `See sys_migration.verified_at / deviation_observed_at (ADR-0104 / #4797)`,
      );
    }
    return confirmed;
  };
}

/**
 * The `sys_upload_session` reap guard (#2970 sub-follow-up). The
 * LifecycleService reaps abandoned/terminal chunked-upload session ROWS by the
 * declared TTL (`expires_at`) / retention (terminal statuses); this guard
 * aborts the underlying BACKEND multipart upload before the row is deleted, so
 * a session's already-uploaded parts don't leak. On S3 an initiated-but-not-
 * completed multipart keeps its parts billable and invisible to normal listing
 * until an explicit AbortMultipartUpload — reaping only the row would strand
 * them, with `backend_upload_id` (the sole pointer) gone.
 *
 *  - `completed`: the multipart was already finalized into a real object —
 *    nothing to abort (an abort would `NoSuchUpload`-error and wedge the reap).
 *    Confirm the row.
 *  - no `backend_upload_id`, or an adapter without `abortChunkedUpload`:
 *    nothing to abort. Confirm.
 *  - otherwise (in_progress / failed / expired with a backend upload): abort
 *    the backend multipart, re-seeding the S3 `uploadId → key` map from the row
 *    first (a cold sweep lacks the live in-process map; a no-op for adapters
 *    that don't track keys, e.g. local). Confirm on success; VETO on failure
 *    so the row — the only pointer to the leaked multipart — is retried.
 */
export function createUploadSessionReapGuard(
  getStorage: () => IStorageService | null | undefined,
  logger: AttachmentLifecycleLogger,
): (object: string, rows: Array<Record<string, unknown>>) => Promise<Array<string | number>> {
  return async (_object, rows) => {
    const confirmed: Array<string | number> = [];
    const storage = getStorage();
    for (const row of rows) {
      const id = row?.id as string | number | undefined;
      if (id === undefined || id === null) continue;

      const backendId = typeof row.backend_upload_id === 'string' ? row.backend_upload_id : '';
      // Nothing to abort → just reap the row: no backend multipart, an already
      // -completed upload (its parts became an object), or an adapter that
      // can't abort.
      if (!backendId || row.status === 'completed' || !storage || typeof storage.abortChunkedUpload !== 'function') {
        confirmed.push(id);
        continue;
      }

      try {
        // A cold sweep runs long after the live session, so the S3 adapter's
        // in-process `uploadId → key` map (populated by `setUploadKey` during
        // upload) is empty — re-seed it from the row so the abort can resolve
        // the S3 key. `setUploadKey` is S3-specific and not forwarded by the
        // swappable proxy, so reach the inner adapter; a no-op for `local`.
        const inner: any = typeof (storage as any).getInner === 'function' ? (storage as any).getInner() : storage;
        if (typeof row.key === 'string' && row.key && typeof inner?.setUploadKey === 'function') {
          inner.setUploadKey(backendId, row.key);
        }
        await storage.abortChunkedUpload(backendId);
        confirmed.push(id);
      } catch (err) {
        logger.warn(
          `[storage] reap guard: multipart abort failed for sys_upload_session ${id} (${(err as Error)?.message ?? err}); retrying next sweep`,
        );
        // veto — keep the row so `backend_upload_id` survives for the retry.
      }
    }
    return confirmed;
  };
}
