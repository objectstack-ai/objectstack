---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ai` says a `delete_record` the human named, with exactly one record matching, is already approved

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`, MCP tools table, the `create_record`, `update_record`, `delete_record` row: "ask the human first, then retry" becomes the rule the `delete_record` tool description has carried since #34453. A request in which the human names the record to delete, with exactly one record matching, is their approval, so the agent sends `confirm: true` on that call without asking again. When the name matches more than one record, or the request does not identify one, the agent lists the candidates, asks which one, and sends `confirm: true` only after the answer. The server still refuses a `delete_record` without `confirm: true`; no schema or runtime change.
