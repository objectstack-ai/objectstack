---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(record-page): on a phone, the record's comments open as a page of their own: the threads first, a thread's replies inside it, the comment box docked at the foot, and a long press for a comment's actions

Clause-②: yes (widening) — `@object-ui/plugin-detail` adds the export `CommentsPage` and its type `CommentsPageProps`; `CommentThread` takes a third `mode`, `'page'`, and an optional `itemInteraction`; `CommentItem` an optional `interactionProps`; `CommentComposer` and `RichTextCommentInput` (exported) an optional `layout` (`'default' | 'phone'`). `@object-ui/app-shell` reserves the console URL parameter `comments` (`RECORD_COMMENTS_PARAM`, in `RESERVED_URL_PARAMS`). `@object-ui/i18n` adds four keys to every pack: `detail.addReactionEmoji`, `detail.commentThread`, `detail.formatBold`, `detail.formatItalic` (the toolbar's names without their shortcut). Nothing existing is removed or re-typed; the desktop's panel, toolbar and labels are unchanged.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches where the console draws a record's comments; `content/docs/frontend/plugins/plugin-detail.mdx` and the plugin-detail README gain the phone's page in this change.

On a phone the record page's top bar gains the comments icon, with the number of unresolved threads. A press opens the record's comments as a page over the record, which stays where it was under it; 「‹」 and the browser's Back return to it.

- The page lists each thread's first comment with 「N 条回复」 under it; a tap opens the thread, the comment first and its replies after it. 「‹ 评论」 returns to the list.
- The comment box is docked at the foot of the screen and stands on the keyboard while it is up. One line until tapped; then a row under the text holds mention, bold, italic, list and code, and send at the right end. In the list it writes a comment, in a thread a reply. No 「Ctrl+Enter」 hint.
- A long press on a comment (or its context menu) raises a sheet from the bottom: six reactions, 「标记已解决」 on a thread's first comment, 「编辑」 and 「删除」 (red, confirmed first), each offered exactly where the desktop's hover row offers it.
- The filter at the top right is the desktop's: 「显示已解决」 and 「只看我参与的」.
- The 动态 tab holds the system entries alone, as on the desktop.
- The page is in the URL (`?comments=` for the list, `?comments=<id>` for a thread), so a link or a reload opens it where it was.

Unchanged: the desktop; who may write, resolve, edit or delete a comment (the phone offers each exactly where the desktop does); a record page authored in full and an object with `enable.feeds: false` show no icon.
