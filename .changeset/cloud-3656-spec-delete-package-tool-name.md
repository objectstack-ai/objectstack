---
'@objectstack/spec': patch
---

feat(spec): `PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` lists `delete_package`

Clause-②: no
Metadata-protocol: none

The cloud build agent gains a `delete_package` tool that only stages the removal of a package built in the environment; a person confirms before anything is deleted (cloud#3656). The registry lists the name in its alphabetical place, so `PLATFORM_PROVIDED_TOOL_NAMES` carries it, cloud's tool-name conformance test agrees with what `service-ai-studio` registers, and a skill whose `tools[]` names `delete_package` resolves under ADR-0109 reference integrity instead of being reported as a fictional tool. No schema shape changes and no export is added or removed.
