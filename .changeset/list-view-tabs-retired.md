---
'@objectstack/spec': minor
---

feat(spec)!: retire the list view's own `tabs` key — parsed, stored, and drawn by nothing; named presets are `listViews` entries

**BREAKING** — `tabs` is removed from the list view (`ListViewSchema`,
`ObjectListViewSchema` — a `defineView` container's `list` / `listViews`, an
object's `listViews` — a view item record's list `config`, and the flattened
list overlay the `PUT /api/v1/meta/view` door accepts). ADR-0049
enforce-or-remove; triage verdict RETIRE, on the rule that a capability the
mainstream has and this platform already delivers keeps ONE spelling.

The key parsed at every list-view door and was stored, and no renderer ever
drew it. Measured before removal, each reading beside a lit control: the one
component that reads a `ViewTab[]` (objectui's `TabBar`) has zero production
mounts at the objectui commit this repo pins — every occurrence is in its own
two test files — while the saved-view switcher (`ViewTabBar`) mounts in the
object view and is fed from the object's `listViews`. That switcher IS the tab
strip above an object's records: one tab per named list view. Zero list views
in this repo's examples, skills or platform sources authored the key.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| a list view's `tabs: [{ name, label, filter, … }]` | one named list view per tab, under the object's `listViews`: the tab's `name` becomes the entry's key, its `label` the entry's `label`, and its `filter` rules join the view's own `filter` on that entry (copy the view's `columns` too). A tab whose `view` already named a list view needs nothing more. |
| the tab keys `icon`, `order`, `pinned`, `isDefault`, `visible` | nothing — none of them ever had an effect. |

**The one-line fix: delete `tabs:` from every list view, and add a `listViews`
entry for each tab you want users to switch to.** `os migrate meta --from 17`
lists the mechanical edits for existing sources; apply them by hand.

```ts
// before — parsed clean, drew no tab bar
defineView({
  object: 'crm_ticket',
  list: {
    type: 'grid', columns: ['subject', 'status'],
    tabs: [{ name: 'open', label: 'Open', filter: [{ field: 'status', operator: 'equals', value: 'open' }] }],
  },
});
// after — the switcher above the records shows "Open" beside the default view
defineView({
  object: 'crm_ticket',
  list: { type: 'grid', columns: ['subject', 'status'] },
  listViews: {
    open: {
      type: 'grid', label: 'Open', columns: ['subject', 'status'],
      filter: [{ field: 'status', operator: 'equals', value: 'open' }],
    },
  },
});
```

⛔ **Untouched: the page-only preset bar.** `userFilters: { element: 'tabs',
tabs: [...] }` on a page list is a different key, it renders, and
`ViewTabSchema` stays for it.

### The retirement kit

- **A `retiredKey()` tombstone on the list-view shape**, beside the `pageName`
  tombstone on the same strict shape. Every door built from it refuses: `tsc`
  types the key `never`, and the parse raises the prescription (which names the
  move to `listViews`) instead of a bare unknown-key report.
- **D2 conversion `view-list-tabs-removed`** (protocol 18, retired from the load
  path): strips `tabs` from every list payload in `stack.views[]`, in all three
  persisted spellings, as a lossless delete — nothing ever drew the tabs — so a
  stored `view` row replays clean through the rehydration seam. An object's own
  `listViews` is reached by no conversion, so such an object is refused at its
  door until edited by hand.
- **D3 entry `list-view-tabs-retired`** beside it, carrying the part no
  conversion can decide: which tabs deserve a `listViews` entry.
- **`RETIRED_KEYS_BY_MAJOR[18]`**: `ui/ListView:tabs`, `ui/ObjectListView:tabs`;
  both `authorable-surface/ui.json` rows become `[RETIRED]`.
- **The metadata form's `tabs` repeater** leaves with the key, and the
  extracted form-label bundles are regenerated.
- **The liveness row stays `dead`**, re-verified, with a REMOVED note — the
  tombstone keeps the key in the walked shape.
- **The published `objectstack-ui` skill** no longer teaches the key: its
  list-view rules example and the "tabs win over dropdowns" rule (which
  described a tab bar that never rendered) are replaced by the `listViews`
  pointer.
- **Pins** (`ui/view-list-tabs-retirement.test.ts`): the refusal, its issue
  code, path and prescription at seven doors, each with a lit control; the tsc
  channel; the `userFilters.tabs` boundary; the conversion's reach, boundary and
  idempotence; the D2/D3 registration; and a tree-scoped absence walk over the
  declared radius.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec`
is published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: no (narrowing)

<!-- adr-0087: registered view-list-tabs-removed, list-view-tabs-retired -->
