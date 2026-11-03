// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioItemHeader — the item header row and tab row at the top of every
 * Studio pillar's content column (objectui#12459, epic objectui#12446).
 *
 * One row: an icon tile, the item's label at 18 px, its machine name as a
 * mono chip, optional kind chips, the item's status chip, a muted meta slot,
 * and a right-aligned actions slot. Under it, when the pillar has tabs, a
 * 36 px tab row whose active tab carries a 2 px primary underline; without
 * tabs the header keeps 12 px of bottom padding so the body starts at the
 * same rhythm. The pillar decides what each slot holds; this file decides
 * where everything sits.
 *
 * objectui#12524 — the status chip ("Unpublished draft") has one place in
 * every pillar: right after the identity (title, api-name chip, kind chips),
 * before the meta, never in the actions slot, which holds actions only. The
 * pillar passes the status as data and this file draws the chip, so no
 * pillar places or styles it itself. The identity chips sit in one
 * `contents` wrapper, always rendered: it draws no box, so the layout is
 * unchanged, and the status chip is the same child of the same row in every
 * pillar whatever identity chips the pillar shows. The title stays a direct
 * child of the row.
 *
 * objectui#12611 — on a narrow content column the row gives way in one
 * order: the meta slot first, then the status chip's text (its icon stays,
 * the text is in its tooltip), and the title truncates last. The tab row
 * never wraps a label: it scrolls sideways, fades the edge with more tabs
 * past it, and brings the active tab into view. Every width rule measures
 * the header's own row (`studio-tokens.ts`), never the viewport: the column
 * narrows with the rail and the aside, not with the window.
 *
 * objectui#12707 — a chip at the tab row's end (the read-only link) folds to
 * its icon when the row cannot hold it whole: the tab row tells its children
 * which row they sit in, and `useStudioTabRowFold` measures that row.
 *
 * objectui#12791 — a long api-name chip gives way before the title: it
 * truncates first, its full name in its tooltip (the status chip's
 * mechanism), and the title truncates last. The chip keeps its place; the
 * `chips` after it stay whole.
 *
 * objectui#12897 — the actions slot never shrinks, so on a narrow row it
 * could take every pixel the title had (an Interfaces leaf at a 1010 px
 * window with the copilot open: a 422 px row, 317 px of actions, a 0 px
 * title). The fold of objectui#12707 now holds in the title row too: a chip
 * that folds by `useStudioTabRowFold` folds to its icon when the title would
 * otherwise be cut, so it gives way before the title does. A title that is
 * still cut says its whole text in its tooltip.
 *
 * objectstack#29693 — the title keeps a readable width: its first twelve
 * characters (its whole text when shorter). When the row cannot give it that,
 * the identity chips (the api-name chip and the pillar's `chips`) and the item
 * tools fold into the ⋯ menu, so the title is not the first thing to go. The
 * pillar says where they go (`foldMenu`): into its own ⋯ menu, which mounts
 * `StudioItemHeaderFoldedItems`, or into a ⋯ the header draws at the end of
 * the actions. The status chip stays in the row (its text already folds, and
 * its icon says a draft is there). Folded, the row's boxes fit the row, so
 * the ⋯ trigger stays inside the column, not under the right panel. Like
 * every rule here, it measures the header's own row, never the viewport.
 */

import * as React from 'react';
import { MoreHorizontal, PencilLine } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@object-ui/components';
import {
  STUDIO_API_CHIP,
  STUDIO_HEADER_ICON_BUTTON,
  STUDIO_ICON_TILE,
  STUDIO_ITEM_HEADER,
  STUDIO_ITEM_META_FOLD,
  STUDIO_ITEM_ROW,
  STUDIO_ITEM_TITLE,
  STUDIO_META,
  STUDIO_STATUS_TEXT_FOLD,
  STUDIO_TAB,
  STUDIO_TAB_ACTIVE,
  STUDIO_TAB_IDLE,
  STUDIO_TAB_ROW,
} from './studio-tokens.js';

/** The item's status, drawn by the header as one amber chip (objectui#12524). */
export interface StudioItemStatus {
  /** The chip's text. */
  label: string;
  /** A longer sentence for the tooltip. */
  title?: string;
}

/**
 * The amber status chip. The header draws it from `status`; it is exported
 * for the one place that shows the same status outside a title row (the
 * Access set page's tab row).
 *
 * objectui#12611 — a pencil glyph leads the text, and the label and its
 * longer sentence are the chip's tooltip (the objectui#12303 pattern: a
 * focusable trigger, the sentence as its accessible description). With
 * `fold`, which the header passes, the text yields on a narrow row and the
 * glyph stays; the text stays in the accessible name.
 */
export function StudioStatusChip({
  label,
  title,
  fold = false,
}: StudioItemStatus & { fold?: boolean }): React.ReactElement {
  const descriptionId = React.useId();
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="studio-item-status"
            tabIndex={0}
            aria-describedby={title ? descriptionId : undefined}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
          >
            <PencilLine className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span data-slot="status-text" className={fold ? STUDIO_STATUS_TEXT_FOLD : undefined}>
              {label}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" data-testid="studio-item-status-tooltip">
          <p className="font-medium">{label}</p>
          {title && <p className="mt-0.5">{title}</p>}
        </TooltipContent>
      </Tooltip>
      {/* Beside the chip, not in it: the chip's text stays its label alone. */}
      {title && (
        <span id={descriptionId} hidden>
          {title}
        </span>
      )}
    </TooltipProvider>
  );
}

