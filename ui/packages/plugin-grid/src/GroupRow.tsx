/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@object-ui/components';
import type { AggregationResult } from './useGroupedData';

export interface GroupRowProps {
  /** Unique key identifying this group */
  groupKey: string;
  /** Display label for the group (field value or "(empty)") */
  label: string;
  /**
   * The group's size. On a server-grouped grid this is the header query's
   * `count` — the group's TOTAL, not the rows on screen (objectui#7189).
   */
  count: number;
  /** Whether the group is collapsed */
  collapsed: boolean;
  /** Computed aggregation results for this group */
  aggregations?: AggregationResult[];
  /**
   * Small grey caption drawn before the value pill (the field label being
   * grouped on, e.g. "Status"). When omitted, no caption is drawn — nested
   * subgroups leave it to their parent's band.
   */
  fieldLabel?: string;
  /**
   * Optional Tailwind class string applied to the group label "pill".
   *
   * Derive it the way the cell renderer of the same field value derives it,
   * or the header and the cell under it disagree on one option's colour
   * (objectui#5183): prefer `getBadgeHexAppearance(color)` from
   * `@object-ui/fields` and use its `className`, falling back to
   * `getBadgeColorClasses(color, value)` when it returns `undefined`. When
   * omitted, the label renders as plain text with a subtle muted background.
   */
  labelColorClass?: string;
  /**
   * Inline style accompanying `labelColorClass`. **Required whenever the
   * class string came from `getBadgeHexAppearance`** — that className reads
   * CSS custom properties which only this style declares, so passing the
   * class alone paints a pill against undefined variables. Pass the helper's
   * `style` verbatim; leave unset on the palette-family path.
   */
  labelColorStyle?: React.CSSProperties;
  /**
   * Nesting level of the group, 0 for the outermost. Indents the band's
   * content, since every band of a grouped grid spans the same columns.
   */
  depth?: number;
  /** Callback when the group header is clicked to toggle collapse */
  onToggle: (key: string) => void;
}

/** Left inset of a band's content per nesting level (Tailwind steps, no inline style). */
const DEPTH_INSET = ['pl-3', 'pl-8', 'pl-12', 'pl-16'] as const;

/**
 * GroupRow draws the content of one group BAND of a grouped grid
 * (objectui#12620): the chevron, the grouped field's caption, the value pill,
 * the count and the aggregations, in one 36 px line. The grid draws ONE table
 * with ONE header; `data-table` puts this content in a band row whose single
 * cell spans every column, followed by the group's rows. Collapsing a group
 * removes its rows from the table and keeps its band.
 *
 * The content sticks to the left edge of the grid's scroller, so a band stays
 * readable while the table is scrolled horizontally.
 */
export const GroupRow: React.FC<GroupRowProps> = ({
  groupKey,
  label,
  count,
  collapsed,
  aggregations,
  fieldLabel,
  labelColorClass,
  labelColorStyle,
  depth = 0,
  onToggle,
}) => {
  const pillClass = labelColorClass
    ? cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', labelColorClass)
    : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground';

  return (
    <div data-testid={`group-row-${groupKey}`} className="group/grouprow sticky left-0 w-max max-w-full">
      <button
        type="button"
        className={cn(
          'flex h-9 items-center gap-2 pr-3 text-sm text-left rounded-md hover:bg-muted/40 transition-colors',
          DEPTH_INSET[Math.min(depth, DEPTH_INSET.length - 1)],
        )}
        onClick={() => onToggle(groupKey)}
        aria-expanded={!collapsed}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {fieldLabel && (
          <span className="text-[11px] font-medium text-muted-foreground tracking-wide group-label-caption">
            {fieldLabel}
          </span>
        )}
        <span className={cn(pillClass, 'group-label')} style={labelColorStyle}>{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums group-count">{count}</span>
        {aggregations && aggregations.length > 0 && (
          <span className="ml-2 text-xs text-muted-foreground group-aggregations">
            {aggregations.map((agg) => (
              <span key={`${agg.field}-${agg.type}`} className="mr-2">
                {agg.type}: {agg.value === null ? '\u2014' : Number.isInteger(agg.value) ? agg.value : agg.value.toFixed(2)}
              </span>
            ))}
          </span>
        )}
      </button>
    </div>
  );
};
