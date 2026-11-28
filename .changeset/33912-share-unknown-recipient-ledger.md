---
'@objectstack/spec': patch
---

chore(spec): the ADR-0087 ledger names the refusal of a manual share or sharing rule whose user recipient does not resolve

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered share-user-recipient-unresolved-refused -->

A new semantic entry, `share-user-recipient-unresolved-refused`, under step 19: `objectstack migrate meta` and the upgrade guide now say that `POST /api/v1/data/OBJECT/ID/shares` and `POST /api/v1/sharing/rules` refuse a `user` recipient that names no existing user (on a walled deployment with the record's or rule's organization known, no member of that organization, where a rule's organization is the caller's or, for a platform operator with no active organization updating a stored rule, the stored rule's own; where that organization does not resolve, the recipient is not judged) with 400 `VALIDATION_FAILED`, and how to find the inert shares stored before the refusal. No schema, key or export changes.
