---
"@objectstack/spec": patch
---

fix(spec): a page-component conversion reaches components nested inside a container, not only region- and slot-level ones (#6775)

`mapPageComponents` — the walker every page-component conversion is built on —
visited `pages[].regions[].components[]` and `pages[].slots.<slot>` and stopped
there. A component nested inside another component's `properties` (a card's
`children` / `body` / `footer`, a `page:tabs` or `page:accordion` panel's
`items[].children`) was never visited, so **no** page-component conversion
rewrote it. `walkPageComponents` in `@objectstack/lint` has descended into
those containers from the start, which means every conversion reached strictly
less than the lint rule that judges its result.

The walker now descends into the same containers lint does, to any depth, with
the same path spelling — so a conversion notice and a lint finding name one
site with one string. Copy-on-write is unchanged: an untouched sub-tree keeps
its reference, and a stack where nothing converts is still returned by
identity.

**Why this mattered on the load path.** The usual answer for a site a
conversion cannot reach is the tombstone: the key is typed `never`, so `tsc`
refuses it at the authoring site and the parse refuses it at load, wherever it
sits. That answer does not hold for a key that stays live elsewhere on the
surface. `page-header-subtitle-alias` retires `description` on page-header
components, and `description` remains a declared prop on other components (an
`element:text_input`'s helper text), so it cannot be tombstoned —
`properties.description` parses green at *any* position. A header authored in
a card or inside a `kind: 'slotted'` record page therefore got no rewrite and
no diagnostic from any of the three layers: the conversion did not fire, the
page schema was satisfied (`properties` is an open bag nothing validates by
`type` on the load path), and the props check is advisory, CLI-only, and runs
on already-converted metadata. Retiring the consumer-side
`subtitle ?? description` fallback would have dropped those pages' second line
silently.

Every page-component conversion rides the widened walk and its fixture now
pins the nested and slotted positions alongside the region-level one:
`page-header-subtitle-alias`, `record-picker-display-field-to-label-field`,
`record-picker-inert-keys-removed`, `page-card-body-to-children`,
`inline-action-api-params-to-body-extra`, `page-tabs-type-to-tab-style`, and
`page-component-visibility-to-visibleWhen`.

`page-card-body-to-children` is the one interaction worth naming: it MOVES a
container key (`properties.body` → `properties.children`). The descent reads
the mapped component, so a nested sub-tree is walked exactly once — under the
canonical key, not once per spelling.

Two differences from the lint walk remain, both deliberate and both pinned by
a cross-walker parity test: source-authored pages (`kind: 'html' | 'react' |
'jsx'`) are skipped by lint and still converted here (their regions are a
derived cache that must be normalized, or a stored page rehydrates in a shape
the runtime no longer serves), and the conversion walk keeps a depth ceiling of
32 containers, which lint has no counterpart for because it never runs on
hand-built `defineStack` objects.

No conversion was added or removed, and no already-converted metadata changes
shape: this widens which authoring positions the existing rewrites reach.
