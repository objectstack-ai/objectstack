---
'@objectstack/spec': minor
---

feat(spec): `PLATFORM_TOOLS_BY_PACKAGE['service-ai']` lists `read_package_doc` and `search_package_docs`

Clause-②: yes (widening)
Metadata-protocol: added

The cloud `ask` agent gains two `service-ai` tools that list and read the installed packages' `doc` items behind the `/meta/doc` audience gate (cloud#3335, the cloud half of #26691). The registry now lists both names, in its alphabetical order, so `PLATFORM_PROVIDED_TOOL_NAMES` carries them: a skill whose `tools[]` names either resolves under ADR-0109 reference integrity instead of being reported as a fictional tool (`ai-skill-tool-unresolved`). That is the whole widening: two more accepted `skill.tools[]` values. No schema shape changes, no export is added or removed, and every other name in the registry stays where it was.
