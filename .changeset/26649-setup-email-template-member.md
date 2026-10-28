---
'@object-ui/data-objectstack': patch
'@object-ui/i18n': patch
---

fix(data-objectstack): the metadata client's layered read, item and draft reads, publish and reset name the bundle member they address

Clause-②: no
Metadata-protocol: none

`MetadataClient.layered()`, `get()`, `getDraft()`, `publish()` and `reset()` take an optional `member` and send it as `?member=`, the selector the by-name doors read for a metadata type whose identity is a pair (today only `email_template`, `(name, locale)`). Omitted, every call sends exactly the URL it sent before and the door addresses the canonical member. The parameter is never sent empty.

`getDraft()` with a `member` skips the draft read when the pending-drafts ledger lists that name only as another member's draft.

Setup's metadata list now shows an email template's locale in its own column and links each row to its own member (`?member=LOCALE`), and the editor passes that member to its layered and draft reads and to its publish, reset and discard, so each language of a template opens and is edited on its own.

`@object-ui/i18n`'s `studio` namespace gains the column's label, `engine.list.col.locale` (`Locale` / `语言`).