/**
 * objectui#12791 — the item's machine name as a mono chip. On a narrow row it
 * truncates before the title does (`STUDIO_API_CHIP`), so the whole name is
 * its tooltip, as the status chip's folded text is: a focusable trigger, the
 * name as the tooltip's text. The chip's own text stays the whole name.
 */
function StudioApiChip({ apiName }: { apiName: string }): React.ReactElement {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <code data-testid="studio-item-api-name" tabIndex={0} className={STUDIO_API_CHIP}>
            {apiName}
          </code>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs break-all font-mono" data-testid="studio-item-api-name-tooltip">
          {apiName}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Which edge of a scrolled tab row has tabs past it, for `STUDIO_TAB_ROW`'s
 * fades (objectui#12611): `none`, `start`, `end` or `both`.
 */
function useTabRowFade(ref: React.RefObject<HTMLElement | null>): 'none' | 'start' | 'end' | 'both' {
  const [fade, setFade] = React.useState<'none' | 'start' | 'end' | 'both'>('none');
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const before = el.scrollLeft > 1;
    const after = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    setFade(before && after ? 'both' : before ? 'start' : after ? 'end' : 'none');
  }, [ref]);
  // Every render: the tabs a pillar passes can change without the row resizing.
  React.useEffect(measure);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [ref, measure]);
  return fade;
}

/**
 * The row a foldable chip sits in: the tab row (objectui#12707), or the title
 * row with its title (objectui#12897); `null` outside the header.
 */
type StudioFoldRow =
  | { kind: 'tabs'; row: React.RefObject<HTMLElement | null> }
  | { kind: 'title'; row: React.RefObject<HTMLElement | null>; title: React.RefObject<HTMLElement | null> };
const StudioFoldRowContext = React.createContext<StudioFoldRow | null>(null);

/**
 * objectui#12897 — the room the title row leaves its title: the row's width
 * less every other box it draws and the gaps between them. The meta slot is
 * not counted: it takes only what the row has left (objectui#12611).
 */
