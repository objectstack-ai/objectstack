/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@object-ui/components';
import { EyeOff, GripVertical, MoreHorizontal } from 'lucide-react';
import type { RelatedCardChrome } from './relatedListCompact';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * A related panel's own `⋯` menu (objectstack#27524, Target 1): it holds
 * 隐藏 and nothing else. Moving is the ⠿ handle's ({@link RelatedPanelHandle});
 * a panel does not collapse — its header row opens its whole list.
 */
export const RelatedCardMenu: React.FC<{
  chrome: RelatedCardChrome;
  /** The panel's title, for the trigger's accessible name. */
  title: string;
}> = ({ chrome, title }) => {
  const { t } = useDetailTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
          aria-label={t('detail.relatedCardMenu', { title, defaultValue: 'More for {{title}}' })}
          data-related-card-menu=""
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem className="gap-2" onSelect={() => chrome.onHide()}>
          <EyeOff className="h-3.5 w-3.5" />
          {t('detail.relatedCardHide', { defaultValue: 'Hide' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * A related panel's ⠿ handle (objectstack#27524, Target 1): the drag source
 * on desktop (the stack draws the drop line) and, focused, the keyboard's way
 * to reorder — ⌥↑ / ⌥↓ move the panel one place, and the tooltip says so.
 * The panel header draws it beside ＋ and ⋯, shown on hover or focus.
 */
export const RelatedPanelHandle: React.FC<{
  chrome: RelatedCardChrome;
  /** The panel's title, for the handle's accessible name. */
  title: string;
}> = ({ chrome, title }) => {
  const { t } = useDetailTranslation();
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const move = event.key === 'ArrowUp' ? chrome.onMoveUp : event.key === 'ArrowDown' ? chrome.onMoveDown : undefined;
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest('[data-related-card-id]');
    move();
    // Moving the panel in the DOM drops the focus; the handle keeps it.
    requestAnimationFrame(() => {
      const handle = panel?.isConnected ? panel.querySelector<HTMLElement>('[data-related-panel-handle]') : null;
      handle?.focus();
    });
  };
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              chrome.dragHandleProps?.draggable && 'cursor-grab active:cursor-grabbing',
            )}
            aria-label={t('detail.relatedPanelReorder', { title, defaultValue: 'Reorder {{title}}' })}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            data-related-panel-handle=""
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onKeyDown}
            {...(chrome.dragHandleProps ?? {})}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t('detail.relatedPanelReorderHint', { defaultValue: 'Drag to reorder · ⌥↑ ⌥↓' })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
