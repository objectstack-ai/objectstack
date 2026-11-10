---
'@objectstack/skills': patch
---

docs(skills): objectstack-data and objectstack-upgrade SKILL.md replace their "moved verbatim" stubs with index entries

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/SKILL.md` and `skills/objectstack-upgrade/SKILL.md` still carried eight "→ Moved verbatim to …" lines left by the split that moved worked examples into `references/`, and the runs of `---` around them. Each line said where a section went and linked only the top of the file. In objectstack-data, four of them are now entries in § Quick Reference, with a fragment where the target is a section: Quick-Start Template, Metadata Protection, Seed Data & Fixtures, and Linting & Generation Quality. The Lifecycle Hooks stub is gone, because the index already has a Lifecycle Hooks entry pointing to `references/data-hooks.md`. In objectstack-upgrade, the three stubs are one-line entries in place, linking §2.3 (the worked R1), §3.4 (the report template) and the v17-canonical shapes block by their headings. The orphaned `---` lines are removed. No rule's teaching changes.
