---
'@objectstack/lint': minor
---

Three write-surface lint rules now ask provenance, not just membership, before exempting a system column (#8663).

`validate-hook-body-writes`, `validate-action-body-writes` and `validate-flow-node-writes` share one `IMPLICIT_FIELDS` set, which is object-INDEPENDENT: it answers "could this name be implicitly writable somewhere", never "did the platform provision a column for it on THIS object". On an ADR-0015 `external` object those diverge — the registry injects `owner_id` / `organization_id` / the audit family onto a federated object exactly as onto a local one, but the remote database owns the schema and no column exists behind them.

Each rule now emits a new advisory finding on that path instead of staying silent — `hook-body-write-unprovisioned-anchor`, `action-body-write-unprovisioned-anchor`, `flow-node-write-unprovisioned-anchor` — sharing the `unprovisionedAnchorCause` / `unprovisionedAnchorHint` wording the read-axis rules already use. All three are `warning`: the flow-node rule's existence finding still gates at `error`, and its provenance finding deliberately does not, because the claim is about a remote schema this repo cannot see.

An author-DECLARED column of the same name is untouched — on a federated object it maps a remote column the author vouches for. `FlowNodeWriteSeverity` widens from `'error'` to `'error' | 'warning'` accordingly.
