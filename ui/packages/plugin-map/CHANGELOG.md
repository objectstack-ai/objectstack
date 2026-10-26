# @object-ui/plugin-map

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [7c405b7]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [0d12e95]
- Updated dependencies [49a536d]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [c8f8b10]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/permissions@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Patch Changes

- fbaa79d: A map view in a browser without WebGL2 shows its own "Map failed to load" alert and lists its records, instead of crashing the page (objectui#11819).
  
  MapLibre draws only through WebGL2. Without it — hardware acceleration turned off, a GPU-blocklisted browser, some remote desktops, headless Chromium — the page body was replaced by the render-failure card *Component "object-map" failed to render — Cannot read properties of undefined (reading 'destroy')*, which names neither the map nor the cause. `ObjectMap` now asks the browser for a WebGL2 context before it mounts the map. When there is none it never constructs a map: it shows the amber "Map failed to load" alert, naming WebGL2, and lists the records the markers would have drawn. The search box above narrows that list, and choosing a record does what clicking its marker does. A style or tile failure is unchanged: the map keeps running with its markers and shows the alert over them.
  
  Nothing is added to the package entry: no export, prop or type member.
- 524136e: The view-level `provider: 'api'` data source is no longer read anywhere in objectui (objectui#12325). `@objectstack/spec` retires it (objectstack#23082, ADR-0049): a view binds its object (`provider: 'object'`) or static rows (`provider: 'value'`), and a metadata-declared API call is the page element's `dataSource` binding.
  
  Breaking, declared as `minor` per the version-alignment rule:
  
  - **`resolveDataSource`** (`@object-ui/core`) has no `api` arm. A block that still says `provider: 'api'` is an unknown provider and gets an unknown provider's answer (the fallback DataSource, else `null`); no `ApiDataSource` is built from its `read` / `write`. `ResolveDataSourceOptions` loses `fetch` and `defaultHeaders`, which only that arm read.
  - **`ViewDataProvider`** (`@object-ui/core`) has no `api` arm: such a config resolves with `Unknown data provider: api`. `ViewDataConfig` and `ResolvedData.provider` drop `'api'`, and `DataFetcher.fetchUrl`, which only that arm called, is removed.
  - **`useViewData`** (`@object-ui/react`) no longer keys on or threads anything for an `api` block.
  - **`ObjectGantt`** reads no `api` block: its `read` URL is never requested, and the chart answers it like any unknown provider. `ObjectCalendar` and `ObjectMap` drop their `api` branches, which only warned "not yet implemented".
  - **`ListView`** no longer stands down for a gantt view with an `api` block: it fetches the bound object like any other list.
  
  Unchanged: `ApiDataSource` stays a class for code that constructs it from an `ApiDataSourceConfig`, so the console's approvals inbox reads exactly as before.
- d75f212: Published text no longer teaches the retired view-level `provider: 'api'` data source (objectui#12364). A view binds `provider: 'object'` or `provider: 'value'`; a metadata-declared API call is the page element's `dataSource` binding. Text only: no schema accepts or refuses anything new, and no renderer behaves differently.
  
  - **`@object-ui/types`:** the `object-tree` `data` description drops the `api` provider from the providers it names.
  - **`@object-ui/plugin-grid` / `@object-ui/plugin-map`:** the `data` input descriptions drop the `api` provider.
  - **`@object-ui/plugin-calendar` / `@object-ui/plugin-gantt` / `@object-ui/plugin-map`:** the error thrown when no `DataSource` is available now reads `DataSource required for the object provider` (was `DataSource required for object/api providers`). It fires in exactly the same conditions as before.
  - **`@object-ui/react` / `@object-ui/auth`:** the README and docblocks describe `SchemaRendererProvider`'s `apiFetch` as what it is now: the host's authenticated fetch the renderers use for their own reads of the host's API (chart metadata, dataset dimension labels, record-permission probes). It is not a channel for a view's data source.
  - **`@object-ui/app-shell`:** comment wording only in `ConsoleShell`, `useConsoleActionRuntime` and `ObjectView` (these comments ship in the built JS): no behaviour change.
  - **`@object-ui/core`:** docblock wording only on `normalizeListViewSchema` and `resolveRecordSourceObjectName` (these ship in `dist/*.d.ts` and the built JS): no behaviour change.
- 1e6d83b: Data-bound blocks title their "data source could not be resolved" panel in the page's language (objectui#12920, the family of objectui#12910). The panel shows when a block's `dataSource.view` names a view its object does not have. Each block's title now reads `@object-ui/i18n` through `useObjectTranslation`, with the `en` pack's value as the inline default, so a page with no `I18nProvider` draws the same English it drew before.
  
  - **Plugin blocks.** `object-calendar`, `object-chart`, `object-metric`, `object-pivot`, `detail-view`, `record:related_list`, `object-form`, `embeddable-form`, `object-master-detail-form`, `record:line_items`, `object-gantt`, `object-grid`, `object-kanban`, `list-view`, `object-map` and `object-timeline` read one `element.KIND.sourceUnresolved` key per block kind. `object-metric` reads `element.number.sourceUnresolved`, the key `element:number` already reads for the same sentence. The three forms share `element.form.sourceUnresolved`. `record:related_list`'s panel for a failed `parentDataSource` read reads `element.relatedList.parentUnreadable` ("This related list’s parent record could not be read").
  - **`@object-ui/react` panel defaults.** `ElementDataSourceErrorPanel` with no `title` reads `element.component.sourceUnresolved`, and `NoDataSourcePanel` with no `title` reads `element.component.noDataSource`. A passed `title` still wins, an empty string included. Props and markup do not change.
  
  Clause-②: yes
  
  The new keys in `@object-ui/i18n` widen its exported `TranslationKeys`. No prop, input or export of these packages changes.
- b13ea3c: feat(types)!: `ObjectGridSchema.defaultFilters` and the flat `ObjectGanttSchema` / `ObjectMapSchema` `filter` follow their `@objectstack/spec` rows (objectui#6152, round 10)
  
  Clause-②: yes
  
  `@objectstack/spec` typed `ComponentPropsMap['object-grid'].defaultFilters` as the same
  `ViewFilterRule` array as `filter`, `[{ field, operator, value }, ...]`, from 17.6.0 until 18
  retired it (see objectui#12030): the legacy fallback `ObjectGrid` read only when `filter` was
  absent, refusing the MongoDB-style record, a bare string and the AST tuple array. The `object-gantt` and `object-map` rows type `filter` the same
  way. `@object-ui/types` now takes each row's own member by reference, on the TypeScript interface
  and on the zod mirror, with no alias window.
  
  **Widened.** `ObjectGridSchema.defaultFilters` was `Record<string, any>` and
  `z.record(z.string(), z.any())`, so the zod mirror REFUSED the rule array the row declares. The
  flat grid mirror is the source of an `object-view`'s `table` slot, so
  `table: { defaultFilters: [{ field: 'status', operator: 'equals', value: 'open' }] }` parsed
  there through 17.x, on the tolerant and the strict face and through `safeValidateSchema`; retired
  in 18, see objectui#12030: the row's tombstone refuses `defaultFilters` by name, so every value,
  the rule array included, is refused there now.
  
  **Narrowed (breaking).**
  
  - The record form of `defaultFilters` is refused: on the interface (a compile error, in an
    `object-view`'s `table` too) and on the zod mirror, at `defaultFilters` (`table.defaultFilters`
    in an `object-view`), with the protocol's own message, which computed the rule array from the
    record's keys through 17.x (since 18, see objectui#12030, it is the retired-key message, which
    names `filter`). Respell
    `defaultFilters: { status: 'open' }` as
    `filter: [{ field: 'status', operator: 'equals', value: 'open' }]`; the rule-array
    `defaultFilters` spelling this entry first offered is retired in 18 too.
  - `ObjectGanttSchema.filter` and `ObjectMapSchema.filter` were `any[]` and `z.array(z.any())`, so
    `filter: [['status', '=', 'open']]` type-checked and parsed. Both are the row's rule array now;
    respell the tuple as `[{ field: 'status', operator: 'equals', value: 'open' }]`. These two flat
    types describe the node as the renderers read it: an authored `object-gantt` / `object-map`
    node's `properties` bag is the row itself, which refused the tuple array already.
  
  What did not move: the renderers' reads. `ObjectGrid` lowered `defaultFilters` through the same
  `toFilterNode` sink as `filter`, so a rule array there sent the same `$filter` and drew the same
  rows as the same array written as `filter` (retired in 18, see objectui#12030: `ObjectGrid` and
  `ObjectView` no longer read `defaultFilters`, so a view that still carries it renders unfiltered);
  the sink still lowers a record or an AST that reaches `filter` at runtime, and `ObjectGantt` / `ObjectMap` still forward an AST a host composes. The
  `@object-ui/core`, `@object-ui/plugin-grid` and `@object-ui/plugin-view` entries are comment
  repairs to sentences that called the key `Record<string, any>`. `@object-ui/plugin-grid`,
  `@object-ui/plugin-view` and `@object-ui/plugin-map` also carry typed test fixtures re-spelled to
  the rule array, and `@object-ui/plugin-grid` a pin of the above through the real renderer (since
  18 it pins that `defaultFilters` is not read).
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [e06365c]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
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
- Updated dependencies [ce991bd]
- Updated dependencies [5f75cfa]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [e723f58]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [3eb3ec1]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [726d8c9]
- Updated dependencies [ef71a09]
- Updated dependencies [619e3f7]
- Updated dependencies [c9e6742]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [611566b]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [71243db]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [c7462e7]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [1e6d83b]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [025130c]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [988aa9f]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [616df65]
- Updated dependencies [4b92c5a]
- Updated dependencies [3650d94]
- Updated dependencies [8cd4db4]
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
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [b403bb3]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/permissions@18.0.0

## 17.7.0

### Minor Changes

- 64563a9: **BREAKING (node type key):** `@object-ui/plugin-map` no longer registers the bare
  `map` node type key, and its namespaced twin `view:map` goes with it. A node
  authored `"type": "map"` no longer resolves a renderer. Write
  `"type": "object-map"` — the one spelling the plugin serves (objectui#10393,
  executing the objectui#8008 family ruling of 2026-09-09 that retired the bare
  `gantt` and `kanban` keys).
  
  **Why.** The registry mounted a `map` node while the published declaration refused
  it: `ObjectMapSchema.type` is the literal `'object-map'` and `AnyComponentSchema`
  has no `map` arm, so `safeValidateSchema` answered a `map` node with
  `invalid_union` while the html tier accepted it. Two faces, opposite verdicts.
  No schema face ever declared `map` as a component node type, so there is no arm
  to turn into a named refusal: unregistering is the whole retirement, exactly as
  it was for `gantt`. After it, the html tier (`validateTree` over the live
  registry) reports a `map` node as `unknown-component`, matching the Zod face.
  
  **⛔ No stored document moves.** The string `map` names two different things at
  two different layers, and only one of them is retiring:
  
  | layer | value | who writes it | retired? |
  | --- | --- | --- | --- |
  | stored `NamedListView.type` / `defaultViewType` | `"map"` | `CreateViewDialog`, persisted per tenant | **no — untouched** |
  | node type key | `map`, `view:map` | hand-authored JSON | **yes** |
  
  `ObjectView` and `ListView` map a stored `map` view onto the node type they
  render, and both already emit `object-map`, so every map view created through
  the console keeps rendering. Nothing in a tenant database changes, and ⛔ nothing
  should be migrated there.
  
  **What moved with it.**
  
  - `@object-ui/console` drops its lazy `map` / `view:map` registration stub; the
    lazy `object-map` stub is unchanged.
  - `@object-ui/core`: `recordSourceDataArmForType` no longer lists the `map` and
    `view:map` rows, since no block is registered under either key.
  - `@object-ui/cli`: the generated known-type list that `objectui check` reads no
    longer contains bare `map`, so the check now reports `map` as an unknown
    schema type in a file it recognises. ⚠️ `view:map` stays on
    that list, because the opt-in protocol placeholder (`registerPlaceholders()`
    in `@object-ui/components`) registers it — in the console a `view:map` node
    renders that placeholder panel, not a map, and `objectui check` does not report
    it as an unknown schema type in a file it recognises. A bare
    `{ "type": "view:map" }` with no structural key is listed in `check`'s advisory
    did-not-validate list instead, because `view:map` is on the known-type list and
    `AnyComponentSchema` has no arm for it; that line does not say the node renders
    a placeholder. Search documents for `view:map` directly.
  
  ⚠️ **Dated note, 2026-09-25 — `objectui check` flags `map` only in a file it
  recognises — objectui#10606.** This entry first said, unscoped, that the check now
  flags bare `map`. `check` checks the `type` of each file it recognises, and a file
  whose root carries an ObjectUI structural key (`children`, `className`, `body`, …)
  is recognised by that key alone. A file with none of those keys is parsed against
  the schema and recognised only if it validates; one that does not validate is
  listed by name when its root `type` is on that known-type list, and is otherwise
  counted as skipped. `map` is no longer on it, so `{ "type": "map" }` is
  counted as skipped ("no ObjectUI recogniser admitted") and gets no unknown-type
  line, while `{ "type": "map", "className": "h-64" }` gets one. `check` exits
  non-zero on unreadable JSON only; the verdict is `objectui validate`'s: it refuses
  `{ "type": "map" }` at `type` (`invalid_union`) and exits non-zero.
  
  The `@object-ui/plugin-map` README now describes one registered type, and its
  sentence claiming a bare array under `data` reaches the in-memory adapter is
  corrected: a bare array under `data` is not a record source on the map
  (objectui#8348), so inline rows belong under `staticData`. The same false claim
  is corrected on the two docs pages that carried it, `plugins/plugin-map.mdx`
  and `fields/location.mdx`.
  
  **One pending entry in this same release is superseded in part.** The
  objectui#10392 / #10394 entry (`10392-registration-record-source-inputs.md`)
  says `object-map`, `map` and `object-gantt` gained `data` / `staticData`
  inputs. It now reads as of its own change and carries a dated note naming this
  card: `map` declares nothing after this retirement, while `object-map` and
  `object-gantt` keep both inputs.
- 20d23be: `object-map` publishes the three keys its `@objectstack/spec` 17.5.0 row declares and its registration left out: `mapStyle`, `navigation` and `enableClustering` (objectui#11168 slice 3, objectui#11111 decision 3 = B). Each was measured on the real renderer first, and the renderer honours all three. The page validator used to report each one as an unknown prop.
  
  - `mapStyle` replaces the demo tiles. Its description is the spec row's own, verbatim: it is read before `map.style`. The renderer now reads it that way too; the `mapStyle` precedence entry in this release states that change.
  - `enableClustering: true` clusters nearby markers. Without the key, the map clusters only above 100 markers, and `false` turns clustering off at any count.
  - On `navigation`, `drawer`, `modal` and `popover` open the marker's record. `new_window`, or `openNewTab: true`, opens the record page in a new tab. `page` and a block without `mode` open the record page of the map's `objectName` through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views). Under a host that publishes none, or on a map that names no `objectName`, they open nothing. On a map that no parent view navigates for, a click also opens nothing when the key is absent or the mode is `none` or `split`.
  
  The `map` input's description now lists its members. Apart from the `mapStyle` precedence, rendering is unchanged.
- 7c3df8f: A non-grid view's fetch now carries a platform row ceiling, and crossing it is
  never silent (objectui#7210, maintainer ruling a′, 2026-09-02).
  
  Before this, `ObjectGantt`, `ObjectCalendar`, `ObjectMap` and `ObjectTree` each
  issued a `find` with **no `$top` at all**, so the request returned the entire
  filtered result set. At the 186 rows the card was filed from that is invisible;
  on an object with 100k scheduled rows it is the whole table into the browser,
  and nothing an author could write — `pagination.pageSize` included — could
  bound a request that never carried a cap to begin with.
  
  **What changed.** Those four fetches now ask for `NON_GRID_ROW_CEILING_TOP`
  rows, draw at most `NON_GRID_ROW_CEILING` of them, and when the result set was
  larger they render a footnote naming both numbers, verbatim as it renders:
  *"Showing the first 2000 of 41234 records. Narrow the filter."* Below the
  ceiling nothing changes: the full set draws and no footnote appears.
  
  The four view packages take a **minor**, not a patch: a result set above the
  ceiling is no longer drawn in full, which is a behaviour break whatever the
  fixed group does to the released version number.
  
  **The ceiling is a platform constant, not an authorable key** — `2000`, exported
  from `@object-ui/react` as `NON_GRID_ROW_CEILING`. An authored `limit` or
  `dataSource: { limit }` still does not reach these queries, by the same ruling;
  three alternatives were rejected with it (a documentation note only — still the
  whole table; truncating at `pageSize` — silent, and a complete schedule capped
  at one page; an authorable `maxRows` — a new permanent key every author sets).
  
  **Why 2,000.** One constant for all four, so the binding view sets it. Measured
  in this repo's jsdom lane: gantt, calendar and map hold their DOM flat as rows
  grow (virtualised task list; four events per day cell; auto-clustering above
  100 markers), while `ObjectTree` flattens every expanded node into the document
  at a linear **5.2 DOM elements per record** with no virtualisation. 2,000 rows
  is where the worst of the four lands at ~10,400 elements — an order of
  magnitude above Lighthouse's "excessive DOM size" warning, and still ~10x the
  real application result set this card came from.
  
  New exports on `@object-ui/react`: `NON_GRID_ROW_CEILING`,
  `NON_GRID_ROW_CEILING_TOP`, `applyNonGridRowCeiling`, `NonGridRowCeilingNote`
  and the type `NonGridCeilingResult`. Two new `common.*` i18n keys carry the
  footnote copy in all ten packs.
- b041b9c: `@object-ui/core` publishes `resolveRecordSourceObjectName`, the ONE reader for "which
  object is this block bound to".
  
  Six view plugins each spelled that resolution locally — `ObjectCalendar` twice,
  `ObjectGantt`, `ObjectTree` twice, `ObjectMap`, `ObjectGrid` — and had drifted: three
  wrote `?? schema.objectName`, one `|| ''`, one `: undefined`, one an `'object' in
  dataConfig` test. They now delegate to one function that states the published
  record-source ladder `77cb489b4` declared (`data`, then `staticData`, then `objectName`) once.
  
  **No behaviour changes.** Each site's pre-collapse expression is transcribed verbatim
  into `record-source.behaviourNeutrality-7627.test.ts` and asserted equal to its
  post-collapse spelling across the whole contract-valid input matrix — both bindings
  present, data only, `objectName` only, empty `objectName`, empty `data.object`, the
  `api` / `value` / `staticData` / array-shorthand providers, and nothing bound.
  
  **Two questions stay two questions.** `normalizeListViewSchema`'s gap-fill (#7477,
  ruling B, landed as `00d2fa682`) is untouched and is NOT re-pointed at the new reader: it answers
  how `objectName` gets POPULATED when absent, where an already-present `objectName` wins.
  The new reader answers which object a block RESOLVES, where the `data` block wins — the
  order declared on both published faces in `@object-ui/types` and pinned by
  `objectql-record-source-refinement-6939.test.ts`. Merging them would silently override
  one standing ruling or the other.
  
  **`ObjectGantt`'s `persistLayoutKey` is deliberately excluded** and keeps its inverted
  order, with an in-place comment saying why: its receiver is a localStorage key
  (`gantt-layout:KEY:filters`), not a record source, so re-pointing it would orphan every
  saved layout and filter-chip set of a view carrying both bindings. Two more sites the
  finding listed are not object-name readers at all and were struck: `ObjectGantt`'s
  refresh-handler predicate (`object` OR `api`) and `plugin-dashboard`'s `isObjectProvider`
  type-guard over a widget's `data`.
  
  `useSettledSchema`'s doc comment stops prescribing the hand-written ladder at all four
  lines that taught it, so the copies cannot re-seed from the hook that replaced them.
- cb725e7: An unbound map now REFUSES; coordinates are never guessed (objectui#8169, maintainer
  ruling 2026-09-07, decision batch #67, option B).
  
  **Behaviour change, deliberately, with no staged window.** A map with no coordinate
  binding renders
  
  > Map configuration required — declare `map.locationField` or `map.latitudeField` + `map.longitudeField`
  
  in place of the map, instead of painting an empty one. The principle behind
  the 2026-09-01 date-axis ruling (date axes are never invented) and objectui#5953 (a marker title is never
  forged) now covers coordinates as well: bindings are never fabricated, and an unbound
  surface refuses.
  
  Three things moved together, because moving any one of them alone makes the tree worse:
  
  - `@object-ui/plugin-map` — `getMapConfig` loses its default branch, the one that
    returned the field names `latitude` / `longitude` / `location` / `description` when
    the author declared nothing, and `ObjectMap` gains the refusal state above. The
    refusal covers every branch, so a declared block that binds no coordinate field
    (`map: { titleField: 'name' }`) and a half pair (`latitudeField` with no
    `longitudeField`) refuse too — those used to render an empty map under the
    excluded-records notice.
  - `@object-ui/plugin-list` and `@object-ui/plugin-view` — the `locationField: … ||
    'location'` floor each flattener added on the way into the map is deleted. The
    flattened schema now carries exactly what the view declared.
  
  ⚠️ **Deleting the relay floors alone would have widened the guess, not closed it** —
  measured on the card. The floor forced `getMapConfig`'s flat branch, which returns
  `locationField` and no `latitudeField` / `longitudeField`, so dropping it on its own
  would have handed undeclared views the component's three-name default branch instead of
  one name, and records carrying real `latitude` / `longitude` columns would have *started*
  plotting on views that declared nothing.
  
  **Migration.** Declare the binding on any map view that relied on the old defaults:
  `map: { locationField: 'your_field' }`, or `map: { latitudeField, longitudeField }`. A
  record set carrying `latitude` / `longitude` (or `location`) columns no longer plots on a
  view that declared no map block — it shows the refusal, which names what to write.
  Interface pages are unaffected where the object actually has a location-typed field:
  `defaultMapFromObject` derives `locationField` from the object's own field list, which is
  a reading of declared metadata rather than a guess, and is unchanged.
- 0ea7054: Remove 37 runtime dependencies that no file in the declaring package consumes, and gate
  the direction so the next one cannot land (objectui#8198).
  
  `check:phantom-deps` judges imports that are not declared; nothing judged the reverse,
  so a declaration could outlive its last consumer indefinitely. That is what happened to
  `recharts` in `@object-ui/components` after objectui#7397 deleted its only importer — it
  was removed by hand on objectui#7625, and nothing would have reported the next one. The
  new `pnpm check:unused-deps` asks the reverse question over `dependencies` and
  `optionalDependencies` of every released package.
  
  **Potentially breaking, for consumers relying on hoisting.** Nothing these packages ship
  changes: their Vite `external` predicates are path-based and never read `dependencies`,
  so no built artifact moves. What changes is the install graph — a project that imports
  one of the removed packages while depending only on the ObjectUI package that used to
  drag it in will no longer resolve it. Declare it directly; that is the correct
  dependency edge in either case. The removals, by package:
  
  - `@object-ui/plugin-designer`: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@object-ui/fields`
  - `@object-ui/plugin-chatbot`: `react-markdown`, `react-syntax-highlighter`, `remark-gfm` (and the orphaned `@types/react-syntax-highlighter`)
  - `@object-ui/plugin-report`: `@object-ui/plugin-grid`, `clsx`, `react-i18next`, `tailwind-merge`
  - `@object-ui/plugin-map`: `@objectstack/spec`, `lucide-react`, `zod`
  - `@object-ui/runner`: `class-variance-authority`, `clsx`, `tailwind-merge`
  - `@object-ui/core`: `lodash`, `zod`
  - `@object-ui/layout`: `clsx`, `tailwind-merge`, and `react-dom` — which it pinned at an exact version in `dependencies` while also declaring it as a peer range, i.e. a library hard-depending on the renderer it asks its host to supply
  - `@object-ui/plugin-dashboard`: `clsx`, `tailwind-merge`, and the same `react-dom` defect
  - `@object-ui/plugin-ai`: `@object-ui/react`, `clsx`, `tailwind-merge`
  - `@object-ui/fields`: `clsx`, `tailwind-merge`
  - `@object-ui/console`: `@object-ui/react-runtime`, `sucrase`
  - `@object-ui/auth`: `@object-ui/types`
  - `@object-ui/plugin-calendar`: `@object-ui/fields`
  - `@object-ui/plugin-editor`, `@object-ui/plugin-markdown`: `@object-ui/react`
  - `@object-ui/react`: `react-hook-form`
  
  Every one was verified by a whole-package grep before removal — the name appeared nowhere
  under the package but its own manifest and CHANGELOG — and the whole workspace builds,
  type-checks and tests green afterwards.
- 233a1b3: Declare the `filter` and `sort` inputs on the `object-map`, `object-gantt`,
  `object-timeline` and `view:timeline` registrations (objectui#8220) — the html
  tier stops reporting `unknown-prop` on two keys the spec declares and all three
  renderers read.
  
  objectui#7712's and objectui#8171's defect, three blocks over. `ObjectMap`,
  `ObjectGantt` and `ObjectTimeline` each lower the authored keys onto their own
  query — `$filter` (the authored `filter`, its context tokens resolved first) and
  `$orderby: convertSortToQueryParams(schema.sort)` — but none of the four
  registrations publishing those renderers listed either key in `inputs`, and
  `sdui-parser`'s `validateTree` reports `unknown-prop` for every key no `inputs`
  entry claims. An author writing the spelling that works was told it was unknown.
  
  Unlike the kanban and calendar cases, these three blocks had no spec row when the
  defect was filed, so declaring the keys then would have published an authoring
  surface no contract backed. That order is now met on the installed package:
  `@objectstack/spec` 17.5.0 maps `object-map`, `object-gantt` and `object-timeline`
  in `ComponentPropsMap`, each row declaring `filter` as the `ViewFilterRule` array
  and `sort` as the `SortItem` array. ADR-0049 enforce-or-remove therefore resolves
  toward **declare**: both keys have live readers on both ends.
  
  Both keys are declared `type: 'array'`. For `filter` that is the rule-array arm
  `[{ field, operator, value }, ...]` and nothing else: the spec refuses the
  MongoDB-style record form at all three doors, and with the key declared as an
  array the html tier now refuses it too, as a `type-mismatch`, instead of passing
  it as an unknown key. `sort` takes `[{ field, order }]`.
  
  `view:timeline` declares the same pair as `object-timeline`: it is the same
  renderer under a second tag, the `view:calendar` precedent. The map's and the
  gantt's bare `view:` twins are already retired (objectui#10393, objectui#8008),
  so four registrations carry the declaration, not six.
  
  Pinned per plugin in `__tests__/queryKeysDeclared-8220.test.tsx`: the real
  validator over a manifest built from the live registry, with an undeclared-key
  control; the installed spec row's verdict on the same values; and a mount through
  `SchemaRenderer` showing the rule array reach `$filter` and the sort items reach
  `$orderby` on every tag.
  
  Not changed here: the console's `registry-inputs-spec-parity` ledger. It does not
  load these three plugins yet and books the blocks as unjudged, owed to
  objectui#11168, so this change moves none of its rows.
  
  **Note, 2026-10-02 (objectui#11168 slice 5, shipping in this same release).**
  The last paragraph above says the console's `registry-inputs-spec-parity` gate
  does not load these three plugins yet and books the blocks as unjudged. That no
  longer holds for the release: objectui#11168 loaded all three in this same
  release (`object-map` in slice 3, `object-gantt` in slice 4, `object-timeline`
  in slice 5), so the gate judges each registration in both directions, and its
  unjudged-block ledger books none of them. This change itself still moved none
  of those rows.
- 91facae: **Breaking behaviour change — a view block now honours only the `data` spelling its published row declares.**
  
  Maintainer ruling, decision batch #83 (2026-09-08), verbatim 「8348 以协议为准」: the contract decides. What `os validate` and the save gate refuse under `data`, the renderer refuses too. The shared record-source ladder (`resolveRecordSourceConfig` in `@object-ui/core`) now takes the arm the calling block's row declares, and rung 1 applies only on that arm.
  
  ⚠️ **`object-calendar` documents authored against the tolerated spelling stop rendering those rows.** The ladder falls past `data` to `staticData`, then to `objectName` — so such a calendar queries its object instead, or draws nothing when it names neither. This is accepted, with no transition window and no staged deprecation (the standing 2026-08-27 posture).
  
  **Per block — what the published row says, and what actually moves:**
  
  - **`object-calendar`** — row: `ComponentPropsMap['object-calendar'].data` is `z.array(z.unknown())` ("Pre-fetched records — skips the internal fetch"). A record-source **config object** under `data` — `{ provider: 'value', items }`, `{ provider: 'object', object }`, `{ provider: 'api', … }` — is no longer honoured, and this is a real end-to-end change: that object had exactly one carrier into the block, so an authored calendar written that way now queries its object (or draws nothing) instead of drawing the authored rows. There is no longer an api-provider branch to reach here. An **array** under `data` is unchanged, as are `staticData` and `objectName`.
  - **`object-grid`** — row: the `ViewData` union, whose own description says "the bare-array shortcut is refused". `getDataConfig`'s `Array.isArray(schema.data)` head is removed, so the array is no longer a record source at the ladder. ⛔ Measured: this is **not** an end-to-end change for a node rendered through `SchemaRenderer`. An authored `data` array also arrives on the **props channel** (`SchemaRenderer` spreads node keys as props; `ObjectGrid`'s `passedData` lifts an array at higher priority), so such a grid still drew its rows when this landed. The removal took the second read, not the last one; objectui#9571 closed the props carrier afterwards.
  - **`object-map`** — no `ComponentPropsMap` row existed when this landed; the governing row was this repo's own `ObjectMapSchema.data`, `ViewDataSchema.optional()` (the protocol row has since been published, and is the `ViewData` union too). Its array-shorthand head is removed on the same terms, with the same measured caveat at the time: through `SchemaRenderer` the props channel still drew an authored array, until objectui#9571. `data: { provider: 'value', items }` and `staticData` are unchanged.
  - **`object-gantt`** — no `ComponentPropsMap` row when this landed; the governing row was `ObjectGanttSchema.data`, `ViewDataSchema.optional()` (the protocol row has since been published, and is the `ViewData` union too). A bare array under `data` is no longer a record source. Nothing observable moves: this block never lifted one, the array carried no `provider` and matched no fetch branch, and its renderer forwards no host props.
  - **`object-tree`** — **unchanged by this change.** When it landed, no published face declared a `data` row for this block: not `ComponentPropsMap`, not `ObjectTreeSchema` (which declares `objectName` required and no `data`), not its registration `inputs`. Neither arm of the ruling reached it, so its rung 1 kept its previous behaviour and the block was reported rather than guessed at. Once the protocol published `ComponentPropsMap['object-tree']`, the tree moved to the `ViewData` arm too — see the separate `object-tree` entry for objectui#8348.
  
  The `data` **prop** — the pre-fetched rows a host such as `ObjectView` or `ListView` passes down — is a different carrier and is untouched on every block. That it is also reachable from an authored node key, because `SchemaRenderer` spreads node keys as props, is what limits the grid and map halves above; it is reported on objectui#8348 rather than changed here.
- a984600: Honour `filter`, `sort` and the platform row ceiling on a calendar's and a map's
  inline (`provider: 'value'`) data (objectui#9061) — the port of objectui#8769's
  repair off `ObjectGantt`.
  
  **The defect was fail-open.** Both renderers' fetch effect short-circuited the
  inline provider: it set the authored rows and returned BEFORE the adapter query,
  which is the one site in each file that lowers `schema.filter` to `$filter`,
  `schema.sort` to `$orderby` and the objectui#7210 ceiling to `$top`. So an
  inline calendar or map that declared a `filter` drew **every** authored row, with
  no diagnostic. The key that was dropped is the key that NARROWS, which is why
  this matters: the view answered a wider question than the author asked. Nothing
  was exposed that was not already in the authored schema — this is a correctness
  defect, not a data-access one.
  
  **What changed.** Each renderer resolves a `ValueDataSource` for the inline
  provider and issues the same query the `object` arm issues. The `api` arm is
  untouched, and no dependency array moves. `ValueDataSource` already implements
  `$filter` / `$orderby` / `$skip` / `$top` / `$select` over its own array, so no
  filter combinator was written for this change.
  
  **Behaviour you may notice.**
  
  - An authored `filter` / `sort` now narrows and orders inline rows. Every
    spelling reaches it: `data: { provider: 'value', items }` and `staticData` on
    both renderers, plus the map's bare-array `data` shorthand.
  - The row ceiling now applies to inline rows: past 2,000 drawn rows the view
    draws 2,000 and shows the footnote naming both numbers, as it already did for
    fetched rows. It is applied to the **filtered** set, so a large inline array
    that a `filter` cuts below the ceiling draws every matching row and stays
    quiet. Rows a host passes down through the `data` React prop are still never
    capped — those are not ours to cap.
  - Inline rows now reach the view as the adapter's own deep copy rather than as
    the authored array's object identities. Code comparing a row handed to
    `onEventClick` / `onMarkerClick` against the authored array with `===` needs
    `id` equality instead.
  - That copy is a JSON round-trip, so inline rows must be JSON-serializable.
    A record graph carrying a back-reference, or a `BigInt` id, now renders an
    error panel instead of the view. `ObjectGantt` has refused the same input
    since before objectui#8769; `ObjectMap` did not, and pinned that it need not
    (objectui#6018). ⚠️ That pin is left RED and untouched in this change — see
    the pull request body.
- 502eb58: The row/card click props on the view components now declare the modifier
  payload they have always been invoked with (objectui#9357).
  
  `useNavigationOverlay`'s `handleClick` invokes the handler it is given with two
  arguments — the record, and an optional modifier payload (`metaKey` / `ctrlKey`
  / `button`) a host needs to implement Cmd/Ctrl/middle-click. objectui#9360 made
  the hook's own option say so. These components pass a host-supplied prop
  straight into that option, so the value a host writes against them is invoked
  with two arguments too — and every one of these props declared only the record.
  The payload was therefore invisible on the one line a host reads, exactly as it
  had been on the hook.
  
  Thirteen declarations across nine packages now name both parameters:
  
  - `ObjectGridComponentProps.onRowClick`
  - `ObjectKanbanComponentProps.onRowClick` (its sibling `onCardClick`, the other
    arm of the same fallback, already declared both)
  - `KanbanRendererProps.schema.onCardClick`
  - `ObjectCalendar`, `ObjectGantt`, `ObjectMap`, `ObjectTree`: `onRowClick`
  - `ObjectTimeline`: `onRowClick` and `onItemClick`, the two arms of one fallback
  - `ListView.onRowClick`
  - `ObjectGallery`: `onRowClick` and `onCardClick`, likewise two arms of one
  - `RelatedList.onRowClick`
  
  **Source-compatible, and with no refused class.** A one-parameter handler is
  still assignable to the widened signature, and a handler written against the
  widened signature was already assignable to the narrow one — its minimum
  argument count is still one. The second parameter is spelled `any` rather than
  `HandleClickModifiers`, which is the difference that matters for callers: the
  hook's own option names that interface and therefore refuses a handler whose
  second parameter is annotated narrower (objectui#9360 documents that class and
  the one-line remedy). These faces refuse nothing. A host that discovered the
  payload from the implementation and annotated it `React.MouseEvent` — which is
  what actually arrives — keeps compiling. `any` is also the spelling
  `ObjectKanbanSchema.onCardClick` already carries for this same payload
  (objectui#9341) and the one `BaseSchema`'s own `onClick` / `onChange` /
  `onSubmit` use, and it is forced on the published twins in `@object-ui/types`,
  which may not name a type that lives in a package depending on them.
  
  **Runtime behaviour is unchanged.** Nothing is newly called and nothing newly
  passes an argument; only the declarations move.
  
  Three declarations that share the name and the shape are deliberately NOT
  widened, because the value flowing through them is not invoked with the
  payload: `VirtualGrid.onRowClick`, whose second parameter is a row index;
  `ManageViewsDialog.onRowClick`, which receives a view id; and the `data-table`
  family (`DataTableSchema.onRowClick`, `ObjectDataTableSchema.onRowClick`),
  whose renderer invokes with one argument. Widening those would have declared a
  payload that never arrives.

### Patch Changes

- 2252653: fix(plugin-map): the top-level-`style` warning now prescribes a spelling the runtime reads
  
  `warnOnTopLevelStyleUrl` fires when a map node carries a string `style` — the base
  schema's inline-CSS key, which is never read as a map style — and tells the author
  where to write it instead. Its last sentence ended "spell it `map: { mapStyle }`
  there". `ObjectMapConfigSchema` does not declare `mapStyle`, so neither view
  flattener's whitelist carries it and `getMapConfig` never reads it: an author who
  obeyed the correction wrote metadata that was discarded a second time, with no
  second diagnostic. That text is read at the moment the author is ALREADY being
  corrected, which is why prescribing refused metadata there was ruled out for a
  sibling sink (objectui#9031).
  
  The remedy now names the declared block — `map: { style: 'URL' }` — on the node
  path and on the view path alike. That is also what moved underneath it: since
  objectui#9950 both flatteners carry a declared `style` out of `options.map` under
  its flat spelling `mapStyle`, so a view's declared block arrives and is read, and
  neither producer of an `object-map` node emits a top-level `style` any more. The
  sentence had gone on describing the pre-#9950 transport.
  
  ⛔ The remedy is no longer defended by a string assertion — that is how it rotted
  in the first place, green the whole time because nothing executed it. Every key it
  prescribes inside a `map` block is now parsed out of the warning the component
  really emits and written into a real `map` block, measured end to end through the
  declared block and through the real `ListView` flatten, so the sentence and the
  runtime cannot drift apart without a test going red.
- 875ee61: fix(plugin-calendar, plugin-map, plugin-gantt): the registrations' `inputs` agree with the record-source rule
  
  All three blocks read their records from one of `data`, `staticData` and
  `objectName` (in that order), and their `@object-ui/types` zod schemas enforce
  "one of the three" through `requireRecordSource`. The designer-facing `inputs`
  on the registrations disagreed with that rule in two ways:
  
  - `object-calendar` and `calendar` still declared `objectName` as required, so
    the html tier's validator reported a `missing-required-prop` error on a
    calendar authored on `staticData` or `data`, which the schema accepts and the
    renderer draws. `objectName` is now declared without `required`, and its
    description states the rule, as objectui#7470 did for map and gantt
    (objectui#10392).
  - `object-map`, `map` and `object-gantt` did not declare `data` or
    `staticData`, so the validator reported a block authored on either as an
    unknown prop. At this change both were declared on all three, on the schema's
    own arms: `data` is a `{ provider, … }` data-source configuration (an object,
    so a bare array there draws a type diagnostic, matching the schema), and
    `staticData` is an array of records. Each description says what the renderer
    does with the key, including that the map does not implement the `api`
    provider (objectui#10394).
  
    ⚠️ **Dated note, 2026-09-25 — the bare `map` registration has since been
    retired — objectui#10393.** Later in this same release `@object-ui/plugin-map`
    stopped registering the bare `map` key (and its namespaced twin `view:map`),
    so `map` declares nothing: a node authored `"type": "map"` resolves no
    renderer, and the html tier reports it as `unknown-component`. The
    `object-map` and `object-gantt` registrations keep both inputs exactly as
    described above. The rest of this entry is kept as the reading of this
    change; the objectui#10393 entry states what ships.
  
  The renderers' read order and the zod schemas are unchanged. The
  `@object-ui/plugin-gantt` README sentence that listed the registration's inputs
  is updated.
  
  **Correction, 2026-10-01 (objectui#11117).** "One of the three" now has an exception on all
  three blocks: a block that declares none of them is accepted when its `dataSource.object` names
  the object, because the registration's `ElementDataSourceGate` lands that name on `objectName`.
  The `objectName` input description now says so.
- c5d715f: A map marker's description no longer crashes the popup when `descriptionField` names a lookup.
  
  `ObjectMap` copied the raw `descriptionField` value onto each marker. The popup and
  the mobile record sheet put that value in JSX, and the search box called
  `.toLowerCase()` on it. A lookup is a field like any other, and `ObjectMap`'s own
  object fetch expands every declared relation, so a lookup-typed description arrived
  as `{ id, name }`. React then threw `Objects are not valid as a React child` on the
  first marker click. A number or a boolean description made the search box throw as
  soon as anyone typed.
  
  The marker transform now derives the description once, as a display string, through
  `@object-ui/core`'s `recordDisplayValueAt`. That is the resolver the marker title
  already uses for an authored `titleField`. The popup, the mobile record sheet and
  the search all read that one string:
  
  - an expanded lookup shows its display name;
  - a bare id shows as itself, as before;
  - a number or a boolean shows as its string, so `false` now appears where the old
    truthiness gate dropped it;
  - an empty or whitespace-only value, or an expanded record with no display name,
    shows no description line.
  
  No schema or spec key changes. `ObjectMap.descriptionDisplay-10456.test.tsx` pins
  each case above.
- 02e6d36: Five more page blocks re-read when the data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a write to the object they read (objectui#10623). These blocks read neither `onMutation` nor the bus, so any write — through the data source or past it (a page action over raw HTTP, a flow, a server action) — showed only when something remounted them. Each fetch effect now names the `useDataInvalidation` nonce for its object; an unscoped change (`'*'`) matches too, and a change to another object does not.
  
  - `@object-ui/plugin-timeline`: `object-timeline` re-reads its rows; a canvas that already shows rows stays mounted while the re-read runs.
  - `@object-ui/plugin-list`: `object-gallery` re-reads its cards; collapsed groups stay collapsed.
  - `@object-ui/plugin-map`: `object-map` re-reads the markers it is showing without its loading placeholder, so the map stays mounted and the camera stays where the user left it. If that re-read fails, the last markers stay on the map and the failure is logged to the console, as `ObjectGantt`'s background refresh does. A changed query still shows the placeholder and re-fits the camera, even when a bus event arrives with it. Two older faults in the same fetch are fixed as well: a slow earlier answer can no longer overwrite a newer one, and a load that succeeds now takes the map off an earlier error screen.
  - `@object-ui/components`: `element:number` re-reads its aggregate and `element:repeater` its rows.
  
  Rows a host hands these blocks (`data`, `bind`, authored `items`, an inline `value` set) are still the host's to refresh; only the blocks' own queries follow the bus.
- 7afc81d: An `object-map` block reads its records once per mount, and that read already carries the lookup expansion (objectui#10664).
  
  The map loaded the object definition in an effect of its own and listed it among the fetch effect's dependencies. The definition lands after the first query, so every mount issued two `find` calls, the first without `$expand`. Switching the bound object also sent the new object's query with the previous object's expansion. The map now reads the definition through `useSettledSchema` from `@object-ui/react`, and its object query waits until that read settles, the way `object-timeline` (objectui#7895) and `object-gallery` (objectui#7903) already do. A definition read that fails, or an adapter with no `getObjectSchema`, settles with no definition, so the map still loads, unexpanded. Host rows (`data`) and an inline `value` set are not held.
- f9c06ef: Every data node that sends its own authored `filter` into a query now resolves the spec's context tokens first (objectui#10666). With `filter: [['owner', '=', '{current_user_id}']]` these nodes used to send the literal token; they now send the signed-in user's id, and `{current_org_id}` resolves to the active organization:
  
  - `object-calendar`, `object-map` and `object-tree`, on both the object query and the inline (`provider: 'value'`) query;
  - `object-gantt`, `object-kanban` and `object-timeline`;
  - `record:related_list` and `record:line_items`, where the node's own filter is combined with the parent-record condition;
  - the `element:repeater`, `element:number` (both the `aggregate` filter and the `find` fallback) and `element:record_picker` page elements.
  
  `list-view`, `object-grid` and `object-gallery` already did this, and are unchanged.
  
  **New in `@object-ui/react`: `useResolvedFilter(filter, scope)`.** Pass it a node's authored filter and `useFilterScope()`. It resolves the filter through `@object-ui/core`'s shared `resolveFilterPlaceholders` and holds the result: re-rendering with an equal filter (even one rebuilt inline on every render) hands back the same value, so a fetch effect keyed on it does not run again, while a structurally different filter or a change of signed-in user or organization resolves again. A filter with no token to resolve is handed back as the value you passed in. The hold is the one `list-view` and `object-gallery` used privately; `plugin-list` now imports it from here, and no second copy remains in that package.
  
  What changes for an app:
  
  - A filter with no placeholders reaches the query as before, unchanged.
  - Nodes that re-queried whenever the host rebuilt an equal filter inline (`object-calendar`, `object-gantt`, `object-kanban`, `object-map`, `object-tree`) no longer issue those redundant queries.
  - Date macros such as `{today}` in these nodes' own filters are now resolved in the browser's local time, as they already are for `list-view`, `object-grid` and `object-view`. Before, they reached the server as literals, and the server resolved them in the tenant's time zone.
  
  `@object-ui/types`: the `filter` docblocks on `ObjectMapSchema`, `ObjectTreeSchema`, `ObjectGanttSchema`, `ObjectCalendarSchema`, `ObjectKanbanSchema`, `ObjectChartSchema` and `ObjectGallerySchema` (and the matching zod descriptions) no longer say the filter is forwarded verbatim; they say its context tokens are resolved first. No type changes.
- 997ce38: docs(plugin-map): authored `object-map` examples write their props in the `properties` bag, and the `objectName` input names the `dataSource` binding (objectui#10859, batch 5)
  
  - The README's authored `object-map` examples now write `{ "type": "object-map", "properties": { … } }`, the spelling `@objectstack/spec`'s `ComponentPropsMap['object-map']` row declares and `objectui validate` now requires. The example that mounts `ObjectMap` directly keeps the flat `schema` prop: a component mounted without `SchemaRenderer` receives the node as it reads it, and nothing hoists a bag there.
  - The registration's `objectName` input description names the node's `dataSource` binding beside `data`, `staticData` and `objectName` as a record source, because the authored arm now counts it. No runtime change.
- 20d23be: `object-map` reads `mapStyle` before `map.style`, as `@objectstack/spec`'s `object-map` row says in `mapStyle`'s own description ("Read before `map.style`"). This is objectui#11168 slice 3, under the seat's ruling: the renderer follows the spec.
  
  **Behaviour change.** A map that writes both a node-level `mapStyle` and a `style` inside its `map` block now draws `mapStyle`. Until now, the block's `style` won on that path. A map writing only one of the two, or neither, draws exactly what it drew before. The map path with no `map` block already read `mapStyle` first.
  
  No authored producer in objectui or objectstack writes both. The only producers of `mapStyle` are the `ListView` / `ObjectView` flatteners, and they write it on the path with no `map` block. So no stored document changes what it draws. The `object-map` registration publishes the spec's description for `mapStyle` verbatim.
- 3c3ce15: Small reader sites stop riding `BaseSchema`'s index signature (objectui#11355, part of the preparation for objectui#8347's removal of that signature). Each key was measured on its own.
  
  **Two keys are now declared, each with a spec row's type, by reference.**
  
  - `ObjectKanbanSchema.swimlaneField`. The installed `@objectstack/spec` declares it on the `object-kanban` row as an optional string, `ObjectKanban` reads it, and the registration publishes it as an input. The TypeScript member takes the row's type, and the zod mirror now refuses a non-string `swimlaneField` where `.passthrough()` used to keep it unjudged. `grouping`, the read's fallback, is still undeclared; aligning it with the spec's typed row is objectui#11216.
  - `DetailViewSchema.showHeader`. `detail-view` has no spec row. `DetailView` reads the key, and its producer is `record:details`, which writes its own spec-declared `showHeader` onto the `detail-view` node it builds. So the member takes the `record:details` row's type, and the two cannot drift apart. The zod mirror declares it too. The defaults are unchanged: a bare `detail-view` draws its heading unless `showHeader` is `false`, and `record:details` keeps its own default of off.
  
  **Two reads are typed where they stand, with no behaviour change.**
  
  - `@object-ui/cli`: `objectui validate` reads a parsed node's `title` only where the node carries one. The read used to span every arm of the parsed union. The printed output is unchanged.
  - `@object-ui/plugin-map`: the dev warning about flat map keys that a `map` block shadows reads those keys through their own type, not through a `Record` conversion.
  
  **minor, not patch, for `@object-ui/types`.** Both members are new in the shipped `.d.ts` and in the zod mirror's `.shape`, and the mirror now refuses a wrongly typed value for each, where it used to keep one unjudged.
  
  ⚠️ **Dated note, 2026-10-03 — `ObjectKanbanSchema.grouping` is now declared — objectui#11216.**
  At this change `grouping`, the fallback `ObjectKanban` reads for `swimlaneField`,
  was undeclared on both faces, as the first bullet above says. objectui#11216
  declares it on both faces in this release, by reference: the TypeScript member is
  the spec's `GroupingConfig`, and the zod mirror takes the spec's
  `GroupingConfigSchema`, the type the `object-kanban` row gives the key. So the
  sentence above that calls `grouping` "still undeclared" does not hold in this
  release. The rest of this entry is kept as the reading of this change.
- 39f4309: Published typings from every `vite-plugin-dts` package now carry an explicit extension on
  every relative specifier, and a type error in the declaration build now fails the build
  instead of being printed and ignored (objectui#5439, objectui#5483).
  
  **Consumers on `moduleResolution: nodenext` or `node16` may see NEW type errors, and that
  is the fix working.** These packages re-export mostly through NAMED re-exports —
  `export { useObjectChat } from './useObjectChat'`. TypeScript could not follow the
  extensionless hop, but it still DECLARED the name, so the symbol resolved to a silent
  `any`. Nothing errored; consumers simply got no types. With the extension emitted, the
  symbol carries its real type, and any call site that was relying on the `any` now type
  checks for the first time. This is the mode that produced the 21 residual `TS7006` on
  `@object-ui/app-shell` reported against objectui#5365 — a type hole that opened quietly,
  unlike objectui#5365's own `export * from './ui'` packages where the same defect surfaced
  immediately as `TS2305: has no exported member`.
  
  410 extensionless relative specifiers across 19 packages were emitted before this change;
  the count is now 0 in all 22 packages that build typings through `vite-plugin-dts`.
  `@object-ui/fields` was already clean — its sources write explicit `.js` specifiers — and
  is wired so it stays that way.
  
  The second half changes no emitted output today: 22/22 packages built green unmodified, so
  making the declaration step's exit code honest turns nothing red. It changes what a FUTURE
  regression does — print and exit 0, versus fail the build.
- 0a2918f: The package README stops documenting a marker-title fallback that objectui#5953 replaced.
  
  `README.md`'s `map` block table described `titleField` as: "Omitted, markers are
  titled `Marker`." That was true of the pre-#5953 read site, which bound the
  marker title to a field name directly. objectui#5953 moved the marker title onto
  `@object-ui/core`'s `getRecordDisplayName`, and `'Marker'` is now passed only as
  that resolver's `fallback` option — a position the resolver reaches **only for a
  record carrying no id at all**. A record with an id and no resolvable name reads
  `Record #<id>`; a record whose object declares a `nameField` or a `titleFormat`,
  or which simply carries a name-ish key, reads that. So "omitted ⇒ `Marker`" was
  true in one narrow corner and false in the common case, and an author reading the
  row would either under-specify `titleField` for a reason that stopped being true
  or over-specify it to avoid a `Marker` that would never have appeared.
  
  The row now names the precedence an omitted `titleField` hands the decision to:
  the declared `nameField`, its deprecated `displayNameField` alias, the legacy
  `titleFormat` template, a type-aware pick from the object's fields, then
  name-ish keys read straight off the record — with `Record #<id>` as the floor and
  `Marker` reached only by an id-less record.
  
  Two details the row states deliberately:
  
  - It does **not** describe an object-level `objectDef.titleField` rung. The
    resolver consulted one at step 0 as a second `??` leg, but objectui#6531 (PR
    #6560) removes it — `@objectstack/spec`'s object schema is a `strictObject`
    that rejects the key with `unrecognized_keys`, so no producer can ship it.
    What survives is `options.titleField`, which is exactly what `map.titleField`
    becomes at `ObjectMap`'s call site, so "a declared `titleField` wins" stays
    true either way and the row does not go stale when that lands.
  - It names the record-key probe (the resolver's step 4b) as its own rung. That
    is not a footnote for this component: `ObjectMap` fetches an object schema
    only when `!hasInlineData && dataSource`, so for `staticData` or an inline
    `data` array no object definition ever reaches the resolver and the record-key
    probe is the only rung that can produce a title —
    `ObjectMap.markerTitle.test.tsx` pins exactly that case.
  
  A second row falsified by the same commit goes with it. Two lines below the table,
  the field-name defaults paragraph listed what an unconfigured map falls back to as
  "`latitude` / `longitude` / `location` / `name` / `description`". objectui#5953 removed
  the title default: `getMapConfig`'s default branch returns coordinate keys and
  `descriptionField` only, under a comment that spells out why — "Deliberately NO
  `titleField` (objectui#5953)… `getRecordDisplayName` resolves it from the object
  definition, and it does so better than any literal here could". The paragraph now
  lists the four defaults that exist and says where an unconfigured marker's title
  actually comes from. Left alone in the same sentence: `map: { titleField: 'name' }`
  still names no coordinate field and still renders an empty map, which is accurate.
  
  Prose only: no behaviour changes, and the placeholders were already pinned in
  order by `ObjectMap.markerTitle.test.tsx`.
- f9653ae: Re-key the load-bearing fetch effects in `ObjectMap`, `ObjectCalendar` and
  `ObjectGantt` onto the primitive fields they actually read off `dataConfig`
  (`provider` / `object` / `items`) instead of the whole memoised `dataConfig`
  object (objectui#6592, the deferred half of objectui#6270/PR #6591).
  `ObjectTree` is a census member too but is deferred out of this change — see
  the PR body — because its own fetch effects are the surface of PR #6696
  (objectui#6481), open at the same time.
  
  `useMemo` carries no semantic guarantee — React is permitted to discard a
  memo cache and recompute even when its dependency array compares equal to
  the previous render, and the local `getDataConfig(schema)` helper each of
  these renderers carries builds a fresh `{ provider, object }` /
  `{ provider, items }` wrapper object on every call. So a fetch effect keyed
  on `dataConfig` itself was correct only for as long as that identity
  happened to survive a discard: a recompute alone (no author or caller
  action) was enough to re-run the effect and issue an extra
  `dataSource.find` / `dataSource.getObjectSchema` call. Keying the effects
  on the primitives instead makes a cache discard a no-op, restoring
  `useMemo` to a pure optimisation.
  
  `ObjectGantt`'s `effectiveDataSource` memo deliberately keeps `dataConfig`
  as a dependency (`resolveDataSource` needs the whole provider-shaped
  value — the `api` provider's `read`/`write` request config cannot be
  flattened to a fixed primitive list the way `object`/`value` can), so its
  `reload()` fetch is decoupled from the redundant direct `dataConfig`
  dependency but not from `effectiveDataSource`'s own; for the `object`/`value`
  providers `resolveDataSource` returns its `fallback`/a fresh
  `ValueDataSource` respectively rather than reading further into the config,
  which is enough for the two fetch effects to observe no extra call under a
  recomputed-but-equivalent `dataConfig` in the common case.
  
  No behaviour change for a schema whose `useMemo` caches survive normally;
  the effects are unaffected by React discarding one.
- 3beef6d: The spec's `dataSource` element binding is now DECLARED by the blocks that read
  it, so the html tier stops reporting the one working saved-view spelling as
  `unknown-prop` (objectui#6678).
  
  `PageComponentSchema.dataSource` — `{ object, view, filter, sort, limit }` — is
  the one spelling that resolves a saved view for an object-bound block. It works,
  and it drew the identical `unknown-prop` warning as the two spellings that do
  nothing (`viewName`, `view`), because `validateTree` looks a prop up in the
  block's declared `inputs` and no registration declared this key. On the tier
  built to accept AI-authored pages, where the diagnostic IS the contract, the
  only signal pointed away from the key that works.
  
  Adopting the maintainer ruling of 2026-08-29 — option B **in the injection
  form**:
  
  - `ELEMENT_DATA_SOURCE_INPUT` is the single declaration, in `@object-ui/core`
    beside the binding's own semantics; `Registry.register` emits it for any
    registration whose renderer passed through the new `elementDataSourceBlock()`
    seam. One mechanism, one copy — not a hand-kept declaration per block, which is
    the shape that drifts and that a new block forgets. The seam lives in
    `@object-ui/core` and is re-exported by `@object-ui/react` beside
    `ElementDataSourceGate` for discoverability; call sites take the core import,
    because a registration runs at module scope and this repo's suites partially
    mock `@object-ui/react`.
  - Seventeen renderers, in thirteen files across twelve packages, reach the seam
    and now publish the key to the save gate, the parser whitelist, the generated
    JSX authoring types and the block list. The card named nine blocks; the tree
    also has `plugin-grid`, `plugin-timeline`, two further `plugin-form` blocks and
    `element:record_picker` — nothing was hand-listed, so the mechanism covered
    them. `element:record_picker` consumes the gate's HOOK and status panels rather
    than the wrapper tag (its object lives under `properties`), and was found by a
    render probe rather than by reading sources.
  - `dataSource` on a block that does NOT read it (`flex`, `card`) still reports
    `unknown-prop`. Adding the key to `sdui-parser`'s `BASE_PROPS` was refused for
    exactly this reason — that set mirrors `BaseSchema`, and silencing the key
    everywhere would make the diagnostic lie in the other direction.
  - New `check:element-data-source-declaration` fails any source that consumes the
    gate without reaching the seam, so a block added tomorrow cannot forget.
  
  Behaviour of the binding itself is unchanged — this is a declaration, not a
  resolution change. The saved view still resolves its columns, and an
  unresolvable `view` still fails loudly rather than widening to the object's full
  scope.
  
  The spec/registry parity gates (repo-wide and the `record:related_list` per-block
  pin) now derive their accepted set from the WHOLE node contract rather than from
  `ComponentPropsMap[type]` alone. `PageComponentSchema` accepts and keeps
  `dataSource` on a page-component node — it is a node-level key, a sibling of
  `type` and `className`, not a per-block prop — so the gates' previous complaint
  was measurably wrong. Derived from the spec, not exempted, and both still
  discriminate against an invented key.
- d327b9c: FLS-gate the `$expand` projection at the seven remaining `buildExpandFields`
  call sites (objectui#7429).
  
  objectui#7215 / PR #7229 gated the two projection sites in its scope
  (`ObjectGrid`, `ListView`). objectui#7230 / PR #7428 gated four more
  (`ObjectCalendar`, `ObjectGantt`, `RecordDetailView`, `DetailView`). This
  closes the seven that were left: `ObjectKanban`, `ObjectTree`, `ObjectView`
  (the non-grid record-fetch effect), `ObjectMap`, `ObjectGallery`,
  `ObjectTimeline`, and the metadata-admin `PagePreview`'s record-binding fetch.
  
  **All seven pass no column list at all**, which makes every one of them the
  sharp shape: `buildExpandFields` reads an absent column list as "no column
  restriction" and falls back to **every declared relation on the object**,
  denied ones included. So each of these components asked the server to resolve
  the object's full relation set by default, not by configuration — the
  ordinary shape of each surface, not a corner of it.
  
  **`PagePreview` is the one site where the judged principal is not the page's
  eventual audience.** It calls the browser's own `fetch` with
  `credentials: 'include'` rather than `DataSource.find`, so it runs under
  whichever session is loading the Studio preview. Gating on that same session's
  `usePermissions()` is still the correct principal: it is exactly the request
  the browser is about to make, on its own credentials, regardless of who later
  opens the published page.
  
  **Reproduced before it was fixed**, as a failing test per site (and, for the
  two sites — `ObjectView`, `PagePreview` — where the gate was implemented
  before its test was run red, a reverse-verification: the gate was reverted,
  all four denial-and-set pins on each went red, and the two deferral/positive
  control pins stayed green, before the gate was restored).
  
  **Grading, measured rather than assumed** — the same reading objectui#6898,
  #7215 and #7230 recorded: against ObjectStack's own server this is
  defence-in-depth, not a live disclosure. `plugin-security`'s
  `FieldMasker.maskRecord` deletes every unreadable key from each returned row
  and objectql's expand path writes the resolved record back under that same
  key, so one statement removes the expanded object and the bare id alike; the
  expansion sub-read is itself gated (the referenced object's full CRUD + RLS +
  FLS treatment, objectstack#7626). It is load-bearing for any backend that does
  not strip, and the client-request side is real regardless.
  
  **Nothing a permitted view did stops working.** The gate judges each site's
  `buildExpandFields` OUTPUT, which contains only the object's declared
  reference-bearing fields, so the "`checkField` answers false for an
  undeclared key" trap cannot be reached. An unanswered permission policy
  filters nothing. `buildExpandFields` itself is unchanged.
  
  `@object-ui/permissions` is added to `dependencies` for `plugin-kanban`,
  `plugin-tree`, `plugin-map`, `plugin-timeline`, and `plugin-view` — the fifth
  one objectui#7429's own dependency count missed (it named four); `plugin-list`
  and `app-shell` already had it.
- 3ef0b51: fix(plugin-map, plugin-gantt): the registrations no longer declare `objectName` a required input
  
  Both renderers read their records from one of three keys (`data`, then
  `staticData`, then `objectName`), and the `object-map` / `object-gantt` zod schemas
  enforce "one of the three" through `requireRecordSource` (`77cb489b4`). The
  registrations' designer-facing `inputs` still said `objectName` was required, on
  `object-map`, `map` and `object-gantt`, so the html tier's validator reported a
  `missing-required-prop` error on a block authored on `staticData` or `data` that
  the schema accepts and the renderer draws.
  
  `objectName` is now declared without `required`, and its description states the
  rule: the record source is one of `data`, `staticData` and `objectName`, and the
  schema refuses a block that declares none of them. No one-of form was added to the
  input declaration; the zod refinement stays the place that enforces it. The
  renderers' read order is unchanged. The `@object-ui/plugin-gantt` README sentence
  that called `objectName` required is corrected (objectui#7470).
  
  **Correction, 2026-10-01 (objectui#11117).** The rule this entry describes gained an exception:
  the `object-map` and `object-gantt` schemas also accept a block that declares none of the three
  when its `dataSource.object` names the object, because the registration's `ElementDataSourceGate`
  lands that name on `objectName`. The `objectName` input description now says so.
- c6198c2: **Breaking for authored metadata:** `ComponentInput.label`, `ComponentInput.defaultValue` and
  `ComponentInput.advanced` are RETIRED on both faces (objectui#7493 item ① and objectui#7781;
  maintainer ruling A of 2026-09-06, immediate, no deprecation window; ADR-0049 enforce-or-remove).
  They are the three keys the manifest serializer does not forward, and nothing read them on any
  publication or consumption path.
  
  No manifest ever published them, so no consumer could ever have read them. `sdui-parser`'s
  serializer (`packages/sdui-parser/src/index.ts`) forwards exactly seven keys per input — `name`,
  `type`, `of`, `required`, `enum`, `binding`, `description` — so a value authored under any of the three
  never reached `sdui.manifest.json`, the generated JSX `.d.ts`, or a diagnostic; its boundary type
  has no slot for them; the registry's data-source seam reads `name` only; and neither the designer
  nor the app-shell inspectors consult registry `inputs` at all. A structural census over every
  `inputs:` array in the repository (re-measured on this change's merge-base, `name` 951 and `type`
  951 as the controls) counted the writes: `label` 908, `defaultValue` 245, `advanced` 9 — written on
  nearly every registration, read by nothing.
  
  FROM → TO, per key — all three **TOMBSTONED, not removed**, because the route was measured on
  the built face before it was chosen: `ComponentInputSchema` is a non-strict `z.object`, and an
  undeclared key parses GREEN and is silently STRIPPED, so a deletion would have swallowed 1,162
  authored values in silence. The tombstone is what makes the refusal loud and by name.
  
  - `label?: string` → `label?: never` on the interface, `retirementTombstone()` on the Zod mirror.
    Migration: delete the key. An input is identified by its `name` on every path that reaches it;
    nothing ever rendered a label for it.
  - `defaultValue?: any` → `defaultValue?: never` / `retirementTombstone()`. Migration: delete the
    key. The renderer's own fallback read IS the default; tell the author about it in `description`,
    which IS published. (Tightening the type to `unknown` was ruled out: it closes no error class,
    since nothing reads the value.)
  - `advanced?: boolean` → `advanced?: never` / `retirementTombstone()`. Migration: delete the key.
    No designer surface ever hid an "advanced" input; there is nothing to write instead.
  
  The retirement kit: `?: never` on `ComponentInput` (`packages/types/src/base.ts`), so authoring one
  is a `tsc` error at the registration site; `retirementTombstone()` on `ComponentInputSchema`
  (`packages/types/src/zod/base.zod.ts`), so an authored value is REFUSED at parse time with
  `code: 'invalid_type'`, the key named in the issue `path`, and the migration note as the message
  (one string, both channels). Pinned in
  `packages/types/src/__tests__/component-input-retired-keys-7493.test.ts`, which also holds a
  tree-scoped absence census over every `inputs:` array under `packages/**` and `apps/**`.
  
  Accept-set change, stated plainly for reviewers: a document that sets any of the three keys on a
  `ComponentInput` used to parse GREEN (the value was then dropped by the serializer) and now parses
  RED. Every in-repo authoring site — 1,199 keys across 110 registration files, the three standalone
  `ComponentInput[]` arrays and the two named input arrays `tsc` found included — is deleted in the same change, as the ruling's split rule
  requires; the `WidgetRegistry` seam no longer copies the widget-manifest values onto the synthesized
  `ComponentInput` (they fed nothing), and the data-source declaration `ELEMENT_DATA_SOURCE_INPUT`
  drops its `label`. The patch entries on the other packages record exactly that: their registrations
  stop authoring inert keys, with no runtime or published-manifest change.
  
  The nine test files that read `defaultValue` off a registration were re-pinned against the
  renderer's ACTUAL default (its own fallback read, or the `defaultProps` it ships) instead of the
  declaration that went away; two assertions that only restated the shadow default were dropped with
  the reason on the line.
  
  The in-repo zero is what was measured. Whether anything OUTSIDE this repository writes these keys
  is not measurable from here (the objectui#5674 limit); converting such a write from a silent drop
  into a named refusal is exactly what the tombstones buy. `WidgetInput`'s own `label` /
  `defaultValue` / `advanced` (the widget-manifest face) stay declared and writable — nothing has
  ruled on that face; that it now has no reader either is recorded as objectui#7911.
- ce2aaef: One shared record-source ladder, five plugins delegate.
  
  `@object-ui/core` publishes `resolveRecordSourceConfig(schema)` — the ONE implementation
  of the ruled three-rung record source ladder: `data` first, then `staticData` wrapped as
  `{ provider: 'value', items }`, then `objectName` folded to `{ provider: 'object' }`, and
  `null` when nothing is bound. It is the PRODUCER whose output the reader
  `resolveRecordSourceObjectName` (`b041b9c0c`) consumes, and it now sits beside it in the same module.
  
  That ladder is published contract on both faces — `packages/types/src/objectql.ts` and its
  zod mirror both ship `.describe()` strings naming `getDataConfig`'s order (`77cb489b4`,
  maintainer ruling 2026-09-02), pinned by `objectql-record-source-refinement-6939.test.ts` —
  and it was hand-copied into five plugin components with no gate holding them together. A
  change to the ruled order had five edit sites and nothing that noticed a missed one; that
  is the AGENTS.md #0.1 drift class.
  
  **No behaviour changes.** `ObjectCalendar`, `ObjectGantt` and `ObjectTree` now call the
  shared reader directly. `ObjectGrid` and `ObjectMap` keep their own bare-array `data`
  shorthand as a documented head above the shared call and are otherwise unchanged.
  `record-source-config.behaviourNeutrality-7632.test.ts` transcribes all five pre-collapse
  bodies verbatim and asserts the post-collapse spelling agrees with each across the whole
  input matrix, so a later edit to the shared reader that moves any site turns red.
  
  **Two divergences were measured rather than assumed, and both are preserved.**
  
  `ObjectCalendar`'s `'data' in schema && schema.data` guards existed because its parameter was
  at that time the union `ObjectGridSchema | CalendarSchema`, whose `CalendarSchema` arm declared
  neither key. (objectui#8651 has since re-pointed that parameter at the published
  `ObjectCalendarSchema`, so the union is gone; the CONCLUSION below — that the guard had no
  runtime effect and removing it is behaviour-neutral — is unaffected.)
  That is a TypeScript narrowing device with no runtime effect — an absent property reads
  `undefined`, falsy either way — so the guard could never change which rung is taken. The
  shared reader's optional-property parameter accepts the union directly, and the
  equivalence is pinned on a fixture that really lacks both keys rather than argued.
  
  `ObjectGrid` and `ObjectMap` normalize a bare-array `data` to `{ provider: 'value', items }`;
  `ObjectCalendar`, `ObjectGantt` and `ObjectTree` do not, and return the array verbatim. That
  is a real divergence on off-contract input — `ViewData` is a discriminated union over object
  variants, so an array under `data` cannot be published. It is NOT unified here: the shared
  rung stays contract-strict and the two sites keep the head locally, the same way `b041b9c0c`
  left the off-contract `{ provider: 'object' }` tails at their sites. Both sides of the fork are
  pinned, so neither folding the head in nor deleting it as redundant can happen silently.
  
  `ObjectTree`'s copy took `schema: any`; it now goes through the shared reader's typed
  parameter. Types are erased at runtime, so nothing it resolves moves.
- 9a853f2: Retire the legacy string `sort` clause: one spelling, the array
  (objectui#8221) — `convertSortToQueryParams` now REFUSES `"name desc"` with a
  diagnostic naming `[{ field: 'name', order: 'desc' }]`, instead of lowering it.
  
  **BREAKING for `@object-ui/core` consumers — scored `minor`, not `major`, per
  AGENTS.md 版本号策略** (every package is in one fixed group, so a `major` here
  would carry all 39 off the `@objectstack` major this repo is pinned to). The
  breaking semantics are stated below rather than encoded in the version.
  
  Director ruling, decision batch #77 (2026-09-07), option B. Three faces
  disagreed about one key: `@object-ui/core` implemented the string clause
  on purpose (`sort-query.ts`, docblock and all), `content/docs/plugins/plugin-map.mdx`
  taught it as `sort?: string | SortConfig[]`, and the html tier answered
  `type-mismatch` for it because all seven `sort` registrations publish
  `type: 'array'` alone — while `@objectstack/spec` refuses the string outright on
  `element-record-picker`. Option A (per-block string arms) was rejected by name:
  it would make one key mean different things on different blocks.
  
  **What moves.** `convertSortToQueryParams(sort)` narrows from
  `string | QuerySortEntry[]` to `QuerySortEntry[]`, and the three declarations
  that published a string arm narrow with it — `ObjectGridSchema.sort`,
  `ObjectMapSchema.sort` and `ObjectGanttSchema.sort`, in the TypeScript face AND
  in the zod mirror, together, because a narrowing that left `z.string()` in the
  mirror is the declared-vs-enforced split this change exists to close. The local
  `sort` declarations on `LineItemsPanel`, `ObjectTimeline` and
  `deriveRelatedLists`'s ListView input narrow the same way.
  
  **What a string does now.** Types are erased, so the signature stops a string
  only at compile time; authored JSON and stored `sys_metadata` rows still reach
  the sink carrying `"name desc"`. Such a value is REFUSED — the query carries no
  `$orderby` — and `console.error` names the array form, quotes what arrived and
  states the consequence, once per spelling. A silent `undefined` was the one
  outcome the ruling ruled out.
  
  **Measured consequences you may see.** A related list that inherited its child
  object's default list-view sort in the legacy spelling stops inheriting it (the
  console says so). `@objectstack/spec@17.3.0` still ACCEPTS the string on
  `ListViewSchema.sort` and on `RecordRelatedListProps.sort`, so such metadata is
  still spec-legal today; the spec-side pull-back is its own card. Two surfaces
  are deliberately untouched, because they are a DIFFERENT string dialect that
  never reaches this sink: `record:related_list`'s `'field'` / `'-field'` form,
  normalized by `RelatedList.normalizeSortSpec`, and `ListView.parseSortConfig`,
  which reads the platform view record the spec still blesses.
  
  Docs teach the array only: `content/docs/plugins/plugin-map.mdx`,
  `content/docs/plugins/plugin-view.mdx` and `packages/plugin-view/README.md`.
- ff7543c: `ObjectMapProps.clusterRadius`'s JSDoc said "in pixels"; `clusterMarkers` has
  always used it as a coordinate-degree grid cell edge (`radius / 2 ** zoom`,
  divided into the marker's `[lng, lat]` degrees), not a screen-space radius —
  a host tuning clustering granularity by the documented unit would get a
  completely different result than intended (objectui#5020).
  
  No behavior, default, or name changes: clustering, the >100-visible-marker
  auto-threshold, and tap-through zoom are unaffected, and `clusterRadius` has
  no call sites outside `plugin-map/src` today (re-confirmed repo-wide,
  including `apps/`, `examples/`, and the `objectstack` spec/server repo — the
  default of `50` is what runs everywhere). This is a doc-comment correction
  only, bringing the JSDoc in line with the README's already-correct wording
  (post objectui#5002).
  
  The latitude-anisotropy trade-off (a degree grid distorts east-west as
  latitude rises) is a known design trade-off, not part of this fix.
- 2aac61f: `ObjectMap` now resolves marker titles through `@object-ui/core`'s
  `getRecordDisplayName` (ADR-0079), instead of reading a hard-coded `'name'` key.
  
  `getMapConfig` used to fill an absent title binding with the string literal
  `'name'`, and the marker transform then did a bare `record[titleField]` read. For
  every object whose display field is not literally `name`, that read was
  `undefined`, so each marker popup titled itself `undefined`. The literal is gone
  from both branches that carried it, and the read site hands the decision to the
  same resolver `ObjectKanban`, `ObjectCalendar` and `ObjectGantt` already title
  their items through — `ObjectMap` was the fourth renderer and the only one still
  outside it.
  
  An authored `map.titleField` keeps winning outright: it is passed through as the
  resolver's explicit `titleField` option, which it checks first. What is new
  underneath is everything a static field-name binding cannot express — the
  object's declared `nameField`, its deprecated `displayNameField` alias, a legacy
  `titleFormat` template, type-aware field derivation, and a name-ish probe over
  the record's own keys for the inline-data case where no object definition is
  fetched at all.
  
  Records with no resolvable name now read `Record #<id>` rather than `undefined`
  or a uniform `Marker`; the `Marker` placeholder is kept only for a record that
  carries no id either. No authoring surface changes and no new map config keys.
- b180a64: `ObjectMap` reads `schema.data` in one place again, so an array-shorthand map stops
  making a metadata request it never uses.
  
  The fetch effect carried a second short-circuit beside the `props.data` one
  objectui#5003 fixed: it read `schema.data` directly and tested whether that value was
  itself an array. eslint reported it as `missing dependency: schema.data` — the last
  `react-hooks/exhaustive-deps` warning on that effect.
  
  The dependency was never actually missing. `getDataConfig(schema)` already returns
  `schema.data` verbatim, and the result is memoized on `JSON.stringify(rawDataConfig)`
  into `dataConfig`, which **is** one of the effect's declared dependencies. The authored
  rows therefore reached the effect before this change; the direct read was a duplicate of
  an already-threaded value, which is why neither adding a dependency nor deleting the
  branch was right.
  
  The array handling moved into `getDataConfig`, where `ObjectGrid`'s own `getDataConfig`
  already pins the same normalization (`"Check if data is an array (shorthand format)"`).
  Same rows render, and the effect now reads only `dataConfig`.
  
  One behavioural consequence, and it is the point: an array under `data` now yields
  `provider: 'value'`, so `hasInlineData` is true and the sibling effect no longer calls
  `dataSource.getObjectSchema()` for it. That request's only read site is
  `buildExpandFields()` inside the object-provider fetch branch, which an inline schema
  never reaches — so the call was pure waste, and the shorthand now behaves exactly like
  the declared `{ provider: 'value', items }` form it is shorthand for.
  
  Deleting the branch instead was measured, not assumed: with no producer-side handling,
  an array-shorthand map renders `Error: DataSource required for object/api providers`
  rather than its markers. The shorthand is a live convention in six sibling blocks
  (`ObjectGrid`, `ListView`, `ObjectTree`, `ObjectChart`, `ObjectDataTable`,
  `calendar-view-renderer`), so `object-map` would have become the one block in the family
  that answers it with an error box.
- 538ed92: `ObjectMap`: make the marker `useMemo` actually memoize.
  
  `getMapConfig(schema)` ran unmemoized in the render body, so `mapConfig` carried
  a fresh object identity on every render. The marker transform names `mapConfig`
  in its dependency array, so it recomputed on every single render — walking every
  record through `extractCoordinates` and the display-name resolver, and re-running
  `ObjectMapConfigSchema.safeParse` on each pass — while declaring that it does not.
  The invalidation cascaded on into `filteredMarkers`, `clusteredData`,
  `markerBounds` and `initialViewState`.
  
  `mapConfig` is now memoized on `schema`, the one value `getMapConfig` reads.
  Behaviour is unchanged; the config is still rebuilt whenever the schema
  genuinely changes.
- cfcff30: Each package's README now states, up front, that it needs a bundler: importing it from plain Node ESM fails, and that is a supported-configuration boundary rather than a defect.
  
  `@object-ui/plugin-dashboard` imports `react-grid-layout/css/styles.css` at module
  scope and `@object-ui/plugin-map` imports `maplibre-gl/dist/maplibre-gl.css`;
  `@object-ui/app-shell` reaches the first of those through the static
  `@object-ui/plugin-dashboard` imports in `DashboardView` and `ReportView`. Node has
  no loader for `.css` at all, so all three resolve and then die during evaluation:
  
  ```
  TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".css"
    for .../react-grid-layout/css/styles.css
  ```
  
  Nothing about how these packages load has changed — every supported host bundles
  them (Vite, webpack, or Next with the package in `transpilePackages`), and that is
  still the only supported way to consume them. What changed is that the boundary is
  now written where a consumer meets it, instead of being learned from a red import.
  
  objectui#5384 ruled unbundled Node consumption **unsupported** for style-carrying
  plugin packages — permanently, over the three packages as a group — rather than
  moving the stylesheet imports out of module scope. No unbundled-Node consumer
  exists, and buying permanent machinery to close a capability gap nobody is pulling
  on was the trade the ruling declined. A real consumer request reopens it as a
  design question, not as a defect: the READMEs say so and name the issue.
- 2aa2c22: `ObjectMap` no longer serializes its data config on every render.
  
  `getDataConfig(schema)` was called bare in the render body and its result
  re-serialized with `JSON.stringify` on every render, purely to give `dataConfig`
  the stable identity its fetch effect depends on. `getDataConfig` is a pure
  function of `schema`, so `useMemo(() => getDataConfig(schema), [schema])` gives
  the same identity with no serialize and no per-render rebuild.
  
  This also fixes a crash. `JSON.stringify` throws on a value it cannot serialize,
  and the config's passthrough branch returns the author's own `schema.data`
  object verbatim — inline rows included. A map handed inline records carrying a
  back-reference (an `$expand`-ed lookup) or a `BigInt` id threw from the render
  body and took the whole map subtree down with it. Comparing identities never
  serializes, so the config no longer has to be serializable at all.
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [0aacecc]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [4ab4f1b]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [2b5f509]
- Updated dependencies [808f339]
- Updated dependencies [6cf5999]
- Updated dependencies [274e14a]
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
- Updated dependencies [cdefa2a]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [93a689d]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [c5ec15c]
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
- Updated dependencies [a60539b]
- Updated dependencies [de1b879]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [ad1785c]
- Updated dependencies [3b469c8]
- Updated dependencies [990a2d6]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
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
- Updated dependencies [deca847]
- Updated dependencies [328abeb]
- Updated dependencies [dd0d78f]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [e227156]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [4b742f4]
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
- Updated dependencies [a4b017e]
- Updated dependencies [559a2e2]
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
- Updated dependencies [c021b35]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [858eafb]
- Updated dependencies [0ffc423]
- Updated dependencies [3cc4fe5]
- Updated dependencies [cd5b19a]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [2e3da72]
- Updated dependencies [1263e40]
- Updated dependencies [e6bc087]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [7fed09d]
- Updated dependencies [58da8ae]
- Updated dependencies [a8b9889]
- Updated dependencies [138ad45]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [2124d04]
- Updated dependencies [be52115]
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
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
- Updated dependencies [2b188fa]
- Updated dependencies [b654d4e]
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
- Updated dependencies [5ccc500]
- Updated dependencies [f3c2bb0]
- Updated dependencies [978507b]
- Updated dependencies [778138e]
- Updated dependencies [9801765]
- Updated dependencies [9cebfca]
- Updated dependencies [460575f]
- Updated dependencies [d796c8d]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [194fae1]
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
- Updated dependencies [6fd2cf7]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [8f1d995]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [d7de534]
- Updated dependencies [3c2b6f7]
- Updated dependencies [6e88630]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [5961030]
- Updated dependencies [f24de8b]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [299102e]
- Updated dependencies [30c73cd]
- Updated dependencies [830ed58]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [c71e14d]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [748494b]
- Updated dependencies [5967be0]
- Updated dependencies [831be72]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [d0889e2]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [12402a9]
- Updated dependencies [aff3d7a]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [45ac2cb]
- Updated dependencies [b97790a]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
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
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [00d3f09]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [3cab570]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [78ca238]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [c15d7ec]
- Updated dependencies [5d0876c]
- Updated dependencies [f7ace0a]
- Updated dependencies [b041b9c]
- Updated dependencies [ce2aaef]
- Updated dependencies [544ecba]
- Updated dependencies [2ce2612]
- Updated dependencies [bc640ec]
- Updated dependencies [1e215c4]
- Updated dependencies [da6e191]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [aef97e5]
- Updated dependencies [2af1fa7]
- Updated dependencies [c14d3a0]
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
- Updated dependencies [d1bebb0]
- Updated dependencies [95bf128]
- Updated dependencies [335abea]
- Updated dependencies [edea22a]
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
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
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
- Updated dependencies [4a292d2]
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
- Updated dependencies [868e825]
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
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [1570eac]
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
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
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
- Updated dependencies [b9d47ec]
- Updated dependencies [3b6bc69]
- Updated dependencies [6214db6]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [804831c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [7098eed]
- Updated dependencies [3df7c5c]
- Updated dependencies [fb91ac9]
- Updated dependencies [fb91ac9]
- Updated dependencies [641fb55]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
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
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [4598f6d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [0e05aac]
- Updated dependencies [ae61ad4]
- Updated dependencies [5aed9e4]
- Updated dependencies [83c77dc]
- Updated dependencies [3c9fca3]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [617707a]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
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
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [4dc80d0]
- Updated dependencies [9d9040d]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [af3861f]
- Updated dependencies [2609812]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [72ffc34]
- Updated dependencies [a51fa0c]
- Updated dependencies [51f3d8d]
- Updated dependencies [bf28341]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [6c6cee7]
- Updated dependencies [42887e0]
- Updated dependencies [83fe6e7]
- Updated dependencies [d1ab06f]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [490f482]
- Updated dependencies [27308c5]
- Updated dependencies [8689166]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [9101be5]
- Updated dependencies [f53a8d0]
- Updated dependencies [30266cf]
- Updated dependencies [968dc1e]
- Updated dependencies [57f9b07]
- Updated dependencies [3c73d99]
- Updated dependencies [d91aed9]
- Updated dependencies [ed71d9e]
- Updated dependencies [7776fc2]
- Updated dependencies [e76634c]
- Updated dependencies [c86185e]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/permissions@17.7.0

## 17.6.0

### Minor Changes

- 0a73b51: `ObjectView` and `ListView` now flatten a view's `map` block through a
  whitelist instead of spreading the whole (untyped) block to the top level.
  
  Both `case 'map'` flatteners used to build the `object-map` schema with
  `...(options.map || {})` — a raw spread of an untyped bag
  (`NamedListView.options?: Record<string, any>`), so any key an author wrote in
  the `map` block reached the top level unfiltered. `ObjectMap`'s own
  `FlatMapConfigKeys = Omit<ObjectMapConfig, 'style'>` declares `style` OUT of
  this flat form (`style` is also `BaseSchema.style`, inline CSS legal on every
  node), so the two disagreed about the same shape. `style` was the live
  specimen: `map: { style: '<url>' }` reached the top level as a CSS-shaped
  `style` key it was never supposed to carry.
  
  Behavior narrowing, stated because it changes what reaches the flattened
  schema: a `map` block key that is not one of `ObjectMapConfig`'s declared
  flat keys (`latitudeField` / `longitudeField` / `locationField` / `titleField`
  / `descriptionField` / `zoom` / `center`) — including `style` — no longer
  reaches the top level of the flattened `object-map` schema. This closes a gap
  rather than removing working behavior: the pinned strict spec view schemas
  accept no `map` block at all today, so no author-facing surface could reach
  this path, and `ObjectMap` already stopped reading a top-level `style` as a
  map style (a dev warning names the correct spelling instead).
  
  The whitelist is DERIVED from `ObjectMapConfigSchema` (`@object-ui/types/zod`)
  rather than hand-listed, so the flatteners and the declaration cannot drift
  apart again — a key added to (or removed from) the schema reaches both
  flatteners without a second edit. `ObjectMap`'s own `FLAT_MAP_CONFIG_KEYS` is
  derived from the same schema for the same reason.
- 578e025: `ObjectMapSchema` declares what ObjectMap reads, and the `map` block outranks the flat spelling
  
  `object-map` carried three disagreeing shapes for one component. The declared face
  (`ObjectMapSchema`) had four keys — `type`, `objectName`, `locationField`,
  `titleField`, `mapStyle`. The renderer read about fifteen. And `ObjectMapProps.schema`
  was typed `ObjectGridSchema`, so every map-specific read went through
  `(schema as any)`. A TypeScript author could not write the `map` block the docs teach,
  and misspelling `latitudeField` as `latitudeFieId` was caught by nothing: the map
  rendered empty and looked like bad data.
  
  Declared now, each with a read site in `ObjectMap.tsx`: `data`, `staticData`, `filter`,
  `sort`, `map`, `enableClustering`, `navigation`. `ObjectMapConfig` (interface) and
  `ObjectMapConfigSchema` (zod) are lifted out of `plugin-map`, where the zod was
  package-private and called `MapConfigSchema`, into `@object-ui/types` and
  `@object-ui/types/zod` — so the declared authoring face and the validation the renderer
  performs are one schema rather than two that can drift. The `Object` prefix is not
  decoration: `@objectstack/spec/automation` already exports `MapConfigSchema` for an
  unrelated concept, and a local declaration under a spec export's name is what
  `check:spec-symbols` exists to refuse. `ObjectMapProps.schema` is `ObjectMapSchema`, and the `as any` map reads
  are gone.
  
  Behavior change, ruled by the maintainer on objectui#5018 (2026-08-17): the `map` block
  is the author face and the flat top-level spelling (`schema.latitudeField`, …) is the
  internal form ObjectView / ListView produce when they flatten `options.map`. When a
  schema carries both, **the `map` block now wins** — the reverse of the previous order,
  under which the flatten product silently shadowed an authored block — and a dev-mode
  warning names the top-level keys that were ignored. The flat spelling stays out of the
  declared surface and out of the docs.
  
  Nothing changes for views built by ObjectView / ListView: both flatteners emit the flat
  keys and no `map` key at all, so the branch the flip reorders is never reached for their
  output. That property is now pinned rather than assumed
  (`plugin-view/src/__tests__/ObjectView.mapFlatten.test.tsx`).
  
  Bound worth stating, because it limits what the typed surface can promise: `BaseSchema`
  carries an index signature (`[key: string]: any`), so a misspelled key at the TOP level
  still type-checks — for every component schema in the repo. The `map` BLOCK is closed,
  which is what makes the card's headline typo a compile error.

### Patch Changes

- 5edc0c5: `object-gantt` / `object-map` / `object-calendar` no longer drop a sort entry that omits `order`.
  
  The three blocks each inlined a byte-identical private copy of the `sort` →
  `$orderby` conversion. That copy required BOTH `field` and `order` on an array
  entry and silently skipped any entry missing one, so a stored view sorting by
  `[{ field: 'amount' }]` reached the wire with no ordering at all — the authored
  sort key was lost, not applied. The same copy already treated the STRING
  spelling `"amount"` as ascending, so this was an inconsistency between two
  spellings of one thing rather than deliberate strictness.
  
  All three now import the shared `convertSortToQueryParams` sink from
  `@object-ui/core` (introduced by objectstack#7137, already used by
  `object-timeline` and `record:line_items`), and the private copies are gone —
  the sink is the repo's only definition. Two behavior changes come with it, both
  of which make the blocks more faithful to what is already declared rather than
  more tolerant:
  
  - An array entry that omits `order` now orders ASCENDING instead of vanishing.
    That is what `QueryParams.$orderby`'s own member shape
    (`{ field: string; order?: 'asc' | 'desc' }`) says, and what
    `@object-ui/data-objectstack`'s `serializeOrderBy` already did with a missing
    direction.
  - When nothing orderable was authored, the query now carries no `$orderby` at
    all instead of an empty object. `{}` is truthy and meant "no ordering" only by
    accident of the adapter's serializer.
  
  Reachability, so the size of this is not overstated: `SortConfig.order` and
  `ElementDataSourceSort.order` are REQUIRED in objectui's own types, so a typed
  caller could never author the dropped shape. The affected surface is untyped
  stored view metadata (`ElementSavedView` is a loose record by design) — which is
  exactly where an order-less entry can arrive today.
- 25819c4: A map view now fits its camera to the records it queried, so a view with data never first-paints an empty viewport.
  
  The initial camera was never derived from the data. The zoom came from
  `getMapConfig`'s default branch — the branch reached precisely when the author
  declared nothing — which synthesized `zoom: 10` at the origin, and the fabricated
  value was indistinguishable from a declared one at the read site. An unconfigured
  object list view of continent-wide records therefore opened on a ~30km-wide
  viewport centred on the set's midpoint: no markers anywhere on screen, the
  records reachable only by zooming out and panning by hand (objectui#4941, seen on
  the showcase `task` map view, whose ten seeded US-city locations span ~4000km).
  
  The camera is now the marker set's bounding box, handed to MapLibre as
  `initialViewState.bounds` so the fit happens against the real container size,
  with padding and a city-scale zoom ceiling (a single record, or several at one
  address, fits a zero-width box — unbounded, that answers with a rooftop view of a
  style whose tiles stop far short of it).
  
  The box is measured along the **shortest arc** containing every marker, not
  between the naive longitude extremes. Read as a line rather than a circle, two
  records two degrees apart across the antimeridian (179 and -179) describe a
  358-degree box whose centre is their antipode; MapLibre then places the markers in
  whichever copy of the world is nearest their previous screen position, which is
  how a fitted-looking camera ends up showing empty ocean with the records sitting
  on a neighbouring copy.
  
  Unchanged on purpose: record coordinates are not rescued. The platform's
  `location` value bounds longitude to [-180, 180], so an out-of-range coordinate is
  a producer-side defect — such records keep being rejected and counted in the
  view's "invalid coordinates" notice, and the normalization above is camera
  arithmetic over already-valid values. No new configuration key was added either:
  the documented `zoom` / `center` pair of the `map` block is still the only camera
  declaration, it still wins outright, and declaring one half keeps the other
  derived (`zoom` alone applies at the records' centre; `center` alone at a
  continental zoom). An empty result set is not fitted — it opens on the whole
  world rather than a zoom-10 patch of sea.
- 072085d: A map node's top-level `style` is inline CSS again, not a MapLibre style URL.
  
  `ObjectMap.getMapConfig` resolved the map style from three spellings with the
  top-level `style` FIRST — `schema.style || schema.mapStyle || schema.map?.style`
  — but `style` is `BaseSchema.style`, a record of inline CSS properties that
  every schema node may legally carry. Writing the base face's own
  `style: { height: '400px' }` on a map node therefore handed that object to
  MapGL's `mapStyle` prop: it never passed the config `safeParse` (which only ever
  looked at `schema.map`), so there was no validation and no diagnostic either.
  
  `@object-ui/types` had already named the map's key `mapStyle` — explicitly "not
  `style`, to avoid colliding with `BaseSchema.style`" — so the consumer was
  reading, at top priority, the very name the declaration went out of its way to
  avoid. The declaration is now what is enforced: the map style comes from
  `mapStyle` on the schema or `style` inside the declared `map` block, and a
  top-level `style` is not consumed as a map style in any shape.
  
  Behaviour change, stated because it is one: a map configured through a top-level
  `style` URL now renders with the default public demo tiles. That spelling was
  never documented (the README teaches `map.style`) and no metadata in this repo
  used it, but it was runtime-reachable one way — `ObjectView` / `ListView`
  flatten `options.map`'s CONTENTS to the top level, so a view authored with
  `map: { style: '<url>' }` arrived here as a top-level string. That shape is not
  spec-authorable (`@objectstack/spec`'s list-view schemas are strict and declare
  no `map` block at all, so such a view fails validation outright), and it now
  gets a dev warning naming both surviving spellings rather than silently painting
  the demo tiles. The object form gets no warning: legal base-face authoring, and
  dropping it is the fix.
- 687bc0c: Fix two pieces of `ObjectMap` state that stopped tracking their source after mount
  (objectui#5003):
  
  - **`data` prop threading**: the fetch effect preferred records passed via `props.data`,
    but `data` was read off the `rest` spread and was not one of the effect's dependencies.
    A host rendering `<ObjectMap data={[]} .../>` while its own query is in flight, then
    re-rendering with the resolved rows, kept showing the empty map — the prop changed, the
    effect never re-ran to notice. `data` is now a declared prop (`data: dataProp`), tracked
    directly in the effect's dependency array; the whole `rest` object is intentionally
    **not** added there (it is a fresh object every render, which would refetch on every
    render instead).
  - **Clustering zoom seed**: `currentZoom` — what `clusterMarkers` uses for its grid cell
    size — was seeded with a nominal `mapConfig.zoom || 3` and updated only by `onZoom`.
    MapLibre applies the initial camera (including a `bounds` fit) via its constructor,
    before react-map-gl attaches React's event handlers, so no `onZoom` ever fired for that
    first camera — the seed stayed nominal until the user's first zoom. It is now also
    seeded from `onLoad`, which fires once the initial camera has settled, so clustering at
    first paint reflects the camera MapLibre actually applied.
  
  Both were dormant on the console path (never exercised in the example apps) — see the
  issue for why — so this ships with dedicated tests exercising the prop-update path and
  the pre-`onZoom` clustering state directly.
- 084155e: Fix the two remaining `object/api/value` claims that objectui#5019 (PR #5162) left
  behind — its dispatch was scoped to only the "API Provider" section of
  `content/docs/plugins/plugin-map.mdx`, so the same false claim survived in the Features
  list and in the `ObjectMap.tsx` file-header JSDoc:
  
  - `content/docs/plugins/plugin-map.mdx:24` (Features list): "Works seamlessly with
    object/api/value data providers" → "Works seamlessly with object/value data providers".
  - `packages/plugin-map/src/ObjectMap.tsx:20` (file-header JSDoc): "Works with
    object/api/value data providers" → "Works with object/value data providers".
  
  `provider: 'api'` still hits `console.warn('API provider not yet implemented for
  ObjectMap')` and returns an empty record set (`ObjectMap.tsx:584`); `endpoint`/`method`
  have no read point in the package. Implementing the `api` provider is capability
  expansion and is explicitly out of scope here, same as it was for #5019.
  
  No runtime behaviour changes — a source comment and a docs line only.
- Updated dependencies [88085e3]
- Updated dependencies [516663d]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [2533ec5]
- Updated dependencies [78c0f9a]
- Updated dependencies [bbe8b86]
- Updated dependencies [8477be5]
- Updated dependencies [279fb13]
- Updated dependencies [2e82ab2]
- Updated dependencies [ad07b65]
- Updated dependencies [41f498b]
- Updated dependencies [e1d4251]
- Updated dependencies [40d3a33]
- Updated dependencies [8b9dc62]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [a1609a6]
- Updated dependencies [53f23bc]
- Updated dependencies [c4533dc]
- Updated dependencies [be60815]
- Updated dependencies [37f6844]
- Updated dependencies [93de4f6]
- Updated dependencies [2b50261]
- Updated dependencies [384f30d]
- Updated dependencies [ac600e5]
- Updated dependencies [97fba31]
- Updated dependencies [232f61a]
- Updated dependencies [d374caf]
- Updated dependencies [5673576]
- Updated dependencies [c1ef923]
- Updated dependencies [911ceaa]
- Updated dependencies [98eab36]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [aff10e2]
- Updated dependencies [70a774b]
- Updated dependencies [9ce096f]
- Updated dependencies [e05db88]
- Updated dependencies [7458a41]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Patch Changes

- d0c3b26: Every plain `<button>` now declares its `type`. HTML defaults an untyped button to
  `type="submit"`, so any of these buttons would submit the form it was composed into
  instead of running its own handler — a real risk for renderers (`drawer`, `tree-view`,
  `navigation-overlay`) whose placement inside a form is a JSON metadata decision. 114
  sites were converted to `type="button"`; no site was a genuine submit button, and the
  DOM is otherwise unchanged.

  The defect class is now closed mechanically by a new `object-ui/button-has-type` ESLint
  rule (error), so the next untyped button fails CI at write time rather than being found
  by a fourth audit round (objectui#4045, closing the objectui#3344 family).

- b388d0e: `object-map` reads its configuration from the declared `map` input only — `filter` is the query filter, and a map authored with both stopped rendering markers

  `getMapConfig` probed every filter for a `map` key and, on a hit, used it as the MapConfig: `schema.filter.map`, plus a `schema.filter.map.style` half in the style chain. That shape predates the `{ name: 'map', type: 'object' }` input both registrations declare, and it gave `filter` two meanings inside one block — the query filter at `$filter: schema.filter`, and a configuration slot.

  The probe was written as `'map' in schema.filter`, and `in` walks the prototype chain. The ordinary filter is an **array**, and every array inherits `Array.prototype.map` — so the probe matched, handed the component a _function_ as its map configuration, and the spread of a function is `{}`. The declared `schema.map` was never reached (it sat in the `else` branch), so a map authored with both `map` and `filter` — two documented inputs, no legacy shape required — lost `latitudeField` / `longitudeField` / `titleField`, failed `extractCoordinates` on every record, and rendered zero markers under a "N records with missing or invalid coordinates excluded from the map" banner. The only console output was `[ObjectMap] Invalid map configuration:` from the Zod parse of a function.

  This was reachable two ways and both are fixed by the same deletion: an author writing `filter` alongside `map`, and the `dataSource` binding of objectstack#7121, whose merged filter is an `and` node — `['and', [...], [...]]`, still an array, still carrying `Array.prototype.map`.

  Both legacy reads are gone; the map consumes only what it declares. The `map` config, the top-level `locationField` / `latitudeField` branch, and the `style` / `mapStyle` reads are untouched, and `filter` is passed to the query verbatim — a field genuinely named `map` still filters on it, and nothing is stripped from the author's filter.

  A schema still carrying the legacy `filter.map` stash now gets a dev-mode warning naming the shape and pointing at `schema.map`, rather than silently falling back to the default field names. It is deliberately narrow: own properties only (so an inherited `map` method never triggers it) and object-valued only (so `filter: { map: 'x' }` reads as a filter on a field named `map`), and it warns once per distinct stash because `getMapConfig` runs on every render. Production behavior is unchanged beyond the configuration no longer being read.

- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [cb13400]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [3f5f87c]
- Updated dependencies [f5e1143]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [9461dd3]
- Updated dependencies [47f551b]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- 022002a: `PageComponentSchema.dataSource` now reaches the remaining object-bound public
  blocks: `object-gantt` / `object-timeline` / `object-map` / `object-pivot` /
  `object-master-detail-form` / `embeddable-form` / `record:line_items`
  (objectstack#7121).

  objectstack#6953 wired the spec's per-element data binding
  (`dataSource: { object, view?, filter?, sort?, limit? }`) to the eight blocks it
  named and left the same declaration inert on these seven. Each gates its fetch on
  its own object key and nothing mapped `dataSource.object` onto it, so a page
  written the way the spec documents rendered an empty gantt / an empty timeline
  rail / a map with no markers / an empty cross-tab / a field-less form — with no
  request and no diagnostic anywhere. Spec-valid metadata rendering nothing is the
  objectstack#4413 shape.

  Composition follows objectstack#5576's landed semantics unchanged, through the
  shared `ElementDataSourceGate` (no change to it or to the resolution layer): a
  named saved view supplies the baseline, a key written on the component itself
  overrides it, an explicit binding key overrides both, `filter` AND-combines
  ("additional filter criteria" — a binding can narrow a view, never widen it), and
  a `view` name that does not resolve renders a configuration error on every one of
  these blocks instead of degrading to the object's full scope.

  Each block maps **only** the keys it genuinely reads, which for this batch means
  several keys stay deliberately unmapped rather than being parked somewhere
  plausible:

  - `object-gantt` and `object-map` take `object` / `filter` / `sort`; neither has a
    row cap or a field-list read site.
  - `object-pivot` takes `object` / `filter`; a cross-tab orders itself by its own
    row/column grouping and cannot be computed over a truncated page.
  - `object-timeline` takes `object` only — its fetch is
    `find(objectName, { options: { $top: 100 } })`, with no filter/sort read site
    at all, so a named view is error-checked and then contributes nothing.
  - `embeddable-form` and `object-master-detail-form` take `object` only (the
    parent object, in the master-detail case); a form that writes one record has no
    collection query for `filter` / `sort` / `limit` to narrow.
  - `record:line_items` takes `object` onto **`childObject`** — the collection it
    actually lists — and nothing else: its query is the parent FK plus a fixed
    `$top: 500`, and its `columns` are editable `GridColumn` objects rather than a
    field-name projection a view could supply.

  The per-block coverage table, including every residual gap named above, is in
  `content/docs/guide/data-source.md`.

  No behaviour change for a block that carries no `dataSource`: the binding-free
  path returns the schema by reference, so nothing remounts and nothing refetches.

- 9ad21b6: `plugin-map` 加载时不再向控制台打印 `Registering object-map...`

  `packages/plugin-map/src/index.tsx` 的注册调用之前留着一句调试输出
  `console.log('Registering object-map...')`。它位于**模块作用域**,所以不是「渲染地图时打一行」,
  而是**只要这个 plugin 被 import 就打一行**:console 应用的 `register-plugins` 一加载即触发,
  单元测试里跟着刷,生产 bundle 同样保留 —— 使用者控制台里凭空多出一行来源不明的噪音。

  同仓其余 18 个 plugin 的 `src/index.tsx` 注册处都没有这类输出,这一句是孤例
  (`plugin-editor` 里唯一的 `console.log` 命中是 `defaultProps.value` 示例代码字符串,
  不是会执行的语句)。纯噪音,不涉及任何行为:注册本身、`ObjectMap` 的渲染与取数都不读它。

  顺带记一条搜索时确认的背景:仓库的 eslint 配置没有开 `no-console` 规则,所以这类遗留
  调试输出没有任何自动化拦网 —— 这次是靠人工发现的。是否全仓开 `no-console`(以及
  `ObjectMap.tsx` 里三处**有意**保留的 `console.warn`/`console.error` 诊断如何豁免)是一个
  影响多个包的策略决定,已另行开单,不混进本 PR。

  回潮钉在 `src/index.registration.test.tsx`:spy 掉 `console.log`/`info`/`debug` 后
  `vi.resetModules()` 再 `import('./index')`,断言零输出。钉子刻意只覆盖这三个「噪音通道」,
  不含 `warn`/`error` —— `ComponentRegistry.register()` 在缺 namespace、以及裸名 fallback
  覆盖冲突时**按设计**会 `console.warn`(`packages/core/src/registry/Registry.ts`),
  一刀切断言「零 console 输出」等于把 Registry 的诊断契约钉在这里,将来会因与「遗留调试输出」
  无关的原因变红。钉子里还有一条非空断言:import 后校验 `object-map`/`map` 两个注册确实进了
  registry,免得模块缓存导致 import 未真正执行、于是「没有输出」是因为**什么都没发生**而假绿。

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [7ed3360]
- Updated dependencies [0fa5e4d]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [e24d767]
- Updated dependencies [aca561a]
- Updated dependencies [48132f7]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [f833d3a]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [bca45cc]
- Updated dependencies [a889e31]
- Updated dependencies [09d30a4]
- Updated dependencies [4bf612c]
- Updated dependencies [335041c]
- Updated dependencies [b414983]
- Updated dependencies [256f8cc]
- Updated dependencies [d9668a7]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [f6e8d78]
- Updated dependencies [ea96284]
- Updated dependencies [d3584c6]
- Updated dependencies [a8ad6c0]
- Updated dependencies [444457c]
- Updated dependencies [850033c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0
  - @object-ui/components@17.2.0
  - @object-ui/core@17.2.0
  - @object-ui/react@17.2.0

## 17.1.0

### Patch Changes

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [68ef584]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [c4d7b20]
- Updated dependencies [c769d3d]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c735bf7]
- Updated dependencies [02aef0c]
- Updated dependencies [6f29aa5]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [9a04d25]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [07de839]
- Updated dependencies [2a40b5e]
- Updated dependencies [df613fa]
- Updated dependencies [4874117]
- Updated dependencies [ad0183a]
- Updated dependencies [ce08d55]
- Updated dependencies [eb4b740]
- Updated dependencies [5b084eb]
- Updated dependencies [aa1240a]
- Updated dependencies [2374a49]
- Updated dependencies [390c071]
- Updated dependencies [d10f526]
- Updated dependencies [2d5d594]
- Updated dependencies [ea7f477]
- Updated dependencies [379728f]
- Updated dependencies [7f23cd0]
- Updated dependencies [0ded602]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [80edbd4]
- Updated dependencies [9867281]
  - @object-ui/core@17.1.0
  - @object-ui/components@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0

## 17.0.0

### Patch Changes

- 5b9cf96: fix(plugin-map): drop the `maplibre-gl@6` default import, and put type-check behind a CI gate that cannot be silently skipped (#2911)

  `maplibre-gl@6.0.0` removed its default export (arrived via #2848, dependabot),
  so `ObjectMap.tsx`'s `import maplibregl from 'maplibre-gl'` has been a TS1192
  error on `main` for a day. The binding was never used — the map instance comes
  from `react-map-gl/maplibre`, and the stylesheet from the side-effect import on
  the next line — so the import is simply deleted rather than rewritten to
  `import * as`.

  Removing it is runtime-neutral, which the issue had explicitly left unverified.
  `@vis.gl/react-maplibre` (what `react-map-gl/maplibre` re-exports) does
  `Promise.resolve(mapLib || import('maplibre-gl'))` in `components/map.js`, so it
  loads the library itself when no `mapLib` prop is passed. Verified in a browser
  against the `store-locator-map` catalog schema: `maplibre-gl` is fetched as its
  own lazy chunk, the WebGL canvas comes up 800x600, and all three markers mount —
  byte-identical probe output with and without the static import. That also matches
  what `apps/console/src/main.tsx` already intends, where the plugin is registered
  lazily specifically to keep `maplibre-gl` out of the initial bundle.

  **The reason it survived a day of green CI is the part worth fixing.** No
  workflow ran `type-check` at all, and `turbo build` only checks types for
  packages whose `build` script happens to invoke `tsc` — the 22 `vite build`
  packages transpile without checking. A sweep of all 45 packages found ten with
  broken types, `plugin-map` merely being the one that had a script to notice it.

  Adding a `pnpm type-check` job alone would not have been a gate: **turbo silently
  skips any package with no `type-check` script**, so 17 packages read as passing
  because nothing ran. With `plugin-map` fixed, `pnpm type-check` reports 63/63
  green while nine packages are still broken. So:

  - `plugin-ai` and `plugin-report` gain the `paths` override their type-checked
    peers already carry, which detaches workspace deps from sibling _source_ and
    resolves them through built `.d.ts` — the sole cause of the 104-error TS6059
    `rootDir` floods, and the same trick their own `vite.config.ts` already applies
    to the dts program.
  - Seven packages gain `"type-check": "tsc --noEmit"` (`plugin-ai`,
    `plugin-report`, `plugin-dashboard`, `create-plugin`, `console`, and the two
    console examples). Coverage goes 28 -> 35 of 45.
  - New `scripts/check-type-check-coverage.mjs` makes the invisibility impossible:
    a package with no `type-check` script must be declared, with a reason, and the
    lists only shrink — gaining a script without deleting the entry fails the
    guard. The nine known-broken packages are recorded there with error counts
    (`@object-ui/runner` has no `tsconfig.json` at all), tracked as follow-ups.
  - New `Type Check` CI job runs the coverage guard first (instant, no install),
    then `pnpm type-check`.

  Both halves were proven to fail before being trusted: the guard was exercised in
  all four of its failure modes, and re-introducing the `maplibre-gl` import turns
  the job red again, as does a fresh error injected into `plugin-ai` — a package
  that had no type checking whatsoever before this change.

- Updated dependencies [7b21891]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Patch Changes

- 7cf4051: chore(deps): align every `@objectstack/*` dependency to `^16.0.0-rc.0`

  Bumps `@objectstack/spec` / `client` / `formula` / `lint` from `^15.1.1` to the
  `16.0.0-rc.0` pre-release across the workspace (root + `apps/console` +
  `apps/site` + all consuming packages). ObjectUI's own packages are already on
  major 16, so this closes the 15↔16 skew between ObjectUI and the `@objectstack`
  contract libraries (which publish in lockstep with `spec`).

  This is a dependency alignment, not a behavioral migration: the full workspace
  build (43/43) and the `@objectstack`-consuming package test suites
  (`core` / `app-shell` / `data-objectstack` / `plugin-form` / `types`) are green
  against `16.0.0-rc.0` with no source changes required.

  Practical effect: `@objectstack/client@16.0.0-rc.0` now ships
  `data.batchTransaction` (framework #3271), so `ObjectStackAdapter`'s feature
  detect (`typeof client.data.batchTransaction === 'function'`) routes
  master-detail cross-object saves through the typed SDK method instead of the
  raw `fetch('/api/v1/batch')` fallback — realizing the "verify SDK path" half of
  #2694. The raw-fetch branch stays as a defensive fallback (removal tracked in
  #2694).

- 549c67d: chore(lint): clear the mechanical baseline lint errors so these packages' lint gates protect them again

  Extends the fields/core cleanup from #2709 (objectui#2713). These eight package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations of the same class. Cleared every **error** (no behavior
  change; warnings are out of scope):

  - **`no-useless-catch`** (`data-objectstack`) — unwrapped five try/catch blocks
    whose `catch` only re-threw; errors still propagate identically.
  - **`preserve-caught-error`** (`cli`, `data-objectstack`, `react`) — the caught
    error's message is inlined into the thrown `Error`; a scoped disable with a
    justifying comment carries each one, because these packages target ES2020
    whose lib types the 1-arg `Error` constructor only (so `{ cause }` won't
    compile) — same reasoning as the core case in #2709.
  - **`prefer-const`** (`plugin-calendar`, `plugin-map`) — `let`→`const` for
    never-reassigned bindings.
  - **`no-empty-object-type`** (`plugin-designer`) — empty extend-only interfaces
    → equivalent `type` aliases.
  - **`no-useless-assignment`** (`react`) — dropped a dead initializer that both
    branches overwrite before it is read.
  - **`no-require-imports`** (`plugin-calendar`, `plugin-timeline` tests) —
    hoisted `vi.mock` factories now use an `async` factory with
    `await import('react')` instead of `require('react')`.
  - **stale `eslint-disable` directive** (`plugin-markdown`) — removed a
    `react/no-danger` disable whose plugin is not loaded in the flat config (an
    unknown-rule reference that ESLint v10 reports as an error); the rationale is
    kept as a plain comment.

- Updated dependencies [1c8935a]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
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
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [f0f10f5]
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/components@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/react@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [bce581a]
- Updated dependencies [c38d107]
- Updated dependencies [7782698]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/components@11.1.0
- @object-ui/react@11.1.0
- @object-ui/types@11.1.0
- @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0
- @object-ui/core@7.3.0
- @object-ui/react@7.3.0
- @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [6c0c92c]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/react@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/react@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [b2d1704]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/components@5.0.2
- @object-ui/react@5.0.2
- @object-ui/types@5.0.2
- @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [8930b15]
- Updated dependencies [95b6b21]
- Updated dependencies [ddb08a7]
- Updated dependencies [765d50f]
- Updated dependencies [927187a]
- Updated dependencies [bae8ba8]
- Updated dependencies [8435860]
- Updated dependencies [bb2ea48]
- Updated dependencies [b14fe09]
- Updated dependencies [a7bef6e]
- Updated dependencies [74962b0]
- Updated dependencies [3154334]
- Updated dependencies [fa4c2cb]
- Updated dependencies [7213027]
  - @object-ui/components@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [3ee436d]
  - @object-ui/components@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [6b6afd1]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [2bd45af]
  - @object-ui/components@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [6b683c8]
  - @object-ui/components@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Patch Changes

- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/components@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/components@4.2.0
- @object-ui/react@4.2.0
- @object-ui/types@4.2.0
- @object-ui/core@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/components@4.0.6
  - @object-ui/types@4.0.6
  - @object-ui/core@4.0.6
  - @object-ui/react@4.0.6

## 4.0.5

### Patch Changes

- 1dc6061: fix(build): inline dynamic imports in library outputs

  Library `vite build --lib` outputs were emitting separate code-split chunks
  (`rolldown-runtime-*.js`, `LookupField-*.js`, etc.) when source files used
  `React.lazy()` / dynamic `import()`. When consumer apps re-bundled these
  multi-file dists, the library's per-chunk rolldown-runtime collided with the
  consumer's own runtime, causing "TypeError: i is not a function" at runtime
  when lazy components tried to register themselves (e.g. TextField in
  `@object-ui/fields` after 4.0.4).

  Adding `output.inlineDynamicImports: true` to all `@object-ui/*` library vite
  configs forces a single `dist/index.js` per package, which lets consumer
  bundlers handle the library as an opaque ESM module without identifier
  mismatches across chunks.

  Affected packages: components, fields, layout, plugin-aggrid, plugin-ai,
  plugin-calendar, plugin-charts, plugin-chatbot, plugin-dashboard,
  plugin-designer, plugin-detail, plugin-editor, plugin-form, plugin-gantt,
  plugin-grid, plugin-kanban, plugin-list, plugin-map, plugin-markdown,
  plugin-report, plugin-timeline, plugin-view, plugin-workflow.

- Updated dependencies [1dc6061]
  - @object-ui/components@4.0.5
  - @object-ui/types@4.0.5
  - @object-ui/core@4.0.5
  - @object-ui/react@4.0.5

## 4.0.4

### Patch Changes

- d2b6ece: fix: externalize all bare imports in library builds

  Library builds (vite lib mode) now externalize every non-relative import instead of bundling third-party CJS dependencies into the published dist. This avoids inlined `require("react")` / `require("react-dom")` calls that cause `Calling \`require\` for "react" in an environment that doesn't expose the \`require\` function` runtime errors when consumer apps re-bundle the published dist.

  Specifically fixes:

  - `@object-ui/plugin-dashboard` no longer inlines `react-grid-layout` (and its transitive `react-draggable` / `react-resizable` CJS bundles). `react-grid-layout` is now declared as a peer dependency so consumers install a single ESM-friendly copy.
  - `@object-ui/components`, `@object-ui/plugin-calendar`, `@object-ui/plugin-charts`, `@object-ui/plugin-designer` no longer inline `react-i18next` / `i18next` / `use-sync-external-store` CJS shims.
  - All plugin packages now use a unified `external: (id) => !/^[./]/.test(id) && !id.startsWith(__dirname)` rule, ensuring future additions of CJS deps are automatically externalized.

- Updated dependencies [d2b6ece]
  - @object-ui/components@4.0.4
  - @object-ui/types@4.0.4
  - @object-ui/core@4.0.4
  - @object-ui/react@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3
  - @object-ui/core@4.0.3
  - @object-ui/react@4.0.3
  - @object-ui/components@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- e93fe35: Mobile UX round 3 — Gantt and Map

  **@object-ui/plugin-gantt**

  - Added a sticky vertical "Today" marker on the timeline plus a one-tap **Jump to Today** toolbar button so on-call users can re-orient the view instantly on small screens.
  - Added a **collapsible task list** (toolbar toggle + auto-collapse on the first narrow render) so the timeline area gets the full viewport on phones.
  - Added **pinch-to-zoom** touch gestures on the timeline; wired `columnWidthOverride` state so the existing zoom buttons also respond (previously a no-op).

  **@object-ui/plugin-map**

  - Added a **geolocate button** with the standard `navigator.geolocation.getCurrentPosition` permission flow, an inline error banner, a busy state, and a **user-location marker** (blue dot) the map flies to on success.
  - **Cluster tap-through**: tapping a cluster now flies the map in (zoom + 2, capped at 20) instead of just sitting there.
  - On mobile, the desktop popup is replaced by a **bottom-sheet record card** with safe-area padding and an explicit close button. Desktop continues to use the popup.

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
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
  - @object-ui/react@3.0.0
  - @object-ui/components@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0

## 0.3.1

### Patch Changes

- Maintenance release - Documentation and build improvements
- Updated dependencies
  - @object-ui/types@0.3.1
  - @object-ui/core@0.3.1
  - @object-ui/react@0.3.1
  - @object-ui/components@0.3.1
