/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32984 — a list read in the draft preview of an object that has
 * never been published.
 *
 * The draft preview (`?preview=draft`, the AI build chat's Live Canvas) draws
 * an app from the DRAFT metadata overlay, so an object the build only drafted
 * has a list page there. Its records do not exist yet: the object is not
 * registered with the data engine until its first publish, and the record read
 * answers `404 OBJECT_NOT_FOUND`. The list showed that verbatim (「无法加载记录 ·
 * Object 'b6bl_customer' is not registered · OBJECT_NOT_FOUND」) right under the
 * preview bar promising that sample data appears once you publish.
 *
 * In the preview that answer is not a fault: an unpublished object holds no
 * records, which is the empty list the page should draw, with a sentence that
 * says why. This wrapper reads exactly that answer, and only on a list read
 * (`find`): any object the engine has not registered, through this source,
 * answers an empty page (a lookup into another drafted object included), and
 * reports its name, so only the listed object's own empty state carries the
 * publish sentence. Every other failure (a 403, a 500, a refused `findOne`)
 * reaches the list unchanged, and outside the preview it is never installed,
 * so a missing object on the live console is still an error.
 *
 * objectstack#34807 (ruling 6946403206) — a list column on a field that exists
 * only in the draft. The data door validates every `$select`, `$filter` and
 * `$orderby` name against the PUBLISHED object, so a draft-only column refused
 * the whole list query (`400 INVALID_FIELD`), and the list read its object
 * definition from the adapter's published `getObjectSchema`, which does not
 * know the field at all. Given the provider's overlay read, this wrapper's
 * `getObjectSchema` answers {@link readDraftPreviewObjectSchema}: the
 * published document plus each draft-only field with its draft label, marked
 * `_draftOnly` (the form half's convention, `utils/previewFormDataSource.ts`),
 * with the published sortability projection kept. `@object-ui/plugin-list`
 * reads the marker and keeps those names out of every data request, drawing
 * the column empty under its draft label. The data contract is unchanged:
 * data reads never see a draft schema.
 */

import { useRef } from 'react';
import { answeredLoadFailure } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';
import { readDraftPreviewObjectSchema } from '../utils/previewFormDataSource.js';
import { usePreviewDrafts } from './PreviewModeContext.js';

/** The data engine's answer for an object it has not registered. */
export const UNPUBLISHED_OBJECT_CODE = 'OBJECT_NOT_FOUND';

/** Did this failed read say the object is not registered (never published)? */
export function isUnpublishedObjectRefusal(err: unknown): boolean {
  return answeredLoadFailure(err)?.code === UNPUBLISHED_OBJECT_CODE;
}

/**
 * `ds`, except that a `find` the data engine refuses with
 * {@link UNPUBLISHED_OBJECT_CODE} answers an empty page and reports the
 * object through `onUnpublished`, so the caller can say why the list is empty.
 * Given `readOverlay` (the draft overlay's read of one object document),
 * `getObjectSchema` answers {@link readDraftPreviewObjectSchema} over the
 * source's own published read. Every other member is the source's own, bound
 * to it.
 */
export function withUnpublishedObjectReads(
  ds: DataSource,
  onUnpublished: (objectName: string) => void,
  readOverlay?: (objectName: string) => Promise<unknown>,
): DataSource {
  const getObjectSchema = readOverlay && typeof ds.getObjectSchema === 'function'
    ? (objectName: string) => readDraftPreviewObjectSchema(ds, readOverlay, objectName)
    : undefined;
  return new Proxy(ds, {
    get(target, prop, receiver) {
      if (prop === 'find') {
        return async (resource: string, params?: Parameters<DataSource['find']>[1]) => {
          try {
            return await target.find(resource, params);
          } catch (err) {
            if (!isUnpublishedObjectRefusal(err)) throw err;
            onUnpublished(resource);
            return { data: [], total: 0 };
          }
        };
      }
      if (prop === 'getObjectSchema' && getObjectSchema) return getObjectSchema;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const IGNORE_UNPUBLISHED = (): void => {};

/**
 * The data source a list page hands `ListView`: `ds` itself outside draft
 * preview; inside it, {@link withUnpublishedObjectReads} over `ds`, reading
 * draft-only fields through the provider's overlay (`useMetadata().getItem`,
 * which reads through the preview client in preview).
 *
 * `revision` is the page's own draft-aware definition of the object (the
 * provider's `objects` entry): a new one means the draft changed, and only
 * then is a new wrapper made, so the list re-reads its definition when a
 * field is drafted and otherwise keeps one data source identity. A page with
 * no publish sentence of its own passes no `onUnpublished`.
 */
export function usePreviewListDataSource<T extends DataSource | null | undefined>(
  ds: T,
  revision?: unknown,
  onUnpublished: (objectName: string) => void = IGNORE_UNPUBLISHED,
): T {
  const previewDrafts = usePreviewDrafts();
  const { getItem } = useMetadata();
  // Read at call time, so neither callback's identity decides the wrapper's.
  const getItemRef = useRef(getItem);
  getItemRef.current = getItem;
  const unpublishedRef = useRef(onUnpublished);
  unpublishedRef.current = onUnpublished;
  // Cached on the inputs the wrapper is made of (the source and the payload
  // `revision`), not on a memo's identity (ui/AGENTS.md #10).
  const cache = useRef<{ ds: DataSource; revision: unknown; wrapped: DataSource } | null>(null);
  if (!previewDrafts || !ds) return ds;
  const held = cache.current;
  if (held && held.ds === ds && held.revision === revision) return held.wrapped as T;
  const wrapped = withUnpublishedObjectReads(
    ds,
    (name) => unpublishedRef.current(name),
    (name) => getItemRef.current('object', name),
  );
  cache.current = { ds, revision, wrapped };
  return wrapped as T;
}
