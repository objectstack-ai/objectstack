---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform says a locale added in the `.custom` pair is served on the base's address, and a locale a dependent adds under the base's name stays under its own package

Clause-②: no
Metadata-protocol: none

- **Before.** The ADR-0146 customization paragraph said a locale the base does not ship is added in the pair without `overrides`, and stopped there: nothing said where that added locale is served, and nothing said what a dependent package's added locale under the base's name reaches. The reads of a base's address now decide an email template member by member, so an author could expect the pair's added locale to stay under `hotcrm.custom` only, or a dependent's to answer on the base's address.
- **Now.** One sentence beside that rule: the base's address serves the pair's added locale too (both lists, the execution list, a send in that locale), and a locale a dependent adds under the base's name is served only under its own `?package=`, never by a base-named or package-less read. The file stays under its token ceiling: the sentence is paid for by tightening four restating clauses elsewhere in the file (one intro clause, one explanatory aside, one restated driver rule, one filler template bullet). No rule is removed, no frontmatter, schema or behaviour changes.
