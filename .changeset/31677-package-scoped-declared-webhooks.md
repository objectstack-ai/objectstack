---
'@objectstack/plugin-webhooks': patch
---

feat: a declared webhook's name resolves by (package, name) through the shared package-scoped resolver (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

Which declared webhook a name dispatches is now answered by `resolvePackageScopedName` from `@objectstack/objectql`, never by list order. The dispatcher and the by-name reads (activation door, redelivery veto, name guard) read the whole environment's declaration, so each asks as a caller with no package: the environment's own item, else the unique package holder, else a refusal that names every candidate.

Who is affected: a deployment that held one declared webhook name in two packages from before phase 1's one-holder refusal (the cold boot warns about it as a "Bare-name conflict at boot"). That webhook was dispatched from whichever package registered first; it is now not dispatched, the refusal is logged once naming both packages, and the by-name reads answer a `409 RESOURCE_CONFLICT` naming them instead of "not declared". Rename one of the two (the boot warning names the rename). First-party count of such clashes: 0. Every other name resolves exactly as before, since phase 1 still refuses a new clash at install.

`@objectstack/plugin-webhooks` now depends on `@objectstack/objectql` at runtime (it was a dev dependency).
