# Changelog

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [49a536d]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
  - @object-ui/types@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Patch Changes

- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [5f75cfa]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [a2225f9]
- Updated dependencies [21f9577]
- Updated dependencies [3eb3ec1]
- Updated dependencies [619e3f7]
- Updated dependencies [f62b6ff]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [4839f5c]
- Updated dependencies [c999d4c]
- Updated dependencies [260ef71]
- Updated dependencies [26323c4]
- Updated dependencies [c219165]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [025130c]
- Updated dependencies [8aa8e3e]
- Updated dependencies [2493e85]
- Updated dependencies [a928aaa]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [616df65]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [3c3115e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [b403bb3]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/core@18.0.0

## 17.7.0

### Minor Changes

- 2acd8e1: **BREAKING (authoring surface): `body` is no longer a child-list key. Author `children`.**
  
  `BaseSchema` declared two spellings of one concept — `body` and `children` — and left the
  choice per component. **Thirteen** registrations read `body` and nothing else, so it was
  their ONLY door — the twelve the ruling enumerated plus `tooltip`, which it did not, and
  which is the count the committed instrument carries (`BODY_ONLY` plus
  `BODY_ONLY_UNRULED` in `scripts/body-dialect-census.mjs`). `div`, `card`, `page`,
  `button`, `aspect-ratio`, the seven sectioning tags and the safe-HTML tag factory read
  `children || body` and took either. The authoring tier only ever knew `children`, so
  an author writing the one spelling that resolved got `unknown-prop` — the same warning a
  typo draws, on the tier built to accept AI-authored pages, where the diagnostic **is** the
  contract (objectui#6771).
  
  Ruled 2026-09-01: one concept, one spelling, and the spelling is `children`.
  
  ## What changed
  
  - **Renderers.** `alert`, `badge`, `tooltip` and the `sidebar-*` family read `children`.
    Every `children || body` fallback drops its `body` arm **except the four `page:*`
    reads named below** — `div`, `card`, `button`, `aspect-ratio`, the sectioning tags,
    the safe-HTML tag factory behind ~36 tags, `page`'s flat content list, and
    `@object-ui/core`'s recursive `validateSchema`.
  - **Item-level `body` is a DIFFERENT key and is untouched.** At this change, `list`
    draws each entry as `item.content || renderChildren(item.body)` and `tabs` as
    `item.content || item.body`, both filed under the ITEM type rather than the node,
    and `tabs` still ships `body` inside its own `defaultProps`. ⛔ Neither is this
    spelling and neither is refused here: the node-level retirement does not reach a
    member of a declared `items` array. Retiring the item-level dialect is
    objectui#9590's card, and the two named above are recorded on it.
    ⚠️ **Dated note, 2026-09-25 — neither half of this bullet holds any longer — objectui#9590.**
    objectui#9941 respelled the `tabs` `defaultProps` items to `content`, and
    objectui#9590 retired both item-level reads: a `list` item and a `tabs` item draw
    `content` and nothing else, and both item faces now refuse `body` by name,
    pointing at `content`. The rest of this bullet is kept as the reading of this change.
  - **What still reads `body` at NODE level, and why.** Four renderer reads, all `page:*`: `page:card`
    (renderer and Studio canvas) and the three thin `page:section` / `page:footer` /
    `page:sidebar` containers. ⛔ Authoring the key is refused on them as it is
    everywhere else; only the READ survives, for documents already STORED under it.
    `@objectstack/spec` states the ground on `PageContainerProps` itself: «The renderers
    keep reading `body` as a back-compat fallback for stored documents; that fallback is
    objectui's to retire on its own schedule, and it is not a second authorable
    spelling.» ⚠️ What separates the two halves is a CONVERSION, not a ground: the spec's
    registry carries `page-card-body-to-children` (`toMajor: 17`, surface
    `page.component.page:card.body`, shipped `retiredFromLoadPath: true` in spec 17.0.0)
    and carries none for the other three — so a stored row under their key has no
    migration path at all. Nothing in this repository authors any of them, and the
    committed census over those keys is how to see that rather than take it on trust:
    `node scripts/body-dialect-census.mjs --keys page:section,page:footer,page:sidebar,page:card,card`.
    ⚠️ This sentence used to restate that table's answer instead of pointing at it, and
    the very commit that edited the sentence moved the figure — a count copied into prose
    is what AGENTS.md #9 forbids, so the instrument replaces the number. Read the table
    for three things: `card` + `body` is a control that FIRES on the head that ships (so
    a zero elsewhere is a reading, not a blind spot), every node still carrying `body`
    under these keys falls in the `test` bucket, and `page:section` is a LIT zero — 6
    nodes resolved, 0 `body`, 4 `children` — rather than a key nobody asked about.
    Retiring the THREE THIN reads is objectui#9916,
    which asks for the stored-corpus reading they turn on; `page:card`'s read is not
    that card's either — it is objectui's own, grounded by objectstack#5775 /
    ADR-0087 D2 rather than owned by it, and it ends when the stored rows have been
    replayed through the conversion that already shipped for it.
  - **The published type.** `BaseSchema.body` is `never` on the TypeScript face and an
    alias refusal naming `children` on the Zod mirror, as are the four per-component
    redeclarations (`CardSchema`, `AspectRatioSchema`, `PageNodeSchema`, `TooltipSchema`).
    ⚠️ Refused **by name**, not deleted: `BaseSchema` carries an index signature and the
    mirror ends `.passthrough()`, so a deleted member would be accepted silently and
    rendered by nothing — the exact silence this retirement ends.
  - **The VS Code extension (`object-ui`) changes behaviour, not just teaching.** Its
    preview no longer draws a `body`-spelled document — the node renders empty, the way
    the runtime renders it — and its validator now emits a warning naming `children` at
    the key's own position. That warning is skipped for node types that declare their
    own `body` input (`record:alert`), so a declared translation-map `body` is not
    reported as the retired spelling.
  - **Two new `@object-ui/sdui-parser` exports.** `RETIRED_CHILD_LIST_KEY` (the retired
    spelling, so a consumer names it once) and `checkRetiredBodyDialect` (the diagnostic
    the tier substitutes for `unknown-prop` on that key).
  - **The authoring tier.** `sdui-parser` answers an authored `body` with the replacement
    named, instead of the bare "has no prop" every typo gets — and a `body` child list
    under a non-container draws the same containment code the `children` spelling draws.
  - **Corpus and teaching, in the same change.** 114 authored nodes across the docs site,
    the schema catalog, five package READMEs and the VS Code extension's snippets, JSON
    schema, syntax map, hovers and completions. The platform does not refuse a spelling it
    still ships.
  
  ## Migrating
  
  Rename the key. `{ "type": "card", "body": [...] }` becomes
  `{ "type": "card", "children": [...] }`; both faces now name `children` in the refusal,
  and `pnpm census:body-dialect` reports where the dialect still lives in a tree.
  
  ⚠️ **Four renderer reads are deliberately untouched, all in the `page:*` namespace** —
  `page:card` and the three thin `page:section` / `page:footer` / `page:sidebar`
  containers. They are read-only back-compat paths for STORED documents, not a second
  authoring face: `@objectstack/spec`'s `PageContainerProps` says so itself — `children`
  is canonical, `body` is deliberately not declared, and «the renderers keep reading
  `body` as a back-compat fallback for stored documents; that fallback is objectui's to
  retire on its own schedule».
  
  ⛔ **Authoring `body` on them is still refused**, on both published faces and at the
  authoring tier, exactly as everywhere else. What survives is the READ.
  
  ⚠️ The two halves are not in the same state. `page:card` has a migration path — the
  spec's conversions registry carries `page-card-body-to-children` (`toMajor: 17`,
  surface `page.component.page:card.body`), which shipped with `retiredFromLoadPath: true`
  in spec 17.0.0. The other three have **no conversion at all**, so a stored row under
  their key has nowhere to be migrated to. ⇒ the two halves are tracked separately, and
  the pointer is not one card: retiring the three thin reads is objectui#9916, whose
  question is the stored corpus; retiring `page:card`'s read was **grounded by**
  objectstack#5775 / ADR-0087 D2, whose conversion has already shipped and whose
  remaining condition is replayed rows. ⚠️ Grounded by, not owned by — the distinction
  is the point. objectstack#5775 is CLOSED and its body is a props-declaration audit
  that carries no such step, so a reader sent there for the action finds none. The
  action is objectui's, on the spec's own terms quoted above: «that fallback is
  objectui's to retire on its own schedule.»
  
  **Non-rendering readers keep their arm on the same rule**, and none of them renders
  anything: while a renderer still reaches stored `body` content, a reader that must see
  the SAME content keeps its arm, or the renderer draws what the reader cannot find.
  Those are the two tab-subtree walkers in `renderers/layout/containers.tsx`,
  `app-shell`'s `pageSchemaIntrospect` (`CONTAINER_KEYS`) and `PageBlockInspector`
  (`STRUCTURAL_PROP_KEYS`, the inspector half of a stored `properties.body`), and the
  CLI's `OBJECTUI_STRUCTURAL_KEYS` — a file-IDENTIFICATION marker, where keeping `body` is
  what lets an old file still be recognised as an ObjectUI node and therefore refused,
  instead of silently not judged.
  
  ⚠️ **Dated note, 2026-10-02 — the `sidebar-*` parts are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2d) unregistered the ten `sidebar-*` part keys. Of the
  family the **Renderers** line names, only `sidebar` remains, and it reads `children`. The rest of this entry is
  kept as the reading of this change.
