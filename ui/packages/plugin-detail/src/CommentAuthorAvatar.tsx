/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Avatar, AvatarFallback, AvatarImage, cn } from '@object-ui/components';
import { getPersonInitials } from '@object-ui/fields';

export interface CommentAuthorAvatarProps {
  /** The author's display name: the initials are read from it. */
  name: string;
  /** The author's avatar image, when they set one. */
  avatarUrl?: string;
  className?: string;
}

/**
 * The 20 px author avatar in front of a comment and of each reply
 * (objectstack#36070): the author's image, or their initials on the round
 * disc every other person chip draws (the people-field chips, PersonRow) —
 * the same `Avatar` / `AvatarFallback` pair and the same `getPersonInitials`.
 * An image that fails to load falls back to the initials, as those chips do.
 */
export const CommentAuthorAvatar: React.FC<CommentAuthorAvatarProps> = ({ name, avatarUrl, className }) => (
  <Avatar className={cn('size-5 shrink-0', className)} data-comment-author-avatar="">
    {avatarUrl && <AvatarImage src={avatarUrl} alt={name} className="object-cover" />}
    <AvatarFallback className="text-[9px] font-medium" aria-hidden={avatarUrl ? undefined : true}>
      {getPersonInitials(name)}
    </AvatarFallback>
  </Avatar>
);
