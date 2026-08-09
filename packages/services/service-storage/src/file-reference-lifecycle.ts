// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import { FILE_REFERENCE_TYPES, isFileIdToken, RAW_FILE_VALUES_CONTEXT_KEY } from '@objectstack/spec/data';
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
 * It records ownership, releases ownership, and — only on a deployment that
 * has verified its file-as-reference migration (#3617) — tombstones a
 * released file so the platform sweep can collect it after the declared
 * grace window. It never deletes bytes itself: reclaiming them stays with the
 * `sys_file` reap guard in `attachment-lifecycle.ts`, whose sweep-time
 * re-verify covers the ownership columns for exactly this lineage. Those two
 * halves — the tombstone here, the re-verify there — shipped in the same
 * change (#3459 PR-5b) and must stay together; see {@link releaseOwnership}.
 * On a deployment that has not migrated, nothing here ever tombstones, so
 * nothing this module does can lead to a deleted byte.
 *
 * ## Dormancy
 *
 * Every path exits before doing I/O unless a file-class field on the written
 * object actually holds an id token. Objects without file-class fields pay a
 * cached-metadata lookup and nothing else; a field holding a legacy inline
 * blob or an external URL is never an id token and costs nothing.
 */

const PACKAGE_ID = 'com.objectstack.service.storage';
// Bookkeeping reads want the STORED form — never the read resolver's expanded
// shape (and skipping resolution also saves a batched sys_file sub-read on
// every internal page). Inert on write contexts.
const SYSTEM_CTX = { isSystem: true, [RAW_FILE_VALUES_CONTEXT_KEY]: true } as const;

/** Bound on owned files released per record delete. */
const RELEASE_BATCH_LIMIT = 1_000;

/**
 * Key under which `beforeDelete` collects the ids of the records about to die,
 * for `afterDelete` to release in ONE pass.
 *
 * [#6966] It lives on `HookContext.dispatch.scope` — the engine's per-write
 * scratch, one object shared by every dispatch of one caller write across both
 * phases — NOT on the context. This comment used to say "the engine passes the
 * SAME HookContext object to before/after delete"; that has been false for a
 * predicate (`multi: true`) delete since #5574 made the `before*` phase
 * dispatch per row, each row on a freshly built context. The stash died with
 * the row that wrote it, and the guard that decided whether to write one had
 * inverted as well (see the hook below), so this whole path was dead code.
 *
 * Only needed for predicate deletes: a single-id delete's `afterDelete` reads
 * `input.id` directly.
 */
const STASH_KEY = '__fileRefDeletedIds';

/**
 * [#6966] Is this dispatch one row of a predicate write's fan-out?
 *
 * Asked of the ENGINE's marker, never inferred from `input.id`. Before #5574 a
 * bulk write dispatched `before*` once with `input.id` present-but-`undefined`,
 * so "no id" was a reliable bulk signal and the guards here were written on it;
 * every per-row context now carries an id, so that inference answers "single
 * write" for every row of a batch. An ABSENT marker reads as `false`, which is
 * the single-write direction these guards already default to.
 */
function perRowDispatch(ctx: any): { index: number; scope: Record<string, unknown> } | null {
  const d = ctx?.dispatch;
  return d?.mode === 'per-row' && d.scope ? { index: d.index, scope: d.scope } : null;
}

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
  /** Memoized read of this deployment's `adr-0104-file-references` migration
   * flag (#3617) — the gate on tombstoning released files. Optional: an
   * engine without it (an older engine, a test fake) reads as "not verified",
   * so release stays tombstone-free. Fail closed, never open. */
  isFileReferencesMigrationVerified?(): Promise<boolean>;
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

/**
 * Raised when a referenced file violates its field's declared `accept` /
 * `maxSize`. Fails the write: a stored value that breaks its own field's
 * declaration is the "declared but not enforced" state ADR-0104 removes.
 */
export class FileConstraintError extends Error {
  readonly code = 'ERR_FILE_CONSTRAINT';
  constructor(message: string) {
    super(message);
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

/** One field's definition, or undefined. */
function fieldDefOf(engine: FileReferenceEngine, objectName: string, field: string): any {
  return (engine.getObject(objectName) as any)?.fields?.[field];
}

/**
 * Does `mime` satisfy one `accept` entry? Accepts the same vocabulary the file
 * picker does: an exact MIME type, a `type/*` wildcard, or a `.ext` suffix
 * (matched against the file NAME, since a browser-supplied extension is what
 * the author is describing).
 */
function matchesAcceptEntry(entry: string, mime: string, name: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e === '*' || e === '*/*') return true;
  if (e.startsWith('.')) return name.toLowerCase().endsWith(e);
  if (e.endsWith('/*')) return mime.startsWith(e.slice(0, -1));
  return mime === e;
}

/**
 * Enforce a media field's declared `accept` / `maxSize` against the file the
 * record is about to reference.
 *
 * The upload widget checks both before uploading, but that check is a
 * convenience rather than a control — any caller talking to the API directly
 * bypasses it. Now that the platform owns the file, `sys_file` carries the
 * authoritative MIME type and byte size, so the constraint can be re-checked
 * where it actually binds. Throws {@link FileConstraintError}, failing the
 * write, because a stored value violating its own field's declaration is
 * exactly the "declared but not enforced" state ADR-0104 exists to remove.
 *
 * Only checks what the file actually reports: a `sys_file` row with no
 * `mime_type` cannot fail an `accept` test, and one with no `size` cannot fail
 * `maxSize`. Missing metadata is not evidence of a violation.
 */
function assertFileConstraints(
  fieldDef: any,
  field: string,
  file: Record<string, unknown>,
): void {
  const accept: unknown = fieldDef?.accept;
  const maxSize: unknown = fieldDef?.maxSize;

  if (typeof maxSize === 'number' && maxSize > 0 && typeof file.size === 'number') {
    if (file.size > maxSize) {
      throw new FileConstraintError(
        `File exceeds the maximum size declared for '${field}' ` +
          `(${file.size} bytes > ${maxSize} bytes)`,
      );
    }
  }

  if (Array.isArray(accept) && accept.length > 0) {
    const mime = typeof file.mime_type === 'string' ? file.mime_type.toLowerCase() : '';
    const name = typeof file.name === 'string' ? file.name : '';
    const hasExtension = name.includes('.');

    // An entry can only be judged against metadata the file actually reports:
    // a MIME entry needs a recorded MIME type, an extension entry needs a name
    // carrying an extension. Entries that cannot be evaluated are not failures
    // — rejecting on them would turn "we don't know" into "not permitted".
    const testable = accept.filter((e): e is string => {
      if (typeof e !== 'string' || !e.trim()) return false;
      return e.trim().startsWith('.') ? hasExtension : !!mime;
    });
    if (testable.length === 0) return;

    if (!testable.some((e) => matchesAcceptEntry(e, mime, name))) {
      throw new FileConstraintError(
        `File type '${mime || name}' is not permitted by the accept list declared for ` +
          `'${field}' (${accept.join(', ')})`,
      );
    }
  }
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
 * slot so it points at a fresh copy instead, and enforce each referenced
 * file's declared `accept` / `maxSize` on the way past. Runs in the BEFORE
 * hooks, where mutating `input.data` is what the driver goes on to persist —
 * so the record never transiently holds a reference it does not own, and never
 * persists one that violates its field's declaration.
 *
 * The constraint check rides here because this pass already loads every
 * referenced `sys_file` row; enforcing it anywhere else would mean a second
 * read of the same rows.
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

      // The file is real and about to be referenced by this field, so its
      // declared constraints bind now — before ownership, before any copy.
      assertFileConstraints(fieldDefOf(engine, object, field), field, row);

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
 * May a released file enter collection on this deployment? True only when the
 * engine attests the file-as-reference migration verified (#3617). Every way
 * of not knowing — no such engine method, a read failure — answers false and
 * keeps release tombstone-free: absent evidence is not permission. The engine
 * memoizes the underlying flag read (one query per process; a flag recorded
 * by a separate `os migrate` process is picked up on restart or via
 * `invalidateDataMigrationFlags()`).
 */
async function collectionOpen(engine: FileReferenceEngine): Promise<boolean> {
  if (typeof engine.isFileReferencesMigrationVerified !== 'function') return false;
  try {
    return (await engine.isFileReferencesMigrationVerified()) === true;
  } catch {
    return false;
  }
}

/**
 * Give up ownership of `rows` — the single seam through which a field-owned
 * file becomes unreferenced.
 *
 * On a deployment that has verified its file-as-reference migration
 * (`os migrate files-to-references --apply`, #3617), a released committed
 * file is also tombstoned — `status='deleted'` + `deleted_at` — which starts
 * the `sys_file` lifecycle's declared grace window and, at its end, hands the
 * row to the reap guard. That guard's sweep-time re-verify covers the
 * ownership columns for exactly this lineage, and the two halves shipped in
 * the same change (#3459 PR-5b) deliberately: tombstoning released files
 * while the guard still re-verified only `sys_attachment` — always empty for
 * a field file — would turn every release into a guaranteed byte delete
 * rather than a risky one. Do not separate them.
 *
 * On a deployment that has NOT verified (or where the engine cannot say),
 * this only clears the ownership columns and the file stays exactly as
 * retained as it was. A release the memoized flag read lets through after a
 * recorded regression still cannot delete anything: the guard re-reads the
 * flag fresh at sweep time and vetoes while the gate is closed.
 *
 * Only a `committed` file is tombstoned: `pending` rows already carry their
 * own never-completed reap policy, and re-tombstoning a `deleted` row would
 * reset its grace clock.
 */
async function releaseOwnership(
  engine: FileReferenceEngine,
  logger: FileReferenceLogger,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const collect = await collectionOpen(engine);
  for (const row of rows) {
    const id = row?.id;
    if (id == null) continue;
    const tombstone = collect && row.status === 'committed';
    try {
      const patch: Record<string, unknown> = { id, ref_object: null, ref_id: null, ref_field: null };
      if (tombstone) {
        patch.status = 'deleted';
        patch.deleted_at = new Date().toISOString();
      }
      await engine.update('sys_file', patch, { context: { ...SYSTEM_CTX } });
      logger.debug?.(
        `[storage] file reference: released ownership of sys_file ${String(id)}` +
          (tombstone ? ' (tombstoned — grace window started)' : ''),
      );
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
      // A multi-update writing a file id would give the same id to every
      // matched record; only a single-record update can own one. Copy-on-claim
      // needs a definite owner, so skip — `claimFile` then refuses to steal.
      //
      // [#6966] "Is this a multi-update?" is the engine's marker, not the shape
      // of `input.id`. A per-row context names ITS row, so the old
      // `ids.length === 1` test answered "single update" on every row of a
      // batch — and then ran N times over ONE batch-scoped payload, aiming a
      // row-conditioned rewrite at a shared SET clause, which ADR-0058
      // Addendum II D3 names as out of contract. Both halves are fixed by
      // asking the right question once: rows after the first have nothing left
      // to do, because the payload they would inspect is the same object the
      // first row already reconciled.
      const perRow = perRowDispatch(ctx);
      if (perRow && perRow.index !== 0) return;
      const ids = perRow ? null : asIdList(ctx?.input?.id);
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
      // [#6966] Deliberately NOT switched to the dispatch marker, unlike its
      // `beforeUpdate` twin. This test no longer means what its old comment
      // ("see beforeUpdate — no definite owner") said — since #5038 a predicate
      // write's `afterUpdate` fires per row with one bound id, so this passes
      // per row instead of skipping — but the reconciliation it now performs is
      // the SAFER of the two outcomes, and restoring the skip would regress:
      // the first row claims the copy `beforeUpdate` made, later rows leave it
      // alone (`claimFile` never steals, it warns), whereas skipping would
      // leave that copy owned by NOBODY while N records still reference it —
      // exactly the unreferenced-but-referenced state the sweep may collect.
      //
      // What is genuinely wrong here is older and wider than this card: a
      // predicate update writing a file field gives N records one file id under
      // an EXCLUSIVE-ownership model, so N−1 of them end up referencing bytes
      // they do not own whichever branch is taken. That is a service-storage
      // defect in its own right, filed separately rather than smuggled into a
      // dispatch-contract change.
      if (!ids || ids.length !== 1) return;
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

  // ── beforeDelete: collect the batch's ids for a predicate delete ──
  //
  // A delete keyed by id needs nothing here — `afterDelete` reads `input.id`.
  //
  // [#6966] A predicate delete used to need a QUERY here: the batch dispatched
  // once with no id, so the only way to learn which rows were about to die was
  // to re-run the caller's `where` before the write landed. It does not any
  // more. The engine has already matched the doomed set and hands it over one
  // row at a time (#5574), so this collects what it is given and issues no
  // query at all.
  //
  // What was here before was dead on every path: its guard was
  // `if (asIdList(ctx?.input?.id)) return;`, and a per-row context HAS an id,
  // so it returned before doing anything — and had it not, the stash it wrote
  // went onto a per-row context the `after` phase never sees.
  engine.registerHook(
    'beforeDelete',
    async (ctx: any) => {
      const object: string = ctx?.object;
      if (!object) return;
      if (activeFileFields(engine, object).length === 0) return;
      const perRow = perRowDispatch(ctx);
      if (!perRow) return; // single-id delete — afterDelete reads it directly
      const rowIds = asIdList(ctx?.input?.id);
      if (!rowIds) return;
      const collected = (perRow.scope[STASH_KEY] ??= []) as Array<string | number>;
      for (const rowId of rowIds) collected.push(rowId);
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
      // [#6966] One release pass per WRITE, not per row. A predicate delete
      // fires this per matched row (#5038); releasing on each of them meant N
      // `sys_file` queries of one id apiece, where the whole batch fits in one
      // `$in`. The first row's dispatch does the work for all of them, because
      // by then `beforeDelete` has collected every id onto the shared scope.
      //
      // The fallback is not decoration: it covers a per-row dispatch whose
      // `beforeDelete` never ran (this object gained file fields between the
      // two phases is impossible, but a directly-invoked handler in a test has
      // no `before` half) and it keeps the answer per row rather than empty.
      const perRow = perRowDispatch(ctx);
      if (perRow && perRow.index !== 0) return;
      const collected = perRow && Array.isArray(perRow.scope[STASH_KEY])
        ? (perRow.scope[STASH_KEY] as Array<string | number>)
        : null;
      const ids = (collected?.length ? collected : null) ?? asIdList(ctx?.input?.id);
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
