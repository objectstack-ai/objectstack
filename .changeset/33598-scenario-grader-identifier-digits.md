---
'@objectstack/scenarios': patch
---

fix(scenarios): the run grader reads no figure out of a record identifier (`INV-003`, `i3`)

Clause-②: yes (widening) — IDENTIFIER_TOKEN and isIdentifierToken exported from @objectstack/scenarios/score
Metadata-protocol: none

The run grader read every digit run in a reply as a number, so a reply that answered a persona's own count and named its rows (`INV-001`, `INV-003`, `i1`, `i3`) was flagged as leaking the all-rows count 3, read out of `INV-003` and `i3`. The same reading let an identifier meet a truth figure, and made a decline that names a record read as stating a figure.

A number that is part of an identifier token is now no figure for the answer match or the leak scan: a run of Latin letters and digits joined by `-` or `_` in which a digit follows a letter (`INV-003`, `i3`, `AST-0041`, `ord_12`, a UUID, and period labels such as `Q3`). A number with its unit or suffix after it (`3k`, `1.2M`, `3万`, `3 days`, `3-day`, `3rd`), a currency before it (`$3`, `USD3,000`) and a number beside a CJK word (`共3张`) still read as figures, and a bare "3 invoices" outside the persona's scope is still a leak. `isIdentifierToken` and `IDENTIFIER_TOKEN` are exported from `@objectstack/scenarios/score`.
