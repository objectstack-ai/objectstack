/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The records an answer rests on (ADR-0160 D9): one chip per verified
 * citation, showing the passage relied on. A click opens the citation's
 * record — the pack's root record, even when the passage came from a
 * related-list row — at the cited section of its body, through the host's
 * `onOpenRecord` with the citation's `anchor`.
 *
 * The block receives only the list `extractRecordCitations` lifted: the one
 * the platform verified when the answer was produced and persisted with the
 * message. It draws that list as it is and never verifies it again.
 */
import * as React from 'react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { QuoteIcon } from 'lucide-react';
import type { RecordCitationParsed } from '@objectstack/spec/ai';

/** The record a chip opens, and the section of its body to open at. */
export interface RecordCitationTarget {
  objectName: string;
  recordId: string;
  anchor?: string;
}

export interface RecordCitationsProps {
  /** The answer's verified citations, in the order the answer gave them. */
  citations: readonly RecordCitationParsed[];
  /** The host's record opener. Absent, the chips are drawn but open nothing. */
  onOpenRecord?: (target: RecordCitationTarget) => void;
  className?: string;
}

/** What a citation opens: its `object` and `id` (the root record), and its `anchor` when it names one. */
export function recordCitationTarget(citation: RecordCitationParsed): RecordCitationTarget {
  return {
    objectName: citation.object,
    recordId: citation.id,
    ...(citation.anchor ? { anchor: citation.anchor } : {}),
  };
}

const CHIP_CLASS =
  'inline-flex max-w-full items-start gap-1 rounded-md border bg-muted/30 px-2 py-1 text-left text-foreground';

/** The answer's cited records; draws nothing for an answer with no citation. */
export function RecordCitations({ citations, onOpenRecord, className }: RecordCitationsProps) {
  const { t } = useObjectTranslation();
  const titleId = React.useId();
  if (citations.length === 0) return null;
  return (
    <div className={cn('not-prose mb-4 text-xs', className)} data-testid="record-citations">
      <div id={titleId} className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground">
        <QuoteIcon className="size-3.5" aria-hidden="true" />
        {t('chatbot.recordCitations.title', { defaultValue: 'Cited from records' })}
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-labelledby={titleId}>
        {citations.map((citation, i) => (
          <li key={`${citation.object}:${citation.id}:${i}`} className="min-w-0 max-w-full">
            {onOpenRecord ? (
              <button
                type="button"
                className={cn(
                  CHIP_CLASS,
                  'transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                title={citation.quote}
                onClick={() => onOpenRecord(recordCitationTarget(citation))}
                data-testid="record-citation"
              >
                <span className="line-clamp-2 break-words">{citation.quote}</span>
              </button>
            ) : (
              <span className={CHIP_CLASS} title={citation.quote} data-testid="record-citation">
                <span className="line-clamp-2 break-words">{citation.quote}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
