---
'@objectstack/cli': patch
---

fix(cli): an `os migrate audit-*` run stops when the host's checkpoint signer or sink is registered but fails to resolve, instead of amending under the local key

Clause-②: no
Metadata-protocol: none

The four `os migrate audit-*` ledger-copy rewrites amend a sealed row before they rewrite it (ADR-0154 D7), signing the amendment with the host's `audit.checkpointSigner` when one is registered and the local key otherwise. The CLI read that slot, and `audit.checkpointSink`, through a helper that turned every resolution error into "not registered". A host signer whose factory threw (a KMS client that cannot start, a missing credential) was therefore replaced by the local key, and a failing sink dropped the export, with nothing said. A signer registered as a factory was never built at all.

The run now follows the rule the sealer follows since #34280. No host signer registered still amends under the local key, and no sink exports nothing, as before. A registered signer or sink that resolves is used, including one registered as a factory. One that is registered and fails to resolve stops the run before any row is amended or rewritten: it prints `Audit redaction seal: the '<slot>' service is registered but could not be resolved (<cause>)` and exits 1. A working host sees no change.
