/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list grid's face for a `referenceVia` pointer pair (objectui#12608).
 *
 * `@objectstack/spec`'s `FieldSchema.referenceVia` declares a `text` field as
 * the id half of a two-column pointer pair: its value is a record id of the
 * object the sibling column names on the same row
 * (`sys_approval_request.record_id` with `referenceVia: 'object_name'`). The
 * rule that reads the pair is `resolveRecordPointer` in `@object-ui/fields`,
 * and the grid asks it per row, where the row is in hand; this module only
 * draws the pair it answers. There is no second resolver here.
 *
 * ## What the cell draws
 *
 * - `readable` — the target object's icon and the record's name, linking to
 *   the record through the host's record-URL builder (`recordHref` /
 *   `openRecord` on `RelatedRecordActionsContext`, the one lookup values link
 *   through). The name is `getRecordDisplayName`, the ADR-0079 ladder the
 *   record page's own title reads, over the row with the fields the viewer may
 *   not read removed. The raw record id is the tooltip.
 * - `unreadable` — the target object's label and "record unavailable", with the
 *   raw id as the tooltip; never the id alone. One rendering for every cause
 *   (deleted, outside the viewer's row set, definition unavailable, read
 *   failed): the platform answers a record outside the viewer's row set the
 *   same way it answers a deleted one, so a cell that told them apart would be
 *   an existence oracle (the rule `RecordPreviewCard` states for the details
 *   grid's face).
 * - `loading` — a placeholder bar, until both reads answer.
 *
 * ## Cost: one read per target object per tick, not one per row
 *
 * The details grid's face (`RecordPreviewCard`) reads its target with one
 * `findOne`; a list draws a page of such cells, so the list face batches. Every
 * cell that mounts in the same tick queues its id under its target object, and
 * one `find` per object then asks for all of them with an `id` `$in` filter.
 * The target object's definition is read once per object through
 * `getObjectSchema`. Both answers are cached per data source, so a re-render
 * or a second page that names a record already read costs nothing.
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import { Skeleton, resolveIcon } from '@object-ui/components';
import { extractRecords, getRecordDisplayName, withoutDeniedFields } from '@object-ui/core';
import type { RecordPointer } from '@object-ui/fields';
import { createSafeTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { useObjectLabel, useRelatedRecordActions } from '@object-ui/react';

/** The two reads the cell makes. Structural, so the console's adapter fits. */
export interface RecordPointerSource {
  find?: (objectName: string, params?: Record<string, unknown>) => Promise<unknown>;
  getObjectSchema?: (objectName: string) => Promise<unknown>;
}

type RecordAnswer =
  | { state: 'pending' }
  | { state: 'readable'; record: Record<string, unknown> }
  | { state: 'unreadable' };

type DefAnswer =
  | { state: 'pending' }
  | { state: 'ok'; def: ObjectDefLike }
  | { state: 'unavailable' };

interface ObjectDefLike {
  name?: string;
  label?: string;
  icon?: string;
  [key: string]: unknown;
}

/** Everything one data source has answered, and what it still owes. */
interface PointerStore {
  records: Map<string, RecordAnswer>;
  defs: Map<string, DefAnswer>;
  /** Ids queued for the next flush, per target object. */
  queued: Map<string, Set<string>>;
  flushScheduled: boolean;
  listeners: Set<() => void>;
  /** Bumped on every settled answer; what `useSyncExternalStore` compares. */
  version: number;
}

/**
 * The most ids one `find` asks for. A page is at most a few hundred rows, so
 * this only splits an unusually large page; the request carries `$top` equal
 * to its id count, so the server's default window never truncates it.
 */
const MAX_IDS_PER_READ = 200;

const stores = new WeakMap<object, PointerStore>();

function storeFor(source: object): PointerStore {
  let store = stores.get(source);
  if (!store) {
    store = { records: new Map(), defs: new Map(), queued: new Map(), flushScheduled: false, listeners: new Set(), version: 0 };
    stores.set(source, store);
  }
  return store;
}

function recordKey(objectName: string, recordId: string): string {
  return `${objectName}::${recordId}`;
}

function settle(store: PointerStore): void {
  store.version += 1;
  for (const listener of store.listeners) listener();
}

function readDef(source: RecordPointerSource, store: PointerStore, objectName: string): void {
  if (store.defs.has(objectName)) return;
  if (typeof source.getObjectSchema !== 'function') {
    store.defs.set(objectName, { state: 'unavailable' });
    return;
  }
  store.defs.set(objectName, { state: 'pending' });
  // The executor runs synchronously, so a source that THROWS lands in the same
  // branch as one that rejects.
  new Promise<unknown>((resolve) => resolve(source.getObjectSchema!(objectName))).then(
    (def) => {
      store.defs.set(
        objectName,
        def && typeof def === 'object' ? { state: 'ok', def: def as ObjectDefLike } : { state: 'unavailable' },
      );
      settle(store);
    },
    () => {
      store.defs.set(objectName, { state: 'unavailable' });
      settle(store);
    },
  );
}

function flush(source: RecordPointerSource, store: PointerStore): void {
  store.flushScheduled = false;
  const queued = Array.from(store.queued.entries());
  store.queued.clear();
  for (const [objectName, idSet] of queued) {
    const ids = Array.from(idSet);
    for (let start = 0; start < ids.length; start += MAX_IDS_PER_READ) {
      const chunk = ids.slice(start, start + MAX_IDS_PER_READ);
      const markAll = (answer: (id: string) => RecordAnswer) => {
        for (const id of chunk) store.records.set(recordKey(objectName, id), answer(id));
        settle(store);
      };
      if (typeof source.find !== 'function') {
        markAll(() => ({ state: 'unreadable' }));
        continue;
      }
      new Promise<unknown>((resolve) =>
        resolve(source.find!(objectName, { $filter: { id: { $in: chunk } }, $top: chunk.length })),
      ).then(
        (result) => {
          const byId = new Map<string, Record<string, unknown>>();
          for (const row of extractRecords(result) as Array<Record<string, unknown>>) {
            const id = row?.id ?? row?._id;
            if (id != null) byId.set(String(id), row);
          }
          // An id the read did not return is unreadable: deleted and not
          // visible are one answer (see the module header).
          markAll((id) => {
            const record = byId.get(id);
            return record ? { state: 'readable', record } : { state: 'unreadable' };
          });
        },
        () => markAll(() => ({ state: 'unreadable' })),
      );
    }
  }
}

/** Queue one target for the next batched read, unless it is already known. */
function requestRecord(source: RecordPointerSource, objectName: string, recordId: string): void {
  const store = storeFor(source);
  readDef(source, store, objectName);
  const key = recordKey(objectName, recordId);
  if (store.records.has(key)) return;
  store.records.set(key, { state: 'pending' });
  let ids = store.queued.get(objectName);
  if (!ids) {
    ids = new Set();
    store.queued.set(objectName, ids);
  }
  ids.add(recordId);
  if (!store.flushScheduled) {
    store.flushScheduled = true;
    // A macrotask, not a microtask: every cell of the page commits its effect
    // before the flush runs, so the page shares one read per object.
    setTimeout(() => flush(source, store), 0);
  }
}

const NO_SOURCE_STORE: PointerStore = {
  records: new Map(),
  defs: new Map(),
  queued: new Map(),
  flushScheduled: false,
  listeners: new Set(),
  version: 0,
};

function useStoreVersion(store: PointerStore): number {
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    () => store.version,
    () => store.version,
  );
}

const useRecordPointerTranslation = createSafeTranslation(
  { 'grid.recordUnavailable': '{{object}} · record unavailable' },
  'grid.recordUnavailable',
);

export interface RecordPointerCellProps {
  /** The pair `resolveRecordPointer` answered for this row. */
  pointer: RecordPointer;
  /** Where the target is read from: the grid's own data source. */
  dataSource?: RecordPointerSource | null;
}

/** Draws the record a pointer pair names: its icon and name, or "unavailable". */
export function RecordPointerCell({ pointer, dataSource }: RecordPointerCellProps): React.ReactElement {
  const { objectName, recordId } = pointer;
  const store = dataSource ? storeFor(dataSource) : NO_SOURCE_STORE;
  useStoreVersion(store);

  useEffect(() => {
    if (dataSource) requestRecord(dataSource, objectName, recordId);
  }, [dataSource, objectName, recordId]);

  const perms = usePermissions();
  const { objectLabel } = useObjectLabel();
  const { t } = useRecordPointerTranslation();
  const recordLinks = useRelatedRecordActions();

  const defAnswer: DefAnswer = dataSource ? store.defs.get(objectName) ?? { state: 'pending' } : { state: 'unavailable' };
  const recordAnswer: RecordAnswer = dataSource
    ? store.records.get(recordKey(objectName, recordId)) ?? { state: 'pending' }
    : { state: 'unreadable' };

  if (defAnswer.state === 'pending' || recordAnswer.state === 'pending') {
    return (
      <span data-record-pointer="loading" role="status" aria-busy="true" title={recordId} className="block">
        <Skeleton className="h-4 w-24" />
      </span>
    );
  }

  const def = defAnswer.state === 'ok' ? defAnswer.def : null;
  const typeLabel = objectLabel({ name: objectName, label: def?.label || objectName });
  const Icon = def?.icon ? resolveIcon(def.icon) : null;
  // The annotation the other `resolveIcon` seam call sites carry: it returns a
  // STABLE, cached component per icon name; it does not create one during
  // render. The rule cannot see that through a call.
  // eslint-disable-next-line react-hooks/static-components
  const icon = Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null;

  if (def && recordAnswer.state === 'readable') {
    const row = withoutDeniedFields(recordAnswer.record, perms, objectName);
    const name = getRecordDisplayName(def as Parameters<typeof getRecordDisplayName>[0], row);
    const href = recordLinks?.recordHref ? recordLinks.recordHref(objectName, recordId) : null;
    return (
      <span data-record-pointer="readable" className="flex min-w-0 items-center gap-1.5" title={recordId}>
        {icon}
        {href ? (
          <a
            href={href}
            className="min-w-0 truncate text-primary underline-offset-4 hover:underline"
            onClick={(e) => {
              // The row opens ITS own record on click; following the pointer
              // must not also do that.
              e.stopPropagation();
              // Modifier and non-primary clicks belong to the browser.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              if (!recordLinks?.openRecord) return;
              e.preventDefault();
              recordLinks.openRecord(objectName, recordId);
            }}
          >
            {name}
          </a>
        ) : (
          <span className="truncate">{name}</span>
        )}
      </span>
    );
  }

  // `unreadable`, or a record with no definition to name it by.
  const unavailable = String(t('grid.recordUnavailable', { object: typeLabel }));
  return (
    <span
      data-record-pointer="unreadable"
      className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
      title={recordId}
    >
      {icon}
      <span className="truncate italic">{unavailable}</span>
    </span>
  );
}
