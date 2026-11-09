---
'@objectstack/plugin-email': patch
---

feat: an email template's name resolves by (package, name) through the shared package-scoped resolver (ADR-0150 D3/D4)

Clause-②: no
Metadata-protocol: none

Which email template a send or a render uses is now decided by `resolvePackageScopedName` from `@objectstack/objectql`, never by list order. A send names no package (`SendTemplateInput` carries none), so the loader asks as a caller with no package: the environment's own template, else the unique package holder (the email service's built-in templates rank below an app's, and a dependent package's added locale is no second holder of its base's name), else a refusal that names every candidate. Within the answer, the per-locale pick is unchanged.

Who is affected: a deployment that held one email template name in two packages from before phase 1's one-holder refusal (the cold boot warns about it as a "Bare-name conflict at boot"). Its sends were rendered from whichever package's bundle listed first; they now fail with a `409 RESOURCE_CONFLICT` naming both packages. Rename one of the two (the boot warning names the rename). First-party count of such clashes: 0. Every other name renders exactly as before, since phase 1 still refuses a new clash at install.

`@objectstack/plugin-email` now depends on `@objectstack/objectql` at runtime (it was a dev dependency).
