---
"@objectstack/rest": patch
---

An organization-scoped caller's own items now appear in the untyped metadata diagnostics sweep.

`GET /api/v1/meta/diagnostics` has two arms. The `?type=` arm has stated the caller's organization since #13753; the untyped whole-registry sweep passed none, so the Studio governance summary reported clean tiles over a partition it never read — undercounting relative to the per-type drill-down screen you reach by clicking into it. A summary whose whole job is surfacing problems, and which structurally cannot see a class of them while its own drill-down can, issues a false all-clear. The untyped arm now forwards the caller's organization, so items that organization authored on the five `allowOrgOverride: true` types (`view`, `dashboard`, `report`, `translation`, `email_template`) are counted in `stats`, `total` and `scannedItems`.

The organization is passed RAW, deliberately, and that is the whole of the change — no new parameter, response field, status code or contract surface. There is no single type to fold on for a whole-registry sweep, and folding on any one of them would suppress the organization for every type at once; instead `getMetaDiagnostics` reads each swept type through `getMetaItems`, which applies the `allowOrgOverride` read gate to its own request type, so every type is scoped on its own registry flag. A non-overridable type (`object`, `flow`, `app`, …) is still read environment-wide and no pre-#6190 organization-scoped row is resurrected into the report. An anonymous or organization-less caller reads exactly what it read before, and the `stats` / `total` / `scannedTypes` arithmetic is unchanged in shape.
