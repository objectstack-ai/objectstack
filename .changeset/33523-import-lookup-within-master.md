---
'@objectstack/core': patch
'@objectstack/skills': patch
---

fix(core): a data import resolves a lookup cell naming a detail record within the master the same row names (#33523)

Clause-②: yes (narrowing) — widening: a row whose master identifies one of several same-named details now resolves it, where it was refused `reference_ambiguous`; `@objectstack/core` exports `referenceScopeSources` and the types `ReferenceMaster` and `ReferenceScopeSource`, `RefResolver` and `coerceFieldValue` take an optional scope, `coerceRow` an optional source row, `CoerceContext` an optional `referenceMasters`, and `ExportFieldMeta` an optional `dependsOn`. Narrowing: a row that names a master and a detail only another master carries is refused `reference_not_found`, where the detail was linked across masters.
Metadata-protocol: none
Skills-docs: `content/docs/data-modeling/import-mappings.mdx` gains "A lookup cell is resolved within the row's own master"; `skills/objectstack-data/rules/relationships.md` names the scoping under `master_detail`.

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped. `master_detail` and `dependsOn` are read as declared; the change is in how the import runtime resolves a cell, and no stored row is rewritten. -->

**What changes.** A detail's name is often unique only inside its master: two contracts can each carry an "Advance 30%" billing milestone. The import resolved a lookup cell across every record of the target, so a row naming contract B and "Advance 30%" failed with `reference_ambiguous`, while the record form's picker narrows the same choice by the contract. A lookup cell is now resolved within the row's own master when either:

- the lookup's target declares a `master_detail` field, and exactly one other single-value reference column of the row points at that master object and is filled in; or
- the lookup field declares `dependsOn`, and the row fills in the sibling field it names (the string form compares the target field of the same name; `{ field, param }` compares `param`).

Inside that scope a tie is `reference_ambiguous`, and a name that only another master carries is `reference_not_found`; it never resolves to another master's record. The same holds for the match-key pass of an update or upsert import, so a key column naming a detail is grouped by the value the row's own pass resolves.

**What stays.** A row that leaves the master blank is resolved across the whole target as before, `reference_ambiguous` on a tie. Two columns of the row pointing at the master object (a bill-to and a ship-to account) do not say which one is the master, so neither scopes; `dependsOn` says it. A master cell that fails its own lookup scopes nothing. Every lookup still reads as the importing caller: the scope only adds conditions to the same read, so a record the caller cannot read never matches.

**Docs.** `content/docs/data-modeling/import-mappings.mdx` describes the scoping under cell coercion; the data skill's relationships rule names it under `master_detail`.
