// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The left column of the full-page inbox (objectstack#36741): one row per
 * item, each naming the app it came from, its kind, when, a title and a
 * summary line, with an unread dot. The selected row is marked, and it is the
 * one the right pane shows.
 *
 * @module
 */

import type { ReactNode } from 'react';
import { cn } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { timeAgo } from '../../utils/relativeTime.js';

export interface InboxListRowProps {
  id: string;
  selected: boolean;
  unread?: boolean;
  /** The app the item came from, when one lists its object. */
  app?: ReactNode;
  /** What kind of item it is (the object, the approval flow, …). */
  kind?: ReactNode;
  time?: string;
  title: ReactNode;
  summary?: ReactNode;
  /** A count pill after the title (a coalesced notification's repeats). */
  count?: number;
  countLabel?: string;
  onSelect: (id: string) => void;
}

export function InboxListRow({
  id,
  selected,
  unread,
  app,
  kind,
  time,
  title,
  summary,
  count,
  countLabel,
  onSelect,
}: InboxListRowProps) {
  const displayLocale = useDisplayLocale();
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-current={selected ? 'true' : undefined}
        data-testid="inbox-page-row"
        data-item-id={id}
        data-unread={unread ? 'true' : undefined}
        className={cn(
          'flex w-full gap-2.5 border-b border-l-[3px] px-4 py-3 text-left transition-colors duration-150 max-md:min-h-11',
          selected ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-accent/60',
        )}
      >
        <span
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            unread ? 'bg-primary' : 'bg-transparent',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {app && (
              <span className="max-w-[45%] truncate rounded bg-muted px-1.5 py-px font-medium text-foreground/80">
                {app}
              </span>
            )}
            {kind && <span className="min-w-0 truncate">{kind}</span>}
            {time && <span className="ml-auto shrink-0">{timeAgo(time, displayLocale)}</span>}
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <span className={cn('min-w-0 truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>{title}</span>
            {count !== undefined && count > 1 && (
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 text-xs font-medium leading-4 text-muted-foreground"
                aria-label={countLabel}
              >
                ×{count}
              </span>
            )}
          </span>
          {summary && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{summary}</span>}
        </span>
      </button>
    </li>
  );
}

/** A list's empty or unanswered state, in the list column. */
export function InboxListNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </div>
  );
}
