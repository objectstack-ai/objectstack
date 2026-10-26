# @object-ui/plugin-tree

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [8e649da]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [f669732]
- Updated dependencies [813c3d9]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [0d12e95]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
- Updated dependencies [b93c9f6]
- Updated dependencies [0f4adc3]
- Updated dependencies [fa31856]
- Updated dependencies [8e90779]
- Updated dependencies [f1a4b08]
- Updated dependencies [7f60e9d]
- Updated dependencies [d9aff15]
- Updated dependencies [4eeb174]
- Updated dependencies [afcf654]
- Updated dependencies [2c3dc72]
- Updated dependencies [cee3bc5]
- Updated dependencies [2958f17]
- Updated dependencies [a78608f]
- Updated dependencies [1d178e0]
- Updated dependencies [2c4e5f5]
- Updated dependencies [6fb31dc]
- Updated dependencies [fbb4b23]
- Updated dependencies [f3044f7]
- Updated dependencies [c8f8b10]
- Updated dependencies [ad74e98]
  - @object-ui/types@18.1.0
  - @object-ui/components@18.1.0
  - @object-ui/fields@18.1.0
  - @object-ui/i18n@18.1.0
  - @object-ui/plugin-detail@18.1.0
  - @object-ui/react@18.1.0
  - @object-ui/permissions@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- f34e877: A tree row's declared deadline reads neutral once the row's record settles it through the field's `settledWhen`, and "Overdue Nd" in red otherwise (objectui#11815).
- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.

### Patch Changes

