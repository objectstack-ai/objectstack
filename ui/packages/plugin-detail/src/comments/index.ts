/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// objectstack#36075 — the record's comment surfaces: the parts every surface
// shares (the desktop panel, the phone's comment page) and the desktop's own.
export { useRecordComments, type RecordCommentsData } from './useRecordComments';
export { buildCommentThreads, latestRepliers, type CommentThreadData } from './commentThreads';
export { CommentAvatar, type CommentAvatarProps } from './CommentAvatar';
export { CommentItem, type CommentItemProps } from './CommentItem';
export { CommentThread, type CommentThreadProps, type CommentItemActions } from './CommentThread';
export { CommentComposer, type CommentComposerProps } from './CommentComposer';
export { CommentHoverActions, type CommentHoverActionsProps } from './CommentHoverActions';
export { CommentsPanel, type CommentsPanelProps } from './CommentsPanel';
export { CommentsButton, type CommentsButtonProps } from './CommentsButton';
