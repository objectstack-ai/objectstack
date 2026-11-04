---
'@objectstack/spec': patch
---

feat(spec): `PLATFORM_TOOLS_BY_PACKAGE['service-ai-studio']` lists `create_record`, `update_record` and `remove_sample_data`; `draft_record` is retired

Clause-②: no
Metadata-protocol: none

The cloud chat agents now create or change ONE record of the user's data after the user confirms it on a card, and remove the sample rows a seed replay recorded after a card listing them (cloud#3565, the maintainer's ruling of 2026-11-04). The three tools replace `draft_record` (cloud#3383), whose "draft it and the user saves it in a form" ending was never built. The registry lists the three names in their alphabetical order and drops the retired one, so `PLATFORM_PROVIDED_TOOL_NAMES` carries them and a skill whose `tools[]` names them resolves under ADR-0109 reference integrity, while a skill still naming `draft_record` is reported as a fictional tool (`ai-skill-tool-unresolved`). That is the whole change: three accepted `skill.tools[]` values in, one out. No schema shape changes, no export is added or removed.

**Reach of the retirement.** `draft_record` was a published constant, so removing it breaks any skill whose `tools[]` still names it. Measured before this landed: no skill in this repo names it (`validate-ai-tool-references.test.ts` names it only as the control proving the report fires; the two spec page fixtures called `draft_record` are page names, not tools); the one skill anywhere that names it is the cloud chat's `record_drafting` skill, which the cloud half of cloud#3565 (cloud#3574) moves to `create_record` / `update_record` in the same landing. A third-party skill that still names it reports `ai-skill-tool-unresolved` at validation and is not silently dropped. That is why this is graded `patch` and not left as a silent one.
