---
'@objectstack/spec': minor
---

feat(spec)!: retire the list view's `filterableFields` — declared as the `userFilters.fields` shorthand, read as a Filter-panel whitelist; no per-view whitelist replaces it

**BREAKING** — `filterableFields` is removed from the list view
(`ListViewSchema`, `ObjectListViewSchema` — a `defineView` container's
`list` / `listViews`, an object's `listViews` — a view item record's list
`config`, the flattened list overlay the `PUT /api/v1/meta/view` door accepts,
and a page `list-view` node's `properties`). ADR-0049 enforce-or-remove;
maintainer ruling C: the platform carries no per-view Filter-panel whitelist.

The key carried two meanings, and the declared one was never delivered. The
spec described it as the legacy shorthand for `userFilters.fields` — the
quick-filter bar above a list — and the Studio view form offered it as "Field
names available for filtering". Its one renderer, objectui's list view, read it
as something else: the whitelist of fields the Filter panel's "Add filter"
offers, a field the object marks `hidden` included when named. No quick-filter
chip ever came of it. Zero list views in this repo's examples, app packages,
platform objects, scaffolding templates or QA apps authored the key.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `filterableFields: ['status', 'priority']` meant as a curated end-user filter bar | `userFilters: { element: 'dropdown', fields: [{ field: 'status' }, { field: 'priority' }] }` |
| `filterableFields: [...]` meant to narrow the Filter panel | nothing — the Filter panel offers every field the user may read: field read security decides, and a field the object definition marks `hidden: true` is not offered |

**The one-line fix: delete `filterableFields:` from every list view; if you
wanted a curated filter bar, declare `userFilters` with those fields.** `os
migrate meta --from 17` lists the mechanical edits for existing sources;
`--write` applies the ones it can prove.

```ts
// before — parsed clean; the console used it to narrow "Add filter"
defineView({
  list: {
    type: 'grid', columns: ['subject', 'status'],
    filterableFields: ['status'],
  },
});
// after — a quick-filter bar for `status`; "Add filter" offers every readable field
defineView({
  list: {
    type: 'grid', columns: ['subject', 'status'],
    userFilters: { element: 'dropdown', fields: [{ field: 'status' }] },
  },
});
```

**Stored rows.** A stored `view` row that carries the key replays without it at
every rehydration seam (the D2 conversion below DROPS it), so it re-saves
through the strict write door, and its Filter panel then offers every field the
user may read — the ruled end state, not a rewrite. ⛔ No conversion turns the
key into `userFilters.fields`: that would keep nothing an author saw (the
whitelist would vanish and quick-filter chips would appear). An object row
whose own `listViews` carries the key is reached by no conversion and is
refused at its door until edited by hand.

⛔ **Untouched:** `userFilters` and `searchableFields` keep their meaning at
every door.

### The retirement kit

- **A `retiredKey()` tombstone on the list-view shape**, beside
  `searchableFields`. Every door built from it refuses: `tsc` types the key
  `never`, and the parse raises the prescription (delete the key; `userFilters`
  for a curated bar; what the Filter panel offers) instead of a bare
  unknown-key report.
- **D2 conversion `view-list-filterable-fields-removed`** (protocol 18, retired
  from the load path): strips `filterableFields` from every list payload in
  `stack.views[]`, in all three persisted spellings.
- **D3 entry `list-view-filterable-fields-retired`** beside it, carrying the
  part no conversion can decide: whether the author wanted a curated
  `userFilters` bar.
- **`RETIRED_KEYS_BY_MAJOR[18]`**: `ui/ListView:filterableFields`,
  `ui/ObjectListView:filterableFields`; both `authorable-surface/ui.json` rows
  become `[RETIRED]`.
- **The Studio view form's `filterableFields` input** leaves with the key, and
  the extracted form-label bundles are regenerated.
- **The liveness row flips `live` → `dead`**, re-measured, with a REMOVED note
  naming the one reader the ruling makes unreachable.
- **The architecture concept page's list-view example** now declares a
  `userFilters` bar instead of the retired key.
- **Pins** (`ui/view-list-filterable-fields-retirement.test.ts`): the refusal,
  its issue code, path and prescription at eight doors, each with a lit
  control and a `userFilters` / `searchableFields` boundary; the tsc channel;
  the conversion's reach, its never-a-rewrite guarantee, boundary and
  idempotence; the D2/D3 registration; and a tree-scoped absence walk over the
  declared radius.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: yes (narrowing)

<!-- adr-0087: registered view-list-filterable-fields-removed, list-view-filterable-fields-retired -->
