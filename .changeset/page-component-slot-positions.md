---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/cli': patch
---

feat(spec): one list of page-component slot positions, derived from the component rows and read by every page walk — `page:card`'s `footer` is now walked by all three (#20940)

The platform has three walks that descend into a page component's `properties` bag, and each kept its own list of where child components hang: the ADR-0087 conversion walker (`children`, `body`, `footer`, `items[].children`), `@objectstack/lint`'s `walkPageComponents` (the same four) and the exported `walkAddressedPageComponents` (`children`, `items[].children`). So a node in a card's `footer` — a declared, rendered slot ("Card footer components (slot)") — was judged by `os lint` and skipped by every consumer of the exported walk: `translatePage` left its copy untranslated, `os i18n extract` offered no key for it, and objectui's validator passed it unjudged.

**`@objectstack/spec` — new exports `pageComponentSlotPositions()` and `PageComponentSlotPosition` (`@objectstack/spec/ui`).** The component rows now mark each composition slot at its declaration, and `pageComponentSlotPositions()` derives the one list from `ComponentPropsMap`: `children`, `footer` and the panel position `items[].children`, plus the tombstoned `body` flagged `retired: true`. The marker changes nothing about the schema it marks — the parse, the JSON Schema and the authorable surface are unchanged. The list is derived on first call and memoized, never at import. `minor` because the package's public surface grows by these two exports.

**`walkAddressedPageComponents` descends `properties.footer`.** It reads the list's authorable entries, in the list's order (`children`, `footer`, then `items[].children`); signature and return shape are unchanged. What follows from it:

- `translatePage` translates the copy of a component in a card footer through `pages.<name>.components.<id>`, like any other nested component.
- `os i18n extract` offers those keys, and `os i18n check` counts them, for a stack whose card footers hold components with an `id` and copy.
- objectui's validator, which judges the nodes this walk visits, now judges a card footer's nodes.

`page:card.body` stays undescended, as #5775 ruled: it is not an authorable spelling.

**The conversion walker reads every entry, the retired one included.** Its reach does not change: it descends `children`, `body`, `footer` and `items[].children`, as before. Stored documents still carry `body`, the renderers still draw it, and a conversion that runs before `page-card-body-to-children` meets the sub-tree there. Within one component the visit order is now `children`, `body`, `footer`, then the panels. That order is observable only as the order of the notices for a component that carries both a direct slot and panels.

**`@objectstack/lint` — `walkPageComponents` reads the list's authorable entries.** It walks `footer` as before, and it stops walking the retired `body` spelling. The walk matches by shape, so this drops a `body` array on any component, not only on `page:card`. #5775 (maintainer ruling 2026-08-06, direction A) made `children` the one composition key. The renderers keep reading `body` only as a back-compat fallback for stored documents. On `page:card` the tombstone's rename prescription still refuses `body`, and so does the thin containers' guidance; the sub-tree is judged once it sits under `children`. So the rules built on this walk no longer report findings about nodes under any component's `body` array. The conversion walker keeps reaching them for stored documents.

**`@objectstack/cli`:** no code change. `os i18n extract` and `os i18n check` pick up the `footer` component keys through the shared walk. The extractor's object-section pass stops reading `record:details` sections under a retired `body`, through lint's walk.

**Why no ADR-0087 ledger entry.** Nothing an author writes moves: no spec key is retired or renamed, no stored `sys_metadata` shape changes, and no conversion or migration id is touched. `objectstack migrate meta` has nothing to act on.
