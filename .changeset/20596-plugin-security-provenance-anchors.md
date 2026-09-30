---
'@objectstack/plugin-security': patch
---

Provenance comments in `plugin-security` were re-anchored

Comment and docblock lines under `src/` that cited tracker numbers which no
longer resolve on GitHub now cite the record in this repository that decided
the matter (an ADR where one exists, otherwise the commit in this repository's
history), and say in their own words what was decided. Comments only: no type,
schema, export, log or refusal text, or runtime behaviour changes.
