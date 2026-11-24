/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, cn } from '@object-ui/components';
import { Check, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useDetailTranslation } from '../useDetailTranslation';
import { DEFAULT_EMOJI_OPTIONS } from '../ReactionPicker';
import type { CommentItemActions } from './CommentThread';

export interface CommentActionSheetProps {
  /** The held comment's actions; `null` closes the sheet. */
  actions: CommentItemActions | null;
  onClose: () => void;
}

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted';

/**
 * The phone's comment actions (objectstack#36076 item 5): a sheet up from the
 * bottom of the screen with the six reactions on one row, then 标记已解决 (on
 * a thread's top-level comment), 编辑 and 删除, red. Each row is drawn only
 * where the comment's actions hand its handler: the gates are the comment
 * thread's, the same ones the desktop's hover row draws from. A press picks
 * and closes; 删除 then asks the host's confirmation.
 */
export const CommentActionSheet: React.FC<CommentActionSheetProps> = ({ actions, onClose }) => {
  const { t } = useDetailTranslation();
  // The last actions stay drawn while the sheet slides away.
  const [shown, setShown] = React.useState<CommentItemActions | null>(actions);
  if (actions && actions !== shown) setShown(actions);
  const open = actions !== null;
  const a = actions ?? shown;
  const reacted = new Set((a?.item.reactions ?? []).filter((r) => r.reacted).map((r) => r.emoji));
  const pick = (run: (() => void) | undefined) => () => {
    onClose();
    run?.();
  };
  const title = t('detail.commentActions');
  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()} shouldScaleBackground={false}>
      <DrawerContent className="outline-none" data-comment-action-sheet="">
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <DrawerDescription className="sr-only">{title}</DrawerDescription>
        <div className="px-3 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
          {a?.onReact && (
            <div
              className="mb-2 flex items-center justify-between gap-1 border-b border-border pb-3"
              role="group"
              aria-label={t('detail.emojiPicker')}
              data-comment-sheet-emojis=""
            >
              {DEFAULT_EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={cn(
                    'inline-flex h-12 w-12 items-center justify-center rounded-full text-2xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    reacted.has(emoji) ? 'bg-primary/15 ring-1 ring-primary' : 'bg-muted/60 hover:bg-muted',
                  )}
                  aria-label={t('detail.addReactionEmoji', { emoji })}
                  aria-pressed={reacted.has(emoji)}
                  onClick={pick(() => a.onReact?.(emoji))}
                  data-comment-emoji={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {a?.onResolve && (
            <button
              type="button"
              className={ROW}
              onClick={pick(a.onResolve)}
              data-comment-action={a.resolved ? 'reopen' : 'resolve'}
            >
              {a.resolved ? (
                <RotateCcw className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Check className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
              {a.resolved ? t('detail.reopenThread') : t('detail.resolveThread')}
            </button>
          )}
          {a?.onEdit && (
            <button type="button" className={ROW} onClick={pick(a.onEdit)} data-comment-action="edit">
              <Pencil className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              {t('detail.edit')}
            </button>
          )}
          {a?.onDelete && (
            <button
              type="button"
              className={cn(ROW, 'text-destructive')}
              onClick={pick(a.onDelete)}
              data-comment-action="delete"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              {t('detail.delete')}
            </button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
