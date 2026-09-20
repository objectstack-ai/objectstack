---
"@objectstack/spec": minor
---

`record:related_list.columns` now declares the SAME union the saved-view key declares — `z.union([z.array(z.string()), z.array(ListColumnSchema)])` — so a saved view's per-column decoration reaches the related list instead of being refused at the block door (#18639, the upstream half of objectui#9593).

**Clause-②: yes (widening)** — one published accept set grows: the key admitted `string[]` and now also admits `ListColumn[]`. Nothing previously admitted is refused, no key is renamed or retired, and no producer is required to write the new arm. Contract-review tier.

Two published declarations disagreed about one key. `RecordRelatedListProps.columns` (`ui/component.zod.ts`) was `z.array(z.string())`, while `listViews[].columns` (`ui/view.zod.ts`) was already the union — and objectui composes a saved view's `columns` onto this block **verbatim** (`dataSource.view` → `composeElementDataSource` → `savedViewColumns`). A view whose columns carried `label` / `width` / `hidden` / `summary` therefore arrived at a block that declared it could not carry them.

- **The same union, by reference — not a lookalike.** `ListColumnSchema` is imported from the view face rather than re-spelled, so the object arm is one def with two carriers. The pin asserts reference identity on both sides and then asserts block and saved view return the same verdict for every fixture: two spellings of one key is the defect this closes, so a second spelling would not have fixed it.
- **The arms are exclusive, and the description says so because the schema enforces it.** `['name', { field: 'amount' }]` matches neither arm and is refused. The decoration also survives the parse — a description promising keys a parse strips would be the same defect one layer up, so the pin asserts the parsed value, not merely `success`.
- **Unchanged, by ruling and by measurement.** `field.relatedListColumns` stays child field-name STRINGS only and still refuses a column object with its derivation prescription, and the `field-column-lists-canonicalized` conversion still folds an object entry on that key to its identity string. Both are pinned next to the widening so the fences cannot erode quietly.

No migration: authors writing `string[]` are unaffected, and the new arm is opt-in.
