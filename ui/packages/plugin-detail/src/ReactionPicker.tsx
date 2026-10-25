/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import { SmilePlus } from 'lucide-react';
import type { Reaction } from '@object-ui/types';
import { useDetailTranslation } from './useDetailTranslation';

const DEFAULT_EMOJI_OPTIONS = ['👍', '❤️', '🎉', '😂', '😮', '😢'];

export interface ReactionPickerProps {
  /** Existing reactions on the feed item */
  reactions: Reaction[];
  /** Called when user adds or removes a reaction */
  onToggleReaction?: (emoji: string) => void | Promise<void>;
  /** Available emoji options */
  emojiOptions?: string[];
  className?: string;
}

/**
 * ReactionPicker — Emoji reaction selector and display.
 * Shows existing reactions with counts, and a picker to add/remove.
 * Aligned with @objectstack/spec ReactionSchema.
 */
export const ReactionPicker: React.FC<ReactionPickerProps> = ({
  reactions,
  onToggleReaction,
  emojiOptions = DEFAULT_EMOJI_OPTIONS,
  className,
}) => {
  const [showPicker, setShowPicker] = React.useState(false);
  const { t } = useDetailTranslation();

  const handleReaction = React.useCallback(
    (emoji: string) => {
      onToggleReaction?.(emoji);
      setShowPicker(false);
    },
    [onToggleReaction],
  );

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {/* Existing reactions */}
      {reactions.map((reaction) => {
        // One i18next count family (objectui#11445): i18next picks the CLDR
        // slot from the numeric `count`, so `ru` reads «👍 3 реакции» and `ar`
        // its dual at 2 — a `=== 1` key switch gave each pack only two slots.
        const countLabel = t('detail.reactionCount', { emoji: reaction.emoji, count: reaction.count });
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors',
              reaction.reacted
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-muted border-border text-muted-foreground hover:bg-muted/80',
            )}
            onClick={() => handleReaction(reaction.emoji)}
            disabled={!onToggleReaction}
            aria-label={countLabel}
          >
            <span>{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </button>
        );
      })}

      {/* Add reaction button */}
      {onToggleReaction && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowPicker(!showPicker)}
            aria-label={t('detail.addReaction')}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>

          {showPicker && (
            <div
              className="absolute bottom-full mb-1 left-0 bg-popover border rounded-md shadow-md z-50 p-1.5 flex gap-1"
              role="listbox"
              aria-label={t('detail.emojiPicker')}
            >
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="hover:bg-accent rounded p-1 text-base transition-colors"
                  onClick={() => handleReaction(emoji)}
                  role="option"
                  aria-selected={reactions.some(r => r.emoji === emoji && r.reacted)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
