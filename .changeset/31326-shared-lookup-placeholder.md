---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the shared-record page shows a lookup as "Linked record", never its stored id

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/console`**: on a share link (`/s/TOKEN`), a lookup or master-detail field with a value now reads "Linked record" instead of the referenced record's stored id, which an anonymous visitor could not use and which read as a broken page. An empty one still reads as empty. Which field is a lookup comes from the `type` the resolve answer's `fields` projection already serves; the page sends no extra request and reads nothing about the referenced record. An answer from a server that predates the projection carries no type, so its rows render as before.
- **`@object-ui/i18n`**: every pack gains `sharedRecord.linkedRecord` (en "Linked record", zh-Hans 「已关联记录」).
