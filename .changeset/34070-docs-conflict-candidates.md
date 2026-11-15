---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the docs reader lists the candidate packages when a doc name two packages ship is refused

Clause-②: yes (widening) — widened: where a doc read that names no package answers `409 RESOURCE_CONFLICT` naming its holders (`details.candidates`), the Console docs reader (`/docs/BOOK/NAME`, reached from the flat `/docs/NAME` permalink) lists those packages, each linking to that package's address `/apps/PACKAGE/docs/NAME`, where it showed "Failed to load documentation"; a flat permalink under a package container (`/apps/PACKAGE/docs/NAME`) of a name that package ships opens the doc in that package's own book; the `@object-ui/i18n` keys `help.docConflictTitle`, `help.docConflictDescription` and `help.docConflictCandidates`, in all 11 shipped locales (no key renamed or removed). A doc one package ships, and every other failure, render as before.
Metadata-protocol: none

Two enabled packages may ship one doc name. A read of it that names no package is refused with `409 RESOURCE_CONFLICT` and the holders as `details.candidates`; nothing picks one for the reader. The docs reader now shows a "Choose a package" list in place of the generic load error: each entry is the package as the portal names it (its book) with the package id beside it, and opens that package's copy, read with the package named.
