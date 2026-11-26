---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(record-page): a record's comments move out of the 动态 tab into a comment panel of their own on the desktop

Clause-②: yes (widening) — `@object-ui/plugin-detail` adds exports (`CommentsPanel`, `CommentsButton`, `CommentThread`, `CommentItem`, `CommentComposer`, `CommentHoverActions`, `useRecordComments`, `buildCommentThreads`, `latestRepliers`, `RecordCommentsInPanelContext`) and their types (`CommentsPanelProps`, `CommentsButtonProps`, `RecordCommentThreadProps`, `CommentItemProps`, `CommentItemActions`, `CommentComposerProps`, `CommentHoverActionsProps`, `CommentThreadData`, `RecordCommentsData`), and an optional `reservedWidth` on `useRecordPageTier`. `RichTextCommentInput` (exported) now takes the `Esc` that closes its @ list (`preventDefault` and `stopPropagation`), so nothing round it acts on that key. `RecordActivityTimeline` draws no chip group when it is handed no chips. `@object-ui/components` adds an optional `comments` slot to `RecordTopBar` and `NavigationOverlay`, and the drawer leaves an `Esc` pressed inside a `[data-owns-escape]` region to that region. `@object-ui/i18n` adds five keys to every pack: `detail.closeComments`, `detail.collapseReplies`, `detail.commentActions`, `detail.commentsEmptyHint`, `detail.resolveThread`. Nothing existing is removed or re-typed.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches where the console draws a record's comments; `content/docs/frontend/plugins/plugin-detail.mdx` and the plugin-detail README gain the panel in this change.

On the desktop record page and in the record drawer, the record header gains a comments icon with the number of top-level comments. A press opens the record's comment panel, the next one closes it, and the browser remembers whether it was left open (once for the page, once for the drawer).

- The panel is 380 px wide: 「评论」 and ✕ at the top, the threads oldest first, the comment box docked at the foot. A thread's replies fold to 「N 条回复」 with the latest repliers' faces and open in place, with a reply box under them; Reply on any comment of a thread opens it with the caret in that box.
- A comment's actions sit in one row at its top right while the pointer is over it, or focus is in it: Reply, an emoji, and More with Edit and Delete on the viewer's own comments. Every write is offered under the same grants as before.
- From a 1280 px window the panel sits beside the record and the record gives way; in a narrower window it is drawn over the record's right edge. In a drawer narrower than 760 px (the default 720 px drawer) it covers the drawer's body; a wider drawer splits.
- Esc in the panel closes it and returns the focus to the comments icon, in a drawer too: the drawer neither closes nor steps back on it. Esc in the panel's @ list closes the list only and keeps the draft.
- While the panel holds the comments, the 动态 tab and panel hold the system entries only: activity and field changes, with no comment box and no All / Activity / Discussion chips; the Changes chip stays where the record shows its field history, and pressed again it goes back to every entry. Their count leaves the comments out.

Unchanged: a record page authored in full keeps the feed blocks it places (`record:discussion`, `record:activity`) as they were and shows no icon; an object with `enable.feeds: false` shows no icon; the phone keeps the comments in its 动态 tab.
