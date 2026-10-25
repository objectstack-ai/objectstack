/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which list views reached this console already translated (objectui#11295,
 * objectui#11336).
 *
 * ## Why a view label needs to know where it came from
 *
 * An object's switcher tabs, and the breadcrumb that names the open one, draw
 * views from three reads that the console merges into `objectDef.listViews`
 * (`MetadataProvider.mergeViewsIntoObjects`) and the overlay rows beside them:
 *
 *  - the `/meta/view` documents — view items, view overlays and saved views.
 *    The server translates every one of them for the request's locale
 *    (`translateView` in `@objectstack/spec`), and since objectstack#20731 it
 *    keeps a published edit over the packaged catalog: an explicit override
 *    beats the packaged default;
 *  - the `listViews` an OBJECT document embeds, read from `/meta/object`. Since
 *    objectstack#21072 (`@objectstack/spec` 17.6.0) the server's
 *    `translateObject` translates those too: from the same catalog address,
 *    `objects.<object>._views.<key>.label` with `<key>` the entry's record
 *    key, and by the same rule, a published edit kept over the packaged
 *    catalog;
 *  - entries the client derives itself — a stack container's expansion, the
 *    "all records" fallback tab — which no server translated.
 *
 * Running the client bundle over a served label is a SECOND translation pass:
 * the served label became the bundle's fallback, the bundle entry won it, and a
 * published edit drew as the packaged string (measured on objectstack#20730:
 * `进行中` on the zh-CN tab and breadcrumb over a served `In Progress
 * (edited-20730)`). Dropping the pass for every view would instead leave the
 * third kind untranslated. So the label sites ask, per view, the one question
 * that tells them apart: did a server read serve this view under its identity?
 *
 * ## The signal
 *
 * Two reads answer it, both out of `MetadataProvider`'s cache — the same
 * requests every merged view came from — and both by identity only: ⛔ no label
 * text is compared with anything.
 *
 *  - the `view` cache the `/meta/view` read fills, by the view's `name`, which
 *    is the tab id for every served view document;
 *  - the `object` cache the `/meta/object` read fills, as served: by the
 *    object's `name`, then the tab id as a key of that document's own
 *    `listViews`. It is read BEFORE the merge, because the merged `listViews`
 *    the label sites hold mixes the document's own entries with view documents
 *    and a container's expansion, and only the former were translated by
 *    `translateObject`. Only the canonical `listViews` key is read: the server
 *    translates no other spelling, so a view a stored document still embeds
 *    under the legacy `list_views` arrives untranslated and keeps the bundle.
 *
 * Outside a `MetadataProvider` both reads are empty, so every view keeps the
 * bundle composition it had before.
 */

import { useMetadata } from '@object-ui/react';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { navigationNames } from '../console/appObjectScope.js';

/** One identity for "nothing was served", so a dependency list on it holds. */
const NONE_SERVED: readonly unknown[] = Object.freeze([]);

/**
 * What the two serving reads returned, as the metadata cache holds them: the
 * `/meta/view` documents and the `/meta/object` documents.
 */
type ServedViewReads = {
  readonly views: readonly unknown[];
  readonly objects: readonly unknown[];
};

/**
 * One record per pair of read payloads, held OUTSIDE React (AGENTS.md #10):
 * its identity is a function of the two arrays the cache handed out, never of a
 * memo React may discard, so a dependency list on it holds until either read is
 * refetched.
 */
const READS_BY_PAYLOAD = new WeakMap<readonly unknown[], WeakMap<readonly unknown[], ServedViewReads>>();

function servedViewReads(views: readonly unknown[], objects: readonly unknown[]): ServedViewReads {
  let byObjects = READS_BY_PAYLOAD.get(views);
  if (!byObjects) {
    byObjects = new WeakMap();
    READS_BY_PAYLOAD.set(views, byObjects);
  }
  let reads = byObjects.get(objects);
  if (!reads) {
    reads = Object.freeze({ views, objects });
    byObjects.set(objects, reads);
  }
  return reads;
}

/**
 * The cache's own array for a read — the PAYLOAD — or {@link NONE_SERVED} when
 * it is empty: the no-provider fallback hands out a fresh `[]` per call, which
 * would re-key every memo on it on every render.
 */
function payloadOf(items: unknown): readonly unknown[] {
  return Array.isArray(items) && items.length > 0 ? items : NONE_SERVED;
}

/**
 * The documents the `/meta/view` and `/meta/object` reads served, as the
 * metadata cache holds them.
 *
 * Keyed on the cache's own arrays, so it keeps one identity until either read
 * is refetched, and a consumer may key a memo on it (AGENTS.md #10).
 */
export function useServedViewItems(): ServedViewReads {
  const metadata = useMetadata();
  // objectui#12811 — inside an app whose served item names its package, and
  // while nothing has asked for the whole registry, the served object
  // documents are the app's object scope's, as served (the route's object is
  // in it: `AppContent` names it). Reading `getItemsByType('object')` here
  // loaded the whole registry on every open of an object list.
  //
  // objectui#12980 — inside an app whose served item names NO package, on the
  // same condition, the served object documents are the names-only scope's:
  // the objects the app's route asked for by name (`AppContent` names the
  // objects the app's entries require, and a page route the objects its page
  // binds). Its handle is the app's `requiresObject` names, which `AppContent`
  // asks on every scoped route, so this read asks nothing new. An app that
  // names none reads nothing, as `readPageObjectScope` reads nothing for a
  // page that binds no object. Such an app reads the whole registry on an
  // object route anyway (`appObjectScope.ts`), so the condition is false
  // there and the label sites keep the whole list.
  const { app } = useExpressionContext();
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  const scoped = !!metadata.readObjectScope && metadata.getTypeStatus?.('object') === 'idle';
  let objects: unknown;
  if (scoped && packageId) {
    objects = metadata.readObjectScope!({ packageId }).served;
  } else if (scoped && isPackagelessApp(app)) {
    const names = navigationNames(app.navigation, (item) => item.requiresObject);
    objects = names.length > 0 ? metadata.readObjectScope!({ names }).served : NONE_SERVED;
  } else {
    objects = metadata.getItemsByType('object');
  }
  return servedViewReads(payloadOf(metadata.getItemsByType('view')), payloadOf(objects));
}

/**
 * An app item the console renders that names no package (an app created in
 * the console is stored bound to none, and served without `_packageId`).
 * Outside an app the expression context's `app` is empty: no name.
 */
function isPackagelessApp(app: Record<string, unknown> | undefined): app is Record<string, unknown> {
  return typeof app?.name === 'string' && app.name !== '' && !(typeof app._packageId === 'string' && app._packageId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

/**
 * Whether a server read served the view `viewId` of the object `objectName` —
 * a `/meta/view` document under that name, or an entry under that key in the
 * served object document's own `listViews` — i.e. whether that view's label
 * arrived already translated, and is drawn as given.
 */
export function isServedView(
  served: ServedViewReads,
  objectName: string | undefined,
  viewId: string | undefined,
): boolean {
  if (!viewId) return false;
  if (served.views.some((item) => isRecord(item) && item.name === viewId)) return true;
  if (!objectName) return false;
  const doc = served.objects.find((item) => isRecord(item) && item.name === objectName);
  const embedded = isRecord(doc) ? doc.listViews : undefined;
  return (
    isRecord(embedded) &&
    Object.prototype.hasOwnProperty.call(embedded, viewId) &&
    isRecord(embedded[viewId])
  );
}
