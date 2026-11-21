/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { FeedItem } from '@object-ui/types';

/** The initials a person without a photo is drawn with: two letters, or a CJK name's first character. */
function initialsOf(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  const token = parts[0];
  if (/\p{Script=Han}/u.test(token)) return token[0];
  return token.slice(0, 2).toUpperCase();
}

export interface CommentAvatarProps {
  item: Pick<FeedItem, 'actor' | 'actorAvatarUrl'>;
  /** 20 px in a thread, 16 px beside 「N 条回复」. */
  size?: 'md' | 'sm';
  className?: string;
}

/** A comment author's face: their photo, else their initials on a round tile. */
export const CommentAvatar: React.FC<CommentAvatarProps> = ({ item, size = 'md', className }) => {
  const box = size === 'sm' ? 'h-4 w-4 text-[8px]' : 'h-5 w-5 text-[10px]';
  if (item.actorAvatarUrl) {
    return (
      <img
        src={item.actorAvatarUrl}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', box, className)}
        data-comment-avatar="photo"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-medium leading-none text-primary',
        box,
        className,
      )}
      data-comment-avatar="initials"
    >
      {initialsOf(item.actor)}
    </span>
  );
};
