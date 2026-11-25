---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills,spec): `objectstack-ai` says what a package skill does in the in-app `ask` assistant, and that the context a trigger condition reads is client-sent

Clause-②: no
Metadata-protocol: none

`skills/objectstack-ai/SKILL.md`, *Trigger Conditions*, gains one paragraph on the in-app `ask` assistant (cloud / Enterprise):

- A package skill with `surface` `ask` or `both` loads for the app the user is in. The `build` side is not served while in-app build is closed.
- A tool the skill names outside the allow-set is dropped with a diagnostic.
- A condition can read `appName`, `objectName`, `recordId`, `selectionKind` and `userRole`.
- The client sends all five. A `triggerConditions` entry on any of them, `userRole` included, is routing, never access control: the turn's tools still run under the caller's own permissions.

Paid for in part by deletion in the same file, with the token ceiling unchanged (6801): three passages that restated text the file keeps elsewhere are cut. They are the one-sentence definition of a skill under *Skill Configuration*, the "extend the platform with skills" sentence under *Platform agents*, and three restated clauses of the open-edition sentence under the built-in skills table.

`evals/skills-tools-knowledge.json`, eval 5: its `expected_output` now says the in-app `ask` assistant picks the skill up by surface for the app the user is in, and names the allow-set. Its assertions are unchanged.

`@objectstack/spec`: the description of `SkillSchema.triggerConditions` adds that the context fields a condition reads are reported by the client, so a condition is routing, never access control. The reference page `references/ai/skill` is regenerated. Text only: the schema accepts and refuses what it did.
