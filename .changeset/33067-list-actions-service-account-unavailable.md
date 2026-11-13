---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(runtime): MCP `list_actions` marks a confirmation-gated action `unavailable` for an AI service account

Clause-②: yes (widening)
Metadata-protocol: none

An AI service account (an agent principal acting for itself, with no person it acts for) never confirms an action for itself, so `run_action` refuses it `428 ACTION_CONFIRMATION_REQUIRED` on every action declaring `ai.requiresConfirmation: true`, whatever the call sends. `list_actions` used to show that action to the account with no `unavailable` marker, so a headless agent planned a call that could never run. The row now carries `unavailable` with the refusal's own code and sentence ("a person runs this action"). The marker follows the declared flag only, not the listing's destructive heuristic. Where the forward-credential refusal also applies, the row carries the confirmation refusal, the one `run_action` answers first. A person, a delegated agent and the system context see the listing unchanged. The `McpActionSummary.unavailable` documentation in `@objectstack/mcp` names the new case and its code.
