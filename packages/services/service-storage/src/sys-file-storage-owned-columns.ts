// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SYS_FILE_STORAGE_OWNED_COLUMNS } from './objects/system-file.object.js';

/**
 * The create-side half of "the storage service owns `sys_file`'s lifecycle
 * columns" ({@link SYS_FILE_STORAGE_OWNED_COLUMNS}).
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
 * Judged as the update strip judges: every write whose context is not
 * `isSystem`, a context-less one included.
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

/**
 * Drop the storage-owned columns a non-system create supplied, and start the
 * row `pending`. Returns the names it dropped. Exported for the guard's pin.
 */
export function dropStorageOwnedColumns(data: Record<string, unknown>): string[] {
  const dropped: string[] = [];
  for (const column of SYS_FILE_STORAGE_OWNED_COLUMNS) {
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
      const dropped = dropStorageOwnedColumns(data as Record<string, unknown>);
      if (dropped.length === 0) return;
      logger.warn(
        `[storage] sys_file: dropped ${dropped.join(', ')} from a create that did not come from the storage service. ` +
          'These columns record what the storage backend holds, and only the storage service writes them; ' +
          `the row was created ${NON_SYSTEM_CREATE_STATUS}. Upload files through the storage upload doors instead.`,
        { object: 'sys_file', operation: 'insert', fields: dropped, userId: ctx?.session?.userId ?? 'unknown' },
      );
    },
    { object: 'sys_file', packageId: PACKAGE_ID },
  );
}
