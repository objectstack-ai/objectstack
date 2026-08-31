---
"@objectstack/spec": minor
---

feat(spec): export `walkAddressedPageComponents` — the one addressed-component traversal behind `translatePage`, now shared with the CLI extractor (#13218, ruled 2026-08-30)

`pages.<name>.components.<id>` is served by a walk that two packages used to
hand-write: `translatePage` here, and the CLI's `collectExpectedEntries`
mirroring it invariant by invariant. Five invariants were mirrored — the roots
(`regions[].components[]` only, never `slots`), the descent key
(`properties.children` only), the depth cap, the ancestor cycle guard, and the
ruled collision arbitration (region level wins outright; among nested
components, document-order first sighting) — which is precisely the
configuration `PAGE_COMPONENT_COPY_KEYS` was refactored out of, one drift
already measured (#13109: the extractor omitting keys the resolver reads).

The walk is now ONE exported symbol consumed by both sides, completing the key
list's precedent: `walkAddressedPageComponents(doc, visitor)` visits every
component the face addresses, pre-order in document order, hands the visitor an
`AddressedPageComponentContext` (`id`, `nested`, `depth`, `addressed` — the
arbitration outcome), and rebuilds the region tree from the visitor's returns
without mutating the input. `translatePage`'s behaviour is unchanged — it now
runs on the shared walk it previously inlined. The depth-cap NUMBER stays
module-private: the walk is the contract, the cap is its safety property.
