---
'@objectstack/service-messaging': patch
'@objectstack/mcp': patch
---

fix: the inbox's own notification list no longer shows the raw topic, and an MCP argument refusal ends at the fix

Clause-②: no
Metadata-protocol: none

- **`@objectstack/service-messaging`.** The `mine` list view of `sys_inbox_message` (a person's own notifications) showed a Topic column reading the producer's machine id, such as `notify` for a flow's notify node or `collab.mention` for a mention. Nothing labels those ids, so the column is gone from that view: it now shows the title, the severity and the time. The `topic` field itself is unchanged and still searchable, so a filter or another view can use it.
- **`@objectstack/mcp`.** When a tool call carries an argument the tool does not declare, the refusal names the argument and the spelling to send, and now stops there. It no longer ends with the sentence "This argument used to be dropped silently and the call still succeeded, …", which explained the history of the check to internal developers and gave the caller nothing to act on. Every tool still refuses an undeclared argument exactly as before; only the closing sentence is gone.
