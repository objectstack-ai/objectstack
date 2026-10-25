/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordTitleChip — the canonical "record header chip" rendered at the
 * top of every record detail page (icon | title | favourite star |
 * objectLabel | copy-id).
 *
 * Shared between:
 *   - `page:header` renderer (`@object-ui/components`) when wrapped in a
 *     `RecordContext`, so custom Lightning-style Page schemas get the
 *     same visual chip as the default detail view.
 *   - `DetailView` in `@object-ui/plugin-detail` (Track 3) once the
 *     monolith is decomposed.
 *
 * Intentionally lightweight — no summary-chip strip, no inline-edit
 * toolbar, no record-prev/next nav. Those continue to live in
 * `DetailView`. The chip is the smallest visual unit shared between
 * the two code paths so we can close the parity gap right now without
 * blocking on the larger DetailView extraction.
 */

import React from 'react';
import { Star, Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';
import { useObjectTranslation } from '@object-ui/i18n';
import { cn } from '../lib/utils';

export interface RecordTitleChipProps {
  /** Resolved title text (already interpolated against the record). */
  title: string;
  /**
   * Drawn inside the `<h1>` in place of `title`'s text when given
   * (objectui#13216): `page:header` passes the declared `nameField`'s value
   * drawn through its widget's face, which may name the value only after it
   * has read a label. `title` is still required and is still the plain-text
   * title; a caller that passes no node draws exactly what it drew before.
   */
  titleNode?: React.ReactNode;
  /** Optional icon node (object icon, e.g. <Lucide /> or an emoji). */
  icon?: React.ReactNode;
  /** Object label shown beneath the title (e.g. "Lead"). */
  objectLabel?: string;
  /**
   * Host-injected, optional (objectui#13385): a note about the object label,
   * e.g. how the object is managed ("Managed by the identity provider"). When
   * given with `objectLabel`, the label becomes a focusable tooltip trigger
   * showing "<objectLabel> · <note>", and the note is the label's accessible
   * description. Absent, the label draws exactly as before.
   */
  objectLabelNote?: string;
  /** Record identifier shown next to the object label with a copy button. */
  resourceId?: string;
  /** Hide the copy-id button (default: shown when `resourceId` is given). */
  showCopyId?: boolean;
  /** Controlled favourite state. When omitted, the chip manages its own. */
  isFavorite?: boolean;
  /**
   * Called when the favourite star is toggled. The star draws exactly when
   * this is given: a star with nothing to call would store nothing.
   */
  onToggleFavorite?: (next: boolean) => void;
  /** Extra classes for the outer flex column. */
  className?: string;
  /** Optional inline action node rendered after the title (e.g. badges). */
  inlineExtras?: React.ReactNode;
}

export const RecordTitleChip: React.FC<RecordTitleChipProps> = ({
  title,
  titleNode,
  icon,
  objectLabel,
  objectLabelNote,
  resourceId,
  showCopyId = true,
  isFavorite: isFavoriteProp,
  onToggleFavorite,
  className,
  inlineExtras,
}) => {
  const { t } = useObjectTranslation();
  const [internalFav, setInternalFav] = React.useState(false);
  const [idCopied, setIdCopied] = React.useState(false);
  const isFavorite = isFavoriteProp ?? internalFav;
  const objectLabelNoteId = React.useId();

  const handleToggleFavorite = React.useCallback(() => {
    const next = !isFavorite;
    if (onToggleFavorite) onToggleFavorite(next);
    if (isFavoriteProp === undefined) setInternalFav(next);
  }, [isFavorite, isFavoriteProp, onToggleFavorite]);

  const handleCopyId = React.useCallback(() => {
    if (!resourceId) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(resourceId);
      }
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    } catch {
      /* clipboard unavailable — silent no-op */
    }
  }, [resourceId]);

  const favLabel = isFavorite
    ? t('detail.removeFromFavorites')
    : t('detail.addToFavorites');
  const copyLabel = idCopied ? t('detail.copied') : t('detail.copyRecordId');

  return (
    <TooltipProvider>
      <div className={cn('flex flex-col min-w-0', className)}>
        <div className="flex items-baseline gap-2 flex-wrap">
          {icon && (
            <span className="text-muted-foreground shrink-0 self-center" aria-hidden>
              {icon}
            </span>
          )}
          <h1 className="text-xl sm:text-2xl font-bold truncate">{titleNode ?? title}</h1>
          {objectLabel && !objectLabelNote && (
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70 shrink-0">
              {objectLabel}
            </span>
          )}
          {/* objectui#13385 — the label with a host note: focusable, so the
              tooltip opens on keyboard focus as on hover, and described by
              the note (an `sr-only` sibling, so the description is there
              whether or not the tooltip is open). */}
          {objectLabel && objectLabelNote && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-describedby={objectLabelNoteId}
                    data-object-label-note=""
                    className="text-xs font-medium tracking-wide text-muted-foreground/70 shrink-0 cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {objectLabel}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {objectLabel} · {objectLabelNote}
                </TooltipContent>
              </Tooltip>
              <span id={objectLabelNoteId} className="sr-only">
                {objectLabelNote}
              </span>
            </>
          )}
          {showCopyId && resourceId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-foreground"
                  onClick={handleCopyId}
                  aria-label={copyLabel}
                >
                  {idCopied ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copyLabel}</TooltipContent>
            </Tooltip>
          )}
          {onToggleFavorite && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={handleToggleFavorite}
                  aria-label={favLabel}
                  aria-pressed={isFavorite}
                >
                  <Star
                    className={cn(
                      'h-4 w-4',
                      isFavorite
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground',
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{favLabel}</TooltipContent>
            </Tooltip>
          )}
          {inlineExtras}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default RecordTitleChip;
