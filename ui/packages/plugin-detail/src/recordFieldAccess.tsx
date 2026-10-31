/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record a detail body edits in place answers its own field locks
 * (objectstack#27146, the residual of objectstack#26594 ruling B).
 *
 * `DetailSection` and `HeaderHighlight` ask a field's in-place edit of the
 * `recordEdit` row (`resolveFieldAffordance`), which reads `usePermissions()`.
 * Under the page's provider alone that is `/auth/me/permissions`' answer, which
 * holds no row: a field permission whose `when` names only some rows is served
 * there as its lock, and the field was disabled on every row, the draft the
 * server lets the caller write included. Below `RecordFieldAccessScope`
 * (`@object-ui/permissions`) the same call answers from the server's
 * projection for THIS stored row (`DataSource.getRecordFieldAccess`, the
 * `GET /data/{object}/{id}/field-access` route) — the one source the record
 * form's edit dialog asks. Nothing here evaluates a `when`.
 *
 * Mounted by the two record blocks that edit the page's record in place,
 * `record:details` and `record:highlights`, around their bodies only. They are
 * sibling blocks of the page schema with no ancestor in this package, and a
 * mount above them (the page host) would also cover the page's action dialogs
 * and related lists, where a form editing ANOTHER row of the same object would
 * read this row's answer until its own arrives. So each block asks for itself:
 * a page drawing both asks twice.
 *
 * It asks only when the block's in-place edit is on: the page's inline-edit
 * session may edit (`canEdit`), the block offers it (`enabled`), the record is
 * stored (an id) and the data source carries the method. Otherwise the
 * row-blind answer stands, as it does for a non-ObjectStack backend.
 *
 * The answer belongs to the stored row, so it is asked again whenever the row
 * may have moved: a write the data source reports for this record (the inline
 * save bar's included) and a change on the data-invalidation bus for it (the
 * signal the page re-reads its record on). These are the triggers
 * `RecordFieldAccessForForm` (`@object-ui/plugin-form`) holds; that wrapper is
 * not exported and this package does not depend on that one, so the few lines
 * are repeated here rather than published as a new entry of either package.
 */

import React, { useEffect, useState } from 'react';
import { RecordFieldAccessScope } from '@object-ui/permissions';
import { dataChangeMatches, subscribeDataChanges, useDataInvalidation, useInlineEdit } from '@object-ui/react';
import type { DataSource, RecordFieldAccess } from '@object-ui/types';

/**
 * objectstack#27627 — field projections the record page's ONE read
 * (`DataSource.getRecordPage`) answered, by object and record. The blocks'
 * first ask of a record (revision 0) reads them instead of the data source; a
 * data change on the record drops its entry (the bus's own matching rule), and
 * every later ask (a write or a change raised the revision) goes to the server.
 */
const seededFieldAccess = new Map<string, Promise<RecordFieldAccess | null>>();

subscribeDataChanges((change) => {
  for (const key of Array.from(seededFieldAccess.keys())) {
    const [object, recordId] = JSON.parse(key) as [string, string];
    if (dataChangeMatches(change, object, recordId)) seededFieldAccess.delete(key);
  }
});

/**
 * Hand the in-place edit blocks the field projection the record page's payload
 * carries: what `getRecordFieldAccess` answers (`null` for no answer).
 */
export function seedRecordFieldAccess(
  objectName: string,
  recordId: string,
  access: Promise<RecordFieldAccess | null>,
): void {
  access.catch(() => undefined);
  seededFieldAccess.set(JSON.stringify([objectName, recordId]), access);
}

/** Test seam — forgets every seeded field projection. */
export function __clearSeededFieldAccess(): void {
  seededFieldAccess.clear();
}

export interface RecordFieldAccessForRecordProps {
  objectName?: string | null;
  recordId?: string | number | null;
  dataSource?: DataSource | null;
  /** Whether the block draws in-place editors at all. Defaults to `true`. */
  enabled?: boolean;
  children: React.ReactNode;
}

export function RecordFieldAccessForRecord({
  objectName,
  recordId,
  dataSource,
  enabled = true,
  children,
}: RecordFieldAccessForRecordProps) {
  const inline = useInlineEdit();
  const load = dataSource?.getRecordFieldAccess;
  const asks = enabled
    && !!inline?.canEdit
    && !!objectName
    && recordId !== undefined && recordId !== null && recordId !== ''
    && typeof load === 'function';
  const id = asks ? String(recordId) : undefined;
  const busRevision = useDataInvalidation(asks ? (objectName as string) : undefined, id);
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
  if (!asks) {
    return <>{children}</>;
  }
  return (
    <RecordFieldAccessScope
      object={objectName as string}
      recordId={id as string}
      load={(object, recordKey) =>
        (busRevision + writeRevision === 0 ? seededFieldAccess.get(JSON.stringify([object, recordKey])) : undefined)
        ?? (load as NonNullable<typeof load>).call(dataSource, object, recordKey)}
      revision={busRevision + writeRevision}
    >
      {children}
    </RecordFieldAccessScope>
  );
}
