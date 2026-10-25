# @object-ui/plugin-report

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [8701f1e]
- Updated dependencies [5235d6d]
- Updated dependencies [8e649da]
- Updated dependencies [7c405b7]
- Updated dependencies [0093b2c]
- Updated dependencies [813c3d9]
- Updated dependencies [3aafc0d]
- Updated dependencies [601c406]
- Updated dependencies [b911ebb]
- Updated dependencies [ff77cfc]
- Updated dependencies [49a536d]
- Updated dependencies [241cb78]
- Updated dependencies [404ccae]
- Updated dependencies [ec627ab]
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
  - @object-ui/react@18.1.0
  - @object-ui/core@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Patch Changes

- 2312bd9: A page that declares `print` now prints as a document, and a record page bound to such a page offers a Print action (objectui#11958, the objectui half of the print-page ruling on objectstack#8346, M1, zero server).
  
  - **The print stylesheet.** `PageRenderer` mounts a stylesheet built from the page's `print` declaration, only for a page that declares it. Every rule sits inside `@media print`, so the page on screen is drawn as before. `paperSize` and `orientation` set `@page { size }` (A4 and portrait when omitted). `margins` set one `@page` margin per declared side, in millimetres. `pageNumbers` prints "page / pages" in the bottom-right margin. `repeatHeader` and `repeatFooter` repeat the page's own `header` and `footer` regions on every sheet. `repeatTableHeaders` (on when omitted) repeats a table's column headings on every sheet it runs onto. `avoidBreakInside` keeps each block of a region whole on one sheet when it fits. Only the print page reaches paper: the console chrome and the record view's own panels around the page are hidden, and the page runs onto as many sheets as it needs.
  - **The printable blocks print whole.** On a print page, `record:line_items` no longer cuts lines off at its row cap in silence: when the child object has more lines than the cap (500 unless `limit` is set), the panel draws the cap's lines and the shared row-ceiling note under them, naming both numbers when the server reports a total. A collapsible `record:details` section draws open, because a closed section never reaches paper. Off a print page both blocks behave as before.
  - **The record page's Print action.** When the record page bound to a record declares `print`, the record view shows a Print button that opens the browser's print preview of that page.
  - **New exports from `@object-ui/react`:** `PrintPageProvider`, `usePrintPage` and `PrintPageContext`. `usePrintPage()` returns the enclosing page's `print` declaration, or `null` outside a print page.
  - The source comments that described PDF export as declined now say where a printable document lives: a page that declares `print`.
- e5c8ea7: fix(plugin-report): a report lays out a select dimension in the field's declared option order (objectui#12243)
  
  A dataset-bound report used to show its groups in the order the dataset returned them, which is the
  stored values' alphabetical order. A stage dimension read Closed Won, Needs Analysis, Negotiation,
  Proposal, Prospecting, Qualification, and a bar chart beside the table drew the same order.
  
  When the report declares no `order`, the table rows, a matrix's row and column headers and the
  embedded chart's categories now follow each select dimension's declared option order, the reading
  grid groups and dashboard charts already use (objectui#11809):
  
  - the declared options come first, in their order;
  - a value the options do not declare comes next, in the order the dataset returned it;
  - the empty bucket comes last.
  
  With two grouping dimensions, the outer one is laid out first and the inner one within each outer
  group. A dimension whose field declares no options (a lookup, a text field, a date) keeps the order
  the dataset returned it in.
  
  A report that declares its own `order` keeps the server's order unchanged. A drill on a row still
  opens that row's records.
- 2b06a91: A report the viewer may not read shows the no-access state, not the server's refusal (objectui#12330).
  
  When the dataset query behind a report was refused because the viewer may not read its object (403 `PERMISSION_DENIED`), the report page drew a red error box with the adapter's message: "Analytics query refused: … (server said: [Analytics] Access denied: reading "…" is not permitted for this user.)". That text quotes the server and names the object. A dashboard widget refused the same way already showed a localized "You don't have access" state.
  
  - **The refusal is classified once, in the report's dataset read**, by the shared `classifyLoadError` from `@object-ui/react`, the branch `DatasetWidget` takes for the same refusal. It judges the refusal by status and code, as `DatasetWidget` does; this renderer never matches the adapter's refusal text.
  - **A refused report shows "You don't have access"** (the widget's title, `dashboard.widgetForbiddenTitle`) and "You don't have permission to view the data behind this report." (the new `report.forbiddenMessage`, in all ten language packs). The table, the summary and the cross-tab show it, and so does each joined block. No server text and no object name is drawn.
  - **A report with a chart shows it once.** The chart already hides itself when its own query fails, and the table beside it shows the state.
  - **Any other failure keeps its error box and message**, so a real error (a 500, a rejected query) is not hidden behind "no access".
  
  **Clause-②: yes (widening)**: one locale key, `report.forbiddenMessage`, added to `@object-ui/i18n`'s published packs, which widens `TranslationKeys`. No export, prop or schema key is added, and nothing is renamed or removed.
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
- Updated dependencies [e8c0b96]
- Updated dependencies [b92329c]
- Updated dependencies [2e818d0]
- Updated dependencies [fd060f0]
- Updated dependencies [fd060f0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
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
- Updated dependencies [834c559]
- Updated dependencies [22b503c]
- Updated dependencies [9fc68aa]
- Updated dependencies [d50f724]
- Updated dependencies [17acfbb]
- Updated dependencies [6be0f7a]
- Updated dependencies [db4cb6b]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [ded4494]
- Updated dependencies [d172f63]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [3bf8894]
- Updated dependencies [e06365c]
- Updated dependencies [3035948]
- Updated dependencies [1e1f09e]
- Updated dependencies [455c646]
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
- Updated dependencies [e723f58]
- Updated dependencies [82bb1d5]
- Updated dependencies [f3d5408]
- Updated dependencies [b231607]
- Updated dependencies [b231607]
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
- Updated dependencies [923504f]
- Updated dependencies [5b45c0d]
- Updated dependencies [923504f]
- Updated dependencies [5c2982a]
- Updated dependencies [97e7d4e]
- Updated dependencies [5d3f437]
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
- Updated dependencies [d9d9d98]
- Updated dependencies [c950345]
- Updated dependencies [21f9577]
- Updated dependencies [044f231]
- Updated dependencies [f8267df]
- Updated dependencies [023087f]
- Updated dependencies [9b82ced]
- Updated dependencies [3821a3a]
- Updated dependencies [3eb3ec1]
- Updated dependencies [92c2a69]
- Updated dependencies [518a8e3]
- Updated dependencies [646caea]
- Updated dependencies [1ffd6a2]
- Updated dependencies [5f8ecf6]
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
- Updated dependencies [a8add5c]
- Updated dependencies [33ee9de]
- Updated dependencies [4839f5c]
- Updated dependencies [a23e804]
- Updated dependencies [c7462e7]
- Updated dependencies [36e2f7b]
- Updated dependencies [ac59073]
- Updated dependencies [44cb469]
- Updated dependencies [e058d76]
- Updated dependencies [c999d4c]
- Updated dependencies [8df2608]
- Updated dependencies [5483297]
- Updated dependencies [ed43c79]
- Updated dependencies [260ef71]
- Updated dependencies [655e897]
- Updated dependencies [655e897]
- Updated dependencies [020d178]
- Updated dependencies [8d80845]
- Updated dependencies [69a408f]
- Updated dependencies [d2b21a1]
- Updated dependencies [5ff64ef]
- Updated dependencies [64acb7e]
- Updated dependencies [4ff5b6b]
- Updated dependencies [473e5a0]
- Updated dependencies [b279016]
- Updated dependencies [bb6c38c]
- Updated dependencies [26323c4]
- Updated dependencies [9753811]
- Updated dependencies [2727527]
- Updated dependencies [3da39ae]
- Updated dependencies [bc281f4]
- Updated dependencies [d637be3]
- Updated dependencies [2cfdc99]
- Updated dependencies [2cfdc99]
- Updated dependencies [8523e81]
- Updated dependencies [1e6d83b]
- Updated dependencies [1e6d83b]
- Updated dependencies [32b492b]
- Updated dependencies [6058bf8]
- Updated dependencies [c219165]
- Updated dependencies [a7ae252]
- Updated dependencies [fb501bc]
- Updated dependencies [30083da]
- Updated dependencies [7f9cc37]
- Updated dependencies [b7fe09e]
- Updated dependencies [025130c]
- Updated dependencies [76f91f8]
- Updated dependencies [ea34d9b]
- Updated dependencies [8aa8e3e]
- Updated dependencies [024b7b6]
- Updated dependencies [cb80001]
- Updated dependencies [909c64e]
- Updated dependencies [9e7e1a5]
- Updated dependencies [2493e85]
- Updated dependencies [d0b9648]
- Updated dependencies [46dbf32]
- Updated dependencies [a928aaa]
- Updated dependencies [47508f3]
- Updated dependencies [61ed5ad]
- Updated dependencies [1b94d50]
- Updated dependencies [6f877f1]
- Updated dependencies [988aa9f]
- Updated dependencies [1ce0711]
- Updated dependencies [fb85637]
- Updated dependencies [9f1dd79]
- Updated dependencies [df71568]
- Updated dependencies [d11174a]
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
  - @object-ui/fields@18.0.0

## 17.7.0

### Minor Changes

- f7af637: Report display sites follow the display locale instead of the literal tag `en-US`
  (objectui#10020).
  
  Five display paths in this package handed `Intl` the literal BCP-47 tag `en-US` —
  four branches of `formatValue` (`currency` / `currency_cny`, `currency_usd`,
  `percent`, and the default thousand-separated branch) and the Excel cell formatter
  behind `exportExcelWithFormulas`. That is the exact tag `useDisplayLocale`'s contract
  in `@object-ui/i18n` names as the wrong answer, in as many words: *"Note this is
  `'en'`, not `'en-US'`: the point of objectui#4033 is that `en-US` is not the world's
  default."* A tenant that had configured `de-DE`, or a user reading the console in
  Chinese, saw US grouping and decimal marks regardless — while the same package already
  resolved that channel three times in `DatasetReportRenderer`.
  
  **Additive, not breaking.** `formatValue` is a published export, so its new display
  locale is an OPTIONAL third parameter and `exportExcelWithFormulas` takes an optional
  `locale` on the options bag it already had. Every call that compiled before compiles
  after, and omitting the argument formats in `'en'` — the display channel's own last
  resort, which is neither `en-US` nor an absent tag.
  
  **What that means for callers.** An optional parameter nobody passes would be the same
  defect with a longer signature, so `ReportViewer` now resolves `useDisplayLocale()`
  itself and threads it at all three of its call sites. If you call `formatValue` or
  `exportExcelWithFormulas` from your own code, pass the locale you render in —
  `useDisplayLocale()` in React, and for a non-React caller the tag your session
  resolved. `exportExcelWithFormulas` cannot read the channel itself: it is not a
  component, and a display locale is a property of the session rather than of the
  authored report schema, so its caller is the only place the tag can come from.
  
  Threading a tag also introduces a hazard a literal never had — a tenant-configured tag
  can be malformed (`en_US`, underscore instead of hyphen, makes `Intl` throw
  `RangeError`), and these calls sit inside a cell render. A malformed tag now degrades
  to the same last resort rather than taking the report down. It deliberately does NOT
  degrade to a dropped tag, which would mean the machine's locale — the separate defect
  shape tracked on objectui#9909, still present in this package's HTML export header and
  deliberately not merged into this change.
- 9d9ed54: refactor(plugin-report)!: retire the `spec-report` node type key; a spec report is embedded as `{ "type": "report", "report": { … } }` (objectui#11440)
  
  **BREAKING (authoring):** the plugin no longer registers `spec-report` (and with it `plugin-report:spec-report`), an alias of `report` on the same `ReportRenderer` that carried the report under a `report` member. `ReportRenderer` now unwraps that member on a `report` node, and only there: `report` is the one spelling, with no alias fallback. `objectui validate` refused a `spec-report` node at `type`, and so did the strict authoring face. A node authored `type: "spec-report"` now renders the "Unknown component type" panel.
  
  The `report` registration publishes `report` as an input, so the `sdui-parser` manifest and the designer offer it. `@object-ui/types/zod`'s `ReportNodeSchema` declares the same member (`.changeset/11440-report-node-wrapper.md`). The README and `content/docs/plugins/plugin-report.mdx` teach the `report` spelling and list two registered types, `report` and `report-viewer`.
  
  Migration:
  
  - `{ "type": "spec-report", "report": { … } }` → `{ "type": "report", "report": { … } }`, with the same `report` member. Measured with a dataset-bound report (`name`, `label`, `type: "summary"`, `dataset`, `rows`, `values`): the FROM document is refused with `invalid_union` at `type` by `objectui validate` and by the strict face; the TO document validates on both.
  - A pre-9.0 stored report (the `objectName` / `columns` query form) under `report` still renders through the presentation bridge, but neither face accepts it in the TO document: the `@objectstack/spec` `ReportSchema` the member takes by reference refuses it under `report` (`objectName` as an unrecognized key, `invalid_type` at `report.columns.0`). Migrate it to a dataset binding (ADR-0021) to validate.
  
  **Clause-②: yes** — a registration leaves the runtime (narrowing), released as `minor` with this banner.
- 64dae8e: Six user-visible fixes across the maker surface, the assistant rail and the
  dataset captions.
  
  **The maker's start chips now promise only what ADR-0112 v1 builds
  (cloud#1984).** Two of the five asked for automation the first version has no
  flows or actions for — the ticket chip said 「状态流转」, the inventory chip said
  「低库存预警」 — and the measured behaviour was not a refusal but a silent
  degrade: a status kanban and a low-stock view. The chip promised an alert and
  delivered a page. All five are reworded in all ten packs (and in the call-site
  `defaultValue` fallbacks, which are a second copy of the same strings) to ask
  for objects, fields, views, pages, dashboards and sample data, keeping each a
  real business scenario — the ticket chip now asks for a status field and a board
  grouped by it, the inventory chip for a view that filters below the reorder
  point. A note beside the keys says to revert when v2 re-adds flows.
  
  **Five newer AI tools get their step labels (objectui#7481).** A zh conversation
  read `✓ Get authoring rules 已完成` between 「读取元数据结构」 and 「列出对象」:
  `get_authoring_rules` (cloud#1837), plus `load_tools`, `open_record`,
  `test_flow` and `toggle_flow`, are registered by the cloud AI runtime but are
  newer than the pinned spec's tool registry, so they had no `chatbot.tool.*`
  entry in any pack and fell through to the English title-caser.
  
  **The assistant rail follows the thread when you send (objectui#7480).** The
  rail and the full-page maker are the same component; what differs is width. A
  reply that still ends on screen in the wide column runs two or three times
  taller in a ~360px rail, so `StickToBottom`'s lock is escaped by the time the
  user types and the new bubble, the tool steps and the streaming answer all land
  below the fold. Every send path now re-arms the lock — including the plan-card
  "Build it" and 确认修改 approvals, whose own code comments already named this
  miss. Message APPENDS deliberately do not, so a user reading back through the
  thread mid-answer is never yanked to the bottom.
  
  **Console toasts move off the assistant composer (objectui#7482).** 「客户更新
  成功」 sat on the ChatDock composer's send button and stayed there. One defect,
  two symptoms: `apps/console` pinned the toaster to `bottom-right` — an override
  that predates ADR-0057 P3a — so a toast both covered the button and, because
  sonner pauses a toast's dismiss timer while the pointer is inside the toaster
  region, never got to run its 4s timer with a pointer resting on the composer
  underneath. The override is gone; the console takes `ConsoleToaster`'s own
  documented top-right anchor, and the 4s success duration is now pinned.
  
  **Built-in aggregate captions follow the locale everywhere (objectui#7534).**
  objectui#7258 taught `buildChartSeries()` to resolve a server-minted default
  measure through the locale map, so a chart legend read `计数` while the table
  beneath it, the KPI caption, the pivot header and the dataset preview still
  printed the server's hard-coded English `Count`. `buildDatasetFieldHelpers()`
  takes the same optional `builtinAggregateLabels`, resolving through the one
  `resolveMeasureLabel` order, and the five call sites pass it. Omitting the
  argument reproduces the previous output byte for byte, and an author-declared
  measure still keeps its own label verbatim (objectui#4106).
  
  **The activity feed stops asking for an object the environment does not have
  (objectui#7476).** A tenant environment has no `sys_activity`, so every page
  load issued a request that 404'd. Everything downstream was already correct —
  the adapter memoizes the missing collection, its logger demotes the failure, the
  feed retires as an ANSWER and the panel renders its earned empty state — so what
  is left is the request itself, and `data-objectstack` states the rule for it:
  the cure for a doomed request is not issuing it. New `useObjectPresence` reads
  the object registry the shell loads for the nav anyway; only a registry that has
  ANSWERED and lists other objects without this one skips the read. Every
  uncertainty — no provider, empty registry, still loading, errored — reads as
  before, because a wrong skip would cost a real deployment its feed.
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
- 80da129: A dataset-bound report whose `chart.title` is an inline locale map now draws its heading
  instead of drawing none (objectui#9150).
  
  `@objectstack/spec` types `ReportChartSchema.title` as `I18nLabel` — a plain string OR an
  inline locale map — so `{ "chart": { "type": "bar", "title": { "en": "Pricing", "zh-CN": "定价" } } }`
  is authored surface the contract accepts. `DatasetReportChart` paints the report chart's
  heading itself, as its own `h3`, and read the value back through
  `typeof chart.title === 'string'`. The map arm failed that test, the local `title` became
  `undefined`, and the `{title ? … : null}` guard skipped the element entirely: the report
  drew **no heading at all**, in every language, with no diagnostic.
  
  Note the shape, because it is the same one objectui#9038 described and not the sibling
  objectui#8943: the value was not resolved badly, it was not resolved at all. There was no
  heading to compare against a locale, so no locale-comparison check could see it, and an
  author who wrote spec-legal metadata saw a chart that looked as though it had simply been
  given no title.
  
  The read site now resolves through `pickLocalized`, this repo's one resolver for the
  union — the form already used a few lines above in the same file for an authored
  `series[].label`, against the same `useObjectTranslation().language`. Both branches that
  paint the heading (the series chart and the single-value metric) read one binding, so one
  change covers both, and both are pinned.
  
  Why this is `minor` and not `patch`. Every publishable package here sits in one `fixed`
  group, so `major` is unavailable by policy and this repo ships behaviour-visible changes
  as `minor`. This one is behaviour-visible on a **published** package: stored documents
  that render nothing today start rendering an `h3`, and an author who worked around the
  absence by authoring a separate heading of their own will now see two. That is a change
  to what the renderer paints for metadata it already accepted, not an internal repair. The
  direct sibling objectui#9038 — same union, same defect shape, same round — shipped
  `minor` for exactly this, and one release should not classify the two differently.
  
  What did **not** change:
  
  - A plain-string `title` renders byte-identically, in every language. It is the lit
    control in the new pins, and if it had moved the repair would have overshot.
  - The chart component is still handed **no** `title`. This renderer drops it from the
    lowered chrome on purpose, so the chart cannot draw a second heading inside its own
    frame; that pin is kept and extended to the map arm.
  - The resolution policy is not re-decided here. `pickLocalized`'s documented chain (exact
    tag, base language, region-qualified sibling, `default`, `en`, first entry) is what a
    map with no limb for the active language falls back along, so it draws another limb
    rather than vanishing — `default` outranks `en`, pinned, so the fallback is demonstrably
    the resolver's chain and not an ad-hoc "else English". Only a map carrying no usable
    string at all resolves to a miss, and that still draws no heading rather than an empty
    one.
  
  The neighbouring read sites objectui#9038 ledgered by name are unchanged, and that ledger
  is updated to record this one as resolved. The remaining entry — a series `label` and an
  axis `title` still taking `labelText`'s first-string-wins pick (objectui#4020) — stays
  open on purpose.
- a9d97be: Close the numeric-falsy `SchemaNode` slot class: a slot may no longer guard itself
  (objectui#9162, triage ruling 2026-09-12).
  
  **What leaked.** `{schema.footer && <CardFooter>…</CardFooter>}` does not evaluate to
  `false` when the slot is falsy — it evaluates to the **slot**, and React renders
  numbers. A node slot's published zod face carries a `z.number()` arm
  (`nodeUnionOptions`, `packages/types/src/zod/base.zod.ts`), so `footer: 0` is **legal
  authored input**, and it painted a stray `0` into the DOM. `NaN` painted three
  characters. The `&&` also short-circuits, so `renderChildren`'s own
  `if (!children) return null` first leg was never reached — which is why the
  objectui#8908 bridge repair could not cover any of these sites.
  
  **Why a class fix and not N instance fixes.** This class was patched one instance at a
  time three times — objectui#8331 (`DataTableSchema.emptyAction`), objectui#9033
  (`header-bar`'s `rightContent`), and then objectui#9162's census found eleven more,
  because objectui#9033's grep was keyed on the spelling of the **right** operand while
  the trap depends only on the **left** one. Nineteen guards across eight files are
  repaired here, and the construct that permits them is now refused mechanically.
  
  **The one spelling, and the gate.** `renderChildren(slot)` is the guard for a bare
  slot; the new `renderNodeSlot(slot, render)` is the guard for a slot wrapped in chrome
  that must disappear with it. Both route through one exported predicate,
  `isEmptyNodeSlot`. The new lint rule `object-ui/no-bare-node-slot-guard` refuses the
  `&&` spelling, deriving its slot set per file from the file's own text — an expression
  is a node slot there if that file hands it to `renderChildren`, `renderNodeSlot`,
  `toRenderableSchema` or `<SchemaRenderer schema={…}>`. A twelfth slot is rendered
  through one of those, so it is covered the moment it is written, with no list to keep
  up to date.
  
  **Why `minor`.** Two reasons, and neither is a contract break.
  
  1. `@object-ui/components` gains public API: `renderNodeSlot` and `isEmptyNodeSlot` are
     new exports. A new export is a `minor` on its own.
  2. Published renderers change what they emit for two authored inputs. A node slot
     authored `0` / `-0` / `NaN` stops painting that character — that is the defect, and
     no author asked for it. A node slot authored `[]` no longer renders its empty chrome
     (an empty `CardHeader` / `CardContent` / `CardFooter` / `DialogFooter` /
     `SheetFooter` / `DrawerFooter` / `TableFooter`, or `plugin-detail`'s wrapping
     `div`); the chrome now appears and disappears with its content. Measured across
     `examples/`, `content/` and `apps/`: **zero** authored node slots carry a numeric
     value, and the single authored `"children": []` is on `div`, which never had the
     `&&` guard and is unaffected.
  
  ⛔ Deliberately **not** marked `**BREAKING**`: no authored input stops being accepted,
  no export is removed, no key stops being read, and objectui#7105 is respected — the
  declarations are untouched and node slots still relax the renderer. An author who
  genuinely wants the character `0` writes `"0"` or a `text` node, both unchanged.
- a78cd37: Dates and numbers across the console and the plugins format in the session's
  display locale instead of the machine's (objectui#9909).
  
  Every one of these faces handed `Intl` — directly, or through a formatter called
  without one — either no locale tag or an explicit `undefined`, which is not "the
  user's locale": it is the locale of the machine the browser runs on, which is
  neither of this repository's two locale channels.
  A German or Spanish session therefore read, beside a translated label, a date or
  an amount grouped and decimal-marked the machine's way — and an amount with
  inverted separators does not read as unformatted, it reads as a different
  number. They now go through `useDisplayLocale()` (tenant regional default, then
  the active UI language, then `'en'`), and a plain helper takes that tag from its
  caller. The surfaces:
  
  - **`@object-ui/fields`** — `GridField`'s numeric and currency cells (list mode
    and computed columns) and both total cells. The same cell helper's date branch
    already used the display locale, so a single grid row read two conventions at
    once.
  - **`@object-ui/plugin-charts`** — ISO-date x-axis ticks, compact y-axis ticks,
    the single-value face, spec `format` strings and the tooltip value.
  - **`@object-ui/app-shell`** — the organization invitations, members and
    accept-invitation dates; marketplace version dates; the AI conversation row's
    older-than-a-week date and its tooltip; the build-debug token count; the
    record approvals timeline; and the metadata-admin audit, history, external
    datasource snapshot, schema-browser row estimate, flow-run start and job
    next-fire faces. The audit, history and flow-run panels format these in the
    DISPLAY locale, not in the `locale` prop they take for their UI strings
    (`AuditPanel` defaults that prop to `'en-US'`; `HistoryPanel` and
    `FlowRunsPanel` leave it optional).
  - **`@object-ui/console`** — the approvals inbox's timestamp tooltips, amounts
    and payload summary; the audit log's timestamp column; the flow runs table and
    its run detail.
  - **`@object-ui/components`** — the export dialog's record counts and the debug
    panel's event times.
  - **`@object-ui/plugin-form`** — the analytics submission count, the
    master-detail subtotal / tax / total stack and the edit-conflict dialog's
    "their save" time.
  - **`@object-ui/plugin-chatbot`** — the approvals inbox's past-30-days date and
    the times stamped on local-mode chat messages (the user's and the
    auto-response).
  - **`@object-ui/plugin-dashboard`** — the record-count badge, and the currency
    and date-format branches of `renderFieldValue`, which was handed the display
    locale and spent it only on its percent branch.
  - **`@object-ui/plugin-grid`** — the record-detail panel's inferred currency
    value and the mobile card's amount line, siblings of date cells already on the
    display locale.
  - **`@object-ui/plugin-designer`** — `VersionHistory`'s version times.
  
  A host that mounts one of the components that newly read the display locale with
  NO `I18nProvider` now gets react-i18next's once-per-module `NO_I18NEXT_INSTANCE`
  notice in the console on the first such mount; the faces still render, in the
  channel's `'en'` last resort, and mounting an `I18nProvider` (as the console
  does) avoids the notice.
  
  **Additive API** (nothing that compiled before stops compiling):
  
  - `@object-ui/types`: `ValidationContext` gains an optional `locale`. At this
    change, the `@object-ui/core` validation engine prints the `date_min` /
    `date_max` bound in it; omitted, `Intl` follows the runtime default, as
    `formatDisplayNumber` already declares for a caller with no locale in hand.
  
    ⚠️ **Dated note, 2026-09-25 — that engine (`ValidationEngine`) is removed from
    `@object-ui/core` by a later change; `ValidationContext.locale` stays declared in
    `@object-ui/types`, and at that change nothing in `@object-ui/core` reads it —
    objectui#7659.**
  
    ⚠️ **Dated note, 2026-09-27 — `ValidationContext` itself is removed from
    `@object-ui/types` by a later change, with the rest of the Phase 3.5
    validation types it belonged to, so the `locale` member this entry adds no
    longer exists — objectui#10719.**
  - `@object-ui/plugin-report`: `exportReport`, `exportAsHTML` and `exportAsPDF`
    take a trailing optional `locale` for the exported file's "Generated:" time,
    and `LiveExportOptions` gains an optional `locale` that `exportWithLiveData`
    forwards. Omitted, the time uses the display channel's own last resort
    (`'en'`), never the machine's locale. `ReportViewer` passes the session's
    display locale. The locale is deliberately NOT a `ReportExportConfig` member:
    that type is authored report metadata, and a display locale belongs to the
    session.
  
  **One census, repository-wide.** `plugin-detail`'s machine-locale census pin
  (objectui#9786) is now a single test, `machineLocaleCensus-9909.test.ts` in
  `@object-ui/i18n`, covering every workspace package whose manifest depends on
  `@object-ui/i18n`. It refuses any call site that passes nothing, `undefined`,
  the `'default'` pseudo-tag (a subtag no locale data answers, so `Intl` resolves
  it to the machine's locale) or a hard-coded tag, unless the site is declared
  with its reason — for example the `catch` fallback for a tag `Intl` itself
  rejected, or an ISO formatter feeding `<input type="date">`. Each declared site
  is counted exactly, so deleting one without its entry is refused too. The
  per-package pin it replaces is deleted. The runtime tripwire that observes the
  argument each locale-taking call (`Intl` constructors, `Date` and `Number`
  `toLocale*`) actually receives moved into the private `@object-ui/test-support`
  package, and every surface above is pinned with it: the same data under two
  declared locales must render differently, NO locale-taking call may receive the
  machine's locale (nothing, `undefined` or `'default'`), and the surface's own
  calls must receive the declared tag. A call carrying another declared tag, such
  as the `'en'` of the session's UI language, is tolerated by design: only the
  machine's locale is the defect.

### Patch Changes

- 8cedb0d: The two declared display-locale contracts now each name the caller they govern,
  and each points at the other (objectui#10098). This is documentation only: no
  module's behaviour moves.
  
  - `DisplayNumberFormatOptions.locale` (`@object-ui/core`): leaving the tag
    `undefined` means the runtime default, and that rule is written for a non-React
    display caller with no tag in hand. For that caller the viewer's own environment
    is the honest locale for a user-facing display. A malformed tag lands in the
    same place through `formatDisplayNumber`'s retry.
  - `useDisplayLocale` (`@object-ui/i18n`): its concrete `'en'` last resort, kept for
    determinism, is the rule for a React renderer whose provider chain yields no tag
    at all, not a rule for every caller without a tag.
  - `formatNumberInDisplayLocale` (`@object-ui/plugin-report`): the note on its
    malformed-tag retry no longer calls the dropped-tag retry behind
    `formatDisplayNumber` a wrong answer. Each retry follows its own package's
    declared contract.
  
  Read alone, either docblock used to look like a rule for every caller, and each
  contradicted the other. The new wording reaches each package's published type
  declarations, which is why this is declared as a patch rather than left
  undeclared.
- 256b4c9: A filter refused as malformed (`INVALID_FILTER`) no longer throws out of render or out of a click
  handler at the sites that merge filters there. That holds whether this layer's filter converter
  refused it or, at the drill seam, the spec's own `parseFilterAST`. Each site now surfaces the
  refusal the way its siblings already do (objectui#10789). The filter stays **refused**: nothing
  that was refused is accepted, and no site falls back to "no filter".
  
  - **`ElementDataSourceGate` / `useElementDataSource`** (`@object-ui/react`): the gate's merge of
    the component's `filter` with the composed binding, and the merge of a saved view's filter
    with the binding's own, lowered through the throwing converter inside render. A refused
    filter from either now makes the binding `missing` with a new optional `filterRefusal` on the
    result (`error` carries its message). The gate then draws, in place of the block, the
    malformed-filter notice the wrapped blocks draw: `view.malformedFilter`, naming the refused
    operator or field. `element:record_picker`, which reads the same hook, shows its
    configuration-error panel with the refusal.
  - **`PeoplePicker` / `RecordPickerDialog`** (`@object-ui/fields`): the recents merge and the
    dialog's `mergedFilter` lower through `toFilterNodeSafely`; a refusal is shown in the picker's
    existing error state and no query runs without the filter.
  - **Drill-downs** (`ObjectChart`, `ObjectPivotTable`, `DatasetWidget`, `DatasetReportRenderer`):
    a widget or report filter refused at the drill seam made the drill click throw. The converter
    refuses some (a spec `$not`, say). The spec's `parseFilterAST` refuses others, such as a scalar
    on a list operator in either dialect: `[['stage', 'in', 'won']]` or `{ stage: { $in: 'won' } }`.
    The drill is now not opened or emitted (never with the scope dropped), and the refusal is logged
    with `console.warn`, naming the operator. `composeDrillFilter` (`@object-ui/core`) now throws
    one refusal type: the spec's `INVALID_FILTER` error is re-raised as a `FilterOperatorError` with
    its message and the same `INVALID_FILTER` / 400 envelope, and any other error passes through
    unchanged.
  - **`ListView` export** (`@object-ui/plugin-list`): the server export builds its filter inside
    its `try`, so a refusal is named in the export menu instead of escaping the click.
  - **`convertFiltersToAST`** (`@object-ui/core`): an `$or` member that is the TRUE identity no
    longer stops the members after it from being read. `{ $or: [{}, { a: {} }] }` is now refused
    like `{ $or: [{ a: {} }, {}] }` already was, instead of answering TRUE (every row); a TRUE
    disjunct beside members that lower still absorbs its `$or`.
- ed76b1b: fix(plugin-report,plugin-form): a dataset report and an authored-parent `record:line_items` panel re-read on the data-invalidation bus
  
  The one fetch every dataset report presentation runs through (the tabular and
  summary table, the matrix, the embedded chart, each joined block) now names the
  `useDataInvalidation` nonce for the dataset's base object, the object the
  query's answer names. So a write declared on the bus (`notifyDataChanged`, as a
  page action over raw HTTP does) re-reads a `report` / `spec-report` block in
  place: the rows on screen stay drawn until the answer replaces them, where
  before the block dropped back to "Running report…". The `spec-report` a
  drill-down drawer opens for `drillDown.report` re-reads the same way. A report
  whose answer names no object does not subscribe. A re-read that fails shows the
  error in place of the rows and keeps listening, so the next such write re-reads
  the report; a first load that fails, or a new selection, listens to nothing
  until an answer names its object.
  
  The child-row read of `record:line_items` now names the nonce for its child
  object, so a panel with an authored `parentId` / `recordId` (one a stored page
  holds with no record context) re-reads its lines after such a write. A re-read
  of the lines on screen keeps the grid drawn, taking no input until the answer
  lands. While the panel holds unsaved edits the re-read is held, and the save's
  reload carries it, as for any other re-read of this panel.
  
  Before, both refreshed after such a write only when their host remounted them,
  and `PageView` is about to stop doing that (objectui#10519).
  
  ⚠️ **Dated note, 2026-10-02 — `spec-report` is retired — objectui#11440.**
  Later in this same release `@object-ui/plugin-report` stopped registering `spec-report`, an alias of
  `report`, and the drill-down drawer renders `drillDown.report` as `{ type: 'report', report }`. So
  "a `report` / `spec-report` block" above now reads a `report` block, and "The `spec-report` a
  drill-down drawer opens" reads the `report` node it opens; both re-read the same way.
  `.changeset/11440-retire-spec-report.md` states what ships. The rest of this entry is kept as the
  reading of this change.
- a60539b: fix(plugin-dashboard,components,plugin-report): three more read sites show the day a stored date-only value names, in every zone (objectui#10844)
  
  Each read below parsed a date-only `YYYY-MM-DD` string with the engine's own `Date`
  parse, which reads it as UTC midnight. West of UTC that is the evening before, so
  each face showed the previous day. Each now reads the value through `toDisplayDate`
  (`@object-ui/core`), which rebuilds a date-only string at local midnight of the day it
  names. For a real day, a viewer in UTC or east of it sees no change.
  
  - **Dashboard date filter, custom range.** The range calendar highlighted the day
    before each stored bound and could open on the previous month: clicking 15 Sep stored
    `2026-09-15` and then highlighted the 14th. It now highlights and opens on the stored
    days. A bound naming a day its month does not have (`2026-02-30`) no longer rolls
    into March: it selects no day, and a `from` like that opens the calendar on today, as
    an unparseable `from` already did.
  - **`date-picker` renderer, an ISO string `value`.** An authored or bound
    `value: '2024-01-15'` was labelled "January 14th, 2024" and selected the 14th. It now
    labels and selects the 15th. Only a date-only string naming a real day is read this
    way: a `Date`, a date-time string and any other string reach date-fns exactly as
    before. So an unparseable string still makes the trigger's `format` throw, as it did
    before, and a date-only string naming a nonexistent day is still rolled forward
    rather than refused, because refusing it would make `format` throw where it rendered
    before.
  - **Report cell date face (`formatValue`).** The `yyyy-MM-dd` face `ReportViewer` gives
    an untyped ISO-looking value and an aggregated column read `2026-09-14` for a stored
    `2026-09-15`. It now reads `2026-09-15`. A value naming a nonexistent day now renders
    as the raw stored string, this face's existing answer for an unparseable value,
    instead of a rolled-forward day.
  
  A date-time value (one with a time part) still renders in the viewer's zone at every
  site.
- 49f7672: A `matrix` report that declares `columns` now draws its declared `chart` below the cross-tab
  (objectui#10964). `ReportSchema` has always accepted a matrix report carrying both `columns` and
  a `chart`, but the renderer's cross-tab branch returned before the chart was read, so the chart
  parsed and was never drawn. It binds the way the summary report's chart does: `chart.xAxis` names
  a dataset dimension (a `rows` or a `columns` dimension of the matrix) and `chart.yAxis` a dataset
  measure, plotted from the chart's own dataset query. Summary, tabular and matrix-without-`columns`
  reports keep the chart above their table, as before.
  
  The notice an out-of-spec chart type shows no longer says the table is "below" it, since on a
  matrix report the table sits above the notice.
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
- 854222c: `@object-ui/plugin-report` now registers its three components under namespace
  **`plugin-report`**, the spelling its consumers already declare (objectui#6416).
  
  It used to register `report`, `spec-report` and `report-viewer` under namespace
  `report`, while `apps/console` declared the lazy stubs for the same three short
  names under `plugin-report` and the CLI's known-type whitelist shipped the
  `plugin-report:*` spellings as renderable. Two things followed from the
  disagreement:
  
  - **`plugin-report:report`, `plugin-report:report-viewer` and
    `plugin-report:spec-report` could never be satisfied.** `Registry.register`
    clears the lazy stub for the type IT registers, and that type was
    `report:report`, so those three stubs were never cleared and no component was
    ever stored under them: `get('report', 'plugin-report')` returned `undefined`
    and `hasLazy('report', 'plugin-report')` stayed `true` forever. A schema
    authored with any of the three whitelisted keys resolved to nothing — the
    gate handed authors a green light for a key the runtime could not satisfy.
  - **The bare `report` key was claimed twice under two different namespaces.**
    `Registry.register` and `Registry.registerLazy` share the
    `meta?.namespace && !meta?.skipFallback` branch, so what bare `report`
    *declared* depended on whether the plugin chunk had loaded yet — the
    objectui#6353 shape.
  
  **No authored metadata changes.** The direction was chosen by measurement:
  nothing in this repository, and nothing in the sibling `objectstack` checkout,
  authors a `report:*` spelling (0 hits), while the bare spellings are authored in
  48 places. `type: 'report'`, `type: 'spec-report'` and `type: 'report-viewer'`
  resolve exactly as before; the three unreachable `report:*` keys are retired and
  the three `plugin-report:*` keys now name real components for the first time.
  
  `packages/cli/src/utils/known-schema-types.ts` is regenerated from the
  registrations, dropping `report:report`, `report:report-viewer` and
  `report:spec-report`.
  
  Two pins are the half that outlives the fix:
  `packages/plugin-report/src/__tests__/report-bare-key-ownership.test.ts` replays
  this package's real declared metadata and a console-shaped lazy stub into a
  fresh `Registry` in **both** registration orders, checking the bare key's
  declared namespace after every step, so order- and phase-independence are
  properties under test rather than properties of the file the test imports.
  `scripts/__tests__/report-namespace-agreement-6416.test.ts` re-derives both
  sites from source and fails if the plugin, the console stubs and the generated
  whitelist ever disagree again.
  
  ⚠️ **Dated note, 2026-10-02 — `spec-report` is retired — objectui#11440.**
  Later in this same release `@object-ui/plugin-report` stopped registering `spec-report`, and with it
  `plugin-report:spec-report`; the console dropped its lazy stub, and `known-schema-types.ts` no longer
  lists either key. So the package registers two components under `plugin-report`, not three, and
  "`type: 'spec-report'` … resolve exactly as before" and "the three `plugin-report:*` keys now name
  real components" above no longer hold for `spec-report`: a node of that type resolves to nothing.
  `report` and `report-viewer` resolve as this entry says. `.changeset/11440-retire-spec-report.md`
  states what ships. The rest of this entry is kept as the reading of this change.
- 47547d0: Localize the server's built-in aggregate measure titles on dataset charts
  (objectui#7258 — consumer half of the objectstack#14492 contract; maintainer
  ruling B, 2026-09-02).
  
  A dataset-bound chart's aggregate axis / legend title read the analytics
  service's hard-coded English `Count` on a zh console whose category labels were
  already Chinese. The renderer was passing `fields[].label` through verbatim —
  correctly, for an author-declared measure (objectui#4106) — and had no way to
  tell the server's built-in default apart from an author's label.
  
  The wire now can: `AnalyticsResult.fields[]` gains an OPTIONAL structural
  discriminator, `builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' |
  'count_distinct'`, populated only on the server-side built-in defaults
  (objectstack#14492). This change is the consumer side of that contract:
  
  - `@object-ui/core`: `buildChartSeries` now accepts `ChartMeasureField[]` —
    `ChartResultField` plus the optional `builtinAggregate` carrier
    (`BuiltinAggregateCarrier`), declared beside the renderer shape rather than
    on it because the spec this release is built against does not carry the key
    yet; new `BUILTIN_AGGREGATES` / `BuiltinAggregate` / `isBuiltinAggregate` /
    `resolveMeasureLabel`; `ChartSeriesOptions.builtinAggregateLabels` carries
    the locale strings in (core stays React-free and i18n-free — the same
    division as `nullCategoryLabel`). A field carrying a recognised
    discriminator resolves through that map; every other field keeps its wire
    `label` verbatim — never by matching the label's text or the field's name
    (the rejected option A).
  - `@object-ui/i18n`: `builtinAggregateLabels(tt)` resolves the six strings
    through the existing `report.aggregate.*` keys (zh already carried 计数 /
    求和 / 平均 / …; all ten packs are pinned to cover the vocabulary).
  - `plugin-charts` (`ObjectChart`), `plugin-dashboard` (`DatasetWidget`),
    `plugin-report` (`DatasetReportRenderer`): pass the resolved map to
    `buildChartSeries`.
  
  Before: 合作中 / 已流失 / 潜在 under an axis titled `Count`. After: the same
  chart titled `计数`; an `en` session still reads `Count`; an author-labelled
  measure (`Tasks`) and a measure literally named `count` without the
  discriminator are byte-for-byte unchanged. Until the upstream field is
  populated the wire carries no discriminator and every chart renders exactly as
  before.
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
- Updated dependencies [7b10bef]
- Updated dependencies [97abedc]
- Updated dependencies [b46c58f]
- Updated dependencies [a507334]
- Updated dependencies [ad694ac]
- Updated dependencies [6f96fca]
- Updated dependencies [afb2284]
- Updated dependencies [3ac2de8]
- Updated dependencies [0aacecc]
- Updated dependencies [63f4f92]
- Updated dependencies [777fca2]
- Updated dependencies [c131d9e]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [0361d6b]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [8cedb0d]
- Updated dependencies [162621b]
- Updated dependencies [4c6f549]
- Updated dependencies [80c5412]
- Updated dependencies [6cc910b]
- Updated dependencies [061f5e8]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e686f4d]
- Updated dependencies [212c451]
- Updated dependencies [a04b06d]
- Updated dependencies [4ab4f1b]
- Updated dependencies [b57107d]
- Updated dependencies [e3ea4f9]
- Updated dependencies [65f1e8d]
- Updated dependencies [1f8ef0a]
- Updated dependencies [bb5d4ee]
- Updated dependencies [dc666f7]
- Updated dependencies [3335767]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [cff4b77]
- Updated dependencies [31938f0]
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
- Updated dependencies [8c929e6]
- Updated dependencies [cdefa2a]
- Updated dependencies [2fc2a24]
- Updated dependencies [0961d5e]
- Updated dependencies [9d25b9b]
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
- Updated dependencies [111fa4c]
- Updated dependencies [93a689d]
- Updated dependencies [4357a27]
- Updated dependencies [e5f4343]
- Updated dependencies [3261e64]
- Updated dependencies [f5178a2]
- Updated dependencies [2ad3671]
- Updated dependencies [39bf246]
- Updated dependencies [8740e86]
- Updated dependencies [d22b37b]
- Updated dependencies [8c0e550]
- Updated dependencies [fde4caf]
- Updated dependencies [caf0ed0]
- Updated dependencies [1daf477]
- Updated dependencies [3d614ea]
- Updated dependencies [a7df45f]
- Updated dependencies [6c2f3c5]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [6516320]
- Updated dependencies [98b1a7c]
- Updated dependencies [e0f8202]
- Updated dependencies [ac2d6f1]
- Updated dependencies [9fbbb17]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9a5f998]
- Updated dependencies [1c5ee33]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [a9c5ea0]
- Updated dependencies [02e6d36]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [4758b33]
- Updated dependencies [f905090]
- Updated dependencies [3cd6c5e]
- Updated dependencies [5bb855d]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [7afc81d]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [bf14b64]
- Updated dependencies [4345558]
- Updated dependencies [97b6c21]
- Updated dependencies [26ca2ad]
- Updated dependencies [41ae65b]
- Updated dependencies [baac95a]
- Updated dependencies [13220af]
- Updated dependencies [29b45f6]
- Updated dependencies [39b8d51]
- Updated dependencies [17b323e]
- Updated dependencies [b956e69]
- Updated dependencies [b32e7de]
- Updated dependencies [ff94a12]
- Updated dependencies [33e58d8]
- Updated dependencies [256b4c9]
- Updated dependencies [97672ba]
- Updated dependencies [c5ec15c]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [d0c0c7f]
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
- Updated dependencies [990a2d6]
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
- Updated dependencies [c27b575]
- Updated dependencies [84b275c]
- Updated dependencies [0e6e76b]
- Updated dependencies [bf43afa]
- Updated dependencies [385ebc5]
- Updated dependencies [3a0e7ab]
- Updated dependencies [858eafb]
- Updated dependencies [a8c5509]
- Updated dependencies [c2a8d23]
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
- Updated dependencies [7fed09d]
- Updated dependencies [c1763e5]
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
- Updated dependencies [52c95a1]
- Updated dependencies [55d18c6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [c4ab6d0]
- Updated dependencies [5988b6b]
- Updated dependencies [6158e4c]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [6007dd4]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [4a1adb7]
- Updated dependencies [185b7a0]
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
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
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
- Updated dependencies [7e19d03]
- Updated dependencies [b08b7eb]
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
- Updated dependencies [5fa06c4]
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
- Updated dependencies [8631c32]
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
- Updated dependencies [98188c2]
- Updated dependencies [4c68077]
- Updated dependencies [7977ff9]
- Updated dependencies [3beef6d]
- Updated dependencies [06b8c42]
- Updated dependencies [46b9bc9]
- Updated dependencies [f46bd39]
- Updated dependencies [b98352a]
- Updated dependencies [b76ca67]
- Updated dependencies [b97790a]
- Updated dependencies [dbd5194]
- Updated dependencies [7c9b044]
- Updated dependencies [e552c31]
- Updated dependencies [d47de51]
- Updated dependencies [3fe6463]
- Updated dependencies [b392674]
- Updated dependencies [4f3a1e2]
- Updated dependencies [31ab372]
- Updated dependencies [846889b]
- Updated dependencies [2acd8e1]
- Updated dependencies [7b90231]
- Updated dependencies [26896c6]
- Updated dependencies [67fc3b0]
- Updated dependencies [8579e34]
- Updated dependencies [d57db5d]
- Updated dependencies [33a3b3c]
- Updated dependencies [b87f15b]
- Updated dependencies [045d20b]
- Updated dependencies [a2d2515]
- Updated dependencies [c18d099]
- Updated dependencies [0caacca]
- Updated dependencies [adb2a86]
- Updated dependencies [03380aa]
- Updated dependencies [4562ea5]
- Updated dependencies [3619792]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [320374d]
- Updated dependencies [b0d308d]
- Updated dependencies [b458300]
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
- Updated dependencies [39d69ad]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [6a449fc]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [f08bcd9]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [220c18d]
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
- Updated dependencies [e8e4c4d]
- Updated dependencies [1f31d3a]
- Updated dependencies [d1842ab]
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
- Updated dependencies [0348bc9]
- Updated dependencies [e8c553b]
- Updated dependencies [2e32ed4]
- Updated dependencies [554e647]
- Updated dependencies [3ed3eec]
- Updated dependencies [7c3df8f]
- Updated dependencies [a4514e8]
- Updated dependencies [db3896c]
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
- Updated dependencies [3399704]
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
- Updated dependencies [f52a9d7]
- Updated dependencies [cf1d29e]
- Updated dependencies [1bd79c8]
- Updated dependencies [af9e957]
- Updated dependencies [b1030c7]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [6778809]
- Updated dependencies [3a3dd28]
- Updated dependencies [7fb22a1]
- Updated dependencies [ad66d79]
- Updated dependencies [0758bd8]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [7ed9808]
- Updated dependencies [0ea7054]
- Updated dependencies [ac0e39a]
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
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [317dbce]
- Updated dependencies [309728c]
- Updated dependencies [c03d03b]
- Updated dependencies [aa08d7e]
- Updated dependencies [3a43a15]
- Updated dependencies [868e825]
- Updated dependencies [f76f436]
- Updated dependencies [ce45a03]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [639ca9d]
- Updated dependencies [2152962]
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
- Updated dependencies [3e71b26]
- Updated dependencies [b89583b]
- Updated dependencies [70c4523]
- Updated dependencies [555b4ec]
- Updated dependencies [64f1cf1]
- Updated dependencies [da5e4f6]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [0a174f3]
- Updated dependencies [676f677]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [d1865d2]
- Updated dependencies [88a629d]
- Updated dependencies [cdd2542]
- Updated dependencies [ab77513]
- Updated dependencies [55ba3ff]
- Updated dependencies [3ecc369]
- Updated dependencies [f1190b0]
- Updated dependencies [561abef]
- Updated dependencies [ef52001]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [abf710d]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [0eaed83]
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
- Updated dependencies [6d5db7b]
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
- Updated dependencies [0ce32d5]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [1ef89c0]
- Updated dependencies [ba0b61a]
- Updated dependencies [ba0b61a]
- Updated dependencies [ac716ff]
- Updated dependencies [e05553c]
- Updated dependencies [f0f3cd5]
- Updated dependencies [ab856ed]
- Updated dependencies [f0f2046]
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
- Updated dependencies [9aa2a57]
- Updated dependencies [f7fcc2c]
- Updated dependencies [f0f4d6c]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [2e97c8c]
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
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [e22fa12]
- Updated dependencies [1560d46]
- Updated dependencies [276d174]
- Updated dependencies [2982ed9]
- Updated dependencies [741864f]
- Updated dependencies [a8198de]
- Updated dependencies [0c789a4]
- Updated dependencies [05a49f2]
- Updated dependencies [b234a84]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [4d7d322]
- Updated dependencies [5eabe86]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [ff0c384]
- Updated dependencies [af4fb29]
- Updated dependencies [c698a81]
- Updated dependencies [ff5ef1c]
- Updated dependencies [befd40c]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [81c0bc4]
- Updated dependencies [3c76801]
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
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [e719ebd]
- Updated dependencies [516583b]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [58be55e]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [fe76ece]
- Updated dependencies [8b446f5]
- Updated dependencies [8e74b27]
- Updated dependencies [7102b20]
- Updated dependencies [8ebd57f]
- Updated dependencies [968dc1e]
- Updated dependencies [9a1fb41]
- Updated dependencies [617707a]
- Updated dependencies [c40f3b8]
- Updated dependencies [58770f3]
- Updated dependencies [aefe428]
- Updated dependencies [485f096]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [b655a9d]
- Updated dependencies [a865c73]
- Updated dependencies [3e01cb5]
- Updated dependencies [7138bc1]
- Updated dependencies [cef27e2]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [06973aa]
- Updated dependencies [50798f3]
- Updated dependencies [6a576c9]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [c70f865]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [d7bd274]
- Updated dependencies [98c3a74]
- Updated dependencies [fffa30d]
- Updated dependencies [e4e9557]
- Updated dependencies [7a28e1e]
- Updated dependencies [ebce5a3]
- Updated dependencies [fb336df]
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
- Updated dependencies [b6e83be]
- Updated dependencies [ab92940]
- Updated dependencies [a691c0b]
- Updated dependencies [0b1326d]
- Updated dependencies [1e66879]
- Updated dependencies [c5200f0]
- Updated dependencies [af3861f]
- Updated dependencies [515f171]
- Updated dependencies [1f4e029]
- Updated dependencies [4f14ad7]
- Updated dependencies [258d264]
- Updated dependencies [cac64b3]
- Updated dependencies [4bb940b]
- Updated dependencies [8033ad1]
- Updated dependencies [fa140b8]
- Updated dependencies [71cba28]
- Updated dependencies [190fbd0]
- Updated dependencies [c00bf28]
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
- Updated dependencies [f1690d4]
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
  - @object-ui/react@17.7.0
  - @object-ui/core@17.7.0
  - @object-ui/types@17.7.0
  - @object-ui/i18n@17.7.0
  - @object-ui/components@17.7.0
  - @object-ui/fields@17.7.0

## 17.6.0

### Minor Changes

- a945271: `DatasetReportRenderer` no longer reads `filter` as an alias for `runtimeFilter`.
  
  `filter` is not an authorable key. `ReportSchema` in `@objectstack/spec` (17.0.0)
  is `z.core.$strict` and rejects it outright, going out of its way to name the
  replacement: ``Unrecognized key(s) on this report: `filter`. Did you mean
  `filter` → `runtimeFilter`?`` The renderer accepted the rejected spelling anyway,
  at two sites — the report-level `report.runtimeFilter ?? report.filter` and the
  per-joined-block `block.runtimeFilter ?? block.filter`. Metadata that could not
  be authored through the validated path still rendered when it arrived by some
  other route, so the strictness the spec promises was not the strictness the
  runtime enforced. It matters most for AI-authored metadata: a generator emitting
  `filter` got a working report from this renderer and a hard validation failure
  from anything that parsed the document first, and which one the author met was a
  function of which path the document travelled.
  
  **Behaviour change — read this if you store report documents.** A stored document
  still carrying `filter` no longer has that filter applied: it renders
  **unfiltered**, showing rows the report was scoped to exclude. Server-side
  permissions are unaffected and still apply, so this is not an access-control
  change — it is a report showing more rows than its author intended. Scored
  `minor` per this repo's version policy (AGENTS.md §版本号策略), which reserves
  `major` for the synchronized `@objectstack` major bump; the narrowing is
  described here rather than encoded in the number.
  
  Because rendering unfiltered *in silence* would be worse than an error, the
  dropped key is not silent. When a document carrying `filter` reaches the
  renderer, a dev-mode warning fires once per offending report or block, naming the
  key, quoting the spec's own rename hint verbatim (so an author meets one message
  rather than two dialects of one message), and stating that no filter was applied.
  It is a no-op under `NODE_ENV=production` and changes no types.
  
  Fix your documents by renaming `filter` to `runtimeFilter` — the key the schema
  actually declares, and the one the suggestion has always pointed at. Reports that
  already author `runtimeFilter`, and hosts that pass the `runtimeFilter` prop, are
  entirely unaffected.

### Patch Changes

- cb5a7de: A report's embedded chart now paints its category dimension's own option colours and renders ordered-sequence charts (funnel/pyramid) in the field's declared picklist order — the same two derivations a dashboard chart has always gotten for the identical dimension (objectui#4906).
  
  `DatasetReportChart` (`DatasetReportRenderer.tsx`) resolved its dimension's option **labels** but called neither `buildOptionColorMap` nor `buildCategoryOrder` — the two `@object-ui/core` helpers `DatasetWidget` (plugin-dashboard) already runs off the same resolved field metadata. The chart forwarded only an author-supplied `colors` record (objectui#4877); with none authored it fell back to the positional palette, and a funnel's stages sorted by value instead of the declared pipeline.
  
  This is convergence onto an already-ruled behavior, not new capability: the report path now runs the identical `useDatasetDimensionMeta` → `localizeFieldOptions` → `buildOptionColorMap`/`buildCategoryOrder` chain the dashboard widget uses (framework#3588's declared-picklist-order ruling), reused rather than re-derived.
  
  **This visibly changes rendering for an existing report** that groups by a select/lookup dimension carrying option colours, or is declared on an ordered field:
  
  - a chart with no authored `colors` now paints each category in that dimension's own option colour (e.g. a `health` dimension now paints its own green/amber/red) instead of the renderer's positional palette;
  - a `funnel`/`pyramid` chart now orders its stages by the field's declared picklist order instead of sorting by value.
  
  Precedence is unchanged and preserved: an authored `colors` record (objectui#4877) still wins over the derived per-category map, merged UNDER it exactly as the dashboard already does — an author's explicit colour for a category is never overridden by the field's own.
- 0237208: docs(plugin-report): teach the dataset-bound report as the sole authoring shape
  
  `packages/plugin-report/README.md` and `content/docs/plugins/plugin-report.mdx`
  still taught the pre-9.0 query form (`objectName` + column-definition `columns` +
  `groupingsDown` / `groupingsAcross`) as the live way to write a report, and named
  three renderers plus `applyInMemoryAggregation` that were removed at the ADR-0021
  cutover. The current `ReportSchema` is strict and rejects that form outright, so
  every copyable example on both pages now authors the dataset-bound shape
  (`dataset` + `rows` / `columns` / `values`, `runtimeFilter`, `order`, `drilldown`,
  `chart`) through `defineReport`. Stored pre-9.0 documents keep one clearly
  labelled migration-only section describing the lossy bridge that renders them and
  the key-by-key direction of migration.
- 82a9417: docs(plugin-report): rewrite the README export snippets against the real export signatures
  
  The `### Export` and `### Live Export` snippets called every export function with
  the wrong arity or argument order. Every name was real, so the name-set check
  could not see it — only the calls were wrong:
  
  - The six format exporters are `(report: ReportComponentSchema, data: any[], config?: ReportExportConfig): void`.
    The README called them `(data, filename)`, so a filename string landed in the
    `data` slot the engine iterates as rows, and there is no filename parameter at
    all — the download name comes from `config.filename`, else `report.title`. All
    five are synchronous `void`, so the snippet's `await` was inert.
    `exportReport` takes the format **first**, which no snippet showed.
  - `exportWithLiveData(report, options)` requires `dataSource` and `resource` in
    `LiveExportOptions`; the README passed only `{ format: 'pdf' }`.
  - `exportExcelWithFormulas(report, data, options)` takes three parameters; the
    README passed two, and spelled the column key `field` where `ExcelColumnConfig`
    has the required `name` and `header`. Formula templates use the `{ROW}`
    placeholder, which the old `SUM(B2:B100)` never exercised.
  
  The rewritten blocks are the exporters' own (correct) JSDoc examples, and each
  one now compiles against the package's built `dist/index.d.ts`. Docs only — no
  API, export surface or runtime behaviour changed.
- f331f5a: Docs only: `packages/plugin-report/README.md` no longer teaches three exports the
  package does not have (objectui#5016). Each was judged individually against the
  entry module's export surface, and all three turned out to be **survivors of the
  9.0 cutover** rather than renames — `CHANGELOG.md` records `ReportBuilder`,
  `ScheduleConfig` and the drill helpers as removed with the pre-9.0 query-form
  renderers, and the README kept teaching them afterwards:
  
  - **`ReportBuilder`** — taught as the main editor component. Removed; there is no
    authoring component in this package. The Quick Start now teaches the real ones,
    with their real signatures: `ReportRenderer` (the dispatcher, which takes the
    report as `schema`), `DatasetReportRenderer` (which takes it as `report`), and
    `ReportViewer` — whose props are `{ schema, onRefresh }`, so the old
    `< ReportViewer report={…} showToolbar />` would not have compiled either.
    `report` / `showToolbar` are keys inside a `ReportViewerSchema`.
  - **`registerDrillHandler(actionRunner, …)`** — taught as the drill registration
    call. Removed, and its mechanism no longer exists: drill-down is now a host
    callback, `onDrill?: (args: DatasetDrillArgs) => void`, and the host owns
    navigation because the renderer only knows dimension names (ADR-0021 D2). The
    section is rewritten around what a click actually emits, including why
    `objectFilter` (raw stored values) is what filters select/lookup dimensions
    correctly where a display-label `groupKey` would not.
  - **`ScheduleConfig`** — taught as a configuration component. Removed. A schedule
    is *data* on the report schema: `ReportComponentSchema.schedule`, typed
    `ReportScheduleConfig`. Both types live in `@object-ui/types` and are not
    re-exported here, so the corrected snippet imports them from there —
    `createScheduleTrigger` is the real export, and its real signature takes
    `(report, dataSource, resource, onComplete)` and returns
    `() => Promise< LiveExportResult[] >`, not the single callback the old snippet
    passed.
  
  Two further leftovers of the same removal are corrected: the stale survivor
  sentence that listed `ReportBuilder` as still available, and the schema-driven
  example's `"type": "report-builder"`, which no component registers — the
  registered types are `report`, `spec-report` and `report-viewer`, now listed
  explicitly. The two feature bullets asserting the removed mechanisms (a
  `useReportData()` query pipeline, an `ActionRunner`-dispatched `drill` action)
  state the dataset-bound path instead.
  
  No code, types or runtime behaviour change — the diff is one README and this
  changeset. The correction reaches npm with the package's next publish, which is
  why it declares a patch: `README.md` is in the package's published `files`.
- 5ffcc14: fix(plugin-report): forward the chart chrome and series presentation `ReportChartSchema` declares (objectui#4877)
  
  A report's embedded chart forwarded exactly six keys to the registered chart
  component — `chartType`, `data`, `height`, `isAnimationActive`, `series`,
  `xAxisKey`. Everything else `ReportChartSchema` declares as authorable never
  left the report renderer, so it was inert metadata: the author writes it, the
  schema accepts it, nothing reads it.
  
  `showLegend` was the sharpest case because dropping it does not merely ignore
  the author, it INVERTS them: `AdvancedChartImpl` computes
  `legendVisible = showLegend !== false`, so an absent value means the legend is
  on and an explicit `showLegend: false` still drew one.
  
  Now lowered, under objectui#4229's ruled data/presentation split:
  
  - chrome — `showLegend`, `showDataLabels`, `colors` (both the positional-palette
    array and the per-category record), `subtitle`, `description`, `annotations`,
    `interaction`, `height`;
  - per-series presentation — `color`, `stack`, `type`, `yAxis`, `dashArray`,
    `opacity`, `variant`, matched by `series[].name` so series MEMBERSHIP stays
    with the dataset.
  
  `title` is deliberately not forwarded: the report renderer paints it as its own
  heading above the plot, and forwarding it would draw a second one inside the
  chart's frame. `aria` is not lowered either — nothing on this path reads it
  (`AdvancedChartImpl` has no `aria` prop, and this renderer hands the component a
  schema directly rather than through `SchemaRenderer`'s flat ARIA injection), so
  forwarding it would move declared-but-unread one layer down.
  
  The two helpers (`chartConfigPresentation`, `mergeAuthoredPresentation`) moved
  from `plugin-dashboard`'s `DatasetWidget` to `@object-ui/core` beside
  `buildChartSeries`, the derivation they merge onto, so both surfaces lower one
  vocabulary once instead of keeping a second copy (the duplication objectui#4389
  filed as a defect). `@object-ui/core` additionally exports `mergeAuthoredSeries`
  — the series merge alone — for a surface whose axes are bare dimension/measure
  NAME strings rather than spec `ChartAxis` objects, which is what a report chart
  declares. `DatasetWidget` re-exports both names, so its public surface and its
  rendering are unchanged.
- 6bb39c4: 报表内嵌图表的度量显示名按三级回落解析，不再直接印原始 `name`
  
  数据集绑定的 report chart 此前把度量原样交给图表组件（`series: [{ dataKey }]`，无 label），
  于是图例、标记 tooltip 与单值卡片的说明文字都落回 dataKey——在全中文控制台上打出
  `potential_upside_tons`，而同一张报表下方的汇总表、以及绑定同一数据集的 dashboard 图表
  都能正确解析出授权 `label`。`ReportChartSchema` 自 rc.1 起声明的 `series[].label` 也从未
  被读取，作者因此没有任何可授权的手段控制这个字符串。
  
  现按三级回落解析，与汇总表和 dashboard 的既有口径对齐：
  
  1. `chart.series[]` 中 `name` 命中该度量的条目的 `label`（spec 的 `I18nLabel`，按控制台
     语言解析；同名重复以第一条为准）；
  2. 绑定数据集的度量 `label`（结果字段的 `label`，即汇总表表头一直在读的同一个值）；
  3. 度量 `name` 兜底。
  
  图例与 tooltip 同源同修：`ChartRenderer` 把 series 的 `label` 写进 `config[dataKey].label`，
  三处读的是同一个输入。单值族（`metric`/`kpi`/`gauge`）的说明文字与系列图共用这一次解析。
- 5ffcc14: fix(plugin-report): route a report's embedded chart through `buildChartSeries` so a NULL category is bucketed (objectui#4878)
  
  `DatasetReportChart` built its rows as `relabelDimensions(state.rows, …)` and
  handed them to the registered chart component verbatim. Nothing on that path
  bucketed a null dimension value, so a report chart passed the renderer a null
  category — the exact input objectui#4466 measured as drawing **no mark at all**.
  The cost is not an empty chart but a quietly wrong one: the null group vanishes
  while the y-axis scale still accommodates it, so the chart reads as valid data.
  
  The dashboard and chart-view surfaces never had the defect because they route
  through `buildChartSeries` (`@object-ui/core`), where the whole null-category
  family was fixed. The report chart now routes through it too, so those
  properties are INHERITED rather than re-derived on a third surface:
  
  - the null bucket itself (objectui#4466);
  - its label read from the locale bundle at the call site — `@object-ui/core` is
    React-free, so a zh console would otherwise draw the bar and label it `(None)`
    (objectui#4500);
  - bucket IDENTITY separate from the bucket label, so a stored value that
    literally spells `(None)` stays a different group (objectui#4508).
  
  objectui#4020's three-level measure display name still outranks the label the
  derivation assigns, including for an `{ en, 'zh-CN' }` label record: core holds
  no i18n provider and picks first-string-wins, which is exactly the defect class
  #4020 closed.
  
  A report whose chart has no null group is unchanged, byte for byte.
- Updated dependencies [88085e3]
- Updated dependencies [69251bf]
- Updated dependencies [57e668f]
- Updated dependencies [516663d]
- Updated dependencies [41ac1b7]
- Updated dependencies [1eaf0a1]
- Updated dependencies [a09bc33]
- Updated dependencies [feb6b16]
- Updated dependencies [460c4d0]
- Updated dependencies [0ae27f7]
- Updated dependencies [9aecabe]
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
- Updated dependencies [65e88e6]
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
- Updated dependencies [375efb4]
- Updated dependencies [af5e292]
- Updated dependencies [3fbbea1]
- Updated dependencies [0bffb18]
- Updated dependencies [3e0214c]
- Updated dependencies [800f455]
- Updated dependencies [dbbd38a]
- Updated dependencies [27c9cbd]
- Updated dependencies [5458414]
- Updated dependencies [3241559]
- Updated dependencies [7f96b10]
- Updated dependencies [167ec42]
- Updated dependencies [616a2a5]
- Updated dependencies [6c68b13]
- Updated dependencies [0046d8f]
- Updated dependencies [f1d4748]
- Updated dependencies [bea374e]
- Updated dependencies [b1119ec]
- Updated dependencies [5607092]
- Updated dependencies [9f23d2b]
- Updated dependencies [b4089be]
- Updated dependencies [578e025]
- Updated dependencies [b4bccc7]
- Updated dependencies [af025ee]
- Updated dependencies [d109a4d]
- Updated dependencies [598c89a]
- Updated dependencies [4a0bd17]
- Updated dependencies [b8b9af4]
- Updated dependencies [31676be]
- Updated dependencies [8c0d52e]
- Updated dependencies [b29488f]
- Updated dependencies [9fbb9b5]
- Updated dependencies [90517e1]
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
- Updated dependencies [e7747f1]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [ac2f332]
- Updated dependencies [a777058]
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
- Updated dependencies [2165d88]
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
  - @object-ui/fields@17.6.0
  - @object-ui/i18n@17.6.0
  - @object-ui/react@17.6.0
  - @object-ui/plugin-grid@17.6.0
  - @object-ui/components@17.6.0
  - @object-ui/core@17.6.0

## 17.5.0

### Patch Changes

- ee26e65: Analytics: the dimension label net's fetch-and-memo glue is written once, not once per surface

  PR #4388 (objectui#4330) put the same React glue on two surfaces — the dashboard's `DatasetWidget` and plugin-report's dataset block. The resolution RULES were never duplicated (both call the same `@object-ui/core` helpers), but the wiring around them was: read the object schema through the host's authenticated `apiFetch`, keep the fetched metadata locale-free in state, derive the label maps in a render memo. Two copies meant two statements of the same two bug fixes, which is a drift surface rather than a defect — nothing a user could hit today, filed as objectui#4389 so it was retired deliberately.

  It is now split along the layer that can actually hold each half. `@object-ui/core` gains the React-free parts — `loadDimensionFieldMeta` (the base-object read composed with the dimension walk), `deriveDimensionLabelMaps` (the locale-applying derivation) and `dimensionOptionTranslator` (binding the bundle resolver to the object that OWNS a terminal field, which for a dotted path is the relationship target). `@object-ui/react` gains `useDatasetDimensionLabels` / `useDatasetDimensionMeta`, the React wiring that cannot live in core, beside the `useViewData` / `useElementDataSource` / `useDiscovery` hooks that already read `SchemaRendererContext` the same way. Both plugins consume it; the dashboard keeps its chart-only per-category colour and category-order derivation layered locally, since a table renders no palette.

  The card originally proposed `@object-ui/core` as the whole glue's home. That home was disproven by measurement and retired in the card's PM RULING #2: `SchemaRendererContext` is defined in `@object-ui/react`, which depends on core, so core importing it back is a cycle — and core is React-free by declaration, by content, and by the topology in AGENTS.md. objectui#3367 had already ruled this direction for the same family (core-canonical logic, react re-exports).

  Behaviour is unchanged by construction: same read count, same best-effort fallback, same memoization boundary. The two bug fixes are now stated once and pinned at the shared hook — the read rides the host's authenticated `apiFetch` (objectui#4121, pinned by asserting that a new channel re-issues the read, i.e. that it really is in the effect's deps), and the fetched metadata stays locale-free (objectui#4030 / PR #4324, pinned by switching language at runtime and asserting the labels flip with no second metadata read). All 39 assertions PR #4388 landed across both surfaces pass unchanged, and their files are byte-identical to before.

- 326a70f: Analytics: a LOCAL select dimension on a table / pivot widget — and on a dataset-bound report — now renders its option label through the locale bundle

  A dashboard table grouped by a select field showed `Domestic` on a zh-CN console while the related list on the same screen showed 国内. The value was never untranslated by accident: the server resolves that dimension's display label (ADR-0021) and hands the row over carrying the object's AUTHORED English label. The locale bundle is keyed by the option's stored VALUE (`{ns}.fieldOptions.<object>.<field>.<value>`), so translating one needs the option LIST — and the table path deliberately loaded no object metadata at all, which is why objectui#4030 / PR #4324 fixed charts and dotted dimensions and left this half open.

  Table, pivot and the dataset report block now take the one metadata read that gives the bundle something to translate against, and feed it to the SAME seam #4324 landed (`resolveDimensionFieldMeta` → `localizeFieldOptions` / `buildDimensionLabelMap` → `relabelDimensions`). No second resolution dialect: the map carries both the stored value and the authored label as keys, and the relabel is value-wise and idempotent, so a value the server already resolved lands on the same display it would have from the raw value. Cells, pivot headers on both axes, the server's marginal totals, the CSV export and a report's embedded chart all read the one map, which is what keeps a subtotal's bucket lookup meeting the header it belongs to.

  Untranslated apps are unchanged by construction: with no bundle entry the display equals the authored label, no key is emitted, and the rows come back by identity. Identity keys stay untranslated — a drilled row or cell still filters records by the values the server sent, and measures still export as bare numbers.

  This deliberately amends the acceptance boundary objectui#4263 landed ("a local-only table issues no metadata read"), which was ruled for label RESOLUTION before the read had a second consumer. The pins that stated it are rewritten in place, in the same change, and say so.

- 49ae9f4: Pivot buckets encode an empty dimension value as JSON `null`, so it no longer collides with a row whose value is literally the placeholder character

  objectstack#5473 / objectstack#5665 replaced the pivot's delimiter-joined ids
  with `JSON.stringify`, because every delimiter that had been tried — an empty
  string, a plain space, a control character — assumed the data would not contain
  it, and each assumption failed on ordinary data. This closes the last place the
  same assumption survived: the ids were JSON, but the VALUES fed into them were
  spelled `String(row[d] ?? '∅')`, so an absent dimension value became the
  ordinary string `"∅"` and shared a bucket with a row whose value literally is
  that character (U+2205). One bucket, later row overwriting the earlier one — the
  cell showed a different row's measure, the overwritten row was unreachable, and
  drill-through followed the same wrong index into the wrong records, all without
  an error. The trigger requires that character to appear as a dimension value, so
  this is the assumption being removed rather than a defect users hit today.

  An empty value now encodes as JSON `null`, which `JSON.stringify` renders as a
  bare `null` that no string can spell. The normalization lives in
  `@object-ui/core` as `pivotDimensionValue` (absent ⇒ `null`, everything else ⇒
  its string form) rather than at each call site, because a placeholder spelled by
  a caller is a placeholder that can collide again — which is exactly how this one
  survived the previous fix. `pivotBucketId` accepts `Array<string | null>`
  accordingly; that is a widening, so existing callers passing `string[]` are
  unaffected.

  Both renderers' bucket keys move together, which the fix requires: a bucket id
  and the subtotal map keyed by it are built from the same expression, so changing
  one alone would split the headers while the subtotal map still merged, landing
  every column subtotal under the wrong header. In `plugin-dashboard`'s
  `DatasetWidget` that is the row bucket id, the column bucket id, the cell key,
  and both the `rowTotalById` and `colTotalById` lookups; in `plugin-report`'s
  `DatasetReportRenderer` the single `bucketId` helper already feeds all five.

  The dashboard's column bucket id also stops being a bare string and becomes a
  one-element tuple through the same shared encoder. It was the one id in the
  family still built by hand, on the reasoning that a single value needs no
  boundary — true of the boundary, false of everything else the encoder does, and
  it is why the across axis kept carrying this collision after the row ids were
  fixed.

  No display change: these placeholders only ever entered ids, never labels. An
  unset dimension still renders through `formatDimensionValue` exactly as before,
  and data containing neither an absent value nor that character buckets
  identically — the ids are opaque lookup keys, never parsed back into a value,
  never shown, never persisted.

- cb315f2: Report and dataset-preview measures follow the display locale (objectui#4575)

  objectui#4566 gave `formatMeasure` / `formatDimensionValue` in `@object-ui/core`
  an optional trailing `locale` and threaded `useDisplayLocale()` through the
  dashboard's `DatasetWidget`. The parameter is OPTIONAL by design, so the
  producer could land without dragging every consumer with it — which left the
  consumers it did not reach still formatting in the MACHINE's locale. A German
  session read a report measure as `1,234.5` directly beside a dashboard measure
  that, after #4566, rendered `1.234,5`: one number, two spellings, on the same
  screen. That is a sharper inconsistency than the one before #4566, when both
  surfaces were uniformly wrong.

  The remaining thirteen call sites now thread `useDisplayLocale()`:

  - `plugin-report`'s `DatasetReportRenderer` (ten) — the grouped table's measure,
    dimension and grand-total cells, the embedded single-value chart's metric, and
    the cross-tab's across-axis header, down-axis cell, measure cell, row total,
    column total and grand total;
  - `app-shell`'s metadata-admin `DatasetPreview` (two) — the preview table's
    measure and dimension cells;
  - `app-shell`'s `DatasetDefaultInspector` (one) — the measure format-hint
    sample, which is a preview of authored formatting and so has to be rendered
    through the channel it previews.

  **English output does not move**, and that is the discriminator against the
  sibling fix. These sites already went through `Intl` with default grouping, so
  the only thing that changes is WHOSE locale is used — contrast objectui#4553,
  where `formatPercent` had never grouped at all and moving en `1235%` to
  `1,235%` WAS the fix. Every new case pins the same value in de AND in en, so
  at least one half must fail on any runner: before the change both render in the
  machine's locale, which is what makes the machine locale stop being a test
  input.

  Two details worth recording:

  - **The cross-tab's header labels are built inside a `useMemo`**, so the locale
    joins that dependency array. Threading it into the call alone would leave the
    headers frozen in whatever locale they were first built with — measured, and
    pinned by a case that changes only the locale and asserts the header
    re-labels. Removing just the dependency entry turns exactly that one case red
    and leaves the other nine green.
  - **The metadata designer's `locale` prop is deliberately not used.** It carries
    the designer's own chrome language (`useMetadataLocale()`, which resolves to
    exactly `en-US` or `zh-CN`), not a number-formatting locale — a German session
    gets `en-US` from it. The preview's numbers have to match what the report and
    dashboard render for the same dataset, which is `useDisplayLocale()`.

  Both packages are `patch`: their published declarations are unchanged (measured
  against the built `.d.ts` with `dist/` cleared between builds). The threading is
  module-local, and the one signature that gained a parameter — the file-local
  `bucketLabel` helper — is not exported.

  A side effect of the fallback: these surfaces are now DETERMINISTIC where they
  previously followed whatever locale the machine happened to run in.
  `useDisplayLocale` ends at a concrete `'en'` rather than the `undefined` that
  hands `Intl` the machine's locale.

- 3f5f87c: `SchemaRenderer` states its real contract — a typed, required `schema` and a deliberate forwarding surface

  `SchemaRenderer` is the renderer loop: every registered SDUI component is rendered through it. It handed `forwardRef` a props type of `{ schema: SchemaNode } & Record<string, any>`, which puts `string` into `keyof Props`, so `'ref' extends keyof Props` was always true, React's `PropsWithoutRef` took its `Omit` branch, and `Omit` over a type carrying a string index signature keeps only the index signature. Every declared prop was erased. Measured on the pre-fix source: `keyof ComponentProps<typeof SchemaRenderer>` was `string` and `ComponentProps<typeof SchemaRenderer>['schema']` was `any`, while the type argument went on declaring `SchemaNode`. The other half is the same defect seen from the call site — `<SchemaRenderer />` with no schema at all, `<SchemaRenderer schema={12345} />`, and an arbitrary misspelled prop each type-checked in silence. This is objectui#4422 / PR #4438's trap in the most central component in the repo, spelled `Record<string, any>` rather than `[key: string]: any`, which is why every previous sweep's grep and both shipped guards' detector reported the site as clean.

  Graded **minor, not major**, on objectui#4528's reasoning: the type argument has always DECLARED `schema`; the index signature erased it from the resolved type, and restoring what the declaration documents is a fix to the published contract rather than a contract break.

  **The forwarding surface is kept, deliberately.** This component forwards every prop it does not read to the component the schema names, resolved at runtime from a plugin-extensible registry — `packages/react/README.md` documents exactly that, and `@object-ui/components`' form renderer consumes the `onSubmit` it shows being forwarded. Closing that surface would state a false contract and would force every leaf plugin's props into this package. So the two halves are separated: the `forwardRef` type argument is the honest `SchemaRendererProps`, with no index signature for `PropsWithoutRef` to collapse, and the open surface is stated once in an explicit export annotation, which nothing routes through `Omit`. The published `.d.ts` shows the erasure disappearing: `ForwardRefExoticComponent<Omit<{ schema: SchemaNode } & Record<string, any>, "ref"> & RefAttributes<any>>` becomes `ForwardRefExoticComponent<SchemaRendererProps & Record<string, any> & RefAttributes<any>>`.

  `SchemaRendererProps.schema` is declared as `BaseSchema | string | null | undefined` — what this component actually handles. It previously declared `@object-ui/core`'s `SchemaNode` interface, which requires `type: string` and so contradicted the component's own early returns for strings and nullish, while every caller held `@object-ui/types`' wider union. The erasure hid that mismatch completely.

  **One declared behaviour change.** A non-object, non-string primitive schema now renders as its own text. It previously fell through to the shallow copy `{ ...schema }`, which spreads a primitive to an empty object, lost the `type` the renderer then looked up, and surfaced the red "Unknown component type: undefined" box — an accident of the spread rather than a decision. The declared props type excludes `number` / `boolean` so no author is invited to pass them; the runtime handling is defence-in-depth for untyped callers and stored metadata. Strings, `null`, `undefined`, `0` and `false` render exactly as before, and an object naming an unregistered type still gets the error box; all four are pinned.

  Latent defects the erasure had been hiding, each surfaced by the repo-wide type-check and fixed at its call site: `DashboardRenderer` cast its widget schema to `Record<string, any>`, dropping the `type` every branch of `getComponentSchema` sets; `DashboardGridLayout`'s equivalent now states its return type instead of inferring a union that admitted a shape with no `type`; and `ReportViewer` handed a section's `content` array to the renderer whole, so a multi-node section rendered the unknown-component box instead of its content — arrays are mapped rather than widened into the renderer's declared input.

  A repo-wide structural guard replaces the two per-package siblings' blocked direction: it judges every `forwardRef` in `packages/*/src` (219 sites) and its detector resolves `Record<string, …>` and `string`-keyed mapped types in addition to literal index signatures — the spelling the previous detector went blind on. It judges the type argument only, where an index signature is an accidental eraser, and never an export annotation, where one is a stated contract.

- 31ab1ac: fix(print): `window.print()` produces a usable page, and the Print buttons say what they do

  The list, report and dashboard Print controls were bare `window.print()` calls with no
  print stylesheet, so the browser printed the whole console — sidebar, top bar, chat rail,
  toasts — with the data table clipped to a single viewport. With no label to the contrary
  they were being accepted against "export to PDF" requirements, which they have never been.

  - `@object-ui/app-shell/styles.css` gains a shared `@media print` block: it hides the shell
    chrome, prints the active content area full-width, releases the viewport-height flex chain
    so long tables paginate instead of clipping, repeats table headers on every sheet, and
    neutralises dark mode (which otherwise prints white-on-white). One sheet serves list,
    report and dashboard.
  - The list and report Print buttons carry a tooltip and accessible name stating that they
    open the browser's own print dialog and are not a PDF export (new `common.printDialogHint`,
    translated in all ten locale packs).
  - The dashboard's `export_dashboard_pdf` action no longer toasts "Preparing PDF export…" —
    it names the print dialog it actually opens (`dashboardActions.pdfPreparing` is replaced by
    `dashboardActions.printDialogOpening`).

  No control was removed and no headless detection was added. A real print/PDF primitive
  remains out of scope (`objectstack-ai/objectstack#1301`, closed NOT_PLANNED).

- Updated dependencies [0e67b53]
- Updated dependencies [ceccdcf]
- Updated dependencies [d6e5124]
- Updated dependencies [debad27]
- Updated dependencies [dc2aa3e]
- Updated dependencies [ee66e2e]
- Updated dependencies [e2e6360]
- Updated dependencies [ee26e65]
- Updated dependencies [5900ac5]
- Updated dependencies [932cbcd]
- Updated dependencies [734d186]
- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [8f85f8b]
- Updated dependencies [7ffd616]
- Updated dependencies [d0c3b26]
- Updated dependencies [3fc2971]
- Updated dependencies [aca27fa]
- Updated dependencies [dde7283]
- Updated dependencies [f7c6430]
- Updated dependencies [4dadf0d]
- Updated dependencies [ae10a01]
- Updated dependencies [77d6f28]
- Updated dependencies [0f21348]
- Updated dependencies [d2e2caf]
- Updated dependencies [92876f0]
- Updated dependencies [f279deb]
- Updated dependencies [4b70d28]
- Updated dependencies [eb7f586]
- Updated dependencies [e901131]
- Updated dependencies [ebb4e0e]
- Updated dependencies [3a9021e]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [613b167]
- Updated dependencies [b4d3c22]
- Updated dependencies [1f9b905]
- Updated dependencies [8f60d73]
- Updated dependencies [cb13400]
- Updated dependencies [828549a]
- Updated dependencies [e1ade8f]
- Updated dependencies [bc64bfe]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [51ab34e]
- Updated dependencies [24bb2de]
- Updated dependencies [0ca6096]
- Updated dependencies [3e19fe7]
- Updated dependencies [bb58d1d]
- Updated dependencies [433ff9f]
- Updated dependencies [5cc847c]
- Updated dependencies [e7663f2]
- Updated dependencies [fa21254]
- Updated dependencies [f565418]
- Updated dependencies [33c32bf]
- Updated dependencies [66fb4fa]
- Updated dependencies [b953a97]
- Updated dependencies [d7f3e30]
- Updated dependencies [6d641c9]
- Updated dependencies [7e4f0e5]
- Updated dependencies [a84385b]
- Updated dependencies [45e1949]
- Updated dependencies [51ac39f]
- Updated dependencies [5e514c4]
- Updated dependencies [92250d6]
- Updated dependencies [c1d939f]
- Updated dependencies [58bebf6]
- Updated dependencies [36310dc]
- Updated dependencies [52d878a]
- Updated dependencies [405e808]
- Updated dependencies [49ae9f4]
- Updated dependencies [a3ae404]
- Updated dependencies [4270c11]
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
  - @object-ui/fields@17.5.0
  - @object-ui/types@17.5.0
  - @object-ui/plugin-grid@17.5.0

## 17.4.0

### Patch Changes

- 3b1f888: Accept React 19 in `@object-ui/plugin-report`'s peer range, the last UI package still declaring React 18 alone (objectui#3690).

  `peerDependencies.react` and `peerDependencies.react-dom` widen from `^18.0.0` to `^18.0.0 || ^19.0.0`, matching the other 29 packages in the fixed version group. With npm 7+ resolving peers strictly, a React 19 consumer installing this published package hit an `ERESOLVE` on first install while every sibling installed clean — and the package's own README already documented the wider range, so the manifest was the half that was wrong.

  The narrow range was never a constraint anyone stated. `packages/plugin-report/package.json` was hand-authored on 2026-02-06 (`1e557cbda`), by which point nineteen sibling packages already carried `^18.0.0 || ^19.0.0` and every package created afterwards was born with it; the one other package born narrow, `plugin-dashboard`, was corrected on 2026-05-08 (`d2b6ecec6`) in a build fix that touched only itself. No commit in the file's 172-commit history ever revisited the peer line, and no commit message mentions a React 18 requirement.

  Nothing in the package needs React 18. Its entire React surface is `React.FC`, `useState`, `useEffect`, `useMemo`, `useReducer`, `useContext`, `Fragment`, `ComponentType`, `CSSProperties` and `ReactNode` — all unchanged in React 19 — with zero uses of anything React 19 removed (`ReactDOM.render`, `unmountComponentAtNode`, `findDOMNode`, legacy context, string refs, `defaultProps` / `propTypes` on function components, `createFactory`, `useFormState`, `react-dom/test-utils`). `react-dom` is not imported by the source at all; it appears only as a UMD global name in the Vite externals config. The workspace pins `react` to 19.2.8 via a root `pnpm.overrides`, so this package's 78 tests have been running against React 19 the whole time it declared it did not support it.

- Updated dependencies [794c497]
- Updated dependencies [993336f]
- Updated dependencies [f0a625a]
- Updated dependencies [b5980f4]
- Updated dependencies [8aad9fd]
- Updated dependencies [6719877]
- Updated dependencies [56ff091]
- Updated dependencies [0186cdc]
- Updated dependencies [7864f03]
- Updated dependencies [ea41a59]
- Updated dependencies [0cbdca8]
- Updated dependencies [d229dfa]
- Updated dependencies [18c42c6]
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
- Updated dependencies [65bb513]
- Updated dependencies [c97a45e]
- Updated dependencies [b19162d]
- Updated dependencies [c2fd122]
- Updated dependencies [1bd6faa]
- Updated dependencies [9154d9e]
- Updated dependencies [ac2139c]
- Updated dependencies [b14ab3a]
- Updated dependencies [e24d767]
- Updated dependencies [8c60819]
- Updated dependencies [aca561a]
- Updated dependencies [e64a52e]
- Updated dependencies [844d17f]
- Updated dependencies [d8a0be4]
- Updated dependencies [48132f7]
- Updated dependencies [4dcd52a]
- Updated dependencies [42ae5c6]
- Updated dependencies [0ef9dfd]
- Updated dependencies [f4b97c8]
- Updated dependencies [1d723e3]
- Updated dependencies [0109f54]
- Updated dependencies [7e5bb5d]
- Updated dependencies [fbc23e0]
- Updated dependencies [6d762da]
- Updated dependencies [e6fdbdc]
- Updated dependencies [54233b1]
- Updated dependencies [c2ecbae]
- Updated dependencies [f9faa7d]
- Updated dependencies [97b63d7]
- Updated dependencies [14c59c0]
- Updated dependencies [aeb8424]
- Updated dependencies [6bb454a]
- Updated dependencies [1a33b1a]
- Updated dependencies [11c1e71]
- Updated dependencies [523be48]
- Updated dependencies [7e2b7e9]
- Updated dependencies [33526fd]
- Updated dependencies [32413ec]
- Updated dependencies [c1e1e6b]
  - @object-ui/components@17.4.0
  - @object-ui/react@17.4.0
  - @object-ui/core@17.4.0
  - @object-ui/fields@17.4.0
  - @object-ui/i18n@17.4.0
  - @object-ui/types@17.4.0
  - @object-ui/plugin-grid@17.4.0

## 17.3.0

### Patch Changes

- 509104a: Fix matrix report cells showing another bucket's numbers when dimension values run together.

  The cross-tab in `DatasetReportRenderer` built its bucket ids by joining dimension values with the EMPTY string, so adjacent values had no boundary at all: `"x"` + `"yz"` and `"xy"` + `"z"` were the same bucket on both axes, and the later row silently overwrote the earlier one. Its cell key then joined the two bucket ids with a plain space, while dimension values contain spaces constantly ("New York", "In Progress"), so `"New"` × `"York Q1"` and `"New York"` × `"Q1"` also met in one key. A merged bucket showed a different row's measure, the overwritten row's value was unreachable, the per-row and per-column subtotals matched the wrong header, and drill-through followed the same wrong index into another record's list — none of it with an error.

  Bucket ids and cell keys are now encoded with `JSON.stringify`, which carries the boundary in its own quoting rather than in a character the data is assumed never to contain. All four lookups in the renderer (row headers, column headers, row subtotals, column subtotals) share the one encoder, so they agree by construction.

  The encoders moved to `@object-ui/core` as `pivotBucketId` / `pivotCellKey` and are now shared with the dashboard `DatasetWidget`, which carried the same defect and fixed it separately: two packages each hand-rolling the same key is why one fix left the other broken. The dashboard keeps its existing exports and behaviour.

- Updated dependencies [18cd432]
- Updated dependencies [b7165ce]
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
- Updated dependencies [19b8c9b]
- Updated dependencies [56409c2]
- Updated dependencies [042e09d]
- Updated dependencies [7d08c3f]
- Updated dependencies [9cbcbf4]
- Updated dependencies [85c4c9c]
- Updated dependencies [fd54c3e]
- Updated dependencies [4eeb932]
- Updated dependencies [6fe485b]
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
- Updated dependencies [34d9169]
- Updated dependencies [5881a2c]
- Updated dependencies [9bc3709]
- Updated dependencies [f833d3a]
- Updated dependencies [30ae33a]
- Updated dependencies [a6ec93d]
- Updated dependencies [2a9513d]
- Updated dependencies [49f7449]
- Updated dependencies [71be406]
- Updated dependencies [d22ae31]
- Updated dependencies [c7ed4c3]
- Updated dependencies [2409e1d]
- Updated dependencies [789fe3e]
- Updated dependencies [f789c3b]
- Updated dependencies [a321fa4]
- Updated dependencies [8d8094a]
  - @object-ui/core@17.3.0
  - @object-ui/fields@17.3.0
  - @object-ui/components@17.3.0
  - @object-ui/types@17.3.0
  - @object-ui/plugin-grid@17.3.0
  - @object-ui/i18n@17.3.0
  - @object-ui/react@17.3.0

## 17.2.0

### Patch Changes

- d9668a7: Honor the server's declared percent scale, so a ratio of exactly 1 renders as 100.0% (#3136)

  A dataset measure declared `format: '0.0%'` rendered every ratio below 1
  correctly and got the single most consequential one wrong: a rate of exactly
  `1` printed as **`1.0%`**. On an SLA / pass-rate dashboard that turns
  "everything met the SLA" into "1% met the SLA", on both surfaces the issue
  names — the KPI card and the dataset-bound table (they share `formatMeasure`).

  The cause was never a bad multiplier; it was a missing fact. `formatMeasure`
  scaled by magnitude — `percentDisplayValue` multiplies by 100 only strictly
  inside `(-1, 1)` — because the column arrived with a `%` format string and
  nothing saying what scale its numbers were on. That guess is undecidable at
  exactly 1, which is both a full-compliance ratio ("100%") and one percentage
  point ("1%"), and it resolved to the reading almost nobody means.

  The server now answers the question instead (framework: `percentScaleOf` +
  `AnalyticsResult.fields[].percentScale`, the sibling of the ADR-0053 currency
  chain): a `derived: { op: 'ratio' }` measure is a `fraction` by definition, and
  a measure over a `percent` field inherits that field's scale. `formatMeasure`
  takes the declared scale as a fourth argument and, when present, scales by it —
  `fraction` ×100, `whole` verbatim — instead of inspecting the value. Every
  dataset-bound call site passes the column's `percentScale`: the dashboard
  metric/table/pivot cells, the report renderer's cells, totals and KPI, and the
  dataset preview.

  `percentDisplayValue` is untouched and still the fallback for a column that
  arrives without the annotation (an older server, or a non-dataset percent cell
  in a list view), so nothing that renders correctly today changes.

- 022e4c3: Upgrade to `@objectstack/spec@17.0.0-rc.1`, stop offering the retired `wait` timeout fields (#3101), and route the newly-adopted `combo` chart type.

  **Breaking for authoring, and the reason to do it now**: the `wait` panel no longer offers
  `waitEventConfig.timeoutMs` or `.onTimeout`. Both are `retiredKey()` tombstones as of spec
  17.0.0-rc.1 (framework#4158), which means a value written there is **rejected at load** —
  so until this lands, Studio can produce flow metadata the author's own runtime refuses.
  That hazard opened the moment rc.1 published, independent of when this repo bumps.

  `wait` never had a timeout: `onTimeout` had zero readers, so neither `'fail'` nor
  `'continue'` ever happened, and `timeoutMs`'s only reader used it as the timer **duration**
  when `timerDuration` was absent. Use **Duration** — it accepts a bare number as
  milliseconds, making the old `timeoutMs: 60000` and `timerDuration: '60000'` the same wait.
  Stored flows are converted by framework's D2 conversion; the designer simply stops offering
  the entry. The two `zh` label overrides go with the fields.

  #3101 asked for this to ride along with the bump rather than land alone, and that is
  load-bearing: the sibling-block assertion is **bidirectional**, so deleting the fields
  against a spec that still declares them fails in the other direction.

  **`combo` is now a spec chart type** — the sole addition to `ChartTypeSchema` in rc.1 (19
  members → 20). It had been a renderer-local family the chart renderer derived from the
  series, so nothing classified it on the two surfaces that route a _spec_ chart type: a
  spec-valid `combo` fell through to the red "Unknown component type" panel on a dashboard
  and to the out-of-spec notice on a report. Both now route it
  (`widgetDispatch.SERIES_CHART_TYPES`, `planReportChart`). The renderer-local derivation
  stays — it is what makes an authored `type: 'combo'` render rather than merely validate.

  **Retired spec exports this repo bound to**, all removed upstream in spec 17.0.0:

  - `JoinStrategy` / `WindowFunction` (framework#4286 tombstoned `query.joins` and
    `query.windowFunctions`: no engine or driver ever read either on the query path). They
    were derived off the spec enums under objectstack#4115's "come off the spec enum, not a
    restatement" rule; with no enum left, `data-protocol.ts` now restates the members locally
    — verbatim from the last spec that published them — as the objectui query-AST vocabulary
    they have become. The AST itself is unchanged.
  - `PerformanceConfig`, retired with `dashboard.performance` (framework#3896). Nothing bound
    to it — `@object-ui/react`'s `usePerformance` declares its own interface and is untouched.
    The dashboard form is derived from the spec's own `dashboardForm`, so the field
    disappears from the inspector for free; its test now pins the absence.

  **Three inverted pins fired, and are recorded rather than resolved.** objectstack#4171's
  tripwires asserted that `NavigationItem`, `FormField` and `ConditionalValidation`'s branches
  still erased to `any`/`unknown` upstream — the premise that justified objectui keeping local
  declarations. rc.1 types them properly, so the assertions are inverted to state the new
  fact. The burn-down each one asks for — deriving those types from the spec — touches
  widely-used public types and is deliberately **not** bundled into a version bump; it is
  tracked in #3177. `JoinNode`'s pin is gone outright: the symbol no longer exists.

  **What the bump arms.** The reconciliation ledger's `subflow` and `decision` panels
  feature-detect their spec exports and had never actually run — rc.0 predates the exports
  (framework#4278). They now execute and pass. The `script` panel's full bidirectional check
  stays deliberately skipped: rc.1 predates framework#4343, so the retired dispatch branches
  are still contract keys there, and only the "offers nothing the executor ignores" direction
  is meaningful. It arms itself on the next rc.

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
- Updated dependencies [4b470b9]
- Updated dependencies [785b8a5]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [4a51e77]
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
  - @object-ui/i18n@17.2.0
  - @object-ui/plugin-grid@17.2.0
  - @object-ui/fields@17.2.0

## 17.1.0

### Minor Changes

- 8529444: feat(report): carry a report's `order` into the dataset selection (framework#3916)

  `@objectstack/spec` 17 gave reports an ordering declaration — `ReportSchema.order`
  (and `blocks[].order` for a joined report): a list of `{ by, direction }` keys,
  most significant first. The framework executor applies it. `DatasetReportRenderer`
  built the selection it posts and never carried the declaration into it, so an
  authored `order` reached no query and did nothing.

  `useDatasetRows` — the single fetch choke point behind every report path — now
  takes the lowered ordering, and all four call sites supply it: the grouped table,
  the embedded chart, the matrix cross-tab, and each joined block.

  - **Lowering.** `readOrder()` turns the authored list into
    `DatasetSelection.order`, the array's element order becoming the object's key
    insertion order (which is how sort significance is expressed on the wire). It
    is permissive about its input, like the neighbouring `readNames()` — stored
    report JSON crosses the repo boundary and may lag the schema, so an entry with
    no usable `by` is dropped rather than thrown. An absent or entirely-unusable
    list yields `undefined`, so the field is OMITTED and the server's own defaults
    still apply: a selected time dimension comes back chronological with nothing
    declared.

    Kept local rather than importing spec's `reportSelectionOrder` — the pinned
    `^17.0.0-rc.0` predates that export. Swap it for the import on the next bump.

  - **Scoped per sub-selection.** A report's `order` is validated against its
    WHOLE selection, but this renderer issues narrower queries from it: the chart
    plots one dimension × one measure, and the flat-table path drops the matrix
    across-dimensions. The server rejects an order key naming nothing the
    selection projects (a deliberate 400), so forwarding the full list would turn
    a valid report into a failed chart. Keys outside a sub-selection are dropped
    at the choke point instead. Nothing is masked: the schema already validated
    every key against `rows` ∪ `columns` ∪ `values`, so the only keys that can be
    lost are ones the narrower query genuinely has no column for.

  - **Part of the refetch key.** The ordering changes the ROWS the server returns,
    not just their presentation, so it joins the `useDatasetRows` signature — an
    ordering edited from asc to desc refetches instead of re-rendering the stale
    grid.

  - **Matrix across-axis.** `colHeaders` are collected in row-arrival order, so
    ordering the rows by the across dimension is what makes the columns read
    left-to-right in that order. Ordering rides on the primary query only; the
    server drops it for the totals sub-queries by design.

  Ordering stays server-side throughout — never a client-side re-sort, which would
  order the page rather than the query and could not sort by a derived measure at
  all.

### Patch Changes

- Updated dependencies [62311b6]
- Updated dependencies [fc0272a]
- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [1cf0de7]
- Updated dependencies [752e18f]
- Updated dependencies [c785740]
- Updated dependencies [b41f401]
- Updated dependencies [5340879]
- Updated dependencies [19e9fa0]
- Updated dependencies [a149e90]
- Updated dependencies [d61efd1]
- Updated dependencies [95b7214]
- Updated dependencies [7d9734d]
- Updated dependencies [6ae818e]
- Updated dependencies [9eb932b]
- Updated dependencies [746dd00]
- Updated dependencies [aebfa4f]
- Updated dependencies [38ca8be]
- Updated dependencies [3cb9646]
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
- Updated dependencies [d21794c]
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
- Updated dependencies [aecc934]
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
- Updated dependencies [f8a95e5]
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
  - @object-ui/plugin-grid@17.1.0
  - @object-ui/react@17.1.0
  - @object-ui/types@17.1.0
  - @object-ui/i18n@17.1.0
  - @object-ui/fields@17.1.0

## 17.0.0

### Minor Changes

- 059a052: feat(report)!: drop `SpecReportColumn`/`SpecReportGrouping` re-exports + retire the legacy ReportViewer chart fallback (#3463)

  Cross-repo close-out of the ADR-0021 report cleanup (framework #3463). Upstream
  `@objectstack/spec` removed the dead `ReportColumnSchema` / `ReportGroupingSchema`
  and the unread report `chart.groupBy`; this drops their objectui mirrors and the
  now-orphaned legacy report chart path.

  - **types**: removed the `SpecReportColumn` / `SpecReportColumnInput` /
    `SpecReportGrouping` / `SpecReportGroupingInput` type re-exports and the
    `SpecReportColumnSchema` / `SpecReportGroupingSchema` value re-exports from
    `@object-ui/types` (they aliased the deleted upstream symbols). The live
    report shape is dataset-bound — `SpecReport` with `dataset` + `values`
    (measure names) + `rows` / `columns` (dimension names).
  - **app-shell**: `ReportView` now renders every report through the spec
    `ReportRenderer` dispatcher (dataset → `DatasetReportRenderer`, stored pre-9.0
    JSON → presentation bridge, pre-spec `{ data, columns }` → `LegacyReportRenderer`).
    Deleted the `ReportViewer` last-resort branch, the `mapReportForViewer`
    spec→legacy chart-section adapter (the sole producer of `xAxisField` /
    `yAxisFields`), and the now-dead data-fetch loading flag. No shipped report
    metadata reached the removed branch — the Studio inspector only ever writes
    the dataset-bound shape.
  - **plugin-report**: removed the `ReportViewer` chart-section branch. It read
    the invented `xAxisField` / `yAxisFields` (never the spec's `xAxis` / `yAxis`)
    and was only fed by the deleted `mapReportForViewer`. `ReportViewer` itself is
    retained — its table / summary / text sections still back the `report-viewer`
    registered component and the pre-9.0 presentation bridge.

  **Migration**: nothing an author writes changes. TypeScript consumers importing
  `SpecReportColumn*` / `SpecReportGrouping*` from `@object-ui/types` have no
  replacement type — model report columns as the dataset's measure names and
  grouping as its dimension names.

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
- Updated dependencies [0b3be01]
- Updated dependencies [3c4d935]
- Updated dependencies [4b1ed7d]
- Updated dependencies [4b60d2d]
- Updated dependencies [952b978]
- Updated dependencies [de5e40c]
- Updated dependencies [1a03af6]
- Updated dependencies [3e886eb]
- Updated dependencies [cfc675e]
- Updated dependencies [20df08c]
- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [af705b9]
- Updated dependencies [0502a7c]
- Updated dependencies [7b35e4b]
- Updated dependencies [8fb1295]
- Updated dependencies [e16ed2d]
- Updated dependencies [c6fd752]
- Updated dependencies [f9bbddb]
- Updated dependencies [dfd3705]
- Updated dependencies [c77108c]
- Updated dependencies [2735de6]
- Updated dependencies [697cda4]
- Updated dependencies [c19ac11]
- Updated dependencies [6dee2cb]
- Updated dependencies [e05f052]
- Updated dependencies [0502a7c]
- Updated dependencies [faad45e]
- Updated dependencies [553443e]
- Updated dependencies [09c6a17]
- Updated dependencies [c7cff19]
- Updated dependencies [df6697f]
- Updated dependencies [ba73a02]
- Updated dependencies [ba45145]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [9b4b952]
- Updated dependencies [341bfb5]
- Updated dependencies [2f947e4]
- Updated dependencies [7d46648]
- Updated dependencies [9b53d72]
- Updated dependencies [bb4aa25]
- Updated dependencies [75f1cdf]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [c6cfdf1]
- Updated dependencies [dc7a798]
- Updated dependencies [d147a13]
- Updated dependencies [c6aaed8]
- Updated dependencies [263f885]
- Updated dependencies [dc334da]
  - @object-ui/components@17.0.0
  - @object-ui/i18n@17.0.0
  - @object-ui/fields@17.0.0
  - @object-ui/react@17.0.0
  - @object-ui/plugin-grid@17.0.0
  - @object-ui/types@17.0.0
  - @object-ui/core@17.0.0

## 16.1.0

### Minor Changes

- 2331ac9: feat(report): drill a date-bucket cell into its time range, not a superset (#1752)

  Clicking a report/dashboard cell grouped by a `dateGranularity` date dimension
  ("2026-Q2") used to drill into a **superset** — the date dimension was skipped,
  so the record list spanned every time bucket. It now scopes to the clicked
  bucket's half-open range, consuming the framework's new `drillRanges` sidecar.

  - **`@object-ui/core`** — `buildDatasetDrillFilter` accepts the per-row
    `drillRanges` and emits an ObjectQL range operator object
    (`{ [field]: { $gte, $lt } }`) alongside the equality dims.
  - **`@object-ui/plugin-report` / `@object-ui/plugin-dashboard`** — the report
    renderer and dashboard widget forward `drillRanges`, and a **date-only**
    report (no equality drill dim) is now drillable via the range alone.
  - **`@object-ui/app-shell`** — the "Open in list →" escape hatch
    (`useOpenRecordList`) now targets the ADR-0055 **bare data surface**
    (`/:object/data`, "the URL is the view" — no baked-in view filter to
    over-narrow the drill) and serializes a range to the
    `filter[field][gte|lt]` operator contract. `ObjectDataPage` parses those
    operators (equality shorthand unchanged), renders a range as a single chip,
    and removes both bounds together. A new `drillUrlFilters` module owns the
    write/read serialization so both sides can't drift (round-trip tested).

  Companion to the framework analytics change (objectstack-ai/objectstack#3256).

### Patch Changes

- ebe6494: chore(lint): clear the baseline lint errors in nine more packages (objectui#2713 Wave 2)

  Second wave of the #2713 lint-gate restoration (after #2730). These nine package
  lints were red at baseline on `main`, so their per-package `lint` gate could not
  catch new violations. Cleared every **error** (no behavior change; warnings out
  of scope):

  - **`react-hooks/rules-of-hooks`** (`i18n`, `plugin-grid`, `plugin-view`,
    `plugin-list`) — translation helpers (`useSafeFieldLabel`,
    `useRowActionTranslation`, `useViewLabel`, `useViewTabLabel`, `useMoreLabel`)
    wrapped a provider-safe hook (`useObjectTranslation`/`useObjectLabel`, which
    never throw) in try/catch; removed the wrapper (the same fix #2709 applied in
    fields). `plugin-kanban` `ObjectKanban` moved its `if (error)` early return
    below the `useCallback` so hooks run unconditionally. `collaboration`
    `__unsafe_usePresenceContext` keeps its deliberate danger-prefix name via a
    justified scoped disable.
  - **`react-hooks/static-components`** (`layout`, `plugin-list`, `plugin-report`)
    — dynamic-icon / registry lookups (`resolveIcon`, `useRegistryComponent`) are
    stable component references, not components created during render → scoped
    disable with justification. `plugin-charts` `TreemapCell` was a _genuine_
    inline component and is hoisted to module scope (it is purely props-driven).
  - **`no-irregular-whitespace`** (`plugin-grid` `ImportWizard`) — the literal
    U+FEFF BOM prepended to exported CSV/text blobs (so Excel detects UTF-8) is
    now written as the `﻿` escape: byte-identical at runtime, no literal
    irregular-whitespace character in source.
  - **`no-useless-assignment`** (`plugin-grid` `BulkActionDialog`) — dropped a
    dead `= null` initializer that the exhaustive `switch` (incl. `default`)
    overwrites before it is read.
  - **`no-unsafe-function-type`** (`plugin-view` `ViewTabBar`) — the dnd-kit
    render-prop `listeners` map is typed `Record<string, (...args: any[]) => void>`
    instead of bare `Function`.
  - **`no-require-imports`** (`plugin-kanban`, `plugin-view` tests) — hoisted
    `vi.mock` factories use an `async` factory with `await import('react')`.

- Updated dependencies [0318118]
- Updated dependencies [1c8935a]
- Updated dependencies [af1b0db]
- Updated dependencies [8b8b744]
- Updated dependencies [7cf4051]
- Updated dependencies [803558e]
- Updated dependencies [aefcf39]
- Updated dependencies [2e7d7f0]
- Updated dependencies [ef14f69]
- Updated dependencies [94d4876]
- Updated dependencies [1100a8b]
- Updated dependencies [7abe4cd]
- Updated dependencies [69fa5d1]
- Updated dependencies [549c67d]
- Updated dependencies [ebe6494]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [0a3710b]
- Updated dependencies [f80aaf2]
- Updated dependencies [62b9ab5]
- Updated dependencies [14cb729]
- Updated dependencies [1629313]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [2331ac9]
- Updated dependencies [199fa83]
- Updated dependencies [eee4ded]
- Updated dependencies [3b2e4d9]
  - @object-ui/fields@16.1.0
  - @object-ui/i18n@16.1.0
  - @object-ui/core@16.1.0
  - @object-ui/types@16.1.0
  - @object-ui/react@16.1.0
  - @object-ui/components@16.1.0
  - @object-ui/plugin-grid@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [d3e19ed]
- Updated dependencies [59d4fa9]
- Updated dependencies [4c7c47f]
- Updated dependencies [210806a]
- Updated dependencies [80977d0]
- Updated dependencies [b4ef588]
- Updated dependencies [ca0f5f0]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
- Updated dependencies [195a651]
- Updated dependencies [33b4995]
  - @object-ui/react@16.0.0
  - @object-ui/components@16.0.0
  - @object-ui/types@16.0.0
  - @object-ui/plugin-grid@16.0.0
  - @object-ui/i18n@16.0.0
  - @object-ui/fields@16.0.0
  - @object-ui/core@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0
- @object-ui/core@15.0.0
- @object-ui/i18n@15.0.0
- @object-ui/react@15.0.0
- @object-ui/components@15.0.0
- @object-ui/fields@15.0.0
- @object-ui/plugin-grid@15.0.0

## 14.1.0

### Patch Changes

- 887062c: feat(dashboard): dashboard-level filters (date / region) driving multiple charts (framework#2501)

  A dashboard's `dateRange` + `globalFilters` declarations are now wired end to
  end: the filter values live as dashboard-level variables (the page variables
  primitive, so they're also readable as `page.<name>` in widget expressions),
  a filter bar renders above the widgets, and at render time the dashboard
  broadcasts the active values into every bound widget's inline query —
  `AND`-merged with the widget's own `filter`. Charts stay inline and
  self-contained; each widget maps a filter to **its own** field.

  - **`@object-ui/types`** — `globalFilters[].name` (stable filter/variable key,
    defaults to `field`) and `DashboardWidgetSchema.filterBindings`
    (`Record<string, string | false>`: per-widget field override / `false`
    opt-out). Zod mirrors included. **Pending paired `@objectstack/spec`
    alignment (framework#2501)** — same precedent as `dataset` /
    `categoryGranularity`.
  - **`@object-ui/core`** — new pure `dashboard-filters` module
    (`resolveDashboardFilterDefs`, `dashboardFilterVariableDefs`,
    `buildFilterCondition`, `buildWidgetScopedFilter`); `mergeFilters` lifted
    from plugin-report (re-exported there unchanged). Date presets emit
    date-macro tokens (`{30_days_ago}` …) so widgets resolve them at query time
    like hand-authored filters.
  - **`@object-ui/plugin-dashboard`** — `DashboardFilterBar` (date presets +
    custom range calendar, select with static `options` or `optionsFrom`,
    text/number inputs, reset); `DashboardRenderer` mounts a
    `PageVariablesProvider` when filters are declared and merges the
    widget-scoped condition into inline widgets' `filter` and dataset widgets'
    `runtimeFilter`. Dashboards without filters render exactly as before.

  Binding precedence: explicit `filterBindings` string/`false` → legacy
  `targetWidgets` allow-list → the filter's own `field` (dateRange defaults to
  `created_at`). Static-data widgets are not filtered.

- Updated dependencies [82441e4]
- Updated dependencies [2efa9fd]
- Updated dependencies [0890fa7]
- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [5523fc4]
- Updated dependencies [887062c]
- Updated dependencies [579b24d]
- Updated dependencies [2b30583]
- Updated dependencies [23d65c3]
- Updated dependencies [06d5ec6]
- Updated dependencies [055e1d2]
- Updated dependencies [9e2d58f]
- Updated dependencies [dea65f7]
- Updated dependencies [f30ff68]
- Updated dependencies [073e7aa]
- Updated dependencies [3e8bf07]
- Updated dependencies [6c0135c]
- Updated dependencies [5b52624]
- Updated dependencies [4afb251]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f94905d]
- Updated dependencies [2712fc1]
- Updated dependencies [f0f10f5]
  - @object-ui/i18n@14.1.0
  - @object-ui/fields@14.1.0
  - @object-ui/core@14.1.0
  - @object-ui/types@14.1.0
  - @object-ui/react@14.1.0
  - @object-ui/plugin-grid@14.1.0
  - @object-ui/components@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [443360a]
- Updated dependencies [c70bca7]
- Updated dependencies [86c69c3]
- Updated dependencies [05e56ca]
- Updated dependencies [a44e7b6]
- Updated dependencies [5971cc4]
- Updated dependencies [6a74160]
  - @object-ui/core@14.0.0
  - @object-ui/i18n@14.0.0
  - @object-ui/react@14.0.0
  - @object-ui/types@14.0.0
  - @object-ui/plugin-grid@14.0.0
  - @object-ui/components@14.0.0
  - @object-ui/fields@14.0.0

## 13.2.0

### Patch Changes

- Updated dependencies [80901aa]
- Updated dependencies [53c40c2]
- Updated dependencies [e492b9d]
  - @object-ui/components@13.2.0
  - @object-ui/plugin-grid@13.2.0
  - @object-ui/i18n@13.2.0
  - @object-ui/fields@13.2.0
  - @object-ui/react@13.2.0
  - @object-ui/types@13.2.0
  - @object-ui/core@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0
- @object-ui/core@13.1.0
- @object-ui/i18n@13.1.0
- @object-ui/react@13.1.0
- @object-ui/components@13.1.0
- @object-ui/fields@13.1.0
- @object-ui/plugin-grid@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [9e38270]
- Updated dependencies [ac04b76]
- Updated dependencies [619097e]
  - @object-ui/i18n@13.0.0
  - @object-ui/components@13.0.0
  - @object-ui/types@13.0.0
  - @object-ui/fields@13.0.0
  - @object-ui/plugin-grid@13.0.0
  - @object-ui/react@13.0.0
  - @object-ui/core@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [6cbccf3]
- Updated dependencies [e1840bf]
- Updated dependencies [c31874d]
  - @object-ui/components@12.1.0
  - @object-ui/fields@12.1.0
  - @object-ui/i18n@12.1.0
  - @object-ui/types@12.1.0
  - @object-ui/plugin-grid@12.1.0
  - @object-ui/react@12.1.0
  - @object-ui/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e36a9c7]
- Updated dependencies [e4de456]
- Updated dependencies [68e2d1c]
  - @object-ui/types@12.0.0
  - @object-ui/core@12.0.0
  - @object-ui/components@12.0.0
  - @object-ui/fields@12.0.0
  - @object-ui/plugin-grid@12.0.0
  - @object-ui/react@12.0.0
  - @object-ui/i18n@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [544d8eb]
- Updated dependencies [6fffd3d]
- Updated dependencies [9255686]
- Updated dependencies [fae75e2]
- Updated dependencies [1072701]
  - @object-ui/i18n@11.5.0
  - @object-ui/react@11.5.0
  - @object-ui/components@11.5.0
  - @object-ui/types@11.5.0
  - @object-ui/plugin-grid@11.5.0
  - @object-ui/fields@11.5.0
  - @object-ui/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [144ab55]
- Updated dependencies [1948c5b]
- Updated dependencies [3e42680]
- Updated dependencies [bce581a]
- Updated dependencies [2edcaff]
- Updated dependencies [9cd9be1]
- Updated dependencies [5160832]
- Updated dependencies [69d6b94]
- Updated dependencies [c38d107]
- Updated dependencies [243a9ba]
- Updated dependencies [289be5b]
- Updated dependencies [7782698]
- Updated dependencies [19f2533]
- Updated dependencies [790558b]
- Updated dependencies [09e1b26]
- Updated dependencies [e84d64d]
  - @object-ui/types@11.4.0
  - @object-ui/plugin-grid@11.4.0
  - @object-ui/components@11.4.0
  - @object-ui/fields@11.4.0
  - @object-ui/i18n@11.4.0
  - @object-ui/core@11.4.0
  - @object-ui/react@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [d88c8ec]
- Updated dependencies [b7237bb]
- Updated dependencies [c55a52a]
- Updated dependencies [2e3e058]
- Updated dependencies [d23d6eb]
  - @object-ui/components@11.3.0
  - @object-ui/i18n@11.3.0
  - @object-ui/plugin-grid@11.3.0
  - @object-ui/core@11.3.0
  - @object-ui/fields@11.3.0
  - @object-ui/react@11.3.0
  - @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [9e7a986]
- Updated dependencies [1311749]
  - @object-ui/components@11.2.0
  - @object-ui/core@11.2.0
  - @object-ui/fields@11.2.0
  - @object-ui/plugin-grid@11.2.0
  - @object-ui/react@11.2.0
  - @object-ui/types@11.2.0
  - @object-ui/i18n@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [6726a2b]
  - @object-ui/i18n@11.1.0
  - @object-ui/components@11.1.0
  - @object-ui/fields@11.1.0
  - @object-ui/plugin-grid@11.1.0
  - @object-ui/react@11.1.0
  - @object-ui/types@11.1.0
  - @object-ui/core@11.1.0

## 7.3.0

### Patch Changes

- Updated dependencies [788dbf9]
  - @object-ui/fields@7.3.0
  - @object-ui/plugin-grid@7.3.0
  - @object-ui/types@7.3.0
  - @object-ui/core@7.3.0
  - @object-ui/i18n@7.3.0
  - @object-ui/react@7.3.0
  - @object-ui/components@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [8e7c1da]
- Updated dependencies [0caea33]
- Updated dependencies [d23db5c]
  - @object-ui/i18n@7.2.0
  - @object-ui/plugin-grid@7.2.0
  - @object-ui/types@7.2.0
  - @object-ui/components@7.2.0
  - @object-ui/fields@7.2.0
  - @object-ui/react@7.2.0
  - @object-ui/core@7.2.0

## 7.1.0

### Patch Changes

- b419a7c: fix(studio): enable report authoring (create flow, chart render, dataset-aware inspector)

  Found dogfooding report design in Studio as a business user — you could not create a report at all, plus several follow-on gaps.

  - **Report create now uses the canvas + `ReportDefaultInspector`.** Only `object` was in `CREATE_MODE_CANVAS_TYPES`, so report-create fell back to a stale name-first form whose create-config (`objectName`, `columns: []`) predates the ADR-0021 dataset-bound model — saving failed server validation (_"a report needs `dataset` + `values`"_) with no field to fix it. Add `'report'` to the canvas set; the inspector exposes an auto-derived snake_case Name in create mode; fix the create-config (drop `objectName`/`columns`, seed `type: 'summary'` + `drilldown: true`).
  - **Preserve `?package=` on post-create navigation** — it was dropped, so the editor reloaded a blank draft in the user's default package.
  - **Render a report's embedded `chart`** in `DatasetReportRenderer` (authorable in Studio but never rendered) via the lazily-registered generic chart component; requests a non-animated render for export/background-tab safety.
  - **Dedicated Chart panel in the inspector** — chart type + dataset-aware X-Axis (dimension) / Y-Axis (measure) dropdowns + title, replacing free-text axis fields and the vague "Chart: Required text value" validation.

- Updated dependencies [677f7ed]
- Updated dependencies [08c47da]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0
  - @object-ui/core@7.1.0
  - @object-ui/react@7.1.0
  - @object-ui/components@7.1.0
  - @object-ui/fields@7.1.0
  - @object-ui/plugin-grid@7.1.0
  - @object-ui/i18n@7.1.0

## 7.0.0

### Major Changes

- 0c95963: ADR-0021 single-form: dataset-native report editing + legacy report surface retired.

  - The Studio/runtime report inspector now edits the 9.0 dataset binding (dataset picker + values/rows selectors sourced from the dataset's semantic layer) instead of the removed objectName/columns query form.
  - plugin-report: the pre-9.0 query-form renderers (SpecReportGrid, MatrixRenderer, JoinedReportRenderer), the drill helpers, and the legacy authoring components (ReportBuilder, ReportConfigPanel, ColumnsEditor, GroupingsBuilder, JoinedBlocksEditor, FieldPickerDialog, ChartConfig, ScheduleConfig) are removed. ReportRenderer dispatches dataset-bound reports to DatasetReportRenderer; stored pre-9.0 spec JSON renders through the lossy specReportToPresentation → ReportViewer bridge until migrated.

### Minor Changes

- 39c89e7: ADR-0021 D2: true matrix cross-tab + dataset-path drill-down.

  - DatasetReportRenderer pivots `type: 'matrix'` reports into a real rows × columns cross-tab (one dataset query over all dimensions, pivoted client-side; matrix without `columns` degrades to the flat grouped table). Joined blocks pivot too.
  - Drill-down: aggregated rows / matrix cells are clickable when the host passes `onDrill` (and the report doesn't set `drilldown: false`), emitting `{dataset, groupKey, runtimeFilter}`. ReportView resolves the dataset's object + dimension→field mapping (reverse-mapping select option labels back to stored values) and navigates to the object list scoped by `?filter[field]=value`.
  - Studio: the report inspector gains a Columns (across dimensions) list for matrix reports; ReportPreview renders through the same DatasetReportRenderer as the runtime, so the matrix preview is WYSIWYG.

- 053c948: feat(plugin-report): server-supplied totals in dataset matrix reports

  Pairs with the framework's server-side `queryDataset` totals. The matrix renderer
  now requests `totals: { groupings: [rows, columns, []] }` and renders the
  returned pre-aggregated rows — a trailing Total column per measure (row
  subtotals), a trailing Total row (column subtotals), and the grand total at their
  intersection — matched to pivot headers via the same `bucketId` logic. A response
  without totals (older server) renders exactly as before; the client never
  re-aggregates (ADR-0021).

### Patch Changes

- c849d3b: Remove the dead pre-9.0 client-side report-aggregation pipeline. ADR-0021 moved aggregation into the semantic layer (`queryDataset`), leaving the `useReportData` hook and its helpers (`buildAggregateQuery`, `groupAndAggregate`, `pivotRows`, `aggregateRows`, `collectFields`, `columnKey`, `bucketDate`, `groupingValue`) and the `ReportRow` / `PivotMatrix` / `PivotHeader` / `UseReportDataResult` / `UseReportDataOptions` types with zero consumers across the monorepo and all product repos. The still-used `mergeFilters` combinator moves to its own module and remains exported from the package root.
- Updated dependencies [5976ba3]
- Updated dependencies [a00e16d]
- Updated dependencies [eaccefd]
- Updated dependencies [f7f325d]
- Updated dependencies [c12986e]
- Updated dependencies [71d7ce0]
- Updated dependencies [053c948]
- Updated dependencies [053c948]
- Updated dependencies [89e113c]
- Updated dependencies [ddbe4a2]
- Updated dependencies [2d47e94]
- Updated dependencies [9049bbe]
- Updated dependencies [77cc6bb]
- Updated dependencies [6c0c92c]
- Updated dependencies [97c6831]
- Updated dependencies [cb2fdb1]
- Updated dependencies [c3749eb]
- Updated dependencies [c09f44e]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [d54346c]
- Updated dependencies [5332639]
- Updated dependencies [3870c20]
- Updated dependencies [2eb3096]
- Updated dependencies [b88c560]
- Updated dependencies [0ad72a6]
- Updated dependencies [bd398df]
- Updated dependencies [3fa23a7]
- Updated dependencies [18d0339]
- Updated dependencies [66ed3ad]
- Updated dependencies [c6445b6]
- Updated dependencies [80c133c]
- Updated dependencies [5e1b838]
- Updated dependencies [59b6bbb]
- Updated dependencies [d16566f]
- Updated dependencies [90acb7f]
- Updated dependencies [7913390]
- Updated dependencies [514f426]
- Updated dependencies [1394e34]
- Updated dependencies [e95cc25]
- Updated dependencies [abe8ebc]
- Updated dependencies [300d755]
- Updated dependencies [bd8b054]
- Updated dependencies [4eb9cb6]
- Updated dependencies [7c239fd]
- Updated dependencies [858ad94]
- Updated dependencies [2270239]
- Updated dependencies [db8cd00]
- Updated dependencies [2f31406]
- Updated dependencies [18728c1]
- Updated dependencies [8d1195d]
  - @object-ui/core@7.0.0
  - @object-ui/components@7.0.0
  - @object-ui/plugin-grid@7.0.0
  - @object-ui/react@7.0.0
  - @object-ui/i18n@7.0.0
  - @object-ui/types@7.0.0
  - @object-ui/fields@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3
- @object-ui/core@6.2.3
- @object-ui/i18n@6.2.3
- @object-ui/react@6.2.3
- @object-ui/components@6.2.3
- @object-ui/fields@6.2.3
- @object-ui/plugin-grid@6.2.3

## 6.2.2

### Patch Changes

- Updated dependencies [a66f788]
  - @object-ui/react@6.2.2
  - @object-ui/components@6.2.2
  - @object-ui/fields@6.2.2
  - @object-ui/plugin-grid@6.2.2
  - @object-ui/types@6.2.2
  - @object-ui/core@6.2.2
  - @object-ui/i18n@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1
- @object-ui/core@6.2.1
- @object-ui/i18n@6.2.1
- @object-ui/react@6.2.1
- @object-ui/components@6.2.1
- @object-ui/fields@6.2.1
- @object-ui/plugin-grid@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/plugin-grid@6.2.0
- @object-ui/react@6.2.0
- @object-ui/components@6.2.0
- @object-ui/fields@6.2.0
- @object-ui/types@6.2.0
- @object-ui/core@6.2.0
- @object-ui/i18n@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/core@6.1.0
  - @object-ui/types@6.1.0
  - @object-ui/components@6.1.0
  - @object-ui/fields@6.1.0
  - @object-ui/plugin-grid@6.1.0
  - @object-ui/react@6.1.0
  - @object-ui/i18n@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4
- @object-ui/core@6.0.4
- @object-ui/i18n@6.0.4
- @object-ui/react@6.0.4
- @object-ui/components@6.0.4
- @object-ui/fields@6.0.4
- @object-ui/plugin-grid@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3
- @object-ui/core@6.0.3
- @object-ui/i18n@6.0.3
- @object-ui/react@6.0.3
- @object-ui/components@6.0.3
- @object-ui/fields@6.0.3
- @object-ui/plugin-grid@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2
- @object-ui/core@6.0.2
- @object-ui/i18n@6.0.2
- @object-ui/react@6.0.2
- @object-ui/components@6.0.2
- @object-ui/fields@6.0.2
- @object-ui/plugin-grid@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1
- @object-ui/core@6.0.1
- @object-ui/i18n@6.0.1
- @object-ui/react@6.0.1
- @object-ui/components@6.0.1
- @object-ui/fields@6.0.1
- @object-ui/plugin-grid@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0
- @object-ui/core@6.0.0
- @object-ui/i18n@6.0.0
- @object-ui/react@6.0.0
- @object-ui/components@6.0.0
- @object-ui/fields@6.0.0
- @object-ui/plugin-grid@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2
- @object-ui/core@5.4.2
- @object-ui/i18n@5.4.2
- @object-ui/react@5.4.2
- @object-ui/components@5.4.2
- @object-ui/fields@5.4.2
- @object-ui/plugin-grid@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1
- @object-ui/core@5.4.1
- @object-ui/i18n@5.4.1
- @object-ui/react@5.4.1
- @object-ui/components@5.4.1
- @object-ui/fields@5.4.1
- @object-ui/plugin-grid@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0
  - @object-ui/components@5.4.0
  - @object-ui/core@5.4.0
  - @object-ui/fields@5.4.0
  - @object-ui/plugin-grid@5.4.0
  - @object-ui/react@5.4.0
  - @object-ui/i18n@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2
- @object-ui/core@5.3.2
- @object-ui/i18n@5.3.2
- @object-ui/react@5.3.2
- @object-ui/components@5.3.2
- @object-ui/fields@5.3.2
- @object-ui/plugin-grid@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1
- @object-ui/core@5.3.1
- @object-ui/i18n@5.3.1
- @object-ui/react@5.3.1
- @object-ui/components@5.3.1
- @object-ui/fields@5.3.1
- @object-ui/plugin-grid@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0
- @object-ui/core@5.3.0
- @object-ui/i18n@5.3.0
- @object-ui/react@5.3.0
- @object-ui/components@5.3.0
- @object-ui/fields@5.3.0
- @object-ui/plugin-grid@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1
- @object-ui/core@5.2.1
- @object-ui/i18n@5.2.1
- @object-ui/react@5.2.1
- @object-ui/components@5.2.1
- @object-ui/fields@5.2.1
- @object-ui/plugin-grid@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [e3160a5]
- Updated dependencies [9997cae]
- Updated dependencies [321294c]
- Updated dependencies [b2d1704]
- Updated dependencies [0a644f0]
- Updated dependencies [a3cb88f]
- Updated dependencies [5425608]
- Updated dependencies [6c3f018]
- Updated dependencies [d912a60]
- Updated dependencies [5633edd]
- Updated dependencies [87bc8ff]
- Updated dependencies [3ebba63]
- Updated dependencies [e919433]
- Updated dependencies [a8d12ec]
- Updated dependencies [70b5570]
- Updated dependencies [aa063db]
- Updated dependencies [d9c3bae]
- Updated dependencies [d1442e3]
- Updated dependencies [7c7400a]
  - @object-ui/types@5.2.0
  - @object-ui/core@5.2.0
  - @object-ui/plugin-grid@5.2.0
  - @object-ui/i18n@5.2.0
  - @object-ui/react@5.2.0
  - @object-ui/fields@5.2.0
  - @object-ui/components@5.2.0

## 5.1.1

### Patch Changes

- Updated dependencies [8955b9c]
  - @object-ui/components@5.1.1
  - @object-ui/fields@5.1.1
  - @object-ui/plugin-grid@5.1.1
  - @object-ui/types@5.1.1
  - @object-ui/core@5.1.1
  - @object-ui/i18n@5.1.1
  - @object-ui/react@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [bd8447d]
- Updated dependencies [fbd5052]
- Updated dependencies [d51a577]
- Updated dependencies [1976691]
- Updated dependencies [d1ec6a2]
- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
- Updated dependencies [49b1760]
- Updated dependencies [c0b236f]
- Updated dependencies [d548d6b]
  - @object-ui/components@5.1.0
  - @object-ui/react@5.1.0
  - @object-ui/i18n@5.1.0
  - @object-ui/types@5.1.0
  - @object-ui/core@5.1.0
  - @object-ui/fields@5.1.0
  - @object-ui/plugin-grid@5.1.0

## 5.0.2

### Patch Changes

- Updated dependencies [cab6a93]
  - @object-ui/plugin-grid@5.0.2
  - @object-ui/i18n@5.0.2
  - @object-ui/components@5.0.2
  - @object-ui/fields@5.0.2
  - @object-ui/react@5.0.2
  - @object-ui/types@5.0.2
  - @object-ui/core@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1
- @object-ui/core@5.0.1
- @object-ui/i18n@5.0.1
- @object-ui/react@5.0.1
- @object-ui/components@5.0.1
- @object-ui/fields@5.0.1
- @object-ui/plugin-grid@5.0.1

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
  - @object-ui/i18n@5.0.0
  - @object-ui/react@5.0.0
  - @object-ui/types@5.0.0
  - @object-ui/fields@5.0.0
  - @object-ui/plugin-grid@5.0.0
  - @object-ui/core@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0
- @object-ui/core@4.8.0
- @object-ui/i18n@4.8.0
- @object-ui/react@4.8.0
- @object-ui/components@4.8.0
- @object-ui/fields@4.8.0
- @object-ui/plugin-grid@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0
- @object-ui/core@4.7.0
- @object-ui/i18n@4.7.0
- @object-ui/react@4.7.0
- @object-ui/components@4.7.0
- @object-ui/fields@4.7.0
- @object-ui/plugin-grid@4.7.0

## 4.6.0

### Patch Changes

- Updated dependencies [9aacced]
- Updated dependencies [9661d86]
- Updated dependencies [3ee436d]
  - @object-ui/plugin-grid@4.6.0
  - @object-ui/components@4.6.0
  - @object-ui/fields@4.6.0
  - @object-ui/types@4.6.0
  - @object-ui/core@4.6.0
  - @object-ui/i18n@4.6.0
  - @object-ui/react@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
- Updated dependencies [d714e85]
- Updated dependencies [6b6afd1]
- Updated dependencies [22fa558]
- Updated dependencies [aa7855f]
- Updated dependencies [170d89f]
  - @object-ui/types@4.5.0
  - @object-ui/fields@4.5.0
  - @object-ui/components@4.5.0
  - @object-ui/i18n@4.5.0
  - @object-ui/core@4.5.0
  - @object-ui/plugin-grid@4.5.0
  - @object-ui/react@4.5.0

## 4.4.0

### Patch Changes

- Updated dependencies [63eb66d]
- Updated dependencies [2bd45af]
  - @object-ui/fields@4.4.0
  - @object-ui/components@4.4.0
  - @object-ui/plugin-grid@4.4.0
  - @object-ui/types@4.4.0
  - @object-ui/core@4.4.0
  - @object-ui/i18n@4.4.0
  - @object-ui/react@4.4.0

## 4.3.1

### Patch Changes

- Updated dependencies [5f4ac6e]
- Updated dependencies [6b683c8]
  - @object-ui/i18n@4.3.1
  - @object-ui/components@4.3.1
  - @object-ui/fields@4.3.1
  - @object-ui/react@4.3.1
  - @object-ui/plugin-grid@4.3.1
  - @object-ui/types@4.3.1
  - @object-ui/core@4.3.1

## 4.3.0

### Minor Changes

- f196cf4: feat(plugin-report): popup picker for groupings + section-aware test ids

  The matrix/summary "Group by" (rows) and "Columns axis" (cols) sections now
  share the same searchable popup picker as the columns section, with a
  commit-on-select single-pick mode wired through `FieldPickerDialog`.

  - Per-row field buttons display the human-readable field label and open a
    dialog scoped to swap that single field (already-used fields filtered out)
  - "Add grouping" trigger uses the same dialog
  - `GroupingsBuilder` accepts a `testIdPrefix` prop; ReportConfigPanel passes
    `rows-grouping` and `cols-grouping` so both instances no longer share the
    ambiguous `grouping-field-0` testid
  - Bigger row spacing (h-7 / text-xs) — the old `text-[10px]` was unreadable

  `FieldPickerDialog` gains:

  - `commitOnSelect`: hides the Confirm/Cancel footer; clicking a row commits
    - closes immediately (intended for `singleSelect` flows)
  - `trigger`: custom trigger element override (used by the per-row field button)

- 079c3b2: feat(plugin-report): per-block field resolution for joined reports

  Joined report blocks can override `objectName` to query a different
  object than the container, but the editor was always offering the
  container's fields — wrong field names, wrong types, broken granularity
  and chart-axis filtering.

  `ReportConfigPanel` now accepts an optional `getFieldsForObject`
  resolver. `JoinedBlocksEditor` uses it to source fields for each
  block based on `block.objectName ?? containerObjectName`, falling
  back to the static `availableFields` when the resolver returns
  `undefined` (unknown object).

  `ReportView` wires the resolver against the app's loaded `objects`
  list and reuses the same parsing path internally to derive its
  top-level `availableFields`, removing the duplicated schema lookup.

  5 new RTL tests verify the resolver wiring, fallback behaviour,
  add-block flow, and inline duplicate-name validation (111 plugin-report
  tests green).

- ee1cc96: feat(plugin-report): joined-report block editor

  `type: 'joined'` reports were a black hole in the editor — the type
  selector exposed them but no UI knew how to edit the `blocks` array,
  so users could neither create nor modify joined reports without
  hand-editing JSON.

  This change adds a `Blocks` section to the report editor, visible only
  when `type === 'joined'`. Each block renders as a collapsible card with
  its own name (required + unique-validated), label, description, block
  type, object override, and reuses the existing `ColumnsEditor`,
  `GroupingsBuilder`, `SpecFilterAdapter`, and `ChartConfig` builders so
  every block behaves like a mini standalone report — matching the
  runtime contract of `JoinedReportRenderer`.

  Block-level validation is surfaced in the main `ValidationBanner`:
  empty blocks array, missing or duplicate block names, and blocks
  without columns all become editor-time errors so saves stay safe.

  The non-joined sections (Columns / Rows / Columns axis / Filters /
  Chart) are hidden when `type === 'joined'` since they live per-block
  in the spec.

  New exports from `@object-ui/plugin-report`:

  - `JoinedBlocksEditor` — standalone component for embedding the
    block editor anywhere.
  - `validateJoinedBlocks` — pure helper returning translated
    problem strings, suitable for custom validation banners.
  - `ColumnsEditor`, `GroupingsBuilder`, `ChartConfig`,
    `SpecFilterAdapter`, `normalizeColumns` are now exported so
    downstream consumers can build their own report-editor surfaces.

  i18n: added `report.editor.blocks*` / `report.editor.addBlock` /
  `report.editor.removeBlock` / `report.editor.blockName*` /
  `report.editor.blockLabel*` / `report.editor.blockDescription*` /
  `report.editor.validationJoinedNeedsBlocks` /
  `report.editor.validationBlockNameRequired` /
  `report.editor.validationBlockNameDuplicate` /
  `report.editor.validationBlockNeedsColumns` to en + zh.

- 0b032be: feat(plugin-report): replace inline column picker with a popup field picker

  The columns section now opens a Dialog-based multi-select picker (`FieldPickerDialog`)
  instead of rendering the unselected field list inline. The popup supports search,
  batched multi-selection (commit several fields in one click), per-field type badges,
  cancel-discards-pending semantics, and is fully i18n'd. Also fixes a latent
  `ReferenceError: normalizeColumns is not defined` that crashed the editor whenever
  the chart section was expanded.

- 4e7bc1b: **Report editor panel overhaul**

  The report configuration panel is now safe to open on any spec-shape `Report` and only exposes fields that are actually persisted by `@objectstack/spec`.

  `@object-ui/plugin-report`:

  - Add a bidirectional `SpecFilterAdapter` so `ReportConfigPanel` can edit
    spec `FilterCondition` filters (`{field: value}`, `{field: {$op: value}}`,
    top-level `$and`/`$or`). Complex / nested filters fall back to a
    read-only banner and are preserved verbatim on save.
  - Drop sections that never round-tripped through the spec
    (`conditionalFormatting`, `sections`, `export`, `schedule`, `appearance`)
    and their helper components.
  - Add type-driven section visibility: `tabular` shows Columns/Filters,
    `summary` adds Rows + Chart, `matrix` adds Rows + Columns axis + Chart.
  - New `GroupingsBuilder` covers `groupingsDown`/`groupingsAcross` with
    `sortOrder` and date-aware `dateGranularity` controls.
  - New `ColumnsEditor` lets users reorder picked columns, override labels,
    set aggregates and choose a display format.
  - Chart subset now mirrors the spec: chart `title`, `showLegend`,
    `showDataLabels`, plus `funnel` (scatter removed).
  - Validation banner highlights missing `objectName` and missing
    rows/columns for `matrix`/`summary` reports.
  - All editor labels and hints are i18n-driven (`report.editor.*`).
  - 18 new unit tests cover the filter adapter round-trip.

  `@object-ui/components`:

  - `FilterBuilder` now guards against malformed external `value` props.
    Previously a spec-shape filter (`{is_active: true}`) would crash the
    component on first render; the builder now falls back to an empty
    AND group whenever `value` is not a valid `FilterGroup`.

  `@object-ui/i18n`:

  - Add `report.editor.*` strings to `en` and `zh`.

- 8442c05: Improve report editor panel usability based on real-user browser testing:
  - **Wider config panel** — the report editor now defaults to a `--config-panel-width`
    of 440px (up from 280px), driven by a new optional `style` prop on
    `ConfigPanelRenderer`. Long field labels, report titles, type labels, and filter
    rows no longer truncate to "Account Na" / "kup" / "ct" / 1-character widths.
  - **Disambiguated "Columns" sections** — for `summary` and `matrix` reports the
    measure list is now labelled **"Values / 度量"** (pivot-style vocabulary) instead
    of "Columns", which previously clashed with the matrix's pivot column axis
    (also called "Columns / 列"). The two sections used to be indistinguishable.
    New i18n key `report.editor.values` / `valuesHint` is shipped for all 10
    locales (en, zh, ar, de, es, fr, ja, ko, pt, ru).
  - **Reordered sections for matrix/summary** — the editor now surfaces _Rows_
    and _Columns_ (the pivot axes) **before** _Values_, mirroring how a business
    user thinks about a pivot table.
  - **Per-row aggregate/format headers** — each column row in `ColumnsEditor` now
    shows small "Aggregate" / "Format" labels above the respective selects, and
    the row uses a 2-line layout so the label input has its own line. The cramped
    3-dropdowns-side-by-side layout at 10px font is gone.
  - **Searchable field picker** — the "Add columns" list now has a search box,
    a `filtered / total` counter, an empty-state message, and a scrollable bordered
    container. New i18n keys: `report.editor.searchFields`,
    `report.editor.noMatchingFields`.

### Patch Changes

- 12c3b7c: refactor(plugin-report): split ReportConfigPanel.tsx (~1200 lines) into per-builder modules. The orchestrator file now only hosts `buildReportSchema`, `ValidationBanner`, and the public `ReportConfigPanel` component; each sub-editor (`SpecFilterAdapter`, `ColumnsEditor`, `GroupingsBuilder`, `ChartConfig`) lives in its own file alongside `editorTypes.ts` for shared types/constants. All existing exports are re-exported from `ReportConfigPanel` so test files and downstream consumers (`JoinedBlocksEditor`, `app-shell`) keep their current import paths. Pure refactor — no behavior change, 111 tests green.
- Updated dependencies [f196cf4]
- Updated dependencies [ee1cc96]
- Updated dependencies [0b032be]
- Updated dependencies [115d36a]
- Updated dependencies [4e7bc1b]
- Updated dependencies [8442c05]
  - @object-ui/i18n@4.3.0
  - @object-ui/components@4.3.0
  - @object-ui/fields@4.3.0
  - @object-ui/react@4.3.0
  - @object-ui/plugin-grid@4.3.0
  - @object-ui/types@4.3.0
  - @object-ui/core@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1
- @object-ui/core@4.2.1
- @object-ui/i18n@4.2.1
- @object-ui/react@4.2.1
- @object-ui/components@4.2.1
- @object-ui/fields@4.2.1
- @object-ui/plugin-grid@4.2.1

## 4.2.0

### Minor Changes

- 650392e: MatrixRenderer now displays i18n-translated labels for picklist (`select` / `status`) groupings instead of raw values (e.g. `Best Case` / `Commit` / `Pipeline` instead of `best_case` / `commit` / `pipeline`). Field labels in the corner cell, row/column total labels, and the `(Empty)` / `(All)` placeholders are also fully translated. Adds `report.*` keys to `en` and `zh` locale bundles.
- 26f5fce: Simplify report identity: replace the dashboard-style KPI grid with a compact "Totals" strip so reports look like reports (table-first with a grand total), not like mini-dashboards.

  - `SpecReportGrid` now renders one inline `Totals: Label1: value Label2: value …` strip above the chart and table, styled as a muted single-line band — clearly subordinate to the data grid below.
  - The Totals strip is now also shown for `tabular` reports when they declare aggregating columns (matches Salesforce's "Grand Total" convention).
  - Drop the duplicate chart title `<div>`: the chart component already renders its own title from `report.chart.title`.
  - Test ids renamed: `spec-report-kpis` → `spec-report-totals`, `spec-report-kpi-${key}` → `spec-report-total-${key}`.

  Visual distinction from dashboards is now intentional: dashboard widgets use prominent floating KPI cards to convey "headline numbers"; report Totals describe the single dataset on the page and are intentionally compact.

- 84b4bf1: Summary reports now render i18n-translated labels in the chart axis, chart series legend, and totals strip. `buildChartData` accepts a new `labels` parameter so callers (currently `SpecReportGrid`) can supply field/column/aggregate/value resolvers. Replaces raw column keys (e.g. `Count of case_number`) and raw picklist values (e.g. `closed`, `in_progress`) with their translated display labels (e.g. `案例编号 · 计数`, `已关闭`, `处理中`). Adds `report.totals` locale key.

### Patch Changes

- Updated dependencies [eb738bd]
- Updated dependencies [650392e]
- Updated dependencies [84b4bf1]
  - @object-ui/i18n@4.2.0
  - @object-ui/components@4.2.0
  - @object-ui/fields@4.2.0
  - @object-ui/react@4.2.0
  - @object-ui/plugin-grid@4.2.0
  - @object-ui/types@4.2.0
  - @object-ui/core@4.2.0

## 4.1.0

### Minor Changes

- b4ce9e2: Fix summary reports: render chart + KPIs, correct empty-table on server-aggregated data.

  - `plugin-report`: `SpecReportGrid` now renders a KPI strip (per aggregating column) and a chart section above the grid for `summary` reports. KPI section auto-hides when no aggregating columns. New `buildChartData()` adapter buckets aggregated `ReportRow[]` to chart-ready data, auto-sorts pie/funnel descending, and falls back to row count when the chart `yAxis` points at a non-numeric column. When the data is server-aggregated, the grid switches columns to `[groupings, ${field}__${agg}]` so cells aren't empty against a raw-row column schema.
  - `plugin-charts`: register `'column'` as an alias of `'bar'` in `ChartRenderer` / `AdvancedChartImpl` (Recharts only has `BarChart`).
  - `app-shell`: `ReportView` now routes any object-backed report (matrix/joined/summary/tabular/columns/groupingsAcross) through the spec `ReportRenderer`; fully-legacy `fields`+`data` schemas still use `ReportViewer`.

- b42a0d0: Server-side `dateGranularity` pushdown.

  `useReportData()` reports with `{ groupBy: [{ field, dateGranularity }] }`
  are now aggregated directly in the database via native SQL (`strftime` /
  `to_char` / `date_format`) instead of fetching raw rows and bucketing in
  Node. The framework's `driver-sql` advertises per-granularity support via
  `IDataDriver.supports.queryDateGranularity` and the engine transparently
  falls back to in-memory bucketing only when the dialect can't express a
  given granularity (notably SQLite `week`, which needs `strftime('%V')`
  added in SQLite 3.46). Output bucket labels (`2026-Q2`, `2026-01-15`,
  `2026-W23`, …) are byte-for-byte identical between paths so drill
  `groupKey` filters compose correctly across SQL and in-memory routes.

  Requires framework ≥ commit `b26d217c`.

### Patch Changes

- @object-ui/types@4.1.0
- @object-ui/core@4.1.0
- @object-ui/react@4.1.0
- @object-ui/components@4.1.0
- @object-ui/fields@4.1.0
- @object-ui/plugin-grid@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12
- @object-ui/core@4.0.12
- @object-ui/react@4.0.12
- @object-ui/components@4.0.12
- @object-ui/fields@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/components@4.0.11
- @object-ui/fields@4.0.11
- @object-ui/react@4.0.11
- @object-ui/types@4.0.11
- @object-ui/core@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10
- @object-ui/core@4.0.10
- @object-ui/react@4.0.10
- @object-ui/components@4.0.10
- @object-ui/fields@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9
- @object-ui/core@4.0.9
- @object-ui/react@4.0.9
- @object-ui/components@4.0.9
- @object-ui/fields@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/components@4.0.8
- @object-ui/fields@4.0.8
- @object-ui/react@4.0.8
- @object-ui/types@4.0.8
- @object-ui/core@4.0.8

## 4.0.7

### Patch Changes

- Updated dependencies [7c9b85c]
  - @object-ui/core@4.0.7
  - @object-ui/react@4.0.7
  - @object-ui/components@4.0.7
  - @object-ui/fields@4.0.7
  - @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- Updated dependencies [89ae109]
- Updated dependencies [925051d]
- Updated dependencies [1b6dc64]
  - @object-ui/fields@4.0.6
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
  - @object-ui/fields@4.0.5
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
  - @object-ui/fields@4.0.4
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
  - @object-ui/fields@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1
- @object-ui/core@4.0.1
- @object-ui/react@4.0.1
- @object-ui/components@4.0.1
- @object-ui/fields@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0
  - @object-ui/components@4.0.0
  - @object-ui/core@4.0.0
  - @object-ui/fields@4.0.0
  - @object-ui/react@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [a2d7023]
- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/components@3.4.0
  - @object-ui/fields@3.4.0
  - @object-ui/types@3.4.0
  - @object-ui/core@3.4.0
  - @object-ui/react@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2
- @object-ui/core@3.3.2
- @object-ui/react@3.3.2
- @object-ui/components@3.3.2
- @object-ui/fields@3.3.2

## 3.3.1

### Patch Changes

- Updated dependencies [b429568]
  - @object-ui/components@3.3.1
  - @object-ui/fields@3.3.1
  - @object-ui/types@3.3.1
  - @object-ui/core@3.3.1
  - @object-ui/react@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0
- @object-ui/core@3.3.0
- @object-ui/react@3.3.0
- @object-ui/components@3.3.0
- @object-ui/fields@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0
- @object-ui/core@3.2.0
- @object-ui/react@3.2.0
- @object-ui/components@3.2.0
- @object-ui/fields@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/react@3.1.5
- @object-ui/components@3.1.5
- @object-ui/fields@3.1.5
- @object-ui/types@3.1.5
- @object-ui/core@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4
- @object-ui/core@3.1.4
- @object-ui/react@3.1.4
- @object-ui/components@3.1.4
- @object-ui/fields@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3
- @object-ui/core@3.1.3
- @object-ui/react@3.1.3
- @object-ui/components@3.1.3
- @object-ui/fields@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2
- @object-ui/core@3.1.2
- @object-ui/react@3.1.2
- @object-ui/components@3.1.2
- @object-ui/fields@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1
  - @object-ui/components@3.1.1
  - @object-ui/core@3.1.1
  - @object-ui/fields@3.1.1
  - @object-ui/react@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3
- @object-ui/core@3.0.3
- @object-ui/react@3.0.3
- @object-ui/components@3.0.3
- @object-ui/fields@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2
- @object-ui/core@3.0.2
- @object-ui/react@3.0.2
- @object-ui/components@3.0.2
- @object-ui/fields@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [adf2cc0]
  - @object-ui/react@3.0.1
  - @object-ui/components@3.0.1
  - @object-ui/fields@3.0.1
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
  - @object-ui/fields@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
  - @object-ui/core@2.0.0
  - @object-ui/react@2.0.0
  - @object-ui/components@2.0.0
  - @object-ui/fields@2.0.0
