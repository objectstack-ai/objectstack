// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * StudioInspector — the one 300 px aside every Studio pillar mounts at the
 * right of its content body (objectui#12459, epic objectui#12446).
 *
 * The header names the kind of thing being edited (the eyebrow), the thing
 * (the title) and its machine name (the id); the body is the pillar's own; the
 * footer says what every edit on this surface is — a draft until the package
 * publishes. A pillar that shows nothing selected passes `empty`, which renders
 * one muted sentence in the body.
 *
 * Folding: on a content row too narrow for the aside to sit beside the canvas
 * the pillar mounts a sheet instead (the objectui#11795 rule, measured by
 * `useIsNarrowerThan` in `wideViewport.ts`), so the sheet's own chrome and
 * focus handling stay where they were.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@object-ui/components';
import {
  STUDIO_ASIDE_EYEBROW,
  STUDIO_ASIDE_FOOTER,
  STUDIO_ASIDE_HEADER,
  STUDIO_ASIDE_ID,
  STUDIO_ASIDE_TITLE,
  STUDIO_ASIDE_WIDTH,
} from './studio-tokens.js';

export interface StudioInspectorProps {
  /** The kind of the thing being edited: "Field", "Node · Decision", "Nav item · Page". */
  eyebrow: string;
  /** An id for the eyebrow, for `aria-labelledby` when the eyebrow is the panel's name. */
  eyebrowId?: string;
  /** The thing's label. */
  title?: React.ReactNode;
  /** An id for the title element, for `aria-labelledby` on the body. */
  titleId?: string;
  /** The thing's machine name, in mono. */
  id?: string;
  onClose?: () => void;
  closeLabel?: string;
  /** Extra header buttons before the close button (collapse). */
  actions?: React.ReactNode;
  /** The footer sentence; `null` renders no footer. */
  footer?: React.ReactNode | null;
  /** A width override (a source editor wants more); default 300 px. */
  width?: string;
  /** Body padding override; default 16 px. */
  bodyClassName?: string;
  testId?: string;
  className?: string;
  children?: React.ReactNode;
}

export function StudioInspector({
  eyebrow,
  eyebrowId,
  title,
  titleId,
  id,
  onClose,
  closeLabel,
  actions,
  footer,
  width,
  bodyClassName,
  testId = 'studio-inspector',
  className,
  children,
}: StudioInspectorProps): React.ReactElement {
  return (
    <aside data-testid={testId} className={cn('flex shrink-0 flex-col overflow-hidden border-l bg-background', width ?? STUDIO_ASIDE_WIDTH, className)}>
      <header className={STUDIO_ASIDE_HEADER}>
        <div className="min-w-0 flex-1">
          <span id={eyebrowId} className={STUDIO_ASIDE_EYEBROW}>
            {eyebrow}
          </span>
          {title !== undefined && title !== null && (
            <span id={titleId} className={STUDIO_ASIDE_TITLE}>
              {title}
            </span>
          )}
          {id && <code className={STUDIO_ASIDE_ID}>{id}</code>}
        </div>
        {actions}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName ?? 'p-4')}>{children}</div>
      {footer !== null && footer !== undefined && <div className={STUDIO_ASIDE_FOOTER}>{footer}</div>}
    </aside>
  );
}

/** The body of an inspector with nothing selected: one muted sentence. */
export function StudioInspectorEmpty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="px-1 py-6 text-center text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}
