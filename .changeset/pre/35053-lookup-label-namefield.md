---
'@object-ui/core': patch
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
---

fix(ui): grouping headers and the filter value picker name a lookup by its target's `nameField`, and the empty group is translated

Clause-②: yes (widening)
Metadata-protocol: none

A lookup with no `displayField` is now named by the target object's declared `nameField`, the default the spec states for `displayField` ("the referenced object's name/title"). This is the same title the lookup's grid cell and the record header already show. Before, three places guessed a `name`, `label` or `title` key, and showed the raw record id when the target had none, for example a target titled by an autonumber such as `DEAL-2026-0001`:

- **Group headers of a list grouped by the lookup**, both server-grouped and client-grouped.
- **Filter builder value picker options** for the lookup, and the chip of the chosen value.

An explicit `displayField` on the lookup still wins. Grouping and filtering stay keyed by record id, so two records with the same title stay separate groups and separate options. The picker reads the target object's definition once per picker. The ObjectStack adapter serves later reads of it from its metadata cache.

The group of rows with no value now reads the grid's own empty-value string (`grid.empty`, for example "Empty" in English and "空" in Chinese) instead of the untranslated `(empty)`. It keeps its place in the group order: first when ascending and last when descending.

`@object-ui/core` adds `referencedRecordTitle(targetDef, record, displayField?)` to its public entry, a new export. It gives the title of a referenced record using the lookup's `displayField`, then the record-title ladder of `getRecordDisplayName`, and returns `undefined` instead of the `Record #<id>` floor.
