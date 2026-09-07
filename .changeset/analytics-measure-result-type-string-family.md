---
"@objectstack/service-analytics": minor
---

A `min`/`max` over a string-valued field is described as `string`, not `number` (#16098)

The sibling population of the temporal fix. `min` and `max` return a value **of the aggregated field's own type**, so a `min` over a `text` / `select` / `lookup` / `autonumber` column carries a string — and `POST /api/v1/analytics/dataset/query` described every one of those columns as `type: "number"`, exactly as it did for the temporal family before the temporal half landed.

What changed:

- **`measureResultType` now answers `string` for the string-valued field types too**, in the same one table it already answered `time` from. No second mechanism and no new call site: the rule still answers `undefined` for "no correction", and `queryDataset`'s ADR-0021 result-column enrichment still applies it once, downstream of all four producers of the shape.
- **The corrected spelling is `string`**, the `DimensionType` word a `lookup` or `string` DIMENSION column in the same response already carries (`dataset-compiler.dimensionType`). A textual measure spelled `text` would have been a sixth word in a five-word wire vocabulary, leaving every existing consumer branch unreached — the same argument that chose `time` over `datetime`.
- **Membership is composed from `@objectstack/spec`'s own value classes** (`STRING_VALUE_TYPES`, `SINGLE_OPTION_TYPES`, `REFERENCE_VALUE_TYPES`) rather than re-listed, so what the platform says a field type STORES and what this rule says a `min` over it RETURNS cannot drift.

Corrected: `text`, `textarea`, `email`, `url`, `phone`, `password`, `secret`, `markdown`, `html`, `richtext`, `code`, `color`, `signature`, `qrcode`, `select`, `radio`, `lookup`, `master_detail`, `tree`, `user`, `autonumber` — twenty-one members, each verdict read off the two shipped statements of what the type stores (the spec value contract and `driver-sql`'s DDL column switch).

Deliberately NOT corrected, with the measurement recorded rather than a guess shipped as a declaration:

- **`boolean` / `toggle`** — Postgres has no `min(boolean)` at all, SQLite answers `0`/`1` as numbers, and the driver seam has been recorded answering `false`/`true`. Three readings that disagree about whether a value exists and what kind it is. `DimensionType` does carry a `boolean` word, so the correction is spellable; it is not made.
- **The JSON-column classes** (`multiselect` / `checkboxes` / `tags`, `composite` / `repeater` / `record` / `location` / `address` / `vector`, `json`) — no `min` over `jsonb` on Postgres, serialized TEXT on SQLite.
- **The file types** (`image` / `file` / `avatar` / `video` / `audio`) — their stored form is mid-migration under ADR-0104 D3: the value contract already says an opaque `sys_file` id while the DDL still gives them a JSON column.
- **`formula`** — its result type IS declared, on `FieldSchema.returnType`, but that key is not on `AnalyticsServiceConfig.sourceFieldMeta`'s return shape and is itself optional.
- **`summary`** — measured NUMERIC on both shipped statements (the spec's `NUMERIC_VALUE_TYPES`, and `driver-sql`'s `table.float` column), so the `number` it already carried is correct rather than merely unexamined.

Every member of `FieldType` now carries an explicit verdict, pinned by a test that walks the enum: a field type added to the spec fails that pin instead of silently inheriting the flat `number`.
