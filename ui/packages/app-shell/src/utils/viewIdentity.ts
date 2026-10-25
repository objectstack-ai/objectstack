/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { expandViewContainer } from '@objectstack/spec/ui';

/**
 * A view body as the switcher receives it: a stored metadata document, read
 * structurally. Deliberately open — the same body arrives as a spec view, as an
 * overlay row and as a persisted override, and this module only ever inspects
 * its identity keys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewBody = Record<string, any>;

/**
 * Runtime identity of an aggregated container's DEFAULT `list` view — asked of
 * the spec's view composer, never spelled out here (objectui#3770).
 *
 * A `defineView` container declares its default list under the `list` key. That
 * key is a SLOT in the authoring document, not the view's identity: the composer
 * (`expandViewContainer`, the same function the framework's loader and the i18n
 * extractor call) registers an unnamed default list as `<object>.default`, and a
 * named one as `<object>.<list.name>`. The renderer used to derive `list.name ||
 * 'list'` instead — a third spelling that no producer emits, so the default
 * list's translation key (`objects.<object>._views.default.label`, canonical per
 * objectstack#5164 ruling A) could never be reached and the label fell back to
 * English. Deriving the identity from the composer keeps this consumer on the one
 * spelling and inherits its rules (implicit `default`, author-supplied `name`,
 * collision renaming) instead of restating them.
 *
 * Call sites that hold the whole container (`MetadataProvider`) call
 * `expandViewContainer` directly and get every view's identity, folding
 * included. This helper is for the call sites that hold only the default list
 * body (`ObjectView`, reading `objectDef.list`).
 *
 * @param objectName - The bound object's name, as the runtime presents it.
 * @param list - The container's default `list` body, or a merged entry derived
 *   from it (already carrying the composer's qualified `name`).
 * @returns The qualified `<object>.<key>` view id, or `undefined` when `list` is
 *   not a view body.
 */
export function defaultListViewId(objectName: string, list: unknown): string | undefined {
  if (!list || typeof list !== 'object') return undefined;
  const declared = (list as { name?: unknown }).name;
  // Already the composer's qualified identity — `MetadataProvider` stamps it
  // onto every merged entry, and re-expanding it would double the prefix
  // (`crm_lead.crm_lead.default`).
  if (typeof declared === 'string' && declared.startsWith(`${objectName}.`)) {
    return declared;
  }
  return expandViewContainer(objectName, { list })[0]?.name;
}

/**
 * The identity of ONE view row — the single spelling every consumer asks
 * (objectui#4211).
 *
 * Views reach `ObjectView` through two independent reads of the same
 * `type='view'` metadata namespace, and each used to spell the row's identity
 * for itself:
 *
 *   - the overlay read (`listViews` → `savedViews`) normalized `sv.name || sv.id`;
 *   - every consumer of a normalized row then re-derived `sv.id || sv._id`;
 *   - the tab list built its entries as `{ id: <key>, ...body, ...override }`,
 *     where `id` sits FIRST and any `id` key inside the merged body or the
 *     stored override therefore REDEFINED the tab's identity.
 *
 * The third spelling is the defect. A stored view body can legitimately carry
 * an `id` key — the console's toolbar write (`persistViewPatch` →
 * `updateViewConfig`, retired in objectui#12504) wrote the whole tab object
 * (`id` included), and those rows are still at rest; a duplicated view copies
 * its source artifact's `id` verbatim — so the spread handed the tab an identity the
 * overlay read had never heard of. `isSavedView` then answered false for a view
 * that *is* saved, which both hid the set-default / rename / delete menu
 * entries (`readonly: !saved`) and short-circuited the handlers behind them.
 *
 * The identity is `name`, and only `name` (objectui#11013, ruling 甲 on
 * objectstack#20051: objectui reads a stored view row by the spec's declared
 * spellings). The overlay is name-keyed (`/meta/view/:name` is name-addressed,
 * and `ViewItemNameSchema` judges that string); the spec declares `name` on
 * every `view` member and a top-level `id` / `_id` on none, and every write
 * path stamps `name` on the row it saves. This used to fall back to `id`, then
 * `_id`, for a row with no `name`; such a row now has no identity, so the tab
 * list skips it rather than keying a tab on an undeclared spelling. An empty
 * `name` is no identity either.
 *
 * IDEMPOTENT by construction, which is what lets one function serve both the
 * producer and its readers: `viewRowId(normalized) === viewRowId(raw)` for
 * every row, because normalization only ever writes the answer back onto `id`
 * while leaving `name` in place.
 */
export function viewRowId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const name = (row as Record<string, unknown>).name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * Whether `vid` names a view backed by an overlay row — i.e. one the user may
 * rename / delete / pin / set-default.
 *
 * This is the exact predicate BOTH halves of the surface consult: the tab's
 * `readonly` flag (which decides whether the menu entry is rendered at all) and
 * the early return inside each mutating handler. They must never disagree —
 * a tab that renders the entry but whose handler refuses it is a click that
 * fires no write, and a saved view whose entry is hidden is a capability the
 * user cannot reach. Sharing one function is what keeps them in step.
 */
export function isSavedViewId(savedViews: readonly unknown[], vid: string): boolean {
  return savedViews.some((sv) => viewRowId(sv) === vid);
}

/**
 * Build one switcher tab, stamping its identity LAST.
 *
 * The merged bodies (the metadata view definition, the persisted override, the
 * overlay row) are all stored documents, and a stored document may carry an
 * `id` key of its own. Assigning `id` after them — rather than declaring it
 * first and letting the spreads run over it — is what makes the tab id a
 * property of the caller's key rather than of whatever happens to be in the
 * data. See {@link viewRowId} for how that clobbering was reached in practice.
 */
export function viewEntry(
  id: string,
  ...bodies: Array<ViewBody | undefined | null>
): ViewBody & { id: string } {
  const entry: ViewBody = {};
  for (const body of bodies) {
    if (body && typeof body === 'object') Object.assign(entry, body);
  }
  entry.id = id;
  return entry as ViewBody & { id: string };
}
