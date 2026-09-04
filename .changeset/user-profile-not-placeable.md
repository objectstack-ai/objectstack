---
"@objectstack/spec": minor
---

feat(spec): `user:profile` is explicitly not author-placeable — refused by name at the schema door (#14159, ADR-0049)

<!-- adr-0087: not-required (no-migration-prescription) The retired row declared zero keys, so there is no key to strip and no old shape to rewrite into a new one; the only edit an author can make is deleting the `user:profile` node, which the conversion layer deliberately does not do (the `element-filter-removed` docblock rules deleting authored page nodes out of a mechanical conversion — it is a layout decision, not a rewrite); and a whole-repo sweep measured zero authored instances across examples, packages, docs and stored metadata (Studio's palette has excluded the type since objectui 5e8965c). Nothing mechanical to prescribe and nothing to prescribe it to — the #7596 disposition, one surface over. -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`, as the `element:filter` /
`element:form` element-grain retirements and the `targetVariable` key
retirement did; the 17.0.0 cut itself carried the `group` / `guest` recipient
removal and the `$in` / `$nin` / `$between` reference-position removal under
`major` because that release was the major).

`user:profile` was declared in `PageComponentType` and carried an empty
`ComponentPropsMap` row, and no renderer for it ever existed anywhere — not in
objectui, framework or cloud (objectui#7135 measured the zero with a positive
control in the same query shape; only the opt-in `PlaceholderRenderer`
scaffold, which `apps/console` alone registers, ever drew it). objectstack#12183
closed the same gap for its four siblings with renderers because real pages
used them; this member had zero measured pull, and the director ruling of
2026-09-01 (maintainer verbatim 「同意」) chose option B of that ask: a user
profile is shell chrome — the signed-in user's avatar menu — which no mainstream
product makes a page-placeable component, so the honest declaration is that it
cannot be placed, not a renderer nobody asked for. Until now an authored
`user:profile` node validated clean and drew `SchemaRenderer`'s red
unknown-type panel in front of an end user in every host except the console
(the ADR-0078 shape).

**What is refused:** an authored `user:profile` component node — at
`PageComponentSchema.type` (so `definePage()`, `PageSchema`, and every stack
door that parses pages: `os validate`, `os build`, `os lint`, the metadata
door), with a located issue (`code: 'custom'`, `params.retiredComponentType`,
the node's own path) whose message is the retirement prescription. The name is
also refused by `PageComponentType`'s own error map when the enum is parsed
alone, and `ComponentPropsMap['user:profile']` refuses every props bag —
`{}` included — with the same prescription for the readers that dispatch on
the row (the #5068 props gate, `check-yaml-examples`, the type vocabulary's
known set). One prescription string (`RETIRED_PAGE_COMPONENT_TYPES`,
`@objectstack/spec/ui`), three doors.

**What stays accepted:** every other member of `PageComponentType` and
`ComponentPropsMap`, byte-identically — `global:search` and
`global:notifications` (the two shipped shell singletons), `app:launcher`,
`nav:menu`, `nav:breadcrumb`, and the whole open string arm: custom and
plugin-registered types keep parsing, stored documents keep loading. `user:`
is no longer a namespace the enum populates, so the `component-type-unknown`
authoring rule no longer claims it; the only string refused is the retired
name itself.

**Fix:** delete the `user:profile` component node. There is nothing to write in
its place — the app shell renders the profile menu on every page without an
authored element. A future application that needs a page-placeable profile
component files a feature card with its consumer; the refusal then flips
additively (option A of the same ask). objectui's `PALETTE_EXCLUSIONS` entry is
unchanged (correct either way — the ruling's point 3).

The retirement kit:

- the retired-type map + enum error map + node-level check
  (`packages/spec/src/ui/page.zod.ts`), the refusing row
  (`packages/spec/src/ui/component.zod.ts`)
- pin tests (`component.test.ts` — `code` + `path` + first sentence at each of
  the three doors, positive controls, preservation of the other shell
  singletons, the open arm; `component-type-vocabulary.test.ts` — `user:`
  leaves the reserved-namespace derivation)
- generated baselines/docs follow the schema (`authorable-surface/`,
  `json-schema.manifest/`, `api-surface/`, reference docs); the hand-written
  `content/docs/ui/pages.mdx` component list says the truth
- no ADR-0087 conversion, by the disposition above: the row had no keys to
  strip, and a mechanical conversion does not delete authored page nodes.
