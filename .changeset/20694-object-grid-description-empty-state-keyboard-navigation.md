---
'@objectstack/spec': minor
---

The `object-grid` page block now declares `description`, `emptyState` and `keyboardNavigation`, so a page that authors them validates clean instead of having each reported as a prop the block does not declare (#20694).

Clause-②: yes (widening)

- **`description`** — an `I18nLabel` (a string, or an inline locale map): one line of help text the grid draws above its rows, resolved against the display locale.
- **`emptyState`** — `{ title?, message?, icon? }`, what the grid draws instead of an empty table. It is the list view's own empty-state shape, now exported as `EmptyStateSchema` (author type `EmptyState`) and taken by reference on both `list-view` and `object-grid`, so the two cannot drift apart.
- **`keyboardNavigation`** — a boolean, marked `[EXPERIMENTAL — not enforced]`: arrow-key cell navigation on the WAI-ARIA grid pattern, on by default when `editable` is set. No renderer reads it yet, so authoring it changes nothing today.

Nothing that parsed before is refused now. The `object-grid` row still refuses every key it does not declare, and the list view's `emptyState` accepts exactly the values it accepted before the shape was extracted. One refusal message is reworded: an `action` or `button` key inside an empty state is still refused and still points at the list view's `addRecord` block, now phrased so that it also reads true on `object-grid`, which has no add-record block.

On `object-grid`, write `emptyState.title` and `emptyState.message` as plain strings for now: the grid renderer draws both as they are and does not yet resolve an inline locale map there the way it resolves `description`, so a map in either member fails to render.

Where it surfaces: the component-props gate (`os validate`, `os build`, `os lint`) no longer reports these three keys on an `object-grid` node, and the published JSON Schema for `ObjectGridProps` describes them.
