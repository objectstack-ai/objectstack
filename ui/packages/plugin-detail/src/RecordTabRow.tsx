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
import { ArrowLeft, ArrowRight, ChevronDown, EyeOff, RotateCcw } from 'lucide-react';
import { layoutRecordTabRow } from './synth/recordTabRow';
import { useDetailTranslation } from './useDetailTranslation';

/** The id of the row's first tab, 「概览」: the page itself, no `?related=`. */
export const RECORD_TAB_OVERVIEW = 'overview';

/** One tab of the record page's tab row. */
export interface RecordTab {
  /**
   * `overview`, `timeline` (动态), `attachments`, `approvals`, or a related
   * list's `object.field`.
   */
  id: string;
  label: string;
  /**
   * The panel's count; absent or `null` while it is not known (no chip). `0`
   * draws no number either: the tab's label is muted instead
   * (objectstack#35595, 「没有记录的不带数字、字色稍淡」).
   */
  count?: number | null;
  /**
   * A dot after the label instead of a count — the 审批 tab while an approval
   * is pending (objectstack#35595).
   */
  dot?: boolean;
  /**
   * The reader may move and hide this tab — a related list's
   * (objectstack#35783): whether it can move one place before or after.
   * Absent: a fixed tab (概览, 附件, 审批, 动态, an open body table).
   */
  arrange?: { before: boolean; after: boolean };
}

/** What a related tab's menu asks of the reader's arrangement (objectstack#35783). */
export type RecordTabArrangeEdit = 'move-before' | 'move-after' | 'hide';

export interface RecordTabRowProps {
  /** The row's tabs in their order; the first is 「概览」. */
  tabs: readonly RecordTab[];
  /** The hidden panels' tabs: never on the row, at the end of the dropdown. */
  hiddenTabs?: readonly RecordTab[];
  /** The active tab's id; always on the row. */
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * A related tab's menu (objectstack#35783): 「左移」, 「右移」, 「隐藏」 on
   * every tab that carries `arrange`. Absent: no tab has a menu.
   */
  onArrange?: (id: string, edit: RecordTabArrangeEdit) => void;
  /**
   * 「恢复默认顺序」 at the end of 「更多」 (objectstack#35783): the default
   * order with every list shown. Absent: no entry, as for a row in its
   * default arrangement.
   */
  onResetArrangement?: () => void;
}

/** The space between two tabs (`gap-4`), which the layout rule is told. */
const TAB_GAP = 16;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

const widthOf = (element: Element | null | undefined): number => (element ? element.getBoundingClientRect().width : 0);

const CountChip: React.FC<{ count: number; muted?: boolean }> = ({ count, muted }) => (
  <span
    className={cn(
      'inline-flex h-4 shrink-0 items-center rounded bg-muted px-1 text-[10.5px] font-normal tabular-nums',
      muted ? 'text-muted-foreground' : 'text-foreground',
    )}
    data-record-tab-count=""
  >
    {count}
  </span>
);

const hasCount = (tab: RecordTab): tab is RecordTab & { count: number } =>
  typeof tab.count === 'number' && tab.count > 0;

/** Whether a tab's list is known to be empty: a count of `0`. */
export const isEmptyRecordTab = (tab: RecordTab): boolean => tab.count === 0;

/**
 * A tab's face, shared by the row's button, the dropdown's items and the
 * measuring copy: the label, then the count chip (above 0) or the dot.
 */
const TabFace: React.FC<{ tab: RecordTab; muted?: boolean; menu?: boolean }> = ({ tab, muted, menu }) => (
  <>
    <span className={cn(isEmptyRecordTab(tab) && 'opacity-70')} data-record-tab-label="">
      {tab.label}
    </span>
    {hasCount(tab) && <CountChip count={tab.count} muted={muted} />}
    {tab.dot && (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden data-record-tab-dot="" />
    )}
    {menu && <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden data-record-tab-menu-chevron="" />}
  </>
);

const TAB_CLASS =
  '-mb-px inline-flex h-11 sm:h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-[13px] transition-colors';

/**
 * The record page's tab row (objectstack#27524, Target 8): at the bottom
 * edge of the record header, on every face — 「概览」, then one tab per panel
 * (objectstack#35595: every related list, then 附件, 审批 and 动态 last), each
 * with its count. A tab is its panel's whole face (Target 9): choosing it
 * draws that face below the row, and 「概览」 returns to the page.
 *
 * How many tabs the row shows is computed from its own width, measured on
 * every resize (a window resize, the sidebar collapsing, a pane dragged
 * wider): as many as fit, the rest in a 「更多 N ▾」 dropdown that lists them
 * with their counts, then the hidden panels' tabs at its end. Width is the
 * only fold: a list with no records keeps its place, muted and without a
 * number (objectstack#35595, superseding objectstack#28469). The active tab is
 * always on the row, and so are 「概览」 and at least one more
 * ({@link layoutRecordTabRow}).
 *
 * A related list's tab is the reader's to arrange (objectstack#35783): open,
 * it draws a ▾ and is its own menu's trigger — click it, or Enter, Space or
 * ↓ on it — holding 「左移」, 「右移」 and 「隐藏」. 概览, 附件, 审批 and 动态 have
 * none. While the reader's arrangement is not the default one, 「更多」 ends
 * with 「恢复默认顺序」, so a drawer, which has no rail, can undo it too.
 *
 * Keyboard: the row is one tab stop; ← → Home End move between its tabs, and
 * Enter or Space opens the focused one.
 */
