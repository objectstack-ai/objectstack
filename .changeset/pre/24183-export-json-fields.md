---
'@objectstack/rest': minor
---

fix(rest)!: `format=json` honours an explicit `?fields=`, so each exported row carries exactly the named keys, in list order

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a runtime projection narrowing at the REST export door, not a metadata change: no spec key, export, option, config field or stored shape is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite; a caller that wants more keys names them in `?fields=` -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`GET /api/v1/data/:object/export` declares `fields=a,b,c` for every format. The CSV and XLSX arms wrote exactly the listed columns, but the JSON arm wrote each row as the read returned it, so `?format=json&fields=…` was ignored without any sign. objectui's list-view and grid export send `format=json` with the view's visible columns, so a JSON export of a list view carried every readable field instead of the view's columns.

- **Served less now:** with `?fields=`, each JSON row carries exactly the named keys, in the order the list names them, with the same readable formatting as before. Measured on a dev boot of `examples/app-showcase`: `?format=json&fields=title` on `showcase_task` answered 25 keys per row (`id`, the audit and ownership columns, `organization_id`, `owning_business_unit_id` and every author field) and now answers `title` alone. A named key the read did not return (a field that field-level security removes from the row, or the `__search` companion the read strips) is absent from the JSON row. It is not written as `null`. The CSV and XLSX arms write an empty cell for it, as before.
- **Unchanged:** `format=json` without `?fields=` still writes each row as the read returns it. The CSV and XLSX arms, their default columns and their header rules are untouched.

What changes for you: a caller that sends `format=json` with `fields` and reads a key it did not name, such as `id`, adds that key to `fields`.
