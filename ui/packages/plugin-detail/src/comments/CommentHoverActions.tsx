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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@object-ui/components';
import { Check, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import { DEFAULT_EMOJI_OPTIONS } from '../ReactionPicker';

export interface CommentHoverActionsProps {
  /** Opens the reply box under the thread, the caret in it. */
  onReply?: () => void;
  /** Adds (or takes back) the viewer's reaction. */
  onReact?: (emoji: string) => void;
  /** Marks the thread resolved; offered only where the deployment stores it. */
  onResolve?: () => void;
  /** The author's Edit; under 更多. */
  onEdit?: () => void;
  /** The author's Delete; under 更多, the host confirms first. */
  onDelete?: () => void;
}

const ICON_BUTTON =
  'inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A comment's actions on the desktop (objectstack#36075, item 6): ONE row at
 * the comment's top right — 回复, 表情, 已解决, 更多 (编辑, 删除) — shown while
 * the pointer is over the comment, focus is in the row, or one of its menus is
 * open. Each control is drawn only where its handler is handed; a row with
 * none draws nothing.
 */
export const CommentHoverActions: React.FC<CommentHoverActionsProps> = ({
  onReply,
  onReact,
  onResolve,
  onEdit,
  onDelete,
}) => {
  const { t } = useDetailTranslation();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  if (!onReply && !onReact && !onResolve && !onEdit && !onDelete) return null;
  const held = pickerOpen || menuOpen;
  return (
    <div
      role="toolbar"
      aria-label={t('detail.commentActions')}
      className={cn(
        'absolute right-0 -top-1 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm transition-opacity',
        held
          ? 'opacity-100'
          : 'pointer-events-none opacity-0 group-hover/comment:pointer-events-auto group-hover/comment:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
      )}
      data-comment-actions=""
    >
      {onReply && (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('detail.replyToComment', { defaultValue: 'Reply' })}
          title={t('detail.replyToComment', { defaultValue: 'Reply' })}
          onClick={onReply}
          data-comment-action="reply"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
      )}
      {onReact && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={t('detail.addReaction')}
              title={t('detail.addReaction')}
              data-comment-action="react"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto gap-0.5 p-1" aria-label={t('detail.emojiPicker')}>
            {DEFAULT_EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded p-1 text-base transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onReact(emoji);
                  setPickerOpen(false);
                }}
                data-comment-emoji={emoji}
              >
                {emoji}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {onResolve && (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={t('detail.resolveThread')}
          title={t('detail.resolveThread')}
          onClick={onResolve}
          data-comment-action="resolve"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
      {(onEdit || onDelete) && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label={t('detail.moreActions')}
              title={t('detail.moreActions')}
              data-comment-action="more"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            {onEdit && (
              <DropdownMenuItem onSelect={onEdit} data-comment-action="edit">
                <Pencil className="mr-2 h-3.5 w-3.5" />
                {t('detail.edit')}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:text-destructive"
                data-comment-action="delete"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {t('detail.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
