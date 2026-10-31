---
'@object-ui/plugin-list': patch
'@object-ui/components': patch
'@object-ui/plugin-view': patch
'@object-ui/i18n': patch
---

fix(plugin-list): a filter row with no value is not a filter, a date sort reads Oldest → Newest, a sort keeps one row per field, and an empty list says how to start

Clause-②: yes (widening: `@object-ui/i18n` gains `list.clearSearch`, `sortBuilder.oldestFirst` and `sortBuilder.newestFirst` in all ten locales, and `SortBuilder`'s `fields` entries take an optional `type`; no accept set moves)
Metadata-protocol: none

- **Unfinished filter rows.** A filter-panel row with no value yet is no longer counted on the Filter badge, no longer turns the list into "No matching records", and is no longer handed to the host's `onFilterChange`, so the console does not store it as the user's list state and it does not come back after a reload. The panel still shows the row so it can be finished.
- **Date sort direction.** The sort picker names a `date` or `datetime` field's direction "Oldest → Newest" / "Newest → Oldest" instead of "A → Z" / "Z → A". The list hands the picker each field's type.
- **One sort row per field.** A field another sort row already orders by is unavailable in the other rows, "Add sort" starts on the first field no row holds, and it is disabled once every field has a row.
- **Clear search.** The "No matching records" a search produced offers "Clear search". The clear button inside the search box is now named "Clear search" too.
- **Create on an empty list.** An empty list offers Create whenever the host gives a create path and the user may create, without the view having to declare an inline `addRecord` block. An author's `addRecord: { enabled: false }` or `userActions.addRecordForm: false` still withholds it, and the `object-view` renderer no longer hands its list a create path when the author turned Create off (`showCreate: false` or `operations.create: false`).
