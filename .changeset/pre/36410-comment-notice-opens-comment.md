---
'@objectstack/plugin-audit': patch
'@object-ui/plugin-detail': patch
---

fix: a comment notification opens the record with its comments at that comment

Clause-②: no
Metadata-protocol: none

Opening an @mention or reply notification used to land on the record page with the comments closed (or, on a phone, with no comments page), so the reader had to find the comment they were told about.

- **`@objectstack/plugin-audit`**: the `collab.mention` and `collab.reply` inbox notices now link `/{object}/{id}?comments={rootCommentId}`, plus `&comment={commentId}` when the comment is a reply. A reply's thread is found from `parent_id`; a mention inside a reply links that reply's thread. The mention and reply e-mails carry the same link. Notices already in an inbox keep their old record link: nothing is backfilled. Other notifications are unchanged.
- **`@object-ui/plugin-detail`**: `CommentsPanel` takes `focusThreadId` / `focusCommentId`. With them, it shows that thread even when the filter hides it, opens its replies, marks the comment and scrolls the list to it. `CommentsPage` takes `focusCommentId`, and the thread opens scrolled to that comment, marked. `CommentThread` takes `openSignal` / `targetId`, and `CommentItem` takes `targeted`.
- The Console's record page reads the link: on desktop, `?comments=` (a thread id) opens the comment panel at that thread without changing the stored open or closed choice, and closing the panel drops the link. On a phone, the existing `?comments=` page opens the thread scrolled to `?comment=`.
