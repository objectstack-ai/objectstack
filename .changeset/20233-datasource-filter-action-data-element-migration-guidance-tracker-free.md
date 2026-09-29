---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `datasource-*`, `filter-*`, `action-*`, `data-*` and `element-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `datasource-*` family (the publish-time credential,
placeholder and URL refusals, and the bound-secret pairs a mongo datasource cannot use),
the `filter-*` family (the retired `$regex`, the `$between` endpoint refusals and the
comparand shapes the save door now refuses), the `action-*` family (the retired
descriptor key, the `resumeAuthority` default flip, the action-session rename, the bulk
dispatch contract and the engine facade's query envelope), the `data-*` family (the
retired driver and engine contract members, the retired field-changed event and two
duration keys renamed with their unit) and the `element-*` family (the filter rule array
at the page binding and the element and block doors) are printed by `os migrate meta` as
the header, `why:` and `verify:` lines of a manual change. Their text sent the reader to
issue-tracker, decision-batch and ruling-record numbers — some of which no longer
resolve, and some in other repositories — for what a ruling, measurement or fix had
decided; it now says what was decided, in the sentence being read. ADR ids are kept.

Text only: no entry id, `surface`, `from` / `to`, conversion or matching logic changes,
and the chain rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
