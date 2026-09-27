---
"@objectstack/spec": minor
"@objectstack/rest": minor
"@objectstack/lint": minor
---

fix(spec,rest,lint): an import mapping target that names no field is refused on the dry run, on the commit and at `objectstack validate` alike (#20150)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: `ImportFieldMappingSchema.target` keeps its declared shape and meaning ("Target object field(s)"), no stored mapping or record moves, and every mapping parses byte-identically to before. What narrows is the ACCEPT SET of the import door and of the published author-time checker, and only for mappings whose target already names no field of the object: those failed every row on the commit before this change, so no import that wrote anything is refused now. The remedy is per mapping and the refusal names it in full (the mapping, the target, its position and the object); there is no stored representation for `objectstack migrate meta` to rewrite. -->

**BREAKING** in the accept-set sense only, landing in the launch window as
`minor`: the import route and `objectstack validate` now refuse a mapping they
used to pass, and every such mapping already failed on the commit.

**What was wrong.** `ImportFieldMappingSchema.target` is declared as "Target
object field(s)", and nothing held a mapping to it. A mapping whose target named
no field of its `targetObject` (measured with `mailing_address.street` on an
object whose address field is `mailing_address`):

- passed `objectstack validate`, `os lint` and `os build` with no diagnostic;
- answered `ok` for every row on `POST /api/v1/data/:object/import` with
  `dryRun: true`;
- then failed every row on the commit with `INVALID_FIELD` ("Unknown field
  'mailing_address.street' on object '…'").

The dry run promised what the commit refused.

**What changes.**

- `@objectstack/spec` exports ONE verdict on what a target may name, beside the
  schema it judges: `unknownImportMappingTargets(fieldMapping, objectDef)`, with
  `indexImportMappingTargets`, `judgeImportMappingTarget`,
  `importMappingEntryTargets` and `IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS`
  (from `@objectstack/spec/data`). A target may name a declared field, a column
  the platform provisions on that object (`resolveInjectedSystemColumns`), or one
  of `id` / `created_at` / `updated_at`, which the engine's write door admits on
  every object. An object with no readable, non-empty field map is not judged.
- `@objectstack/rest`: `prepareImportRequest` refuses a named mapping (`mappingName`)
  with a target that names no field, before any row, with `400 INVALID_FIELD` —
  the code the commit's per-row refusal already carried. The dry run and the
  commit give the same answer, and so does the async import-job route.
- `@objectstack/lint`: the reference-integrity suite (`os validate`, `os lint`,
  `os build`) gains `validateMappingTargetFields`, rule id
  `mapping-target-field-unknown` (`MAPPING_TARGET_FIELD_UNKNOWN`), severity
  `error`, located at `mappings[i].fieldMapping[j].target`. It asks the same
  spec verdict, so it never refuses a target the import door accepts.

**What to do.** Point each reported target at a field the object declares. An
array target (`split`) is judged element by element.
