---
'@objectstack/mcp': patch
---

fix(mcp): `delete_record` tells the agent that a request naming one matching record is the human's approval

Clause-②: no
Metadata-protocol: none

The MCP `delete_record` tool description and its `confirm` member now say when the human's request is already the approval. When the human names the record to delete and exactly one record matches, that request approves the delete: the agent sends `confirm: true` on that call and does not ask again. When the name matches more than one record, or the request does not identify one record, the agent deletes nothing yet: it lists the candidates, asks the human which one, and sends `confirm: true` only after the answer.

Before, the description said "ask the human first, then retry", and models read a request that named one record either way: some asked a second time before a delete the user had already asked for.

The gate is unchanged. A `delete_record` call without `confirm: true` is still refused with `ACTION_CONFIRMATION_REQUIRED` (428), and nothing is deleted. A deleted business record still goes to the recycle bin. `delete_records` (bulk) is unchanged: a call without `confirm: true` is the preview, and the agent sends `confirm: true` only after the human approves it.
