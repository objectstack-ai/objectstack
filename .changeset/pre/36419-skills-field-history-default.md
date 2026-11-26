---
'@objectstack/skills': patch
---

docs(skills): the data skill teaches field-change values as on by default (`enable.fieldHistory`), no longer as the `trackHistory` opt-in

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/SKILL.md` still gave `enable.trackHistory`, default `false`, as the field-level audit trail. An agent following it added a flag that no longer decides anything about values, or believed history was off. The `enable` table now has a `fieldHistory` row: a changed field's old → new values show on the record's activity timeline unless the object writes `enable.fieldHistory: false` or the field writes its own `fieldHistory: false`; a media or structured field shows values only with `fieldHistory: true`, and a credential field never does. Each value is served per the reader's read rule for that field, and the audit ledger (`sys_audit_log`) keeps its own grant. The `trackHistory` row now says what the flag still does (the ledger view on the record page and the `history` API verb) and that it is not the values switch.

New text is paid for by cuts in the same file: the `aiReadable` row keeps only what an app author needs (platform objects only, refused at parse on an app object), and nine restating phrases are shortened. No metadata shape changes.
