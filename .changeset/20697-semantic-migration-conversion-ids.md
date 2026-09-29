---
'@objectstack/spec': minor
---

feat(spec): a semantic migration names the D2 conversions whose applied edits it judges

Clause-②: yes (widening)

`SemanticMigration`, the ADR-0087 D3 entry type exported by `@objectstack/spec`,
gains one optional member, `conversionIds?: readonly string[]`. It lists the ids
of the D2 conversions whose applied edits the entry judges. Each id is the same
`conversionId` that the conversion's `MigrationApplication` rows carry, so a
printer of an `applyMetaMigrations` result can show the entry beside those edits
for review. The chain copies the field onto the entry's `MigrationTodo`, so
`objectstack migrate meta --json` shows it on that todo. Nothing is removed or
renamed, and every entry is still reported as a todo of its hop.

One link ships: `flow-decision-edge-branching-first-match` judges the
`mode: 'inclusive'` edits that `flow-decision-mode-inclusive-explicit` writes.
