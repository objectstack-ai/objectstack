---
'@objectstack/skills': patch
---

docs(skills): objectstack-data's security rules name the risk of renaming or removing a shipped access item in a later package version

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md` gains a closing section, "Renaming or removing a shipped access item". Administrators act on a package's permission sets, positions, sharing rules and capabilities by name: they switch them off, clone them, and name the package's objects, fields and capabilities in their own sets. The section says what a rename, a removal or an added field deny does to those choices on upgrade, asks authors to keep shipped names stable and, when such a change is genuinely needed, to say in the release notes what changed and what an administrator should re-check. It is guidance only: no gate and no behaviour change.

The file stays under its token ceiling. The new text is paid for by deleting restatements elsewhere in the same file: the stack-key bullet that repeated the code sample's comment, the assignment payload that repeated the row's columns, a code comment that repeated the sentence above it, the `viewAllRecords` corollary sentence, and the callout's repeats of the Layer 0 bullets and of a citation made two paragraphs earlier. No rule changes meaning.
