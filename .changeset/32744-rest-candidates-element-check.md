---
'@objectstack/rest': patch
---

fix(rest): a package-scoped refusal's `details.candidates` is answered only when every element is a holder

Clause-②: no
Metadata-protocol: none

The rest door that answers a package-scoped refusal's `details.candidates` (the `/meta` by-name reads, the `/meta` history reads, `createMany` and the cross-object `POST /batch`) cast the shared recogniser's `readonly unknown[]` to core's `PackageScopedHolder[]` without looking at the elements. It now checks each element against the four holder kinds (`package` with a string `packageId`, `environment`, `platform`, `residual` with a string `ownerId`). Every holder core's `PackageScopedNameRefusedError` carries passes, so every answer a framework producer can cause is unchanged.

One corner moves, for a refusal no framework producer throws: a `409 RESOURCE_CONFLICT` of the refusal's shape whose `refusal.candidates` holds an element that is not a holder. FROM `details.candidates` echoing the list as thrown TO no `details` member, the answer the recogniser already gives a `candidates` that is not an array. Status, `code` and `error` are unchanged.
