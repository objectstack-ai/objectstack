---
"@objectstack/spec": patch
---

The row properties of the `view.columns`, `view.tabs` and `view.sort` repeaters carry a JSON Schema `title`, so Studio's property panel stops printing raw machine keys as the column headers of those three tables (#17507).

Clause-②: no

Studio renders a `type: 'repeater'` form field as a table whose column headers read `items.properties[k].title ?? k` off the JSON Schema derived from the metadata type schema. None of the 25 row properties of the three view repeaters carried a `title`, so the fallback arm ran and the maker saw `field` / `width` / `isDefault` / `order` in every locale, English included.

- **`view.columns`** — the 14 row properties of `ListColumnSchema` (`Field`, `Label`, `Width (px)`, `Alignment`, `Hidden`, `Sortable`, `Resizable`, `Wrap Text`, `Renderer Type`, `Pinned`, `Summary`, `Prefix`, `Primary Link`, `Click Action`).
- **`view.tabs`** — the 9 row properties of `ViewTabSchema` (`Name`, `Label`, `Icon`, `List View`, `Filter`, `Display Order`, `Pinned`, `Default Tab`, `Visible`).
- **`view.sort`** — the list view's INLINE `{ field, order }` sort entry (`Field`, `Direction`). It is not the shared `SortItemSchema`, so titling that schema never reached this table; the titles mirror it.
- **Nothing the schema accepts or refuses moved.** `.meta({ title })` is presentation metadata: the generated `authorable-surface/` artifacts are byte-identical. The repeater-title ledger loses its last three entries and is now empty, so every repeater a form declares is fully titled and a new untitled one fails its own PR.
