/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Fold a list view's legacy `rowActions: string[]` into the row-context action
 * DEFS before the row kebab renders them.
 *
 * Two vocabularies reach the row menu:
 *
 *  1. `rowActionDefs` — full `ActionDef` records the view already derived from
 *     `objectDef.actions` filtered by `locations.includes('list_item')`. These
 *     dispatch through the action runner with their own type/target/params, so
 *     they actually run.
 *
 *  2. `rowActions` — the legacy bare-name form (`rowActions: ['convert_lead']`).
 *     A name is not an action: dispatching it put the NAME in the runner's
 *     `type` slot, which matches no built-in type and (absent a handler
 *     registered under that name) fell through to the runner's schema fallback
 *     — zero requests, then a green "Action completed successfully" toast
 *     (objectui#2960). Worse, when the same action ALSO declared
 *     `locations: ['list_item']`, the menu showed a working entry and a dead
 *     duplicate of it side by side.
 *
 * Resolving each legacy name against the object's declared actions collapses
 * both problems: a name that matches an existing def is dropped (the def
 * already renders the working entry), and a name that matches an action
 * declared elsewhere on the object — the case the legacy form exists to serve —
 * is PROMOTED to that def so it dispatches for real.
 *
 * A name that resolves to nothing draws nothing. The spec's own sentence is
 * the rule: a bare `rowActions` / `bulkActions` name "names an action the
 * object declares" (`bulk-action.zod.ts`), and lint `action-name-undefined`
 * (ADR-0049) refuses an undeclared one at authoring. An action a disabled
 * package withholds is absent from the served `objectDef.actions` for the same
 * reason, so it leaves the row menu with the rest of that package. The name
 * is returned in `undeclared` only so the grid can say, once and in
 * development, which names it did not draw (`describeUndeclaredActionNames`).
 * A handler a host registers under a bare name is not a declaration and does
 * not bring the entry back.
 */

/** The subset of an `ActionDef` this fold needs: everything is passed through. */
export interface NamedActionDef {
  name?: string;
  [key: string]: unknown;
}

export function resolveLegacyRowActions(opts: {
  /**
   * Legacy `rowActions` names, already stripped of the canonical `'edit'` /
   * `'delete'` entries (those route to `onEdit` / `onDelete`, not the runner).
   */
  rowActions?: readonly string[] | null;
  /** Row-context defs the view resolved from `locations: ['list_item']`. */
  rowActionDefs?: readonly NamedActionDef[] | null;
  /** Every action declared on the object (`objectDef.actions`). */
  objectActions?: readonly NamedActionDef[] | null;
}): {
  /**
   * `rowActionDefs` plus any promoted legacy names, in declaration order
   * (defs first, promotions after). Returned by REFERENCE when nothing was
   * promoted, so the row menu's `useMemo` over this list is not busted on
   * every render of a view that has no legacy names to fold.
   */
  defs: readonly NamedActionDef[];
  /**
   * Legacy names that matched no declared action. NOT drawn and NOT
   * dispatched: they exist for the development warning only.
   */
  undeclared: string[];
} {
  const defs = Array.isArray(opts.rowActionDefs) ? opts.rowActionDefs : [];
  const names = Array.isArray(opts.rowActions) ? opts.rowActions : [];
  if (names.length === 0) return { defs, undeclared: [] };

  const objectActions = Array.isArray(opts.objectActions) ? opts.objectActions : [];
  const claimed = new Set(
    defs.map(d => d?.name).filter((n): n is string => typeof n === 'string' && n !== ''),
  );

  const promoted: NamedActionDef[] = [];
  const undeclared: string[] = [];

  for (const name of names) {
    if (typeof name !== 'string' || name === '') continue;
    // Already rendered as a def (either a `list_item` action of the same name,
    // or an earlier promotion of a repeated legacy entry) — drop the duplicate.
    if (claimed.has(name)) continue;
    const match = objectActions.find(a => a?.name === name);
    if (match) {
      claimed.add(name);
      promoted.push(match);
    } else if (!undeclared.includes(name)) {
      undeclared.push(name);
    }
  }

  return {
    defs: promoted.length > 0 ? [...defs, ...promoted] : defs,
    undeclared,
  };
}
