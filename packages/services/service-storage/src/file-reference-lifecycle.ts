// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { FILE_REFERENCE_TYPES, isFileIdToken } from '@objectstack/spec/data';
import type { IStorageService } from '@objectstack/spec/contracts';

/**
 * Field-reference file ownership (ADR-0104 D3 wave 2).
 *
 * A `file`/`image`/`avatar`/`video`/`audio` FIELD holds an opaque `sys_file`
 * id. This module keeps `sys_file.ref_object/ref_id/ref_field` in step with
 * what records actually hold, so the platform always knows which record's
 * field owns a given file.
 *
 * ## Exclusive ownership, not shared reference counting
 *
 * The attachments surface (`sys_attachment`) deliberately SHARES one file
 * across many join rows — Salesforce ContentDocumentLink semantics, where
 * attaching the same document to several records is the point. Field
 * references take the opposite model: at most ONE (object, record, field)
 * slot owns a file. Writing an already-owned id into a second slot COPIES the
 * bytes into a fresh `sys_file` instead of sharing the row.
 *
 * Two properties fall out, and both exist to keep a mistake from becoming
 * unrecoverable:
 *
 *  1. **Release is an observed transition, never an inferred absence.** The
 *     platform learns a file is free because its one owner let go — not
 *     because a count came back zero. A miscount cannot authorise a delete,
 *     because nothing is ever counted.
 *  2. **Read authorisation derives from exactly one parent record**, not the
 *     union of every referrer's. Copying a private record's file id into a
 *     world-readable record — the sort of thing generated code does without
 *     any visible mistake — cannot widen who can read the bytes, because the
 *     second record gets its own copy.
 *
 * ## What this module does NOT do
 *
 * It records ownership and it releases ownership. It never tombstones and
 * never deletes bytes. The `scope === 'attachments'` guardrail in
 * `attachment-lifecycle.ts` — which is what keeps field-referenced files out
 * of the reap entirely — is untouched here, so shipping this module cannot
 * delete anything. Turning released files into reap candidates is a separate,
 * gated change that must also extend the reap guard's sweep-time re-verify in
 * the same commit; see {@link releaseOwnership}.
 *
 * ## Dormancy
 *
 * Every path exits before doing I/O unless a file-class field on the written
 * object actually holds an id token. Objects without file-class fields pay a
 * cached-metadata lookup and nothing else; a field holding a legacy inline
 * blob or an external URL is never an id token and costs nothing.
 */

const PACKAGE_ID = 'com.objectstack.service.storage';
const SYSTEM_CTX = { isSystem: true } as const;

/** Bound on records resolved per where-shaped multi-delete — matches the
 * attachment lifecycle's posture: bound one pass, converge across sweeps. */
const MULTI_DELETE_RESOLVE_LIMIT = 1_000;

/** Bound on owned files released per record delete. */
const RELEASE_BATCH_LIMIT = 1_000;

/** Key under which beforeDelete stashes the ids of records about to die (the
 * engine passes the SAME HookContext object to before/after delete). Only
 * needed for where-shaped deletes, where afterDelete has no id list. */
const STASH_KEY = '__fileRefDeletedIds';

/** Engine surface these installers need — duck-typed like the other
 * service-storage seams so tests can fake it. */
export interface FileReferenceEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => void | Promise<void>,
    options?: { object?: string | string[]; packageId?: string; priority?: number },
  ): void;
  getObject(name: string): any | undefined;
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  findOne(object: string, options: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
}

export interface FileReferenceLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

/** Raised when a file id must be copied to preserve exclusive ownership but
 * the copy fails. The write is failed rather than completed, because a field
 * pointing at bytes it does not own is precisely the state the ownership
 * model exists to make impossible — and the state a later reap would act on. */
export class FileReferenceCopyError extends Error {
  readonly code = 'ERR_FILE_REFERENCE_COPY';
  constructor(fileId: string, cause: unknown) {
    super(
      `Cannot copy file '${fileId}' for a second field reference — ` +
        `refusing the write rather than storing a reference the record does not own ` +
        `(${(cause as Error)?.message ?? cause})`,
    );
  }
}

