---
'@objectstack/sdui-parser': patch
---

feat(sdui-parser)!: one parser body: the renderer copy's additions join `@objectstack/sdui-parser` (#25712)

Clause-②: yes (narrowing: `validateTree` now also judges the nodes held in a manifest entry's declared `slots`, so a caller whose manifest carries `slots` gets diagnostics on slot-held nodes it did not get before)
Metadata-protocol: none

Two copies of this parser existed: this package, which the save gate runs, and `@object-ui/sdui-parser`, which the renderer runs. `check:sdui-lockstep` held them to one grammar and one code set, and they drifted everywhere else. This change makes this package the one body. The renderer moves onto it and the second copy is deleted in follow-up changes under the same card.

**Added (from the renderer's copy).**

- Node-slot validation (objectui#11170). `ManifestComponent.slots` lists the positions besides `children` where a renderer reads nodes, such as `trigger`, `items[].content` and `regions[].components`. `validateTree` descends each one the way it descends `children`. `manifestFromConfigs` gains a `slotsFor` option that writes the list, and a manifest built without it carries none, so the walk follows `children` alone.
- The retired `body` child-list key (objectui#6771). Before, `body` drew the bare `unknown-prop`. Now the message names `children`. A `body` child list under a component that takes no children draws `not-a-container`, the code the `children` spelling draws. Both remain warnings. Exported as `checkRetiredBodyDialect` and `RETIRED_CHILD_LIST_KEY`.
- html-tier provenance (objectui#4000). `parseJsx` stamps every element it builds with an enumerable symbol-keyed marker, `Symbol.for('@object-ui/sdui-parser.html-tier-node')`. `JSON.stringify` and `Object.keys` do not see it. Exported as `HTML_TIER_NODE`, `isHtmlTierNode` and `markHtmlTierNode`. The registry key keeps its original package name on purpose, so a node either copy stamped reads the same.
- More exports:
  - `acceptsChildren`, `CHILD_LIST_KEY`, `SDUI_BASE_PROPS`, `SduiBaseProp` and `SduiBasePropScope`;
  - `assertFullyLoaded`, the manifest generators' guard against lazy stubs, with `RegistryConfigLike.lazy`;
  - `NodeSlotDeclarationLike`.
- The generated `.d.ts` header gains `/* eslint-disable */` and names this package.

**Renamed, with the old names kept.** `ParsedSchemaNode` is the parsed node and `ManifestValidationResult` is `validateTree`'s result. These are the names the renderer's copy took so it would not collide with `@object-ui/types`' `SchemaNode` or the spec's `ValidationResult` (objectui#6349, objectui#3161). `SchemaNode` and `ValidationResult` stay exported as `@deprecated` aliases of them, so nothing exported is removed.

**Unchanged.**

- Every `type-mismatch` and `member-type-mismatch` is still an `error`. The renderer's copy graded them `error` only beside an `enum` arm; this package's rule is the one kept.
- `unconsumed-widget-option` is still emitted as an inline literal.
- The grammar, the 25 diagnostic codes and the containment predicate.

**BREAKING** (a narrowing of `validateTree` for a manifest that carries `slots`), shipped as `patch` because no metadata protocol kind moves. The save gate's verdicts do not move, and that was measured: the manifest that `objectstack validate`, `build`, `lint` and `serve` read is the tracked `sdui.manifest.json`, which `@objectstack/console` ships. It carries `slots` on 0 of its 106 entries, because its generator calls `manifestFromConfigs` without `slotsFor`. So no save that was accepted before is refused now. The walk has work only for a caller that builds its manifest with `slotsFor`, and today that is the renderer, whose own copy already walks the slots.

Migration, for a TypeScript caller: none is required. To move off the deprecated names, change `SchemaNode` to `ParsedSchemaNode` and `ValidationResult` to `ManifestValidationResult`.

`body-dialect.ts` and `provenance.ts` moved in from the MIT-licensed `@object-ui/sdui-parser` and keep that licence. Each carries the notice, and the package now ships `LICENSE-MIT`.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is `validateTree`, a function of this library, for a manifest that carries the new `slots` key: nodes held in those positions are now judged. No manifest the save gate reads carries that key (the tracked `sdui.manifest.json`: 0 of 106 entries), so no stored or authored page changes verdict there. A caller who builds a slotted manifest gets diagnostics on slot-held nodes, and the repair is the page author's per diagnostic, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed, since the two renamed types stay exported as deprecated aliases (not runtime-interface-only, type-surface-only or runtime-export-retired). -->
