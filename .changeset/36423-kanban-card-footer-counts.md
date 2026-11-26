---
'@objectstack/spec': minor
'@object-ui/plugin-detail': minor
'@object-ui/plugin-kanban': minor
'@object-ui/plugin-list': minor
'@object-ui/plugin-view': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(kanban): a card footer with each record's open comment threads and attachments (`kanban.cardFooter`)

Clause-②: yes (widening)
Metadata-protocol: added

`KanbanConfigSchema` gains one optional key with no default; a view that does not declare it renders as before, and reads nothing more:

- `cardFooter: { comments?: boolean, attachments?: boolean }` — the counts each card shows at its foot. `comments: true` shows how many of the record's comment threads are open (top-level and not resolved), the number the record page's comments icon shows. `attachments: true` shows how many files are attached to the record. A count of zero draws nothing. An unknown member is refused by name, so a later foot item is one more member.

Each count is read once for the whole board, in one grouped read per counted object over the cards the board has loaded, never one read per card, and under the reader's permissions: `sys_comment` grouped by `record_id`, asked only on an object whose discussion is on (`enable.feeds`), and `sys_attachment` grouped by `parent_id`, asked only on an object that takes files (`enable.files`). A refused read draws no count. The reader is shared in `@object-ui/plugin-detail` (`useRecordCounts`, with `compileCommentCountQuery`, `compileAttachmentCountQuery` and `readRecordCounts`), so a list row can use it next.

On a board, 视图设置 offers 「显示评论数」 and 「显示附件数」 beside the two card toggles, each only where the object has that count; both start off. Both producers of the board node (`ListView` and `ObjectView#generateViewSchema`) and the Console relay the key.
