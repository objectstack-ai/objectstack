/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  RelatedRecordActionsValue,
  RelatedRecordHandlers,
  ResolveRelatedRecordActionsInput,
} from '@object-ui/react';
import { documentHref } from './documentHref.js';

/** No related-list handlers — see {@link pageRecordActionsValue}. */
const NO_RELATED_HANDLERS: RelatedRecordHandlers = Object.freeze({});

/**
 * The page's handlers for one list, three cases by the input's shape.
 *
 *  - **An object-scoped list** (no `relationshipField`, no `parentId`: a page
 *    `list-view` node, `ListViewBlock`'s `resolve({ objectName })`) gets the
 *    bridge's create pair, `onCreate` / `createDisabled`, and nothing else
 *    (objectui#13089). Its `addRecord` Add button opens the record-form
 *    create the object list opens. `ResolveRelatedRecordActionsInput`
 *    declares what an input without `relationshipField` asks for.
 *  - **A related list with no parent in scope** (it names its
 *    `relationshipField`, but `parentId` is empty: no `parentDataSource`, or a
 *    bound row without a key) gets no handlers, as before. A "+ New" there
 *    would open a child form linked to no parent.
 *  - **A related list whose parent resolved** gets `onRowAction` /
 *    `onToolbarAction` from the bridge the record page mounts (objectui#12870)
 *    — the same closures, so an authored action runs through the same
 *    `ActionRunner` dispatch it runs through on a record page.
 *
 * Nothing else is served. The bridge's other members (Edit, Delete, row
 * click, "View all", New under a parent, and the child object's default
 * `rowActions` / `toolbarActions`) would change what a page list draws when
 * it authors none of them. The renderer draws an authored action only beside
 * its executor, so the executors alone are what an authored `actions` needs.
 */
function pageRelatedHandlers(
  related: RelatedRecordActionsValue | undefined,
  input: ResolveRelatedRecordActionsInput,
): RelatedRecordHandlers {
  if (!related) return NO_RELATED_HANDLERS;
  const hasParent = input.parentId != null && input.parentId !== '';
  if (!hasParent) {
    const relatedList = input.relationshipField != null && input.relationshipField !== '';
    if (relatedList) return NO_RELATED_HANDLERS;
    const { onCreate, createDisabled } = related.resolve(input);
    if (!onCreate) return NO_RELATED_HANDLERS;
    return { onCreate, ...(createDisabled ? { createDisabled } : {}) };
  }
  const { onRowAction, onToolbarAction } = related.resolve(input);
  if (!onRowAction && !onToolbarAction) return NO_RELATED_HANDLERS;
  return {
    ...(onRowAction ? { onRowAction } : {}),
    ...(onToolbarAction ? { onToolbarAction } : {}),
  };
}

/**
 * What a custom page publishes on `RelatedRecordActionsContext`
 * (objectui#11293): the console's record navigator, for the blocks placed on
 * the page.
 *
 * A block on a page is rendered with no host callback — the page is a
 * document, and a document carries no function. So an `object-kanban` or
 * `object-calendar` whose authored `navigation` resolves to `page` (the
 * spec's default `mode`) had nowhere to go: `useNavigationOverlay` hands such
 * a click to the record navigator its host publishes, and this host published
 * none. The record page and the object list page already publish one (the
 * record page's `RelatedRecordActionsBridge`, the list page's
 * `listRecordActionsValue`); this is the third surface, so a `page` click
 * resolves the same way wherever the block sits.
 *
 * Deliberate limits, on the model of `listRecordActionsValue`:
 *
 *  - **`resolve` serves a related list's action executors only under a
 *    parent (objectui#12870), and an object-scoped list its create pair only
 *    (objectui#13089).** A page has no parent record of its own; a
 *    `record:related_list` that bound one through `parentDataSource` has, and
 *    gets the record page's executor for its authored `actions`, from the
 *    bridge passed as `related` (see `pageRelatedHandlers`). A `list-view`
 *    node gets `onCreate` / `createDisabled` for its `addRecord`. A related
 *    list with no parent gets an empty handler set, which the context
 *    documents as "capability unavailable", the same read-only outcome a
 *    consumer gets with no provider at all.
 *  - **Only objects this console can route to.** `recordHref` answers `null`
 *    for an object outside the app's metadata, or outside an app route, and
 *    `openRecord` then does nothing — the shape of the record page's own
 *    builder, `/apps/:app/:object/record/:id`.
 *  - **`recordHref` is a document href; `openRecord` navigates by the router
 *    path (objectui#12233).** `routerRootHref` is the caller's `useHref('/')`,
 *    so the href carries the basename the console is mounted under and a new
 *    tab or a copied link reaches the record; `navigate` applies that basename
 *    itself, so it is handed the bare route. The join is `documentHref`, the
 *    record page's own.
 *  - **`listHref` / `openList` (objectui#12703)** answer the same way for an
 *    object's list: the object's list route, or one saved view's route when
 *    the caller names it, and `null` for an object this console cannot route
 *    to. They take an object and a view name only, so no caller can hand them
 *    a filter to encode.
 *
 * ⚠️ The same seam feeds the grid's link column and the lookup cells, so on a
 * page those now render as real anchors to the record they name, as they
 * already do on the record and list pages.
 *
 * Its own module so `PageView.tsx` exports components only; pinned by
 * `__tests__/PageView.recordNavigator-11293.test.tsx`, and its related-list
 * half by `__tests__/PageView.relatedListActions-12870.test.tsx`.
 */
export function pageRecordActionsValue(
  appName: string | undefined,
  objects: ReadonlyArray<unknown>,
  navigate: (to: string) => void,
  routerRootHref: string,
  related?: RelatedRecordActionsValue,
): RelatedRecordActionsValue {
  const routable = new Set(
    objects
      .map((o) => (o as { name?: unknown } | null | undefined)?.name)
      .filter((name): name is string => typeof name === 'string' && name !== ''),
  );
  const recordPath = (objectName: string, recordId: string | number): string | null =>
    appName && routable.has(objectName) && recordId != null && recordId !== ''
      ? `/apps/${appName}/${objectName}/record/${encodeURIComponent(String(recordId))}`
      : null;
  // objectui#12703 — the object's list route, or the route of one of its saved
  // views: `/apps/:app/:object` and `/apps/:app/:object/view/:view`, the shapes
  // the app navigation writes for an object and a view item. A view name is
  // passed as the block binding states it; `ObjectView` resolves the short and
  // the qualified spelling alike.
  const listPath = (objectName: string, viewName?: string): string | null => {
    if (!appName || !routable.has(objectName)) return null;
    const base = `/apps/${appName}/${objectName}`;
    return typeof viewName === 'string' && viewName !== ''
      ? `${base}/view/${encodeURIComponent(viewName)}`
      : base;
  };
  return {
    resolve: (input) => pageRelatedHandlers(related, input),
    recordHref: (objectName, recordId) => {
      const path = recordPath(objectName, recordId);
      return path === null ? null : documentHref(routerRootHref, path);
    },
    openRecord: (objectName, recordId) => {
      const path = recordPath(objectName, recordId);
      if (path) navigate(path);
    },
    listHref: (objectName, viewName) => {
      const path = listPath(objectName, viewName);
      return path === null ? null : documentHref(routerRootHref, path);
    },
    openList: (objectName, viewName) => {
      const path = listPath(objectName, viewName);
      if (path) navigate(path);
    },
  };
}
