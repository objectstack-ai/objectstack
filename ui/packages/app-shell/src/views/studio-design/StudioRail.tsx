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
 */

import * as React from 'react';
import { Plus, Search } from 'lucide-react';
import { cn } from '@object-ui/components';
import {
  STUDIO_RAIL_COUNT,
  STUDIO_RAIL_GROUP,
  STUDIO_RAIL_HEADER,
  STUDIO_RAIL_HEADING,
  STUDIO_RAIL_ROW,
  STUDIO_RAIL_ROW_ACTIVE,
  STUDIO_RAIL_ROW_IDLE,
  STUDIO_RAIL_ROW_INDENT,
  STUDIO_RAIL_SEARCH,
  STUDIO_RAIL_WIDTH,
} from './studio-tokens.js';

export interface StudioRailSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
  /** Accessible name for the input; falls back to the placeholder. */
  label?: string;
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
  return (
    <nav
      data-testid={testId}
      aria-label={rest['aria-label']}
      className={cn(
        'flex shrink-0 flex-col border-r bg-sidebar',
        STUDIO_RAIL_WIDTH,
        isMobile && 'absolute inset-y-0 left-0 z-20 shadow-lg transition-transform duration-200',
        isMobile && !open && '-translate-x-full',
        className,
      )}
    >
      {pinned}
      <div className={STUDIO_RAIL_HEADER}>
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
        <div className="shrink-0 px-3 pb-2">
          <label htmlFor={searchId} className="sr-only">
            {search.label ?? search.placeholder}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <input
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
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 pt-1">{children}</div>
      {footer && <div className="shrink-0 border-t px-3 py-2">{footer}</div>}
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
  children: React.ReactNode;
}

/** One 32 px rail row. The label truncates (or wraps, when asked); the trailing slot never does. */
export const StudioRailRow = React.forwardRef<HTMLButtonElement, StudioRailRowProps>(function StudioRailRow(
  { active = false, icon, trailing, indent = false, wrap = false, className, children, ...buttonProps },
  ref,
) {
  return (
    <button
      type="button"
      {...buttonProps}
      ref={ref}
      className={cn(
        STUDIO_RAIL_ROW,
        wrap && 'h-auto min-h-8 py-1.5',
        active ? STUDIO_RAIL_ROW_ACTIVE : STUDIO_RAIL_ROW_IDLE,
        indent && STUDIO_RAIL_ROW_INDENT,
        className,
      )}
    >
      {icon}
      <span className={cn('min-w-0 flex-1', wrap ? 'break-words' : 'truncate')}>{children}</span>
      {trailing}
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
    <div data-testid={testId}>
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
