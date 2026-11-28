---
'@objectstack/scenarios': patch
---

Clause-②: no
Metadata-protocol: none

A skill-eval round run inside a project container no longer reads that project's memory. Each turn used to inherit the container's memory variables (`CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, `CLAUDE_MEMORY_STORES`), so the turns of both arms could answer from the project's own notes and the without-skill arm scored as if it had the skill. Every turn is now spawned without them, listed as `CLAUDE_MEMORY_ENV` next to the API-billing and effort variables. The scenario runner's own build and ask turns (`npx @objectstack/scenarios run`) are spawned without them too, and the README says both kinds of turn are isolated from project memory.
