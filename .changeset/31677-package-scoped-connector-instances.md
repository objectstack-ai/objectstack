---
'@objectstack/service-automation': patch
---

feat: a declared connector instance's name resolves by (package, name) through the shared package-scoped resolver (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

Which declared connector instance a name materializes is now answered by `resolvePackageScopedName` from `@objectstack/objectql`, never by list order. The connector reconcile reads the whole environment's declaration, so it asks as a caller with no package: the environment's own item, else the unique package holder, else a refusal that names every candidate.

Who is affected: nobody today. Phase 1's one-holder refusal still holds for `connector`, so no two installed packages can ship the same connector instance name, and every name resolves exactly as before. Once that backstop narrows (its own later release), a name two packages ship is not materialized, and boot fails naming both packages, as it already did for a duplicate instance name (which named no candidates).

`@objectstack/service-automation` now depends on `@objectstack/objectql` at runtime (it was a dev dependency).
