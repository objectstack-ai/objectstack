/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record a form edits answers its own field locks (objectstack#26594).
 *
 * A form that edits a STORED record holds a row, so it can ask the server for
 * that row's field projection (`DataSource.getRecordFieldAccess`, the
 * `GET /data/{object}/{id}/field-access` route) instead of reading only the
 * row-blind `/auth/me/permissions` answer. The answer reaches every field gate
 * below — `gateFormFields`, `applyFieldPermissions` and the outbound
 * `fieldWriteGate`, in every layout — through `RecordFieldAccessScope`
 * (`@object-ui/permissions`), because each of them asks `usePermissions()` and
 * the scope answers there. Nothing in this module or below it evaluates a
 * field permission's `when`: the verdict is the server's write gate, judged on
 * the stored row.
 *
 * Mounted by the three containers a record form can be rendered through
 * directly — `ObjectForm` (whose layouts, master-detail header included, all
 * draw beneath it), `ModalForm` (the console's edit dialog) and `DrawerForm`.
 * A container rendered inside another for the same record reuses the outer
 * answer rather than asking again.
 *
 * Only an `edit` form with a record id asks. A create form holds no stored row,
 * a `view` form writes nothing, and a data source without the method (a
 * non-ObjectStack backend, a designer preview) keeps the row-blind answer.
 *
 * The answer belongs to the stored row, so it is asked again whenever that row
 * may have moved: a write the data source reports for this record (the form's
 * own save included) and a change on the data-invalidation bus for it (the
 * signal the form re-reads its record on). A save that moves the row into the
 * state a `when` names therefore locks the field again, rather than leaving
 * the earlier answer standing.
 *
 * The same answer carries the row's own verdict (objectstack#27138): on
 * `writable: false` the scope refuses every field of the record and the
 * record's update, so the form draws read-only, says why and offers no Save.
 * A host that reads a lock the projection leaves out — a pending approval
 * that locks the record — passes it as `lockedBy`, and it reaches the same
 * gates the same way. A form edits a stored record under that lock even on a
 * data source without the projection: the scope then has no answer to ask
 * for, and only the host's lock narrows the row.
 */

import React, { useEffect, useState } from 'react';
import { RecordFieldAccessScope } from '@object-ui/permissions';
import { useDataInvalidation } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

export interface RecordFieldAccessForFormProps {
  schema: { objectName?: string; mode?: string; recordId?: string | number | null };
  dataSource?: DataSource | null;
  /** A lock the host reads on the record and the projection leaves out (`RecordFieldAccessScope`'s `lockedBy`). */
  lockedBy?: 'approval';
  children: React.ReactNode;
}

const NO_PROJECTION = () => Promise.resolve(null);

export function RecordFieldAccessForForm({ schema, dataSource, lockedBy, children }: RecordFieldAccessForFormProps) {
  const objectName = schema?.objectName;
  const recordId = schema?.recordId;
  const load = dataSource?.getRecordFieldAccess;
  const editsStored = schema?.mode === 'edit'
    && !!objectName
    && recordId !== undefined && recordId !== null && recordId !== '';
  const asks = editsStored && typeof load === 'function';
  const scopes = asks || (editsStored && !!lockedBy);
  const id = asks ? String(recordId) : undefined;
  const busRevision = useDataInvalidation(asks ? objectName : undefined, id);
  const [writeRevision, setWriteRevision] = useState(0);
  useEffect(() => {
    if (!asks || typeof dataSource?.onMutation !== 'function') return;
    const object = (objectName as string).toLowerCase();
    return dataSource.onMutation((event) => {
      if ((event?.resource ?? '').toLowerCase() !== object) return;
      if (event.id != null && String(event.id) !== id) return;
      setWriteRevision((n) => n + 1);
    });
  }, [asks, dataSource, objectName, id]);
  if (!scopes) {
    return <>{children}</>;
  }
  return (
    <RecordFieldAccessScope
      object={objectName as string}
      recordId={String(recordId)}
      load={asks
        ? (object, recordKey) => (load as NonNullable<typeof load>).call(dataSource, object, recordKey)
        : NO_PROJECTION}
      revision={busRevision + writeRevision}
      lockedBy={lockedBy}
    >
      {children}
    </RecordFieldAccessScope>
  );
}
