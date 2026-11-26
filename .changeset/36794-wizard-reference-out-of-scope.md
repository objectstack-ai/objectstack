---
'@objectstack/spec': patch
'@objectstack/core': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(plugin-grid,core): the Import Wizard names the column a lookup cell was scoped by when the value belongs to another parent; a scope no read could filter by says so

Clause-②: yes (widening)
Metadata-protocol: none

The Import Wizard's dry run and completion screen render the import cell error `reference_out_of_scope` (#36794) with their own text, `"Design review" was found, but not under Project "Gemini"`, built from the cell error's `scope` (each scoping column by its label, with the cell the row gave it) and translated in all eleven UI locales (`grid.import.referenceOutOfScope`, `grid.import.scopeEntry`). The Wizard keys on the code and the structured `scope`, never on the server's sentence; a cell error with no `scope` shows the server's own sentence, already in the caller's locale.

The importer no longer reports a scoped lookup as `reference_out_of_scope` when none of its scoped reads could run: a `dependsOn` whose `param` names a target field the engine cannot filter by (a `formula`) refuses every scoped read, so the scope was never asked. That cell keeps `reference_not_found`, with its own catalog sentence `import_reference_scope_unqueryable` in all four platform locales, which says the lookup could not be made within the scope and that the field's `dependsOn` needs another column. No unscoped probe runs for it and it carries no `scope`.

Wording: `ImportRowResultSchema.errors` and the runner's `ImportRowResult.errors` now say that a `reference_out_of_scope` element carries `scope`; the error catalog page says `scope` names the row's own scoping columns, not the parent's.

What to do: nothing. A client that matches `reference_not_found` for "the lookup cell did not resolve" keeps receiving it for the unfilterable scope.
