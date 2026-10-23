---
'@objectstack/skills': patch
---

docs(skills): objectstack-data's security rules name the risk of renaming or removing a shipped access item in a later package version

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md` gains a section on shipping a new version. Administrators act on a package's permission sets, positions, sharing rules and capabilities by name: they switch them off, clone them, and reference the package's objects and fields from their own sets. The section says what a rename, a removal or an added field deny does to those choices on upgrade. It asks authors to keep shipped names stable and, when a change like this is needed, to say in the release notes what administrators should re-check. It is guidance only; no gate and no behaviour change.
