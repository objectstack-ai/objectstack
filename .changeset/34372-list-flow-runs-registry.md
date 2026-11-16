---
'@objectstack/spec': minor
---

feat(spec): `PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` lists `list_flow_runs`

Clause-②: yes (widening)
Metadata-protocol: added

The cloud build agent gains a read-only `list_flow_runs` tool: it reads one flow's recent runs as the caller, so the agent can answer "did my automation work?" from a run's own outcome. The registry lists the name in its alphabetical place, so `PLATFORM_PROVIDED_TOOL_NAMES` carries it and `isPlatformProvidedToolName('list_flow_runs')` answers `true`. A skill whose `tools[]` names `list_flow_runs` now resolves under ADR-0109 reference integrity instead of being reported as a fictional tool (`ai-skill-tool-unresolved`). The chat panel's step label for the tool is in every built-in locale pack. No schema shape changes and no export is added or removed.
