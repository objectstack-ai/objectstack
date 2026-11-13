---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ai` MCP tool table teaches that an AI service account is refused a confirmation-gated action whatever it sends (#32936)

Clause-②: no
Metadata-protocol: none

The `list_actions` / `run_action` / `resume_run` row kept `confirm: true` after the human approves as the retry, and that retry is still right for a person and for a delegated agent. It now adds the rule the runtime already enforces (ADR-0151 D3 rule 3): under an AI service account's own key (an agent acting for itself, for no person) the call is refused `428 ACTION_CONFIRMATION_REQUIRED` whatever it sends and nothing runs, so the action is handed to a person, or its author declares `ai.requiresConfirmation: false` when it is safe unattended. Funded by trimming the pitfall line that restated the tool-level `requiresConfirmation` retirement already given under `ToolSchema`.
