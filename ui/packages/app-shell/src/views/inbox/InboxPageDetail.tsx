// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The right pane of the full-page inbox (objectstack#36741): what the row
 * selected on the left is about, drawn where it can be acted on.
 *
 * Every record it shows is `RecordDetailView`, embedded — the view the list
 * drawer and the split pane already draw a record with — so nothing here
 * re-implements a record, an approval decision or a comment thread:
 *
 *  - an approval request is its served request page, whose decision panel
 *    runs the request's own declared actions (approve, reject, …) with their
 *    own `visible` rules and parameter dialogs;
 *  - a notification about a record is that record, its discussion included;
 *  - an activity row is the record it happened on.
 *
 * Above it, one header line names the item and carries the way out to the
 * full page («打开完整记录»).
 *
 * @module
 */

import type { ReactNode } from 'react';
import { Button } from '@object-ui/components';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { ArrowLeft, ExternalLink, Inbox as InboxIcon } from 'lucide-react';
import { RecordDetailView } from '../RecordDetailView.js';
import { timeAgo } from '../../utils/relativeTime.js';

/** The object an approval request is a row of. */
export const APPROVAL_REQUEST_OBJECT = 'sys_approval_request';

export interface InboxDetailHeaderProps {
  /** Small line above the title: where it is from, what kind, when. */
  meta: ReactNode;
  title: ReactNode;
  /** The message text, when the item carries one. */
  body?: string | null;
  /** Opens the item's full page; absent ⇒ no such button. */
  onOpenFull?: () => void;
  openFullLabel?: string;
  /** Phone width: back to the list. */
  onBack?: () => void;
  children?: ReactNode;
}

export function InboxDetailHeader({ meta, title, body, onOpenFull, openFullLabel, onBack, children }: InboxDetailHeaderProps) {
  const { t } = useObjectTranslation();
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-4 md:px-6" data-testid="inbox-detail-header">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground md:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('inboxPage.backToList', { defaultValue: 'Back to the list' })}
        </button>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{meta}</div>
          <h2 className="mt-1 text-lg font-semibold leading-tight break-words">{title}</h2>
        </div>
        {children}
        {onOpenFull && (
          <Button size="sm" variant="outline" onClick={onOpenFull} data-testid="inbox-detail-open-full">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {openFullLabel ?? t('inboxPage.openFullRecord', { defaultValue: 'Open full record' })}
          </Button>
        )}
      </div>
      {body && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}

export interface InboxEmbeddedRecordProps {
  objectName: string;
  recordId: string;
  dataSource: unknown;
  objects: unknown[];
}

/** One record, drawn whole by the record view in its embedded form. */
export function InboxEmbeddedRecord({ objectName, recordId, dataSource, objects }: InboxEmbeddedRecordProps) {
  return (
    <div className="min-w-0" data-testid="inbox-detail-record" data-object={objectName} data-record-id={recordId}>
      <RecordDetailView
        objectNameOverride={objectName}
        recordIdOverride={recordId}
        embedded
        dataSource={dataSource}
        objects={objects as any[]}
        onEdit={noEdit}
      />
    </div>
  );
}

function noEdit(): void {
  /* the embedded record edits inline; a full form opens from its full page */
}

/** The pane with nothing selected, or a list with nothing in it. */
export function InboxDetailEmpty({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"
      data-testid="inbox-detail-empty"
    >
      <InboxIcon className="h-8 w-8 opacity-40" aria-hidden />
      {children}
    </div>
  );
}

/** The members of a coalesced notification row, newest first. */
export function InboxGroupOccurrences({
  items,
}: {
  items: ReadonlyArray<{ id: string; title: string; body?: string | null; created_at?: string; is_read?: boolean }>;
}) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  return (
    <section className="px-4 py-4 md:px-6" data-testid="inbox-detail-occurrences">
      <h3 className="mb-2 text-sm font-medium">
        {t('inboxPage.occurrences', { defaultValue: 'Each time it was sent' })}
      </h3>
      <ul className="divide-y rounded-md border">
        {items.map((n) => (
          <li key={n.id} className="px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{n.body || n.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at, displayLocale)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