export const RecordTabRow: React.FC<RecordTabRowProps> = ({
  tabs,
  hiddenTabs = [],
  activeId,
  onSelect,
  onArrange,
  onResetArrangement,
}) => {
  const { t } = useDetailTranslation();
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const measureRef = React.useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = React.useState<{ widths: number[]; more: number; available: number } | null>(null);

  // What the tabs draw, as a value: re-measure when a label or a count moves.
  const facesKey = JSON.stringify([
    tabs.map((tab) => [tab.id, tab.label, tab.count ?? null, tab.dot === true]),
    hiddenTabs.length,
    activeId,
    !!onArrange,
  ]);
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
          alwaysInDropdown: hiddenTabs.length + (onResetArrangement ? 1 : 0),
        })
      : { shown: tabs.map((_, index) => index), overflow: [] as number[] };
  // An id naming no tab leaves 「概览」 active.
  const activeTabId = tabs[activeIndex]?.id;
  const shown = layout.shown.map((index) => tabs[index]);
  const overflow = layout.overflow.map((index) => tabs[index]);
  const moreCount = overflow.length + hiddenTabs.length;
  const hasMenu = moreCount > 0 || !!onResetArrangement;
  // The open tab's menu, if any: only the ACTIVE related tab opens one — a
  // click on any other selects it (objectstack#35783).
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const menuOf = (tab: RecordTab) => !!onArrange && !!tab.arrange;
  // A hidden tab leaves the row with its menu: the focus goes to 「概览」.
  const hidRef = React.useRef(false);

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
  // objectstack#35595 — the trigger reads 「更多 N」, the one fold of the row.
  const moreLabel = (count: number) =>
    count > 0
      ? t('detail.recordTabsMoreTrigger', { count, defaultValue: 'More {{count}}' })
      : t('common.more', { defaultValue: 'More' });
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
          const arrange = menuOf(tab) ? tab.arrange! : null;
          const button = (
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
              data-record-tab-empty={isEmptyRecordTab(tab) ? '' : undefined}
              onClick={() => {
                if (!active) onSelect(tab.id);
              }}
              // A related tab is its menu's trigger, which takes Enter and
              // Space; on a tab not yet open they open the tab instead.
              onKeyDown={
                arrange && !active
                  ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSelect(tab.id);
                    }
                  : undefined
              }
            >
              <TabFace tab={tab} menu={!!arrange && active} />
            </button>
          );
          if (!arrange) return button;
          const item = (edit: RecordTabArrangeEdit, label: string, icon: React.ReactNode, enabled = true) => (
            <DropdownMenuItem
              className="gap-2"
              disabled={!enabled}
              data-record-tab-arrange={edit}
              onSelect={() => {
                hidRef.current = edit === 'hide';
                onArrange!(tab.id, edit);
              }}
            >
              {icon}
              {label}
            </DropdownMenuItem>
          );
          return (
            <DropdownMenu
              key={tab.id}
              open={menuFor === tab.id}
              onOpenChange={(open) => setMenuFor(open && active ? tab.id : null)}
            >
              <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-36"
                data-record-tab-arrange-menu={tab.id}
                onCloseAutoFocus={(event) => {
                  if (!hidRef.current) return;
                  hidRef.current = false;
                  event.preventDefault();
                  if (tabs[0]) tabRefs.current.get(tabs[0].id)?.focus();
                }}
              >
                {item('move-before', t('detail.recordTabMoveBefore', { defaultValue: 'Move left' }), <ArrowLeft className="h-3.5 w-3.5" />, arrange.before)}
                {item('move-after', t('detail.recordTabMoveAfter', { defaultValue: 'Move right' }), <ArrowRight className="h-3.5 w-3.5" />, arrange.after)}
                {item('hide', t('detail.relatedCardHide', { defaultValue: 'Hide' }), <EyeOff className="h-3.5 w-3.5" />)}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                TAB_CLASS,
                'min-w-11 justify-center gap-0.5 rounded-t-sm border-transparent text-muted-foreground hover:text-foreground focus-visible:outline-none sm:min-w-0 focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label={
                moreCount > 0 ? t('detail.recordTabsMore', { count: moreCount, defaultValue: '{{count}} more tabs' }) : undefined
              }
              data-record-tab-more={moreCount}
            >
              <span>{moreLabel(moreCount)}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            {overflow.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                className="justify-between gap-3"
                data-record-tab-menu-item={tab.id}
                data-record-tab-empty={isEmptyRecordTab(tab) ? '' : undefined}
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
                    data-record-tab-empty={isEmptyRecordTab(tab) ? '' : undefined}
                    onSelect={() => onSelect(tab.id)}
                  >
                    <TabFace tab={tab} />
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {onResetArrangement && (
              <>
                {moreCount > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem className="gap-2" data-record-tab-reset="" onSelect={onResetArrangement}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('detail.relatedRestoreDefaultOrder', { defaultValue: 'Restore default order' })}
                </DropdownMenuItem>
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
              <TabFace tab={tab} menu={menuOf(tab) && tab.id === activeTabId} />
            </span>
          ))}
          <span className={cn(TAB_CLASS, 'min-w-11 justify-center gap-0.5 border-transparent sm:min-w-0')} data-record-tab-measure-more="">
            <span>{moreLabel(tabs.length + hiddenTabs.length)}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
};
