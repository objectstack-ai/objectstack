---
'@objectstack/spec': patch
---

Register `UNIQUE_SCOPE_CONFIRMATION_REQUIRED` (`@objectstack/cloud-connection`) in `ERROR_CODE_LEDGER` — the ADR-0120 D5e posture-gate refusal the marketplace install seam answers (409) when an app declares installation-wide unique constraints under the `isolated` tenancy posture. The code was already on the wire with a live reader (`os package install` branches on it to print the per-index decision list) but sat outside the closed ADR-0112 vocabulary (`StandardErrorCode ∪ ERROR_CODE_LEDGER`), invisible until #9223 taught the dispatcher-vocabulary gate to see a constant stamped in an object literal. No wire behavior changes — the value was already emitted; `ApiErrorSchema` now accepts what the wire actually carries. The now-discharged `pending-registration` row ratchets out of `packages/runtime`'s dispatcher-error-vocabulary table in the same change.
