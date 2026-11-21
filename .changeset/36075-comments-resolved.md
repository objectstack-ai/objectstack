---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/react': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
---

feat(record-page): the desktop comment panel resolves and reopens threads, filters them, counts the unresolved ones, and offers Edit and Delete on other people's comments only where the server admits them

Clause-②: yes (widening) — `@object-ui/react`'s `DiscussionContextValue` adds three optional members: `onResolveComment(itemId, resolved)`, `moderatesComments` and `updatesOthersComments`. `@object-ui/types`' `FeedItem` adds five optional members: `resolved`, `resolvedById`, `resolvedByName`, `resolvedAt`, `mentionsViewer`. `@object-ui/plugin-detail` adds exports `useRecordVerdict` (the three-state verdict `useRecordEditable` fails open on; a definite allow is the explain answer's `allowed` together with its `record.visible`, as the server admits a by-id write, so `useRecordEditable` reads as before except that an answer whose `allowed` is false beside a visible record, such as an on-behalf-of session whose delegator is gone, now reads not editable), `threadResolvable`, `threadResolved`, `threadInvolvesViewer`, `filterCommentThreads`, `unresolvedThreadCount`, `DEFAULT_COMMENT_THREAD_FILTER` and the type `CommentThreadFilter`; `RecordCommentsData` adds `resolvable`, `onResolveComment`, `moderates` and `updatesOthers`, and its `count` is now the unresolved threads; `CommentItemActions` adds `onResolve` and `resolved`; `CommentHoverActionsProps` adds `resolved`; `RecordCommentThreadProps['comments']` may carry `onResolveComment`, `moderates` and `updatesOthers`. `@object-ui/i18n` adds ten keys to every pack: `detail.reopenThread`, `detail.threadResolved`, `detail.threadResolvedBy`, `detail.filterComments`, `detail.showResolvedComments`, `detail.commentsInvolvingMe`, `detail.noUnresolvedComments`, `detail.noCommentsInvolvingMe`, `detail.showAllComments`, `detail.commentResolveFailed`. Nothing existing is removed or re-typed.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the console's comment panel; `content/docs/frontend/plugins/plugin-detail.mdx` and the plugin-detail README gain resolved threads, the filter and the moderator's Edit and Delete in this change.

The desktop record page's comment panel (objectstack#36075) gains the resolved threads #36071 stores:

- ✓ in a thread's first comment's action row marks the thread resolved: it leaves the list and the comments icon's number, now the unresolved threads, drops by one. ✓ is offered on every thread, the viewer's and anyone else's, and writes through the platform's resolution door (`PUT /api/v1/comments/:id/resolution`, added in the same release), which admits whoever can read the thread (ruling 7063285032).
- The filter menu at the panel's top right holds 「显示已解决」, which shows resolved threads marked 「已由 X 解决」 (their ✓ reopens them), and 「只看我参与的」, the threads the viewer started, replied in or is mentioned in. The filter is not stored. With every thread resolved, the panel says so and offers to show them all.
- A reply into a resolved thread shows the thread reopened, as the platform stores it.
- The resolver is named from the people the page already knows (the viewer and the discussion's authors); any other resolver is named by one `sys_user` read of exactly those ids, after the discussion is drawn. Where that read is refused, the mark reads 「已解决」.
- Edit and Delete under More are offered on other members' comments to a viewer the explain engine admits to update the record by id, the server's rule for moderating someone else's comment; Edit also needs the explain engine to admit their update of a comment they did not write (the platform's row floor, `owner_only_writes`, which admits a rank-and-file member's update of the rows they created alone). Both are asked only on a definite allow: pending, a refusal, an error or a deployment without the explain service offers them on the viewer's own comments alone. Their own comments keep them as before.

Unchanged: no server permission changes (a deployment without the explain service shows Edit on the viewer's own rows only, administrators included); a deployment whose comment rows carry no `is_resolved` shows no ✓ and no filter, and the icon counts every thread; hand-written record pages and the phone keep their feed as before.
