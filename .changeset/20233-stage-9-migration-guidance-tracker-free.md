---
'@objectstack/spec': patch
---

fix(spec): `os migrate meta` guidance for the remaining migration-entry families states each lesson in words instead of citing tracker numbers

Clause-②: no

The ADR-0087 semantic entries are printed by `os migrate meta` as the header, `why:` and
`verify:` lines of a manual change. In the families not yet brought to this line — among them
`turso-*`, `auth-*`, `admin-*`, `ai-*`, `assembled-*`, `change-*`, `device-*`, `epoch-*`,
`incident-*`, `logging-*`, `memory-*`, `send-*`, `standard-*`, `training-*`, `websocket-*`,
`structured-*` and `translation-*` — that text sent the reader to issue-tracker, pull-request,
decision-batch and cross-repository numbers, some of which no longer resolve, for what a
ruling, measurement or fix had decided; it now says what was decided, in the sentence being
read. Verbatim rulings that carried a card or batch number keep only their operative words.
ADR ids are kept, and so are the rule numbers of this repository's own contributor guide. With
this change no semantic entry's printed guidance carries a `#`-numbered tracker id.

One replacement also named a contributor-guide rule by a number that no longer exists:
`address-location-value-unknown-keys-refused` now states the rule itself — a consumer never
carries an alias for an off-spec key; the metadata is fixed where it is written.

Text only: no entry id, `surface`, `from` / `to`, conversion or matching logic changes, and the
chain rewrites exactly what it rewrote before. The generated migration registry,
`spec-changes.json` and the protocol upgrade guide carry the same text.
