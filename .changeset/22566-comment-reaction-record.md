---
'@objectstack/plugin-audit': minor
---

`sys_comment_reaction`: an emoji reaction to a comment is now the reacting user's own record, one row per comment, emoji and user

Clause-②: yes (widening)

- **The object.** `@objectstack/plugin-audit` registers `sys_comment_reaction` beside `sys_comment`. A row holds `comment_id` (the reacted comment's id), `emoji` (the character sequence, at most 64 characters) and `user_id` (the user who reacted). The data API offers `get`, `list`, `create` and `delete` on it. It offers no `update`: a reaction is removed and made again, not edited.
- **Who may read it.** A reaction is readable exactly when its comment is. Every read of the object (`find`, `findOne`, `count`, `aggregate`, and so the list total) is narrowed to the rows whose comment the caller can read, decided by a read of those comments under the caller's own context. A reaction whose comment was deleted is read by nobody.
- **Who may write it.** A caller reacts only to a comment it can read; on any other comment, including one that does not exist, the create is refused with `403 RECORD_NOT_ACCESSIBLE`. `user_id` is set from the signed-in user, and a value the client sends is replaced; a session with no user is refused. A member deletes their own reaction, and not another member's, by the platform's own-record rule (`owner_only_deletes`). The author-only edit rule on `sys_comment` is unchanged: reacting no longer writes the comment's row.
- **One row per reaction.** `(comment_id, emoji, user_id)` is unique within an organization. Two members reacting at once write two rows. The same reaction a second time is refused, and the data API answers `409 UNIQUE_VIOLATION`.
- **Reading reactions for a feed.** Read the reactions of the comments on screen in one request, `comment_id` `$in` those ids, and group the rows by comment and emoji. Nothing is stored or computed on the comment row.
- **Granting it.** The object's create, read and delete bits come from a permission set, as `sys_comment`'s do. The `everyone`-bound baseline (`member_default`) grants nothing on it.
- **`sys_comment.reactions` is unchanged in this release.** The column is still declared and still written by clients that write it. It is retired separately, and reactions stored in it are not converted into records.
