---
'@objectstack/skills': patch
---

docs(skills): the data skill's roll-up guidance has the builder resolve a `security-rollup-source-unreadable` warning before finishing

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/relationships.md` § Roll-up Summaries now says what to do when a permission set reads a parent `summary` but not the child data behind it: grant the child read when the set should see the children, otherwise mask the summary on that set (`fields["PARENT.SUMMARY"]: { readable: false }`, after removing any View All / Modify All the set holds on the parent), with one worked example and a matching eval case.
