---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/react': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
---

feat(record-page): the desktop comment panel resolves and reopens threads, filters them, counts the unresolved ones, and offers Edit and Delete on other people's comments to a member who may edit the record

Clause-②: yes (widening) — `@object-ui/react`'s `DiscussionContextValue` adds two optional members: `onResolveComment(itemId, resolved)` and `moderatesComments`. `@object-ui/types`' `FeedItem` adds five optional members: `resolved`, `resolvedById`, `resolvedByName`, `resolvedAt`, `mentionsViewer`. `@object-ui/plugin-detail` adds exports `useRecordVerdict` (the three-state verdict `useRecordEditable` fails open on; `useRecordEditable` reads exactly as before), `threadResolvable`, `threadResolved`, `threadInvolvesViewer`, `filterCommentThreads`, `unresolvedThreadCount`, `DEFAULT_COMMENT_THREAD_FILTER` and the type `CommentThreadFilter`; `RecordCommentsData` adds `resolvable`, `onResolveComment` and `moderates`, and its `count` is now the unresolved threads; `CommentItemActions` adds `onResolve` and `resolved`; `CommentHoverActionsProps` adds `resolved`; `RecordCommentThreadProps['comments']` may carry `onResolveComment` and `moderates`. `@object-ui/i18n` adds ten keys to every pack: `detail.reopenThread`, `detail.threadResolved`, `detail.threadResolvedBy`, `detail.filterComments`, `detail.showResolvedComments`, `detail.commentsInvolvingMe`, `detail.noUnresolvedComments`, `detail.noCommentsInvolvingMe`, `detail.showAllComments`, `detail.commentResolveFailed`. Nothing existing is removed or re-typed.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the console's comment panel; `content/docs/frontend/plugins/plugin-detail.mdx` and the plugin-detail README gain resolved threads, the filter and the moderator's Edit and Delete in this change.

The desktop record page's comment panel (objectstack#36075) gains the resolved threads #36071 stores:

- ✓ in a thread's first comment's action row marks the thread resolved: it leaves the list and the comments icon's number, now the unresolved threads, drops by one. Anyone who may comment on the record may resolve (maintainer ruling 7063285032).
- The filter menu at the panel's top right holds 「显示已解决」, which shows resolved threads marked 「已由 X 解决」 (their ✓ reopens them), and 「只看我参与的」, the threads the viewer started, replied in or is mentioned in. The filter is not stored. With every thread resolved, the panel says so and offers to show them all.
- A reply into a resolved thread shows the thread reopened, as the platform stores it.
- Edit and Delete under More are offered on other members' comments to a member the explain engine admits to update the record by id, the server's own rule for editing someone else's comment; only on a definite allow, so a member is never offered a write the server refuses. Their own comments keep them as before.

Unchanged: no server permission changes; a deployment whose comment rows carry no `is_resolved` shows no ✓ and no filter, and the icon counts every thread; hand-written record pages and the phone keep their feed as before.