function titleRoom(row: HTMLElement, title: HTMLElement): number {
  const boxes = Array.from(row.children)
    .flatMap((el) => (getComputedStyle(el).display === 'contents' ? Array.from(el.children) : [el]))
    .filter((el) => getComputedStyle(el).display !== 'none');
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  let others = 0;
  for (const el of boxes) {
    if (el !== title && (el as HTMLElement).dataset?.slot !== 'meta') others += el.getBoundingClientRect().width;
  }
  return row.clientWidth - others - gap * Math.max(0, boxes.length - 1);
}

/**
 * objectui#12707 — whether a chip at the tab row's end folds to its icon.
 *
 * The chip folds when the row cannot hold the tabs and the chip's whole text,
 * so it is never cut mid-word at the row's scrolled edge; it unfolds as soon
 * as the row has room again. The rule measures the tab row's own width, never
 * the viewport: the row narrows with the rail and the aside, not with the
 * window.
 *
 * objectui#12897 — in the title row (the actions slot) the chip folds when
 * the room the row leaves the title, with the chip whole, is less than the
 * title's whole text: the chip gives way before the title is cut, and
 * unfolds once the title fits beside it whole. Outside the header it never
 * folds.
 *
 * `item` is the chip; the row's child that holds it is its slot. `text` is
 * what the full chip says: a new text is a new width, so the chip unfolds
 * and is measured again.
 */
export function useStudioTabRowFold(item: React.RefObject<HTMLElement | null>, text: string): boolean {
  const fold = React.useContext(StudioFoldRowContext);
  const [folded, setFolded] = React.useState(false);
  /** The whole chip's width, read while it shows its text, and the text it was read for. */
  const full = React.useRef<{ text: string; width: number } | null>(null);
  /** The latest measure, for the observer: it reads this render's state. */
  const measureRef = React.useRef<() => void>(() => {});
  // Every render: the tabs beside the chip can change without the row resizing.
  React.useLayoutEffect(() => {
    const measure = () => {
      const nav = fold?.row.current;
      const el = item.current;
      if (!nav || !el) return;
      let slot: HTMLElement = el;
      while (slot.parentElement && slot.parentElement !== nav) slot = slot.parentElement;
      if (slot.parentElement !== nav) return;
      const width = el.getBoundingClientRect().width;
      if (!folded) full.current = { text, width };
      // A new text is a new width: show it whole and read it again.
      if (full.current?.text !== text) return setFolded(false);
      if (fold?.kind === 'title') {
        const title = fold.title.current;
        if (!title) return;
        // The room the title would have with the chip whole, against its whole text.
        const room = titleRoom(nav, title) - (full.current.width - width);
        return setFolded(room + 0.5 < title.scrollWidth);
      }
      const navLeft = nav.getBoundingClientRect().left - nav.scrollLeft;
      let tabsEnd = 0;
      for (const child of Array.from(nav.children)) {
        if (child !== slot) tabsEnd = Math.max(tabsEnd, child.getBoundingClientRect().right - navLeft);
      }
      const navStyle = getComputedStyle(nav);
      const gap = parseFloat(navStyle.columnGap) || 0;
      const slotPad = parseFloat(getComputedStyle(slot).paddingLeft) || 0;
      const room = nav.clientWidth - (parseFloat(navStyle.paddingRight) || 0);
      setFolded(tabsEnd + gap + slotPad + full.current.width > room + 0.5);
    };
    measureRef.current = measure;
    measure();
  });
  React.useEffect(() => {
    // A child's layout effect runs before the row's own ref is attached, so
    // the first render measures here, once the row is there.
    measureRef.current();
    const nav = fold?.row.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(nav);
    for (const child of Array.from(nav.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [fold]);
  return folded;
}

/**
 * objectui#12897 — the title's whole text while the title is cut (its text
 * wider than its box), else `null`.
 */
function useCutTitle(ref: React.RefObject<HTMLElement | null>): string | null {
  const [cut, setCut] = React.useState<string | null>(null);
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCut(el.scrollWidth > el.clientWidth + 0.5 ? (el.textContent ?? '').trim() || null : null);
  }, [ref]);
  // Every render: the title's text can change without its box resizing.
  React.useLayoutEffect(measure);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, measure]);
  return cut;
}

