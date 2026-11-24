/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's record scope action arrangement (`actionLayout.record`,
 * objectstack#36366) applied to one row's menus (objectstack#36494): the
 * row's "⋮" menu and its context menu list the actions the arm's `pinned`
 * names first, in that order, then the ones its `more` names, in that order,
 * then every other action in the menu's own order (primaries above
 * secondaries, each in declared order). An object with no `record` arm lists
 * exactly as before.
 *
 * Two halves, because the menu's own partition (which primary renders inline,
 * which defs survive their `visible`) runs per row inside
 * `planRowActionMenu`, after the grid has handed its defs down:
 *
 * - {@link rankRowActionDefs} runs once per grid, where the object's arm is
 *   read: each def the arm names is replaced by a copy that carries its rank.
 * - {@link orderRowMenuActions} runs inside the plan, on the defs bound for
 *   the menu: the ranked ones first, by rank, the rest after in their order.
 *
 * The rank rides on the def object rather than on a prop, so the arrangement
 * reaches every surface the plan feeds (the cell, the context menu, the
 * selection bar's one-record menu) through the same `rowActionDefs` they
 * already share, and a `RowActionMenu` mounted outside the grid, whose defs
 * carry no rank, lists as before.
 */

import { readActionLayoutArm } from '@object-ui/types';

/** The arm position of each ranked def copy: pinned names first, then `more`. */
const RANK = new WeakMap<object, number>();

/**
 * `defs` with each action the arm names replaced by a ranked copy, in the
 * same order. No arm (`undefined`, or a value that is no arm) or no def the
 * arm names answers `defs` itself, by reference. A name naming none of
 * `defs` ranks nothing; a name repeated in the arm, or in `defs`, ranks its
 * first occurrence only.
 */
export function rankRowActionDefs<T extends { name?: unknown }>(defs: readonly T[], layoutArm: unknown): readonly T[] {
  const arm = readActionLayoutArm(layoutArm);
  if (!arm) return defs;
  const rank = new Map<string, number>();
  for (const name of [...arm.pinned, ...(arm.more ?? [])]) {
    if (!rank.has(name)) rank.set(name, rank.size);
  }
  const seen = new Set<string>();
  let ranked = false;
  const out = defs.map((def) => {
    const name = typeof def?.name === 'string' ? def.name : '';
    const at = name && !seen.has(name) ? rank.get(name) : undefined;
    if (at === undefined) return def;
    seen.add(name);
    ranked = true;
    const copy = { ...def };
    RANK.set(copy, at);
    return copy;
  });
  return ranked ? out : defs;
}

/**
 * The defs bound for one row's menu, in the order it lists them: the ranked
 * ones by rank, then the unranked ones in their incoming order.
 */
export function orderRowMenuActions<T extends object>(defs: readonly T[]): T[] {
  const ranked: T[] = [];
  const rest: T[] = [];
  for (const def of defs) (RANK.has(def) ? ranked : rest).push(def);
  if (ranked.length === 0) return [...defs];
  return [...ranked.sort((a, b) => RANK.get(a)! - RANK.get(b)!), ...rest];
}
