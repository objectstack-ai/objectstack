// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioRail — the one rail every Studio pillar mounts at the left of its
 * content column (objectui#12459, epic objectui#12446).
 *
 * The frame is shared; the rows are each pillar's own. A pillar hands in its
 * heading, an optional count, an optional add button, an optional search, an
 * optional pinned block above the heading (Access pins "Record sharing"), an
 * optional footer (a legend), and the list as children. The mobile overlay
 * posture (`isMobile` + `open`) is the one the pillars already had: the rail
 * slides in over the canvas below the mobile breakpoint; the backdrop that
 * closes it stays with the pillar, outside this element.
 *
 * The width is `STUDIO_RAIL_WIDTH` in every pillar and every mode, with no
 * override: an Interfaces rail that widened while its navigation was being
 * edited moved the content column on every Edit and Done (objectui#12519).
 *
 * objectstack#26733 — a search that matches nothing is the rail's to say, once,
 * for every pillar: the pillar filters its own list and hands in how many rows
 * the query left (`search.matchCount`); the rail then names the query under the
 * box and offers to clear it. A blank query, or a list that is empty before any
 * search (`count === 0`), never shows that line: the pillar's own empty state
 * speaks there.
 *
 * objectstack#35061 — the narrow form (`studio-tokens.ts` says when it
 * applies): 52 px, each row one character (`railAbbreviation`) with its full
 * name on hover and as its accessible name, groups as a rule. A 「»」 bar at
 * the top floats the whole rail over the content column; a picked row,
 * Escape (focus back on 「»」) or a click outside puts it back. Both forms are
 * the same DOM, so a pillar's rows and their handlers are untouched. Under
 * the mobile breakpoint the rail keeps its own overlay and never narrows.
 */

import * as React from 'react';
import { ChevronsLeft, ChevronsRight, Plus, Search } from 'lucide-react';
import { cn } from '@object-ui/components';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import {
  STUDIO_RAIL_COUNT,
  STUDIO_RAIL_FLOAT_BAR,
  STUDIO_RAIL_FLOATING,
  STUDIO_RAIL_GROUP,
  STUDIO_RAIL_GROUP_NARROW,
  STUDIO_RAIL_HEADER,
  STUDIO_RAIL_HEADING,
  STUDIO_RAIL_LIST_NARROW,
  STUDIO_RAIL_NARROW_HIDDEN,
  STUDIO_RAIL_NARROW_WIDTH,
  STUDIO_RAIL_ROW,
  STUDIO_RAIL_ROW_ABBR,
  STUDIO_RAIL_ROW_ACTIVE,
  STUDIO_RAIL_ROW_IDLE,
  STUDIO_RAIL_ROW_INDENT,
  STUDIO_RAIL_ROW_LABEL_NARROW,
  STUDIO_RAIL_ROW_NARROW,
  STUDIO_RAIL_ROW_PART,
  STUDIO_RAIL_SEARCH,
  STUDIO_RAIL_WIDTH,
} from './studio-tokens.js';

/**
 * objectstack#35061 — the one character a row shows in the rail's narrow form:
 * the first character of its name (a whole grapheme, so an emoji or an accented
 * letter stays one), upper-cased in the display locale. Empty for a blank name.
 * Pure + exported for tests.
 */
export function railAbbreviation(name: string | undefined, locale: string): string {
  const text = name?.trim() ?? '';
  if (!text) return '';
  // Typed here as `romanizeHan.ts` types it: the package's `lib` predates `Intl.Segmenter`.
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  const first = Segmenter
    ? new Segmenter(locale, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next().value?.segment
    : undefined;
  return (first ?? Array.from(text)[0] ?? '').toLocaleUpperCase(locale);
}

type GraphemeSegmenterCtor = new (
  locale: string,
  options: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> };

/** The marker the narrow form keeps in the list: rows and groups carry it, anything else is left out. */
const RAIL_ITEM = { 'data-studio-rail-item': '' } as const;

export interface StudioRailSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
  /** Accessible name for the input; falls back to the placeholder. */
  label?: string;
  /**
   * How many rows the current query leaves in the list. Zero, under a
   * non-blank query, makes the rail say the query matched nothing and offer to
   * clear it; undefined says nothing.
   */
  matchCount?: number;
}

export interface StudioRailProps {
  /** The rail's heading, rendered as an 11 px uppercase label. */
  heading: string;
  /** A count pill after the heading; omitted when undefined. */
  count?: number;
  /** The add button at the heading's right; omitted when undefined. */
  onAdd?: () => void;
  /** Accessible name and title of the add button. */
  addLabel?: string;
  addTestId?: string;
  /** Anything else the heading row carries at its right (an edit toggle). */
  headerExtra?: React.ReactNode;
  search?: StudioRailSearch;
  /** objectstack#28572 — a row of filters under the search (the "only customizations" toggle). */
  filters?: React.ReactNode;
  /** A block above the heading row (a pinned sibling surface). */
  pinned?: React.ReactNode;
  /** A block pinned at the bottom (a legend). */
  footer?: React.ReactNode;
  /** Mobile overlay posture, as the pillars already compute it. */
  isMobile?: boolean;
  open?: boolean;
  testId?: string;
  'aria-label'?: string;
  className?: string;
  children: React.ReactNode;
}

export function StudioRail({
  heading,
  count,
  onAdd,
  addLabel,
  addTestId,
  headerExtra,
  search,
  filters,
  pinned,
  footer,
  isMobile = false,
  open = false,
  testId,
  className,
  children,
  ...rest
}: StudioRailProps): React.ReactElement {
  const searchId = React.useId();
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const locale = useMetadataLocale();
  const searchText = search?.value.trim() ?? '';
  const noMatches = search !== undefined && search.matchCount === 0 && searchText !== '' && count !== 0;
  const navRef = React.useRef<HTMLElement | null>(null);
  const floatToggleRef = React.useRef<HTMLButtonElement | null>(null);
  // objectstack#35061 — the narrow rail floated over the content column.
  const [floating, setFloating] = React.useState(false);
  React.useEffect(() => {
    if (!floating) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setFloating(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [floating]);
  const floatLabel = t(floating ? 'engine.studio.rail.collapse' : 'engine.studio.rail.expand', locale);
  return (
    <nav
      ref={navRef}
      data-testid={testId}
      aria-label={rest['aria-label']}
      data-rail-peek={floating ? 'on' : 'off'}
      onKeyDown={(e) => {
        if (!floating || e.key !== 'Escape') return;
        e.stopPropagation();
        setFloating(false);
        floatToggleRef.current?.focus();
      }}
      onClick={(e) => {
        if (floating && (e.target as Element).closest?.('button[data-studio-rail-item]')) setFloating(false);
      }}
      className={cn(
        'group/studio-rail relative flex shrink-0 flex-col border-r bg-sidebar',
        STUDIO_RAIL_WIDTH,
        !isMobile && STUDIO_RAIL_NARROW_WIDTH,
        isMobile && 'absolute inset-y-0 left-0 z-20 shadow-lg transition-transform duration-200',
        isMobile && !open && '-translate-x-full',
        className,
      )}
    >
      <div className={cn('flex min-h-0 flex-col', floating ? STUDIO_RAIL_FLOATING : 'h-full w-full')}>
        {!isMobile && (
          <div className={STUDIO_RAIL_FLOAT_BAR}>
            <button
              ref={floatToggleRef}
              type="button"
              aria-expanded={floating}
              aria-label={floatLabel}
              title={floatLabel}
              data-testid="studio-rail-float"
              onClick={() => setFloating((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {floating ? <ChevronsLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronsRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        )}
        {pinned}
        <div className={cn(STUDIO_RAIL_HEADER, STUDIO_RAIL_NARROW_HIDDEN)}>
          <span className={cn(STUDIO_RAIL_HEADING, 'min-w-0 truncate')} title={heading}>
            {heading}
          </span>
          {count !== undefined && <span className={STUDIO_RAIL_COUNT}>{count}</span>}
          <span className="ml-auto flex items-center gap-1">
            {headerExtra}
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                aria-label={addLabel}
                title={addLabel}
                data-testid={addTestId}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
                <span className="sr-only">{addLabel}</span>
              </button>
            )}
          </span>
        </div>
        {search && (
          <div className={cn('shrink-0 px-3 pb-2', STUDIO_RAIL_NARROW_HIDDEN)}>
            <label htmlFor={searchId} className="sr-only">
              {search.label ?? search.placeholder}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                id={searchId}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder}
                data-testid={search.testId}
                className={STUDIO_RAIL_SEARCH}
              />
            </div>
          </div>
        )}
        {filters && <div className={cn('contents', STUDIO_RAIL_NARROW_HIDDEN)}>{filters}</div>}
        <div className={cn('min-h-0 flex-1 overflow-auto px-2 pb-3 pt-1', STUDIO_RAIL_LIST_NARROW)}>
          {children}
          {noMatches && (
            <div data-testid="studio-rail-no-matches" className="px-2 py-3 text-[11px] text-muted-foreground">
              <p>{tFormat('engine.list.emptyQuery', locale, { query: searchText })}</p>
              <button
                type="button"
                data-testid="studio-rail-clear-search"
                onClick={() => {
                  search?.onChange('');
                  searchRef.current?.focus();
                }}
                className="mt-1 rounded-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t('engine.studio.rail.clearSearch', locale)}
              </button>
            </div>
          )}
        </div>
        {footer && <div className={cn('shrink-0 border-t px-3 py-2', STUDIO_RAIL_NARROW_HIDDEN)}>{footer}</div>}
      </div>
    </nav>
  );
}

export interface StudioRailRowProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  active?: boolean;
  /** A 16 px glyph in the leading slot. */
  icon?: React.ReactNode;
  /** The trailing slot: a status dot, a kind tag, a count. */
  trailing?: React.ReactNode;
  /** Indent one level under a group header. */
  indent?: boolean;
  /** Let a long label wrap onto a second line instead of truncating (the objectui#11794 flow rail). */
  wrap?: boolean;
  /**
   * objectstack#35061 — the row's full name, for the narrow form's one
   * character and its hover; a string `children` is used when this is absent.
   * With neither, the narrow form keeps the row's icon.
   */
  name?: string;
  children: React.ReactNode;
}

/** One 32 px rail row. The label truncates (or wraps, when asked); the trailing slot never does. */
export const StudioRailRow = React.forwardRef<HTMLButtonElement, StudioRailRowProps>(function StudioRailRow(
  { active = false, icon, trailing, indent = false, wrap = false, name, className, children, ...buttonProps },
  ref,
) {
  const locale = useMetadataLocale();
  const fullName = name ?? (typeof children === 'string' ? children : undefined);
  const abbr = railAbbreviation(fullName, locale);
  return (
    <button
      type="button"
      {...RAIL_ITEM}
      // The narrow form's hover: a row's own title when it has one, else its name.
      title={fullName}
      data-abbr={abbr || undefined}
      {...buttonProps}
      ref={ref}
      className={cn(
        STUDIO_RAIL_ROW,
        wrap && 'h-auto min-h-8 py-1.5',
        active ? STUDIO_RAIL_ROW_ACTIVE : STUDIO_RAIL_ROW_IDLE,
        indent && STUDIO_RAIL_ROW_INDENT,
        STUDIO_RAIL_ROW_NARROW,
        abbr && STUDIO_RAIL_ROW_ABBR,
        className,
      )}
    >
      {icon && <span className={abbr ? STUDIO_RAIL_ROW_PART : 'contents'}>{icon}</span>}
      <span className={cn('min-w-0 flex-1', wrap ? 'break-words' : 'truncate', STUDIO_RAIL_ROW_LABEL_NARROW)}>{children}</span>
      {trailing && <span className={STUDIO_RAIL_ROW_PART}>{trailing}</span>}
    </button>
  );
});

export interface StudioRailGroupProps {
  label: string;
  count?: number;
  /** Collapsed groups render no children; the chevron turns. */
  collapsed?: boolean;
  onToggle?: () => void;
  testId?: string;
  children?: React.ReactNode;
}

/** A 28 px group header with an optional count; children indent under it. */
export function StudioRailGroup({ label, count, collapsed = false, onToggle, testId, children }: StudioRailGroupProps): React.ReactElement {
  const header = (
    <>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="font-medium normal-case tracking-normal">{count}</span>}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={cn('shrink-0 transition-transform', collapsed && '-rotate-90')}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </>
  );
  return (
    <div data-testid={testId} {...RAIL_ITEM} className={STUDIO_RAIL_GROUP_NARROW}>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className={cn(STUDIO_RAIL_GROUP, 'w-full rounded-md text-left hover:text-foreground')}>
          {header}
        </button>
      ) : (
        <div className={STUDIO_RAIL_GROUP}>{header}</div>
      )}
      {!collapsed && children}
    </div>
  );
}
