---
'@objectstack/spec': minor
---

feat(spec): `PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` lists `draft_record`

Clause-②: yes (widening)
Metadata-protocol: added

The cloud `ask` agent gains `draft_record`, a signal tool that turns chat content into a validated new-record draft the user saves themselves (cloud#3383; the console card is #28104). The registry now lists the name, in its alphabetical order, so `PLATFORM_PROVIDED_TOOL_NAMES` carries it and a skill whose `tools[]` names it resolves under ADR-0109 reference integrity instead of being reported as a fictional tool (`ai-skill-tool-unresolved`). That is the whole widening: one more accepted `skill.tools[]` value. No schema shape changes, no export is added or removed.
