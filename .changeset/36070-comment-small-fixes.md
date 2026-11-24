---
'@object-ui/plugin-detail': patch
'@object-ui/fields': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(comments): Reply puts the caret in the reply box, comments show the author's avatar or initials, the mention menu opens at the caret, and a delete says it went through

Clause-②: yes (widening)
Metadata-protocol: none

Four small fixes to comments on the record page:

- **Reply.** Pressing Reply on a comment opened the reply box but left focus on the button, so typing went nowhere (or into the main comment box). The caret now goes into the reply box. On a comment whose replies were collapsed, Reply also expands them first.
- **Author avatar.** A comment by someone without an avatar showed a generic comment icon. Every comment and reply now leads with a 20 px avatar: the author's image, or their initials on the same round disc the people chips draw.
- **Mention menu.** Typing `@` opened the people menu at the top left of the comment box. It now opens under the caret, or above it when the window has no room below.
- **Delete.** Deleting a comment now shows a "Comment deleted" toast (zh: 评论已删除). A refused delete still shows its error, as before.

Additions, nothing removed or changed in meaning: `@object-ui/plugin-detail` exports `CommentAuthorAvatar` (and its props type), and `ThreadedReplies` takes a new optional `focusReplyOnOpen` prop (default `false`, so a host that always shows the reply box keeps today's focus behaviour). `@object-ui/fields` exports `getPersonInitials`. New locale key `detail.commentDeleted` in all eleven locale packs.
