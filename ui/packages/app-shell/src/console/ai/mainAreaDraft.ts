/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34610 — the app draft is the console's MAIN AREA, not a pane
 * beside the chat.
 *
 * The build runs in the right-side drawer (objectstack#34608). What it drafts
 * shows in the page the drawer sits beside: the main shell opens the app with
 * `?preview=draft` (ADR-0037's preview mode, `PreviewModeContext`), so the
 * draft bar, the app's own navigation and its renderers are the real ones.
 * The nested iframe preview (`LiveCanvas`) is gone; ADR-0037's Decision is
 * amended under objectstack#34608 (ADR-0057 Amendment A3).
 *
 * This module answers WHERE the main area goes for a draft, from where it is
 * now. It never refreshes anything: the chat host announces each drafted
 * artifact on the assistant bus (`emitCanvasInvalidate`), and the main tree,
 * already in preview mode, refetches that type in place.
 */

import { isPreviewSearch, PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE } from '../../preview/PreviewModeContext.js';

/** What the main area should show for a draft the chat produced. */
export interface MainAreaDraftTarget {
  /** The app's route segment: its package id (ADR-0048). */
  segment: string;
  /**
   * A surface under the app to open instead of the page the main area is on
   * (`draftPreviewPath`'s answer, `/apps/<segment>/…?preview=draft`): a draft
   * card's Preview names the page, view or object it drafted.
   */
  path?: string;
  /**
   * ADR-0045: the build was materialized — real tables and rows, app unlisted.
   * The main area then shows the real app (no draft overlay); the shell's
   * unpublished-app bar narrates that state.
   */
  materialized?: boolean;
}

/** The main area's current address, as the router reports it. */
export interface MainAreaLocation {
  pathname: string;
  search: string;
  hash: string;
}

/** Where the main area goes for a target: the address, and whether it is a new history entry. */
export interface MainAreaMove {
  to: string;
  /** True when only the query changes on the same page (enter draft mode in place). */
  replace: boolean;
  /** True when this move leaves draft preview (a materialized build on a previewed page). */
  leavesPreview: boolean;
}

/** `/apps/<segment>` and everything under it. */
function isUnderApp(pathname: string, segment: string): boolean {
  const base = `/apps/${encodeURIComponent(segment)}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Pure: where the main area goes for `target`, from `here`.
 *
 * - `inPlace` — the page the drawer sits beside is already the target's app
 *   (the console app whose package the build is bound to). Then the main area
 *   stays on its page and only enters draft mode: editing an app shows the
 *   change where the user is looking.
 * - Otherwise the target's own surface (`path`), else the app's landing.
 *
 * Null when the main area already shows it — nothing to navigate, and the
 * bus refresh alone brings the change in.
 */
export function mainAreaDraftMove(
  target: MainAreaDraftTarget,
  here: MainAreaLocation,
  inPlace: boolean,
): MainAreaMove | null {
  const stay = !target.path && (inPlace || isUnderApp(here.pathname, target.segment));
  let pathname: string;
  let params: URLSearchParams;
  if (stay) {
    pathname = here.pathname;
    params = new URLSearchParams(here.search);
  } else {
    const [path, query = ''] = (target.path ?? `/apps/${encodeURIComponent(target.segment)}`).split('?');
    pathname = path;
    params = new URLSearchParams(query);
  }
  if (target.materialized) params.delete(PREVIEW_QUERY_FLAG);
  else params.set(PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE);
  const qs = params.toString();
  const search = qs ? `?${qs}` : '';
  const hash = pathname === here.pathname ? here.hash : '';
  if (pathname === here.pathname && search === here.search) return null;
  return {
    to: `${pathname}${search}${hash}`,
    replace: pathname === here.pathname,
    leavesPreview: Boolean(target.materialized) && isPreviewSearch(here.search),
  };
}
