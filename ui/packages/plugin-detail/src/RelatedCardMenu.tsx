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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, EyeOff, Maximize2, MoreHorizontal } from 'lucide-react';
import type { RelatedCardChrome } from './relatedListCompact';
import { useDetailTranslation } from './useDetailTranslation';

/**
 * A related card's own `⋯` menu (objectstack#27055, Targets 7 and 10): the
 * keyboard path to everything the pointer does — 上移 / 下移 (the drag's
 * twin), 折叠 / 展开, 隐藏 — plus the enlarge. Drawn on the expanded card and
 * on the collapsed one alike.
 */
export const RelatedCardMenu: React.FC<{
  chrome: RelatedCardChrome;
  /** The card's title, for the trigger's accessible name. */
  title: string;
  collapsed: boolean;
  onExpand?: () => void;
}> = ({ chrome, title, collapsed, onExpand }) => {
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
      <DropdownMenuContent align="end" className="w-40">
        {chrome.onEnlarge && (
          <DropdownMenuItem className="gap-2" onSelect={() => chrome.onEnlarge?.()}>
            <Maximize2 className="h-3.5 w-3.5" />
            {t('detail.relatedCardEnlarge', { defaultValue: 'Enlarge' })}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="gap-2" disabled={!chrome.onMoveUp} onSelect={() => chrome.onMoveUp?.()}>
          <ArrowUp className="h-3.5 w-3.5" />
          {t('detail.relatedCardMoveUp', { defaultValue: 'Move up' })}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" disabled={!chrome.onMoveDown} onSelect={() => chrome.onMoveDown?.()}>
          <ArrowDown className="h-3.5 w-3.5" />
          {t('detail.relatedCardMoveDown', { defaultValue: 'Move down' })}
        </DropdownMenuItem>
        {collapsed ? (
          <DropdownMenuItem className="gap-2" onSelect={() => onExpand?.()}>
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {t('detail.relatedCardExpand', { defaultValue: 'Expand' })}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="gap-2" onSelect={() => chrome.onCollapse()}>
            <ChevronsDownUp className="h-3.5 w-3.5" />
            {t('detail.relatedCardCollapse', { defaultValue: 'Collapse' })}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onSelect={() => chrome.onHide()}>
          <EyeOff className="h-3.5 w-3.5" />
          {t('detail.relatedCardHide', { defaultValue: 'Hide' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
