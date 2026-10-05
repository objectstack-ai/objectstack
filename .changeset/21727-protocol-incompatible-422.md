---
'@objectstack/metadata-core': minor
'@objectstack/runtime': minor
'@objectstack/spec': minor
---

A package install refused by the ADR-0087 D1 protocol handshake now answers `422 OS_PROTOCOL_INCOMPATIBLE`, with its structured diagnostic in `error.details`. It used to answer the `500` server-fault fallback, with the diagnostic only inside the message.

Clause-②: yes

- **`POST /api/v1/packages`:** a manifest whose declared range (`engines.protocol`, then `engines.platform`, then `engine.objectstack`) excludes this runtime's protocol major answers `422`, with `error.code: 'OS_PROTOCOL_INCOMPATIBLE'` and `error.details: { requiredRange, rangeSource, protocolVersion, targetMajor, migrateCommand }`. `error.message` is unchanged, and the command after its `Run:` equals `migrateCommand`. Nothing is installed, so a later `GET /api/v1/packages/{id}` still answers `404`.
- **The no-protocol-service fallback:** in a composition without a `protocol` service, `POST /api/v1/packages` used to install such a manifest. It now runs the same handshake and answers the same `422`.
- **`@objectstack/metadata-core`:** `ProtocolIncompatibleError` declares `status` and `statusCode` `422`, with `code` as the literal `'OS_PROTOCOL_INCOMPATIBLE'`. It also carries a `Symbol.for` brand, and the new `isProtocolIncompatibleError(e)` recognises it across module instances, where `instanceof` would not. Any other caller that resolves the error (the boot-time `AppPlugin` load included) reads `422` rather than the `500` fallback.
- **`@objectstack/spec`:** the error-code ledger's `OS_PROTOCOL_INCOMPATIBLE` row states its status (422) and the door that carries the diagnostic. The vocabulary does not change.

A client that branched on `500` for this code should branch on `422`, or on `error.code`. None was found in this repository, the SDK or the console.

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, spelling, export or stored shape is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. The refusal's HTTP status and envelope change and one export is added, but the protocol range check itself is unchanged, and the no-protocol-service fallback now refuses what the composed door already refused. The other categories are closed on facts: the three packages publish (not unpublished); no ADR-0087 id covers this refusal and this diff adds none (not registered or already-registered); and the change moves a wire answer, not only a TS declaration (not runtime-interface-only or type-surface-only). -->
