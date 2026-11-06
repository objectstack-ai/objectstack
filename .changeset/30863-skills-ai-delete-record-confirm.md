---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ai` skill's MCP tools table now teaches that `delete_record` needs `confirm: true` — a call without it is refused with `ACTION_CONFIRMATION_REQUIRED` (428), so the agent asks the human first, then retries. The row said only that `delete_record` is annotated destructive, so an agent following it was refused since the MCP tool started requiring confirmation.

Clause-②: no
Metadata-protocol: none
