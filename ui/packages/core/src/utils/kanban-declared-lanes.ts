/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lanes a list view's `kanban.lanes` declares, as the `object-kanban`
 * node's `columns` (objectstack#28211).
 *
 * `kanban.lanes` (`KanbanConfigSchema.lanes` in `@objectstack/spec`) is an
 * ordered list of the lane field's stored option values: the lanes the board
 * draws, in that order. The `object-kanban` node declares no lane list of its
 * own, but it does declare `columns`, its lanes, so the two producers of that
 * node (`ListView` and `ObjectView`, the `kanban` branch of each) hand the
 * declared lanes to the board through it. Both call this one function, so the
 * two routes draw the same board.
 *
 * - The order is the author's, never the options' own and never the lifecycle
 *   order the board lays out on its own (open, won, lost): ordering is what
 *   the key is for.
 * - Each lane is titled with its option's label. The board localizes an
 *   explicit lane's title against the same option, so a translated label still
 *   wins. A value the loaded options do not describe (the definition is still
 *   loading) is titled with the value itself until they do.
 * - A lane whose option declares `kind: 'lost'` starts collapsed, as the board
 *   draws a lost lane it derives from the options (objectstack#26612).
 * - A CHOICE of lanes, not a record filter: a record whose value is not listed
 *   lands in the board's `Uncategorized` lane, as a record whose value matches
 *   no lane always did. Nothing here decides that; the board does.
 *
 * Whether each value is an option of the lane field, and whether one is listed
 * twice, is judged at authoring (`@objectstack/lint`, which `os validate` and
 * the publish door run). This function takes the list as declared.
 *
 * Returns `undefined` when the view declares no lanes: the node then carries
 * no `columns`, and the board draws one lane per option as before.
 */

/** One option of the lane field, as the loaded object definition carries it. */
export interface KanbanLaneOption {
  value?: unknown;
  label?: unknown;
  kind?: unknown;
}

/** One lane of the `object-kanban` node's `columns`. */
export interface KanbanDeclaredLane {
  id: string;
  title: string;
  collapsed?: true;
}

export function kanbanDeclaredLanes(
  lanes: unknown,
  options: readonly KanbanLaneOption[] | null | undefined,
): KanbanDeclaredLane[] | undefined {
  if (!Array.isArray(lanes) || lanes.length === 0) return undefined;
  const byValue = new Map<string, KanbanLaneOption>();
  for (const option of options ?? []) {
    if (option?.value !== undefined && option.value !== null) byValue.set(String(option.value), option);
  }
  return lanes.map((value) => {
    const id = String(value);
    const option = byValue.get(id);
    const title = typeof option?.label === 'string' && option.label !== '' ? option.label : id;
    return option?.kind === 'lost' ? { id, title, collapsed: true as const } : { id, title };
  });
}
