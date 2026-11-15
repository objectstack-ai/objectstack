---
'@objectstack/types': patch
'@objectstack/rest': patch
---

fix(types, rest): a package-scoped refusal's `details.candidates` is answered only when every element is a holder

Clause-②: no
Metadata-protocol: none

`packageScopedRefusalCandidates` (`@objectstack/types`), the one recogniser every door reads for a package-scoped refusal's `details.candidates`, answered the refusal's list as `readonly unknown[]` without looking at its elements, and the rest door cast that to core's `PackageScopedHolder[]`. The recogniser now checks each element against the four holder kinds (`package` with a string `packageId`, `environment`, `platform`, `residual` with a string `ownerId`) and answers the list typed as those holders, so the rest door assigns it without a cast. Every holder core's `PackageScopedNameRefusedError` carries passes, so every answer a framework producer can cause is unchanged.

One corner moves, for a refusal no framework producer throws: a `409 RESOURCE_CONFLICT` of the refusal's shape whose `refusal.candidates` holds an element that is not a holder. FROM `details.candidates` echoing the list as thrown TO no `details.candidates` member, the answer the recogniser already gave a `candidates` that is not an array. It moves on every door that reads the recogniser alike (the `/data` doors, a batch row's error, the `/meta` reads, the resolver's doors), so they keep agreeing. Status, `code` and the sentence are unchanged.