/** objectstack#29693 — how many of the title's characters it keeps readable. */
export const STUDIO_TITLE_READABLE_CHARS = 12;

/**
 * objectstack#29693 — the width of the title's first
 * {@link STUDIO_TITLE_READABLE_CHARS} visible characters (a reader-only span
 * is not counted), capped at its whole text; 0 where the page cannot measure
 * a text range (no layout).
 */
function readableTitleWidth(title: HTMLElement): number {
  if (typeof document.createRange !== 'function') return 0;
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.sr-only') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let first: Node | null = null;
  let last: Node | null = null;
  let lastOffset = 0;
  let count = 0;
  for (let node = walker.nextNode(); node && count < STUDIO_TITLE_READABLE_CHARS; node = walker.nextNode()) {
    const chars = Array.from(node.textContent ?? '');
    if (chars.length === 0) continue;
    const take = Math.min(chars.length, STUDIO_TITLE_READABLE_CHARS - count);
    first ??= node;
    last = node;
    // Code points, so a character outside the BMP is one character, not two.
    lastOffset = chars.slice(0, take).join('').length;
    count += take;
  }
  if (!first || !last) return 0;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, lastOffset);
  const width = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect().width : 0;
  return Math.min(width, title.scrollWidth);
}

/** The gap a box takes in the flex row that lays it out (a `contents` box's own parent does not). */
function gapBeside(el: Element): number {
  let parent = el.parentElement;
  while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
  return parent ? parseFloat(getComputedStyle(parent).columnGap) || 0 : 0;
}

/** The width the title row's foldable boxes take, each with its gap. */
function foldableWidth(row: HTMLElement): number {
  const boxes = [
    ...Array.from(row.querySelector('[data-slot="identity-chips"]')?.children ?? []),
    ...Array.from(row.querySelectorAll('[data-studio-fold]')),
  ];
  let width = 0;
  for (const el of boxes) {
    if (getComputedStyle(el).display === 'none') continue;
    width += el.getBoundingClientRect().width + gapBeside(el);
  }
  return width;
}

/** objectstack#29693 — one item tool, as it reads in the ⋯ menu while the header is folded. */
export interface StudioFoldedTool {
  /** The tool's id: the menu item's test id is `studio-item-tool-<id>`, the button's. */
  id: string;
  label: string;
  icon: React.ElementType;
  /** A count the button shows as a badge (references). */
  count?: number;
  onSelect: () => void;
}

interface StudioItemHeaderFoldValue {
  /** The identity chips and the item tools are in the ⋯ menu, not in the row. */
  folded: boolean;
  /** What the row folds away: the api name and the pillar's chips. */
  apiName?: string;
  chips?: React.ReactNode;
  tools: StudioFoldedTool[];
  /** The item tools hand over their menu form; `null` takes it back. */
  setTools: (tools: StudioFoldedTool[] | null) => void;
}
const StudioItemHeaderFoldContext = React.createContext<StudioItemHeaderFoldValue | null>(null);

/**
 * objectstack#29693 — the header's fold, for the item tools: whether they are
 * folded into the ⋯ menu, and where they hand over their menu form. `null`
 * outside a header, or in a header whose pillar names no `foldMenu`.
 */
export function useStudioItemHeaderFold(): Pick<StudioItemHeaderFoldValue, 'folded' | 'setTools'> | null {
  return React.useContext(StudioItemHeaderFoldContext);
}

/**
 * objectstack#29693 — what the title row folded away, at the top of a ⋯
 * menu: the identity chips as they read in the row (one entry), then the item
 * tools as menu items, then a separator before the menu's own items. Nothing while the
 * row holds them. A pillar whose actions end with its own ⋯ menu mounts this
 * in that menu's content and passes `foldMenu="pillar"`.
 */
