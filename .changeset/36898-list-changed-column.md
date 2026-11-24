---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the metadata list shows when each item last changed and marks items with unpublished changes

Clause-②: no
Metadata-protocol: none

The generic metadata list (Setup's catalog lists and Studio's "All metadata" area) gains a 「修改时间」 / "Modified" column, read off the list answer's `changedAt` sibling. Only an item served from a stored row has a time; a code-shipped item shows an empty cell. The sort control gains "Modified (newest first)" and "Modified (oldest first)", which ride the address as `sort=-changed` / `sort=changed`; items without a time sort last either way, and the item page's ‹ › follow the same order.

Beneath the time, an item with a pending draft on the existing `GET /api/v1/meta/_drafts` ledger is marked 「有未发布的改动」 / "Unpublished changes", including drafts that existed before this change. A draft the AI assistant wrote (any of its recorded changes made by the AI copilot or through the MCP build door, the rule the item page's AI line uses) is marked 「AI 的改动未发布」 / "Unpublished AI changes" instead. A publish removes the mark.

`MetadataClient.listResponse` now returns the list's `changedAt` beside the items (each entry read with the spec's own rule; an entry that does not parse is dropped, and absence stays absence). `list` is unchanged.

New locale keys in the studio catalogue (en, zh): `engine.list.sort.changed.asc`, `engine.list.sort.changed.desc`, `engine.list.col.changedAt`, `engine.list.draftMark.human`, `engine.list.draftMark.humanTitle`, `engine.list.draftMark.ai`, `engine.list.draftMark.aiTitle`.
