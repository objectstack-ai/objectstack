---
'@objectstack/plugin-audit': patch
---

plugin-audit: a mention notification reaches a mentioned user only when they may read the comment it previews, as well as the record it links

Clause-②: no
Metadata-protocol: none

The `@mention` recipient gate decided each mentioned user on one read: may they open the record the comment is on. The notification also carries a preview of the comment's text, and being able to read a record does not mean being able to read its comments, because the comment object has its own object-level grant, tenant wall and row scope. The gate now also runs each recipient's own read of the comment, by id. It uses the same evaluator as the comment read path (`resolveReadableParentIds`, in the recipient's resolved envelope), and it withholds the notification when that read does not return the comment. Each withheld recipient is logged at `warn` with a new reason: `cannot_read_thread`, or `no_comment_id` when the comment has no id to read it by. The comment text is never logged.

For administrators: a mentioned user is notified only when a permission set they hold grants read on comments. To notify a population that should take part in record discussions, grant comment read in a set it holds.
