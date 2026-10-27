---
'@object-ui/components': patch
'@object-ui/console': patch
'@object-ui/layout': patch
'@object-ui/plugin-calendar': patch
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-gantt': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-map': patch
'@object-ui/plugin-timeline': patch
'@object-ui/plugin-tree': patch
'@object-ui/react': patch
---

refactor(ui)!: the renderer runs `@objectstack/sdui-parser`, and `@object-ui/sdui-parser` is deleted (#25712)

Clause-②: yes (narrowing: a `type-mismatch` or `member-type-mismatch` the html-tier compile used to grade `warning` is now an `error`, so a page that carried one now refuses to compile instead of rendering with the value dropped)
Metadata-protocol: none

The renderer and the save gate each ran their own copy of the SDUI parser. The previous change under this card made `@objectstack/sdui-parser` the one body. This change moves every `@object-ui/*` package, the console and the examples onto it, and deletes `ui/packages/sdui-parser`. There is no forwarding release of `@object-ui/sdui-parser`: it leaves the fixed version group, and the 18.1 line on npm is its last.

- **Dependencies.** Each package above now depends on `@objectstack/sdui-parser` where it depended on `@object-ui/sdui-parser`. The console's `gen-manifest.ts` moved from the deleted package to `ui/apps/console/scripts/`.
- **Severity, the one narrowing.** The renderer's copy graded a `type-mismatch` as an `error` only beside an `enum` arm, and as a `warning` otherwise. The kept rule grades every `type-mismatch` and `member-type-mismatch` an `error`, which is what the save gate already did. So an html-tier page whose attribute does not fit the declared type now shows the compile-error block naming the prop, where it rendered the block with that value dropped. Example: `<list-view columns='["name","amount"]' />` (a string where `columns` is declared `array`). A page the save gate accepted is not affected, because the save gate already refused it.
- **Body-dialect messages.** The retired `body` child-list key's `unknown-prop` message now ends `("body" is its retired spelling)`, and its `not-a-container` message drops the `(objectui#6771)` parenthetical.

Migration: none for a page the save gate accepted. A page that relied on the warning has a value the declared type does not take: write it in the declared type, for example `columns={['name','amount']}`.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the renderer's grading of a value that does not fit its declared type, which the save gate already refused, so no page saved through the gate changes verdict. The repair of a page written around the gate is the author's per diagnostic, which no ledger entry can derive. The other categories are closed on facts: no ADR-0087 id is named or touched (not registered or already-registered); the deleted `@object-ui/sdui-parser` stays published on npm at 18.1 and is deprecated there by the maintainer after 18.2, and no package in this change is unpublished (not unpublished); nothing exported by a package above is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
