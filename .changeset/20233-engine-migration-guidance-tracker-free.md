---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `engine-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The five ADR-0087 semantic entries about the data engine's query and write
options (`engine-dotted-projection-refused`, `engine-find-formula-filter-refused`,
`engine-find-formula-order-by-refused`, `engine-update-upsert-retired`,
`engine-dotted-filter-refused`) are printed by `os migrate meta` as the
replacement, `why:` and `verify:` lines of a manual change. Their text sent the
reader to issue-tracker numbers for what a ruling or a fix had decided; it now says
what was decided, in the sentence being read. ADR ids are kept.

Text only: no entry id, surface, `from` / `to`, conversion or matching logic
changes, and the chain rewrites exactly what it rewrote before. The generated
migration registry, `spec-changes.json` and the protocol upgrade guide carry the
same text.
