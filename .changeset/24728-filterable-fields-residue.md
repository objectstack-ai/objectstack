---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': patch
---

fix(lint)!: `os lint` and the react-page props check report the retired list-view `filterableFields` by name, and the readers that still treated it as a field position go

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered view-list-filterable-fields-removed, list-view-filterable-fields-retired) The key's retirement, its D2 conversion and its D3 entry are already registered by the change that tombstoned it, which shipped in 18.0.0. This change adds no key, conversion or stored shape: it makes `os lint` and the react-page props check give the verdict `os validate` and `os build` already give the list-view key, with the tombstone's own prescription. -->

**BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`@objectstack/spec` 18 retired the list view's `filterableFields` with a `retiredKey()` tombstone, so `os validate` and `os build` refuse it at the parse. Two authoring checks still read it as a live field position:

- **`os lint`** never parses: it judges the normalized stack, and the conversion that strips the key is retired from the load path. On a JSON, YAML or raw-object source the key reached the list-view field-reference rule as written. A valid field name passed `os lint`, and a stale one was reported as an unknown field (`list-view-field-unknown` / `list-view-field-dotted`), never as the retirement.
- **The react-page props check** read `<ListView filterableFields={[…]}>` as a field-bearing prop. A react page's source is parsed against no list-view schema, so `os validate`, `os build` and `os lint` passed the prop whenever its names resolved.

Both now refuse the key by name, as an `error`, whatever it names:

- a list view (every rung: an object's `listViews`, a `defineView` container's `list` / `listViews`, the flattened list overlay and the view item record) reports `list-view-key-retired` at `….filterableFields`, whether or not its object binding resolves;
- `<ListView filterableFields>` on a react page reports `react-prop-retired`.

The message names the retirement and the hint is the tombstone's own "Delete the key" sentence, read from `ListViewSchema` rather than retyped. The new rule id is exported from the package root as `LIST_VIEW_KEY_RETIRED`.

### FROM → TO

| before | after |
| --- | --- |
| `filterableFields: ['status']` on a list view in a non-`defineStack` source: `os lint` passed | `os lint` fails with `list-view-key-retired` |
| `filterableFields: ['ghost']` on such a list view: `list-view-field-unknown` | `list-view-key-retired` |
| `<ListView filterableFields={['status']} />` on a react page: passed every authoring command | `react-prop-retired` |

**The one-line fix:** delete `filterableFields` (the key or the prop). For a curated end-user filter bar, declare `userFilters: { element: 'dropdown', fields: [{ field: 'status' }] }`; the Filter panel offers every field the user may read. `os migrate meta --from 17` lists the edits for existing metadata sources; a react page's source is yours to edit by hand.

### The residue readers that go

- **`@objectstack/lint`**: the list-view field-reference rule no longer walks `filterableFields` as a filter position (its severity and dotted-path maps), the field-consumer rule no longer counts it as a behavioural read, and `os explain list-view-field-unknown` / `list-view-field-dotted` no longer name it as a checked position.
- **`@objectstack/metadata-protocol`**: `computeViewReferenceDiagnostics` no longer walks `filterableFields`, the same deletion its retired sibling `tabs` had. A stored body has the key stripped by the conversion replay before it is served, and the write door refuses it.
- **`@objectstack/metadata-core`**: the ADR-0106 field-security scrub no longer classifies `filterableFields` as a list-view name list. A body that still carries the key goes the unclassified way and fails closed: a list view whose `filterableFields` names a field the caller may not read is dropped whole, where the scrub used to remove the name.

⛔ **Untouched:** `userFilters` and `searchableFields` keep their meaning and their checks.
