---
'@objectstack/spec': minor
'@object-ui/types': minor
'@object-ui/plugin-list': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-view': patch
'@object-ui/plugin-map': patch
'@object-ui/console': patch
'@objectstack/rest': patch
'@objectstack/metadata-protocol': patch
'@objectstack/lint': patch
---

feat(spec)!: retire the list view's `options` bag; stored bags fold onto the top-level blocks, and the renderers read the blocks alone (#25923)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered list-view-options-bag-folded, ui-list-view-options-bag-folded -->

A flattened list view overlay carried every per-kind block twice: as the top-level `kanban`, `calendar`, `gallery`, `timeline`, `gantt`, `map`, `tree` and `chart`, and again under a legacy `options` bag the top-level block won over per key. Each renderer re-implemented that merge. The bag is retired, and each block has one spelling.

- **`@objectstack/spec`**: the list overlay's `options` is a removed-key tombstone. The view write door refuses a body that carries it, by name, with the prescription to move each `options.KIND` block to `KIND`. The ADR-0087 D2 conversion `list-view-options-bag-folded` folds a stored bag onto the top-level blocks before a row is served (the top-level value wins per key; for `chart`, whose block replaced the bag whole, a bag beside a block is dropped), and `os migrate meta --from 17` lists the same edits for a source. A bag it cannot fold (an `options.grid`, a non-object block, a bag on a form view) is left in place with a TODO. The D3 entry `ui-list-view-options-bag-folded` names what the fold cannot decide: the bag was judged with every key optional, so a folded block can still miss a key its block requires. The page `list-view` component row shares the tombstone.
- **`@object-ui/types`**: `ListViewSchema.options` takes the spec's tombstone by reference, so every published door refuses a bag at `options` with the spec's text, and the TypeScript face has no bag. `NamedListView.options` is a `?: never` tombstone that names the top-level blocks. The dataset-chart filter refusal reads the `chart` block alone, and the page node's flat `options` is refused with the bag's own text rather than pointed at `properties.options`.
- **`@object-ui/plugin-list`**: `ListView` reads each kind from its top-level block alone: the render branches, the capability gate, the projection and expand collectors and the fetch effect's dependencies no longer read `options`. The `list-view` registration publishes no `options` input.
- **`@object-ui/app-shell`**: the object page relays each per-kind block at the top level of the list schema, held by value per block so an equal rebuild keeps its identity, and no longer forwards a stored bag. The interface page sends one `map` block (its derivation with the authored keys laid over) and no bag. The Studio view preview and the list-view inspector no longer fold a bag; the server does. `storedLegacyOptions` is removed.
- **`@object-ui/plugin-view`**: the host list schema carries the active view's blocks at the top level instead of under `options`.
- **`@object-ui/plugin-map`**: two development warnings name the view's `map` block instead of `options.map`.
- **`@object-ui/console`, `@objectstack/rest`, `@objectstack/metadata-protocol`, `@objectstack/lint`**: test pins only (the registry parity row, the write door's refusal and served fold, and the lint finding), no runtime change.

**BREAKING** for a list view body, a page `list-view` node or a `ListView` host that writes `options`.

- **Before.** `{ type: 'kanban', columns: ['name'], options: { kanban: { groupByField: 'stage' } } }` was accepted at the view write door and drew a board laned on `stage`, and `ListView` read the bag beside the top-level blocks.
- **Now.** The write door and every `@object-ui/types` door refuse `options` by name, and `ListView` reads no bag. A view already stored with one is served folded onto its top-level blocks and renders from them. On the object page those blocks now pass through the same relay defaults as a block written top-level (the kanban `titleField: 'name'` floor, for one), so a folded row can draw differently from its bag where the bag left such a key unset. No reachable source stores a bag (census: 0 rows), and `ObjectView.storedRowParity-10380` pins the folded rendering.
- **Fix.** Move each block to the top level: `{ type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] } }`, keeping the top-level value where both set a key, and add any key the block requires that the bag never had (a kanban's `columns`, a gantt's `titleField`, a chart's `dataset` and `values`). A grid's settings are top-level keys of the view. Run `os migrate meta --from 17` for a source, with `--write` to apply the edits it can prove.
