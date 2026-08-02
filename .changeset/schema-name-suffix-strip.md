---
"@objectstack/spec": patch
---

fix(spec): strip the `Schema` suffix by anchored regex when deriving published JSON Schema names (#4592)

`build-schemas.ts` / `build-docs.ts` turned an exported const name into its
published schema name with `key.replace('Schema', '')` — a **string** pattern,
which replaces the FIRST occurrence. Every const whose name also contains
`Schema` in prefix/middle position lost that inner segment instead of its
suffix, so four schemas were published — `$id` URL, `json-schema.manifest.json`
key, docs page section, and import example — under type names that exist
nowhere in the export surface. Both generators now share one anchored helper
(`schemaNameFromExportKey`, `key.replace(/Schema$/, '')`).

Corrected names, FROM → TO (the fix if you referenced an old `$id` under
`https://schema.objectstack.io/v17/...` is to swap in the new name — the TS
exports themselves never changed):

| exported const | old (wrong) schema name | new schema name |
|:---|:---|:---|
| `SchemaModeSchema` | `data/ModeSchema` | `data/SchemaMode` |
| `SchemaChangeSchema` | `system/ChangeSchema` | `system/SchemaChange` |
| `SchemaLevelIsolationStrategySchema` | `system/LevelIsolationStrategySchema` | `system/SchemaLevelIsolationStrategy` |
| `DocumentSchemaValidationSchema` | `data/DocumentValidationSchema` | `data/DocumentSchemaValidation` |

The four old manifest keys are removed as a deliberate retirement per the
#2978 rule (they never named a real exported type), and the four
`no schema const export` / `no type export` pairs they caused in
`docs-import-surface.baseline.json` are deleted (152 → 144 accepted gaps) —
the four reference-doc pages regain real, compilable import examples.
