---
'@objectstack/mcp': patch
---

fix(mcp): a refused tool argument names the right key without pointing at the protocol upgrade guide, and every `recordId` argument says it takes the `id` that `create_record` answers

Clause-②: no
Metadata-protocol: none

A tool call with an undeclared argument (`update_record` sent `id`, `query_records` sent `filter`, `list_objects` sent `includeSystem`) was refused with the right suggestion (`id` → `recordId`, `filter` → `where`) followed by "Keys retired before the previous protocol major are no longer prescribed here — see the protocol upgrade guide". Tool arguments are not protocol metadata and none was ever retired, so that sentence is gone from every MCP tool refusal; the refusal now ends at the key to send.

The record tools keep their spellings: `create_record` still answers `{ object, id, record }` (the data protocol's create answer) and `get_record`, `update_record`, `delete_record`, `run_action`, `read_file` and `create_upload_link` still take `recordId`. The `recordId` argument's description now says the value is the `id` that `create_record` answers and that each `query_records` row carries, so an agent chaining create → update → get reads the hand-off off `tools/list` instead of learning it from a refusal. No argument is added, renamed or aliased.
