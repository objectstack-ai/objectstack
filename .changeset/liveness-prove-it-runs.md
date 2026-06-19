---
"@objectstack/spec": patch
---

Add the ADR-0054 "prove-it-runs" proof field + ratchet to the spec liveness gate. A `live` ledger entry may now carry a `proof` — a reference (`<file>#<proof-id>`) to a dogfood test that asserts the property's runtime behavior. For the high-risk classes bound this phase (field types → `field.type`; RLS → `permission.rowLevelSecurity.using`), a `live` classification must carry a valid proof, validated statically by the liveness gate (the file exists and declares the matching `@proof:` tag). The authoritative high-risk-class list lives in `scripts/liveness/proof-registry.mts`; see `liveness/README.md`.
