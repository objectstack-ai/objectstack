// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { MetadataSelection } from '../metadata-admin/preview-registry.js';
import { t } from '../metadata-admin/i18n.js';
import type { StudioRefusal } from './metadataError.js';

/**
 * objectui#11785 — the strip a pillar shows for a failed save or load. It
 * shows the refusal's sentence, a "Show me" button that opens the input the
 * sentence names, and the raw text (field paths, codes) inside a closed
 * "Details" disclosure. A failure with nothing rewritten (`plainRefusal`) has
 * no detail and renders as the single line it always was.
 *
 * objectstack#29139 — the sentence is announced: it is a `role="alert"`, the
 * sentence alone. A refusal stops what the author just did, and the strip
 * mounts with its sentence already in it; an alert is announced on insertion,
 * where a polite live region inserted already filled may not be. "Show me" and
 * Details stay outside it, so the announcement is the sentence verbatim and
 * opening Details does not announce it again.
 *
 * objectstack#29148 — its own module, so a host outside this file (the
 * metadata admin's ResourceEditPage) draws the same strip. `index.ts` does not
 * re-export it; `StudioDesignSurface` re-exports it for its pins.
 */
export function StudioRefusalStrip({
  refusal,
  locale,
  onShow,
  className,
}: {
  refusal: StudioRefusal;
  locale: string;
  /**
   * Opens the target's input in the pillar that raised the refusal, and
   * (objectstack#26730) puts the focus on it: `input` is the inspector's
   * label of that input, when the refusal names one.
   */
  onShow?: (target: MetadataSelection | null, input?: string) => void;
  /** Spacing and type size, which differ by pillar. */
  className?: string;
}): React.ReactElement {
  const { message, target, input, detail } = refusal;
  return (
    <div
      data-testid="studio-refusal"
      className={cn('rounded-md border border-destructive/40 bg-destructive/10 text-destructive', className)}
    >
      <div className="flex items-start gap-2">
        <p data-testid="studio-refusal-message" role="alert" className="min-w-0 flex-1 whitespace-pre-line">
          {message}
        </p>
        {target !== undefined && onShow && (
          <button
            type="button"
            onClick={() => onShow(target, input)}
            className="shrink-0 rounded border border-destructive/40 px-1.5 py-0.5 font-medium hover:bg-destructive/10"
          >
            {t('engine.studio.refusal.show', locale)}
          </button>
        )}
      </div>
      {detail && (
        <details data-testid="studio-refusal-detail" className="mt-1">
          <summary className="cursor-pointer select-none opacity-80">{t('engine.studio.refusal.details', locale)}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">{detail}</pre>
        </details>
      )}
    </div>
  );
}
