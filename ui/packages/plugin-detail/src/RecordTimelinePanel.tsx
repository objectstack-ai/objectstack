/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { RecordTimelinePanelContext, type RecordTimelinePanel as RecordTimelinePanelValue } from './recordTimelineStream';
import { useDetailTranslation } from './useDetailTranslation';

export interface RecordTimelinePanelProps {
  /** The page's 动态 blocks (`DefaultPageColumns.timeline`). */
  nodes: any[];
  /** How many of the newest entries the panel shows: 3, or 5 when wide. */
  entries: number;
  /** Open the 动态 tab — the host's `?related=timeline`. Absent: no way out. */
  onViewAll?: () => void;
}

/**
 * The 动态 panel (objectstack#27524, Target 5): the FIRST panel of the record
 * page's right column, in the same shape as the related panels after it — a
 * header of 「动态」 and the stream's count, the header row opening the 动态
 * tab (「查看全部 N 条」) — and, as its body, the page's 动态 blocks in their
 * peek face (`RecordTimelinePanelContext`): the one-line composer, the newest
 * `entries`, 「查看全部 N 条 →」. The full stream, with its chips and paging,
 * is the 动态 tab; the panel never grows into a column.
 *
 * Not arrangeable: it leads the column whatever the related panels' order.
 */
export const RecordTimelinePanel: React.FC<RecordTimelinePanelProps> = ({ nodes, entries, onViewAll }) => {
  const { t } = useDetailTranslation();
  const [count, setCount] = React.useState<number | null>(null);
  const panel = React.useMemo<RecordTimelinePanelValue>(
    () => ({ entries, onViewAll, onCount: setCount }),
    [entries, onViewAll],
  );
  const title = t('detail.timeline', { defaultValue: 'Activity' });
  const countChip = count !== null && (
    <span
      className="inline-flex h-5 shrink-0 items-center rounded bg-muted px-1.5 text-[11.5px] font-normal text-foreground"
      data-record-timeline-count=""
    >
      {count}
    </span>
  );
  return (
    <section className="rounded-[10px] border border-border bg-card" aria-label={title} data-record-timeline-panel="">
      <div
        className="group/panel-head relative flex h-9 items-center gap-1.5 px-3 text-[12.5px] font-semibold"
        data-record-timeline-panel-head=""
      >
        {onViewAll ? (
          // The row is the target, as on a related panel: the button's ::after
          // stretches over the whole header.
          <button
            type="button"
            className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={count !== null ? t('detail.relatedPanelViewAll', { count, defaultValue: 'View all {{count}}' }) : undefined}
            data-record-timeline-panel-open=""
            onClick={onViewAll}
          >
            <span className="min-w-0 truncate">{title}</span>
            {countChip}
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/panel-head:opacity-100 group-focus-within/panel-head:opacity-100"
              aria-hidden
            />
          </button>
        ) : (
          <>
            <span className="min-w-0 truncate">{title}</span>
            {countChip}
          </>
        )}
      </div>
      <RecordTimelinePanelContext.Provider value={panel}>
        {nodes.map((node, index) => (
          <SchemaRenderer key={(node && typeof node === 'object' && node.id) || index} schema={toRenderableSchema(node)} />
        ))}
      </RecordTimelinePanelContext.Provider>
    </section>
  );
};
