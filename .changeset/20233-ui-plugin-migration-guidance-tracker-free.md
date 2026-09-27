---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the `ui-*` and `plugin-*` migration entries states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries of the `ui-*` family (component props rows, form-field
and list-view refusals, the react-tier `ListView` aliases, and the retired
interaction, notification, embed, widget and i18n vocabularies) and of the `plugin-*`
family (the plugin manifest, runtime, health-monitor and security-scanner retirements)
are printed by `os migrate meta` as the header, `why:` and `verify:` lines of a manual
change. Their text sent the reader to issue-tracker numbers — some of which no longer
resolve — for what a ruling, measurement or fix had decided; it now says what was
decided, in the sentence being read. The same holds for the two `surface` headers that
carried a number. ADR ids are kept.

Text only: no entry id, `from` / `to`, conversion or matching logic changes, and the
chain rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
