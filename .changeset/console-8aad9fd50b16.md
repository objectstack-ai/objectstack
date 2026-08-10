---
"@objectstack/console": minor
---

Console (objectui) refreshed to `8aad9fd50b16`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 61 releasing of 61 changesets added across 67 non-merge commits; omitted: 6 commits carrying no changeset (they ship no package code).

- **minor** — Build and publish `@object-ui/fields/style.css` — the subpath the package has always declared and never shipped (objectui `b19162d62`)
- **minor** — fix(timeline): the timeline binds to the date axis the view actually declares (#3129) (objectui `bd863fe49`)
- **minor** — Give composite and grouped field widgets a real accessible name: the form renderer now associates its label by IDREF for widgets that declare `labelling: 'group'`, instead of emit… (objectui `c3b01a71c`)
- **minor** — `PageComponentSchema.dataSource` now reaches every object-bound block, not just `list-view` — and `element:record_picker` stops discarding `view` (objectstack#6953). (objectui `5bfaabde0`)
- **minor** — **BREAKING** — fields: remove the docs-demo registration path (`registerFields` + `createFieldRenderer`), and host the docs field examples in a real form (objectui `65bb513dc`)
- **patch** — Action-face predicates written against the canonical `record.` root now evaluate (objectui `8aad9fd50`)
- **patch** — The console no longer reads `/meta/*` before it knows whether it has a session, and a failed request now says which request failed (objectui `41d602274`)
- **patch** — Run `sys_approval_request`'s server-declared decision actions on the business record page, and retire the hard-coded two-button approval path (objectui#3055). (objectui `99782f961`)
- **patch** — The inbox popover now spells out what the bell badge is made of (objectui `8c60819a6`)
- **patch** — `page:card` publishes `children` instead of the retired `body`, and `page:section` / `page:footer` / `page:sidebar` publish the `children` slot they render (objectui `0ef9dfd8b`)
- **patch** — Register `approvals:inbox` as a component ref, and stop sending Home's "pending approvals" card into the setup app (objectstack#7231). (objectui `28c38567b`)
- **patch** — Create forms now open with the object schema's declared `defaultValue`s (objectui `f0c9a9042`)
- **patch** — Fix `objectui init` scaffolding an app that renders neither components nor styles. (objectui `85fb95bf5`)
- **patch** — `objectui doctor` now diagnoses Tailwind 4 instead of Tailwind 3 (objectui `59df371f7`)
- **patch** — `objectui init` now versions the project it scaffolds against the CLI that wrote it, and stops writing a `tailwind.config.js` Tailwind 4 never reads. (objectui `0a09793f2`)
- **patch** — The Studio RLS editor no longer authors the retired `rowLevelSecurity[].priority` key (objectstack#7130) (objectui `5419f552a`)
- **patch** — Studio's widget config panel no longer authors the retired `actionUrl` widget key (objectui `c1e1e6b41`)
- **patch** — Resolve a `select` field declared `multiple: true` to the `field:multiselect` widget, so the object form's visible label actually names the chip picker it renders (objectui#3986). (objectui `11c1e71e8`)
- **patch** — Name the `InspectorComboField` trigger: the visible label now owns it, and an anonymous combo no longer compiles (objectui#3997). (objectui `1037e1a3f`)
- **patch** — `object-timeline` and `record:line_items` now apply the filter / sort / row cap they are given, so a named `dataSource.view` narrows them instead of contributing nothing (objectui `523be4820`)
- **patch** — `plugin-map` 加载时不再向控制台打印 `Registering object-map...` (objectui `9ad21b6c4`)
- **patch** — `navigation-renderer` 的 `items` 声明为 `required: true` —— 校验器不再放过必崩的节点 (objectui `f3b2874e1`)
- **patch** — Group-labelled field widgets now consume the host label's IDREF in their readonly and zero-option states, so the visible label names something there too (objectui `c97a45e8c`)
- **patch** — The `div` deprecation notice is now reported once per module load, not once per render (objectui#3965) (objectui `0fa5e4da9`)
- **patch** — Metadata-admin inspectors: the shared text / number / select field labels now name their control (objectui `dffeeefb7`)
- **patch** — Built-in `select` fields: the form's label, validation message and required state now reach the control (objectui `0cbdca888`)
- **patch** — `PageComponentSchema.dataSource` now reaches the remaining object-bound public blocks: `object-gantt` / `object-timeline` / `object-map` / `object-pivot` / `object-master-detail-f… (objectui `022002aba`)
- **patch** — Page block inspector: the input hints inside the properties panel follow the session's language (objectui `65d6c0783`)
- **patch** — `BulkActionDialog` required params: the control now announces the required state, and the visual `*` stays out of its accessible name (objectui `18c42c65f`)
- **patch** — `registerLayout()` 的 `inputs` 声明面与渲染器实现对齐 —— 校验器不再对正确写法报假诊断 (objectui `6bd6a4d76`)
- **patch** — A form-hosted `multiselect` field is now NAMED by its visible label. It was the residual of objectui#3961: that issue's probe audited six widgets and fixed them, and re-running th… (objectui `d8a0be424`)
- **patch** — fix(metadata-admin): page block inspector chrome follows the locale (objectui `708aaf8e4`)
- **patch** — `record:related_list` — the declared `filter` reaches the query, and the Add button answers to the same gate as its dialog (objectui `c4768a760`)
- **patch** — `ActionParamDialog` boolean params: the dialog now owns the control id, so the checkbox is named once instead of twice (objectui `cdc0e44c8`)
- **patch** — Blank predicates and non-predicate values are no longer gates, at the last three entries that still judged them (objectui#3955, objectui#3957, objectui#3960) (objectui `0109f5418`)
- **patch** — `page-header` 注册补 `isContainer: true` —— 校验器不再对文档承诺的 children 写法报 `not-a-container` (objectui `82f8dfffd`)
- **patch** — Page block inspector: the PROPERTIES panel's curated field labels now follow the session locale instead of always rendering English (objectui `62c644168`)
- **patch** — An empty predicate is no longer a declared gate anywhere (objectui#3850, objectui#3862) (objectui `ab3ad4f3f`)
- **patch** — fix(fields): `BooleanField` uses the control id its host hands down, so a boolean field's visible label is really associated with the switch (objectui `ea41a595a`)
- **patch** — `de` approvals inbox no longer shows two quote typographies on one screen (objectui `69becd2d1`)
- **patch** — `ChartContainer`'s min-size fallback survives a consumer-supplied `style` (objectstack#7026) (objectui `a7e39a8b2`)
- **patch** — `grid.import.transform` is now translated in ko / de / fr / es / pt / ru / ar instead of served as English (objectui `b14ab3afe`)
- **patch** — `UserFilters` preset tab buttons no longer submit an enclosing form; all six buttons declare `type="button"` (objectui `cb5e32d73`)
- **patch** — `@object-ui/layout` no longer tells bundlers it has no side effects while registering components at load time (objectui#3899) (objectui `876e3f74e`)
- **patch** — fix(core): stop re-wrapping an already-`${…}` predicate, so action-face `visible` / `disabled` finally honour it (objectui#3871) (objectui `1d723e30c`)
- **patch** — `grid.import` saved-mapping copy is now translated in ko / de / fr / es / pt / ru / ar instead of served as English (objectui `ac2139ccd`)
- **patch** — metadata-admin: an unresolvable visibility-predicate path now fails OPEN, loudly (objectstack#6936) (objectui `ebb579dbb`)
- **patch** — Dashboard metadata's `chartConfig` presentation keys now take effect for the first time (objectui `230ffd875`)
- **patch** — fix(actions): forward `bodyShape` end-to-end so a declared body wrap is honoured (objectui `c2fd1223a`)
- **patch** — Context selectors: picking an option the instant the dropdown fills no longer snaps back to the first one (objectui `2c632d94e`)
- **patch** — `datetime` action params are usable in the Console for the first time — the dialog now POSTs the zoned ISO instant the platform requires instead of a shape the validator rejects (objectui `d518a905a`)
- **patch** — `PageComponentSchema.dataSource` is now consumed instead of discarded — a `list-view` page component can reference a **saved view by name** for the first time, and writing the bin… (objectui `e06810eed`)
- **patch** — `address` widget: the ZIP box now reads and writes `postalCode`, the part name the platform stores (objectui `0186cdc26`)
- **patch** — `userFilters` tabs: the `allowAddTab` button now adds a tab instead of doing nothing (objectstack#5236) (objectui `cf5be4ec2`)
- **patch** — `percent` / `progress` cells now give the NUMBER shrink priority over the decorative bar (objectstack#5066) (objectui `f4b97c85a`)
- **patch** — German pack: the 20 values that closed the German opening quote with an ASCII straight quote now close it with `“` (objectui `5e524950d`)
- **patch** — fix(actions): forward `bodyExtra` end-to-end through the action chain (objectui `7e5bb5d4e`)
- **patch** — Make metadata-form visibility predicates work again in the Setup/Studio admin engine: `SchemaForm` now reads the canonical `visibleWhen` key, falling back to the deprecated `visib… (objectui `7a197e7c5`)
- **patch** — Honour all three `AppContextSelectorSchema.persist` values in app context selectors: `'query'` (the default) writes and reads the URL query parameter only, `'session'` writes and… (objectui `d86b41ced`)
- **patch** — The AI plan / confirm cards send the agent text in the CONVERSATION's language, not the console UI's (objectui#3896) (objectui `99ba5fbd7`)
- **patch** — `condition: false` now actually prevents the action from executing (objectui#3872) (objectui `67198776b`)

⚠️ 1 of these carries a breaking change: 1 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 6 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ docs(guide): teach the Tailwind 4 CSS-first setup on theming / troubleshooting / quick-start (#4060) (objectui `eda7fe984`)
- _(no changeset)_ fix(schema-catalog): grid 示例的列数键 cols → columns —— 3/4 列示例不再静默渲染成 2 列 (#4001) (#4008) (objectui `34a00bf29`)
- _(no changeset)_ fix(scripts): decide test type-check coverage from the resolved tsconfig program, not from text (#4004) (objectui `94d1d8294`)
- _(no changeset)_ fix(site): Schema Catalog 卡片外壳去 button 化,示例预览不再嵌套按钮 (#3903) (#3964) (objectui `53b7b88af`)
- _(no changeset)_ docs(layout): align app-shell Header Bar / Content Area numbers with AppShell.tsx (#3914) (#3945) (objectui `fd6dd2d61`)
- _(no changeset)_ fix(site): Playground 注册 layout 组件，并删掉两个非依赖的 transpilePackages 死条目 (#3942) (objectui `137a1121d`)

<!-- adr-0087: not-required (no-migration-prescription) The one declared-breaking entry in this range is objectui `65bb513dc`, which removes two TypeScript exports from the `@object-ui/fields` npm package — `registerFields()` and `createFieldRenderer()`, a docs-demo-only registration wrapper whose only caller was objectui's own documentation site. Nothing about it reaches an ObjectStack author: `@objectstack/console` publishes a frozen prebuilt SPA (`files: ["dist", …]`, and its sole `exports` entry is `./package.json`), so it forwards no `@object-ui/fields` module entry point and neither removed export is reachable through this package at all. No `packages/spec` schema, authorable metadata key or protocol surface changes in the range, so there is no metadata rewrite for `objectstack migrate meta` to prescribe and therefore no ADR-0087 ledger entry to write or to name. The retired-key items elsewhere in the list above (`rowLevelSecurity[].priority` via objectstack#7130, the `actionUrl` widget key, `page:card`'s `body` slot) run the other way: they are objectui CEASING to author keys that ObjectStack retired and registered in its own PRs, so they add no prescription here either. This bump adds no ledger entry and claims none. -->

objectui range: `09987b680d53...8aad9fd50b16`
