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
export {
  buildCommentThreads,
  latestRepliers,
  threadResolvable,
  threadResolved,
  threadInvolvesViewer,
  filterCommentThreads,
  unresolvedThreadCount,
  DEFAULT_COMMENT_THREAD_FILTER,
  type CommentThreadData,
  type CommentThreadFilter,
} from './commentThreads';
export { CommentItem, type CommentItemProps } from './CommentItem';
export { CommentThread, type RecordCommentThreadProps, type CommentItemActions } from './CommentThread';
export { CommentComposer, type CommentComposerProps } from './CommentComposer';
export { CommentHoverActions, type CommentHoverActionsProps } from './CommentHoverActions';
export { CommentsPanel, type CommentsPanelProps } from './CommentsPanel';
export { CommentsButton, type CommentsButtonProps } from './CommentsButton';
export { CommentsFilterMenu, type CommentsFilterMenuProps } from './CommentsFilterMenu';
export { CommentActionSheet, type CommentActionSheetProps } from './CommentActionSheet';
export { CommentsPage, type CommentsPageProps } from './CommentsPage';
export { useCommentPress, COMMENT_LONG_PRESS_MS, COMMENT_PRESS_SLOP, type CommentPress, type CommentPressOptions } from './useCommentPress';