export function StudioItemHeaderFoldedItems({ separator = true }: { separator?: boolean }): React.ReactElement | null {
  const fold = React.useContext(StudioItemHeaderFoldContext);
  if (!fold?.folded) return null;
  const hasChips = !!fold.apiName || !!fold.chips;
  if (!hasChips && fold.tools.length === 0) return null;
  return (
    <>
      {/* One menu entry, reachable by the keys like the others; choosing it
          keeps the menu open, so a chip with its own control (the override
          chip) is used from here as from the row. */}
      {hasChips && (
        <DropdownMenuItem
          data-testid="studio-item-header-folded-chips"
          onSelect={(event) => event.preventDefault()}
          className="flex flex-wrap items-center gap-1.5"
        >
          {fold.apiName && <StudioApiChip apiName={fold.apiName} />}
          {fold.chips}
        </DropdownMenuItem>
      )}
      {fold.tools.map(({ id, label, icon: Icon, count, onSelect }) => (
        <DropdownMenuItem key={id} data-testid={`studio-item-tool-${id}`} onSelect={onSelect}>
          <Icon className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && <span className="ml-2 text-[11px] text-muted-foreground">{count}</span>}
        </DropdownMenuItem>
      ))}
      {separator && <DropdownMenuSeparator />}
    </>
  );
}

/**
 * objectstack#29693 — how far the title row has folded: `0` nothing; `1` the
 * identity chips and the item tools are in the ⋯ menu; `2` the header's
 * labelled actions show their icon alone too (`STUDIO_FOLD_LABEL`).
 */
type TitleRowFoldStage = 0 | 1 | 2;

/** The width the labelled actions' labels take (`data-studio-fold-label`). */
function foldLabelWidth(row: HTMLElement): number {
  let width = 0;
  for (const el of Array.from(row.querySelectorAll('[data-studio-fold-label]'))) width += el.getBoundingClientRect().width;
  return width;
}

/**
 * objectstack#29693 — how far the title row folds so the title keeps its
 * readable width. Each stage is taken while the room the row leaves the title
 * is less than that width: first the identity chips and the item tools leave
 * for the ⋯ menu, then the labelled actions drop their labels. Each step reads
 * the room it freed (the room after it, less the room before), so it is given
 * back only once the title would keep its width without that room: the step
 * never undoes itself the moment it is taken. A title still short after both
 * is cut, its whole text in its tooltip (objectui#12897); the ⋯ stays in the
 * row.
 */
