---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the two padded list-view field-name entries states the contract-first rule in words, and the notification/embed retirement drops a sweep batch ordinal

Clause-②: no

The ADR-0087 semantic entries are printed by `os migrate meta` as the header, `why:` and
`verify:` lines of a manual change. Two of them —
`ui-list-view-grouping-field-padded-refused` and `ui-list-view-groupbyfield-padded-refused` —
explained why a padded field name is refused rather than trimmed by pointing at a rule number
in a contributor guide, a number that names nothing in this repository's guide. Their `why:`
text now states the rule itself: fix the metadata, not the renderer — off-spec metadata is
refused where it is authored, never coerced into working.

`ui-notification-action-embed-config-retired` named the batch of the v17 unknown-key
strictness sweep that measured the two retired shapes by its ordinal. The sentence already
says what that batch measured and decided, so the ordinal is dropped.

Text only: no entry id, `surface`, `from` / `to`, conversion or matching logic changes, and the
chain rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
