---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

docs(skills): the `description` of `objectstack-data`, `-ui`, `-automation`, `-formula`, `-i18n` and `-query` now leads with what the user is doing ("design or change a data model, in a project or through MCP"), keeps the `*.object.ts`-style file names as a secondary cue, and ends with a "Not for" clause naming the neighbouring skill. An agent building through MCP has no project files, so a description that triggered on file names never loaded the skill. Each is 435 to 450 characters (432 to 849 before). No skill body changes; the README index and the Skills reference page are regenerated from the new text.
