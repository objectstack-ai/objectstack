---
'@objectstack/spec': minor
---

**BREAKING** — retire `ListViewSchema.navigation.view`, the detail-view binding nothing
ever resolved.

`navigation.view` was an unconstrained string whose describe promised *"the form view to
use for details"*. No layer from spec to console ever resolved a view by that name. Its
one read in the shipped console passed the value into the **second argument of
`onNavigate`** — the slot that otherwise carries the navigation-MODE token — so an
authored name did not select a view, it **substituted for the mode**. A consumer in the
same bundle reads that argument against a closed two-value vocabulary (`edit` / `view`),
so any other authored value matched neither branch: invisible on grids whose handler
takes one argument, a dead row click on the ones that do not.

The enumeration behind the removal was exhaustive rather than sampled — every `.view`
property read in the bundle (exactly three) and every `formViews` read — and **no read
anywhere is keyed by an authored view name**. There was no path by which the key could
resolve one. ADR-0049 enforce-or-remove; maintainer ruling 2026-09-13 (director decision
batch #126 item 4, option B). Zero authored instances in this repository; the one
external author removed its occurrence.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `navigation: { view: 'summary_view' }` on a list view | `navigation: { }` — delete the key. Then publish the layout you wanted as a `record` page on that object and mark the one that should open `isDefault` |
| `navigation: { mode: 'drawer', view: 'edit_form' }` | `navigation: { mode: 'drawer' }` — the mode, size and every other key of the block are **unchanged** |

**The one-line fix:** delete `view` from the list view's `navigation` block; to choose
what opens for a record, assign a `record` page to the object and let `isDefault` pick
the one that opens.

Nothing regresses by deleting it: the key never selected anything. What decides how the
detail is surfaced is `mode` and `size`, and both are untouched.

## The retirement kit

- **`navigation.view`** — a `retiredKey()` tombstone on `NavigationConfigSchema`. `tsc`
  types the key `never`, so writing it fails at the authoring site; a value reaching a
  parse raises the prescription rather than a bare unrecognized-key report. Refused at
  all three doors — `ListViewSchema`, `ObjectListViewSchema` and the flattened
  `PUT /api/v1/meta/view` overlay — and pinned at each.
- **ADR-0087 disposition: a D3 SEMANTIC entry**, `list-view-navigation-view-retired`, not
  a D2 conversion. A mechanical strip would delete the key without recording which list
  view lost it, and an author who wrote it wanted a named detail layout — a want page
  assignment serves and a stripped key does not record. So the TODO names the surface and
  hands the judgement back, which is what a semantic entry is for. The tombstone
  prescription therefore carries **no** `os migrate meta` sentence: that sentence is owed
  only where a conversion covers the surface.
- **The five surviving keys of the block** — `mode`, `preventNavigation`, `openNewTab`,
  `size`, `width` — are unchanged, and pinned accepting beside the refusal. A tombstone
  that broke its live siblings would satisfy every refusal assertion while being a larger
  bug; `navigation` is one closed shape, so that blast radius is the whole block.
- **`ui/NavigationConfig:view`** is registered in `RETIRED_KEYS_BY_MAJOR[18]`, which is
  also what starts its aging clock.

## What is deliberately NOT in this change

`view/list/navigation`'s six children are unclassified in the liveness ledger because
`check-liveness` drills one level. That is #17424's subject and is cited here, not fixed:
the ledger row for `navigation` itself is untouched, and no row exists for `view` to
update.

The sibling `objectui` contract twin — `ViewNavigationConfig`, a re-export of this very
type — is in the other repository and is left to it. Its parity pin authors
`{ view: 'summary_view' }` as a legal value, so it needs the tombstone pin before that
repo picks up a spec carrying this retirement.

Clause-②: no

<!-- adr-0087: registered list-view-navigation-view-retired -->
