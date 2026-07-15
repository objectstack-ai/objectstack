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
 *     LAST join row referencing an attachments-scope file is deleted, the
 *     `sys_file` row is marked `status='deleted'` + `deleted_at=now`.
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
 * Only `scope === 'attachments'` files are ever tombstoned: `Field.file` /
 * `Field.image` / avatar uploads use other scopes and reference files from
 * record columns the join-row count cannot see.
 */

/** Engine surface these installers need — duck-typed like the other
 * service-storage seams so tests can fake it. */
export interface AttachmentLifecycleEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string; packageId?: string },
  ): void;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

export interface AttachmentLifecycleLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

const PACKAGE_ID = 'com.objectstack.service.storage';
const SYSTEM_CTX = { isSystem: true } as const;
/** Bound on join rows resolved per multi-delete — matches the reap-guard
 * batch posture: bound one pass, converge across sweeps. */
const MULTI_DELETE_RESOLVE_LIMIT = 1_000;

/** Key under which beforeDelete stashes file ids for afterDelete (the engine
 * passes the SAME HookContext object to both events). */
const STASH_KEY = '__attachmentFileIds';

function asIdList(id: unknown): Array<string | number> | null {
  if (typeof id === 'string' || typeof id === 'number') return [id];
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    return (id as any).$in.filter((v: unknown) => typeof v === 'string' || typeof v === 'number');
  }
  return null;
}

/**
 * Install the tombstone hooks on `sys_attachment`. Lifecycle bookkeeping
 * must never block or fail a user's delete/insert — every handler is
 * best-effort and only logs on failure.
 */
export function installAttachmentLifecycleHooks(
  engine: AttachmentLifecycleEngine,
  logger: AttachmentLifecycleLogger,
): void {
  // beforeDelete: resolve the file_id(s) of the join row(s) about to die —
  // after the delete they are unreadable. Stash on the shared HookContext.
  engine.registerHook(
    'beforeDelete',
    async (ctx: any) => {
      try {
        const fileIds = new Set<string>();
        const ids = asIdList(ctx?.input?.id);
        if (ids) {
          for (const id of ids) {
            const row = await engine.findOne('sys_attachment', { where: { id }, context: { ...SYSTEM_CTX } });
            if (row?.file_id) fileIds.add(String(row.file_id));
          }
        } else if (ctx?.input?.options?.where) {
          const rows = await engine.find('sys_attachment', {
            where: ctx.input.options.where,
            limit: MULTI_DELETE_RESOLVE_LIMIT,
            context: { ...SYSTEM_CTX },
          });
          for (const row of rows ?? []) {
            if (row?.file_id) fileIds.add(String(row.file_id));
          }
        }
        ctx[STASH_KEY] = [...fileIds];
      } catch (err) {
        // Never block the delete; the reap guard's sweep-time re-verification
        // cannot resurrect a missed tombstone, but a missed tombstone only
        // means the orphan lingers — fail toward retention, not data loss.
        logger.warn(
          `[storage] attachment lifecycle: failed to resolve file ids before delete (${(err as Error)?.message ?? err})`,
        );
        ctx[STASH_KEY] = [];
      }
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );

  // afterDelete: any stashed file with zero remaining references is
  // tombstoned — if (and only if) it is an attachments-scope committed file.
  engine.registerHook(
    'afterDelete',
    async (ctx: any) => {
      const fileIds: string[] = Array.isArray(ctx?.[STASH_KEY]) ? ctx[STASH_KEY] : [];
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
    },
    { object: 'sys_attachment', packageId: PACKAGE_ID },
  );

  // afterInsert: re-attaching a tombstoned file (grace window not yet
  // expired) brings it back to life.
  engine.registerHook(
    'afterInsert',
    async (ctx: any) => {
      try {
        const row: any = ctx?.result ?? ctx?.input?.doc ?? ctx?.input?.data;
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
 *  - `deleted`: re-verify ZERO sys_attachment references at sweep time.
 *    References found (hook bypass, restore) → un-tombstone and veto.
 *    Zero references → delete bytes; a byte-delete failure vetoes so the
 *    row is retried next sweep (the row is the only pointer to the bytes —
 *    dropping it first would leak the bytes forever).
 *  - anything else: veto (shouldn't be a candidate; fail toward retention).
 */
export function createSysFileReapGuard(
  engine: AttachmentLifecycleEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: AttachmentLifecycleLogger,
): (object: string, rows: Array<Record<string, unknown>>) => Promise<Array<string | number>> {
  return async (_object, rows) => {
    const confirmed: Array<string | number> = [];
    const storage = getStorage();
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
          const refs = await engine.find('sys_attachment', {
            where: { file_id: String(id) },
            limit: 1,
            context: { ...SYSTEM_CTX },
          });
          if (refs?.length) {
            await engine.update(
              'sys_file',
              { id, status: 'committed', deleted_at: null },
              { context: { ...SYSTEM_CTX } },
            );
            logger.info(
              `[storage] reap guard: sys_file ${id} regained references since tombstoning — un-tombstoned, not reaped`,
            );
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
    return confirmed;
  };
}
