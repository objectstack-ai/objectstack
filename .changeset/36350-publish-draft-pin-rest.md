---
'@objectstack/rest': patch
---

feat(rest): `POST /meta/:type/:name/publish` takes `draftVersion` in its body, the pin on the draft it promotes

Clause-②: yes (widening)
Metadata-protocol: none

The per-item publish door reads an optional `draftVersion` member from its JSON body, beside `message`, and forwards it to the promotion: a draft that moved since that version (another writer's draft save landing between a caller's draft write and its publish) is refused `409 METADATA_CONFLICT` with the draft's current version as `currentVersion`, and nothing is published. A present `draftVersion` that is not a string is refused `400 VALIDATION_ERROR` instead of being read as absent. `If-Match` / `If-None-Match: *` keep pinning the active row, as before.
