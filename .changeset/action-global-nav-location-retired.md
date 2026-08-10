---
"@objectstack/spec": major
---

refactor(spec)!: retire `global_nav` from `ACTION_LOCATIONS` — a location the product never rendered, and the designer previewed anyway (#6888, ADR-0049)

`ACTION_LOCATIONS` is the canonical vocabulary for where an action surfaces in a
running app, and `global_nav` — "global navigation/command-palette level
actions" — has been in it since the vocabulary was written. **No running-app
surface ever rendered it.** The console's ⌘K palette
(`app-shell/src/chrome/CommandPalette.tsx`) builds its groups from nav items,
objects, dashboards, pages, reports, recent items, record search and theme; its
`actions` group is hard-coded chrome; and the file references neither
`global_nav` nor any action-metadata source at all. Of the five references to
the value in the whole UI repo at the vendored SHA, four were the Studio
designer and the fifth a doc comment.

What lifts this above ordinary inert-declaration cleanup is the direction of the
lie. `metadata-admin/previews/ActionPreview.tsx` drew the author a mock
`⌘K · Command palette` frame, so the **authoring tool promised a surface the
product does not have**. An author declares the location, watches it "render" in
the designer, ships it, and it reaches no user — the ADR-0078
declares/renders/does-nothing shape, arriving through the location vocabulary
rather than through a missing key. For an AI author reading the corpus (ADR-0033)
that preview is evidence the capability exists, which is exactly how dead
metadata multiplies.

Retired rather than implemented (maintainer ruling, 2026-08-09): no user has
asked for command-palette actions, and the only two declarers were our own
showcase corpus. Wiring the palette would have been capability expansion with no
pull. If real appetite appears it re-enters through the front door,
implementation first.

FROM → TO:

| Was | Now |
|:--|:--|
| `locations: ['global_nav', 'record_header']` | `locations: ['record_header']` — drop the value, keep the served locations |
| `locations: ['global_nav']` on an action with a UI home | place it where a renderer serves it: `list_toolbar`, `list_item`, `record_header`, `record_more`, `record_related`, `record_section` |
| `locations: ['global_nav']` on an action with no UI home (e.g. object-less, invoked over REST/MCP/AI) | `locations: []` — the documented **headless** declaration, which keeps the capability gate, param contract and audit trail |

The retirement kit:

- This is an enum **VALUE** retirement, so there is no `retiredKey()` tombstone:
  the enum's own error map carries the prescription, keyed on the received value
  so only the spelling that used to be legal is told it "was removed" (the
  `crypto.hash` / `HookBodyCapability` precedent, #4391, and `array_agg` /
  `AggregationFunction`, #6188). A mis-spelling still gets zod's list of the
  legal locations. For the same reason nothing lands in `RETIRED_KEYS_BY_MAJOR`
  and the four surface ratchets are byte-identical — no def and no authorable
  key changed.
- **ADR-0087 D2 conversion + D3 chain step**
  (`action-global-nav-location-removed`): `os migrate meta --from 16` strips the
  value from `action.locations`, one notice per rewritten action.
- **The key is kept when the array empties** — `locations: []`, never
  `delete locations`. On this surface the two are different declarations, not
  two spellings of one: the empty array is the documented headless shape
  ("Headless actions: declare it, then hide it"), while an absent key means
  nobody placed the action — which is what `packages/lint`'s
  `action-no-placement` warns about, in those words ("an author who said
  'nowhere, deliberately' (`[]`) and one who never said anything at all").
  Dropping the key would convert a deliberate placement into a lint finding and
  discard the author's own statement of intent. This is the
  `hook-body-crypto-hash-removed` shape ("the `capabilities` key itself stays —
  an empty grant set is legal"), not the
  `dataset-measure-array-string-agg-removed` shape, which drops its item only
  because the stripped remainder would fail the dataset's own refinement.
- The QA platform checklist's `records-forms.action-location-matrix` loses its
  `global_nav` variant. That variant was **unrunnable**, not merely obsolete:
  its step "new_task from the palette" could never pass. `enumSource.expect`
  moves 7 → 6, which is the ratchet that would otherwise have caught this drift.
- The two showcase declarers become headless. `showcase_portfolio_snapshot` is
  object-less by design and its docblock already said `global_nav` was chosen
  "for the same reason" it has no `objectName` — so `[]` is the declaration it
  always meant.

**Behaviour that changes:** none at runtime. An action declaring `global_nav`
rendered nowhere before this change and renders nowhere after it; what changes is
that the declaration is now refused at parse, with the reason, instead of being
accepted and silently ignored.

<!-- adr-0087: registered action-global-nav-location-removed -->