function useTitleRowFold(
  enabled: boolean,
  row: React.RefObject<HTMLElement | null>,
  title: React.RefObject<HTMLElement | null>,
): TitleRowFoldStage {
  const [stage, setStage] = React.useState<TitleRowFoldStage>(0);
  /**
   * `freed[0]`: the room the first stage freed; `freed[1]`: the second's.
   * `pending`: a step just taken, with the room before it, read on the next
   * measure.
   */
  const memo = React.useRef<{ freed: [number, number]; pending: { step: 0 | 1; before: number } | null }>({
    freed: [0, 0],
    pending: null,
  });
  const measureRef = React.useRef<() => void>(() => {});
  // Every render: the chips and the actions can change without the row resizing.
  React.useLayoutEffect(() => {
    const measure = () => {
      const rowEl = row.current;
      const titleEl = title.current;
      if (!enabled) return setStage(0);
      if (!rowEl || !titleEl) return;
      const readable = readableTitleWidth(titleEl);
      if (readable <= 0) return;
      const room = titleRoom(rowEl, titleEl);
      const m = memo.current;
      if (m.pending) {
        m.freed[m.pending.step] = Math.max(0, room - m.pending.before);
        m.pending = null;
      }
      const short = (width: number) => width + 0.5 < readable;
      const fold = (next: 1 | 2) => {
        m.pending = { step: next === 1 ? 0 : 1, before: room };
        if (next === 2 && stage === 0) m.freed[0] = 0;
        setStage(next);
      };
      if (stage === 0) {
        if (!short(room)) return;
        if (foldableWidth(rowEl) > 0) return fold(1);
        if (foldLabelWidth(rowEl) > 0) return fold(2);
        return;
      }
      if (stage === 1) {
        // A pixel of margin, so a row exactly at the edge does not flip.
        if (!short(room - m.freed[0] - 1)) return setStage(0);
        if (short(room) && foldLabelWidth(rowEl) > 0) fold(2);
        return;
      }
      if (short(room - m.freed[1] - 1)) return;
      if (m.freed[0] > 0) return setStage(short(room - m.freed[1] - m.freed[0] - 1) ? 1 : 0);
      setStage(0);
    };
    measureRef.current = measure;
    measure();
  });
  React.useEffect(() => {
    const rowEl = row.current;
    if (!rowEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(rowEl);
    if (title.current) observer.observe(title.current);
    return () => observer.disconnect();
  }, [row, title]);
  return enabled ? stage : 0;
}

export interface StudioItemHeaderProps {
  /** The icon component for the tile; omitted when the pillar has nothing open. */
  icon?: React.ElementType;
  /** The item's label. */
  title: React.ReactNode;
  /** Attributes for the title element (a test id, a tooltip with the machine name). */
  titleProps?: React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string };
  /** The item's machine name, as a mono chip. */
  apiName?: string;
  /** Kind chips and badges after the name. Not the status: that is `status`. */
  chips?: React.ReactNode;
  /** The item's status ("Unpublished draft"), after the chips and before the meta. */
  status?: StudioItemStatus;
  /** Muted meta text (a field count, a trigger summary). */
  meta?: React.ReactNode;
  /** The right-aligned actions slot. */
  actions?: React.ReactNode;
  /** The tab row; built from `StudioTab`. */
  tabs?: React.ReactNode;
  /** A leading control before the tile (the mobile rail toggle). */
  leading?: React.ReactNode;
  /**
   * objectstack#29693 — where the identity chips and the item tools go when
   * the title would drop below its readable width. `'pillar'`: the pillar's
   * own ⋯ menu, the last of its `actions`, which mounts
   * `StudioItemHeaderFoldedItems`. An object: a ⋯ the header draws at the end
   * of the actions while they are folded, with this accessible name and test
   * id. Omitted: nothing folds.
   */
  foldMenu?: 'pillar' | { label: string; testId?: string };
  /**
   * objectstack#29691 (ADR-0146 D3) — one line under the title row, above the
   * tabs: where this item's edits are saved. Outside the title row, so the
   * fold never measures it.
   */
  note?: React.ReactNode;
  testId?: string;
  className?: string;
}

