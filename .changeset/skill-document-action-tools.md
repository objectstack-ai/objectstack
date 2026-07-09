---
'@objectstack/mcp': patch
---

fix(mcp): the generated SKILL.md now documents the business-action tools

`renderSkillMarkdown()` listed only the 7 object-CRUD tools; the MCP surface
exposes 9 — `list_actions` / `run_action` (business actions) were missing, so
agents installing the skill never learned they can run approvals, conversions,
or flow triggers directly. The skill now covers the full native tool surface
and teaches action preference: when `list_actions` offers a matching action,
call it instead of hand-editing the records it would have touched (actions
carry the app's validation and side effects), confirming destructive or
confirmation-flagged actions with the user first.

Prerequisite for the distribution shells (#2714 Phase 0): every shell repo
copies this rendered content, so the gap had to close before fan-out.
