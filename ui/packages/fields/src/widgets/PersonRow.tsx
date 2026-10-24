/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useEffect, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage, cn } from '@object-ui/components';
import { Check } from 'lucide-react';
import {
  getPersonName,
  getPersonInitials,
  getPersonSubtitle,
  getPersonAvatarUrl,
  matchRanges,
} from './personDisplay.js';

/**
 * A rich, single-line candidate row for the search-first PeoplePicker:
 * avatar (image with initials fallback) + name + subtitle (department · email).
 * The subtitle is what lets search stand in for an org tree — it disambiguates
 * same-named people inline. The typed query is highlighted in both lines.
 * Selectable/toggleable; a Check marks the selected state, and `active` reflects
 * the keyboard cursor (scrolls itself into view).
 */
export interface PersonRowProps {
  record: any;
  displayField?: string;
  /**
   * The fields the name is read from, in order; defaults to the ladder of
   * `displayField` (`getPersonNameFields`). PeoplePicker passes the fields of
   * that ladder the loaded policy lets the viewer read (objectui#10535).
   */
  nameFields?: string[];
  subtitleFields?: string[];
  /**
   * Avatar image field (default `image`). `null` draws no image, only the
   * initials: what PeoplePicker passes when field-level security withholds the
   * field (objectui#10433).
   */
  avatarField?: string | null;
  selected?: boolean;
  /** Keyboard cursor is on this row — highlight + scroll into view. */
  active?: boolean;
  /** Typed search term; matches are highlighted in name + subtitle. */
  highlightQuery?: string;
  onSelect?: (record: any) => void;
  className?: string;
}

/** Wrap literal matches of `query` in a subtle highlight. */
function Highlighted({ text, query }: { text: string; query?: string }): React.ReactElement {
  const ranges = query ? matchRanges(text, query) : [];
  if (ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark key={i} className="rounded-[2px] bg-primary/20 px-px text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

export function PersonRow({
  record,
  displayField = 'name',
  nameFields,
  subtitleFields,
  avatarField = 'image',
  selected = false,
  active = false,
  highlightQuery,
  onSelect,
  className,
}: PersonRowProps) {
  const name = getPersonName(record, nameFields ?? displayField);
  const subtitle = getPersonSubtitle(record, subtitleFields);
  const avatarUrl = getPersonAvatarUrl(record, avatarField);
  const initials = getPersonInitials(name);

  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Optional-call the method too — jsdom doesn't implement scrollIntoView.
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      onClick={() => onSelect?.(record)}
      aria-pressed={selected}
      data-testid="person-row"
      data-active={active || undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-accent focus-visible:outline-none',
        selected && 'bg-accent',
        active && 'bg-accent ring-1 ring-inset ring-ring',
        className,
      )}
    >
      <Avatar className="size-9 shrink-0">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {name ? <Highlighted text={name} query={highlightQuery} /> : '—'}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">
            <Highlighted text={subtitle} query={highlightQuery} />
          </div>
        )}
      </div>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
