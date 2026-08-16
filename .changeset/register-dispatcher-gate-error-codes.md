---
"@objectstack/spec": patch
---

Register, in `ERROR_CODE_LEDGER`, the seven error codes the dispatcher
error-vocabulary gate (#8087, maintainer ruling 2026-08-12: option B delivered
as a gate) reported as reaching a wire `error.code` with no ledger row — so the
bodies that carry them parse against `ApiErrorSchema` instead of failing the
schema they claim to satisfy:

- `FLOW_FAILED` (`@objectstack/runtime`) — a flow that ran and rejected (#3962)
- `QUERY_OBJECT_MISMATCH` (`@objectstack/metadata-protocol`) — query body's
  `object` key names a different object than the route
- `ERR_AUTONUMBER_COLLISION`, `ERR_TRANSACTION_UNSUPPORTED`,
  `ERR_CROSS_DATASOURCE_TRANSACTION_WRITE`, `ERR_HOOK_TARGET_REBIND`
  (`@objectstack/objectql`) — the unswept members of the package's `ERR_*`
  family
- `FIELD_VISIBILITY_UNRESOLVED` (`@objectstack/rest`) — ADR-0106 D6 tier 3
  fail-closed 503

Owning packages follow #7504 provenance (the package whose source stamps the
code). No wire value changes: every code was already emitted; the ledger now
admits what is measured on the wire. `STORAGE_FAILURE` (producer-less) and
`DUPLICATE` (the pinned witness of the sandbox-authored limb, #9106) are
deliberately not registered.
