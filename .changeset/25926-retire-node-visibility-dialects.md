---
'@object-ui/types': minor
'@object-ui/react': minor
'@object-ui/sdui-parser': minor
'@object-ui/app-shell': patch
---

feat(types,react,sdui-parser,app-shell)!: the node-level `visibleOn` / `hiddenOn` / `disabledOn` spellings are retired; `visibleWhen` / `hidden` / `disabled` are the one predicate each

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) The three keys are `@object-ui/types` schema members on objectui's own node face, not an `@objectstack/spec` key, object definition, stored row or stored shape: the spec declares `visibleWhen` as the one conditional-visibility predicate at every layer (ADR-0089) and never declared a `*On` suffix on a page component, so the ADR-0087 registries in `packages/spec` have no entry to write and `objectstack migrate meta` has nothing to rewrite. Each old spelling is refused by name on both faces (the TypeScript compiler, the Zod mirror behind `objectui validate`), and the refusal names the surviving key; that is the same disposition the objectui retirements took when the package merged into this repository (maintainer ruling 28 = B on objectstack#25831). The guidance below is for the author of a page, not for a metadata upgrader. The other categories are closed on facts: the four packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and what narrows is a declared schema key on a published metadata face, not a runtime-only interface, a type annotation or a runtime export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

`@objectstack/spec` declares exactly one conditional-visibility predicate at every layer, `visibleWhen`, and objectui carried three spellings of its own beside it: `visibleOn` beside `visibleWhen`, `hiddenOn` beside `hidden`, `disabledOn` beside `disabled`. Each pair was evaluated by the same code with the same polarity, so the second spelling added a dialect and nothing else. The three are retired, with no alias window.

- **`@object-ui/types`**: `BaseSchema.visibleOn`, `hiddenOn` and `disabledOn` are `never` on the TypeScript face and alias refusals on the Zod mirror. A document that writes one is refused at that key, and the message names the key that survives (`visibleWhen`, `hidden`, `disabled`), says the polarity is the same, and says the value is unchanged. `objectui validate` reads the same mirror, so it prints the same refusal. The `object-view` table slot's refusal of the same three keys now names the surviving node key too (write `visibleWhen` / `hidden` / `disabled` on the object-view node itself) instead of sending the author to a retired spelling. Boolean `visible` stays: the spec declares it on actions, navigation entries, tabs, alerts and settings, and the renderer keeps evaluating it.
- **`@object-ui/react`**: `SchemaRenderer`'s visibility chain has three legs, `visibleWhen` and `visible` (shown when truthy) and `hidden` (hidden when truthy), and the enablement gate has one, `disabled`. A stale retired key that reaches the renderer unvalidated is not consulted and is held out of the component's props, so it neither gates the node nor lands in the DOM.
- **`@object-ui/sdui-parser`**: the three keys are no longer base props. `validateTree` reports each as an `unknown-prop` diagnostic that names the surviving key, so a TSX tree is told the same thing a JSON document is. `checkRetiredVisibilityDialect` and `RETIRED_VISIBILITY_DIALECTS` are exported for that reading.
- **`@object-ui/app-shell`**: the command palette reads a navigation entry's `visible` only; the `visibleOn` fallback it carried read a key `NavigationItem` never declared.

**BREAKING** (an accept-set narrowing) for any page, view or component document that writes `visibleOn`, `hiddenOn` or `disabledOn` on a node. No shipped example, fixture or skill example in this repository wrote one; the ones in the documentation and the `objectui` skill are rewritten in this change.

- **Before.** The three keys parsed, were evaluated beside their canonical twin, and the docs taught both spellings.
- **Now.** Each is refused by name on `objectui validate`, on the Zod mirror, by the TypeScript compiler and by the SDUI parser, and the renderer does not read it.
- **Fix.** Rename the key and keep the value: `visibleOn` becomes `visibleWhen`, `hiddenOn` becomes `hidden`, `disabledOn` becomes `disabled`. A form field's `fields[].visibleOn` is a different, view-level slot and is unchanged.
