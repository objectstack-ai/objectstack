---
"@objectstack/spec": patch
---

Add the ADR-0054 "prove-it-runs" proof field + ratchet to the spec liveness gate. A `live` ledger entry may now carry a `proof` — a reference (`<file>#<proof-id>`) to a dogfood test that asserts the property's runtime behavior. A bound high-risk `live` property must carry a valid proof, validated statically by the liveness gate (the file exists and declares the matching `@proof:` tag). Four high-risk classes are bound this phase: field types (`field.type`), RLS (`permission.rowLevelSecurity.using`), flow nodes (`flow.nodes.type`), and analytics (`dataset.dimensions.dateGranularity`). The `dataset` metadata type is now governed (new `liveness/dataset.json`). The authoritative high-risk-class list lives in `scripts/liveness/proof-registry.mts`; see `liveness/README.md`.
