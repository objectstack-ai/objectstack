---
"@objectstack/spec": patch
---

feat(spec): fifth liveness-ledger verdict `live-elsewhere` — dead here, enforced in a sibling repo, with gate-executable criteria (#13483)

The liveness ledger had no verdict for a key that is dead locally but genuinely
enforced in a sibling repo. The measured case is `manifest.runtime`: zero
load-side dispatch in objectstack+objectui, yet the cloud marketplace publish
gate hard-rejects (HTTP 422) an unverified publisher requesting the `node` tier
(#12400, cloud @15f55df). `dead` read alone licenses deleting the marketplace's
trust-gate input — deletion the maintainer explicitly ruled out (#11330) — and
`live` is refused by the gate, whose repo-local evidence must resolve against
this checkout. The stopgap was a qualifying sentence in the row's `note`; prose
is the weakest protection the ledger knows.

`live-elsewhere` says the split as data, and because `check-liveness.mts`
deliberately forces a decision on unknown statuses, it lands with criteria the
gate executes (`scripts/liveness/elsewhere.mts`, exit 1 on each): the
`evidence` must attribute at least one path to a foreign realm (the enforcer
pointer, foreign commit pinned in prose), `evidenceScope` must be
`"cross-repo"`, `verifiedAt` is REQUIRED (nothing local can watch a foreign
enforcer rot, so an undated elsewhere-claim would be unfalsifiable forever),
and the attestation expires: past 180 days the gate fails demanding a
re-reading of the foreign enforcer — never a re-stamp. If no seat with access
re-attests, the red build is the escalation back to the maintainer.

The status joins the evidence-scan population (any local path such an entry
also cites is held to the full existence/line/anchor/key-mention standard),
`STATUS_COLUMNS`, and the generated `state-counts.md` (new `elsewhere` column).
`manifest.runtime` migrates as the first row, attested at the #12400 reading
(2026-08-29). The ledger README documents the verdict and its re-attestation
discipline.
