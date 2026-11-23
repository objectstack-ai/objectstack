// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 item 6 — the line an item page draws while the AI
 * assistant's unpublished draft is on the item: the page shows that version,
 * Save makes it live together with the page's own edits, and 「放弃 AI 的改动」
 * drops that one item's draft, back to the live version.
 *
 * The object page carries the same sentence and button inside its own AI line
 * (with its change count and Review); this is the line for the other item
 * pages, drawn the same way.
 */

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@object-ui/components';
import { t } from '../metadata-admin/i18n.js';

export function StudioAiDraftNotice({
  locale,
  onDiscard,
  busy = false,
  className,
}: {
  locale: string;
  /** Drop the item's draft; `undefined` draws no button (a read-only item). */
  onDiscard?: () => void;
  busy?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div
      role="status"
      data-testid="studio-ai-draft-line"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-1.5 text-xs dark:border-amber-500/30 dark:bg-amber-500/10',
        className,
      )}
    >
      <span data-testid="studio-ai-draft-notice" className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('engine.studio.aiDraft.notice', locale)}
      </span>
      {onDiscard && (
        <button
          type="button"
          data-testid="studio-ai-draft-discard"
          onClick={onDiscard}
          disabled={busy}
          title={t('engine.studio.aiDraft.discardTitle', locale)}
          className="ml-auto font-medium text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-300"
        >
          {t('engine.studio.aiDraft.discard', locale)}
        </button>
      )}
    </div>
  );
}