function asIdList(id: unknown): Array<string | number> | null {
  if (typeof id === 'string' || typeof id === 'number') return [id];
  if (id && typeof id === 'object' && Array.isArray((id as any).$in)) {
    return (id as any).$in.filter((v: unknown) => typeof v === 'string' || typeof v === 'number');
  }
  return null;
}

/** File-class field names on an object, or `[]`. */
function fileFieldsOf(engine: FileReferenceEngine, objectName: string): string[] {
  const schema: any = engine.getObject(objectName);
  if (!schema?.fields) return [];
  return Object.entries(schema.fields)
    .filter(([, def]: [string, any]) => def && FILE_REFERENCE_TYPES.has(def.type))
    .map(([name]) => name);
}

/** The id tokens a field value carries (a `multiple: true` field holds an
 * array). Inline blobs and URL-shaped strings yield nothing. */
function idTokensIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => isFileIdToken(v)) as string[];
  return isFileIdToken(value) ? [value] : [];
}

/** Does `row`'s recorded owner name exactly this slot? */
function isSameSlot(
  row: Record<string, unknown>,
  object: string,
  recordId: string,
  field: string,
): boolean {
  return (
    row.ref_object === object && String(row.ref_id) === String(recordId) && row.ref_field === field
  );
}

/**
 * Is this module live for `objectName`? Guards every entry point:
 *  - `sys_file` itself is excluded so the module's own bookkeeping writes
 *    cannot re-enter it,
 *  - a kernel without the storage objects registered stays inert,
 *  - an object with no file-class fields — nearly all of them — exits here.
 */
function activeFileFields(engine: FileReferenceEngine, objectName: string): string[] {
  if (objectName === 'sys_file') return [];
  if (!engine.getObject('sys_file')) return [];
  return fileFieldsOf(engine, objectName);
}

/**
 * Copy a file's bytes into a brand-new `sys_file`, returning the new id.
 *
 * Reached only when a record writes an id already owned by a different field
 * slot. Uses `download` + `upload` from the {@link IStorageService} contract;
 * an adapter with a native server-side copy (S3 `CopyObject`) can shortcut
 * this later without changing the caller.
 */
async function copyOwnedFile(
  engine: FileReferenceEngine,
  storage: IStorageService,
  src: Record<string, unknown>,
): Promise<string> {
  const srcKey = typeof src.key === 'string' ? src.key : '';
  if (!srcKey) throw new Error('source file has no storage key');

  const bytes = await storage.download(srcKey);
  const newId = randomUUID();
  const name = typeof src.name === 'string' && src.name ? src.name : newId;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const scope = typeof src.scope === 'string' && src.scope ? src.scope : 'user';
  const newKey = `${scope}/${newId}${ext}`;

  await storage.upload(newKey, bytes, {
    contentType: typeof src.mime_type === 'string' ? src.mime_type : undefined,
    acl: typeof src.acl === 'string' ? (src.acl as any) : undefined,
  } as any);

  const now = new Date().toISOString();
  // Ownership columns are deliberately left NULL — the after-hook claims the
  // copy for the slot that triggered it, on the same path as any other file.
  await engine.insert(
    'sys_file',
    {
      id: newId,
      key: newKey,
      name,
      mime_type: src.mime_type ?? null,
      size: src.size ?? null,
      scope,
      bucket: src.bucket ?? null,
      acl: src.acl ?? null,
      status: 'committed',
      etag: null,
      owner_id: src.owner_id ?? null,
      created_at: now,
      updated_at: now,
    },
    { context: { ...SYSTEM_CTX } },
  );
  return newId;
}

/**
 * Rewrite, in place, any id in `data` that is already owned by a different
 * slot so it points at a fresh copy instead. Runs in the BEFORE hooks, where
 * mutating `input.data` is what the driver goes on to persist — so the record
 * never transiently holds a reference it does not own.
 *
 * `recordId` is null on insert: a new record can never be the current owner,
 * so every already-owned id is copied.
 */
