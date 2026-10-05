---
'@objectstack/metadata-core': minor
'@objectstack/cloud-connection': patch
'@objectstack/runtime': patch
---

`POST /api/v1/marketplace/install-local` now runs the ADR-0087 D1 protocol handshake. A manifest whose declared range excludes this runtime's protocol major is refused with `422 OS_PROTOCOL_INCOMPATIBLE`, the answer `POST /api/v1/packages` already gives. It used to install with a `200` (#21762).

Clause-②: yes (widening)

- **Install.** The handshake runs after the manifest id is parsed and before anything is registered, written or synced. The range is read from `engines.protocol`, then `engines.platform`, then `engine.objectstack`. The refusal answers `422` with `error.code: 'OS_PROTOCOL_INCOMPATIBLE'`, the handshake's own `error.message`, and `error.details: { requiredRange, rangeSource, protocolVersion, targetMajor, migrateCommand }`. It is the same on the inline-manifest branch and the cloud-snapshot branch. No ledger file is written, and an installed earlier version stays as it was. A manifest with no range, or a range the handshake cannot read, still installs, and the handshake's warning goes to the plugin's logger.
- **Restart.** On `kernel:ready`, a ledger entry whose range excludes this runtime's major is not loaded. Nothing is registered, synced, bound or seeded for it. One `error` line names the package, `OS_PROTOCOL_INCOMPATIBLE` and the replay command (`objectstack migrate meta --from N`). The boot continues with the other entries. The entry stays in the ledger, so `DELETE /api/v1/marketplace/install-local/{id}` still removes it, and installing a compatible version replaces it. Before, it was registered and its schemas synced, with no warning.
- **`@objectstack/metadata-core`:** a new export, `protocolIncompatibleAnswer(err)`, with its return type `ProtocolIncompatibleAnswer`. It turns a `ProtocolIncompatibleError` into the status, code, message and five-member `details` an HTTP door answers. Both install doors call it, so their answers are the same bytes.
- **`@objectstack/runtime`:** `POST /api/v1/packages` answers through that helper. Its response is unchanged.

A client that relied on install-local accepting a package built for another protocol major gets `422` now. Install a version built for this runtime's protocol, or migrate the package with the `migrateCommand` in the refusal.
