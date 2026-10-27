/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The lanes a board derives from its lane field's picklist, laid out by the
 * options' declared lifecycle `kind` (objectstack#26612).
 *
 * `@objectstack/spec` lets a select option declare `kind: 'open' | 'won' |
 * 'lost'` (`SelectOption.kind`, objectstack#23809), and reads an absent kind
 * as `open`. When the lane field declares a kind on ANY option, the lanes run
 * open → won → lost — the work in flight, then the successful ends, then the
 * unsuccessful ones — each class in its authored order, and every lost lane
 * starts collapsed: a spine with its count, its heading a disclosure the
 * viewer can open (`KanbanColumn.collapsed`, honoured by `KanbanImpl`).
 *
 * A field that declares no kind keeps its authored order, untouched: the board
 * never guesses a lane's lifecycle from its value or label.
 *
 * ⚠️ Module-internal: imported by `ObjectKanban.tsx`, NOT re-exported from the
 * package entry.
 */

export type LaneLifecycleKind = 'open' | 'won' | 'lost';

export interface LaneOption {
  value: unknown;
  label: string;
  kind?: LaneLifecycleKind;
}

export interface DerivedLane {
  id: any;
  title: string;
  collapsed?: true;
}

const KIND_RANK: Record<LaneLifecycleKind, number> = { open: 0, won: 1, lost: 2 };

export function lanesFromOptions(options: readonly LaneOption[]): DerivedLane[] {
  const declaresKind = options.some((o) => o.kind !== undefined);
  if (!declaresKind) return options.map((o) => ({ id: o.value, title: o.label }));
  // `Array.prototype.sort` is stable, so each class keeps its authored order.
  return [...options]
    .sort((a, b) => KIND_RANK[a.kind ?? 'open'] - KIND_RANK[b.kind ?? 'open'])
    .map((o) =>
      o.kind === 'lost'
        ? { id: o.value, title: o.label, collapsed: true as const }
        : { id: o.value, title: o.label },
    );
}