async function applyCopyOnClaim(
  engine: FileReferenceEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: FileReferenceLogger,
  object: string,
  recordId: string | null,
  data: Record<string, unknown>,
  fileFields: string[],
): Promise<void> {
  for (const field of fileFields) {
    if (!(field in data)) continue;
    const value = data[field];
    const tokens = idTokensIn(value);
    if (tokens.length === 0) continue;

    const replacements = new Map<string, string>();
    for (const token of [...new Set(tokens)]) {
      const row = await engine.findOne('sys_file', {
        where: { id: token },
        context: { ...SYSTEM_CTX },
      });
      // Unknown id: not a file this platform manages (external/legacy value).
      // Left verbatim — the read resolver ignores it for the same reason.
      if (!row) continue;
      // Unclaimed: the after-hook will claim it for this slot. Nothing to copy.
      if (row.ref_id == null) continue;
      // Already ours (an update rewriting the same value) — no-op.
      // `recordId` is null on insert, where a brand-new record can never be
      // the current owner — so there, every already-owned id is a copy.
      if (recordId !== null && isSameSlot(row, object, recordId, field)) continue;

      const storage = getStorage();
      if (!storage) {
        // No storage service wired (bare kernel). Copying is impossible, so
        // ownership cannot be maintained for this value — but failing user
        // writes on a kernel that cannot have served an upload in the first
        // place would be worse. Leave the value; `claimFile` refuses to steal,
        // so the original owner is never disturbed.
        logger.warn(
          `[storage] file reference: no storage service — cannot copy already-owned file ${token} ` +
            `for ${object}.${field}; the value is kept but this record will not own it`,
        );
        continue;
      }
      try {
        replacements.set(token, await copyOwnedFile(engine, storage, row));
        logger.debug?.(
          `[storage] file reference: copied ${token} for ${object}.${field} (exclusive ownership)`,
        );
      } catch (err) {
        throw new FileReferenceCopyError(token, err);
      }
    }

    if (replacements.size === 0) continue;
    data[field] = Array.isArray(value)
      ? value.map((v) => (typeof v === 'string' && replacements.has(v) ? replacements.get(v)! : v))
      : (replacements.get(value as string) ?? value);
  }
}

/**
 * Record that `fileId` is owned by `object`/`recordId`/`field`.
 *
 * NEVER steals: a file already owned by a different slot is left alone and
 * logged. Reaching that branch means copy-on-claim could not run (no storage
 * service), and the safe outcome is that the original owner keeps the file —
 * a second record pointing at bytes it does not own is visible to
 * `verify-references`, whereas a silently transferred owner would not be.
 */
async function claimFile(
  engine: FileReferenceEngine,
  logger: FileReferenceLogger,
  fileId: string,
  object: string,
  recordId: string,
  field: string,
): Promise<void> {
  const row = await engine.findOne('sys_file', { where: { id: fileId }, context: { ...SYSTEM_CTX } });
  if (!row) return; // not a platform-managed file — nothing to own
  if (row.ref_id != null && !isSameSlot(row, object, recordId, field)) {
    logger.warn(
      `[storage] file reference: ${fileId} is already owned by ` +
        `${row.ref_object}/${row.ref_id}.${row.ref_field} — not transferring it to ${object}/${recordId}.${field}`,
    );
    return;
  }

  const patch: Record<string, unknown> = {
    id: fileId,
    ref_object: object,
    ref_id: String(recordId),
    ref_field: field,
  };
  // A file re-referenced within its grace window comes back to life, mirroring
  // the attachment re-attach path.
  if (row.status === 'deleted') {
    patch.status = 'committed';
    patch.deleted_at = null;
  }
  await engine.update('sys_file', patch, { context: { ...SYSTEM_CTX } });
}

