/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — what a lane header offers beyond its name and count,
 * when the HOST asks for it: a 「+」 that opens the create form with the lane's
 * value filled in, and a 「⋯」 menu that collapses or hides the lane.
 *
 * ## Who decides what
 *
 * - **Collapse** is the reader's own, kept in this browser only: it changes
 *   how the board is laid out, never which records it shows, so it is never
 *   part of the view nor of the list's draft. The host names the board
 *   (`collapseKey`); the board keeps the collapsed lanes under that name in
 *   `localStorage`. Without a name the collapse lives for this mount only.
 * - **Hide** is a setting of the view (the lanes it shows, `kanban.lanes`):
 *   the host holds it in the list's draft, exactly as unticking the lane in
 *   the view settings does. The board only reports the lane.
 * - **Create in this lane** is the host's create form; the board reports the
 *   lane and the host fills the lane field in.
 *
 * A package-private channel, as `KanbanColumnSummary` and `KanbanLanePaging`
 * are: `ObjectKanban` provides it from its `laneMenu` host prop, and a board
 * without a provider draws every header exactly as before.
 *
 * @module
 */

import { createContext, useContext } from 'react';

/** The host's request for the lane-header controls (`ObjectKanban`'s `laneMenu` prop). */
export interface KanbanLaneMenuRequest {
  /**
   * The name the board keeps its collapsed lanes under in this browser (the
   * host's choice: one per reader, object and view). Absent ⇒ collapse is
   * still offered, and forgotten on the next mount.
   */
  collapseKey?: string;
  /** Hides the lane (its column id, the lane field's stored value). Absent ⇒ no 「Hide column」. */
  onHideLane?: (laneId: string) => void;
  /** Opens the create form with the lane's value filled in. Absent ⇒ no 「+」. */
  onCreateInLane?: (laneId: string) => void;
}

/**
 * The channel as the board reads it: the host's request, and which lanes take
 * the hide and create actions (the `Uncategorized` lane holds the records
 * whose value names no lane, so there is no value to hide or to fill in).
 */
export interface KanbanLaneMenu extends KanbanLaneMenuRequest {
  laneTakesActions: (laneId: string) => boolean;
}

export const KanbanLaneMenuContext = createContext<KanbanLaneMenu | null>(null);

/** The lane-header controls the host asked for, or `null` for none. */
export function useKanbanLaneMenu(): KanbanLaneMenu | null {
  return useContext(KanbanLaneMenuContext);
}

/** The `localStorage` key family the collapsed lanes are kept under. */
export const KANBAN_LANE_COLLAPSE_PREFIX = 'objectui:kanban-lanes-collapsed';

function storageKeyOf(collapseKey: string): string {
  return `${KANBAN_LANE_COLLAPSE_PREFIX}:${collapseKey}`;
}

/**
 * The lanes a reader collapsed or opened on this board, by column id
 * (`true` = collapsed), as this browser keeps them. Empty with no key, with
 * no storage, or over an entry this module did not write.
 */
export function readCollapsedLanes(collapseKey: string | undefined): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!collapseKey) return out;
  try {
    const raw = globalThis.localStorage?.getItem(storageKeyOf(collapseKey));
    if (!raw) return out;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [lane, collapsed] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof collapsed === 'boolean') out.set(lane, collapsed);
      }
    }
  } catch {
    /* storage blocked or entry corrupt: the board opens on its own layout */
  }
  return out;
}

/** Keep the reader's collapse choices for this board in this browser. */
export function writeCollapsedLanes(collapseKey: string | undefined, lanes: ReadonlyMap<string, boolean>): void {
  if (!collapseKey) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (lanes.size === 0) {
      storage.removeItem(storageKeyOf(collapseKey));
      return;
    }
    storage.setItem(storageKeyOf(collapseKey), JSON.stringify(Object.fromEntries(lanes)));
  } catch {
    /* quota or blocked storage: the choice lives for this mount */
  }
}
