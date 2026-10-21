---
'@objectstack/core': patch
---

fix(core): the import resolves a lookup cell by the target object's stored title field

Clause-②: no

- **Before.** A lookup cell was matched against the target by its id, then by the lookup's own `displayField`, then by a fixed list of keys (`name`, `title`, `label`, `full_name`, `email`, `username`). The target object's declared title field was never asked. So a cell that named the record by its title, such as `Wren` for a target whose title is `nickname`, answered `reference_not_found`, although the list export writes lookup cells by that same title.
- **Now.** After the id and the lookup's `displayField`, the import asks the target's title field, resolved by ADR-0079's one rule (`resolveDisplayField`: `nameField`, then the deprecated `displayNameField` alias, then the derived title). It is read from the same object declaration the import already reads to check the target's exposure, so no extra metadata read is made. Two records that share the title answer `reference_ambiguous`, like the import's other ambiguous matches. The cell is never linked to the first hit.
- **A formula title is not matched.** A `formula` field has no stored column, and the engine refuses a filter over it. The import no longer sends that query, for the title or for any other candidate the target declares as a formula, so a cell against a formula title still answers `reference_not_found`. How a formula title should be matched is still open.
- **Unchanged.** The fixed fallback keys and their order. The exposure check still runs first: a target whose declared exposure does not serve `list` answers `reference_not_found` for every cell and is never read.
