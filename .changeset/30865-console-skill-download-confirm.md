---
'@object-ui/console': patch
---

fix(console): the "Download skill" SKILL.md teaches `delete_record` with `confirm: true`, and the rest of what the server serves

Clause-②: no
Metadata-protocol: none

The Integrations page's "Download skill" button wrote a SKILL.md that taught `delete_record({ objectName, recordId })` with no `confirm`. The MCP server refuses that call with `ACTION_CONFIRMATION_REQUIRED` and deletes nothing, so an agent that followed the downloaded skill failed every delete. The download now carries the same text the MCP server serves to an API key or a session: `delete_record({ objectName, recordId, confirm })` with the confirmation rule, the business-action tools (`list_actions`, `run_action`, `resume_run`), `validate_expression`, the OAuth connection track, and the `Authorization: Bearer` key form. A test compares the download with the server's renderer byte for byte, so the two cannot drift apart again unnoticed.
