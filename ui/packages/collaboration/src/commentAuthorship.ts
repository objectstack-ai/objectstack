/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one owner rule for a comment's author controls (objectui#12268): may the
 * viewer be offered Edit and Delete on a comment? Only when they wrote it.
 *
 * Two surfaces read it, and neither keeps a copy: `CommentThread` asks it for
 * every comment it draws, and the console's record page asks it for every
 * `sys_comment` row it maps into the record feed (`RecordDetailView` in
 * `@object-ui/app-shell`, which hands the answer to the feed as
 * `FeedItem.authoredByViewer`). So the two cannot come to disagree about who
 * a comment's author is.
 *
 * It decides which controls are OFFERED, nothing more. The server's rule stays
 * the authority on the write: the platform's comment access hooks let the
 * author, or a user who may edit the parent record, update or delete a
 * comment, and refuse everyone else. A refusal reaches the user as an error.
 *
 * A missing id on either side is no match. A viewer with no id authored
 * nothing, and a comment with no author id belongs to no one on screen, so two
 * absent ids must not compare equal and read as ownership.
 */
export function isCommentAuthor(
  authorId: string | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  return typeof authorId === 'string' && authorId !== '' && authorId === viewerId;
}