- a58626c: fix(plugin-tree): tree cells draw the same field faces as list cells, so a boolean no longer shows as `true` (objectui#11686)
  
  A tree view, such as the Org Chart tab on Setup → Business Units, printed most column values as raw text. Its cells knew only option labels and referenced records; every other type was printed as stored, so the boolean "Active" column read `true`, and dates, numbers and currency amounts showed their stored form while the list tabs on the same page drew them properly.
  
  Each tree cell whose column the object defines now draws through the field package's cell display for that field type, the same one the grid, kanban and gallery cards use. A boolean draws the read-only checkbox, a date the locale-aware date, a currency the formatted amount, a select its option badge and a lookup the referenced record's name. Where a display names its own column, as the boolean display's badge for an inactive `active` field does, it uses the column label the tree's header shows, so it reads in the session's language. A column the object does not define keeps the plain text it showed before.
  
  `@object-ui/plugin-tree` now declares `@object-ui/fields` as a dependency; it already reached it through `@object-ui/plugin-detail`. Nothing is added to the package entry: no export, prop, type member or language-pack key.
- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [c096f03]
- Updated dependencies [d92b2a1]
- Updated dependencies [92f4e2b]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [b61c116]
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [4c127cd]
- Updated dependencies [9dfaca6]
- Updated dependencies [76993f8]
- Updated dependencies [c000398]
- Updated dependencies [73b5d77]
- Updated dependencies [7b17705]
- Updated dependencies [fc3c2cc]
- Updated dependencies [f9f4a62]
- Updated dependencies [848ba0e]
- Updated dependencies [57d82cb]
- Updated dependencies [de96f3d]
- Updated dependencies [9ca3cac]
- Updated dependencies [c910630]
- Updated dependencies [ce464d9]
- Updated dependencies [e6dcd85]
- Updated dependencies [96fcf30]
- Updated dependencies [7a2c60b]
- Updated dependencies [055d350]
- Updated dependencies [7300fca]
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [db4cb6b]
- Updated dependencies [4590363]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [885a96f]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [72167a9]
- Updated dependencies [e06365c]
- Updated dependencies [3035948]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [f34e877]
- Updated dependencies [9844bbf]
- Updated dependencies [cef0eee]
- Updated dependencies [7ebff39]
- Updated dependencies [054fd84]
- Updated dependencies [5275d1f]
- Updated dependencies [7241a81]
- Updated dependencies [74add0c]
- Updated dependencies [aaba865]
- Updated dependencies [f1781be]
- Updated dependencies [5ab2f19]
- Updated dependencies [fbad078]
- Updated dependencies [45d5853]
- Updated dependencies [4f4fc03]
- Updated dependencies [2312bd9]
- Updated dependencies [6d5eb34]
- Updated dependencies [c5406c2]
- Updated dependencies [c5406c2]
- Updated dependencies [d99b731]
- Updated dependencies [2571a3e]
- Updated dependencies [a368ccb]
- Updated dependencies [2a48bd4]
- Updated dependencies [8a55f0c]
- Updated dependencies [c7b30bd]
- Updated dependencies [e391f87]
- Updated dependencies [20c6d35]
- Updated dependencies [417e245]
- Updated dependencies [69bca0a]
- Updated dependencies [023f00d]
- Updated dependencies [158c75d]
- Updated dependencies [7525045]
- Updated dependencies [5af42db]
- Updated dependencies [ce991bd]
- Updated dependencies [3c0f806]
- Updated dependencies [1071393]
- Updated dependencies [5f75cfa]
- Updated dependencies [29b9949]
- Updated dependencies [1d1cfe0]
- Updated dependencies [6757a93]
- Updated dependencies [b7cd5c8]
- Updated dependencies [5330038]
- Updated dependencies [2498a07]
- Updated dependencies [898bd2c]
- Updated dependencies [c9fc10b]
- Updated dependencies [dc6d28e]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [a7d4920]
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [466a219]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [54159d3]
- Updated dependencies [fa778e6]
- Updated dependencies [334f0cf]
- Updated dependencies [c08c933]
- Updated dependencies [92f979d]
- Updated dependencies [c4dd707]
- Updated dependencies [c4dd707]
- Updated dependencies [7578323]
- Updated dependencies [a491b64]
- Updated dependencies [38bb373]
- Updated dependencies [803f678]
- Updated dependencies [923504f]
- Updated dependencies [5b45c0d]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [0cd322d]
- Updated dependencies [97e7d4e]
- Updated dependencies [5d3f437]
- Updated dependencies [10aba37]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [51c661e]
- Updated dependencies [7af0ab3]
- Updated dependencies [b434f5f]
- Updated dependencies [9f282ef]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [cea429b]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [068a540]
- Updated dependencies [ca45c6d]
- Updated dependencies [093d55b]
- Updated dependencies [b64fda3]
- Updated dependencies [28ebfb5]
- Updated dependencies [a8051d6]
- Updated dependencies [72594f2]
- Updated dependencies [524136e]
- Updated dependencies [2b06a91]
- Updated dependencies [6f3299f]
- Updated dependencies [065a1cf]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [789cb16]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [37db09f]
- Updated dependencies [ff9df88]
- Updated dependencies [70e843f]
- Updated dependencies [caac3b2]
- Updated dependencies [a2225f9]
- Updated dependencies [5c4deb5]
- Updated dependencies [a8e5b73]
- Updated dependencies [9782cb2]
- Updated dependencies [3e2394d]
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [023087f]
- Updated dependencies [023087f]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [518a8e3]
- Updated dependencies [165f8ff]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
- Updated dependencies [6f5dc6b]
- Updated dependencies [7d0c174]
- Updated dependencies [8ed7e5a]
- Updated dependencies [6c4d00d]
- Updated dependencies [db8ce2f]
- Updated dependencies [726d8c9]
- Updated dependencies [f0e760a]
- Updated dependencies [a5bb7ac]
- Updated dependencies [f78efdd]
- Updated dependencies [8a8bcf3]
- Updated dependencies [f74638c]
- Updated dependencies [278bc29]
- Updated dependencies [ef71a09]
- Updated dependencies [8614705]
- Updated dependencies [619e3f7]
- Updated dependencies [ca7a4c3]
- Updated dependencies [c9e6742]
- Updated dependencies [4be76e0]
- Updated dependencies [f62b6ff]
- Updated dependencies [608033b]
- Updated dependencies [c6b7d82]
- Updated dependencies [611566b]
- Updated dependencies [efa9cb4]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [9d857c9]
- Updated dependencies [670ea10]
- Updated dependencies [ff215d9]
- Updated dependencies [71243db]
- Updated dependencies [e219a3d]
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [263e9dd]
- Updated dependencies [360e27a]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [464ae62]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [6367bfe]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [020d178]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [1aa622a]
- Updated dependencies [d2b21a1]
- Updated dependencies [6e4f144]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [15b1065]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [8392f74]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [8523e81]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [79cb8c0]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [03f1d65]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [b7fe09e]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [bcd9717]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [1d3da6c]
- Updated dependencies [0d97642]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [50ba1bb]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
- Updated dependencies [4c68855]
- Updated dependencies [2d8a8b7]
- Updated dependencies [cbac9d7]
- Updated dependencies [5129caa]
- Updated dependencies [9eb1479]
- Updated dependencies [74e37aa]
- Updated dependencies [961b69f]
- Updated dependencies [52907d7]
- Updated dependencies [f466b0a]
- Updated dependencies [673a71c]
- Updated dependencies [616df65]
- Updated dependencies [f48a4d5]
- Updated dependencies [58798ec]
- Updated dependencies [8803ca5]
- Updated dependencies [e70c21d]
- Updated dependencies [4b92c5a]
- Updated dependencies [06be396]
- Updated dependencies [3650d94]
- Updated dependencies [7c05f21]
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
- Updated dependencies [35a2b59]
- Updated dependencies [26b0bd2]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [53ee2f8]
- Updated dependencies [088e0f7]
- Updated dependencies [78b07f4]
- Updated dependencies [0df67f2]
- Updated dependencies [f962cdc]
- Updated dependencies [b403bb3]
- Updated dependencies [8a25fee]
- Updated dependencies [4016370]
- Updated dependencies [12dc7b4]
  - @object-ui/types@18.0.0
  - @object-ui/components@18.0.0
  - @object-ui/core@18.0.0
  - @object-ui/i18n@18.0.0
  - @object-ui/react@18.0.0
  - @object-ui/plugin-detail@18.0.0
  - @object-ui/fields@18.0.0
  - @object-ui/permissions@18.0.0

## 17.7.0

### Minor Changes

- 990a2d6: refactor(plugin-tree)!: retire the bare `tree` node type key; `object-tree` is the one spelling (objectui#10859, batch 8)
  
  **BREAKING (authoring):** the plugin no longer registers `tree` (and with it `view:tree`), the second key it registered on the `object-tree` renderer with the same inputs. `objectui validate` refused a `tree` node at `type`, because only `object-tree` has a declaration (`@objectstack/spec`'s `ComponentPropsMap` row), and nothing in this repository authored the alias. A node authored `type: "tree"` now renders the "Unknown component type" panel.
  
  Migration:
  
  - `{ "type": "tree", … }` → `{ "type": "object-tree", … }`, with the same keys.
  
  The host-composition VIEW type `tree` and the FIELD type `tree` are different layers and are unchanged: `ObjectView` and `ListView` already compose a stored tree view into an `object-tree` node.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 20d23be: `object-tree` publishes the keys its `@objectstack/spec` 17.5.0 row declares and its renderer honours (objectui#11168 slice 3, objectui#11111 decision 3 = B). Each key was measured on the real renderer first.
  
  - `data`, `staticData`, `filter` and `navigation` are now registration inputs on both tags (`object-tree` and `view:tree`). The page validator used to report each as an unknown prop, even though the tree reads it. Each description says what the tree does with the key, including the cases that draw nothing: the `api` and `schema` providers under `data`, and an absent `navigation`. On `navigation`, `page` and a block without `mode` open a record page through the record navigator the host publishes (the console publishes one on its custom pages, record pages and list views). The object is `data.object` when `data` is the object provider, so it wins when both are written, and the tree's `objectName` otherwise. Under a host that publishes none, or on a tree that names neither (inline rows with no `objectName`), they open nothing.
  - `objectName` is no longer a required input. The record source is one of `data`, `staticData` and `objectName`. A tree on inline rows never reads the object name, and the validator used to raise `missing-required-prop` on a tree that draws.
  - The `tree` input's description now names its four members and what each does.
  - `ObjectTree` reads `navigation` without a cast, because the node type declares it.
  
  What the tree draws and what a click opens are unchanged.
  
  ⚠️ **Dated note, 2026-10-02 — the `view:tree` tag is retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 unregistered the bare `tree` alias (and with it
  `view:tree`), so these inputs ship on one tag, `object-tree`. Author `object-tree`. The rest of this
  entry is kept as the reading of this change.
- e3d117a: `ObjectGantt` and `ObjectTree` resolve a relationship target only from the two
  spellings a contract carries, dropping the third one no contract declares
  (objectui#6837, second slice).
  
  - `ObjectGantt`'s quick-filter option fetch was
    `fd?.reference_to ?? fd?.reference ?? fd?.referenceTo`; it is now
    `fd?.reference_to ?? fd?.reference`.
  - `ObjectTree`'s `detectParentField` was
    `def?.reference || def?.reference_to || def?.referenceTo`; it is now
    `def?.reference || def?.reference_to`.
  
  **Accept-set move — a def carrying ONLY `referenceTo` stops resolving a target
  at these two seams.** Concretely: the gantt quick filter for that field falls
  back to the distinct values present in the loaded rows instead of fetching the
  referenced object's full domain, and the tree stops auto-detecting that field as
  its parent pointer, so records render as a flat forest unless `parentField` is
  configured explicitly. Nothing else changes; the two surviving arms are
  untouched.
  
  Two things bound that move:
  
  - Any def that entered through the ingestion choke point is unaffected.
    `normalizeSchemaReferenceKeys` reads `reference_to ?? reference ??
    referenceTo` and stamps both snake_case keys, so a `referenceTo`-only def
    arriving via `MetadataProvider` or `ObjectStackAdapter.getObjectSchema`
    already carries `reference_to` before either component sees it. Only a def
    that bypassed that door entirely is affected — and that door is not total:
    `getObjectSchema` is a required member of the published `DataSource`
    interface, and both components call it on the generic `dataSource`.
  - No contract declares the deleted spelling. `@objectstack/spec` 17.2.0's
    `FieldSchema` refuses `referenceTo` by name with `unrecognized_keys`, carrying
    its own "Did you mean `referenceTo` -> `reference`?" rename, and `referenceTo`
    is additionally a tombstone in `RETIRED_FIELD_KEY_TOMBSTONES` (objectui#6041)
    at all three strip sites, so the designer read door removes it before a draft
    round-trips.
  
  A repo-wide structure-walk producer census found **0** emitters of `referenceTo`
  reaching either seam, measured in the cell these components read (a value inside
  an object schema's `fields` container) against controls `reference` (92 hits / 36
  files) and `reference_to` (52 / 36) hot in the same pass over the same cells;
  the only two in-cell hits are negative fixtures of the retirement machinery,
  asserting the read door strips the key. Neither `plugin-gantt` nor `plugin-tree`
  emits `referenceTo` anywhere, while both packages' own fixtures are hot on the
  surviving spellings.
  
  Pinned by `ObjectGantt.referenceArms-6837.test.tsx` and
  `ObjectTree.referenceArms-6837.test.tsx`, which keep the live arms green beside a
  named refusal for the deleted key.
  
  ⚠️ **Dated note, 2026-09-30 — the choke point folds, it no longer stamps both keys — objectui#11070.** "`normalizeSchemaReferenceKeys` ... stamps both snake_case keys" above held when this change landed. Later in this same release objectui#11070 (round 4) made that pass fold a legacy spelling onto `reference` without stamping `reference_to`; a def that entered through it still carries `reference`, the one arm both components keep. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
- 045d20b: Relationship-target readers resolve a lookup's target from `reference` alone,
  dropping the `reference_to` fallback arm (objectui#6837, half 2).
  
  Maintainer ruling, 2026-08-31, 原文照录: 「objectui不是前端的项目吗?后端的元数据只要
  对,前端按协议执行就行了呀」. Protocol normalization belongs on the SERVER; the front
  end just executes the protocol. objectstack#13847 landed the server half — a
  `field-reference-to-alias` conversion rewrites stored `reference_to` to
  `reference` on the serve path and in `os migrate meta`.
  
  `reference` is the only target spelling `@objectstack/spec`'s `FieldSchema`
  declares. Measured on the installed 17.2.0: it refuses `reference_to`,
  `referenceTo` and `target` with `unrecognized_keys`, each carrying its own
  "Did you mean -> `reference`?" rename, while a nonsense key gets the same
  refusal with NO rename hint and `reference` parses clean.
  
  ## ⚠️ BREAKING for a hand-written schema that spells `reference_to` — read this
  
  **This is a behaviour change for BYO consumers, and it is being stated rather
  than shipped silently.** ObjectUI is usable without an ObjectStack backend
  (`examples/byo-backend-console`), and a hand-written TypeScript schema passes
  through no zod door, so nothing rejects the legacy spelling at authoring time.
  
  **The break surface is narrower than "all BYO consumers", and this is the
  measurement rather than a blanket claim.** Two ingestion choke points stamp both
  snake_case keys from whichever spelling arrived — `MetadataProvider`'s type
  cache for metadata type `object`, and `ObjectStackAdapter.getObjectSchema`. Any
  def that passed either one already carries `reference` and is **completely
  unaffected**. What is affected is exactly:
  
  - **A `DataSource` implementation other than `ObjectStackAdapter`.**
    `getObjectSchema` is a required member of the published `DataSource`
    interface, and the readers call it on the generic `dataSource` (through
    `useSettledSchema` and directly), so a host adapter's object schema reaches
    them raw. Every in-repo example of one is on this path:
    `ApiDataSource`, `ValueDataSource`, `packages/types/examples/rest-data-source.ts`,
    `examples/byo-backend-console/src/mockDataSource.ts`,
    `packages/runner/src/lib/mockDataSource.ts`,
    `apps/site/app/components/galleryDataSource.ts`,
    `apps/console/src/sdui-workbench-preview.tsx`,
    `packages/plugin-grid/demo/bulk-actions.tsx`.
  
  **Measured on this tree, none of those eight emits a relationship target at all** —
  `reference_to` and `reference` are both zero in each, and
  `examples/byo-backend-console` carries no lookup or master_detail field
  anywhere (its only `reference` hits are a vite triple-slash directive and a
  tsconfig `references` array). The single in-repo producer that WAS on this
  surface, `packages/plugin-gantt/demo/main.tsx`, is fixed here at the producer.
  
  ⇒ **If you author object metadata by hand and spell a lookup's target
  `reference_to`, rename that key to `reference`.** Symptom if you do not: the
  target silently fails to resolve, and the affected surface degrades rather than
  erroring — a related list is not derived, a gantt quick filter falls back to the
  distinct values in the loaded rows instead of the referenced object's full
  domain, a tree stops auto-detecting its parent pointer, a lookup cell shows a
  raw id, a chart's group-by labels stay unresolved.
  
  The ingestion choke point now emits a **dev-mode warning** when a def arrives
  carrying only `reference_to` or `referenceTo` and no `reference`. It names the
  object, the field and the offending key, and points at this ruling. Stamping is
  deliberately unchanged, so nothing that worked stops working. It is memoised
  once per **(object name, field name, spelling, target value)** — every segment
  of that key is pinned, in both directions, in
  `reference-keys.legacyWarning-6837.test.ts`.
  
  ⛔ **This warning does NOT cover the break described above, and it is worth being
  exact about that rather than letting it read as mitigation.** It lives in
  `normalizeFieldReferenceKeys`, reachable only through
  `normalizeSchemaReferenceKeys`, which has exactly two production call sites —
  `MetadataProvider` (metadata type `object`) and
  `ObjectStackAdapter.getObjectSchema`. Both of those also STAMP the def, so the
  warning fires precisely where the def still resolves and nothing is broken. A
  hand-written schema served through any OTHER `DataSource` — the break surface —
  reaches a reader raw: it never passes through this code and produces **no
  warning at all**. On that path the failure is exactly as silent as before.
  A reader-side or shared-resolver diagnostic, which would cover it, remains open
  on objectui#6837.
  
  ⚠️ **Dated note, 2026-09-29 — the call-site count above has since moved —
  objectui#7650.** "exactly two production call sites" above held when this change landed
  (`045d20ba8`). Later in this same release objectui#7650 (PR objectui#8868) added a call
  on `MetadataProvider`'s by-name object-schema serve path. Re-measured for objectui#10979
  on `main` at `2eaf5be27`, `normalizeSchemaReferenceKeys` had three production call sites:
  two in `MetadataProvider`, on its list path and on its by-name path, and one in
  `ObjectStackAdapter.getObjectSchema`.
  `.changeset/7650-metadata-item-reference-canonicalisation.md` (PR objectui#8868) states
  what ships; the text above is kept as the reading of this change.
  
  ## What did NOT change
  
  **Every key these readers EMIT is byte-identical**, and that was verified
  mechanically over the whole diff rather than asserted. Eleven of the sixteen
  sites write a target onto a bag whose own contract spells it `reference_to` (or
  camelCase `referenceTo`): the six whose read and write share a line —
  `RecordDetailDrawer`, `RelatedList`, `buildDefaultPageSchema`, `ListView`,
  `FilterConditionField`, `resolveActionParams` — plus five more that read on one
  line and emit on another, and so are just as much emitters: `RecordDetailView`,
  `RecordMetaFooter`, `ObjectGallery`, `fieldEnrichment` (all `reference_to`) and
  `UserFilters` (`referenceTo`). Only the right-hand read narrowed anywhere; the
  emitted key is what its target contract declares, and renaming it would be a
  separate change.
  
  **Three readers were deliberately left alone.** `LookupCellRenderer`
  (`fields/src/index.tsx`), `LookupField` and `UserField` read `FieldMetadata` —
  ObjectUI's OWN contract, whose `LookupFieldMetadata` declares `reference_to` and
  never declares `reference`. They are fed by the emitters above and by published
  example schemas (`examples/schema-catalog/src/schemas/fields-lookup/*.json`), so
  narrowing them would break in-repo producers, and `plugin-grid`'s
  `relationalMetaCopySet.derivation.test.ts` re-derives its read set from exactly
  those three sources — where `reference_to` is recorded with verdict
  `adapter-stamped`. `DetailViewFieldSchema` is likewise untouched.
  
  ⚠️ **Dated note, 2026-09-30 — the stamp, the three readers and the emitted key have since moved — objectui#11070.** Later in this same release objectui#11070 (round 4) retired `reference_to` inside ObjectUI as well. `normalizeFieldReferenceKeys` now FOLDS a legacy `reference_to` / `referenceTo` onto `reference` and no longer stamps `reference_to`, so "Stamping is deliberately unchanged" and "stamp both snake_case keys" above no longer describe what ships. `LookupCellRenderer`, `LookupField` and `UserField` read `reference` only; `LookupFieldMetadata`, `MasterDetailFieldMetadata` and `DetailViewField` (with `DetailViewFieldSchema`) declare `reference`; and the emitters listed under "What did NOT change" write `reference`. A hand-written schema served through a `DataSource` other than `ObjectStackAdapter` that spells only `reference_to` therefore also loses the lookup picker's target and the read cell's name. `.changeset/11070-reference-to-round4.md` states what ships; the text above is kept as the reading of this change.
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
- 846cec0: **Breaking behaviour change — `object-tree` now honours only the `data` spelling its published row declares.**
  
  Decision batch #83, maintainer verbatim 「8348 以协议为准」: a view block honours the `data` spelling its block's published row declares, and no other. `object-tree` was the one ladder block that ruling could not reach, because no published face declared a `data` row for it, so it honoured ANY truthy `data`. Ruling batch #136 item 3 (Q1-C) had the protocol gain the row, and `ComponentPropsMap['object-tree']` in the installed `@objectstack/spec` declares `data` as the `ViewData` union and `staticData` as an array. The ruling's 「协议没有的能力删」 clause did not fire — the row does declare `data` — so the tree keeps the object form and loses only the bare-array spelling.
  
  - `data: { provider: 'value', items: [...] }`, `{ provider: 'object', object }` and `{ provider: 'api', … }` — **unchanged**, still the tree's first record source.
  - `staticData: [...]` — **unchanged**; the same row declares it, and it is still the second rung.
  - ⚠️ `data: [...]` (a bare array) — **no longer a record source.** The ladder falls through to `staticData`, then `objectName`: such a tree queries its object instead, or draws `No records` when it names neither. In a development build `SchemaRenderer` says so once, naming the key and the spelling that works; in production it is quiet. This is the same outcome `object-map` and `object-gantt` already give for the same spelling. Stored documents authored that way stop drawing those rows — accepted by the ruling, with no transition window. Move inline rows to `staticData` or to `data: { provider: 'value', items }`.
  - The `data` **prop** a host hands down (`ListView`'s tree) is untouched.
  
  Two carriers had to close for this to be observable. `@object-ui/core`'s `recordSourceDataArmForType` now answers `'view-data'` for all four spellings the tree registers under (`object-tree`, `plugin-tree:object-tree`, `tree`, `view:tree`), so `SchemaRenderer` no longer spreads an authored `data` on a tree node as a React prop (objectui#9571). And `ObjectTree`'s own fetch effect no longer reads `schema.data` beside the host prop — that second reader bypassed the shared ladder, so an arm change alone would have removed nothing end to end.
  
  ⚠️ **Dated note, 2026-10-02 — two of the four spellings are retired — objectui#10859.**
  Later in this same release objectui#10859 batch 8 unregistered the bare `tree` alias, and with it
  `view:tree`; `recordSourceDataArmForType` answers `'view-data'` for `object-tree` and
  `plugin-tree:object-tree` only. The rest of this entry is kept as the reading of this change.
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
- 009f92d: `ObjectTreeProps.schema` is the published `object-tree` node instead of `any`,
  and `getTreeConfig`'s parameter with it (objectui#8655).
  
  The type WAS DERIVED rather than written out: `Extract< ObjectQLComponentSchema, { type:
  'object-tree' } >`, the spelling that union's own docblock teaches. So every key
  name and key type still has exactly one declaration, `ObjectTreeSchema` in
  `@object-ui/types`, and a key added or retyped there arrives here without an
  edit. `Extract` rather than a named import because, when this landed, the TS barrel did
  not export `ObjectTreeSchema` — the zod barrel did, and its eleven sibling arms
  were all on the TS one. Repairing that omission was a published-surface addition
  on another package, so it was reported rather than smuggled in here, and
  objectui#9550 took it: the name is on that barrel in THIS SAME RELEASE and this
  package now imports it — see that entry. ⚠️ So the derivation described above is the
  state this card left behind, ⛔ not the state being released; the shipped code reads
  as a named import. The claim that survives both spellings is the one that mattered:
  one declaration, `ObjectTreeSchema`, and no copy of it here.
  
  Accept-set change on the published props type, stated plainly:
  
  - NARROWS. `any` accepted everything; the node accepts what `ObjectTreeSchema`
    declares plus anything `BaseSchema`'s `[key: string]: any` admits. Breaking
    for a TypeScript consumer that passed a value the node schema refuses at a
    DECLARED key — `labelField` and `fields` are the two that can bite, since the
    renderer tolerates host column OBJECTS there while the declaration says
    `string` / `string[]`. This package's own test carried exactly that shape and
    now says so at the mount rather than compiling silently.
  - No runtime behaviour changes. One `as any` is removed at a read site and one
    is deliberately kept; both are casts, neither is a value.
  
  Why the type had to come first: the two reads this card was filed on were
  reported UNANSWERABLE, not undeclared. Through `any`, `checker.getPropertyOfType`
  returns `undefined` for a key the node certainly declares exactly as it does for
  a nonsense token, so no verdict was available at all. Typed, the checker answers,
  and the two answers point in opposite directions — `data` is DECLARED (on
  `BaseSchema`), so its cast is gone; `navigation` is genuinely undeclared and its
  cast stays, marking the read rather than hiding it.
  
  What the re-measurement then surfaced, reported rather than tidied: six more
  reads became answerable, five declared and one — `filter` — not. Its verdict is
  declare-by-mirror-alignment and it is ⛔ NOT executed here, because the two files
  that would carry it are held by an in-flight branch; the ledger row in
  `ObjectTree.schemaTyped-8655.test.ts` reddens the day it lands. `tree` is
  declared by the protocol on the VIEW and on zero element faces, so declaring it
  on the node would fork rather than mirror the contract, and retiring the read
  needs a producer census a text search cannot make. `navigation` belongs to a
  blocked card and is ledgered, ⛔ not ruled.
  
  Nothing in `@object-ui/types` is declared, widened or narrowed by this change.
  
  **Note, 2026-10-01 (objectui#11168 slice 3, shipping in this same release).**
  The `navigation` and `tree` readings above changed after this entry was written.
  `@objectstack/spec` 17.5.0 gave `object-tree` an element row, and that row
  declares both keys, so both verdicts here were re-run on that contract.
  - `navigation` is DECLARED on `ObjectTreeSchema` as the spec's
    `NavigationConfig`, and the cast this entry says "stays" is gone.
  - `tree` is DECLARED as the spec's `TreeConfig`, by reference. Mirroring the
    element row is not the fork described above.
  - `ObjectTreeSchema` also declares `data` as `ViewData` (not `BaseSchema`'s
    untyped `data`) and `staticData`, and `objectName` is optional.
  
  So the sentences above that say these keys are undeclared describe the tree at
  objectui#8655, not the code in this release. See that slice's changesets for
  `@object-ui/types` and `@object-ui/plugin-tree`.
- 2f6b2bf: Derive `TreeViewConfig` from `@objectstack/spec` and drop `titleField`, the key the
  protocol refuses on `ListView.tree` (objectui#8841).
  
  **What was wrong.** `@object-ui/types` published `TreeViewConfig` as a hand-written
  interface — a copy of the protocol's `ListView.tree` block under a second name — and the
  copy declared a fifth key, `titleField`. `@objectstack/spec@17.4.0` refuses that key
  there by name: `TreeConfigSchema` is a `strictObject` since spec objectstack#15469 closed the
  `.passthrough()` window 17.3.0 left open. So this package's published face accepted what
  the contract rejects, and an author who followed `@object-ui/types` was refused at
  publish with `Unrecognized key(s) on this tree configuration: 'titleField'`. The copy was
  invisible to `scripts/check-spec-symbol-derivation.mjs`, which matches spec symbols BY
  NAME — a hand copy renamed away from the spec's symbol has nothing for its rule 1 to
  match (objectui#4592's recorded blind spot).
  
  **The grades, and why.**
  
  - `@object-ui/types` — **minor**. `TreeViewConfig` is now
    `NonNullable<ListView['tree']>` from `@objectstack/spec/ui`, and `titleField` is
    removed from a **published** exported type. That is breaking for a producer that
    annotates a `tree` block carrying the key; per this repo's version-alignment policy
    (AGENTS.md — objectui's major tracks `@objectstack`'s) objectui's own breaking changes
    ship as `minor` with the breaking semantics stated here. The precedent is the same
    shape: `Remove the retired striped / bordered / virtualScroll list-view surface`
    (`@object-ui/types` 17.6.0, minor) propagated a spec-side retirement into this package
    the same way.
  - `@object-ui/plugin-tree` — **minor**. `getTreeConfig`'s `labelField` chain loses its
    third rung, `?? schema.titleField`. That rung read the flattened **node**, never the
    block, and `titleField` is declared on neither face — not on `ObjectTreeSchema` (the TS
    interface or its zod mirror) and not on the protocol's `ListView.tree`. It is a runtime
    behaviour change, graded like one. The README's claim that this block is "the single
    declaration of that shape" is corrected in the same stroke: the protocol owns it, and
    this package publishes it derived.
  - `@object-ui/plugin-view` — **patch**. `ObjectViewProps.views[n].tree` still resolves to
    `TreeViewConfig`; what it admits narrows with the type. Type-only, no runtime change.
  - `@object-ui/app-shell` — **patch**. The console's `tree` composition keeps both rungs;
    only the second one's annotation changes (see below). No runtime change.
  
  **The tolerant reads are kept, and deliberately left undeclared.** Three
  `labelField || titleField` dual-reads survive — `plugin-view`'s and `plugin-list`'s
  `'tree'` branches and the console's own composition in `app-shell` — so a view record
  that already stores `tree.titleField` keeps resolving exactly as before, and
  objectui#6557's pin on that rung stays green. They read through `any` now; the console's
  canonical rung stays annotated `TreeViewConfig` while its legacy rung is not, because
  casting it to a type that no longer carries the key cannot compile and re-declaring the
  key locally would fossilise a renderer-side alias into a second contract — the AGENTS.md
  #0.1 defect this change undoes. Retiring those three reads is a follow-up.
  
  **Migration.** A host that writes `tree.titleField` should write `tree.labelField`, which
  is the protocol's spelling and already wins wherever both are present. Nothing that
  renders today stops rendering; what changes is that the key is now reported at compile
  time by the same face that will refuse it at publish, instead of only at publish.
- 9c08dc6: Honour `filter` and the platform row ceiling on a tree's inline
  (`provider: 'value'`) data (objectui#9136) — the fourth surface of the
  objectui#8769 repair, after objectui#9061 ported it to `ObjectCalendar` and
  `ObjectMap`.
  
  **The defect was fail-open.** `ObjectTree`'s record effect set the authored rows
  and returned on the inline provider without reaching the query in its `object`
  arm, which is the one site in the file that lowers `schema.filter` to `$filter`
  and the objectui#7210 ceiling to `$top`. So an inline tree that declared a
  `filter` drew **every** authored row, with no diagnostic. The key that was
  dropped is the key that NARROWS: the view answered a wider question than the
  author asked. Nothing was exposed that was not already in the authored schema —
  this is a correctness defect, not a data-access one.
  
  **What changed.** The inline provider resolves a `ValueDataSource` over its own
  rows and issues the same query the `object` arm issues (`$filter`, `$top`), then
  goes through the same `applyNonGridRowCeiling`. Two keys, not the siblings'
  three: `ObjectTree` reads `sort` on no provider, so nothing about ordering moves.
  No dependency array moves, and the `object` provider is untouched.
  
  **Behaviour you may notice.** This is a behaviour change on inline trees, and
  it is declared `minor`, as objectui#9061 declared the same change on the
  calendar and map:
  
  - An authored `filter` now narrows inline rows, on both inline spellings —
    `data: { provider: 'value', items }` and `staticData`.
  - The row ceiling now applies to inline rows: past `NON_GRID_ROW_CEILING`
    (`@object-ui/react`) rows the tree draws that many and shows the footnote
    naming both numbers, as it already did for fetched rows. The tree is the view
    that ceiling's value was measured on. It is applied to the **filtered** set,
    so a large inline array that a `filter` cuts below the ceiling draws every
    matching row and stays quiet.
  - Rows a host passes down through the `data` React prop, or as a bare array
    under `schema.data`, are unchanged: that passthrough sits above the inline
    branch and is still never filtered or capped here.
  - Inline rows now reach the tree as the adapter's own deep copy
    (`structuredClone`, objectui#9175) rather than as the authored array's object
    identities. A row handed to `onRowClick` is that copy, so code comparing it
    against the authored array with `===` needs `id` equality instead. A record
    graph carrying a back-reference still renders; a function-valued key in an
    inline row now fails loudly with the tree's error panel instead of rendering.
- 7098eed: One record-overlay shell: all five list-type renderers honour all four overlay
  `navigation.mode` values (objectui#9299, director seat decision batch #128 item
  1, 2026-09-13).
  
  `ObjectGantt`, `ObjectKanban` and `ObjectCalendar` rendered one drawer for every
  authored mode — `modal`, `split` and `popover` silently WERE the drawer, with no
  diagnostic. `RecordDetailDrawer`'s payload is extracted into the new
  `RecordDetailPanel` (shell-free by construction) and mounted through the shared
  `NavigationOverlay`, which is what `ObjectGrid` and `ObjectTree` already used.
  
  User-visible on published surfaces:
  
  - **`modal` / `split` / `popover` now do what they say** on the gantt, the
    kanban and the calendar.
  - **`split` renders.** Each renderer passes its own view as `mainContent`, so
    the board / calendar / chart / tree / grid sits beside the record panel.
    Authored `split` used to render NOTHING on `ObjectTree` — and, measured while
    fixing this, on `ObjectGrid` too.
  - **`popover` is anchored to the element the user clicked** — row, node, bar,
    card, event — instead of degrading to a centred dialog. It was honoured on no
    surface before.
  - **Drawer chrome converges** on the shared shell's header (breadcrumb title,
    close, optional expand) for the three renderers that brought their own.
  - **Drawer widths carry over, they are not reset.** The two drag-resize
    implementations become one: a width persisted under the retired
    `objectui.drawerWidth.OBJECT` is read once, written forward to
    `ov:drawer-width:OBJECT` and removed. One key per object across every view
    type. The default width is unchanged at every viewport (objectui#6584); an
    authored width below `min(60vw, 880px)` now widens to it, which is the shell's
    long-standing policy on grid and tree.
  - **Richer record body on grid and tree** — typed widgets, declared labels,
    honoured `hidden` — wherever the object declares its fields. With nothing
    declared those two renderers keep their own value-inference reading, which is
    what preserves the locale-aware date fallback (objectui#4541), the localized
    empty placeholder (objectui#8491) and the `format` hint (objectui#8920); the
    overlay shell is the shared one on that path too.
  
  New published API: `RecordDetailPanel`, `buildRecordDetailFields`,
  `RECORD_OVERLAY_DEFAULT_WIDTH` (`@object-ui/plugin-detail`);
  `useOverlayAnchor`, `recordOverlayWidthStorageKey`,
  `legacyRecordDrawerWidthKey` and the `popoverAnchorRef` / `legacyStorageKey`
  props on `NavigationOverlay` (`@object-ui/components`). `RecordDetailDrawer`
  keeps its props and is now a thin wrapper over the shared shell. ⛔ No spec
  change.
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
- d16d0e9: `ObjectTreeSchema.filter` is declared on both faces, in the shape objectui#9309
  settled for `ObjectGallerySchema.filter`: `QueryParams['$filter']` by indexed
  access on the TS interface in `objectql.ts`, and the same two-arm union (array
  first) on the zod mirror in `zod/objectql.zod.ts` (objectui#9549).
  
  The key was already delivered and read before it was declared. `ListView` puts
  `filter` on the `baseProps` every child view receives, and `ObjectTree` sends
  `$filter: schema.filter` on its own fetch. Until now the value survived only on
  `BaseSchema`'s `[key: string]: any` and the mirror's `.passthrough()`.
  
  Accept-set change on the published surface, stated plainly:
  
  - NARROWS, both faces. `filter: 'stage=won'` and `filter: 42` are type errors
    now, and the mirror refuses them at parse time instead of keeping them
    unjudged. Breaking for any TypeScript consumer that assigned a non-object
    value to this key on an `object-tree` node.
  - Both object arms still compile and parse: the ObjectQL field-keyed record
    (`{ age: { $gt: 18 } }`) and the spec's `FilterArray` sugar
    (`[['status', '=', 'active']]`).
  
  `@object-ui/plugin-tree`: the renderer no longer reads the tree block from
  `filter.tree`. It used to resolve the block as `schema.tree`, falling back to a
  `tree` member of `schema.filter`; that second dialect treated the query filter
  as a holder of tree config. Measured before removal: no example, fixture, test
  or doc authors a `tree` under `filter`, and the arm dates from the renderer's
  first commit with no stated reason. Author the block as `tree`. A node that put
  it under `filter` now gets the auto-detected parent field and the default label
  column, and the `filter` object is still forwarded as `$filter`.

### Patch Changes

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
- 8c3d7fc: fix(plugin-tree): `object-tree` re-reads its rows on the data-invalidation bus
  
  The record effect of `ObjectTree` now names the `useDataInvalidation` nonce for
  the object its `object` provider queries — whether the node spells it
  `objectName` or `data: { provider: 'object', object }` — so a write declared on
  the bus (`notifyDataChanged`, as a page action over raw HTTP does) re-reads the
  tree in place, keeping the user's expansion choices. Before, a tree that no
  host handed rows to refreshed after such a write only when its host remounted
  it, and `PageView` is about to stop doing that (objectui#10519).
  
  Inline rows (a `data` array, the `value` provider) name no object and do not
  subscribe. A tree whose host hands down rows (the `list-view` tree) subscribes
  too: it runs its own full query ahead of those rows, so its freshness does not
  rest on the host's rows moving.
- 4d0af04: fix(plugin-tree): `object-tree` keeps its rows on screen while it re-reads them
  
  `ObjectTree` drew its "Loading…" placeholder whenever a read was in flight, so
  every re-read — each data-invalidation event for its object among them — took
  the table off the screen and put it back: the rows flashed, and a scrolled tree
  lost its scroll offset.
  
  The placeholder is now drawn only while the tree has no rows for the source it
  is bound to: the first load, a switch to another object or data provider, and an
  empty result being re-read. A re-read of the same source keeps the rows, the
  scroll container and the user's expansion choices on screen, with the shared
  `RefreshIndicator` bar across the top of the tree while the read is in flight
  (named through the locale's `grid.refreshing`). The previous object's rows are
  never drawn under a new object or provider.
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
- b00fcba: `ObjectTree` formats its cells the way the flat table does: a lookup column renders the
  referenced record's display name and a select column renders its translated option label,
  instead of a raw record id and the raw stored value (objectui#6014).
  
  Reported against the built-in 业务单元 (`sys_business_unit`) page, whose 「组织架构」 tree tab
  showed the manager column as a bare user id and the type column as `department`, while the
  flat-table tab on the same page — over the same expanded records — showed the user's name
  and 「部门」.
  
  The card carried its own control, and it pointed at the fetch rather than the formatter. The
  tree treated "the host passed inline `data`" as "I do not need the object schema" and skipped
  `getObjectSchema`, but its record-fetch branch prefers a live object dataSource over any
  inline data. On the one mount shape `ListView` actually uses — `objectName` + a dataSource +
  its own pre-fetched `data` — the tree therefore issued its OWN query with
  `buildExpandFields(undefined)` → `[]` → no `$expand` at all, and had no field definitions to
  format cells from. Both reported symptoms fall out of that single gap, which is why the flat
  tab was unaffected and why the tree's existing tests (inline data, no dataSource — a path
  that never runs the tree's own fetch) could not see it.
  
  Three changes, all inside `packages/plugin-tree`:
  
  - The object schema is fetched whenever the dataSource can serve one, not only when no host
    passed inline data. The guard inside the fetch already no-ops without a dataSource, so the
    pure inline/static path is unaffected.
  - Records are no longer fetched until that schema has settled — settled, not necessarily
    successful, so a rejected or inapplicable schema fetch can never block the tree. This also
    removes a wasted first query whose lookup columns came back as bare ids and were painted
    for a moment before the real query landed.
  - Cell values route through a field-aware formatter that delegates both decisions rather than
    re-deciding them: option labels through the `translateOptions` seam `ObjectGrid` already
    uses for the flat tab (so both tabs read one `fieldOptions.*` i18n key, with the same
    exact-then-case-insensitive match and `humanizeLabel` fallback as `SelectCellRenderer`), and
    expanded references through `getRecordDisplayName`, the unified display-name resolver
    (ADR-0079), with the family judged by `isExpandableFieldType` — the same predicate that
    decided what to put in `$expand`.
  
  No new exports and no new package dependencies: both resolvers were already published from
  `@object-ui/core`, and `translateOptions` was already reachable through the `useSafeFieldLabel`
  hook this component calls for its column headers.
  
  One visible consequence beyond the report: an expanded record that comes back with no name-ish
  field now reads as ADR-0079's `Record #<id>` floor — the string every other surface shows for
  it — rather than as the bare id.
- 9abc02a: `ObjectTree` no longer queries a switched-to object with the previous object's
  `$expand` set (objectui#6481).
  
  The schema-settled gate was two separate pieces of state — the definition
  (`objectSchema`) and a bare `schemaSettled` boolean that was set `true` in a
  `finally` and never reset. Two independent values cannot express "settled, but
  for a DIFFERENT object", so when the host swapped the bound object both effects
  re-ran while the latch still read `true` from the previous object's settle and
  the definition still held the previous object's fields. The tree issued
  
      find(newObject, { $filter: …, $expand: [ …previous object's relation fields… ] })
  
  — rejected or silently ignored depending on the adapter, plus the transient it
  painted — before a correct second query followed.
  
  `ObjectTree` now adopts `useSettledSchema` from `@object-ui/react` (the shared
  resolution hook ruled in objectui#6482), replacing BOTH pieces of state with the
  hook's single `{ key, def } | null`. Readiness is derived during render by
  comparing the settled key against the currently bound object, so the gate closes
  in the same commit that changes the object rather than one commit later — the
  stale-key window is not merely fixed but unrepresentable.
  
  Behaviour that deliberately does NOT change: the gate stays inside the
  object-provider branch of the record effect (the inline/static branches issue no
  metadata read and must not wait on one), and every exit still settles — no
  `getObjectSchema`, no object name, or a rejected read each settle with no
  definition, so a tree whose adapter serves no schema still queries instead of
  waiting forever.
- 37200ee: Re-key `ObjectTree`'s record-fetch effect onto the primitive fields it
  actually reads off `dataConfig` (`provider` / `object` / `items`) instead of
  the whole memoised `dataConfig` object (objectui#6700, closing out the
  census #6592 opened — the schema-resolution half of this component was
  already re-keyed onto `useSettledSchema`'s primitive `schemaKey` by #6696).
  
  `useMemo` carries no semantic guarantee — React is permitted to discard a
  memo cache and recompute even when its dependency array compares equal to
  the previous render, and the local `getDataConfig(schema)` helper builds a
  fresh `{ provider, object }` / `{ provider, items }` wrapper object on every
  call. So the record-fetch effect, keyed on `dataConfig` itself, was correct
  only for as long as that identity happened to survive a discard: a
  recompute alone (no author or caller action) was enough to re-run the
  effect and issue an extra `dataSource.find` call. Keying the effect on the
  primitives instead makes a cache discard a no-op, restoring `useMemo` to a
  pure optimisation — mirroring the fix already shipped for `ObjectMap` /
  `ObjectCalendar` / `ObjectGantt`.
  
  No behaviour change for a schema whose `useMemo` caches survive normally;
  the effect is unaffected by React discarding one.
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
- 2ce2612: A record-page URL now names the object the clicked rows actually came from, in
  `ObjectTree` and `ObjectCalendar`.
  
  `useNavigationOverlay` builds `/{objectName}/record/{id}` out of whatever it is handed,
  and both components handed it the bare top-level `schema.objectName` while resolving
  their own rows through the ruled record-source ladder (`data`, then
  `staticData`, then `objectName`). `77cb489b4` published `objectName` as that ladder's
  THIRD RUNG and not as a parallel "page object" concept, so a block has exactly one
  record source — and a row fetched through `data.object` whose click built
  `/{schema.objectName}/record/{id}` named a record that the URL's own object does not
  contain.
  
  Two shapes change, both toward the object the rows came from:
  
  - a block carrying **both** bindings navigated to the top-level key and now navigates to
    `data.object`;
  - a **data-only** block had no name to build a URL from at all, so the hook took its
    `/{id}` leg — an unrouted path that paints a blank page — and now builds the routed
    record URL.
  
  `ObjectCalendar` is where the divergence was plainest: on one click it resolved the
  detail drawer through the ladder and the navigation URL through the top-level key. The
  URL now reuses the very `schemaObjectName` that already keys the calendar's record query
  and its `$expand` derivation, so query, drawer and URL agree by construction.
  
  **Nothing else moves.** Both converted sites keep a site-local `?? schema.objectName`
  tail for the off-contract `data: { provider: 'object' }` that carries no `object`
  (`ViewDataSchema` declares it required) — the same tail `ObjectTree`'s `headerObjectName`
  already carries, and the same conservatism `b041b9c0c` applied when it published the
  shared reader. `useNavigationOverlay`'s own signature is unchanged: it still takes an
  `objectName`, and only what callers hand it has changed.
  
  The hook's `@example` stops prescribing `objectName: schema.objectName`. That prose is
  why there were copies to convert at all — component authors copied the divergence out of
  the documentation, correctly, as written — so it now points at
  `resolveRecordSourceObjectName` and says explicitly that a caller with no data config
  has nothing above rung three and should keep passing `schema.objectName`.
  
  `ObjectKanban` is deliberately **not** converted: it has no data config, no
  `getDataConfig`, and its `data` is a raw row array rather than a `ViewData` binding, so
  `schema.objectName` already IS its record source and its board, drawer and URL already
  agree.
- f556a89: `ObjectTree`'s parent-pointer auto-detection accepts a `tree` field only when it is
  this object's own (objectui#7839, objectstack#14892 follow-up).
  
  A hierarchy is parent/child **within one object**, so `@objectstack/spec` refuses a
  `tree` field whose `reference` names any other object (`refuseForeignTreeReference`);
  `reference` stays optional on a `tree`, where it is a redundant self-annotation.
  `detectParentField` returned the first `type: 'tree'` field whatever its `reference`
  said, so a foreign-shaped one was silently picked as the parent pointer and the forest
  was grouped on a pointer into a table it does not point at. It now mirrors the spec's
  own kernel predicate `hasDetectableParentField` term for term — accept when `reference`
  is absent, or when it equals the bound `objectName` — and the `objectName` guard comes
  with it: an object whose name we do not know cannot be self-referenced.
  
  Skipping rather than returning also removes a masking bug the old early-return hid: a
  foreign `tree` declared before a self-referencing `lookup` used to win by position and
  the lookup never got its turn. The `lookup` / `master_detail` arm is otherwise
  unchanged.
  
  Reachability is narrow and stated rather than oversold: the refused shape does not
  survive `ObjectSchema.parse` on a spec carrying that rule, so it is unreachable from
  parsed metadata and reachable from a hand-built one — `getObjectSchema` is a required
  member of the published `DataSource` interface, so a third-party implementation reaches
  this reader raw. Note also that the renderer tightens **ahead** of the spec copy this
  repo installs: `@objectstack/spec@17.2.0` still accepts the foreign shape at parse
  (measured), so until that pin moves this function is the only door.
- 3e98e13: Export the host `tree` view config as `TreeViewConfig` (objectui#8253, director
  decision batch #78, 2026-09-07, maintainer 「同意」 on option (a)).
  
  **What was wrong.** `tree` is a host-composition-only view type — ruled deliberate on
  objectui#5321, it is a member of neither `ObjectViewSchema.defaultViewType` nor
  `NamedListView.type`, so the branch runs only when a host passes a `views` prop. On
  that path a per-view `tree` block is read at four sites, and its only description
  anywhere was a module-local, non-exported `interface TreeConfig` inside
  `plugin-tree/src/ObjectTree.tsx`. The live host is the console: it stores view records
  and passes them as `views`, and its create-view dialog offers `tree`. So a real
  consumer wrote this block with no type to write it against, and a misspelled
  `parentFeild` was admitted by the views entry's `[key: string]: any`, stored, read by
  nobody and reported by nothing. Declared ≠ enforced on a surface a non-author
  re-writes.
  
  **The grades, and why.**
  
  - `@object-ui/types` — **minor**: one new name, `TreeViewConfig`, becomes reachable
    from the package entry. Nothing existing is renamed, retyped or removed, and no
    value's validation changes anywhere in this package.
  - `@object-ui/plugin-view` — **minor**: `ObjectViewProps.views[n].tree` is now
    declared `TreeViewConfig` where it previously resolved to `any` through the entry's
    index signature. On a face that already admitted every spelling a declaration
    **cannot widen — it can only narrow**, and this one does: a host composing the entry
    as an object literal now gets `parentFeild` reported as an excess property instead
    of silently dropped. The index signature itself is untouched, so every other
    undeclared key a host puts on the entry still type-checks exactly as before.
  - `@object-ui/plugin-tree` — **patch**: the module-local interface becomes an import
    of the exported one and the resolver's own type is `Pick`ed off it. No runtime
    behaviour changes, and no key is added to or removed from what the renderer reads.
  
  **`titleField` was declared, not deleted — and that was a measurement.** The ruling put
  this key to a test: declare it if the console writes it, else remove the read. The
  console's create-view dialog does **not** offer it (its `tree` slot collects
  `parentField` alone), but the console's own host composition reads it by name, so do
  the `ListView` and `ObjectView` tree branches, and that rung is pinned as live behaviour
  by objectui#6557 ("the tree's second view-declared rung … still answers"). Deleting that
  read would have reversed a recorded ruling and reddened that pin, so this change declared
  the key at all four read sites instead. `labelField` remains canonical and wins wherever
  both are present.
  
  ⚠️ **Superseded — the declaration has since been removed.** objectui#8841 (PR
  objectui#9052) settled it against the protocol rather than against the reads:
  `@objectstack/spec@17.4.0`'s `TreeConfigSchema` is a `strictObject` and refuses
  `titleField` on `ListView.tree` by name, so declaring it here published a key an author
  following `@object-ui/types` was refused for at publish. `TreeViewConfig` is now derived
  from that protocol block and no longer carries the key, and `plugin-tree`'s
  `?? schema.titleField` rung — which read the flattened NODE, not this block — went with
  it. ⛔ What did NOT go is the view-declared read objectui#6557 pins: the
  `labelField || titleField` dual-reads in `plugin-view`, `plugin-list` and the console
  survive as undeclared tolerance, so stored view records keep resolving and that pin is
  still green. Read this entry for why the key was declared and objectui#8841's for why the
  declaration could not stand; the migration is to write `tree.labelField`.
  
  **Migration.** None required. Hosts that already compose a `tree` block keep working;
  hosts that annotate one against `TreeViewConfig` start getting a compile error for a
  misspelled key instead of a view that silently ignores it.
  
  ⛔ This does not make `tree` an authorable view type. objectui#5321 is untouched: the
  block is host config, written by a host and never by a document author, and the
  authored node remains the flat `ObjectTreeSchema`.
  
  **Note, 2026-10-01 (objectui#11168 slice 3, shipping in this same release).**
  The last sentence above calls the authored node "the flat `ObjectTreeSchema`".
  `@objectstack/spec` 17.5.0 gave `object-tree` an element row whose `tree` block
  carries `parentField`, `labelField`, `fields` and `defaultExpandedDepth`, and
  `ObjectTreeSchema` now declares that block by reference, so an authored tree
  writes those keys under `tree` rather than flat on the node. The flat spellings
  `ObjectTreeSchema` still carries are the form a host composes. What this entry
  says about the host `tree` view config, `TreeViewConfig` and objectui#5321 is
  unchanged.
- 5e96b45: `ObjectTree` derives expansion during render instead of mirroring it into state
  (objectui#8666).
  
  **The rendering artifact this removes.** Expansion lived in a
  `useState<Set<string>>(new Set())` that a passive `useEffect` keyed on
  `[roots, defaultExpandedDepth]` re-seeded from the forest, with rows computed as
  `flattenVisible(roots, expanded)`. So the commit that first painted the table
  still carried the previous, empty mirror: the root drew, its children did not,
  and a second commit drew the seeded-open forest. Probed in the DOM the sequence
  was `loading` then a one-row table then a two-row table; it is now `loading` then
  the two-row table. Every mount with a non-zero `defaultExpandedDepth` showed a
  collapsed forest for one frame, and that frame is also why a test could observe a
  half-drawn tree at all.
  
  **The behaviour change that comes with it, and it is the load-bearing half.**
  Component state now holds only the answers the *user* gave by clicking a chevron
  — a sparse map of node id to open/closed — and the seed is computed from the
  forest during render. They compose by one rule: a new forest may re-seed, but a
  node the user deliberately opened or closed, and which is still in the forest,
  keeps the user's answer; every other node, a genuinely new one included, takes
  the seed.
  
  That is a fix in the same direction as the frame, not a side effect of it.
  Before this change a re-seed *overwrote* the user's expansion, so any change to
  the identity of the record set — a refetch, a filter, a host re-render that
  reallocated the rows — silently reopened every subtree the user had collapsed
  and reclosed every one they had opened below `defaultExpandedDepth`. Authored
  metadata is unaffected: `defaultExpandedDepth` means exactly what it meant, and
  no schema key changes.
- bbe57fd: Import `ObjectTreeSchema` instead of re-deriving it (objectui#9550)
  
  `ObjectTree` typed its node by narrowing the published union on the `object-tree`
  tag and binding that to a module-local alias. That spelling was correct and it was
  forced: the name it wanted was declared in `@object-ui/types` and re-exported by
  the `./zod` barrel, but the root barrel did not carry it, so there was nothing to
  import. objectui#9550 put the name on that barrel, and this package now imports it.
  
  Nothing about the type changes — the imported name and the narrowing resolve to the
  same declaration, which `ObjectTree.schemaTyped-8655.test.ts` asserts invariantly and
  independently through `ObjectTreeProps['schema']`. What changes is that the renderer
  no longer carries a derived restatement of a published type. A type nobody can import
  mints one of those per consumer, and each one is correct on the day it is written —
  that is the second-authority shape objectui#6349 is burning down, and this was one of
  its instances rather than a tidy-up.
  
  The docblock's justification paragraph went with it: it stated, as its measured reason
  for choosing the narrowing, that the barrel omits the name so it "cannot be imported
  today". That sentence is false as of objectui#9550 and nothing re-derived it. The
  objectui#8651 warning beside it is KEPT and re-pointed at the import: a module-local
  type wearing a published type's name is the two-layers-one-word trap, and it is more
  load-bearing now that the published name is importable, not less.
- fb336df: Move `lucide-react` from `^1.31.0` to `^1.43.0` in every package that declares it, and
  repair what the jump breaks, so icons resolved from a STRING keep drawing a glyph.
  
  Measured once against the installed 1.43.0 artifact when this change was made; nothing in
  the repository re-derives these readings. Across the jump lucide removes no runtime export,
  no public type name and no `lucide-react/dynamic.mjs` name, and every name this repository
  imports from `lucide-react` resolves. Exactly one key leaves the runtime `icons` record:
  `Trash2`, retired in favour of `trash`.
  
  What a user sees change:
  
  - Icons the lazy icon seam draws (`resolveIcon`, objectui#9251) get their path data again.
    lucide 1.43.0 icon modules export their path data inside `__iconData` and no longer
    export `__iconNode`; the seam now reads both. Reading only `__iconNode` against 1.43.0
    leaves every such glyph an empty box, with nothing thrown or logged.
  - `DetailView`'s delete action and three schema-catalog examples spell their icon
    `trash`, not `trash-2`, so they keep resolving. The glyph is unchanged: 1.43.0's `trash`
    path data is byte-identical to the `trash-2` path data of 1.31.0 and 1.35.0. Anything
    that already authored `trash` now draws that same artwork, because lucide moved it under
    the `trash` name; a few other glyphs were also redrawn upstream.
  - Icons imported as COMPONENTS carry lucide 1.43.0's own classes: one class per declared
    alias (a spinner renders `class="lucide lucide-loader-circle lucide-loader-2 ..."`), and
    no longer the class lucide used to derive from the PascalCase key where that differs
    (`ArrowDown01` no longer carries `lucide-arrow-down01`). The canonical
    `lucide-<icon name>` class is still there, so a `.lucide-loader-circle` selector still
    matches.
  - Icons resolved from a STRING through the seam keep the classes they had: `lucide`, the
    canonical `lucide-<icon name>` class and the key-derived class. They do not carry
    lucide's per-alias classes. That is a maintainer ruling (objectui#8941, option C): the
    alias list lives only inside each lazily loaded icon module, and it was not moved into
    the eager name list. A selector that targets an alias class matches a component-imported
    icon and not a string-resolved one. This also dates the example in the objectui#9251
    entry: `trash-2` no longer resolves as a string, so no seam-drawn glyph carries
    `lucide-trash2 lucide-trash-2`; a digit-bearing name that still resolves, such as
    `arrow-down-0-1`, carries `lucide-arrow-down01 lucide-arrow-down-0-1`.
- Updated dependencies [cd2cb41]
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [28b0658]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [588380d]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [b06c3de]
- Updated dependencies [0d379f5]
- Updated dependencies [4c6f549]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [879ecac]
- Updated dependencies [c2dabf0]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [fa5fbd9]
- Updated dependencies [5f44cc6]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [fd6f5da]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [961ceaa]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [1dbb993]
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
- Updated dependencies [cc4366d]
- Updated dependencies [0961d5e]
- Updated dependencies [6276478]
- Updated dependencies [5e67837]
- Updated dependencies [ff14e29]
- Updated dependencies [9b28151]
- Updated dependencies [64563a9]
- Updated dependencies [1a5003f]
- Updated dependencies [09ab32b]
- Updated dependencies [8acc51b]
- Updated dependencies [ea9d17f]
- Updated dependencies [45362a3]
- Updated dependencies [2a943bf]
- Updated dependencies [d999617]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [9cbe4db]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
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
- Updated dependencies [8848ce4]
- Updated dependencies [f905090]
- Updated dependencies [9c78ebe]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [93a5585]
- Updated dependencies [5ad3b88]
- Updated dependencies [21eb61a]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [184cfe1]
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
- Updated dependencies [285e36b]
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
- Updated dependencies [37140f4]
- Updated dependencies [1c84036]
- Updated dependencies [1c84036]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [9e6619f]
- Updated dependencies [f6ae5e2]
- Updated dependencies [eb97ce6]
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
- Updated dependencies [244d516]
- Updated dependencies [deca847]
- Updated dependencies [ac15833]
- Updated dependencies [ac15833]
- Updated dependencies [e2dffc9]
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
- Updated dependencies [27ae632]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [e327c89]
- Updated dependencies [2eaf5be]
- Updated dependencies [bf7ab35]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [63ab761]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [62d6f56]
- Updated dependencies [51c2949]
- Updated dependencies [a4b017e]
- Updated dependencies [8732846]
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
- Updated dependencies [54997ff]
- Updated dependencies [81f8498]
- Updated dependencies [a782fa7]
- Updated dependencies [1d6a23d]
- Updated dependencies [0645133]
- Updated dependencies [76e9df0]
- Updated dependencies [0ecaa7d]
- Updated dependencies [b24f93a]
- Updated dependencies [6158e4c]
- Updated dependencies [cff8641]
- Updated dependencies [3f61eef]
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
- Updated dependencies [f4ed238]
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
- Updated dependencies [9419df1]
- Updated dependencies [8bab157]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [18d1a0a]
- Updated dependencies [e420df3]
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
- Updated dependencies [d0fba91]
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
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [50c73fe]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [f560ded]
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
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [b34cc14]
- Updated dependencies [ab18797]
- Updated dependencies [d0097af]
- Updated dependencies [432882b]
- Updated dependencies [64dae8e]
- Updated dependencies [b06e374]
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
- Updated dependencies [594704f]
- Updated dependencies [d3995fe]
- Updated dependencies [1b1d772]
- Updated dependencies [d88e20f]
- Updated dependencies [f66072d]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [4172589]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [053fdc8]
- Updated dependencies [41b7ce3]
- Updated dependencies [ae476b8]
- Updated dependencies [39f4309]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [7cd3987]
- Updated dependencies [ee3b878]
- Updated dependencies [e304a4e]
- Updated dependencies [fda49e5]
- Updated dependencies [490d9a9]
- Updated dependencies [1117414]
- Updated dependencies [6d63cd0]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [7c96c94]
- Updated dependencies [4da5109]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [95f8704]
- Updated dependencies [f8cdbf2]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [e176053]
- Updated dependencies [e30ed15]
- Updated dependencies [90665e0]
- Updated dependencies [8d3a529]
- Updated dependencies [5ac2e2c]
- Updated dependencies [194fae1]
- Updated dependencies [63d54dd]
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
- Updated dependencies [1e946c9]
- Updated dependencies [546ddf7]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [44d075b]
- Updated dependencies [40c479a]
- Updated dependencies [b4393e5]
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
- Updated dependencies [5fa06c4]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [129bcc5]
- Updated dependencies [d3005f7]
- Updated dependencies [1e7fe0a]
- Updated dependencies [a26b9e4]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [06b82b8]
- Updated dependencies [8ec11e1]
- Updated dependencies [6f81384]
- Updated dependencies [22ba927]
- Updated dependencies [f8c70f4]
- Updated dependencies [5d3a2d1]
- Updated dependencies [8f1d995]
- Updated dependencies [b362c1b]
- Updated dependencies [f9c34df]
- Updated dependencies [dddb942]
- Updated dependencies [00c665e]
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
- Updated dependencies [9602dc8]
- Updated dependencies [3777538]
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
- Updated dependencies [fff9645]
- Updated dependencies [9c3b7ce]
- Updated dependencies [2c1c967]
- Updated dependencies [9486ac6]
- Updated dependencies [9486ac6]
- Updated dependencies [4d5f9b4]
- Updated dependencies [d6ceb8d]
- Updated dependencies [dc4365c]
- Updated dependencies [e321d52]
- Updated dependencies [969ba84]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [45ac2cb]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [26896c6]
- Updated dependencies [a439e16]
- Updated dependencies [67fc3b0]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [9409eb9]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [bd0376d]
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
- Updated dependencies [c4326fe]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
- Updated dependencies [eeb6c2f]
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
- Updated dependencies [639114c]
- Updated dependencies [1490691]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
- Updated dependencies [854cba3]
- Updated dependencies [78ca238]
- Updated dependencies [d8ec8d6]
- Updated dependencies [351eb31]
- Updated dependencies [866cd1d]
- Updated dependencies [20c04b2]
- Updated dependencies [01c9023]
- Updated dependencies [48c19bd]
- Updated dependencies [a6d8b8d]
- Updated dependencies [4b5bb95]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [adbda1b]
- Updated dependencies [8952395]
- Updated dependencies [e2b3826]
- Updated dependencies [a338037]
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [6411def]
- Updated dependencies [db3896c]
- Updated dependencies [b9f5ff1]
- Updated dependencies [e75f4c9]
- Updated dependencies [19f1639]
- Updated dependencies [4704aa4]
- Updated dependencies [47547d0]
- Updated dependencies [1bee5d0]
- Updated dependencies [63a8828]
- Updated dependencies [b61d7d8]
- Updated dependencies [858cd72]
- Updated dependencies [cfc9b6d]
- Updated dependencies [dc0a60b]
- Updated dependencies [554f2b6]
- Updated dependencies [72f55c9]
- Updated dependencies [26e06d7]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [3399704]
- Updated dependencies [02fe257]
- Updated dependencies [71a4a53]
- Updated dependencies [7bf244b]
- Updated dependencies [f0bb9fa]
- Updated dependencies [81a2eb1]
- Updated dependencies [caa0cd3]
- Updated dependencies [caa0cd3]
- Updated dependencies [20cb8db]
- Updated dependencies [25c7d58]
- Updated dependencies [00d2fa6]
- Updated dependencies [77b2a18]
- Updated dependencies [c6198c2]
- Updated dependencies [721d1e0]
- Updated dependencies [c2f0f48]
- Updated dependencies [1237ae4]
- Updated dependencies [2f61238]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [9ae871d]
- Updated dependencies [efbd566]
- Updated dependencies [2a5bf45]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [daf9d57]
- Updated dependencies [fe8f451]
- Updated dependencies [23b9958]
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
- Updated dependencies [c907a9c]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [91f9276]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [a915064]
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
- Updated dependencies [e1c27e4]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [592402e]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [37149ec]
- Updated dependencies [496d31d]
- Updated dependencies [0ea7054]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [a695f50]
- Updated dependencies [fc32921]
- Updated dependencies [4eaa835]
- Updated dependencies [8f9d87a]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [6e9a3d4]
- Updated dependencies [4a292d2]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [846cec0]
- Updated dependencies [91facae]
- Updated dependencies [b38014e]
- Updated dependencies [e2feb13]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [9dcc545]
- Updated dependencies [d7fecfb]
- Updated dependencies [c13d39e]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [e6ec217]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [7cf6f38]
- Updated dependencies [fd9c50a]
- Updated dependencies [421544b]
- Updated dependencies [5cc8c28]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [40a7c53]
- Updated dependencies [abc1b18]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [c300267]
- Updated dependencies [fb3a101]
- Updated dependencies [d4733f2]
- Updated dependencies [7c9145f]
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
- Updated dependencies [cc00c59]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [ab77513]
- Updated dependencies [55ba3ff]
- Updated dependencies [0b138da]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [6df26f0]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [e36acd4]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [16a1a51]
- Updated dependencies [63601ab]
- Updated dependencies [c372b29]
- Updated dependencies [152f0a7]
- Updated dependencies [8693b85]
- Updated dependencies [e82dad1]
- Updated dependencies [58b7b3d]
- Updated dependencies [e77a003]
- Updated dependencies [84defab]
- Updated dependencies [681d3f1]
- Updated dependencies [969d4f2]
- Updated dependencies [88561fd]
- Updated dependencies [f3bc481]
- Updated dependencies [b79aac2]
- Updated dependencies [93fc0e7]
- Updated dependencies [0601af1]
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
- Updated dependencies [9f5c017]
- Updated dependencies [c271413]
- Updated dependencies [279e48e]
- Updated dependencies [4784bb3]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [689953a]
- Updated dependencies [30443fb]
- Updated dependencies [8d3dbb2]
- Updated dependencies [efc1c9c]
- Updated dependencies [7d6439c]
- Updated dependencies [da45e6b]
- Updated dependencies [7533465]
- Updated dependencies [835f0f3]
- Updated dependencies [6d5db7b]
- Updated dependencies [a9d97be]
- Updated dependencies [ed35b44]
- Updated dependencies [e6040ef]
- Updated dependencies [9ba7e9c]
- Updated dependencies [729e851]
- Updated dependencies [96919a4]
- Updated dependencies [345e24a]
- Updated dependencies [3bc1bb4]
- Updated dependencies [20b507a]
- Updated dependencies [2e471dc]
- Updated dependencies [6748587]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [2bf34f7]
- Updated dependencies [15b33ae]
- Updated dependencies [7cbc724]
- Updated dependencies [4a94c38]
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
- Updated dependencies [502eb58]
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [697aabc]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [80a0ecd]
- Updated dependencies [43c0d17]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [462bafb]
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
- Updated dependencies [44152c4]
- Updated dependencies [3939545]
- Updated dependencies [66abbde]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [7649f43]
- Updated dependencies [d0f52e4]
- Updated dependencies [e708426]
- Updated dependencies [33e1697]
- Updated dependencies [3b6d53b]
- Updated dependencies [a017617]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [dc49246]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [905913c]
- Updated dependencies [9a97800]
- Updated dependencies [6358a2d]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
- Updated dependencies [d06fba8]
- Updated dependencies [60500cb]
- Updated dependencies [2fcefb9]
- Updated dependencies [77f846a]
- Updated dependencies [bc5870c]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [f760064]
- Updated dependencies [dd19463]
- Updated dependencies [6791717]
- Updated dependencies [8ea3bee]
- Updated dependencies [100547e]
- Updated dependencies [3a58149]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [bf3edfe]
- Updated dependencies [2c8474c]
- Updated dependencies [6ce89da]
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
- Updated dependencies [c40f3b8]
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
- Updated dependencies [6a576c9]
- Updated dependencies [0b12a33]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
- Updated dependencies [6c1b105]
- Updated dependencies [4dc80d0]
- Updated dependencies [9d9040d]
- Updated dependencies [20e317c]
- Updated dependencies [0fce2ef]
- Updated dependencies [42df928]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [9850c6e]
- Updated dependencies [de570cc]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [19cbf10]
- Updated dependencies [7e50e84]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [2a79e84]
- Updated dependencies [2609812]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [17fbbaf]
- Updated dependencies [d8cf1cb]
- Updated dependencies [0d1e702]
- Updated dependencies [b03ba3a]
- Updated dependencies [0068348]
- Updated dependencies [641543f]
- Updated dependencies [8a44390]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
- Updated dependencies [23705b7]
- Updated dependencies [93127bd]
- Updated dependencies [f2158ec]
- Updated dependencies [759606e]
- Updated dependencies [fd8dace]
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
- Updated dependencies [38a9568]
- Updated dependencies [f90b8fb]
- Updated dependencies [91783c4]
- Updated dependencies [982885d]
- Updated dependencies [dba7d84]
- Updated dependencies [ca39427]
- Updated dependencies [bd09957]
- Updated dependencies [5a07e67]
- Updated dependencies [2d36552]
- Updated dependencies [45d8288]
- Updated dependencies [b2437a7]
- Updated dependencies [f157423]
- Updated dependencies [7a90afd]
- Updated dependencies [eddc1dd]
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
- Updated dependencies [fb96ecb]
- Updated dependencies [1170ed1]
- Updated dependencies [92814db]
- Updated dependencies [4d73b07]
  - @object-ui/plugin-detail@17.7.0
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/permissions@17.7.0

## 17.6.0

### Patch Changes

- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
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
- Updated dependencies [ef0d150]
- Updated dependencies [f34226e]
- Updated dependencies [564b605]
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
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [9f23d2b]
- Updated dependencies [578e025]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
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
- Updated dependencies [ad13d63]
- Updated dependencies [5ffcc14]
- Updated dependencies [d971e51]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [9c60144]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [75444e3]
- Updated dependencies [58b8346]
- Updated dependencies [2d0bd16]
- Updated dependencies [a9e17b4]
- Updated dependencies [b8ce7dc]
- Updated dependencies [dad51e5]
- Updated dependencies [1c9c342]
- Updated dependencies [787c738]
- Updated dependencies [8396656]
- Updated dependencies [dbbd38a]
- Updated dependencies [8871c14]
- Updated dependencies [93fe362]
- Updated dependencies [dfc6975]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [144ef9b]
- Updated dependencies [138ab04]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
- Updated dependencies [21e4585]
  - @object-ui/types@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Patch Changes

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
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
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [5cc847c]
- Updated dependencies [fa21254]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [bfdf3d4]
- Updated dependencies [bb68488]
- Updated dependencies [c0f9a4b]
- Updated dependencies [b1e42d0]
- Updated dependencies [2459a3e]
- Updated dependencies [ac853ce]
- Updated dependencies [fa51109]
- Updated dependencies [d6aa172]
- Updated dependencies [fe52a04]
- Updated dependencies [d46f9b8]
- Updated dependencies [3f5f87c]
- Updated dependencies [2fea4d2]
- Updated dependencies [f5e1143]
- Updated dependencies [7f1cb33]
- Updated dependencies [f148a64]
- Updated dependencies [bb68488]
- Updated dependencies [2e3b0c0]
- Updated dependencies [9461dd3]
- Updated dependencies [78fa331]
- Updated dependencies [47f551b]
- Updated dependencies [31ab1ac]
- Updated dependencies [0082db8]
- Updated dependencies [ab04728]
- Updated dependencies [5bf09fd]
- Updated dependencies [06915b0]
- Updated dependencies [ff84b05]
  - @object-ui/i18n@17.5.0
  - @object-ui/react@17.5.0
  - @object-ui/components@17.5.0
  - @object-ui/core@17.5.0
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [7864f03]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [ecae400]
- Updated dependencies [4bc6c23]
- Updated dependencies [d3e738a]
- Updated dependencies [c3b01a7]
- Updated dependencies [f5f8744]
- Updated dependencies [7ed3360]
- Updated dependencies [69becd2]
- Updated dependencies [5e52495]
- Updated dependencies [0fa5e4d]
- Updated dependencies [b750823]
- Updated dependencies [5bfaabd]
- Updated dependencies [e06810e]
- Updated dependencies [ab3ad4f]
- Updated dependencies [c2fd122]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [6bb454a]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- aa36e60: Localize the record-detail headings that `ObjectKanban`, `ObjectTree` and
  `ObjectView` build themselves (objectui#3459)

  #3426 / PR #3457 keyed `ListView` and `ObjectGrid`; a repo-wide grep found the
  same pattern in three more hosts, each string-building an English heading in
  TypeScript so the surrounding drawer/panel was fully localized with one English
  phrase on top of it.

  - `packages/plugin-kanban/src/ObjectKanban.tsx` — the object-derived heading of
    the card-detail drawer
  - `packages/plugin-tree/src/ObjectTree.tsx` — the bare literal
    `"Record Details"` handed to `NavigationOverlay`
  - `packages/plugin-view/src/ObjectView.tsx` — `` `${objectLabel} Detail` `` on
    the `mode: 'split'` panel

  All three are user-reachable, each verified by a test that drives the real
  interaction (render the block, click a card/row, read the heading), not by
  inspection:

  - `object-kanban` is a public page block whose `navigation` config DEFAULTS to
    `{ mode: 'drawer' }`, so a board needs no authoring at all to open this
    drawer on card click;
  - `object-tree` needs `navigation: { mode: 'drawer' }` authored explicitly, and
    every row's click is wired to `navigation.handleClick`;
  - `object-view` declares `navigation` as an authorable input and maps
    `mode: 'split'` onto the branch that renders this heading.

  ## What changed

  Each call site now keys its heading through the existing `detail.*` pair —
  `detail.recordDetailWithLabel` (`'{{label}} Detail'`) where an object label is
  available, `detail.recordDetail` where none is. No new locale keys: both
  already ship in all ten packs from #3457, and reusing them keeps one heading on
  one control instead of minting per-plugin twins that drift.

  Each plugin gains its own English defaults map, which is what
  `createSafeTranslation` falls back to with no `I18nProvider` mounted;
  `@object-ui/plugin-tree` gains a dependency on `@object-ui/i18n` for it.

  ## Visible English change

  One, deliberate: the tree overlay's heading goes from the plural
  `Record Details` to the singular `Record Detail` — the spelling the whole
  `detail.*` family, including `NavigationOverlay`'s own default, already uses.
  The maintainer ruled on normalizing the stray plurals rather than minting a
  plural key; a repo-wide grep confirmed no `e2e/` spec and no unit test
  addressed the old string.

  Every other branch is byte-identical in English (`Contacts Detail`,
  `Support cases Detail`, `Contacts Detail`), with and without a provider —
  pinned by a provider-less test file per plugin, kept separate because
  `initReactI18next` registers its instance as a module global that outlives
  `cleanup()`.

  The kanban's other former plural (`'Card Details'`) is NOT a visible change: it
  sat on a branch that fires only when the board has no `objectName`, while the
  drawer consuming it returns `null` on that very condition. It is keyed anyway
  so the literal cannot leak if that guard ever relaxes, and it deliberately has
  no test — an assertion there would pass because nothing renders.

- Updated dependencies [18cd432]
- Updated dependencies [532cf8b]
- Updated dependencies [680080a]
- Updated dependencies [a7651e6]
- Updated dependencies [d915c47]
- Updated dependencies [b71fc92]
- Updated dependencies [65516ba]
- Updated dependencies [94c5b7c]
- Updated dependencies [ca0fa8f]
- Updated dependencies [34595eb]
- Updated dependencies [3889ffb]
- Updated dependencies [5781fb1]
- Updated dependencies [7e2406a]
- Updated dependencies [9e9e9a9]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [5c856ec]
- Updated dependencies [23018cc]
- Updated dependencies [53811d1]
- Updated dependencies [68b6a28]
- Updated dependencies [0554e88]
- Updated dependencies [d915c47]
- Updated dependencies [f44d872]
- Updated dependencies [28b2e65]
- Updated dependencies [509104a]
- Updated dependencies [825bbe3]
- Updated dependencies [6195841]
- Updated dependencies [5dd0127]
- Updated dependencies [06632e9]
- Updated dependencies [a415684]
- Updated dependencies [a4cff5b]
- Updated dependencies [175bd79]
- Updated dependencies [5af2852]
- Updated dependencies [f833d3a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/i18n@17.3.0
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

- 95b7214: fix(list,grid,detail,tree,core): every column resolver reads one key (#3104 PR2)

  PR1 (#3119) put a canonicalizing fold at ListView's ingestion boundary. This
  converges the 22 read sites themselves onto `columnIdentity()` from
  `@object-ui/core`, so a surface that is NOT downstream of that fold resolves
  the same identity anyway.

  That distinction is the user-visible part. A standalone `object-grid` node —
  authored directly on a page, with no `list-view` above it — never passed
  through `normalizeListViewSchema`. Its `getSelectFields` read `c.field` alone
  while the `ensureId` probe one line above read `f?.name || f?.field`, so a
  legacy `{ name: 'account' }` column reached `$select` as a literal `undefined`
  hole: the server never returned the field and every cell in that column came
  back empty. Same for `ObjectTree`, `RelatedList` and the `record:details` /
  `record:related_list` renderers.

  Converged:

  | Surface                                  | Was                                            | Now                                 |
  | ---------------------------------------- | ---------------------------------------------- | ----------------------------------- |
  | `ListView` ×9 + its 2 request builders   | `name \|\| fieldName \|\| field` vs `f?.field` | `columnIdentity()`                  |
  | `RelatedList` ×8                         | `accessorKey \|\| field \|\| name`             | `accessorKey \|\| columnIdentity()` |
  | `ObjectGrid`                             | name-first probe vs `c.field` projection       | `columnIdentity()`                  |
  | `ObjectTree`                             | `name \|\| fieldName \|\| field \|\| key`      | `columnIdentity() \|\| key`         |
  | `buildExpandFields`                      | `field ?? name ?? fieldName`                   | `columnIdentity()`                  |
  | `record-details` / `record-related-list` | `field \|\| name (\|\| key)`                   | `columnIdentity() (\|\| key)`       |

  `accessorKey` keeps its precedence in `RelatedList` — it is TanStack Table's
  column key, not ObjectStack metadata identity, and only the `field || name`
  tail was converged. `key` stays a tail fallback in `ObjectTree` and
  `record-related-list` for the same reason: it is a generic entry key.

  Two incidental fixes that TypeScript surfaced once the resolver stopped
  returning `any`: ListView's filter-field options and its hide-fields popover
  both built entries keyed `undefined` for a column with no resolvable identity.
  Those entries could never match a column; they are now dropped.

  **Inventory re-triage.** PR1 recorded 24 family members. Two were mis-classified
  and are reclassified here rather than converged — reading what they actually
  feed shows they are not column reads at all:

  - `ViewPreview.tsx` adapts a ViewItem **form** section to what `object-form`
    selects by (`field` → `name`) — the #3090 two-layer join.
  - `SchemaForm.tsx` renders an arbitrary metadata **array** into a popover
    summary and guesses at a display key; the entries are validations, actions,
    or whatever the JSON schema declares.

  So the family was 22, and it is now **0**. The ratchet asserts that, asserts
  each converged surface actually routes through the shared reader (a surface
  that dropped identity resolution instead of converging it goes red), and pins
  `accessorKey`'s precedence in `RelatedList`.

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

- 5971cc4: i18n: translate the Profile page, honor inline i18n label objects under bare
  base-language codes, and localize managed-by badges / record quick actions.

  - `pickLocalized` now upgrades a bare base language (`zh`) to any
    region-qualified key sharing the base (`zh-CN`) — runtime language is
    normalized to the base code while metadata authors write full BCP-47 tags,
    so inline `{ en, 'zh-CN', ... }` label objects previously fell back to
    English.
  - ProfilePage (`account:profile_card` / `/system/profile`): every hardcoded
    string — page title/subtitle, avatar Upload/Replace/Remove, Personal
    Information card, Change/Set Password card — now goes through
    `useObjectTranslation()` with `profile.*` keys (new namespace in all ten
    locale bundles); the lazy-load fallback reuses `common.loading`.
  - `ManagedByBadge` chips/tooltips (Config/System/Append-only/Identity) now
    resolve through new `managedByBadge.*` keys with `{{provider}}`
    interpolation.
  - `record:quick_actions` resolves action labels via the
    `objects.{object}._actions.{action}.label` convention plus `pickLocalized`,
    so object action buttons (Change Password, Enable 2FA, …) localize.
  - `record:details` / `record:related_list` / `record:alert` / `ObjectTree`
    pass inline label objects through `pickLocalized`.
  - Locale bundles: added `managedByBadge` namespace to all ten locales and
    backfilled `list.inlineEditShort` / `inlineEditLabel` /
    `recordEditingTitle` for ja/es/ko/de/fr/pt/ru/ar.

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

### Minor Changes

- 4eb9cb6: feat(plugin-tree): add a `tree` / tree-grid object view type

  Renders a self-referencing object as an indented, expand/collapse tree-grid —
  the right view for arbitrary-depth hierarchies (business unit / org chart,
  category trees, BOMs, nested comments) that fixed-depth grouping can't express.
  New `@object-ui/plugin-tree` package (`object-tree`/`tree`), `tree` added to the
  `ViewType` union, and dispatch wired through plugin-list `ListView` +
  app-shell `ObjectView` (the console path).

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
