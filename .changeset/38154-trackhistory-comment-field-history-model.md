---
'@objectstack/spec': patch
---

docs(spec): the system-module and security-context comments stop listing field `trackHistory` as part of the audit authoring surface

Clause-②: no
Metadata-protocol: none

Two source comments in `packages/spec/src/system` described the live audit path as "always-on capture + object/field `trackHistory`". A field's `trackHistory` only opts a media or structured-JSON type into old → new values on the record activity timeline, and its `false` turns nothing off; capture is always on whatever either flag says. The comments now name the object's `enable.trackHistory` as what opens the ledger's view on the record page (and the `history` verb), and say that field-change values on the activity stream are `fieldHistory`'s. The generated security-context reference page follows.

Comments only: no schema, no accepted key and no refusal changes. Nothing to migrate.
