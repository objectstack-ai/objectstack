---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/plugin-approvals': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

The MCP read tools (`list_objects`, `describe_object`, `query_records`, `get_record`, `aggregate_records`) now admit a system object whose author declared `enable.aiReadable: true`, asked through a new optional bridge member `aiReadExposed` that both bridges answer with `isAiReadExposed`. Every gate after admission is unchanged (the caller's permissions, row-level security, the object's own read gates, field masking), and every write tool still refuses every `sys_*` object. `sys_approval_request` declares the key, so an approver's agent can read the requests a read grant on that object serves them; `query_records` names the "waiting on you" filter shape.
