---
'@objectstack/spec': patch
---

docs(spec): the liveness ledger README's `manifest` cell names the type's dead set as the ledger holds it, and says why `packaging` is `planned`

Clause-②: no
Metadata-protocol: none

The `manifest` row of `liveness/README.md` said "Dead 19", counting the per-child rows of the retired `capabilities` and `configuration` containers and a `loading` row that has since left the ledger. The cell now partitions the dead set the ledger carries (the ten dead `contributes` members and the three retired containers, one tombstone row each), which sums to the count in the generated `liveness/state-counts/manifest.md` shard. It also gains the missing sentence for `packaging`, the type's only `planned` row: `bundled` is the one strategy, `manifest-deps` is refused by name, and `os plugin build` reads the key only to echo it. No ledger status, evidence, schema or accepted shape changes: only the README prose moves.
