/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';

/**
 * The record's one-row header (objectstack#35593): the bar a host draws at the
 * top of a record — the page's top bar, the pane's — offers two places, and
 * `page:header` draws into them instead of drawing a second row under the bar.
 * The record's name and its tags go to `titleSlot`, its one button group to
 * `actionSlot`, each through a portal, so the header keeps the record's
 * contexts (`RecordContext`, the record's `ActionProvider`).
 *
 * The header says it took the bar with `claim(true)` once it draws there, and
 * `claim(false)` when it stops, so a host draws its own record crumb only
 * while no header holds the bar: a page with no `page:header` keeps the bar's
 * breadcrumb. `claim` must be a stable function.
 *
 * `null` (the default): no bar, and the header draws its own row as before.
 */
export interface RecordHeaderBar {
  /** Where the record's name and tags go; `null` until the host's element mounts. */
  titleSlot: HTMLElement | null;
  /** Where the record's button group goes; `null` until the host's element mounts. */
  actionSlot: HTMLElement | null;
  /** The header took the bar (`true`) or gave it back (`false`). */
  claim(claimed: boolean): void;
}

export const RecordHeaderBarContext = React.createContext<RecordHeaderBar | null>(null);

/**
 * What the pieces of the record's own button group are, handed to a host's
 * `group` (objectstack#35593).
 */
export interface RecordHeaderGroupParts {
  /**
   * The record's row exactly as the header draws it without a state: its
   * inline buttons and its `⋯`. A state that adds nothing draws this.
   */
  recordRow: React.ReactNode;
  /**
   * The record's actions as `⋯` menu items, every one of them (the host's
   * refresh first, destructive entries last), for a state whose own levers
   * take the row: they go into that state's `⋯` after a separator. `null`
   * when the record has none.
   */
  recordMenuItems: React.ReactNode;
  /** `row` in the header, `bar` on a phone's bottom bar. */
  face: 'row' | 'bar';
}

/**
 * What the record's state puts in its header (objectstack#35593), handed by the
 * host that knows that state (the console's record view, from the record's
 * approval):
 *
 * - `tags` — short tags after the record's name (an approval status, a lock
 *   that the approval does not explain);
 * - `group` — the ONE button group. Called with the record's own pieces, it
 *   returns what the header draws in place of the record's row: the record's
 *   row unchanged, or the state's levers with the record's actions folded
 *   into the group's `⋯` after a separator.
 *
 * `null` (the default): no state, and the header draws the record's row.
 */
export interface RecordHeaderState {
  tags?: React.ReactNode;
  group?: (parts: RecordHeaderGroupParts) => React.ReactNode;
}

export const RecordHeaderStateContext = React.createContext<RecordHeaderState | null>(null);