/**
 * Give up ownership of `rows` — the single seam through which a field-owned
 * file becomes unreferenced.
 *
 * Today this only clears the ownership columns; the file becomes unowned and
 * stays exactly as retained as it was before (no tombstone, so nothing makes
 * it a reap candidate). Enabling collection means extending THIS function to
 * also set `status='deleted'` + `deleted_at` — and that change is only safe in
 * the same commit that teaches the `sys_file` reap guard to re-verify the
 * ownership columns at sweep time. Doing the tombstone half alone would make
 * every released file reapable while the guard still re-verifies only
 * `sys_attachment` (always empty for field files), i.e. a guaranteed byte
 * delete rather than a merely risky one. Keep both halves together.
 */
async function releaseOwnership(
  engine: FileReferenceEngine,
  logger: FileReferenceLogger,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (const row of rows) {
    const id = row?.id;
    if (id == null) continue;
    try {
      await engine.update(
        'sys_file',
        { id, ref_object: null, ref_id: null, ref_field: null },
        { context: { ...SYSTEM_CTX } },
      );
      logger.debug?.(`[storage] file reference: released ownership of sys_file ${String(id)}`);
    } catch (err) {
      // Bookkeeping must never break a user's write. A missed release only
      // means the file stays owned — it lingers rather than being collected,
      // which is the safe direction.
      logger.warn(
        `[storage] file reference: failed to release sys_file ${String(id)} ` +
          `(${(err as Error)?.message ?? err})`,
      );
    }
  }
}

/** Files currently owned by a specific slot. */
async function ownedBySlot(
  engine: FileReferenceEngine,
  object: string,
  recordId: string,
  field: string,
): Promise<Array<Record<string, unknown>>> {
  return (
    (await engine.find('sys_file', {
      where: { ref_object: object, ref_id: String(recordId), ref_field: field },
      limit: RELEASE_BATCH_LIMIT,
      context: { ...SYSTEM_CTX },
    })) ?? []
  );
}

/**
 * Install the ownership hooks. Global (no object filter): any object may
 * declare a file-class field, and {@link activeFileFields} exits immediately
 * for those that do not.
 */
