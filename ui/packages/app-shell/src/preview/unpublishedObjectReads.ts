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
 * says why. This wrapper reads exactly that answer, and only on the list read
 * (`find`) of the object asked for. Every other failure (a 403, a 500, a read
 * of some OTHER object) reaches the list unchanged, and outside the preview it
 * is never installed, so a missing object on the live console is still an
 * error.
 */

import { answeredLoadFailure } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

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
 * Every other member is the source's own, bound to it.
 */
export function withUnpublishedObjectReads(
  ds: DataSource,
  onUnpublished: (objectName: string) => void,
): DataSource {
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
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
