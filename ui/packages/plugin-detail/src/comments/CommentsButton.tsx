/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { MessageSquare } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';

export interface CommentsButtonProps {
  /** The number beside the icon; `null` (not known yet) draws the icon alone. */
  count: number | null;
  /** Whether the comment panel is open: the button reads pressed. */
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  className?: string;
}

/**
 * The record header's comments switch (objectstack#36075, item 2): the
 * comments icon and how many threads the record holds. A press opens the
 * comment panel, the next one closes it.
 */
export const CommentsButton: React.FC<CommentsButtonProps> = ({ count, pressed, onPressedChange, className }) => {
  const { t } = useDetailTranslation();
  const label = t('detail.comments');
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={label}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      data-comments-button=""
    >
      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      {count !== null && count > 0 && <span data-comments-count="">{count}</span>}
    </button>
  );
};
