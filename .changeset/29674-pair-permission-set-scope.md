---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a permission set in a base's `.custom` pair lists, counts and edits its grants on the base's objects

Clause-②: no
Metadata-protocol: none

A "New similar" copy of a read-only base's permission set lands in the base's paired `.custom` package and keeps the base set's grants, which are on the base's objects. The package door scoped the set's matrix to the objects its own package declares, and a pair declares none of the base's, so in Studio Access the copy read "0 objects granted · 0 field overrides" with an empty matrix, though the server holds every grant.

- A set saved in a paired `<base>.custom` package is now scoped to the base's objects as well as the pair's own (ADR-0146 D3: the pair holds the permission sets for its base). The matrix lists both, its counts match the server's read, and an edit to a base object's grant saves into the pair's draft, never the base. A set in any other package keeps its own package's objects only.
- The Studio Access note on such a set names the base ("This package's and Showcase's objects · saved as draft") instead of "This package's objects". Two new `@object-ui/i18n` studio keys, `engine.studio.access.bannerPair` and `engine.studio.access.bannerTitlePair`, in `en` and `zh`.
