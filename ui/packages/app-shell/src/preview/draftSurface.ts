/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12968 (objectstack#24324 ruling A, preview-first) — the one place
 * a draft and the console surface that shows it meet, in both directions:
 *
 *  - {@link draftPreviewPath}: drafted items → the router path of the
 *    affected surface, in draft preview (`?preview=draft`). The chat's
 *    Preview button opens it (`ChatbotEnhanced`'s `onPreviewDraft`).
 *  - {@link draftsOnSurface}: the route the draft preview shows → the pending
 *    drafts (`usePendingDrafts`' entries) that belong to it. The
 *    `DraftPreviewBar`'s pending line counts them.
 *
 * Neither direction spells a route. A path is built by `@object-ui/layout`'s
 * `resolveHref`, the console's one nav → URL mapping, from the nav entry that
 * would open the surface; a route is read by matching it against
 * `APP_ROUTE_METADATA_READS`, the table of every route `AppContent` declares.
 *
 * A view is a `<object>.<viewKey>` item and a field a `<object>.<field>` row:
 * the spec's qualified item names, whose prefix is the object
 * (`ViewItemNameSchema`). A field added to an existing object is drafted as the
 * object itself.
 */

import { matchRoutes } from 'react-router-dom';
import { resolveHref } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { APP_ROUTE_METADATA_READS } from '../console/appRouteMetadataReads.js';
import { PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE } from './PreviewModeContext.js';

/** A drafted item, as the chat lifts it and as `_drafts` lists it. */
export interface DraftItem {
  type: string;
  name: string;
}

/** The object a qualified `<object>.<key>` item name belongs to. */
function objectOf(qualifiedName: string): string | undefined {
  const dot = qualifiedName.indexOf('.');
  return dot > 0 ? qualifiedName.slice(0, dot) : undefined;
}

/**
 * The nav entry that opens a drafted item's surface, or `null` for an item
 * with none of its own (an app, a flow, a permission set …), which previews
 * as the app.
 */
function navEntryFor(item: DraftItem): NavigationItem | null {
  const id = `draft-preview:${item.type}:${item.name}`;
  switch (item.type) {
    case 'page':
      return { id, type: 'page', pageName: item.name };
    case 'dashboard':
      return { id, type: 'dashboard', dashboardName: item.name };
    case 'report':
      return { id, type: 'report', reportName: item.name };
    case 'view': {
      const objectName = objectOf(item.name);
      return objectName ? { id, type: 'object', objectName, viewName: item.name } : null;
    }
    case 'field': {
      const objectName = objectOf(item.name);
      return objectName ? { id, type: 'object', objectName } : null;
    }
    case 'object':
      return { id, type: 'object', objectName: item.name };
    default:
      return null;
  }
}

/**
 * Which drafted item a batch previews: the most specific surface first — a
 * page, dashboard or report, then a view, then the object a field or object
 * draft changed. A batch with none of them previews the app.
 */
const SURFACE_RANK: readonly string[] = ['page', 'dashboard', 'report', 'view', 'field', 'object'];

/**
 * The router path that previews `items` in the app routed at `appSegment`
 * (its package id, ADR-0048), always in draft preview:
 *
 *  - a page draft → that page;
 *  - a view draft → the object's list on that view;
 *  - a field or object draft → the object's default list;
 *  - an app draft, or a batch with no surface of its own → the app.
 */
export function draftPreviewPath(items: readonly DraftItem[], appSegment: string): string {
  const basePath = `/apps/${appSegment}`;
  let entry: NavigationItem | null = null;
  let rank = SURFACE_RANK.length;
  for (const item of items) {
    const at = SURFACE_RANK.indexOf(item.type);
    if (at < 0 || at >= rank) continue;
    const candidate = navEntryFor(item);
    if (candidate) {
      entry = candidate;
      rank = at;
    }
  }
  const href = entry ? resolveHref(entry, basePath).href : basePath;
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set(PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE);
  return `${path}?${params.toString()}`;
}

/** The surface a route under `/apps/:appName` shows, as its route params name it. */
export interface DraftSurface {
  objectName?: string;
  pageName?: string;
  dashboardName?: string;
  reportName?: string;
}

/**
 * The surface the route at `subPath` (the path below `/apps/:appName`) shows,
 * or `null` for a route that shows no single object, page, dashboard or report
 * (the app's landing, metadata admin, search …).
 */
export function draftSurfaceOf(subPath: string): DraftSurface | null {
  const matches = matchRoutes([...APP_ROUTE_METADATA_READS], `/${subPath.replace(/^\/+/, '')}`);
  const params = matches ? matches[matches.length - 1].params : {};
  const surface: DraftSurface = {};
  if (params.objectName) surface.objectName = params.objectName;
  if (params.pageName) surface.pageName = params.pageName;
  if (params.dashboardName) surface.dashboardName = params.dashboardName;
  if (params.reportName) surface.reportName = params.reportName;
  return Object.keys(surface).length > 0 ? surface : null;
}

/** The pending drafts that change what `surface` shows. */
export function draftsOnSurface<T extends DraftItem>(entries: readonly T[], surface: DraftSurface): T[] {
  return entries.filter((entry) => {
    switch (entry.type) {
      case 'object':
        return entry.name === surface.objectName;
      case 'view':
      case 'field':
        return surface.objectName !== undefined && objectOf(entry.name) === surface.objectName;
      case 'page':
        return entry.name === surface.pageName;
      case 'dashboard':
        return entry.name === surface.dashboardName;
      case 'report':
        return entry.name === surface.reportName;
      default:
        return false;
    }
  });
}
