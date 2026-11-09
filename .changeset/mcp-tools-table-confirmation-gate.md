---
'@objectstack/skills': patch
---

docs(skills): objectstack-ai's MCP tools table teaches `run_action` / `resume_run`'s confirmation gate and the `delete_records` tool

Clause-②: no
Metadata-protocol: none

The table taught the `confirm: true` gate for `delete_record` only. It now says that an action flagged `ai.requiresConfirmation` is refused by `run_action` and `resume_run` with `428 ACTION_CONFIRMATION_REQUIRED` unless the call sends `confirm: true`, and lists `delete_records`: up to 200 records of one object per call, by `where` or `recordIds`, whose unconfirmed call is the preview and deletes nothing, and which needs `data:read` and `data:write` over OAuth.
