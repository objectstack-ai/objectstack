---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

A skill-eval round run inside a project container no longer reads that project's memory. Each turn used to inherit the container's memory variables (`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, `CLAUDE_MEMORY_STORES`), so the turns of both arms could answer from the project's own notes and the without-skill arm scored as if it had the skill. Every turn is now spawned without them, listed as `CLAUDE_MEMORY_ENV` next to the API-billing and effort variables, and the README says a round is isolated from project memory.
