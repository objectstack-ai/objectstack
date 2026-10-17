---
'@objectstack/rest': minor
---

fix(rest)!: a schema-derived export skips the fields declared `hidden`, so the hidden `__search` search companion no longer adds an empty "Search Index" column

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a runtime column-selection narrowing at the REST export door, not a metadata change: no spec key, export, option, config field or stored shape is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite; an explicit `?fields=` request is answered exactly as before -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`GET /api/v1/data/:object/export` without `?fields=` builds its columns from the object schema. It took every field of the object, so the hidden `__search` companion, which the search-normalization seam declares on every object with an eligible name field whenever pinyin search is on, and whose value the data reads strip from every row, became a "Search Index" column that was empty on every row. The default columns are now the fields the object shows by default: a field declared `hidden` (`FieldSchema.hidden`, "Hidden from default UI") is not one.

- **Served less now:** the CSV and XLSX default header, and its zero-row header, no longer carry a column for a field declared `hidden`. Measured on a dev boot of `examples/app-showcase`, over every object with a hidden field that the export serves: `Search Index` (`__search`, 64 objects, empty on every row), `Organization` (`organization_id`, 53 objects, the one that carries a value: the record's organization), `Owning Business Unit` (`owning_business_unit_id`, 24 objects, empty on every row because nothing stamps it yet), and `Session Token` (`sys_session`), `Previous Password Hashes` (`sys_account`) and `Hashed Key` (`sys_api_key`), all three empty because the read omits their values. No other column moved.
- **Unchanged:** an explicit `?fields=` list is answered as asked, a hidden field included: the header names it and its cells carry what the read returns (empty for `__search`, which the read strips). The field-level-security narrowing of the default columns is unchanged, and so are the zero-row header rules. `format=json` streams each row as the read returns it, has no column set, and is unchanged. `?template=true` keeps its own column rule.

What changes for you: a consumer that wants a hidden field's column in an export names the field in `?fields=`.
