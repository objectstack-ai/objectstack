---
'@objectstack/mcp': patch
'@object-ui/console': patch
---

docs(mcp): the served `SKILL.md` and the `run_action` / `resume_run` tool descriptions stop teaching an AI service account a confirmation retry it can never pass (#32936)

Clause-②: no
Metadata-protocol: none

No runtime change: the refusal already exists (`actionConfirmationRefusal`, ADR-0151 D3 rule 3), and this changes only what the texts tell an agent.

- **`renderSkillMarkdown`.** The `run_action` entry keeps `confirm: true` after the human approves, and adds: under an AI service account's own key (an agent acting for itself, for no person) the call is refused whatever it sends and nothing runs; hand the action to a person, or its author declares `ai.requiresConfirmation: false` when it is safe unattended. The `resume_run` entry names the same refusal. The Console's "Download skill" mirror carries the same bytes.
- **HTTP MCP tools.** The `run_action` and `resume_run` descriptions, and both tools' `confirm` member descriptions, say the same thing in the same terms.
