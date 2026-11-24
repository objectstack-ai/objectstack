/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  cn,
} from '@object-ui/components';
import { ListFilter } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import type { CommentThreadFilter } from './commentThreads';

export interface CommentsFilterMenuProps {
  filter: CommentThreadFilter;
  onFilterChange: React.Dispatch<React.SetStateAction<CommentThreadFilter>>;
  /** The trigger's box: 28 px in the desktop panel's header, 44 px on the phone. */
  triggerClassName?: string;
}

/**
 * The comment list's filter (objectstack#36075 item 7, objectstack#36076 item
 * 7): 「显示已解决」 and 「只看我参与的」, the same menu on the desktop panel
 * and the phone's comment page. The trigger reads as active while 「只看我参与的」
 * is on.
 */
export const CommentsFilterMenu: React.FC<CommentsFilterMenuProps> = ({ filter, onFilterChange, triggerClassName }) => {
  const { t } = useDetailTranslation();
  const filtering = filter.onlyMine || !filter.showResolved;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            filter.onlyMine && 'text-primary hover:text-primary',
            triggerClassName,
          )}
          aria-label={t('detail.filterComments')}
          title={t('detail.filterComments')}
          data-comments-filter=""
          data-comments-filtering={filtering ? 'true' : 'false'}
        >
          <ListFilter className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuCheckboxItem
          checked={filter.showResolved}
          onCheckedChange={(checked) => onFilterChange((f) => ({ ...f, showResolved: checked === true }))}
          data-comments-filter-option="show-resolved"
        >
          {t('detail.showResolvedComments')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filter.onlyMine}
          onCheckedChange={(checked) => onFilterChange((f) => ({ ...f, onlyMine: checked === true }))}
          data-comments-filter-option="only-mine"
        >
          {t('detail.commentsInvolvingMe')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
