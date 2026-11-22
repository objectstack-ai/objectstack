/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, Textarea, cn } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import type { FeedItem } from '@object-ui/types';
import { useDetailTranslation } from '../useDetailTranslation';
import { CommentAuthorAvatar } from '../CommentAuthorAvatar';
import { formatCommentTime } from './commentTime';

export interface CommentItemProps {
  item: FeedItem;
  /**
   * The comment's actions, drawn at its top right (the desktop's hover row,
   * `CommentHoverActions`). A surface that reaches them another way (the
   * phone's long press) hands none.
   */
  actions?: React.ReactNode;
  /** The comment's text is an editor while this is true. */
  editing?: boolean;
  /**
   * Stores the edited text. A rejection means nothing was stored: the editor
   * stays open with the draft.
   */
  onSaveEdit?: (text: string) => void | Promise<void>;
  onCancelEdit?: () => void;
  /** Toggles the viewer's own reaction; absent, the reactions are read-only. */
  onToggleReaction?: (emoji: string) => void;
  /** What sits under the comment: a thread's 「N 条回复」, or its replies. */
  footer?: React.ReactNode;
  /**
   * The comment's box answers a press besides its own controls (the phone's
   * long press, `useCommentPress`): spread on the box, which then takes no
   * text selection and no system callout, so the press is the page's. Not
   * while the comment is being edited: the press is then the editor's.
   */
  interactionProps?: React.HTMLAttributes<HTMLDivElement>;
  className?: string;
}

/**
 * One comment (objectstack#36075): its author's face, name and when on one
 * line, what they wrote, and the reactions under it — the viewer's own ones
 * marked. The desktop panel and the phone's comment page draw the same item;
 * only where its actions are reached differs.
 */
export const CommentItem: React.FC<CommentItemProps> = ({
  item,
  actions,
  editing = false,
  onSaveEdit,
  onCancelEdit,
  onToggleReaction,
  footer,
  interactionProps,
  className,
}) => {
  const { t } = useDetailTranslation();
  const locale = useDisplayLocale();
  const reactions = item.reactions ?? [];
  return (
    <div
      {...(editing ? undefined : interactionProps)}
      className={cn(
        'group/comment relative',
        interactionProps && !editing && 'select-none [-webkit-touch-callout:none]',
        className,
      )}
      data-comment-item=""
      data-comment-id={String(item.id)}
    >
      <div className="flex min-h-5 items-center gap-2 pr-1">
        <CommentAuthorAvatar name={item.actor} avatarUrl={item.actorAvatarUrl} />
        <span className="truncate text-sm font-medium text-foreground">{item.actor}</span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" data-comment-when="">
          {formatCommentTime(item.createdAt, t, locale)}
        </span>
        {item.edited && <span className="shrink-0 text-xs italic text-muted-foreground">{t('detail.edited')}</span>}
      </div>
      {actions}
      <div className="pl-7">
        {editing && onSaveEdit ? (
          <CommentEditor
            initial={item.body ?? ''}
            onSave={onSaveEdit}
            onCancel={() => onCancelEdit?.()}
          />
        ) : (
          item.body && (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-foreground" data-comment-body="">
              {item.body}
            </p>
          )
        )}
        {reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1" data-comment-reactions="">
            {reactions.map((reaction) => {
              const label = t('detail.reactionCount', { emoji: reaction.emoji, count: reaction.count });
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default',
                    reaction.reacted
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-muted/60 text-muted-foreground hover:bg-muted',
                  )}
                  aria-label={label}
                  aria-pressed={!!reaction.reacted}
                  title={label}
                  disabled={!onToggleReaction}
                  onClick={() => onToggleReaction?.(reaction.emoji)}
                  data-comment-reaction={reaction.emoji}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span aria-hidden="true">{reaction.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {footer}
      </div>
    </div>
  );
};

/** The editor a comment's text turns into: Save stores the trimmed draft, Esc or Cancel leaves it. */
const CommentEditor: React.FC<{
  initial: string;
  onSave: (text: string) => void | Promise<void>;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const { t } = useDetailTranslation();
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const trimmed = draft.trim();
  const canSave = trimmed !== '' && trimmed !== initial.trim();
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } catch {
      // Not stored: the host reports why; the draft stays for another try.
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-1 space-y-1.5" data-testid="comment-editor">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
        aria-label={t('detail.editComment')}
        disabled={saving}
        autoFocus
        className="min-h-[60px] text-sm"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="h-7" onClick={() => void save()} disabled={saving || !canSave}>
          {t('detail.save')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel} disabled={saving}>
          {t('detail.cancel')}
        </Button>
      </div>
    </div>
  );
};
