---
'@objectstack/cloud-connection': patch
'@objectstack/metadata-core': patch
---

feat(cloud-connection,metadata-core): an install the protocol handshake admitted without checking says so in its answer, not only in the server log

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/cloud-connection`: `POST /api/v1/marketplace/install-local` answers `data.protocolCheckSkipped`** when the ADR-0087 handshake admitted the package without checking it: `{ reason, packageId, protocolVersion, message }`, plus `requiredRange` and `rangeSource` for `reason: 'unparsed-range'`. `reason` is the handshake's own verdict: `no-range` (the package declares no `engines.protocol`) or `unparsed-range` (it declares a range the handshake cannot read). `protocolVersion` is the protocol the package was installed under unchecked, and `message` says so in plain words for the person who pressed Install. It is on all three success answers (managed, `unmanaged`, and a paired customization package), and omitted, not nulled, when the range was checked, so that answer's key set is unchanged. The `warn` log line stays as it was.
- **`@objectstack/metadata-core`: `assertProtocolCompat` returns the verdict it admitted the package under** (new exported type `ProtocolCompatAdmitted`; it returned `void`), and the `no-range` and `unparsed-range` verdicts of `checkProtocolCompat` carry `protocolVersion`, the version they were judged against. A door that answers a caller reads the skipped check from the handshake itself instead of judging the range a second time.
