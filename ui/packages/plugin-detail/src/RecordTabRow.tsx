/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@object-ui/components';
import { ChevronDown } from 'lucide-react';
import { layoutRecordTabRow } from './synth/recordTabRow';
import { useDetailTranslation } from './useDetailTranslation';

/** The id of the row's first tab, 「概览」: the page itself, no `?related=`. */
export const RECORD_TAB_OVERVIEW = 'overview';

/** One tab of the record page's tab row. */
export interface RecordTab {
  /** `overview`, `timeline` (动态), or a related list's `object.field`. */
  id: string;
  label: string;
  /** The panel's count; absent or `null` while it is not known (no chip). */
  count?: number | null;
}

export interface RecordTabRowProps {
  /** The row's tabs in their order; the first is 「概览」. */
  tabs: readonly RecordTab[];
  /** The hidden panels' tabs: never on the row, at the end of the dropdown. */
  hiddenTabs?: readonly RecordTab[];
  /** The active tab's id; always on the row. */
  activeId: string;
  onSelect: (id: string) => void;
}

/** The space between two tabs (`gap-4`), which the layout rule is told. */
const TAB_GAP = 16;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

const widthOf = (element: Element | null | undefined): number => (element ? element.getBoundingClientRect().width : 0);

const CountChip: React.FC<{ count: number }> = ({ count }) => (
  <span
    className="inline-flex h-4 shrink-0 items-center rounded bg-muted px-1 text-[10.5px] font-normal tabular-nums text-foreground"
    data-record-tab-count=""
  >
    {count}
  </span>
);

const hasCount = (tab: RecordTab): tab is RecordTab & { count: number } => typeof tab.count === 'number';

/** A tab's face, shared by the row's button and the measuring copy. */
const TabFace: React.FC<{ tab: RecordTab }> = ({ tab }) => (
  <>
    <span>{tab.label}</span>
    {hasCount(tab) && <CountChip count={tab.count} />}
  </>
);

const TAB_CLASS =
  '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-[13px] transition-colors';

/**
 * The record page's tab row (objectstack#27524, Target 8): at the bottom
 * edge of the record header, on every face — 「概览」, then one tab per panel
 * (动态 first, then the related panels in the reader's arrangement), each with
 * its count. A tab is its panel's whole face (Target 9): choosing it draws
 * that face below the row, and 「概览」 returns to the page.
 *
 * How many tabs the row shows is computed from its own width, measured on
 * every resize (a window resize, the sidebar collapsing, a pane dragged
 * wider): as many as fit, the rest in a 「+N ▾」 dropdown that lists them with
 * their counts, the hidden panels' tabs at its end. The active tab is always
 * on the row, and so are 「概览」 and at least one more
 * ({@link layoutRecordTabRow}).
 *
 * Keyboard: the row is one tab stop; ← → Home End move between its tabs, and
 * Enter or Space opens the focused one.
 */
export const RecordTabRow: React.FC<RecordTabRowProps> = ({ tabs, hiddenTabs = [], activeId, onSelect }) => {
  const { t } = useDetailTranslation();
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = React.useState<{ widths: number[]; more: number; available: number } | null>(null);

  // What the tabs draw, as a value: re-measure when a label or a count moves.
  const facesKey = JSON.stringify([tabs.map((tab) => [tab.id, tab.label, tab.count ?? null]), hiddenTabs.length]);
  useIsomorphicLayoutEffect(() => {
    const row = rowRef.current;
    const measurer = measureRef.current;
    if (!row || !measurer) return undefined;
    const read = () => {
      const widths = Array.from(measurer.querySelectorAll('[data-record-tab-measure]')).map(widthOf);
      const more = widthOf(measurer.querySelector('[data-record-tab-measure-more]'));
      const available = widthOf(row);
      setMeasure((prev) =>
        prev &&
        prev.more === more &&
        prev.available === available &&
        prev.widths.length === widths.length &&
        prev.widths.every((w, i) => w === widths[i])
          ? prev
          : { widths, more, available },
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(row);
    return () => observer.disconnect();
  }, [facesKey]);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  // Until the row has a width (unmeasured, laid out nowhere, no layout
  // engine) every tab is listed, as it is for a row that fits them all.
  const layout =
    measure && measure.available > 0 && measure.widths.length === tabs.length
      ? layoutRecordTabRow({
          widths: measure.widths,
          available: measure.available,
          gap: TAB_GAP,
          moreWidth: measure.more,
          activeIndex,
          alwaysInDropdown: hiddenTabs.length,
        })
      : { shown: tabs.map((_, index) => index), overflow: [] as number[] };
  // An id naming no tab leaves 「概览」 active.
  const activeTabId = tabs[activeIndex]?.id;
  const shown = layout.shown.map((index) => tabs[index]);
  const overflow = layout.overflow.map((index) => tabs[index]);
  const moreCount = overflow.length + hiddenTabs.length;

  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const ids = shown.map((tab) => tab.id);
    const focused = ids.findIndex((id) => tabRefs.current.get(id) === event.target);
    if (focused < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (focused + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (focused - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    event.preventDefault();
    tabRefs.current.get(ids[next])?.focus();
  };

  const tabsLabel = t('detail.recordTabs', { defaultValue: 'Record tabs' });
  return (
    <div
      ref={rowRef}
      className="relative flex min-w-0 items-center gap-4 border-b border-border"
      data-record-tab-row=""
      data-record-tab-row-shown={shown.length}
    >
      <div role="tablist" aria-label={tabsLabel} className="flex min-w-0 items-center gap-4" onKeyDown={onKeyDown}>
        {shown.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={cn(
                TAB_CLASS,
                'rounded-t-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              data-record-tab={tab.id}
              onClick={() => {
                if (!active) onSelect(tab.id);
              }}
            >
              <TabFace tab={tab} />
            </button>
          );
        })}
      </div>
      {moreCount > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                TAB_CLASS,
                'gap-0.5 rounded-t-sm border-transparent text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label={t('detail.recordTabsMore', { count: moreCount, defaultValue: '{{count}} more tabs' })}
              data-record-tab-more={moreCount}
            >
              <span>+{moreCount}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {overflow.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                className="justify-between gap-3"
                data-record-tab-menu-item={tab.id}
                onSelect={() => onSelect(tab.id)}
              >
                <TabFace tab={tab} />
              </DropdownMenuItem>
            ))}
            {hiddenTabs.length > 0 && (
              <>
                {overflow.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {t('detail.recordTabsHidden', { defaultValue: 'Hidden' })}
                </DropdownMenuLabel>
                {hiddenTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab.id}
                    className="justify-between gap-3 text-muted-foreground"
                    data-record-tab-menu-item={tab.id}
                    data-record-tab-hidden=""
                    onSelect={() => onSelect(tab.id)}
                  >
                    <TabFace tab={tab} />
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* The measuring copy: every tab and the widest trigger at their drawn
          size, out of sight, so the row knows what fits before it paints. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <div className="flex w-max items-center gap-4">
          {tabs.map((tab) => (
            <span key={tab.id} className={cn(TAB_CLASS, 'border-transparent font-medium')} data-record-tab-measure="">
              <TabFace tab={tab} />
            </span>
          ))}
          <span className={cn(TAB_CLASS, 'gap-0.5 border-transparent')} data-record-tab-measure-more="">
            <span>+{tabs.length + hiddenTabs.length}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
};
