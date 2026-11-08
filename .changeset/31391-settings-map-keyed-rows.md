---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): Setup draws a `map` setting as a table of keyed rows instead of "Unsupported specifier type: map"

Clause-②: yes
Metadata-protocol: none

- **`@object-ui/console`:** a settings row whose specifier is `type: 'map'` (Data Lifecycle's retention overrides, row quotas and per-class quota defaults) shows one row per stored entry, in stored order, under the declared `keyColumn` and `columns` headers. A row is added by picking its key from the keys the server serves as the specifier's `options`; a key another row uses is not offered again, and a stored key the server no longer offers stays on its row marked "Not offered". A `duration` cell is a whole number plus a unit (hours, days, weeks, years) and is saved as the literal (`'90d'`); a `positive_integer` cell is saved as a number. Save sends the map as an object through the page's existing patch, and removing every row sends `null`. A refused save marks the row its `constraint.entry` names, and the cell its `constraint.column` names, beside the server's sentence. An env-pinned map is read-only. Any other unknown specifier type still draws the unsupported-type line.
- **`@object-ui/i18n`:** eleven `console.settingsView.map*` keys in every locale pack: the add picker, the remove button, the "Not offered" marker and its hint, the empty-table line, the key search placeholder, the unit select's name, and the four duration units.