export function StudioItemHeader({
  icon: Icon,
  title,
  titleProps,
  apiName,
  chips,
  status,
  meta,
  actions,
  tabs,
  leading,
  foldMenu,
  note,
  testId,
  className,
}: StudioItemHeaderProps): React.ReactElement {
  const tabRowRef = React.useRef<HTMLElement | null>(null);
  const fade = useTabRowFade(tabRowRef);
  const titleRowRef = React.useRef<HTMLDivElement | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const cutTitle = useCutTitle(titleRef);
  // State, not a memo: the fold's effect keys on these (AGENTS.md #10).
  const [tabFold] = React.useState<StudioFoldRow>(() => ({ kind: 'tabs', row: tabRowRef }));
  const [titleFold] = React.useState<StudioFoldRow>(() => ({ kind: 'title', row: titleRowRef, title: titleRef }));
  // objectui#12897 — a cut title says its whole text in its tooltip, before
  // the tooltip the pillar gives it (the machine name).
  const titleTooltip = cutTitle ? [cutTitle, titleProps?.title].filter(Boolean).join('\n') : titleProps?.title;
  // objectstack#29693 — the identity chips and the item tools fold into the
  // ⋯ menu before the title drops below its readable width.
  const foldStage = useTitleRowFold(foldMenu !== undefined, titleRowRef, titleRef);
  const folded = foldStage > 0;
  const [tools, setToolsState] = React.useState<StudioFoldedTool[]>([]);
  const setTools = React.useCallback((next: StudioFoldedTool[] | null) => setToolsState(next ?? []), []);
  const foldValue = React.useMemo<StudioItemHeaderFoldValue | null>(
    () => (foldMenu === undefined ? null : { folded, apiName, chips, tools, setTools }),
    [foldMenu, folded, apiName, chips, tools, setTools],
  );
  const ownMenu = typeof foldMenu === 'object' ? foldMenu : null;
  const hasFolded = folded && (!!apiName || !!chips || tools.length > 0);
  return (
    <div data-testid={testId} className={cn(STUDIO_ITEM_HEADER, !tabs && 'pb-3', className)}>
      <div ref={titleRowRef} className={STUDIO_ITEM_ROW}>
        {leading}
        {Icon && (
          <span className={STUDIO_ICON_TILE}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h1 {...titleProps} ref={titleRef} title={titleTooltip} className={cn(STUDIO_ITEM_TITLE, titleProps?.className)}>
          {title}
        </h1>
        <span className="contents" data-slot="identity-chips">
          {!folded && apiName && <StudioApiChip apiName={apiName} />}
          {!folded && chips}
        </span>
        {status && <StudioStatusChip {...status} fold />}
        {meta && (
          <span data-slot="meta" className={cn(STUDIO_META, STUDIO_ITEM_META_FOLD)}>
            {meta}
          </span>
        )}
        {(actions || (ownMenu && hasFolded)) && (
          <div
            className="group/item-actions ml-auto flex shrink-0 items-center gap-2"
            data-fold={foldStage === 2 ? 'labels' : undefined}
          >
            <StudioItemHeaderFoldContext.Provider value={foldValue}>
              <StudioFoldRowContext.Provider value={titleFold}>{actions}</StudioFoldRowContext.Provider>
              {ownMenu && hasFolded && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid={ownMenu.testId}
                      aria-label={ownMenu.label}
                      title={ownMenu.label}
                      className={STUDIO_HEADER_ICON_BUTTON}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <StudioItemHeaderFoldedItems separator={false} />
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </StudioItemHeaderFoldContext.Provider>
          </div>
        )}
      </div>
      {note && (
        <p data-slot="item-note" className="-mt-1 truncate pb-1 text-[11px] leading-4 text-muted-foreground">
          {note}
        </p>
      )}
      {tabs && (
        <nav ref={tabRowRef} data-fade={fade} className={STUDIO_TAB_ROW}>
          <StudioFoldRowContext.Provider value={tabFold}>{tabs}</StudioFoldRowContext.Provider>
        </nav>
      )}
    </div>
  );
}

export interface StudioTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  children: React.ReactNode;
}

/**
 * One underline tab. `aria-pressed` carries the active state for tests and
 * readers. Forwards its ref so a menu trigger can wrap it (`asChild`).
 *
 * objectui#12611 — a tab that becomes active scrolls itself into view, so on
 * a tab row narrower than its tabs the open one is never past the edge.
 */
export const StudioTab = React.forwardRef<HTMLButtonElement, StudioTabProps>(function StudioTab(
  { active = false, className, children, ...buttonProps },
  ref,
) {
  const ownRef = React.useRef<HTMLButtonElement | null>(null);
  const setRef = React.useCallback(
    (el: HTMLButtonElement | null) => {
      ownRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  React.useEffect(() => {
    if (active) ownRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <button
      type="button"
      aria-pressed={active}
      {...buttonProps}
      ref={setRef}
      className={cn(STUDIO_TAB, active ? STUDIO_TAB_ACTIVE : STUDIO_TAB_IDLE, className)}
    >
      {children}
    </button>
  );
});
