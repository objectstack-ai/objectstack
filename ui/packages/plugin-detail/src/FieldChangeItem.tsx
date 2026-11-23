/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { FieldChangeEntry } from '@object-ui/types';

export interface FieldChangeItemProps {
  /** The field change entry to render */
  change: FieldChangeEntry;
  /**
   * The field's label as the reader reads it, drawn as given (a host adds its
   * own separator, e.g. `Status:`). Absent: `change.fieldLabel`, else the
   * field key made readable.
   */
  label?: string;
  /**
   * Each side's text as the reader reads it; `null` is an empty side, drawn as
   * `emptyLabel`. Absent: the side's display value, else its value as text,
   * else empty.
   */
  oldText?: string | null;
  newText?: string | null;
  /** What an empty side reads as. */
  emptyLabel?: string;
  /** The control that shows a long value in full, and the one that clamps it again. */
  expandLabel?: string;
  collapseLabel?: string;
  className?: string;
}

/**
 * A value longer than this, or one with a line break, offers the expand
 * control even where the line has not been laid out (a test DOM, a hidden tab).
 */
export const FIELD_CHANGE_LONG_VALUE_CHARS = 48;

const isLongValue = (text: string | null): boolean =>
  text !== null && (text.includes('\n') || text.length > FIELD_CHANGE_LONG_VALUE_CHARS);

const sideOf = (display: string | undefined, value: unknown): string | null =>
  display !== undefined && display !== ''
    ? display
    : value === null || value === undefined || value === ''
      ? null
      : String(value);

/**
 * FieldChangeItem: one changed field on one line, `Label old → new`, each
 * side cut to the line. A side that does not fit, or holds more than one
 * line, offers a control that shows both sides in full; an empty side reads
 * as `emptyLabel`.
 */
export const FieldChangeItem: React.FC<FieldChangeItemProps> = ({
  change,
  label,
  oldText,
  newText,
  emptyLabel = '(empty)',
  expandLabel = 'Show more',
  collapseLabel = 'Show less',
  className,
}) => {
  const shownLabel =
    label ??
    change.fieldLabel ??
    change.field.charAt(0).toUpperCase() + change.field.slice(1).replace(/_/g, ' ');
  const before = oldText !== undefined ? oldText : sideOf(change.oldDisplayValue, change.oldValue);
  const after = newText !== undefined ? newText : sideOf(change.newDisplayValue, change.newValue);

  const [expanded, setExpanded] = React.useState(false);
  // Whether a side is wider than its line, as laid out; the length rule above
  // answers where nothing is laid out.
  const [overflows, setOverflows] = React.useState(false);
  const oldRef = React.useRef<HTMLSpanElement>(null);
  const newRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    if (expanded) return undefined;
    const measure = () => {
      const cut = (el: HTMLSpanElement | null) => !!el && el.scrollWidth > el.clientWidth;
      setOverflows(cut(oldRef.current) || cut(newRef.current));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (oldRef.current) observer.observe(oldRef.current);
    if (newRef.current) observer.observe(newRef.current);
    return () => observer.disconnect();
  }, [before, after, expanded]);
  const offersToggle = expanded || overflows || isLongValue(before) || isLongValue(after);

  const value = (text: string | null, side: 'old' | 'new', ref: React.RefObject<HTMLSpanElement | null>) => (
    <span
      ref={ref}
      className={cn(
        'min-w-0',
        expanded ? 'whitespace-pre-wrap break-words' : 'truncate',
        text === null ? 'italic text-muted-foreground' : side === 'old' ? 'text-muted-foreground line-through' : 'text-foreground',
      )}
      data-field-change-side={side}
      {...(text === null ? { 'data-field-change-empty': '' } : {})}
    >
      {text ?? emptyLabel}
    </span>
  );

  return (
    <div
      className={cn('flex min-w-0 items-baseline gap-1.5 text-sm', expanded && 'flex-wrap', className)}
      data-field-change={change.field}
      data-field-change-expanded={expanded ? 'true' : 'false'}
    >
      <span className="shrink-0 font-medium text-foreground" data-field-change-label="">
        {shownLabel}
      </span>
      {/* A space a flex line does not lay out, so the line reads and copies as `Label: old → new`. */}
      {' '}
      {value(before, 'old', oldRef)}
      {/* The arrow is text, so the line reads and copies as `Label: old → new`. */}
      <span className="shrink-0 text-muted-foreground" data-field-change-arrow="">
        {' → '}
      </span>
      {value(after, 'new', newRef)}
      {offersToggle && (
        <button
          type="button"
          className="shrink-0 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          data-field-change-toggle=""
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      )}
    </div>
  );
};