- 4b5bb95: The VS Code extension no longer ignores a child list spelled `children`, and everything
  the platform scaffolds now emits that spelling (objectui#7181).
  
  ## The defect, and who it hit
  
  `children` is the spelling ObjectUI declares on four faces: the `BaseSchema` TypeScript
  declaration and its zod mirror in `@object-ui/types`, `validateSchema` in
  `@object-ui/core`, and the authoring tier's `BASE_PROPS` in `@object-ui/sdui-parser`
  (which accepts `children` and does **not** list `body`).
  
  Both readers in the VS Code extension honoured only `body`. So an author who wrote the
  spelling the platform blesses got, from the tool meant to be teaching them the format:
  
  - **a blank preview** — `Object UI: Open Preview` rendered the node as an empty card or
    container, with no error and no diagnostic; and
  - **children that were never validated** — the validator's recursion never reached them,
    so a child missing its required `type` drew no warning at all.
  
  Both failures were silent in both directions: nothing told the author their file was
  being skipped, and nothing told them it was fine. Metadata written to a file by one
  party and re-authored by another was simply dropped by the reader.
  
  Both readers now read `children` first and **keep** `body`, so every existing
  `body`-spelled document behaves exactly as it did. Nothing is removed and no accepted
  spelling is narrowed. The extension's validator also reports diagnostics at the key the
  document actually used, instead of addressing them to `.body[...]` in a file that
  contains no such key.
  
  ## Scaffolders and shipped defaults now emit `children`
  
  The same dialect was being *produced* into files users own, and into components' own
  declared defaults:
  
  - `objectui init` — the `app.json` written for every template
  - `Object UI: Create New Schema` — every template the VS Code extension writes
  - `carousel`, `resizable` and `scroll-area` — the child lists inside their shipped
    `defaultProps`
  - the runner's "no index page found" fallback page
  
  Every node type involved already read `children`, so rendering is unchanged; what moves
  is the spelling users are handed as their starting point.
  
  ⚠️ This is a change to what those tools *emit*, not to what ObjectUI accepts: `body`
  remains readable everywhere it was readable before, and a project scaffolded by an
  earlier version needs no edit. Retiring the `body` arm is a separate, already-ruled
  step and is not part of this release. `pnpm census:body-dialect` is the instrument that
  reports where the dialect still lives.
  
  Scaffolded output and shipped defaults are now pinned by tests that discover the
  template population from the code, so a template added later is covered without anyone
  remembering to extend them.

### Patch Changes

- fc7db05: The VS Code extension's **Export to React** command types the `schema` constant it emits as `SchemaRendererProps['schema']`, imported type-only from `@object-ui/react` beside `SchemaRenderer` (objectui#11515).
  
  Unannotated, every `type` in the constant widened to `string`. A `SchemaRenderer` prop that discriminates on the literal `type` refuses such a value, so the generated file stopped compiling as soon as the prop is narrowed to the declared node types (objectui#11466). Annotated, each `type` stays a literal and the schema is checked where it is written: a schema the prop does not accept is refused on the constant's own line. Measured with `tsc` against the built packages, the emitted file compiles today and with objectui#11466 applied.
  
  `SchemaNode` was the annotation first proposed, and it does not fit: it also admits `number` and `boolean`, which the prop leaves out, so every generated file was refused at its one JSX line.
  
  The compile pin gains a leg against the real prop type, read from `SchemaRenderer.tsx`, with a positive control. The two documented copies of the preamble (`DESIGN.md` and the docs page) follow it. The docs page's sample keeps its `h1` node: `h1` is a declared type (`HtmlElementSchema`), and the annotated sample compiles both today and with objectui#11466 applied.
- 744c25e: Fix the phantom import the VS Code extension's **Export to React** command wrote into
  every file it generated (objectui#7837).
  
  `generateReactComponent()` emitted a preamble that imported `registerDefaultRenderers`
  from `@object-ui/components` and then called it. That symbol is on **no export** of
  that package: its built `dist/index.d.ts` carries exactly one `register*` name,
  `registerPlaceholders`, and `registerDefaultRenderers` appears **0 times** in either
  `dist/index.d.ts` or `dist/index.js`. So every file the command produced failed to
  compile with `TS2305` naming a symbol the user never typed.
  
  `@object-ui/components` registers its renderers as an **import side effect** —
  `sideEffects: true` in its manifest, `import './renderers'` in its barrel under the
  comment `Register all ObjectUI renderers (side-effects)`, and **114 `register(` call
  sites** at module scope in the built `dist/index.js`. There is no registration function
  to call, so the generated preamble now imports the package for the side effect and says
  why. Same spelling the root README landed for objectui#7417.
  
  `packages/vscode-extension/DESIGN.md`, which documented the identical two lines, is
  corrected in the same commit so the design record does not freeze the defect.
  
  No public surface moved: no export added, no signature changed.
- f98e73b: Drop the unused `import React from 'react'` the VS Code extension's **Export to React**
  command wrote into every file it generated (objectui#7862).
  
  The generated file's only JSX is a single SchemaRenderer element, so under the automatic
  JSX runtime — `"jsx": "react-jsx"`, what a new Vite or Next project is configured with —
  the `React` identifier was never read. Measured on this branch against the built
  `dist/index.d.ts` of `@object-ui/react` and `@object-ui/components`, TypeScript 6.0.3:
  the emitted file compiled clean under `react-jsx` + `strict` (exit 0), and under the same
  config plus `noUnusedLocals: true` it failed with
  `TS6133: 'React' is declared but its value is never read` — so a consumer with that
  option on could not compile the file the command had just handed them.
  
  The preamble now says in a comment that it assumes the automatic runtime and that the
  import goes back only on the classic `"jsx": "react"` transform, which is the one
  configuration this costs: measured, that file reports one diagnostic about `React` being
  out of scope. Nothing in the extension emits or promises a `jsx` setting — the string
  does not occur anywhere in the package — and the published docs page for the command
  already showed the output without the import.
  
  A new pin, `src/__tests__/export-to-react-compiles.test.ts`, now extracts the template's
  PRODUCT and compiles it under `noUnusedLocals`, rather than matching substrings in the
  generator. The sibling objectui#7837 pin was green for the whole life of this line
  because it never named it; a compile closes the class instead of one member of it. Its
  positive control runs on every invocation: re-adding the import must report TS6133, so
  the harness cannot go quietly, permanently green.
  
  `packages/vscode-extension/DESIGN.md`, whose section 4 hand-mirrors this preamble, is
  corrected in the same commit so the design record does not freeze the defect — the
  spelling objectui#7837 landed for the same file. What binds the two copies together is
  still nothing, and objectui#7976 holds that question.
  
  No public surface moved: no export added, no signature changed.
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [4ab4f1b]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [544aca2]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [86982ac]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [8acc51b]
- Updated dependencies [3261e64]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [4758b33]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [baac95a]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [30b11ad]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [3d6badf]
- Updated dependencies [25cb364]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [328abeb]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [42687ba]
- Updated dependencies [6cd8f66]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [76e9df0]
- Updated dependencies [6158e4c]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [858eafb]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [e6bc087]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [063119f]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [f9c8c4e]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [64dae8e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [ae476b8]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [90665e0]
- Updated dependencies [7e19d03]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [6f81384]
- Updated dependencies [8f1d995]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [3c2b6f7]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [2acd8e1]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [adb2a86]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [1237ae4]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [5d0876c]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
- Updated dependencies [52cac38]
- Updated dependencies [93fea2e]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [335abea]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [3a43a15]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [f391ede]
- Updated dependencies [f5cfbbd]
- Updated dependencies [f5cfbbd]
- Updated dependencies [8b532cb]
- Updated dependencies [64c3cdd]
- Updated dependencies [4d65991]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [8693b85]
- Updated dependencies [58b7b3d]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [19a0b0e]
- Updated dependencies [526fc11]
- Updated dependencies [f8e3e9a]
- Updated dependencies [3b6bc69]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [da45e6b]
- Updated dependencies [835f0f3]
- Updated dependencies [ed35b44]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [fb91ac9]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [05a49f2]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [ff5ef1c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [6791717]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [0e05aac]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fb336df]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [a691c0b]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [258d264]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [91783c4]
- Updated dependencies [ca39427]
- Updated dependencies [2d36552]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0

## 17.6.0

### Patch Changes

- 5607092: objectui#4029 — the repo root now lints `no-console` (`error`, allowing
  `warn`/`error`) so a stray module- or function-scope `console.log`/`info`/
  `debug` fails CI instead of shipping silently (as `console.log('Registering
  object-map...')` did in #7139, caught only by hand). Landing the rule meant
  individually judging every real hit outside the tooling exemptions
  (`scripts/**`, `**/examples/**`, test files, `packages/cli/src/**`,
  `packages/create-plugin/src/**`) — this changeset covers the published
  packages whose call sites changed:
  
  - `@object-ui/app-shell`: `ObjectDataPage`'s dropped-URL-filter message is a
    real diagnostic (data silently discarded), so it moves from `console.debug`
    to `console.warn` to match the house convention.
  - `@object-ui/plugin-detail`: `DetailView`'s Web Share API failure now reports
    via `console.error` (it is a real failure, not debug noise); a redundant
    "Link copied to clipboard" success log is removed.
  - `@object-ui/fields`: `MasterDetailField`'s `handleView` stub no longer logs
    the item it does nothing with.
  - `@object-ui/runner`: `App`'s loader-selection debug prints, `LayoutRenderer`'s
    unused click-handler stub log, and `MockDataSource`'s per-call narration
    (`find`/`create`/`getObjectSchema`) are removed — none diagnosed a problem,
    they only echoed the happy path.
  - `object-ui` (VS Code extension): the "extension is now active!" activation
    log is removed.
  
  No behavior changes beyond console output. `@object-ui/core` and
  `@object-ui/data-objectstack` also touch `no-console`-adjacent lines
  (`debugLog`/`debugTime`/`debugTimeEnd`, `createQuietHttpLogger`) but only to
  add `eslint-disable-next-line` documentation — those ARE the repo's
  deliberate debug/logger infrastructure, not leaked residue, so their own
  changeset carries empty frontmatter.
- Updated dependencies [88085e3]
- Updated dependencies [2533ec5]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [e1d4251]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [ac600e5]
- Updated dependencies [c1ef923]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [f1d4748]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Patch Changes

- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [1f9b905]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [49ae9f4]
- Updated dependencies [2459a3e]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [bb68488]
- Updated dependencies [9461dd3]
- Updated dependencies [ab04728]
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [d229dfa]
- Updated dependencies [4bc6c23]
- Updated dependencies [c3b01a7]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [48132f7]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [e6fdbdc]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/core@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [d915c47]
- Updated dependencies [5781fb1]
- Updated dependencies [9e9e9a9]
- Updated dependencies [23018cc]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [509104a]
- Updated dependencies [a4cff5b]
- Updated dependencies [f833d3a]
- Updated dependencies [2a9513d]
- Updated dependencies [d22ae31]
  - @object-ui/core@17.3.0
  - @object-ui/types@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/core@17.2.0

## 17.1.0

### Patch Changes

- Updated dependencies [62311b6]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [7f23cd0]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/types@17.1.0

## 17.0.0

### Patch Changes

- dc7a798: fix(plugin-grid,plugin-form,plugin-designer,cli,vscode-extension): type-check the last five unchecked packages, and fix the two runtime bugs that hid there (#2919)

  Closes the remaining `DEBT` entries from the #2911 sweep. Each package gains
  `"type-check": "tsc --noEmit"` and loses its entry in
  `scripts/check-type-check-coverage.mjs`; coverage goes 36 -> 41 of 45 and
  outstanding errors 25 -> 5 (only #2916 `plugin-view` and #2918 `layout` remain).

  **Two of these were real bugs, not just type noise.**

  `@object-ui/cli` — `objectui validate` could never report a validation failure.
  `ZodError.errors` was removed in Zod 4 (the repo is on 4.4.3), so `.errors` read
  `undefined` and `.forEach` threw a `TypeError` that the enclosing `catch`
  reported as `✗ Error reading or parsing schema file: Cannot read properties of
undefined` — swallowing the very errors the command exists to print. Now reads
  `.issues`. Verified against the built CLI: an invalid schema now prints
  `1. Invalid input / Code: invalid_union` and exits 1.

  `@object-ui/plugin-grid` — grouping a grid by a boolean column showed the raw
  i18n key. `t('grid.booleanTrue', 'Yes')` asked for a key present in neither
  `GRID_DEFAULT_TRANSLATIONS` nor any locale bundle, and passed the English
  fallback as a bare second argument — which `createSafeTranslation`'s no-provider
  translator reads as an _options object_, so the fallback never applied and the
  header rendered the literal `grid.booleanTrue`. Switched to the `grid.yes` /
  `grid.no` keys the boolean cell renderer (`ObjectGrid.tsx`) and
  `BulkActionDialog` already use, with the fallback passed as `defaultValue`.
  Covered by a new regression test, confirmed to fail against the old code.

  The rest are type-only corrections that preserve runtime behaviour exactly:

  - **plugin-grid** `importParsers.ts` — `scorePair`'s `score`/`reason` moved into
    one `best` record. They were captured `let`s mutated only inside the `bump`
    closure, which TypeScript's control-flow analysis does not track, so it still
    believed `reason` was `'none'` at the type gate and flagged the comparisons as
    non-overlapping (TS2367). The gate — which stops a text column being mapped
    onto a number field — is unchanged; its two dedicated tests still pass.
  - **plugin-form** — `SectionFieldsContext.fieldLabel` now requires `fallback`,
    matching the `useSafeFieldLabel` producer in `@object-ui/i18n` (an omitted
    fallback could not satisfy the `=> string` return, and all four call sites
    already pass one). This one signature cleared six errors.
    `MasterDetailFormSchema.recordId` widens to `string | number`, matching
    `ObjectFormSchema` and the five envelopes that forward straight into it;
    it is narrowed with `String()` only at the batch-transaction boundary, whose
    `BatchTransactionOperation.id` is a string by protocol (the `isEdit` guard
    already proves it non-null there). `deriveMasterDetail`'s column sort gets an
    explicit `fillPriority` helper — `GridColumn.type` is optional, and a column
    without one keeps sorting at priority 5 exactly as the old
    `TYPE_FILL_PRIORITY[undefined] ?? 5` lookup put it.
  - **plugin-designer** — unused `index` parameter prefixed `_`, matching the
    `_entry` beside it.
  - **cli** — a stale `@ts-expect-error` removed; `viteConfig` is typed `any`, so
    the line it guarded had stopped erroring.
  - **vscode-extension** (`object-ui`) — migrated off `moduleResolution: "node"`,
    which is deprecated and stops working in TypeScript 7, to `node16` paired with
    `module: "node16"` (the package has no `"type": "module"`, so node16 resolves
    it as the CommonJS that tsup emits, and it gains the `exports`-map awareness
    node10 lacks). Its error count was under-reported as 1: that TS5107 config
    error masked four more. The package uses `console`/`Buffer` but sets
    `lib: ["ES2020"]` with no DOM and never declared `@types/node` — added, with an
    explicit `types: ["node", "vscode"]`.

  Also: `plugin-grid`, `plugin-form` and `plugin-designer` gain the `baseUrl` +
  `paths` override their type-checked plugin peers already carry, and `cli` an
  empty `paths`. Without it the inherited root `paths` point `@object-ui/*` at
  sibling `src/`, which is outside each project's `rootDir` and produces the ~104
  spurious TS6059 errors noted in #2915; workspace deps instead resolve through
  node_modules to built `.d.ts`, which `type-check`'s `dependsOn: ["^build"]`
  guarantees exist.

  Verified the gate genuinely covers all five rather than trusting the green:
  injecting a type error into each package makes `pnpm type-check --filter <pkg>`
  fail, which was impossible before this change.

- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [7b35e4b]
- Updated dependencies [e16ed2d]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [2735de6]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d147a13]
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Patch Changes

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [2e7d7f0]
- Updated dependencies [94d4876]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [62b9ab5]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/types@14.0.0

## 13.2.0

### Patch Changes

- @object-ui/types@13.2.0
- @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [619097e]
  - @object-ui/types@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [c31874d]
  - @object-ui/types@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [c38d107]
  - @object-ui/types@11.4.0
  - @object-ui/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d23d6eb]
  - @object-ui/core@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/core@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [5976ba3]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [1394e34]
- Updated dependencies [300d755]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3

## 6.2.2

### Patch Changes

- @object-ui/types@6.2.2
- @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/core@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [70b5570]
- Updated dependencies [d1442e3]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1
- @object-ui/core@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/types@5.0.2
- @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [7213027]
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0
- @object-ui/core@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
  - @object-ui/types@4.5.0
  - @object-ui/core@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0
- @object-ui/core@4.4.0

## 4.3.1

### Patch Changes

- @object-ui/types@4.3.1
- @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- @object-ui/types@4.3.0
- @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6
- @object-ui/core@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5
- @object-ui/core@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4
- @object-ui/core@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/core@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1
- @object-ui/core@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4

## 3.1.3

### Patch Changes

- 1f7d8ac: Bug fixes and dependency upgrades
  - fix: filter `id` field from RelatedList auto-generated columns
  - fix: resolve TS2742 in drawer.tsx and sidebar.tsx for portable declaration files
  - fix: replace OData string filters with object format in dataSource.find calls
  - chore(deps): upgrade @objectstack/\* from ^3.2.5 to ^3.2.6
  - refactor: unify primary key field from `_id` to `id` per objectstack-ai/spec
  - refactor: unify i18n service registration across server/dev/mock environments
  - refactor: auth client to use official better-auth createAuthClient
  - feat(components): migrate to unified radix-ui package + shadcn v4 RTL classes
  - @object-ui/types@3.1.3
  - @object-ui/core@3.1.3

## 3.1.2

### Patch Changes

- 3faaa3a: chore(deps): bump hono from 4.12.3 to 4.12.4
  - @object-ui/types@3.1.2
  - @object-ui/core@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/core@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2

## 3.0.1

### Patch Changes

- @object-ui/types@3.0.1
- @object-ui/core@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0
  - @object-ui/core@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0

## 0.3.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1

## 0.3.0

### Minor Changes

- Unified version across all packages to 0.3.0 for consistent versioning

## 0.1.2

### Patch Changes

- Updated dependencies
  - @object-ui/types@0.3.0
  - @object-ui/core@0.2.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@0.2.1
  - @object-ui/core@0.2.1

All notable changes to the Object UI VSCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of Object UI VSCode extension
- Syntax highlighting for Object UI JSON schemas
- IntelliSense and auto-completion for component types and properties
- Live preview functionality with auto-refresh
- Schema validation with real-time error checking
- Code snippets for common patterns (forms, cards, layouts, etc.)
- Export to React component functionality
- Schema formatting command
- Template-based schema creation
- Hover documentation for properties and components
- Support for `.objectui.json` and `.oui.json` file extensions

### Features

- **Preview System**: Side-by-side live preview of schemas
- **Validation**: Real-time validation with helpful error messages
- **Snippets**: 12+ code snippets for rapid development
- **IntelliSense**: Context-aware auto-completion
- **Export**: One-click export to React components

## [0.1.0] - TBD

### Added

- Initial beta release
- Core functionality for Object UI schema development
- Documentation and examples
