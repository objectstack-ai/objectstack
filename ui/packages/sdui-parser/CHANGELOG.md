# @object-ui/sdui-parser

## 18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c4c506b: **Clause-②: yes (narrowing)**
  
  One declaration of the per-type NODE SLOTS — the keys other than `children` through which a renderer hands authored nodes back to `SchemaRenderer` — and three readers that walk it instead of stopping at `children` (objectui#11170, the follow-up PR #11126's Acceptance notes filed).
  
  New on `@object-ui/types`, beside `BaseSchema.children`: `NODE_SLOT_DECLARATIONS` (one row per renderer, under every registry spelling that resolves to it), `nodeSlotsFor(type)`, `nodeSlotPathSegments(path)` and `nodeSlotValues(node, path)`, with the types `NodeSlotDeclaration`, `NodeSlotRow`, `NodeSlotSegment` and `NodeSlotValue`. A position is spelled as a key path — `trigger`, `items[].content`, `regions[].components`, `items[]`, `report.sections[].content` — and the value at its end is one node or a list of nodes. The `page:*` rows are `@objectstack/spec`'s `pageComponentSlotPositions()` placed on the type whose renderer reads each position, pinned against that export in both directions; every other row is objectui's own, pinned against the live renderer. `body` stays retired as the generic child-list key (objectui#6771): it appears only on the four `page:*` types whose renderer still paints it for stored documents, marked `retired`.
  
  Accept sets that narrow, each reader FROM → TO:
  
  - `@object-ui/cli` — `objectui check`'s unevaluated-expression refusal (`findUnbindableTextExpressions`). FROM: the document root and every node its `children` hold. TO: those, and every node under a slot its type declares — so a `${…}` on `title` / `label` / `value` / `description` of a node under a dialog's `content`, a tab item's `content`, a page's `regions[].components`, a carousel item, a detail view's `tabs[].content` is now refused with the slot path (`items → 0 → content → value`). The false-refusal rows of PR #11126's ablation 2 stay green: a form's `fields[]`, a grid's `columns[]` and `{ "type": "multiple" }` are not slots. Measured over this repository's own JSON corpus and docs fences: no new finding.
  - `@object-ui/core` — `validateSchema`. FROM: `validateChildren` recursed through `children` only. TO: it also recurses through the declared slots, so an invalid node under one (a retired `crud` spelling under `dialog.content`, an `INVALID_SCHEMA` member) is reported with its own path, spelled as `schema.items[0].content`. Measured over the same corpus: no new finding.
  - `@object-ui/sdui-parser` — `validateTree`. FROM: the walk descended `children` alone, and a manifest entry carried no slot. TO: `ManifestComponent` gains `slots?: readonly string[]`, `manifestFromConfigs` gains `opts.slotsFor` (hand it `nodeSlotsFor`) and projects each entry's non-retired positions, and `validateTree` descends them — an unknown component, an unknown or mis-typed prop or an illegal enum under a slot now draws its diagnostic. A manifest built without the option serialises byte-identically and keeps the `children`-only reach. The `RETIRED_CHILD_LIST_KEY` refusals are unchanged.
  - `@object-ui/components` — the `kind:'html'` page's compile manifest (`getJsxManifest`) is built with `slotsFor`, so an html-tier page whose slot-held node fails validation now fails to compile the way one under `children` does. Narrowing: a page that compiled with an unknown tag under a `dialog`'s `content` no longer does.
  
  Docs: `content/docs/utilities/cli.mdx`'s "Component nodes only" rule, the gate's own docblock, `validateChildren`'s comment and the parser's header now say the walk follows `children` and the declared slots; the declaration's header is where the slot list is explained.
- d92b2a1: The metric sub-caption is retired on the reader side (objectui#11389, ruling C, the objectui half after `@objectstack/spec` 17.7.0). **BREAKING** for any dashboard that drew a caption under a metric's value.
  
  A metric tile used to draw a sub-caption under its value from the widget's `options.description`, translated by a client bundle entry at `dashboards.NAME.widgets.ID.subCaption`. The spec never declared that options key, and its only writer was the server's `translateDashboard` overlay. `@objectstack/spec` 17.7.0 removed the overlay and refuses a `subCaption` translation entry by name. objectui now stops reading both:
  
  - **`@object-ui/plugin-dashboard`.** No metric tile draws a sub-caption, on either dashboard surface (`DashboardRenderer`, `DashboardGridLayout`), whether the tile is dataset-bound or a stored inline metric. An authored `options.description` (a string or a per-locale map) draws nothing, and neither does a bundle `subCaption` entry. A widget's one authored description, `widget.description`, still draws as the card-header subtitle on `DashboardRenderer`, translated through the widget's `description` bundle key. Nothing on the package entry is removed: the sub-caption resolver module and `DatasetWidget`'s `subCaption` prop were internal.
  - **`@object-ui/i18n`.** `useObjectLabel()` no longer returns `widgetSubCaption`. This removes a member of a published hook's return value: a caller that destructured it no longer compiles, and has nothing to call instead, because the key it read is refused by the spec.
  - **`@object-ui/sdui-parser`.** `CONSUMED_WIDGET_OPTION_KEYS` drops `'description'` and is now exactly the five keys the spec declares (`dateGranularity`, `limit`, `sortBy`, `sortOrder`, `stageOrder`). So `validateTree` reports an authored `options.description` on a dataset-bound dashboard widget as an `unconsumed-widget-option` **warning**, where it used to report nothing. It is a warning, not an error, and the widget's `suppressWarnings` escape hatch still applies.
  
  **Clause-②: no (narrowing).** One export member is removed (`useObjectLabel().widgetSubCaption`) and one exported constant loses a member (`CONSUMED_WIDGET_OPTION_KEYS`). Nothing is added and no accepted input widens.
  
  If a caption under a metric's value is wanted again, it returns as a declared widget-level key outside `options`, not as `options.description` (ruling C).
- 35a2b59: The node type of the tree this package's parser produces is declared and exported as `ParsedSchemaNode` instead of `SchemaNode` (objectui#6349, batch 11). `@object-ui/types` publishes a different `SchemaNode`: the closed authoring union, discriminated on a literal `type`, with no index signature and with numbers, booleans and `null` admitted as children. The parser's node is an open, as-parsed `SchemaElement` (any `type` string, the keys as authored) or a text string, and neither type is assignable to the other. One exported name stood for both across the two packages, and types keeps it.
  
  **Type change, breaking for some consumers.** `SchemaNode` is no longer exported from `@object-ui/sdui-parser`. Replace `import type { SchemaNode } from '@object-ui/sdui-parser'` with `ParsedSchemaNode`; it is the same type (`SchemaElement` or a string). The old import fails to compile with TS2305 ("has no exported member 'SchemaNode'"). `SchemaElement`, `ParseResult` and every function keep their names and shapes.
  
  No runtime behaviour changes.

## 17.7.0

### Minor Changes

- baac95a: feat(core,sdui-parser): the published manifest declares the html tier's registered intrinsic elements, marked `tier: 'html'` — `div` stays out
  
  A `kind:'html'` page may author the everyday HTML tags its renderer registers —
  the flow/inline set of `html-elements.tsx` (h1–h6, p, a, lists, emphasis,
  figure/img/hr/br, time, address, cite, q), `span`, `table`, `label` and the seven
  sectioning tags — and the console has rendered such pages all along. The
  published `sdui.manifest.json` never said so: it was the curated `PUBLIC_BLOCKS`
  vocabulary alone, so the objectstack CLI gate, which whitelists an html page's
  tags from that manifest, refused every plain HTML tag as `forbidden-tag` on
  pages the renderer accepts (200 ledgered findings over the three shipped showcase
  pages). The maintainer ruled A on objectstack#20112: the producer declares the
  set, exactly as the registry declares it, and `div` stays deprecated.
  
  **What moves for a consumer.** `ComponentRegistry.getPublicConfigs()` — the
  read both manifest producers serialise — now returns the curated tier AND the
  html tier's intrinsic elements, the latter from the new `HTML_TIER_INTRINSICS`
  roster (`@object-ui/core`) and each stamped `tier: 'html'` in the projection.
  `manifestFromConfigs` carries that one value into a new optional
  `ManifestComponent.tier` (`@object-ui/sdui-parser`), so the regenerated
  `sdui.manifest.json` grows by the roster (47 entries, each with its registered
  `inputs` and its child slot declared exactly where the registration renders a
  child list — the void tags `img` / `hr` / `br` declare none) and
  `sdui-intrinsics.d.ts` types them. A reader that whitelists tags by key — the
  objectstack gate — needs no change and accepts the tags. A reader that means the
  CURATED vocabulary filters on the stamp: `generateBlockList` now sections the
  html tier under its own count, and the `kind:'react'` JSX scope skips stamped
  entries (`@object-ui/components`, `react-page.tsx`), so no `P` / `A` / `Img`
  wrapper is injected into react pages — on that tier a lowercase `<p>` is React's
  own element.
  
  **What does not move.** `PUBLIC_BLOCKS` is unchanged and the two rosters are
  pinned disjoint; every curated manifest entry serialises byte-identically
  (`tier` is written as exactly `'html'` or omitted). `div` is not declared: the
  gate keeps refusing `<div>` on an html page, and `box` remains the JSON
  surface's replacement. `code` is not declared either — the bare `code` key is
  the `field:code` widget's namespace fallback, not an element renderer — nor is
  `kbd`; both are recorded, with reasons, in the console's exclusion ledger.
  No registration changes; `html-elements.tsx` is untouched.
  
  ⚠️ **Dated note, 2026-09-27 — `code` has since joined the roster — objectui#10756.** At this change the roster held 47 tags and `code` was undeclared because the bare key was the `field:code` widget's fallback; `html-elements.tsx` now registers `code` as a sanitised passthrough (`ui:code`), `@object-ui/fields` registers the widget with `skipFallback` so it keeps only `field:code`, and the manifest declares `code` with `tier: 'html'` — 48 html-tier entries. `div` and `kbd` are still out. The rest of this entry is kept as the reading of this change.
  
  The manifest the framework ships regenerates from objectui's built tree at the
  pin (its `gen-sdui-manifest-node.mjs`); its lockstep copy of `manifestFromConfigs`
  must take this port for the stamp to reach that file — until then the tags are
  declared there without the marker, which the gate treats identically.
- c80236e: The base-prop list is declared once, and the renderer's `visibleWhen`, `hiddenOn` and `testId` join it (objectui#11044).
  
  `validateTree` and `generateDts` each kept their own hand-written list of the base props: the `BaseSchema` keys a node may carry without its registration declaring them. The two lists had drifted. After objectui#11008 the validator accepted `bind` and `hidden` on every node, while the generated JSX types (`SduiBaseProps` in `sdui-intrinsics.d.ts`) still refused both (`TS2322 … Property 'bind' does not exist`). Both now read one exported list, `SDUI_BASE_PROPS`, and the generated `SduiBaseProps` interface is emitted from it.
  
  Three changes to what is accepted come with it:
  
  - **`visibleWhen`, `hiddenOn` and `testId` are base props of every node.** `BaseSchema` declares all three, no registration declares any of them, and `SchemaRenderer` reads them for every node. It evaluates `visibleWhen` and `hiddenOn` in its hide chain, and it re-emits `testId` as `data-testid`. `validateTree` answered each with an `unknown-prop` warning on every registered type. Now none of them draws a diagnostic, and the generated JSX types accept them, along with `bind` and `hidden`. The canonical ADR-0089 predicate, `visibleWhen`, used to warn while the deprecated `visibleOn` was silent. A near-miss spelling such as `testid` still draws `unknown-prop`.
  - **`name`, `label`, `description`, `placeholder`, `data` and `ariaLabel` are base props where a type does not declare them.** Some registrations declare each of these `BaseSchema` members as a typed input. On those types the declared input wins, and a wrong-typed value still draws `type-mismatch`. On every other type the key no longer draws `unknown-prop`. In the generated JSX types, an interface that declares one of these keys extends `Omit<SduiBaseProps, …>` for it, so its declared type is the one an author compiles against.
  - **The cost is named.** On a type that does not declare one of the six keys, the parser tier no longer reports it, whether or not the renderer reads it. For example, `description` on `page-header` is the retired alias of `subtitle` (objectui#3226), and it used to draw `unknown-prop`. It now draws nothing.
  
  `SDUI_BASE_PROPS` and its `SduiBaseProp` / `SduiBasePropScope` types are new exports. Each entry names a `BaseSchema` member, the scope it is a base prop in (`'every-node'` or `'where-undeclared'`), and its type in the generated JSX surface.
  
  ⚠️ **Dated note, 2026-10-02 — the `page-header` example no longer applies — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2c) unregistered `page-header`, so a
  `page-header` node now draws `unknown-component` before any prop check runs. The cost this entry names
  is unchanged for every type that is still registered. The rest of this entry is kept as the reading of
  this change.
- 4d377ed: The generated JSX types let a declared input win with its type for every base prop, so `sdui-intrinsics.d.ts` compiles as generated (objectui#11075).
  
  `generateDts` over the real public manifest produced a `.d.ts` that did not compile under `tsc --strict` without `skipLibCheck`: `TS2430 Interface 'RecordAlertProps' incorrectly extends interface 'SduiBaseProps'`. `record:alert` declares `visible` as a boolean, a bare CEL string or a `{ dialect: 'cel', source }` envelope, and its renderer honours all three. `visible` is an `'every-node'` base prop typed `boolean` in `SduiBaseProps`, and objectui#11044's `Omit` covered only the `'where-undeclared'` members. An author compiling against the file got an error inside the generated file instead of a check on their own JSX. With `skipLibCheck` on, the base `boolean` hid the string and envelope arms.
  
  Now an interface `Omit`s every base attribute its registration declares, whatever the member's scope, and types it with the declared type:
  
  - **`<record:alert>` accepts `visible` as a string and as the `cel` envelope** in the generated types, as the manifest declares and the renderer reads. A number is still refused.
  - **Where a registration declares a base attribute with the base type** (`className?: string` on most html-tier tags and many blocks, `disabled?: boolean` on `element:button`), the interface extends `Omit<SduiBaseProps, …>` for it too. What those interfaces accept does not change.
  - **`SduiBaseProps` itself is unchanged**: `visible`, `disabled` and `hidden` stay `boolean` on every type that does not declare them.
  
  `validateTree` is unchanged: it still skips an `'every-node'` key before the declared-input lookup.
- 0db4fb3: html tier: a braced attribute value that is not strict JSON now draws a `inert-expression` warning instead of vanishing silently (objectui#6598)
  
  `interpretBrace` materializes strict-JSON values only; anything else — the
  single-quoted array every JSX author writes (`columns={['name','amount']}`),
  unquoted object keys, any JS expression — compiles to the deferred `{ $expr }`
  marker, and nothing downstream evaluates that marker: the html tier parses,
  never executes (ADR-0080), and no renderer consumes `$expr`. The value reached
  the renderer as an opaque object, defensive non-array/non-object reads degraded
  it to "not declared", and the author's binding vanished with zero diagnostics
  anywhere — a production page's `list-view` rendered its row count and toolbar
  with no data columns, through eight `columns` spellings (objectui#6598, moved
  from objectstack#12649). That is ADR-0078's prohibited parsed-but-silently-inert
  state.
  
  `validateTree` now emits a warning-severity `inert-expression` diagnostic when a
  declared input's value is the `$expr` marker, with the fix in the message: write
  the value as JSON (double-quoted strings and keys). Warning, not error, per the
  `8d58f46b4` posture for inert authored keys — pages keep compiling and
  rendering exactly as before; the silence is what changed. Escalating the
  severity, widening the accepted literal grammar (e.g. materializing
  single-quoted strings), and covering base props like `style` are contract
  decisions deliberately left on objectui#6598.
- 4703651: html tier: braced attribute values now materialize the JS literal subset — single-quoted strings and unquoted identifier keys work (objectui#6614)
  
  The html tier is the untrusted-safe DATA tier: source is parsed, never executed
  (ADR-0080), which makes it the only safe carrier for runtime AI- or
  tenant-authored pages. But `interpretBrace` accepted only strict JSON inside
  braces while the surface called itself JSX, so `columns={['name','amount']}` —
  the spelling every JSX author and every AI author writes by habit — compiled to
  the deferred `{ $expr }` marker that nothing downstream evaluates, and the
  author's whole data binding vanished at render. A production page's `list-view`
  rendered its row count and toolbar with zero data columns through eight
  `columns` spellings before the author gave up (objectui#6598, moved from
  objectstack#12649). That was a trap, not a contract.
  
  `interpretBrace` now materializes the JS **literal subset**. Exactly two
  widenings over JSON, and nothing else:
  
  1. **single-quoted strings**, in value position and in key position —
     `title={'Accounts'}`, `columns={['name','amount']}`, `{{'pageSize': 25}}`;
  2. **unquoted identifier object keys** — `options={{pageSize: 25}}`,
     `columns={[{field:'name',label:'Full Name'}]}`.
  
  Everything else JSON refuses is still refused, still compiles to `{ $expr }`,
  and still draws the warning-severity `inert-expression` diagnostic: trailing
  commas, comments, array holes, spreads, `undefined`/`NaN`/`Infinity`,
  `+1`/`.5`/`1.`/`0x1f`, template literals, and every genuine expression —
  identifiers, member access, calls, operators, ternaries. The subset contains no
  identifier lookup and no operator, so there is nothing in it to execute: this
  moves habitual spellings onto the materialized side, it does not move the
  boundary between data and code. An authored `__proto__` key becomes an ordinary
  own property, as `JSON.parse` gives it — never the prototype setter.
  
  Strict JSON is unchanged, structurally: `JSON.parse` still runs first and
  untouched, so any value it accepts takes byte-identically the path it always
  did, and the literal reader only ever sees input `JSON.parse` has already
  thrown on.
  
  The `inert-expression` message changed with the grammar. It used to advise
  "write it as JSON (double-quoted strings and keys)" and named
  `columns={['name','amount']}` as the wrong form — advice that would now send an
  author to edit working source. It names the accepted literal grammar instead.
  
  Maintainer ruling of 2026-08-28 (objectui#6614 Q1-A). ⛔ Two ruled items are
  deliberately NOT in this change: escalating `inert-expression` from warning to
  error (Q2 — it belongs at the save gate, once the framework wires the registry
  manifest into `validate-jsx-pages`), and base-prop (`style`) `$expr` inertness
  (Q3 — sequenced after this, so no warning is added for spellings this change
  legalises).
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
- 9e37d9b: `binding` on a component input is framework-set, not author-declared: `@object-ui/types` gains `InjectedComponentInput`, the `'field'` binding arm is retired from `@object-ui/sdui-parser`'s `RegistryConfigLike`, and the `as ComponentMeta` cast at the injection seam in `@object-ui/core` is gone (maintainer ruling of 2026-09-07, director decision batch #69; ADR-0049 enforce-or-remove).
  
  **What was measured.** `binding` was published — the manifest serializer forwards it — and read — `validateTree` records a binding site for it — while `ComponentInput`, the authoring type every registration writes against, did not declare it. The one writer in the tree, `ELEMENT_DATA_SOURCE_INPUT`, therefore carried a hand-written inline type and reached a registration's `inputs` through `as ComponentMeta` in `Registry.register`. Declared narrower than enforced, on a published type — and `ComponentInput`'s own docblock listed `binding` among the forwarded per-input keys.
  
  **The ruling** answered the product question the card asked — may an ordinary registration declare a binding input? — with no. So:
  
  - **`@object-ui/types`** exports `InjectedComponentInput`, an `interface … extends ComponentInput` with the required marker `binding: 'object'`. `ComponentInput` itself does not change: no member is added, and authoring `binding` on a registration stays an excess-property `tsc` error — now on purpose and documented at the interface. The two tombstone docblocks that listed `binding` as a forwarded key now say it is forwarded from the framework's injected input, not authored.
  - **`@object-ui/core`** types `ELEMENT_DATA_SOURCE_INPUT` as `InjectedComponentInput` and splices it through a typed local; the cast is gone. Runtime behaviour is unchanged — the same key, `type`, `binding` and `description` reach the manifest, and `validateTree` still records the binding site.
  - **`@object-ui/sdui-parser`** narrows `RegistryConfigLike.inputs[].binding` from `'object' | 'field'` to `'object'`. The `'field'` arm had zero writers — every `binding:` literal in `packages/`, `apps/` and `examples/` is `'object'`, 7 of 7 at this change's merge-base — and nothing on either side of the manifest resolved a field binding. **Breaking, deliberately:** a config that feeds `manifestFromConfigs` a `binding: 'field'` input is now a type error instead of a manifest entry the server would never resolve. `ManifestInput.binding`, the manifest reader's vocabulary, is not narrowed by this change.
  
  If a real need for author-declared bindings is ever measured, it is filed as a widening of `ComponentInput` with the vocabulary decided then — not by putting the cast back.
- 492bbd8: Refuse an authored `type=` attribute on the `kind:'html'` tier (objectui#7235 — the
  port of objectstack#13957, maintainer ruling 2026-09-01, recorded as an append-only
  amendment on ADR-0080).
  
  **Breaking, deliberately, and the direction is a narrowing.** On this tier the tag
  name *is* the node's `type`, so an authored `type=` attribute is a name collision
  with the envelope's own discriminator. It is now one `forbidden-attr` error naming
  both the tag and the attribute, and the node is composed as `{ ...props, type: tag }`
  so the tag always wins the slot.
  
  Two outcomes it replaces, the first of which produced no diagnostic at all:
  
  - the value named another **registered** type (`<flex type="grid">`) — the tree
    carried `type:'grid'`, the manifest resolved it, every check passed, and a grid
    rendered where the author wrote a flex. Zero diagnostics.
  - the value named **nothing registered** (`<object-chart type="bar">`) — loud, but
    `unknown-component` naming `"bar"` read as a missing plugin rather than as an
    attribute that should not be there.
  
  The existing `forbidden-attr` code is reused rather than a new one minted: the two
  copies of this parser (this one, which the renderer and the console's live edit
  preview run, and objectstack's, which the save gate runs) are held to one diagnostic
  vocabulary by `check:sdui-lockstep`, and a code minted on one side only is the dialect
  split that gate exists to catch.
  
  ⚠️ Not carried over: the react tier's `specType` rescue (objectui#2880). The ruling
  declined it by name; that rescue stays where it lives.
  
  One visible non-behavioural consequence of the reversed spread: a compiled node's
  `type` key is now **last** rather than first in insertion order, so `JSON.stringify`
  of a parsed tree emits the same pairs in a different order. The key set, every value,
  the children and the html-tier provenance marker are unchanged.
- cf1d29e: `ComponentInput.of` — the coarse kind of an input's MEMBERS, with readers on day one
  (objectui#8067).
  
  A registration's `type: 'array'` said a value was a list and stopped there, so a member
  that drifted from `@objectstack/spec` was invisible to every layer that reads a
  declaration. `page:header.actions` is the measured cost: the contract declares
  `z.array(z.string())` ("Action IDs"), the renderer read the members as `ActionDef`
  objects, and the repo-wide parity gate in
  `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` stayed green for the
  whole life of the drift because both sides carried the key and neither could say what
  was inside it. What settled it was a maintainer ruling, not a test — and even after the
  fix, "these are ids" survived only as English in the registration's `description`.
  
  **What is new.** `ComponentInput` gains an optional `of`, carrying the same coarse-kind
  vocabulary as `type` one level down: the ELEMENTS of an `array`, or the VALUES of an
  `object` used as a map. One kind, or an array of them for a member contract that is a
  union, with `type`'s semantics — a member passes when any declared arm accepts it. The
  manifest serializer forwards it, so `sdui.manifest.json` now carries seven keys per
  input instead of six.
  
  **Three readers ship with it**, which was the bar this slot had to clear (objectui#5905
  is the precedent: five `ComponentInput` keys declared and read by nothing). The
  repo-wide parity gate compares every declared `of` against the member kind
  `ComponentPropsMap[type]` actually accepts and fails on one the contract refuses;
  `sdui-parser`'s `validateTree` reports a member that fits no declared kind, as a new
  `member-type-mismatch` diagnostic naming the offending positions; and the generated
  `sdui-intrinsics.d.ts` narrows the authoring type — `page:header`'s `actions` is
  `string[]` where it used to be `unknown[]`.
  
  **Fifteen keys now declare one**, across ten blocks, each DERIVED rather than chosen:
  every container key's member position was probed with one value of each coarse kind and
  a declaration written only where exactly one kind was accepted. A member contract that
  admits several kinds — `record:highlights.fields` takes a field name or an inline field
  object — is deliberately left undeclared and pinned with its reason, because picking one
  arm there is a narrowing this repo leaves un-gated and picking all of them would
  advertise shapes only a per-block pin can vouch for.
  
  **The ceiling is unchanged.** `of` is a KIND and never a value domain, so the maintainer
  ruling of 2026-08-17 quoted on `ComponentInput.type` — the coarse arm plus `description`
  is the publication face's expression ceiling, and spec is the sole judge of values —
  stands exactly as written. `of: 'object'` says the members are objects; which keys they
  carry is still `description`'s job and `os validate`'s.
  
  **Nothing published before this changes.** An input that declares no `of` validates,
  serializes and types byte-identically: `validateTree` checks no member, the serializer
  emits no key, and the codegen emits the same `unknown[]`.
- 80cb063: html tier: name the inert `quickAdd` on `object-kanban` / `kanban` instead of calling it unknown
  
  The Quick Add control is gated on BOTH `quickAdd` and an `onQuickAdd` handler, and
  `onQuickAdd` takes a function, which no parsed page can write and which `ObjectKanban`
  supplies none of its own for. objectui#11234 retires `onQuickAdd` on `object-kanban` in the
  same release; it remains a host-supplied prop on `KanbanRenderer`'s `schema`. So an authored
  `quickAdd: true` on either
  `ObjectKanbanRenderer` tag has never produced a control.
  
  Until now the only thing the tier said about it was `unknown-prop`, "has no prop
  quickAdd" — false against `@objectstack/spec`, which publishes the key, and
  indistinguishable from a typo. It now draws an `inert-quick-add` **warning** that names
  the missing half of the pair and points at `kanban-ui`, where a React host can supply
  the function. Severity is unchanged (warning, as `unknown-prop` was), so no page that
  saves today stops saving.
  
  New exports: `checkKanbanQuickAdd`, `INERT_QUICK_ADD`, `QUICK_ADD_HOST_TYPES`,
  `QUICK_ADD_KEY`.
  
  Interim by ruling (objectui#8285, decision batch #91): the contract-side refusal is
  retiring `object-kanban.quickAdd` from the spec's `ComponentPropsMap`, and this
  diagnostic is removed by the change that lands it. `kanban-ui` keeps the
  `quickAdd` / `onQuickAdd` pair untouched.
  
  ⚠️ **Dated note, 2026-09-29 — the contract moved in this same release — objectui#11073.**
  The reason given above, that "has no prop quickAdd" was false because `@objectstack/spec` publishes the key, no longer holds. Later in this release this repository began resolving `@objectstack/spec` 17.5.0, which carries the retirement this diagnostic was declared interim for: `object-kanban.quickAdd` is now a spec tombstone, refused by name at the authoring door. The diagnostic's own removal belongs to the change that ruled it and is not made here. Until then, the key it names is one the contract itself refuses.
- 6f864cf: **BREAKING** — `quickAdd` is retired on `object-kanban` (objectui#8285, ruling B of
  the director seat's decision batch #91: the board does not grow an inline
  record-creation write path). This is objectui's half; `@objectstack/spec` 17.5.0
  already tombstones the same key in `ComponentPropsMap['object-kanban']`.
  
  **Why it never did anything.** The Quick Add control is gated on BOTH `quickAdd`
  and an `onQuickAdd` handler. `onQuickAdd` is a host-supplied function that no JSON
  document can carry, and `ObjectKanban` supplies none of its own, so an authored
  `quickAdd: true` parsed green and drew nothing.
  
  - **`@object-ui/types`** — `ObjectKanbanSchema.quickAdd` is `?: never` on the
    TypeScript face and a `retirementTombstone()` on the zod mirror: an authored
    value is refused BY NAME (`invalid_type` at `quickAdd`, carrying the remedy), not
    stripped. A tombstone rather than a deletion, because `BaseSchema` ends
    `.passthrough()` and a deleted member would be kept silently.
  - **`@object-ui/plugin-kanban`** — `ObjectKanban` no longer forwards `quickAdd` to
    the board, on every `object-kanban` entry point (the registered tag, the
    `kanbanComponents` map, a host mounting `ObjectKanban`). So even a document that
    carries both halves of the pair draws no control. `KanbanRenderer` is unchanged:
    a React host that mounts it directly still passes `quickAdd` and `onQuickAdd` on
    its `schema` and gets the control.
  - **`@object-ui/sdui-parser`** — the interim `inert-quick-add` warning is removed,
    with its four exports `checkKanbanQuickAdd`, `INERT_QUICK_ADD`,
    `QUICK_ADD_HOST_TYPES` and `QUICK_ADD_KEY`. It was declared interim until the
    spec refused the key by name; that has landed, and with the key retired on every
    face the tier's own `unknown-prop` warning ("has no prop quickAdd") is true and
    is the whole remedy on a constrained-JSX page, which cannot write the handler
    anyway. Severity is unchanged (warning), so no page that saves today stops saving.
  
  **Migration.** Delete `quickAdd` from `object-kanban` nodes; it never drew a
  control there. To offer Quick Add, mount `KanbanRenderer` from
  `@object-ui/plugin-kanban` in a React host and pass both `quickAdd` and
  `onQuickAdd` on its `schema`. Code that switched on the `inert-quick-add`
  diagnostic code, or imported one of the four removed names, drops that branch:
  the key now draws `unknown-prop` like any other prop the block does not have.
  
  `ObjectKanbanSchema.onQuickAdd` is retired on `object-kanban` too, by objectui#11234
  in the same release: on that element it was never called, because its partner is
  gone. The Quick Add pair on `KanbanRenderer` is unchanged.
- 483b794: Retire the `binding: 'field'` arm on the manifest READER and PRODUCER faces, so
  `@object-ui/sdui-parser` states one vocabulary instead of two (objectui#8315).
  
  The 2026-09-07 maintainer ruling that `9e37d9b39` landed (director decision batch #69)
  retired the zero-writer `'field'` arm under ADR-0049 enforce-or-remove, naming
  **one** coordinate: `RegistryConfigLike.inputs[].binding`, the serializer's input
  boundary, which PR #8297 narrowed. Two declarations in `types.ts` kept the arm, so
  the published package narrowed on one face and stayed wide on the other:
  
  - `ManifestInput.binding` — now `'object'`
  - `ManifestValidationResult.bindings[].kind` — now `'object'`
  
  **Breaking for TypeScript consumers, deliberately, and compile-time only.** A
  hand-written `Manifest` literal or a `bindings[]` entry that spells `'field'` is now
  a `tsc` error. Runtime behaviour is unchanged: types are erased, this package has no
  runtime validator for a manifest it is handed, and `validateTree` still forwards
  whatever a manifest says — a pin in
  `src/__tests__/injected-component-input-6950.test.ts` states that limit so the
  narrowing is not mistaken for a runtime rejection.
  
  **Migration.** Nothing measured has to change. `binding: 'field'` has zero writers in
  this repo and zero in the objectstack copy of this package (measured 2026-09-09 on
  both heads, each with a firing `binding: 'object'` control), and the only manifest
  producer in either tree is `manifestFromConfigs`, whose input face was already narrow.
  Every `binding: 'field'` spelling left under `packages/`, `apps/` and `examples/` is
  an `@ts-expect-error` negative pin asserting the refusal, or a docblock mention of
  the retirement — not a writer.
  
  **Why not leave the reader face wide.** The counter-argument — producer → reader is a
  subset relation, so a permissive reader is not wrong — was answered rather than assumed
  away. `ManifestInput` is not a pure reader face (`manifestFromConfigs` returns it), and
  `bindings[].kind` is a pure **producer** face where the relation inverts: a wider union
  there accepts nothing extra, it obliges every consumer to handle an arm this package
  cannot emit. The two are coupled by `validateTree`'s `kind: input.binding` assignment,
  so narrowing one alone would need a cast at the only conversion site — the lenient
  fallback AGENTS.md #0.1 bans. The reasoning now lives on the declarations themselves,
  where a later reader lands. The reopen route is the ruling's own: a measured need for
  field bindings is filed as a widening with the vocabulary decided then.
- adf5812: Four node type keys retire, and the kanban and gantt families converge on their
  `object-*` spellings: `kanban` (objectui#8802), `kanban-ui` and `kanban-enhanced`
  (objectui#8257), and `gantt` (objectui#8008). All four were ruled by the
  maintainer in one batch on 2026-09-09.
  
  **⛔ No stored document moves.** The strings `kanban` and `gantt` name two
  different things at two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` | `"kanban"`, `"gantt"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `kanban`, `gantt` | hand-authored JSON | **yes** |
  
  `ObjectView`'s `switch (viewType)` maps a stored view type onto the node type it
  renders, and it already emitted `object-kanban` and `object-gantt` — as it does
  for all twelve stored view types. So every kanban and gantt view any user ever
  created through the console already renders through the surviving spelling.
  Nothing in a tenant database changes, and ⛔ nothing should be migrated there.
  
  **What each retirement was, measured.** Three of the four were
  registration-only: no schema face in `@object-ui/types` ever declared
  `kanban-ui`, `kanban-enhanced` or `gantt` as a component node type, so
  unregistering is the whole retirement. The bare `kanban` key was the exception —
  it had a declared arm on both faces (`KanbanSchema` in `complex.ts` and its Zod
  mirror), and a plain deletion there would have been the objectui#7664 failure:
  `BaseSchema` is `.passthrough()`, so a document naming a dropped key validates
  green and renders nothing. It therefore retires as a **named refusal**: the Zod
  union keeps an arm claiming the literal and answers a `{ "type": "kanban" }`
  document with a message naming `object-kanban` as the remedy, while the
  TypeScript half is the absence of the arm from `ComplexSchema` and of the key
  from `SchemaRegistry`, so `tsc` refuses it at the authoring site.
  
  **⭐ This closes objectui#8818's `objectFields` hole — for that ENTRY, not for
  the class.** `SchemaRenderer` strips a fixed enumerated metadata list and
  spreads the rest as React props; `objectFields` is not on that list, and
  `KanbanRenderer` — the component the `kanban-ui` key resolved to — declares
  `objectFields` as a real prop, so an authored value reached the predicate layer
  with no schema face judging it. With the registration gone, no authored node
  reaches that component through the registry. ⚠️ The **class** is still open: the
  hole returns the moment another registered renderer declares an `objectFields`
  prop. objectui#8818's option (a) — stripping at the `SchemaRenderer` boundary —
  is what would close the class.
  
  Superseded in this release by objectui#8818: option (a) landed, so the class
  is closed as well. `objectFields` is now on `SchemaRenderer`'s stripped-metadata
  list, and the legacy `props` alias bag drops it too, so an authored
  `objectFields` reaches no component prop on any type key. The paragraph above
  describes the tree this entry was written against.
  
  **⚠️ What the `kanban` arm took with it, stated because it is the cost of this
  change.** That arm was the only schema face that ever declared `columns`,
  `cardTitle`, `swimlaneField`, `grouping` and `navigation`, the only one that
  refused `allowCollapse` / `cardTemplates` / `columnWidths` / `titleField` /
  `draggable` / `onColumnAdd` / `onCardAdd` by name, and — through
  `columns: KanbanColumn[]` — the only one that judged a lane's `cards`
  (`240b80f31`).
  
  ⭐ **The sentence that stood here — «The surviving `ObjectKanbanSchema` face
  declares none of them» — is retired, and the two reasons it failed are DIFFERENT
  defects (objectui#9713).** It is replaced by a dated reading rather than silently
  overwritten, because half of it was true when written and erasing that would be a
  false record of its own:
  
  | key named just above | on `ObjectKanbanSchema` when this entry was written (`adf581278`, 2026-09-10) | on `main`, 2026-09-17 | what moved |
  | --- | --- | --- | --- |
  | `columns` | not declared | **declared** | objectui#8913 (PR objectui#8989), six hours after this entry was written |
  | `cardTitle` | not declared | **declared** | objectui#9606 (PR objectui#9709) |
  | `titleField` | **declared** | **declared** | nothing — the sentence was never true of this key |
  | `allowCollapse` | **declared**, a live `z.boolean().optional()` | **declared**, as a `retirementTombstone()` | objectui#8801 retired it; it was declared on this face throughout |
  | `swimlaneField`, `grouping`, `navigation`, `cardTemplates`, `columnWidths`, `draggable`, `onColumnAdd`, `onCardAdd`, and a lane's `cards` | not declared | not declared | nothing |
  
  ⇒ For `columns` and `cardTitle` the claim **ROTTED**: it was true on 2026-09-10 and
  was falsified afterwards by cards that had no reason to read this file. For
  `titleField` and `allowCollapse` it was **BORN FALSE**: those two are named above as
  keys the `kanban` arm refused BY NAME — which the surviving face indeed does not do
  — but the surviving face declared both of them the whole time, and «declares none of
  them» said otherwise. ⛔ Do not restate any of this in the present tense: a pending
  entry publishes verbatim into the CHANGELOG, and an undated present-tense claim
  about another file is the construction that failed here.
  
  ⛔ Nothing about an `object-kanban` document changes: it was never judged by the
  `kanban` arm, so all of those keys have always ridden `BaseSchema`'s index
  signature there. What is gone is the `kanban` document that had them. Declaring
  them on `ObjectKanbanSchema` would WIDEN a published accept set, which is a
  maintainer ruling and not part of this one; every one of these readings is
  pinned where it can be seen rather than left to be rediscovered.
  
  **Migrating.** Replace `"type": "kanban"` with `"type": "object-kanban"` and
  `"type": "gantt"` with `"type": "object-gantt"` in hand-authored documents. The
  `object-kanban` face requires `groupBy` and one of `bind` / `data` /
  `objectName`; a purely static board (lanes carrying their own cards, no record
  source) adds `"groupBy"` and `"data": []`. `kanban-ui` and `kanban-enhanced`
  have no authored documents anywhere in this repository to migrate.
  
  **⚠️ The namespaced spellings retire with the registrations — `view:kanban` and
  `view:gantt` are the same two keys.** `ComponentRegistry.register(type, C,
  { namespace })` stores BOTH `namespace:type` and a bare-`type` fallback, so
  every one of these keys had a namespaced twin that goes with it:
  
  | retired spelling | namespaced twin | author instead |
  | --- | --- | --- |
  | `kanban` | `view:kanban` | `object-kanban` |
  | `gantt` | `view:gantt` | `object-gantt` |
  | `kanban-ui` | `plugin-kanban:kanban-ui` | `object-kanban` |
  | `kanban-enhanced` | `plugin-kanban:kanban-enhanced` | `object-kanban` |
  
  Both spellings are pinned as gone, each against a firing control on the
  surviving key, in `plugin-kanban/src/__tests__/kanban-family-registry-keys-retired-8257.test.ts`
  and `plugin-gantt/src/__tests__/bare-gantt-node-key-retired-8008.test.ts`.
  
  **What an unmigrated `view:kanban` / `view:gantt` node now renders depends on
  the host.** In `apps/console` it renders the protocol **placeholder** panel, not
  the OBJUI-001 "Unknown component type" error: the console calls the opt-in
  `registerPlaceholders()` (`@object-ui/components`, `renderers/placeholders.tsx`)
  *after* its plugin registrations, `view:kanban` and `view:gantt` are both in
  that file's `PROTOCOL_COMPONENTS` list, and the placeholder only claims a key
  nothing else has taken — which, until this change, `@object-ui/plugin-kanban`
  and `@object-ui/plugin-gantt` had. In every other host, which does not call that
  bootstrap, the same node renders OBJUI-001.
  
  **⚠️ `objectui check` will NOT flag either namespaced spelling.** The CLI's
  `known-schema-types.ts` is generated from the repository's real registration
  calls, and the placeholder registration is a real one — so `view:kanban` and
  `view:gantt` are still on that list and still validate green, while the node
  renders a placeholder rather than a board. The bare `kanban` / `gantt` entries
  DID leave the generated list; only the namespaced pair survives, and only
  because of the placeholder. Grep your documents for the namespaced spellings
  directly; do not rely on `objectui check` to find them.
  
  `KanbanRenderer` is still exported from this package's entry point
  (`@object-ui/plugin-kanban`); only its registry key is gone. ⚠️ `KanbanEnhanced`
  is a different case, and the earlier draft of this note stated it wrongly: this
  package's `exports` map has exactly two entries — `.` and `./style.css` — and
  the barrel never re-exported the component, so
  `@object-ui/plugin-kanban/KanbanEnhanced` has never been a resolvable specifier
  for a consumer. At this change, with `kanban-enhanced` unregistered,
  `KanbanEnhanced.tsx` had zero non-test importers, and the file was deliberately
  left in place: deleting published-but-unreachable source is a further narrowing
  and needed its own maintainer ruling, which this change did not have.
  
  ⚠️ **Dated note, 2026-09-25 — that ruling came, and the file has since been
  deleted — objectui#8932.** Later in this same release
  `packages/plugin-kanban/src/KanbanEnhanced.tsx` was deleted, and with it the
  `dist/KanbanEnhanced.d.ts` typings this package shipped for it. The rest of this
  entry is kept as the reading of this change; the objectui#8932 entry states what
  ships.
  
  **⚠️ `@object-ui/sdui-parser`: `QUICK_ADD_HOST_TYPES` loses `kanban` with the
  registration.** The `inert-quick-add` diagnostic (objectui#8285) named the two
  tags `ObjectKanbanRenderer` answered to; one of them retires here, so the set is
  now `{ 'object-kanban' }`. ⛔ Nothing is silently dropped by that narrowing, and
  this is measured rather than argued: `checkKanbanQuickAdd` has exactly one call
  site — `validate.ts`'s per-prop walk — and that walk runs only in the branch
  where the manifest RESOLVED the tag. A tag no registration produces is answered
  one level up by `unknown-component`, an **error**, and its props are never
  walked, so on a manifest built from the live registry a `<kanban quickAdd>` node
  draws `error/unknown-component` and nothing else, against a firing control on
  `<object-kanban quickAdd>` that still draws `warning/inert-quick-add`. Keeping
  `kanban` in the set would have been reachable only through a hand-built manifest
  declaring a component of that name — which, after this retirement, is somebody
  else's component, and the message asserts things about `ObjectKanban` that would
  be false of it. This supersedes the `kanban` half of the objectui#8285 entry.
  
  **The diagnostic's remedy text moves from a tag to a component.** It used to end
  "render `<kanban-ui>` from a React host that passes `onQuickAdd`". That sentence
  is falsified by this change: `kanban-ui` is no longer a node type key, so a page
  written to the old advice draws `unknown-component`. It now names
  `KanbanRenderer` from `@object-ui/plugin-kanban` — still exported, still
  forwarding both halves by identity — which is the surviving way to get the pair.
  `content/docs/plugins/plugin-kanban.mdx` says the same thing the same way.
- 5ea623e: fix(sdui-parser,components,layout,types): containment is the declared `children` slot, not `isContainer` (objectui#9910)
  
  `validateTree`'s `not-a-container` diagnostic now reads exactly one declaration:
  an input named `children` in the component's registration `inputs`. Ten
  registrations already carried such an input — `slot`-typed on `tooltip` and the
  four `page:*` containers, `array`-typed on the five page kinds — and the
  predicate reads the NAME, so both count. `isContainer` is no longer
  consulted and is not a fallback — new exports `acceptsChildren` and
  `CHILD_LIST_KEY` in `@object-ui/sdui-parser` spell the predicate, and the
  retired `body` dialect follows the same reading.
  
  Why: the flag was hand-kept and drifted from the renderers four times; after
  objectui#6771 converged a dozen `schema.body` readers onto `children`, and with
  objectui#6804 ruling the flag OFF for that population (it means layout
  containment, and declaring it deletes a public tag from every react page's JSX
  scope), the diagnostic landed FALSE on the one key `button`, `badge`, `alert`
  and the `sidebar-*` parts render. The maintainer ruled declare-and-pin
  (2026-09-24).
  
  What is declared: every renderer under `@object-ui/components` and
  `@object-ui/layout` that puts `schema.children` on the page — 65 registrations
  measured bare plus `sidebar` and `sidebar-menu-button` in their provider
  context — now declares the `children` slot; the 34 flow/inline HTML tags, the
  seven sectioning tags, the layout primitives, `button` / `badge` / `alert` /
  `toggle` (label and description fallbacks), `span` (read ahead of `value`),
  `div`, `form`, `scroll-area`, the ten `sidebar-*` parts and `page-header`. Nine public blocks
  gain the slot in `sdui.manifest.json`; a `slot` input emits no JSX attribute, so
  the generated `.d.ts` is unchanged. `isContainer` is kept everywhere it was
  declared and re-described on every published face (`ComponentMeta`,
  `RuntimeWidgetManifest`, `ComponentMetaSchema`, the manifest types) as LAYOUT
  containment — the react-page scope builder keeps reading it unchanged.
  
  The runtime containment census is re-pointed from the flag to the input in both
  directions (declared ⇔ actually renders, with named context probes for the
  provider-scoped and portal renderers), `scripts/container-declaration-baseline.json`
  is at zero, and a registration that is a layout container but renders no
  authored list (`page:tabs`, `page:accordion`, `responsive-grid`) now draws the
  TRUE `not-a-container` the flag used to silence.
  
  ⚠️ **Dated note, 2026-10-02 — `page-header` is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2c) unregistered `@object-ui/layout`'s
  `page-header` (and `layout:page-header`), so its `children` slot declaration left with it; authors write
  `page:header`. The rest of this entry is kept as the reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — `responsive-grid` is retired — objectui#11441.**
  Later in this same release objectui#11441 unregistered `@object-ui/layout`'s `responsive-grid` (and
  `layout:responsive-grid`), so it no longer draws `not-a-container`: a node written with it renders the "Unknown
  component type" panel. Authors write `grid` with a breakpoint `columns` object. The rest of this entry is kept as the
  reading of this change.
  
  ⚠️ **Dated note, 2026-10-02 — the ten `sidebar-*` parts are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 (phase 2d) unregistered the ten `sidebar-*` parts, so their
  `children` slot declarations left with them. `sidebar` keeps its declaration, and it now mounts its own provider
  when none is above it, so the containment census measures it bare and its provider-scoped context probe is
  gone, as is `sidebar-menu-button`'s. The rest of this entry is kept as the reading of this change.
- 8d58f46: `validateTree` now reports a dashboard widget `options` key that no renderer
  consumes as a `unconsumed-widget-option` **warning** naming the consumed set
  (maintainer ruling 2026-08-23). The census behind the accepted set — the spec's five
  declared query keys (`dateGranularity`, `sortBy`, `sortOrder`, `limit`,
  `stageOrder`) plus the `description` sub-caption convention key — is
  re-measured on every test run against `@objectstack/spec` and the
  `plugin-dashboard` renderer sources. The check fires only on dataset-bound
  shorthand widgets (the spec-legal form) hosted by `dashboard` /
  `dashboard-grid` nodes, and honours the spec's per-widget
  `suppressWarnings: ['unconsumed-widget-option']` escape hatch. Warning
  severity only: documents keep parsing, saving and rendering. Exported for
  other surfaces: `checkDashboardWidgetOptions`, `CONSUMED_WIDGET_OPTION_KEYS`,
  `DASHBOARD_WIDGET_HOST_TYPES`, `UNCONSUMED_WIDGET_OPTION`.

### Patch Changes

- 39b8d51: feat(components): `div` is deprecated on the html tier too — a `kind:'html'` page that authors `<div>` is refused at compile time, and the error names `box`
  
  Executes the maintainer's ruling A on objectstack#20112 ("`div` stays
  deprecated") in the renderer. Until now the published manifest left `div` out of
  the html tier, so `os validate` refused a `<div>` page as `forbidden-tag`, while
  the console compiled and rendered the same page. `div`'s registration declared
  the deprecation for the JSON surface only, and its renderer exempted nodes the
  html parser emitted (objectui#4000).
  
  **What moves for a consumer.**
  
  - **BREAKING (authoring): a `kind:'html'` (or legacy `kind:'jsx'`) page that
    authors `<div>` or `<ui:div>` no longer renders.** The html compile fails, and
    like every compile error this fails the whole page: the console shows the
    "HTML page failed to compile" panel. Each refusal is the parser's
    `forbidden-tag` sentence, followed by the declared replacement guidance, which
    names `box`. Migration: retype `<div>` to `<box>`. `box` renders the same
    element with the same `className` and no layout of its own.
  - `div`'s registration now declares `deprecated.surfaces: ['json', 'html']`, so
    `ComponentRegistry.deprecationFor('div', 'html')` answers the declaration
    (with the unchanged `replacement`) instead of `undefined`. The html compile
    derives what it refuses from `deprecationFor(type, 'html')`, the registration's
    declaration, rather than from a list of tag names.
  - The `div` renderer no longer exempts nodes carrying html-tier provenance, and
    its dev-build notice now says it applies to JSON-authored nodes and html pages
    alike. The migration bullets are unchanged.
  - `span` is unchanged: it is still deprecated on the JSON surface only, and it
    still compiles on html pages.
  
  Semver: `minor`, not `major`, per this repository's version-alignment rule. The
  breaking semantics are stated above.
  
  **Published declaration text (prose only, no behaviour change).**
  
  - `@object-ui/core`: the emitted `dist/registry/Registry.d.ts` carries the
    rewritten `ComponentDeprecation` and `deprecationFor` docblocks, where `span` is
    now the worked example of a json-only deprecation and `div` is stated to name
    both surfaces. `dist/registry/html-tier-intrinsics.d.ts` carries the rewritten
    `HTML_TIER_INTRINSICS` docblock: its `div` bullet and the sentence describing the
    console's html-tier whitelist.
  - `@object-ui/sdui-parser`: the emitted `dist/provenance.d.ts` carries the
    rewritten file-header sentence, where `span` is now the example of a tag that
    stays html-tier vocabulary.
- 99878d8: `validateTree` no longer calls a declared `bind` or `hidden` unknown (objectui#11008).
  
  `BaseSchema` declares `bind` and `hidden` for every node, and no registration declares either as an input. `validateTree`'s base-prop set held neither, so its undeclared-key branch answered every authored one with an `unknown-prop` warning (`has no prop "bind"`), including on the nodes that honour it: `list`, `tree-view` and the `object-*` widgets read `bind` through `useDataScope`, and `SchemaRenderer` reads `hidden` for every node. Both are now base props of the parser tier, so neither draws a diagnostic on any node. A near-miss spelling such as `bindTo` still draws `unknown-prop`.
  
  The cost is named rather than hidden. `data-table` does not read `bind` (objectui#6575), and a `bind` on it now draws nothing at the parser tier either. Its render-time console warning (`[ObjectUI] DataTable bind:`) is the one signal left. The `BaseSchema.bind` docblock, which ships in the emitted `.d.ts`, said that the console warning and the parser tier's `unknown-prop` both named such a `bind`. It now names the console warning as the one signal and says the parser tier is silent. That supersedes the wording the objectui#10981 entry describes for the same docblock: the parser half it names held until this change.
  
  At this change, `placeholder` is also a `BaseSchema` member that `validateTree` does not count as a base prop, and it is left as it was. Some registrations declare it as a typed input, and a base prop skipped the declared-input lookup, so adding it would have silenced their `type-mismatch`.
  
  ⚠️ **Dated note, 2026-09-29 — `placeholder` has since become a base prop where a type does not declare it — objectui#11044.** Later in this same release, `placeholder`, `name`, `label`, `description`, `data` and `ariaLabel` join the base props as `where-undeclared` members: each is a base prop only on a type that declares no input of that name. Where a type declares one, the declared input wins and keeps its `type-mismatch`, so no declared type check is silenced. The paragraph above is kept as the reading of this change; the objectui#11044 entry states what ships.
- faf5269: A dataset-bound KPI tile now renders the sub-caption its author declared in
  `options.description` (objectui#7293).
  
  The sub-caption slot was wired end to end and consumed by nothing. It has its own
  translation key (`{ns}.dashboards.{dash}.widgets.{id}.subCaption`), the server's
  `translateDashboard` overlays that translation onto `options.description`, and
  `DashboardRenderer`'s `tWidgetSubCaption` resolves it — but only onto the two
  inline arms of `getComponentSchema()`. `dataset` is REQUIRED on
  `DashboardWidgetSchema` (published `@objectstack/spec@17.4.0`: the required keys
  are exactly `id` / `dataset` / `values`), so every spec-legal widget renders
  through `DatasetWidget` instead, which read the key nowhere. Every author who
  wrote a sub-caption got silence.
  
  `DatasetWidget`'s metric branch now reads the key and renders it in the caption
  row, resolving it through the same `pickLocalized` seam every other authored
  label channel uses, so an inline per-locale map resolves instead of being
  dropped. A tile that declares no sub-caption renders byte-identical markup.
  
  Read in `DatasetWidget` rather than passed down as a prop on purpose: both
  dashboard surfaces (`DashboardRenderer` and `DashboardGridLayout`) route a
  dataset-bound widget to that one component, so a prop from one dispatch site
  would have fixed one surface and left the other unchanged.
  
  `@object-ui/sdui-parser` carries no behaviour change — its `unconsumed-widget-option`
  census recorded `description` as accepted *despite* having no read site on the
  dataset-bound path, and that note is now stale prose.
- 0b1326d: Documentation no longer teaches the "JSX/HTML + Tailwind" framing for a page's
  `source`, which ADR-0080's own 2026-06-30 header amendment (under ADR-0065,
  Accepted) retracted. objectui#5461 corrected three sites; a multiline census
  found eight more, in three spellings a line-oriented grep could not see.
  
  A page's `source` is *runtime metadata*. The console's Tailwind is compiled at
  build time by scanning the console's own `src`, and there is no safelist, so it
  never sees your page: an authored utility class produces CSS only by coincidence
  (when objectui already ships that exact class) and otherwise produces nothing,
  with no error anywhere. That is the ADR-0065 "works only by coincidence" failure
  mode, and it is how a modal's `bg-black/50` backdrop reached production fully
  transparent. `os validate` reports it as `page-source-className-tailwind`, a
  warning on kinds `html`, `react` and `jsx`, shipped in `@objectstack/lint@11.5.0`.
  
  The tiers themselves are unchanged and every load-bearing claim survives —
  parse-never-execute, the untrusted-author safety argument for `html`, and the
  deprecated `'jsx'` alias. Only the styling primitive is corrected, to the wording
  `content/docs/guide/react-pages.md` §Styling already uses:
  
  | `kind` | Style with |
  |---|---|
  | `"html"` | The blocks' own structured props (`` `<flex direction gap>` ``, `` `<grid columns>` ``) plus a JSON `style` object. |
  | `"react"` | Inline `style` objects. |
  
  Colors on both tiers come from the theme as `hsl(var(--token))`.
  
  Why each package has an entry — each was measured against its built artefact, not
  assumed:
  
  - **`@object-ui/react-runtime`**: `README.md` is published to npm (npm includes
    `README.md` in the tarball regardless of `files`). Its "no sandbox" callout is
    the paragraph that routes untrusted-author work to the `html` tier, and it
    carried the retracted framing line-wrapped across `:17-18`. It also gains the
    §Styling section it was missing — the absence is why the framing survived here.
  - **`@object-ui/sdui-parser`**: the corrected header of `src/types.ts` projects
    verbatim into the published `dist/types.d.ts`.
  - **`@object-ui/components`**: the corrected header of
    `src/renderers/basic/html-elements.tsx` projects verbatim into the published
    `dist/renderers/basic/html-elements.d.ts`. The `kind === 'html'` dispatch-arm
    comment in `src/renderers/layout/page.tsx` does **not** project (it is inside a
    function body) and is included here only because the same package already owes
    an entry.
  
  No behaviour change: this is prose only. `CHANGELOG.md` occurrences are
  deliberately untouched — immutable release history.
- 305205a: `kind:'html'` page sources keep the space between a text run and an adjacent
  inline element: `A <strong>x</strong> page` now compiles to `A `/`<strong>`/`
  page` and renders as `A x page` rather than `Axpage` (objectui#5661).
  
  The parser collapsed each text run's whitespace to a single space — correct, and
  what HTML itself does — and then `.trim()`ed it, which is not: HTML collapses a
  whitespace run to one space, it does not delete it. The deleted space was
  precisely the separator between a run and its inline sibling, so every authored
  sentence carrying emphasis or a link in the tier the guide recommends by default
  rendered with its words run together. It was silent: the page rendered, the
  structure was right, no diagnostic fired.
  
  The rule is deliberately mechanical rather than a block/inline taxonomy invented
  for a schema tree that has none: keep one leading space when a sibling precedes
  the run, and one trailing space when a sibling element follows it. The parent's
  own start and end still drop their edge space, so `<p>  hi  </p>` is unchanged.
  
  Its one bounded cost: a whitespace-only run BETWEEN two siblings survives as a
  single space, so a pretty-printed `<ul>` gains one `' '` string child per gap
  between its `<li>`s — one space per gap, never the source's newline and
  indentation, never at the container's own edges, and never inside an item's own
  text. That bound is pinned by a test rather than left as a claim.

## 17.6.0

### Minor Changes

- 279fb13: `ComponentInput.type` can declare a UNION, so a block stops warning about legal
  writes its own description recommends
  
  A registration's `type` was one coarse control kind, while a good number of spec
  keys accept more than one shape. A declaration therefore had to pick an arm, and
  the repo's own manifest gate then reported `type-mismatch` on the other arm's
  legal values. Four of the five measured cases were the loud shape: the input's
  `description` teaches the author to write an inline translation map
  (`{ en, "zh-CN", … }`) while the same input's `type: 'string'` made
  `sdui-parser`'s `checkType` warn about exactly that map — one platform authority
  contradicting itself on the write it had just recommended. Because these land at
  warning severity the page still compiled and rendered; the cost is that noise on
  correct authoring trains authors, AI authors included, to dismiss the
  `unknown-prop` and `type-mismatch` reports that are real.
  
  `type` now accepts an ARRAY of coarse kinds as well as a single one (maintainer
  ruling on objectui#3832, direction (a)), and a value passes the coarse check when
  ANY declared arm accepts it. Both declaration sites in `@object-ui/types` move
  together with the registry's own copy in `@object-ui/core`, and
  `ComponentInputSchema` enforces the same widening — a non-empty array of
  DISTINCT kinds, so an empty arm list or a repeated arm is refused at authoring
  time rather than normalized behind the author's back.
  
  Five declarations now spell their real contract, and the `type-mismatch` warning
  on each of these legal writes is gone:
  
  - `page:header.title`, `page:header.subtitle`, `page:card.title` —
    string **or** inline translation map (the spec's union, measured against
    `ComponentPropsMap` at the pinned rc.6; the renderers resolve both through
    `pickLocalized`);
  - `record:alert.title`, `record:alert.body` — the same two shapes, justified
    against the RENDERER since the pinned spec carries no `record:alert` props
    schema;
  - `element:text_input.defaultValue` — `string | number`, the spec's union,
    which had been narrowed to `'string'` with the number arm named only in prose.
  
  **Backward compatible, and measured as such.** The single-kind form stays valid
  and is still the canonical spelling for a one-arm key: it validates identically
  (the diagnostics for one arm, `invalid-enum` and its `error` severity included,
  are byte-identical), and `manifestFromConfigs` collapses a one-element array back
  to the bare string, so every entry already in a published `sdui.manifest.json`
  serializes unchanged and arrays appear only where a union was really declared.
  The JSX authoring surface follows in the same step — `generateDts` emits a
  TypeScript union for a union input, so the `.d.ts` an author type-checks against
  accepts exactly what the gate accepts.
  
  A union widens what is legal; it does not switch the check off. A value matching
  NO declared arm is still reported, a multi-arm mismatch reports at its strictest
  arm's severity (`error` when an `enum` arm is present, so an enum's closed list
  does not become dismissible by having a second arm added next to it), and arms
  are meant to match the contract rather than relax the gate:
  `element:text_input.defaultValue` deliberately gains no `object` arm because the
  spec rejects a map there, and `element:record_picker.emptyText` keeps its single
  `'string'` arm because that renderer drops the map form (objectui#4163) — an arm
  the renderer never honours would advertise a shape that cannot reach the screen.

### Patch Changes

- 40d3a33: `div` 的废弃提示按 provenance 收窄:只对 **JSON 作者面**的节点报,不再对 `kind:'html'` tier 自己解析出的节点开火。
  
  html tier 的页面是一段受限 JSX/Tailwind 文本,由引擎自己的解析器编译(只解析、不执行),标签名原样映射成节点 —— 作者在那一层写下的盒子标签,是该 tier 词表里的一等成员,**没有别的拼法可迁移**。提示照旧对他们开火,给的还是 JSON 作者面的替代建议:一条谁都无法执行的提示不是废弃,是噪声;它同时意味着这个类型永远退不掉,因为引擎自己的编译器一直在产出它。
  
  判据是**来源**,由生产者确立:解析器给它产出的每个节点打一个 symbol 标记(`Symbol.for` 注册键),渲染器读这个标记。symbol 对 `JSON.stringify` / `Object.keys` / DOM 全部不可见 —— 所以它既不会落进被持久化的文档,也就无法被一份(手写或 AI 生成的)JSON 元数据复制回来给自己买到豁免;通过花括号属性夹带进来的 JSON **不打标记**,那部分本来就是手写的,建议对它成立。
  
  迁移建议一字未改,JSON 作者面照旧每次模块加载报一次;提示文案现在写明它针对哪一个作者面。

## 17.5.0

## 17.4.0

## 17.3.0

## 17.2.0

### Minor Changes

- 4a51e77: Stop declaring 14 symbols across ten packages under names `@objectstack/spec`
  owns (objectui#3161, objectstack#4115 batch 7 — the long tail, one or two
  entries per package). All ten packages leave the ledger, which drops from 17
  collisions across 11 packages to 3 across 1.

  **Renamed exports** — in every case the spec exports the same name for a
  _different_ thing, so the old name was a mis-description rather than a dialect:

  | package                    | was                                | now                                                  | what the spec's same-named export is                                                                                                       |
  | :------------------------- | :--------------------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
  | `@object-ui/fields`        | `FieldWidgetProps`                 | `FieldWidgetComponentProps`                          | the DECLARED field-widget plugin props contract (a zod object; `field.type` is the `FieldType` enum, `readonly`/`required` carry defaults) |
  | `@object-ui/layout`        | `PageHeaderProps`                  | `PageHeaderComponentProps`                           | the authored `page:header` node — a zod schema of `title`, `subtitle`, an icon NAME, `breadcrumb`, `actions: string[]`                     |
  | `@object-ui/layout`        | `Page`                             | `PageNodeRenderer`                                   | the authored page metadata DOCUMENT (`name`, `label`, `type`, `regions`)                                                                   |
  | `@object-ui/plugin-detail` | `ObjectFieldLike`                  | `ObjectDefFieldLike`                                 | the i18n duck type `translateObject` walks (`help`/`description`, plus `[key: string]: any`)                                               |
  | `@object-ui/plugin-grid`   | `ColumnSummaryConfig`              | `ColumnSummarySetting`                               | the OBJECT form of `ListColumn.summary` **only** — the local one was the whole union, shorthand included                                   |
  | `@object-ui/plugin-grid`   | `isMultiValueField`                | `hasMultiValueShape`                                 | the spec's classifier, which requires a def with a `type`; the local one is called with `undefined`                                        |
  | `@object-ui/collaboration` | `RealtimeConfig`                   | `RealtimeSubscriptionConfig`                         | the app's realtime DECLARATION (`enabled`, `transport`, `subscriptions[]`)                                                                 |
  | `@object-ui/plugin-charts` | `ChartConfig`                      | `ChartContainerConfig`                               | the authored chart document (`type`, `xAxis`, `series`, `showLegend`, …)                                                                   |
  | `@object-ui/plugin-form`   | `FormSection` / `FormSectionProps` | `FormSectionContainer` / `FormSectionContainerProps` | the authored form-section metadata (`name`, `pane`, `visibleWhen`, `fields`)                                                               |
  | `@object-ui/providers`     | `Theme`                            | `ThemePreference`                                    | a whole theme DOCUMENT (`name`, `label`, `colors`, `typography`)                                                                           |
  | `@object-ui/runner`        | `App` (default export)             | `RunnerApp`                                          | the authored application metadata type **and** the `App.create()` builder                                                                  |
  | `@object-ui/sdui-parser`   | `ValidationResult`                 | `ManifestValidationResult`                           | plugin-manifest validation (`{ valid, errors?, warnings? }`), exported from both `kernel` and `contracts`                                  |

  `ManifestValidationResult` follows the `<what was validated>Validation<Error|Result>`
  convention registered on objectstack#4115 (`@object-ui/core` took
  `SchemaNodeValidationResult` in batch 4). `PageHeaderComponentProps` deliberately
  reuses the name `@object-ui/app-shell` already chose for its own header props in
  batch 3, so one concept does not acquire two dialect names one package apart.

  **Now derived from the spec instead of hand-written:**

  - `@object-ui/fields` — `isFileIdToken` is re-exported from
    `@objectstack/spec/data`. The local copy was character-for-character identical
    to the spec's function while its comment said it "mirrors" it, so every
    behaviour test passed and only reference identity could tell the two apart.
    The regex is a wire decision: widening it server-side while a copy here kept
    the old bound would make every new id read as "not a reference", and the
    widget would submit the legacy inline blob to a backend expecting a reference.
  - `@object-ui/plugin-detail` — `FeedFilterMode` is re-exported from
    `@objectstack/spec/data`, in a file that already imported the sibling
    `FeedItemType` from the spec.
  - `@object-ui/plugin-grid` — the eleven-member aggregation union is now the
    spec's `ColumnSummary` enum, so the total `Record<ColumnSummaryType, string>`
    label map turns a member the spec adds into a compile error instead of a
    blank footer cell. `ColumnSummarySetting` is `NonNullable<ListColumn['summary']>`,
    i.e. whatever forms the spec itself accepts. `hasMultiValueShape` delegates to
    the spec's `isMultiValueField` rather than re-deriving it from
    `MULTI_OPTION_TYPES` / `MULTI_CAPABLE_TYPES`.
  - `@object-ui/providers` — `ThemePreference` is the spec's `ThemeMode` union
    plus the one legacy `'system'` spelling this provider still honours for stored
    preferences, read off the schema's own `_zod` carrier so the package takes no
    zod dependency.

  `@objectstack/spec` moves from `devDependencies` to `dependencies` in
  `@object-ui/fields` (it re-exports a runtime function) and `@object-ui/providers`
  (its public `.d.ts` now references the spec).

  Scored `minor`, not `major`, per this repo's fixed-group rule — objectui's major
  tracks `@objectstack`, so breaking changes of our own ship as minor with the
  semantics spelled out above (see AGENTS.md §版本号策略). A `major` here would carry
  all 39 packages of the fixed group to `18.0.0` and off objectstack's 17.x line.

### Patch Changes

- cc70b8f: A declared `objectName` must reach the data layer — the evidence the framework's spec↔registry check cannot gather (objectstack#4472).

  The framework diffs `sdui.manifest.json` against the spec's zod schemas and, while that
  check was named `check:react-conformance`, it was read — by its own file header — as
  confirming these components "ACTUALLY implement" the spec's props. It never could. Both
  sides of that diff are **declarations**, and this repo produces one of them:
  `manifestFromConfigs` copies `config.inputs` verbatim and cannot observe whether the
  renderer behind a block reads any of them. So a prop both sides declare and nothing
  consumes reads there as agreement — which is how objectstack#4413's four `record:*` blocks
  published an `objectName`/`recordId` no renderer read, rendered blank, and stayed green.

  Evidence about the render path has to be taken from the render path, so it lives here now.
  `apps/console/src/__tests__/public-block-binding-reach.test.tsx` mounts every public block
  that declares an `objectName` input through `SchemaRenderer` with nothing but that binding,
  under a provider whose `dataSource` is a Proxy recording every call, and asserts some call
  carried the object name. Deliberately narrow — "is this binding wired", not "is every
  declared input consumed", which is not decidable from outside without heuristics. Every
  non-reaching block carries a written reason in a ledger asserted to equal the observed set
  in **both** directions, so a block that starts binding forces its entry deleted and a block
  that stops binding fails; the suite was verified to go red both ways.

  First run: five of eight bound blocks reach the data layer, three do not.
  `record:related_list` legitimately declines to fetch without the parent record id from
  `RecordContext` (already documented in @objectstack/spec's objectstack#4413 ledger).
  `list-view` and `embeddable-form` do not, and that is a real defect of the same shape —
  neither registration bridges the schema-renderer context onto the component's `dataSource`
  prop the way `object-form` / `object-kanban` / `object-calendar` do, and `SchemaRenderer`
  never injects it, so on the registry/SDUI path both render an empty shell while declaring
  `objectName` **required**. Filed as objectui#3144 rather than fixed here: giving them a
  data source changes what they render everywhere they are mounted bare.

  `manifestFromConfigs` and `scripts/dump-public-manifest.mjs` now say in their own docs that
  what they emit is what a registration _declared_, never what a renderer reads.

## 17.1.0

### Minor Changes

- 32462dd: feat(sdui): guard the public contract against silent drift — coverage test + manifest lazy-stub assertion

  Follow-up to objectui#2953. That bug — every lazily-registered public block
  missing from the contract, and so from every `kind:'react'` page's scope —
  survived because nothing compared `PUBLIC_BLOCKS` against what an app actually
  registers. Type-check, lint, build and the whole suite stayed green while seven
  curated blocks were unusable. Two guards close that class.

  **Console ↔ contract coverage.** `apps/console/src/register-plugins.ts` extracts
  the plugin registration out of `main.tsx` so it can be imported without booting
  the app. A new `apps/console/src/__tests__/public-contract.test.ts` reads that
  real list and pins, as exact lists, which curated tags the console exposes (35),
  which are still unimplemented (`line_items`), and which reach the contract
  through a pending lazy stub. Exact lists rather than `toContain`, because the
  failure mode is a _shrinking_ contract. Reverting the #2953 fix drops coverage
  from 35 to 28 and fails all four assertions.

  **Manifests must be generated from loaded registrations.** New exported
  `assertFullyLoaded(configs)` in `@object-ui/sdui-parser`, plus `lazy?: boolean`
  on `RegistryConfigLike`. A lazy stub carries metadata but no `inputs`, so it
  would be written into `sdui.manifest.json` as a block that takes no props —
  making every prop an author passes it an `unknown-prop` diagnostic in the save
  gate. Both generators now assert instead: `gen-manifest.ts` throws, and
  `dev/manifest-dump.tsx` also imports the console's real registration list, so a
  plugin the console lazy-registers but the dump forgets to import eagerly is
  caught rather than silently emitted propless. `scripts/dump-public-manifest.mjs`
  surfaces that failure instead of timing out for 120s with no message.

  Also documents `object-chart` as a seventh block affected by objectui#2953 —
  the issue listed six.

## 17.0.0

## 16.1.0

## 16.0.0

## 15.0.0

## 14.1.0

## 14.0.0

## 13.2.0

## 13.1.0

## 13.0.0

## 12.1.0

## 12.0.0

## 11.5.0

## 11.4.0

## 11.3.0

## 11.2.0

### Minor Changes

- 9e7a986: ADR-0080: AI-authored UI pages. New `@object-ui/sdui-parser` compiles a constrained JSX/HTML+Tailwind source into the SchemaNode tree (parse, never execute) with whitelist sanitization, manifest validation, and `.d.ts` codegen for the JSX type surface. `PageRenderer` renders `kind:'jsx'` pages; `ComponentRegistry` gains `tier` + `getPublicConfigs()` (capability vs contract).