export function installFileReferenceHooks(
  engine: FileReferenceEngine,
  getStorage: () => IStorageService | null | undefined,
  logger: FileReferenceLogger,
): void {
  // ── beforeInsert / beforeUpdate: copy-on-claim ────────────────────
  // Runs before the driver write so the persisted value is already the id
  // this record will own.
  engine.registerHook(
    'beforeInsert',
    async (ctx: any) => {
      const object: string = ctx?.object;
      const data = ctx?.input?.data;
      if (!object || !data || typeof data !== 'object') return;
      const fileFields = activeFileFields(engine, object);
      if (fileFields.length === 0) return;
      await applyCopyOnClaim(engine, getStorage, logger, object, null, data, fileFields);
    },
    { packageId: PACKAGE_ID },
  );

  engine.registerHook(
    'beforeUpdate',
    async (ctx: any) => {
      const object: string = ctx?.object;
      const data = ctx?.input?.data;
      if (!object || !data || typeof data !== 'object') return;
      const fileFields = activeFileFields(engine, object);
      if (fileFields.length === 0) return;
      const ids = asIdList(ctx?.input?.id);
      // A multi-update writing a file id would give the same id to every
      // matched record; only a single-record update can own one. Copy-on-claim
      // needs a definite owner, so skip — `claimFile` then refuses to steal.
      const recordId = ids && ids.length === 1 ? String(ids[0]) : null;
      await applyCopyOnClaim(engine, getStorage, logger, object, recordId, data, fileFields);
    },
    { packageId: PACKAGE_ID },
  );

  // ── afterInsert: claim ────────────────────────────────────────────
  engine.registerHook(
    'afterInsert',
    async (ctx: any) => {
      const object: string = ctx?.object;
      const row = ctx?.result;
      if (!object || !row || typeof row !== 'object') return;
      const fileFields = activeFileFields(engine, object);
      if (fileFields.length === 0) return;
      const recordId = row.id;
      if (recordId == null) return;
      for (const field of fileFields) {
        for (const token of [...new Set(idTokensIn(row[field]))]) {
          try {
            await claimFile(engine, logger, token, object, String(recordId), field);
          } catch (err) {
            logger.warn(
              `[storage] file reference: failed to claim ${token} for ${object}/${String(recordId)}.${field} ` +
                `(${(err as Error)?.message ?? err})`,
            );
          }
        }
      }
    },
    { packageId: PACKAGE_ID },
  );

  // ── afterUpdate: release what left the slot, claim what arrived ───
  engine.registerHook(
    'afterUpdate',
    async (ctx: any) => {
      const object: string = ctx?.object;
      const data = ctx?.input?.data;
      if (!object || !data || typeof data !== 'object') return;
      const fileFields = activeFileFields(engine, object);
      if (fileFields.length === 0) return;
      const ids = asIdList(ctx?.input?.id);
      if (!ids || ids.length !== 1) return; // see beforeUpdate — no definite owner
      const recordId = String(ids[0]);

      for (const field of fileFields) {
        // Only a field the write actually TOUCHED can have changed ownership;
        // a PATCH that omits the field leaves its file alone.
        if (!(field in data)) continue;
        const incoming = new Set(idTokensIn(data[field]));
        try {
          const current = await ownedBySlot(engine, object, recordId, field);
          const stale = current.filter((r) => !incoming.has(String(r.id)));
          await releaseOwnership(engine, logger, stale);
          const held = new Set(current.map((r) => String(r.id)));
          for (const token of incoming) {
            if (held.has(token)) continue; // already ours
            await claimFile(engine, logger, token, object, recordId, field);
          }
        } catch (err) {
          logger.warn(
            `[storage] file reference: failed to reconcile ${object}/${recordId}.${field} ` +
              `(${(err as Error)?.message ?? err})`,
          );
        }
      }
    },
    { packageId: PACKAGE_ID },
  );

  // ── beforeDelete: resolve ids for where-shaped deletes ────────────
  // A delete keyed by id needs nothing here; a `where` delete has no id list
  // in afterDelete, and by then the records are gone.
  engine.registerHook(
    'beforeDelete',
    async (ctx: any) => {
      const object: string = ctx?.object;
      if (!object) return;
      if (activeFileFields(engine, object).length === 0) return;
      if (asIdList(ctx?.input?.id)) return; // afterDelete can read it directly
      const where = ctx?.input?.options?.where;
      if (!where) return;
      try {
        const rows = await engine.find(object, {
          where,
          limit: MULTI_DELETE_RESOLVE_LIMIT,
          context: { ...SYSTEM_CTX },
        });
        ctx[STASH_KEY] = (rows ?? []).map((r) => r?.id).filter((id) => id != null);
      } catch (err) {
        logger.warn(
          `[storage] file reference: failed to resolve ids before a where-delete on ${object} ` +
            `(${(err as Error)?.message ?? err})`,
        );
        ctx[STASH_KEY] = [];
      }
    },
    { packageId: PACKAGE_ID },
  );

  // ── afterDelete: release everything the dead records owned ────────
  // Keyed off the ownership index, so the deleted records' field values never
  // have to be read back (they are already gone).
  engine.registerHook(
    'afterDelete',
    async (ctx: any) => {
      const object: string = ctx?.object;
      if (!object) return;
      if (activeFileFields(engine, object).length === 0) return;
      const stashed = Array.isArray(ctx?.[STASH_KEY]) ? ctx[STASH_KEY] : null;
      const ids = stashed ?? asIdList(ctx?.input?.id);
      if (!ids || ids.length === 0) return;
      try {
        const owned = await engine.find('sys_file', {
          where: { ref_object: object, ref_id: { $in: ids.map((id) => String(id)) } },
          limit: RELEASE_BATCH_LIMIT,
          context: { ...SYSTEM_CTX },
        });
        if (owned?.length) await releaseOwnership(engine, logger, owned);
      } catch (err) {
        logger.warn(
          `[storage] file reference: failed to release files owned by deleted ${object} records ` +
            `(${(err as Error)?.message ?? err})`,
        );
      }
    },
    { packageId: PACKAGE_ID },
  );
}
