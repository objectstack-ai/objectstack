// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The metadata list's 「修改时间」 cell (objectstack#36898): the item's change
 * time (`listChangedAt.ts`), empty for an item with none, and beneath it the
 * 「有未发布的改动」 mark when the item has a pending draft
 * (`listDraftMarks.ts`) — the AI's draft marked apart from anyone else's.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { EmptyValue, cn } from '@object-ui/components';
import { formatChangedAt } from './listChangedAt.js';
import type { ListDraftMarkKind } from './listDraftMarks.js';
import { t } from './i18n.js';

export function ListChangedCell({
  changedAt,
  draft,
  locale,
}: {
  /** The item's change time (ISO-8601); `undefined` for none. */
  changedAt: string | undefined;
  /** The item's pending-draft mark; `null` for none. */
  draft: ListDraftMarkKind | null;
  locale: string;
}): React.ReactElement {
  const text = formatChangedAt(changedAt, locale);
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-testid="metadata-changed-cell">
      {text ? (
        <time dateTime={changedAt} title={changedAt} className="whitespace-nowrap text-xs text-muted-foreground">
          {text}
        </time>
      ) : (
        <EmptyValue />
      )}
      {draft && (
        <span
          data-testid="metadata-draft-mark"
          data-draft-by={draft}
          title={t(`engine.list.draftMark.${draft}Title`, locale)}
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[10px] font-medium leading-4',
            draft === 'ai'
              ? 'border-violet-400/60 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/10 dark:text-violet-300'
              : 'border-amber-400/60 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
          )}
        >
          {draft === 'ai' && <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />}
          {t(`engine.list.draftMark.${draft}`, locale)}
        </span>
      )}
    </span>
  );
}
