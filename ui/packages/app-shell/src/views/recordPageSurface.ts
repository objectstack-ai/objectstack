/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36150 — where an authored record page applies.
 *
 * An object's authored full record page (`PageSchema` with `type: 'record'`,
 * `kind: 'full'`, picked by `usePageAssignment`) is drawn on the DESKTOP FULL
 * PAGE only. On a phone (the record page below `PHONE_BELOW_WIDTH`) and in
 * every embedded host (the right-side drawer a list opens, the split pane,
 * an interface page's preview) the record draws the platform's standard page,
 * built from the object's own metadata: its field groups and order, field
 * permissions and visibility, its `record_header` / `record_more` actions,
 * one tab per child table, the stage and the approval state. "Open full
 * page" from the drawer lands on the full page, so on the authored page.
 *
 * What does NOT apply off the full page is the layout and whatever lives only
 * on it: page-only blocks and related lists, page-declared tabs and sections,
 * and `record_section` actions, which the standard page does not draw (an
 * author who wants an action there too adds `record_more`).
 *
 * There is no switch an author can set to keep a page on the phone or in the
 * drawer. Two exceptions are the host's, named here and nowhere else:
 *
 * - The page NAMED in the URL (`/record/:id/page/:pageName`, print pages and
 *   other named routes) is not the object's assigned page: it is drawn
 *   wherever that route renders, or nothing is (objectui#12715). The drawer
 *   never reads a page name, so only the full-page route is concerned.
 * - {@link OBJECTS_KEEPING_AUTHORED_PAGE}, the platform pages that carry what
 *   has no place on the standard page yet.
 */

/**
 * Platform objects whose own record page is kept on the phone and in the
 * drawer (maintainer ruling 7066490078 on objectstack#36150). The key is the
 * object's name, as the ruling words it ("the user page"): ANY assigned full
 * page of these objects is kept everywhere, an app-scoped one included.
 *
 * - `sys_approval_request` — the page IS the decision (maintainer 2026-11-17,
 *   #34588: the request shows the submitted record whole): its approve,
 *   reject and reply actions are `record_section` ones, drawn only by
 *   `record:approval_decision`, and a request whose step requires a comment
 *   can be decided only there.
 * - `sys_user` — the Security tab (two-factor, backup codes, account deletion),
 *   effective access and the AI assistants tab have no object-level place, and
 *   the standard page would open one tab per lookup to `sys_user`. Held until
 *   an object can name its record page's tabs (objectstack#35897).
 */
export const OBJECTS_KEEPING_AUTHORED_PAGE: ReadonlySet<string> = new Set([
  'sys_approval_request',
  'sys_user',
]);

export interface RecordPageSurface {
  /** The view is embedded (drawer, split pane, interface preview). */
  embedded: boolean | undefined;
  /** The viewport is a phone's (`usePhoneViewport`). */
  phone: boolean;
  /** The object the record belongs to. */
  objectName: string | undefined | null;
  /** The page name the full-page route carries, if any. */
  requestedPageName: string | undefined | null;
}

/**
 * True when the object's assigned (authored, `kind: 'full'`) record page is
 * drawn on this surface; false when the standard page is drawn instead.
 * Slotted pages are not concerned: they already are the standard page with
 * their slots filled, on every surface. The record view and the record
 * route's object scope (`console/appObjectScope.ts`) both read it, so the
 * route reads the objects of the page the view draws.
 */
export function authoredRecordPageApplies(surface: RecordPageSurface): boolean {
  if (surface.requestedPageName) return true;
  if (surface.objectName && OBJECTS_KEEPING_AUTHORED_PAGE.has(surface.objectName)) return true;
  return !surface.embedded && !surface.phone;
}
