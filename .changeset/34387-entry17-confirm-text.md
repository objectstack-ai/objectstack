---
'@objectstack/spec': patch
---

docs(spec): the `tool-requires-confirmation-retired` upgrade entry no longer tells you to send `confirm: true` to `run_action`

Clause-②: no
Metadata-protocol: none

The migration entry for the retired `tool.requiresConfirmation` key still told an upgrading author to put the operation behind an action with `ai.requiresConfirmation: true` and then call it over the MCP `run_action` tool with `confirm: true` on the request. Those tools now refuse any call that carries `confirm`, so that advice sent you into a refusal. The entry's `replacement` and `acceptanceCriteria` now describe what the gate does today: the person the caller acts for confirms the call, in an MCP client that supports elicitation or in the app (`status: 'pending_confirmation'`), and a server with no pending-confirmation service refuses it with `ACTION_CONFIRMATION_REQUIRED` (428, `details.reason: 'no_confirmation_service'`). Send `run_action` and `resume_run` calls without `confirm`.

Text only: no schema, key or runtime behaviour changes. `os migrate meta` and the upgrade guide show the corrected wording.
