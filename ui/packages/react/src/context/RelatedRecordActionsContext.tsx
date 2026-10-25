/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RelatedRecordActionsContext — host-provided CRUD + action handlers for the
 * child collections ("related lists") rendered on a record DETAIL page.
 *
 * The `record:related_list` renderer (in `@object-ui/plugin-detail`) knows the
 * child object name, the FK back to the parent, and the parent id — but it
 * lives in a low-level package with no access to the console's SPA router, the
 * create/edit form routes, or the per-object CRUD affordances / permissions.
 * Those all live in the app shell.
 *
 * So the host (e.g. `RecordDetailView`) provides this context; the renderer
 * calls {@link RelatedRecordActionsValue.resolve} for its child object and
 * wires whatever handlers come back onto the `RelatedList` (New / Edit / Delete
 * / row-click-to-open, plus the child object's own row actions). A handler that
 * is OMITTED means the capability is unavailable (permission or lifecycle
 * affordance denied, or no host routing) — the related list simply hides that
 * affordance. When no provider is present at all (e.g. the Studio designer, or
 * a standalone embedded renderer) the related list stays read-only, which is
 * the correct graceful fallback.
 *
 * Since objectui#4336 the same host also publishes its record-URL builder
 * ({@link RelatedRecordActionsValue.recordHref} / `openRecord`) for any object
 * it can route to, so the low-level renderers on a record page can turn a
 * lookup VALUE into a link to the referenced record without assembling a URL
 * of their own. Same provider, same builder, one route shape.
 *
 * Since objectui#12703 it also publishes the object-list URL builder
 * ({@link RelatedRecordActionsValue.listHref} / `openList`), for a renderer
 * that shows a few of an object's records and links to the rest.
 */

import React, { createContext, useContext } from 'react';

/** A child-object action surfaced in a related list's row menu. */
export interface RelatedRowActionDef {
  /** Stable action name (matches the object's action metadata). */
  name: string;
  /** Display label (already localized by the host). */
  label?: string;
  /** Lucide icon name (kebab-case). */
  icon?: string;
  /** Visual emphasis for the menu item. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
  /** Confirmation prompt shown before the action runs. */
  confirmText?: string;
  /** Any remaining action metadata (target, params, …) is preserved. */
  [k: string]: unknown;
}

/**
 * CRUD + action handlers for a single related list's child object, resolved by
 * the host for a specific child object + parent relationship. Every handler is
 * optional: an omitted handler hides its affordance in the list.
 */
export interface RelatedRecordHandlers {
  /** Open the child record's detail page (查看详情). */
  onView?: (recordId: string | number, record?: unknown) => void;
  /**
   * Open a create form for a new child record. The host pre-links it to the
   * parent (via the relationship field + parent id passed to `resolve`), so no
   * argument is needed here (增).
   */
  onCreate?: () => void;
  /**
   * [#4646] Offer "+ New", but GREYED — the `userActions.create.disabledWhen`
   * verdict for the scope this toolbar sits in (the host parent record on a
   * record page's related list).
   *
   * A separate channel from omitting {@link onCreate} because hidden and
   * disabled are different answers, exactly as they are for the row Edit/Delete
   * predicates (objectui#2614) and for the record header's (objectui#4419 /
   * PR #4515): `visibleWhen` decides whether the affordance exists at all,
   * `disabledWhen` decides whether the existing affordance can be pressed. The
   * host still supplies `onCreate` in the disabled case, so the button keeps
   * its label and tooltip and the user can see that creating is a thing this
   * list does — just not right now.
   */
  createDisabled?: boolean;
  /** Open an edit form for an existing child record (改). */
  onEdit?: (recordId: string | number, record?: unknown) => void;
  /**
   * Delete a child record (删). Returns a promise so the list can refresh once
   * the deletion resolves.
   */
  onDelete?: (recordId: string | number, record?: unknown) => void | Promise<void>;
  /**
   * Child object row-level actions, localized: its `list_item` actions, and
   * its `record_related` ones when the list sits inside a parent record
   * (objectui#11270).
   */
  rowActions?: RelatedRowActionDef[];
  /** Execute one of {@link rowActions} against a specific child row. */
  onRowAction?: (action: RelatedRowActionDef, record: unknown) => void | Promise<void>;
  /**
   * Child object list-level actions (`locations: ['list_toolbar']`),
   * localized — rendered as header buttons on the related list (e.g.
   * `invite_user` on an organization's Invitations list). Same bridge
   * contract as {@link rowActions}, minus the row context.
   */
  toolbarActions?: RelatedRowActionDef[];
  /** Execute one of {@link toolbarActions} (no row context). */
  onToolbarAction?: (action: RelatedRowActionDef) => void | Promise<void>;
  /**
   * Open the child object's full list page, scoped to THIS parent on the
   * relationship `resolve` was handed (objectui#12741). The related list's
   * "View all" link calls it, unless the block declares `showViewAll: false`.
   *
   * The host builds the destination because only the host knows the console's
   * routes, as it does for {@link onView}. It omits the handler when no route
   * it has can show that scoped list, and the link is then not drawn. One case
   * is a multi-value relationship: the list route's URL filter has no
   * membership operator. Another is a relationship field the viewer cannot
   * read: the list route drops that condition and would show every row.
   */
  onViewAll?: () => void;
}

/**
 * Input to {@link RelatedRecordActionsValue.resolve}.
 *
 * Its SHAPE says which kind of list asks (objectui#13089):
 *
 *  - **A related list always names its `relationshipField`.** The spec's
 *    `record:related_list` declares it required, so a spec-valid related list
 *    resolves with it, with or without a resolved `parentId`.
 *  - **An input with no `relationshipField` (absent or empty) asks for an
 *    OBJECT-SCOPED list's handlers**, a list of the object's own records with
 *    no parent: a page `list-view` node resolves `{ objectName }` for its
 *    `addRecord` Add button. A host may serve such an input a create that
 *    links no parent, which it must not serve a related list whose parent did
 *    not resolve.
 *
 * ⚠️ The limit of reading the shape: a future consumer that resolves a list
 * with no parent and no relationship, and must NOT be offered a create, cannot
 * say so here. It needs an explicit member on this input, not a second reading
 * of the same shape.
 */
export interface ResolveRelatedRecordActionsInput {
  /** Child object machine name (the related list's `api`). */
  objectName: string;
  /** FK field on the child pointing back at the parent record. */
  relationshipField?: string;
  /** Primary-key value of the parent record (used to pre-link new children). */
  parentId?: string | number | null;
}

export interface RelatedRecordActionsValue {
  /**
   * Resolve the CRUD + action handlers for a child object. Implementations
   * should be stable (memoized) so consumers can safely depend on the returned
   * identity.
   */
  resolve: (input: ResolveRelatedRecordActionsInput) => RelatedRecordHandlers;
  /**
   * The host's record-detail URL for ANY object it can route to — the SAME
   * builder {@link RelatedRecordHandlers.onView} navigates with, published as
   * an href so a renderer can present the destination as a real anchor
   * (middle-click, "open in new tab", "copy link address") instead of a
   * click-only affordance.
   *
   * Added for objectui#4336: a lookup value is a reference to a record of a
   * DIFFERENT object, and the renderer that displays it (`LookupCellRenderer`,
   * shared by the detail body and the related list's cells) has no router and
   * no knowledge of the console's route shape. Route building stays here, in
   * the one place that already owns it — never re-derived renderer-side.
   *
   * Returns `null` when the host cannot route to that object (unknown object,
   * no app context), which consumers must render as the plain value.
   *
   * The value is a document href, read by the browser on "open in new tab" and
   * "copy link address", so it carries the host router's basename (for
   * example `/_console/apps/…`), while {@link openRecord} navigates by the
   * router path (objectui#12233).
   */
  recordHref?: (objectName: string, recordId: string | number) => string | null;
  /**
   * SPA-navigate to the destination {@link recordHref} addresses. Consumers
   * call this from a plain left click on the anchor so navigation stays
   * in-app; a modifier click is left to the browser and the href.
   */
  openRecord?: (objectName: string, recordId: string | number) => void;
  /**
   * The host's list-page URL for an object it can route to, optionally opened
   * on one of the object's saved views (objectui#12703). The list-side twin of
   * {@link recordHref}: a renderer that shows a few of an object's records (the
   * compact list a page draws in a narrow region) presents "View all" as a real
   * anchor to this destination, without assembling a URL of its own.
   *
   * `viewName` names a saved view of that object, as the block binding states
   * it (`dataSource.view`); absent, the destination is the object's own list.
   * The destination is a view or the object, never a query: a caller does not
   * encode its own filter, columns or sort into it, and the host has no
   * argument to receive them.
   *
   * Returns `null` when the host cannot route to that object (unknown object,
   * no app context); consumers then draw no link. Like {@link recordHref} it is
   * a document href that carries the router's basename, while {@link openList}
   * navigates by the router path.
   */
  listHref?: (objectName: string, viewName?: string) => string | null;
  /**
   * SPA-navigate to the destination {@link listHref} addresses. Consumers call
   * this from a plain left click on the anchor; a modifier click is left to the
   * browser and the href.
   */
  openList?: (objectName: string, viewName?: string) => void;
}

const RelatedRecordActionsContext = createContext<RelatedRecordActionsValue | null>(null);

export const RelatedRecordActionsProvider: React.FC<{
  value: RelatedRecordActionsValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <RelatedRecordActionsContext.Provider value={value}>
    {children}
  </RelatedRecordActionsContext.Provider>
);

/**
 * Consume the host-provided related-record actions. Returns `null` when no
 * host wired the provider (embedded / designer contexts) — callers must treat
 * that as "read-only related list".
 */
export function useRelatedRecordActions(): RelatedRecordActionsValue | null {
  return useContext(RelatedRecordActionsContext);
}
