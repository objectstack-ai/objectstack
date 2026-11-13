---
'@objectstack/core': patch
---

Clause-②: no
Metadata-protocol: none

fix(core): a by-name read refused as held outside the reader's declared dependency closure now names the fix that works when the holder already depends on the reader

The `outside-closure` refusal (ADR-0150 D3), answered `409 RESOURCE_CONFLICT` by every package-scoped by-name door, told the reader to declare a dependency on the package that holds the item. When that package already depends on the reader, as a module depends on the app package of its suite, the dependency is a cycle the kernel refuses at boot (`Circular dependency detected`), so the only fix it named could not be followed. The sentence now keeps that fix and adds the one that can: move what reads the item into the package that holds it, or move the item into the reading package. Which item a read answers, its status, code and `details.candidates` do not change; only the message's wording does.

Measured on HotCRM's shape (#32929): an app package's dashboard bound to a dataset its own module holds, `POST /api/v1/analytics/dataset/query?callerPackage=<app>`, before: `… Declare a dependency on the package that holds it (ADR-0141).`; after, the same sentence followed by `If that package already depends on "<app>", the dependency would be a cycle: move what reads it into that package, or move the dataset into "<app>" (ADR-0150 D3).`
