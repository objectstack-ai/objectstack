// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SYS_FILE_REFERENCE_COLUMNS, SYS_FILE_STORAGE_OWNED_COLUMNS } from './objects/system-file.object.js';

/**
 * The create-side half of "the storage service owns `sys_file`'s lifecycle
 * columns": the storage-owned ones ({@link SYS_FILE_STORAGE_OWNED_COLUMNS})
 * and the file-reference ones ({@link SYS_FILE_REFERENCE_COLUMNS}). It also
 * records the row's uploader (`owner_id`), see "The uploader" below.
 *
 * The update side needs no code here: the columns are `readonly`, and the
 * engine's static readonly strip takes a non-system caller's value off an
 * UPDATE of any object, `sys_` included. On an INSERT the engine deliberately
 * leaves a `sys_` object's columns to the object's own guard
 * (`staticReadonlyInsertSubject` in `@objectstack/objectql`), so without this
 * hook a data-door create could still write a row that reads as an uploaded,
 * `committed` file with a `key`, `size` and `mime_type` of the caller's
 * choosing, which a file field would then claim.
 *
 * What a non-system create gets is what the update side gives it: the
 * caller's values for these columns are dropped, the rest of the row is
 * written, and the write is not refused. The row starts `pending` (the state
 * of every upload the service has not committed), so a file field refuses it
 * and the lifecycle's `pending` retention collects it. Every writer of these
 * columns is the storage service itself, under the system context, which this
 * hook does not judge: the upload doors (through `StorageMetadataStore`), the
 * field-file copy and backfill, and the attachment tombstone.
 *
 * The file-reference columns are owned the same way, by the file-reference
 * lifecycle, which alone records which record and field hold a file,
 * through its claim, release and copy, all under the system context. A
 * non-system create starts with none of them, as a fresh upload does.
 *
 * Judged as the update strip judges: every write whose context is not
 * `isSystem`, a context-less one included.
 *
 * ## The uploader
 *
 * A stored file's uploader is the user who created it, as an attachment's
 * (`sys_attachment.uploaded_by`) and a comment's (`sys_comment.author_id`)
 * author are. A non-system create records the session's user as `owner_id`,
 * over whatever the create carried, and a create whose session names no
 * signed-in user is refused with 403 `RECORD_NOT_ACCESSIBLE`: there is nobody
 * to record, and the client's value is never the answer. The column is
 * `readonly` (`objects/system-file.object.ts`), so on update the engine's strip
 * keeps this stamp for the row's life; a different uploader is recorded only
 * from the system context.
 *
 * The shape is the attachment create hook's (`attachment-access-hooks.ts`),
 * including its two exemptions: the system context keeps the value it
 * supplies (the upload doors record the session's user themselves, under it),
 * and so does a call with no session at all, a programmatic write on a bare
 * kernel with no principal to record. That second exemption covers the
 * uploader only. The lifecycle-owned columns above are still dropped from a
 * context-less create, because their strip judges every write that is not
 * `isSystem`, as the update strip does, and this rule does not loosen it.
 *
 * The stamp is silent, as the attachment hook's is. The engine reports a
 * dropped field (`droppedFields`, `onFieldsDropped`) only for the strips it
 * runs itself, and it runs none on a `sys_` object's create; the hook contract
 * declares no member through which a hook reports one.
 */

/** The slice of the data engine the guard installs on. */
export interface SysFileStorageOwnedColumnsEngine {
  registerHook(
    event: 'beforeInsert',
    handler: (ctx: any) => void | Promise<void>,
    options: { object: string; packageId?: string },
  ): void;
}

type GuardLogger = { warn: (message: string, meta?: Record<string, unknown>) => void };

const PACKAGE_ID = 'com.objectstack.service.storage';

/** The state a non-system create starts in: an upload the service has not committed. */
const NON_SYSTEM_CREATE_STATUS = 'pending';

/** Every column a non-system create may not set: the storage-owned ones, then the file-reference ones. */
const LIFECYCLE_OWNED_COLUMNS: readonly string[] = [...SYS_FILE_STORAGE_OWNED_COLUMNS, ...SYS_FILE_REFERENCE_COLUMNS];

/** The column that records who uploaded the file. */
const UPLOADER_COLUMN = 'owner_id';

/**
 * The wire code a non-system create whose session names no user is refused
 * with: the standard catalog member the attachment and comment create hooks
 * refuse theirs with (`NO_UPLOADER_DENY_CODE` in `attachment-access-hooks.ts`),
 * which REST answers 403.
 */
const NO_UPLOADER_DENY_CODE = 'RECORD_NOT_ACCESSIBLE';

function refuseNoUploader(): never {
  const err: Error & { code?: string; status?: number } = new Error(
    'Cannot create a file: there is no signed-in user to record as the uploader',
  );
  err.code = NO_UPLOADER_DENY_CODE;
  err.status = 403;
  throw err;
}

/**
 * Record the session's user as the uploader, over whatever the create carried,
 * or refuse the create when the session names no user (see "The uploader").
 */
function recordUploader(session: { userId?: unknown }, data: Record<string, unknown>): void {
  const uploaderId = session.userId;
  if (typeof uploaderId !== 'string' || uploaderId === '') refuseNoUploader();
  data[UPLOADER_COLUMN] = uploaderId;
}

/**
 * Drop the lifecycle-owned columns a non-system create supplied, and start the
 * row `pending`. Returns the names it dropped.
 */
function dropLifecycleOwnedColumns(data: Record<string, unknown>): string[] {
  const dropped: string[] = [];
  for (const column of LIFECYCLE_OWNED_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(data, column)) continue;
    delete data[column];
    dropped.push(column);
  }
  data.status = NON_SYSTEM_CREATE_STATUS;
  return dropped;
}

/** Install the create-side guard on `sys_file`. */
export function installSysFileStorageOwnedColumnsGuard(
  engine: SysFileStorageOwnedColumnsEngine,
  logger: GuardLogger,
): void {
  engine.registerHook(
    'beforeInsert',
    (ctx: any) => {
      if (ctx?.session?.isSystem) return;
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      // A context-less programmatic call (bare kernel) has nobody to record.
      if (ctx?.session) recordUploader(ctx.session, data as Record<string, unknown>);
      const dropped = dropLifecycleOwnedColumns(data as Record<string, unknown>);
      if (dropped.length === 0) return;
      logger.warn(
        `[storage] sys_file: dropped ${dropped.join(', ')} from a create that did not come from the storage service. ` +
          'These columns record what the storage backend holds and which record owns the file, ' +
          'and only the storage service writes them; ' +
          `the row was created ${NON_SYSTEM_CREATE_STATUS}. Upload files through the storage upload doors instead.`,
        { object: 'sys_file', operation: 'insert', fields: dropped, userId: ctx?.session?.userId ?? 'unknown' },
      );
    },
    { object: 'sys_file', packageId: PACKAGE_ID },
  );
}
