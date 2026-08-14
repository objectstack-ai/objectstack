# @objectstack/console

## 17.0.0

### Minor Changes

- 19d8948: Console (objectui) refreshed to `09987b680d53`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 41 releasing of 45 changesets added across 57 non-merge commits; omitted: 4 release-nothing changesets, 13 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — `ApproveOutcome` / `RejectOutcome` are now derived from `@objectstack/spec` instead of hand-transcribed (objectui#3783). Same failure class #3220 cleared from the same file for `P… (objectui `d9ce38529`)
  - **minor** — **BREAKING** — Retire the `capability-multiselect` field widget name, which existed only on the docs-site registration path and which nothing ever stamped (objectui#3308, ADR-0049 enforce-or-rem… (objectui `ecae40064`)
  - **patch** — `record:details` section editor now offers the `name` i18n anchor (objectui `2937bcf7d`)
  - **patch** — 相关列表 Add 选择器兑现 `add.picker.filter`:作者限定的候选范围现在真的生效 (objectui `c2ecbaed9`)
  - **patch** — The plan card's "Building…" badge follows the console UI locale, like every other label on it (objectui#3837) (objectui `b3439f420`)
  - **patch** — `record:related_list`: an `add` without `add.picker` no longer takes the whole related list down. (objectui `acc34c57b`)
  - **patch** — 修复 `objectui dev` 生成的临时 app 的 CSS 管线:整套从 Tailwind 3 迁到 Tailwind 4 (objectui `8277053bd`)
  - **patch** — Backfill the last 17 missing locale keys and both remaining template-key families, emptying the call-site key ratchet (objectui#3546, slice seven — final) (objectui `f9faa7d62`)
  - **patch** — `preview.draftBar` speaks one second person in `es` — the draft-preview banner no longer switches from tú to usted when a Spanish user publishes (#3844) (objectui `b750823f0`)
  - **patch** — An empty `disabled` predicate no longer refuses to run the action (objectui#3848) (objectui `56ff0916e`)
  - **patch** — Give `@object-ui/react-runtime`'s React peer range an upper bound: `peerDependencies.react` narrows from `>=18` to `^18.0.0 || ^19.0.0`, the spelling the other 30 react peers in t… (objectui `d11996ea5`)
  - **patch** — 回填 `perm` + `home` 两命名空间 14 个缺失语言 key,十个语言包补齐(#3546 切片六) (objectui `e64a52ec3`)
  - **patch** — `disabled: ''` no longer greys out the remaining five action surfaces (objectui#3849) (objectui `f0a625aa7`)
  - **patch** — Generated temp apps now declare every package they import, at ranges anchored to this repo (objectui `c32323e1e`)
  - **patch** — An action declaring `disabled: ''` is no longer greyed out forever (objectui#3842) (objectui `993336f7c`)
  - **patch** — Backfill the `marketplace` and `preview` namespaces' 37 missing locale keys plus the `marketplace.disclosure.runtime.` template-key family (objectui#3546, slice five) (objectui `844d17fc9`)
  - **patch** — Four spec keys the renderers already honoured are now discoverable from the published `inputs` (objectui `aca561a77`)
  - **patch** — Export `hasDeclaredVisibilityGate` from the package barrel (objectui#3835) (objectui `d3e738af8`)
  - **patch** — Server-declared actions declaring `visible: false` are now hidden instead of rendered as live buttons (objectui#3835) (objectui `d3e738af8`)
  - **patch** — Backfill the `console` namespace's 41 missing locale keys plus the `console.ai.group.` template family (objectui#3546, slice four) (objectui `f5f874491`)
  - **patch** — Grid row actions: the inline button budget is now spent on the primaries that actually render (objectui `14c59c0b9`)
  - **patch** — `action:bar` member actions declaring `visible: false` are now hidden instead of rendered (objectui `794c497c5`)
  - **patch** — Remove the scaffold's unused pinned icon dependency, and make its generated schema interface reachable (objectui `c85268256`)
  - **patch** — Action-face member actions declaring `visible: false` are now hidden instead of rendered (objectui `b5980f471`)
  - **patch** — data-objectstack: pass the server's `drillRanges` date-bucket drill scope through `queryDataset` (restores date drill-through) (objectui `376567890`)
  - **patch** — `record:details` 的 `sections` 输入说明改为从 spec 形状派生的对象形,不再教已被退役的「Section IDs」 (objectui `4178d5a2e`)
  - **patch** — data-objectstack: type `queryDataset`'s result `fields[]` as the spec's `AnalyticsResult.fields[]` element instead of a hand-written copy (objectui `d83f6b3de`)
  - **patch** — Backfill the auth family's 54 missing locale keys — `auth` 26 + `oauth` 16 + `acceptInvitation` 12 (objectui#3546, slice three) (objectui `7864f0340`)
  - **patch** — Row actions declaring `visible: false` are now hidden instead of rendered (objectui `97b63d761`)
  - **patch** — `parseAiQuotaError` now reads the AI quota refusal code from all three shapes the cloud 429 producers use, instead of only the flat `error`-holds-the-code dialect. (objectui `2a54e860c`)
  - **patch** — console: hold the environment list's create CTA with a skeleton until entitlements resolve, instead of showing a label that is about to be overwritten (objectui#3482, part of clou… (objectui `0ef94cae1`)
  - **patch** — Dataset-bound metric cards honour their declared `colorVariant` (objectui#3359, objectstack#5010 ruling B) (objectui `c4c0ac897`)
  - **patch** — Record page header action predicates now speak CEL, like every other action surface (objectui `e24d767e4`)
  - **patch** — `record:highlights` publishes the `readonly` entry key, so an AI author can discover it from the manifest (objectui `7b3e04820`)
  - **patch** — Fix saved list-view preferences never reading back (density, column widths, sort, hidden columns, inline edit) (objectui `7e2b7e94c`)
  - **patch** — `BulkActionParam.options` entries now accept the widget config the renderer already forwards (objectui `d229dfa7b`)
  - **patch** — Ask the view composer for a container's view identities instead of deriving `list.name || 'list'`, so the default list view's translated label resolves (objectui `b691f060e`)
  - **patch** — Record detail pages: a header ⟳ that refreshes the record, its related lists and its tab counts in place — no browser reload (objectui `54233b14a`)
  - **patch** — Resolve `_views` translation keys by the bare view name only — the prefixed full name is no longer a second candidate (objectui `32413ec24`)
  - **patch** — Action params that inherit a field's options now keep the keys that field declared (objectui `fbc23e094`)
  - **patch** — fix(plugin-grid): don't render a row "⋮" trigger that opens an empty menu (objectui `1a33b1aba`)

  ⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 13 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(layout): page-header 的 Responsive Behavior 按 PageHeader 现状改写 Spacing 一行 (#3902) (#3915) (objectui `09987b680`)
  - _(no changeset)_ docs(layout): align PageHeader Styling/Container with the code and make its demo use the component (#3786, #3787) (#3905) (objectui `50fa3766e`)
  - _(no changeset)_ docs(scripts): 删除 scripts/README.md —— 一份无门禁覆盖、无入站链接的第二份清单 (#3882) (objectui `47f607854`)
  - _(no changeset)_ fix(test): runner 的包级 test 入口指回仓根配置,不再落到 app 的 vite.config (#3746) (#3869) (objectui `39136cccb`)
  - _(no changeset)_ ci(skills): skills 指南正文反引号里的仓内路径上门禁,豁免走双向陈旧检测的 baseline (#3735) (#3864) (objectui `74370641d`)
  - _(no changeset)_ docs(ROADMAP): P1.12.3 / P1.16 九条同源漂移按现实改写 (#3738) (#3858) (objectui `6402e253f`)
  - _(no changeset)_ docs(skills): console-development.md 顶部注记的搬家归因改成 04-21→04-23 的 commit 链,cccdf84d7 降为其中一步 (#3737) (#3856) (objectui `6422aa891`)
  - _(no changeset)_ fix(scripts): check-i18n-en-drift 的显式 base 提为权威,解析不出即失败 (#3766) (#3821) (objectui `32bd84236`)
  - _(no changeset)_ docs(layout): page-header 两处文档按组件实读收敛到 subtitle,删掉不存在的 breadcrumbs (#3785) (objectui `f9d70a72e`)
  - _(no changeset)_ docs(ci): 去掉 check-lint-coverage.mjs 头注里的 object-ui 规则点数,并把守卫扩到该文件 (#3279) (#3784) (objectui `4028adfc3`)
  - _(no changeset)_ fix(docs): 按清单校正 9 行 peer 陈述,并把断言加宽到整个 Peer Dependencies 区块 (#3750) (#3779) (objectui `00b9451d8`)
  - _(no changeset)_ ci(changeset): 改了发版包 src/ 却没带 changeset 的 PR 一律失败,空 frontmatter 为显式豁免 (#3387) (#3769) (objectui `a4f837c7d`)
  - _(no changeset)_ docs(hooks): guard-shared-stash header says 32 self-test cases, with the counting rule (#3721) (#3763) (objectui `dbc44b4be`)

  <!-- adr-0087: not-required (no-migration-prescription) Neither break reaches a consumer of @objectstack/console, which publishes objectui's built SPA and exports no objectui type. capability-multiselect was registered only on registerFields(), whose sole caller is objectui's docs site, so the name was unreachable on the live registerAllFields() path and a field still carrying it degrades to its declared type renderer — the defined behaviour for an unregistered widget, with permission-facet-link unchanged as what is actually stamped. ApproveOutcome/RejectOutcome narrow a TypeScript type exported by @object-ui/plugin-chatbot, a package objectstack neither publishes nor re-exports; the removed ApproveOutcome.id was already undefined at runtime, so no shipped behaviour changes and there is nothing for the ledger to prescribe. -->

  objectui range: `b1204af0a1f7...09987b680d53`

- 379b749: Console (objectui) refreshed to `0cf8f0f70d10`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 24 releasing of 24 changesets added across 66 non-merge commits; omitted: 42 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — Reclaim the natural names `GestureType` and `GestureConfig` (objectui#3363). (objectui `e6fdbdcc4`)
  - **minor** — **BREAKING** — Track the `@objectstack` family at `17.0.0-rc.5` (objectui#3560). (objectui `48132f7e6`)
  - **patch** — metadata-admin: name the offending key when only one union member ever read the value (objectui `be9cd38ac`)
  - **patch** — System Hub: a card count that failed to load no longer renders as `0` (objectui `c1a18ed99`)
  - **patch** — Count System Hub's Organizations card through `sys_organization`, the object the framework actually registers — it asked for `sys_org`, which does not exist, so the card read `0`… (objectui `278f57c36`)
  - **patch** — metadata-admin: name the offending column when `config.columns` is rejected (objectui `949b2f147`)
  - **patch** — Declare the retired `system/{users,organizations,roles,positions}` console URLs as redirects onto the framework-owned system objects (objectui#3655). (objectui `9961df297`)
  - **patch** — Point the last four navigation producers at the canonical metadata-admin routes instead of the deprecated `component/metadata` alias, removing a redirect hop from each (objectui#3… (objectui `d2fd044b7`)
  - **patch** — `view.readonlyTooltip` — the tooltip on a view tab's read-only lock — is retranslated in the eight packs (ja/ko/de/fr/es/pt/ru/ar) that still described the retired "duplicate to c… (objectui `33526fd51`)
  - **patch** — Send the console host's legacy URL redirects straight to the canonical metadata-admin routes instead of routing them through the deprecated `component/metadata/resource` alias (ob… (objectui `7883c0250`)
  - **patch** — Match the built-in pseudo-routes on whole path segments, so a mistyped app name can no longer render a different app (objectui#3638). (objectui `5f752a089`)
  - **patch** — Make the zero-app console's "Object Manager" / "Datasources" entries resolve, and give that branch a not-found screen instead of a blank one (objectui#3610). (objectui `fa3ba5bf1`)
  - **patch** — Point the four remaining "Settings" senders at the system hub `/apps/setup/system` instead of the bare `/apps/setup` (objectui#3611). (objectui `6b3d47b34`)
  - **patch** — Render the `/home` Administration group as a real group, so its nine system-administration entries are reachable (objectui#3609). (objectui `13b72c740`)
  - **patch** — `console.objectView.systemViewReadonly` and `console.objectView.expandToPage` are translated in the eight packs that stored English for them, so a Japanese, Korean, German, French… (objectui `4dcd52abe`)
  - **patch** — metadata-admin: restore per-field diagnostics when editing an invalid stored `view` (objectui `c993ff26a`)
  - **patch** — Point the "System Settings" entries at the system hub `/apps/setup/system` instead of the bare `/apps/setup` (objectui#3590). (objectui `d1be43673`)
  - **patch** — Converge dashboard widget `compareTo` on the executor's `{ kind, dimension? }` contract, and make the dataset path actually render a comparison (objectui `4bc6c2340`)
  - **patch** — metadata-admin no longer false-rejects a stored `view` that has been pinned or reordered. The editor's live client-side validation judged BOTH the create and the edit draft with t… (objectui `4cf76ce45`)
  - **patch** — The organization-management console is translatable. The 90 keys under `organization.*` — the org layout and its tabs, the members list, the whole invitation flow, organization se… (objectui `42ae5c62a`)
  - **patch** — Complete `packages/runner/vite.config.ts`'s workspace alias table to the full transitive import closure, so `@object-ui/runner` boots and builds from the monorepo sources without… (objectui `03f25f7a3`)
  - **patch** — Runner in-app navigation now carries the current query string across to the pushed URL instead of `pushState`-ing a bare path. Opening the Runner with `?api=<base>` and clicking a… (objectui `04fb8b8ab`)
  - **patch** — The no-apps empty state's "Create Your First App" CTA now opens the app-creation flow instead of silently bouncing the user back to the landing page. It called `navigate('/create-… (objectui `9089d8503`)
  - **patch** — The five locale keys behind #3546's eight no-fallback `t()` call sites are now defined in all ten packs, so the built-in-view toasts, the activity-timeline source link, the wizard… (objectui `6d762da7a`)

  ⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 42 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(ROADMAP): P1.12 Routes/Tests 两条 PermissionManagementPage 记录按现实改写 (#3704) (#3714) (objectui `0cf8f0f70`)
  - _(no changeset)_ test(scripts): gate version literals written into docs prose (#3711) (objectui `36bf20235`)
  - _(no changeset)_ test(app-shell): pin what `invalid_value` at a union node means, and decline the relaxation (#3706) (objectui `f1310e40f`)
  - _(no changeset)_ fix(react-runtime,sdui-parser,console): 补上三包声明了 MIT 却从未随包发布的许可证文本,并加门禁封死该类 (#3696, #3702) (#3703) (objectui `2267d6399`)
  - _(no changeset)_ docs(ROADMAP): rewrite P1.12.2 + Permission Management to the post-#3673/#3699 reality (#3700) (#3705) (objectui `35e84b65f`)
  - _(no changeset)_ test(scripts): 棘轮陈旧消息按实际成因分句,覆盖全部三条退休路径 (#3674) (#3701) (objectui `45cdd4cb4`)
  - _(no changeset)_ chore(console): remove the orphaned SystemObjectViewPage + systemObjects dead code (#3672) (#3699) (objectui `b19f54f39`)
  - _(no changeset)_ docs(cli): point the Node row at root engines, drop the ghost spec compatibility row (#3698) (objectui `d46b40324`)
  - _(no changeset)_ docs(plugin-tree): add the `## License` section the other 36 published READMEs carry (#3664) (#3695) (objectui `3e601773e`)
  - _(no changeset)_ docs(packages): retire the dead release-metadata §Compatibility block from 36 package READMEs (#3688) (objectui `4747344da`)
  - _(no changeset)_ fix(cli,create-plugin): drop the `templates` files entry neither package has ever had (#3665) (#3687) (objectui `dcff16e06`)
  - _(no changeset)_ docs(ci): type-check 作业行补两道 i18n 门禁,并把该表的钉粒度降到步骤级 (#3653) (#3683) (objectui `9cd84de2e`)
  - _(no changeset)_ docs(agents): 补一条 prettier 假红护栏(#3682) (#3684) (objectui `074ec53d6`)
  - _(no changeset)_ chore(deps): remove the unwired prettier devDependency (#3657) (#3681) (objectui `f953b5884`)
  - _(no changeset)_ docs(runner): 按实测闭合 §Features 插件断言,三处 main.tsx 订正为 App.tsx (#3619) (#3652) (#3676) (objectui `0fcd57199`)
  - _(no changeset)_ chore(deps): Bump mermaid from 11.16.0 to 11.16.1 (#3675) (objectui `2ce5c31f0`)
  - _(no changeset)_ feat(scripts): en 文案改动必须由九个译文包同批跟改的门禁 (#3650) (#3659) (objectui `880e06905`)
  - _(no changeset)_ docs(scripts): 按真实机制改写两处 Lychee 门禁描述,并删掉 judgeHref 重复注释 (#3587) (#3648) (#3656) (objectui `f4b828857`)
  - _(no changeset)_ test(app-shell): 把 MetadataRedirectStub 同步回宿主实现,并用整链断言钉住转录真实性 (#3661) (#3671) (objectui `e98702190`)
  - _(no changeset)_ test(scripts): gate that package.json `files` entries exist on disk (#3663) (#3667) (objectui `fe4d4da37`)
  - _(no changeset)_ docs(runner): 把 README 两处开放集合的插件措辞按实测闭合 (#3632) (#3644) (objectui `c6acd7b8f`)
  - _(no changeset)_ test(filter-parity): 给两处 spec 词表减法加排除项存活棘轮 (#3628) (#3640) (objectui `1e635d654`)
  - _(no changeset)_ fix(plugin-tree): ship the MIT LICENSE the package.json files field already declares (#3647) (#3662) (objectui `dae1ac41e`)
  - _(no changeset)_ docs(runner): §vite.config.ts 改写为指路真实文件 + 点名两个承重不变量 (#3643) (#3651) (objectui `93c261992`)
  - _(no changeset)_ feat(scripts): check-doc-links 扫描面第四扩 packages/\*/README.md,并付清入场价的 11 条死链 (#3622) (#3649) (objectui `0d5da5394`)
  - _(no changeset)_ docs(runner): §Add Custom Routes 改写为指向 Add Custom Schemas 的元数据路由说明 (#3618) (#3646) (objectui `54dd7ec1f`)
  - _(no changeset)_ docs(runner): 删掉 Best Practices 里复活的环境变量配置面 (#3617) (#3633) (objectui `d9a03fe9a`)
  - _(no changeset)_ docs(runner): README §Features 的 Hot Reload 按两个 loader 分路限定 (#3620) (#3634) (objectui `8098c8585`)
  - _(no changeset)_ fix(docs,scripts): 清掉 9 条包 README 死链,并让链接门禁认站内绝对 URL (#3603) (#3629) (objectui `0e4ea07b2`)
  - _(no changeset)_ test(types): drop 37 spec-retired DROPPED_SCHEMA_EXPORTS rows, add liveness ratchet (#3601) (#3623) (objectui `2904a7cd3`)
  - _(no changeset)_ docs(runner): README §Development Workflow 按两个 loader 的真相改写第 1、3 步 (#3604) (#3621) (objectui `8d5418e59`)
  - _(no changeset)_ docs(runner): 删掉 runner.mdx 的幽灵目录与「内置示例 schema」断言,重写 Package Information (#3577) (#3616) (objectui `616353ad1`)
  - _(no changeset)_ docs(contributing): 按真实 root scripts 重写三条死的开发服务器命令 (#3596) (#3615) (objectui `ee3b42021`)
  - _(no changeset)_ feat(scripts): check-doc-links 扫描面第三扩 CONTRIBUTING/ROADMAP/docs (#3572) (#3589) (objectui `6632114bc`)
  - _(no changeset)_ docs(runner): 删掉 README 两处虚构能力面,修正 404 文档链接 (#3576) (#3602) (objectui `622c23082`)
  - _(no changeset)_ docs(contributing): 按现状改写文档目录说明,站点源是 content/docs/ (#3584) (#3597) (objectui `74387e314`)
  - _(no changeset)_ chore(scripts): remove dead start-app.mjs, fix stale MetadataLoader comment (#3591) (objectui `39477b03b`)
  - _(no changeset)_ docs(contributing): 按现状改写链接门禁分工,换掉三条死的"正确示例"路由 (#3570) (#3585) (objectui `7a1a449c8`)
  - _(no changeset)_ docs(runner): 记录 `api` 查询参数这一真实的元数据加载配置面 (#3537) (#3581) (objectui `632c07c5b`)
  - _(no changeset)_ fix(tsconfig): 根 tsconfig.node.json 加 noEmit,堵住全仓排放 (#3574) (objectui `c35fed098`)
  - _(no changeset)_ docs: 修正 CONTRIBUTING.md / ROADMAP.md 的 3 条死链 (#3545) (#3571) (objectui `d126607dc`)
  - _(no changeset)_ fix(fields): 编辑弹窗 datetime/date 字段回显存量值 (#3565) (objectui `b785a77b3`)

  objectui range: `7dfbeb704e1e...0cf8f0f70d10`

  <!-- adr-0087: not-required (already-registered dashboard-widget-action-aria-removed) 本条目声明的两处破坏都落在 objectui 自家 npm 包的 TypeScript 导出面（@object-ui/types / core / react / mobile 的类型重命名与 re-export 移除），而 @objectstack/console 发布的是按 pin SHA 构建的冻结 SPA 产物、不转发这些类型入口，所以没有需要新登记的元数据迁移。区间内唯一触及元数据作者面的处方是 dashboard.widgets[] 的 actionUrl/actionType/actionIcon/aria 改为具名报错并附 os migrate meta --from 16 —— 那是 objectstack 自己 protocol-17 的改动，已由 packages/spec/src/conversions/registry.ts 的 dashboard-widget-action-aria-removed 登记（surface 逐字覆盖这四个键，toMajor 17，带 apply 与 fixture），并列在 packages/spec/src/migrations/registry.ts step17 的 conversionIds 中；该条目在 merge base 上即已存在，本 PR 未新增任何台账条目。 -->

- 8607a55: Console (objectui) refreshed to `1bb77aa24514`. Frontend changes in this range:

  - fix(flow-runner): honor a screen field's `visibleWhen` — render and validation (framework#3528) (#2899)
  - fix(i18n): unconditional Chinese in the chatbot confirm card and field inspector (#2884, #2885) (#2900)
  - fix(actions): one precedence for `target`/`execute`, and stop mislabeling server-side `body` (#2896) (#2895)
  - fix(i18n): close the last three zh-branch gaps (#2871, part 3) (#2898)
  - feat(grid): compute all eleven spec column summary aggregations (#2890)
  - feat(console): make `delegated_admin` reachable and narrow both role pickers (framework#3697) (#2891)
  - fix(app-shell): localize the two DeclaredActionsBar strings that bypassed i18n (#2762 P0-3) (#2894)
  - fix(i18n): delete the four `pick({en,zh})` clones (#2871, part 2) (#2893)
  - fix(views): the five per-view-type configs speak the spec vocabulary (#2231 phase 3) (#2892)
  - feat(grid): gate list row Edit/Delete and bulk delete on the effective operation set (objectstack#3720) (#2889)
  - feat(charts): honor `ChartAxis.stepSize`, `ChartConfig.description` and `.height` (framework#3752) (#2888)
  - fix(i18n): retire four hand-rolled zh/en branches (#2871, part 1) (#2887)
  - feat(charts): ObjectChart honors the spec `ChartConfig` author shape (#2880) (#2883)
  - fix(hooks): stop calling translation hooks inside try/catch (#2879) (#2881)
  - fix(charts): a fieldless `count` aggregate keyed its value column `undefined` (framework#3701) (#2878)
  - fix(i18n): make `en` the complete source of truth for grid import and set-password (#2872 b/c) (#2877)
  - fix(auth): localize the ADR-0069 remediation gate and the auth split-panel (#2870) (#2875)
  - fix(metadata-admin): drop the SkillPreview "Required Permissions" panel (framework#3686) (#2874)
  - feat(console): scoped-invitation placement — invite straight into a unit and positions (framework ADR-0105 D8) (#2868)
  - fix(attachments): read the storage service's new error envelope so gated downloads keep their friendly copy (objectstack#3675) (#2869)
  - fix(fls): wire real per-caller FLS into import targets and grid columns, drop dead field.permissions shape (objectstack#3661) (#2866)
  - fix(page,field): consume the spec's type/label/maxLength keys (framework#1878 §3 recheck) (#2867)
  - fix(cloud-connection): localize the Cloud Connection panel (objectstack#3589 follow-up) (#2865)
  - fix(dashboard,charts): send widget query options to the server, order funnel stages by the pipeline (#2864)
  - fix(action): honor the spec disabled predicate on every action-rendering surface (#1885 follow-through) (#2863)

  objectui range: `09c6a177bb4a...1bb77aa24514`

- b96c11b: Console (objectui) refreshed to `2cb8d78e24ad`. Frontend changes in this range:

  - fix(console): dispatch flow actions from every surface + cover the screen-flow round trip (framework#3528) (#2833)
  - feat(approvals): typed output pickers, quick-path guard, expression completion (framework#3447, #2829) (#2831)
  - fix(console): make a paused screen flow completable, and stop the runner from tearing down its host (framework#3528) (#2830)
  - feat(fields): adopt the file-as-reference value shape — ObjectStack ADR-0104 D3 wave 2 (PR-7) (#2828)
  - fix(console): resolve a modal action's `target` as a page, not an object (#3530) (#2826)
  - feat(approvals): dynamic decision-output fields + expression approver editing (framework#3447 P2) (#2827)
  - feat: render the server's effective API operation set (#3391 PR-4) (#2823)
  - fix(console): approval timeline attachment chip shows its name and opens (#2820) (#2821)
  - fix(i18n): localize FileField upload widget + approvals snapshot field labels (#2819)
  - feat(report)!: drop SpecReportColumn/SpecReportGrouping re-exports + retire the legacy ReportViewer chart fallback (#3463) (#2816)
  - feat(plugin-grid): "Import as historical data" option in the Import Wizard (framework #3479) (#2815)
  - feat(app-shell): toast when a save silently dropped read-only fields (framework #3431/#3455) (#2814)
  - fix(app-shell): remove never-firing `record-change` option from the flow trigger picker (#3427) (#2812)
  - fix(form): scroll+focus the first errored field on invalid submit (#2793) (#2813)
  - feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
  - feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
  - fix(approvals): surface the admin override for a stuck request in the inbox (#3424) (#2810)
  - feat(studio): first-class notify flow node in the Studio palette + inspector (#2808)
  - feat(app-shell): Studio flow start node offers a "Record created or updated" trigger (#3427) (#2809)
  - fix: read spec-canonical keys for dashboard header title and field length rules (#2806)
  - fix(kanban): surface off-column records in an Uncategorized lane (#2792) (#2804)
  - fix(approvals): Approval Center density + amount emphasis (#2762 P2) (#2805)
  - fix(i18n): 补齐记录详情审批按钮与弹窗的国际化文案 (#2791)
  - fix(approvals): Approval Center triage + drawer readability pass (#2762 P1-2/3/4/5, P2) (#2803)
  - feat(app-shell): surface step warnings in the Flow Runs panel (#3407) (#2802)
  - feat(studio): surface the enable.searchable toggle in ObjectSettingsPanel (#2800) (#2801)
  - feat(app-shell): localize the automations flow designer & inspector (en-US + zh-CN) (#2796)
  - feat(form): consume spec-aligned FormView buttons/defaults in ObjectForm (#2790)
  - fix(approvals): Approval Center UX pass — badge nowrap, approve confirm, progress bar, localized declared actions (#2762) (#2789)
  - feat(app-shell): group/coalesce repeat notifications in the message center (#2765) (#2788)
  - fix(app-shell): 首页与消息中心的未国际化文案 (#2787)
  - fix(app-shell): give inline `lookup` action params a real record picker (#3405) (#2786)
  - fix(app-shell): map raw sys_activity rows in the inbox Activity tab (#2781) (#2782)
  - fix(app-shell): i18n the "Switch Object" breadcrumb dropdown label (#2783)
  - fix(data-table): keep right-pinned action column header sticky on horizontal scroll (#2785)
  - fix(app-shell): keep list-origin back link when switching detail tabs (#2775)

  objectui range: `cf2d56e32a11...2cb8d78e24ad`

- d69918d: Console (objectui) refreshed to `4a4829d0ef39`. Frontend changes in this range:

  - fix(fields): emit the spec's `$notContains`, and keep `secret` out of inline edit (#2901) (#2940)
  - fix(detail): distinguish "in approval (editable)" from locked, and stop losing write warnings (#2914)
  - fix(types): zod example teaches the Zod 4 `.issues` accessor, and `examples/` is type-checked (#2919) (#2939)
  - fix(plugin-grid,plugin-form,cli,+2): type-check the last five unchecked packages, and fix the two runtime bugs hiding there (#2919) (#2936)
  - fix(views): ListView reads the spec-canonical `filter` (#2890) (#2935)
  - fix(console,runner): render the approvals inbox against one ticking clock, and lint both packages (#2927) (#2930)
  - feat(lint): run ESLint on PRs, and cover every package (#2923) (#2928)
  - feat(setup): the datasource list shows the real connect verdict, with the operator-facing reason (framework#3827) (#2926)
  - fix(fields,core,detail): make the sharing-rule dialog usable — i18n, a picker that lists people, and permission-aware CTAs (#2920)
  - fix(detail): the approval band honors the node's `lockRecord` instead of assuming every approval locks (#2902) (#2906)
  - fix(console): the API console lists the whole AI family, and the tool preview stops linking to a 404 (framework#3718) (#2925)
  - fix(runner): type-check the package at all, fix the hidden DataSource violation (#2917) (#2922)
  - fix(console): the API console's AI group lists the routes that exist (framework#3718) (#2921)
  - fix(plugin-map): drop the `maplibre-gl@6` default import + gate type-check in CI (#2911) (#2915)
  - fix(i18n): compose the AI-model diagnostics summary client-side (#2886) (#2912)
  - fix(flow-designer): read approver value sources off the schema instead of mirroring them (framework#3508 follow-up) (#2910)
  - feat(i18n): complete the locale backfill — all ten packs reach full key parity (#2872) (#2909)
  - fix(list): show real match total in record-count bar under server pagination (#2873)
  - fix(i18n): the change card's Confirm button sent text the cloud gate rejects, + parity ratchet (#2905)
  - feat(i18n): translate the four highest-traffic namespaces into the eight trailing locales (#2872 part a) (#2903)

  objectui range: `1bb77aa24514...4a4829d0ef39`

- 3c416a1: Console (objectui) refreshed to `6314e87f2d49`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 27 releasing of 30 changesets added across 43 non-merge commits; omitted: 3 release-nothing changesets, 14 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — Retire the `global_nav` Studio designer surfaces, and track the `@objectstack` family at `17.0.0-rc.6` (objectstack#7100 / objectstack#6888). (objectui `38ab5054f`)
  - **minor** — One fullscreen long-text editor, hoisted to the package both render paths may import (objectui `cb1340058`)
  - **minor** — i18n: retire the orphaned `report.editor.*` namespace — 105 of its 106 keys, in all ten locale packs (~1050 translated strings) (objectui `fa511094a`)
  - **minor** — `/accept-invitation/:invitationId` is one route, one component, one namespace — the console now renders the invitation page that actually shows you the invitation (objectui `0e67b53ff`)
  - **patch** — Inline-editing an `address` on the record detail page now edits it as real sub-fields, instead of collapsing it to one text box reading `[Object]` and saving a string over the str… (objectui `6314e87f2`)
  - **patch** — An image field's declared `maxSize` is enforced before the upload starts, not after it finishes (objectui `433ff9fd3`)
  - **patch** — A `Field.address` value now reads as a formatted postal address on the record detail page, instead of stringified JSON. (objectui `e2e6360c2`)
  - **patch** — Renaming a freshly-created view now persists — `updateView` reads and writes the same row, instead of reading the published overlay and losing the edit into a rejected partial wri… (objectui `b42558a4c`)
  - **patch** — Using a list's filter panel no longer overwrites the view's source-declared `filter` for everyone (objectui `f8595a054`)
  - **patch** — A list emptied by the view's own filter says "no records match", instead of inviting you to create your first record (objectui `f8595a054`)
  - **patch** — An illegal gantt dependency link now says why it was refused, instead of doing nothing (objectui `e1ade8f03`)
  - **patch** — The gantt's conflict dialog shows the number of affected tasks again, not a literal `{2}` (objectui `828549a9a`)
  - **patch** — An action rendered in the overflow menu, as an icon or inside a group now reaches the runner carrying the same authored keys as the same action rendered inline — `action:menu`, `a… (objectui `d6e5124a3`)
  - **patch** — A rejected Kanban drag rolls the card back on both data ownerships, not just when the board owns its own records (objectui `2c8ad7cdb`)
  - **patch** — ObjectGrid's bulk-bar **Clear** now unticks the row checkboxes, instead of only removing the toolbar (objectui `51ab34e34`)
  - **patch** — Conditional required (`requiredWhen`) now decides at SUBMIT time too — the star and the validator can no longer disagree (objectui `b1e42d09b`)
  - **patch** — fix(app-shell): the top-bar bell polls the inbox on every console surface, not only inside an app (#4110) (objectui `7b0783232`)
  - **patch** — An `autoTrigger` action that spills past `action:bar`'s `maxVisible` now still runs — `action:menu` consumes the flag instead of dropping it. (objectui `debad2796`)
  - **patch** — The first-run setup wizard no longer drops a brand-new owner outside the console (objectui `1f34b3825`)
  - **patch** — The AI build conversation no longer blanks itself the moment the preview opens (objectui `e16fd9597`)
  - **patch** — `features.passkeys` and `features.magicLink` are documented as reserved, so enabling them no longer implies a login-page entry point that does not exist (objectui `564252cd8`)
  - **patch** — `/setup` is a real address again — the console gets a stable deep link into platform administration instead of bouncing you back to home (objectui `b3f665b49`)
  - **patch** — `?runAction=create_environment` is no longer consumed when the environments toolbar has no create action to run it on. (objectui `bf2fd3d1f`)
  - **patch** — The build-history panel tells an operator a 503 means "the commit store could not be reached — retry", instead of `commits HTTP 503` (objectui `f7c6430ec`)
  - **patch** — Stop the report config panel being titled "Title", and the view-settings colour section "Color" (objectui `ff84b0523`)
  - **patch** — Fail when a `t()` call site's arguments are not the holes its `en` value has, and delete the three that were inert (objectui `5f40de7d4`)
  - **patch** — `DatasetWidget`'s option-color / dimension-label probe now rides the host's authenticated fetch (`SchemaRendererContext.apiFetch`) instead of the bare global `fetch`. (objectui `ee7a68d2d`)

  ⚠️ 1 of these carries a breaking change: 1 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 14 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ fix(editor,markdown): complete the vite alias tables so the per-package test task resolves (#4218) (objectui `a9a67ec5b`)
  - _(no changeset)_ ci(turbo): derive the `lint` and `build` inputs guards from each package's real program (#4184, #4185) (#4200) (objectui `a5b1b8917`)
  - _(no changeset)_ ci(turbo): derive the test inputs guard from each package's Vitest config program (#4178) (#4188) (objectui `2b9428338`)
  - _(no changeset)_ ci(turbo): derive the type-check inputs guard from each package's tsc program (#3514) (#4176) (objectui `eb5f8cea0`)
  - _(no changeset)_ docs(ci): pin the 'can never be required, structurally' bullet to the YAML it quotes (#4170) (#4175) (objectui `c27c8981f`)
  - _(no changeset)_ ci(shadcn): close the three declared alarm-channel gaps (#3586) (#4174) (objectui `e63853173`)
  - _(no changeset)_ docs(links): scan the app READMEs and the rest of the repo root (#4148) (#4173) (objectui `da8109300`)
  - _(no changeset)_ chore(site): ignore the AGENTS.md/CLAUDE.md that `next dev` mints, and turn the minting off (#4172) (objectui `0ead48368`)
  - _(no changeset)_ docs(ci): stop the Merge Queue section keeping its own copy of the subscriber list (#4154) (#4171) (objectui `6eb40b8d7`)
  - _(no changeset)_ docs: repair QUICK_REFERENCE's dead commands and layout claims, and pin them (#4149) (#4159) (objectui `521a37bd0`)
  - _(no changeset)_ docs(ci): drop the fourth hand-copy of the object-ui ratchet list, and gate the page (#3782) (#4153) (objectui `492223d9a`)
  - _(no changeset)_ docs: repair and pin QUICK_REFERENCE's Current Release block, drop the console README's hand-written versions (#4143) (#4150) (objectui `43b2e4565`)
  - _(no changeset)_ docs: drop the hardcoded package versions from the utilities pages and correct the data-objectstack README install line (#4125, #4130) (#4144) (objectui `d86d372ad`)
  - _(no changeset)_ docs(console-starter): correct the 'Without a backend' root-route paragraph (#4102) (#4142) (objectui `148ade326`)

  <!-- adr-0087: not-required (already-registered action-global-nav-location-removed) The one breaking entry in this range is objectui#4169, which drops the Studio designer surfaces for the `global_nav` action location. The spec-side retirement of that enum value landed in this repo with objectstack#7100 / #6888 and is already on the ledger as the conversion `action-global-nav-location-removed` (packages/spec/src/conversions/registry.ts) plus its protocol-17 semantic entry; this pin bump ships the console catching up to that decision and changes no spec surface of its own, so it registers nothing new. -->

  objectui range: `92c0b1f403f7...6314e87f2d49`

- 98eec7e: Console (objectui) refreshed to `665661ab0932`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 72 releasing of 78 changesets added across 82 non-merge commits; omitted: 6 release-nothing changesets, 6 commits carrying no changeset (they ship no package code).

  - **minor** — The editable dashboard grid renders dataset-bound widgets — and says so visibly when it cannot (objectui `b8bda9af8`)
  - **minor** — One legacy detector, two dashboard surfaces — the editable grid stops rendering a silent blank chart (objectui `8640cec19`)
  - **minor** — One `SchemaNode`, and one label vocabulary — the union wins, and labels resolve where the locale lives (objectui `c1d939f7f`)
  - **minor** — `BaseSchema.ariaLabel` declares the keyed i18n vocabulary the renderer actually resolves, `.disabled` accepts the predicate string it actually evaluates, and the keyed shape final… (objectui `f65025339`)
  - **minor** — Console chrome reaches the bundle — the list switcher, the aggregate footer, the dialog a11y fallbacks and the whole Settings namespace screen stop being English on non-English co… (objectui `ae10a01b9`)
  - **minor** — fix(core): bare-string filter options — docs/examples stop teaching it, the runtime lift warns (objectui#4356) (objectui `f279debf5`)
  - **minor** — fix(fields): `formatPercent` renders percentage points directly — ties round half-up and extremes keep every digit (objectui `52d878a3b`)
  - **minor** — `BaseSchema.visible` accepts the predicate string the renderer evaluates (objectui `3d9769a31`)
  - **minor** — One home for the number-display policy — and a percent stops meaning two different things between a list cell and a dashboard measure (objectui `92250d648`)
  - **minor** — `ViewNavigationConfig` IS the spec's navigation config — the second spelling stops requiring `mode` (objectui#4588) (objectui `ab04728b0`)
  - **minor** — `NavigationConfig.mode` is optional — the type now says what the hook does (objectui `a84385b47`)
  - **minor** — `exportOptions` is the spec's object form: `streaming` is declared, `'pdf'` is retired, and the alignment comment is finally true (objectui `1f9b90547`)
  - **minor** — `SchemaRenderer` states its real contract — a typed, required `schema` and a deliberate forwarding surface (objectui `3f5f87cc7`)
  - **minor** — Dashboard dataset measures follow the display locale (objectui#4566). (objectui `eb7f586b6`)
  - **minor** — The `DataSource` contract carries `deleteView`'s per-home outcomes (#4564) (objectui `bec3e14cb`)
  - **minor** — `formatPercent` groups its output and follows the display locale — the last tooltip/cell channel (objectui#4553). (objectui `36310dc88`)
  - **minor** — `deleteView` removes every home the view has — deleting a draft-only saved view no longer silently no-ops (objectui `537a0d19c`)
  - **minor** — Kanban: a drop that makes fields required now collects them instead of dead-ending (objectui `fa2125400`)
  - **minor** — `DashboardRenderer` and `ListView` serve the props they declare — the index signature stops erasing them (objectui `7084f7dfc`)
  - **minor** — `MetadataClient.get()` returns the item body its docblock always promised — the field half of the permission matrix is alive again (objectui `479cc7b46`)
  - **minor** — The date formatter's last three en-US channels now follow the display locale (objectui#4272). (objectui `ebb4e0ee3`)
  - **minor** — Publish `normalizeChartSchema` from the package entry. (objectui `5fac01193`)
  - **minor** — The timeline's gantt bucket labels and its row-label default speak the session language (objectui `0082db8fd`)
  - **minor** — Inspectors can block Save — a formula that does not parse no longer saves and publishes as the live field definition (objectui `553099c15`)
  - **minor** — fix(plugin-timeline): dates follow the active locale instead of a hardcoded en-US (objectui `01c918807`)
  - **minor** — An app you are not allowed to open now says so, instead of reporting that it may still be publishing (objectui `932cbcd6b`)
  - **minor** — `calendar-view` has no declared-but-inert inputs left: `allowCreate` works, `colorMapping` is retired (objectui#4454, objectui#4493) (objectui `515328f75`)
  - **minor** — The data lane now honors `set-auth-token`, so impersonation takes effect at all (#4467). (objectui `5cc847c31`)
  - **minor** — fix(plugin-grid): cross-page "select all N matching" replays the host's real query — or abstains — instead of fanning out unfiltered (objectui `7ffd61658`)
  - **minor** — A null-keyed group renders as an explicit bucket instead of silently vanishing from a chart (objectui#4466) (objectui `3fc2971b5`)
  - **minor** — fix(list): an `OBJECT_API_DISABLED` list request renders an honest cannot-work state instead of the empty state (objectui `2e3b0c0ef`)
  - **minor** — fix(detail): lookup field values link to the referenced record (objectui `b953a9702`)
  - **minor** — `chatbot` and `chatbot-enhanced` now pass only whitelisted DOM props to their host element (objectui#4431) (objectui `dde7283e4`)
  - **patch** — fix(components,plugin-dashboard): a static-data `table` widget renders instead of crashing (objectui `a3ae40407`)
  - **patch** — Doc comments no longer cite `@objectstack/spec` symbols the pinned spec has retired (objectui `92876f097`)
  - **patch** — `SpecResponsiveConfig` is now the spec's responsive config rather than a hand copy that said it was (objectui `c9115444b`)
  - **patch** — SpecBridge lifts a legacy bare `exportOptions` array to the spec's object form, so a spec-authored view's declared export formats reach the grid (objectui#4585). (objectui `f148a6499`)
  - **patch** — Console: restore `crypto.randomUUID` on insecure origins so list views stop crashing on LAN IPs (objectui `25b983366`)
  - **patch** — Report and dataset-preview measures follow the display locale (objectui#4575) (objectui `cb315f2a3`)
  - **patch** — Settings save: render the fail-closed crypto refusal as its own state instead of a generic save failure (objectui `36a4124d5`)
  - **patch** — The Studio Data pillar's grid no longer issues a duplicate `find()` on every render (#4567). (objectui `98eb4fc8e`)
  - **patch** — the connector node's Input section derives typed fields from the action descriptor's `inputSchema` (objectui `082ca7bf3`)
  - **patch** — fix(app-shell): every CelPredicateField binds its label, so the RLS row-filter editors have an accessible name (objectui `609820db3`)
  - **patch** — Gantt tooltip numbers and currency follow the display locale (objectui#4553). (objectui `a90888230`)
  - **patch** — The default-inspector family and its panel hosts gate Save on CEL errors — a hook guard, an action predicate or a validation rule that does not parse no longer saves (objectui `298769f46`)
  - **patch** — ObjectGrid's record-detail date fallback follows the display locale (objectui#4541). (objectui `4270c11f3`)
  - **patch** — Gantt tooltip currency re-formats when the tenant currency resolves (objectui#4542). (objectui `db4ad6bb5`)
  - **patch** — All CEL-hosting inspectors block Save on parse faults — a page block or formatting rule whose condition does not parse no longer saves (objectui `dd3adbdc1`)
  - **patch** — `@object-ui/fields` and `@object-ui/plugin-editor` stop publishing their test declarations (objectui `8f60d732e`)
  - **patch** — A row-level-security policy authored under a package is now saved — Studio's package door carries every facet the permission editor can author (objectui `aa45fd771`)
  - **patch** — fix(plugin-grid): the list link column renders a real anchor when the host publishes record URLs (objectui `f56541826`)
  - **patch** — The permission matrix models the server's artifact tier — no Save that 403s on a code-declared set (objectui `878140be9`)
  - **patch** — fix(app-shell): the console record header honors `userActions` predicates (objectui `af52932c6`)
  - **patch** — fix(plugin-grid): the cross-page "Select all N matching" banner works under external pagination (objectui `77d6f2830`)
  - **patch** — The permission matrix honors `allowRuntimeCreate` — and its read-only badge names the gate that actually tripped (objectui `172c73e6e`)
  - **patch** — fix(plugin-detail): the record detail header honors `userActions` predicates (objectui `b3889504e`)
  - **patch** — fix(i18n): every date branch threads the active locale, so a `zh` session no longer renders half its dates in English (objectui `06915b025`)
  - **patch** — The multi-dimension pivot branch buckets a null first-dimension value instead of dropping its bar (objectui#4497) (objectui `aca27fac6`)
  - **patch** — Members & invitations tabs gate their affordances by org role instead of letting the server's 403 be the UI (#4475) (objectui `6d641c9df`)
  - **patch** — The console shows a standing impersonation banner, with an exit that fails loudly (#4467). (objectui `5cc847c31`)
  - **patch** — fix(plugin-list): ListView hands the child grid the query behind the window it passes down (objectui `7ffd61658`)
  - **patch** — A dashboard chart's null-value bucket now reads the app's language instead of the English `(None)` (objectui `54d34d2a1`)
  - **patch** — Dashboard global filters sourced from `optionsFrom` now commit the RAW value instead of the display label. (objectui `844ed3aea`)
  - **patch** — `object-calendar` / `view:calendar`: the renderer now consumes or declares every prop it forwards, instead of spreading the authored node into `ObjectCalendar` (objectui `3e579d692`)
  - **patch** — Organization & invitation console: translate the English holdouts a zh session was left reading (#4474) (objectui `58bebf638`)
  - **patch** — `calendar-view` consumes or declares every prop it forwards — an authored `onEventClick` can no longer crash a click (objectui `c5756ff40`)
  - **patch** — `DashboardRenderer`'s widget grid now passes only whitelisted DOM props to its container (objectui#4432) (objectui `0bf3f44a4`)
  - **patch** — fix(print): `window.print()` produces a usable page, and the Print buttons say what they do (objectui `31ab1ac9d`)
  - **patch** — authored ISO `currentDate` reaches the calendar as a `Date`; unparseable input falls back to the default instead of crashing (objectui `395e154a6`)
  - **patch** — console: an inaccessible landing app bounces to `/home` instead of stranding the user on a chrome-less page (objectui `bc77f7d3d`)
  - **patch** — "Set as Default" and drag-reorder work again on saved views — the adapter's `updateView` was being called unbound (objectui#4463). (objectui `338e2c421`)
  - **patch** — The copied invitation link is one the recipient can actually open — both copy sites resolve through the console mount instead of rebuilding it from `BASE_URL` (objectui `a610bf2ff`)

  **In this console build, declared nowhere** — objectui merged 6 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ fix(examples): catalog entries author the keys their renderers read (#4624) (#4630) (objectui `665661ab0`)
  - _(no changeset)_ fix(site): the catalog gallery registers every plugin its entries need (#4616) (#4628) (objectui `69eb6b22b`)
  - _(no changeset)_ fix(examples,docs): the dashboard gallery renders working charts again — filtered-\* entries leave the retired shape (#4600) (#4615) (objectui `e028dfcd8`)
  - _(no changeset)_ fix(site): SchemaNode crosses to SchemaRenderer through the bridge — the docs site builds again (#4617) (#4621) (objectui `3dc9a8233`)
  - _(no changeset)_ docs(plugin-list): the sort remedy names a stored denormalised field, not a formula (#4335) (#4560) (objectui `794dd1c4b`)
  - _(no changeset)_ chore(types): bring e2e/ under a tsconfig; fix what 30 never-compiled specs accumulated (#4471) (#4478) (objectui `5ad7f7730`)

  objectui range: `6d77acfe3125...665661ab0932`

- a0151e9: Console (objectui) refreshed to `6d77acfe3125`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 99 releasing of 115 changesets added across 123 non-merge commits; omitted: 16 release-nothing changesets, 11 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — `rowHeightToDensityMode` answers only for the five spec row heights — the coerce-to-`comfortable` fallback is gone (objectui `fe52a0406`)
  - **minor** — **BREAKING** — `bridgeListView` maps the five row heights the spec admits, and only those — the four dead spellings are gone (objectui `d7f3e308b`)
  - **minor** — **BREAKING** — The action renderers publish the modern `UIActionSchema`, and every `forwardRef` renderer's props parameter is annotated so its declared types survive (objectui `dc2aa3e77`)
  - **minor** — `MetricWidgetProps` / `MetricCardProps` declare the DOM pass-through their spread has always accepted (objectui `f24427334`)
  - **minor** — `useObjectChat` declares the message shape it actually hands back (objectui `eec2e4fd1`)
  - **minor** — grid row menu — the built-in Edit/Delete predicate declarations are derived from the spec-owned authoring type, not hand-restated (objectui `24bb2de4f`)
  - **minor** — **BREAKING** — Retire two post-retirement dead surfaces (#4364, #4368). Both were measured at this branch point rather than taken from their cards, and one card's premise only half held. (objectui `2a40f699d`)
  - **minor** — **BREAKING** — Retire `ActionEngine`'s event-mapping API (objectui#3368). `ActionEngine.addMapping()`, `ActionEngine.dispatch()`, the private `mappings` registry behind them, and the exported `A… (objectui `2459a3e70`)
  - **minor** — i18n: retire the reader-less `common.search` key from all ten locale packs (objectui `ac853ce92`)
  - **minor** — **BREAKING** — `@object-ui/plugin-chatbot`'s `ChatMessage` is now one type instead of two (objectui `3256b141f`)
  - **minor** — **BREAKING** — Retire four zero-consumer declared surfaces (dead-surface sweep batch 3, #4328). Each was measured as declared-but-never-read at the branch point, and each is removed rather than… (objectui `d9d346307`)
  - **minor** — fix(app-shell): a transient 404 no longer retires the shared inbox feed for the page's lifetime (objectui `ca269fecd`)
  - **minor** — console: seed the UI language from the tenant's server-side locale (objectui `78fa33141`)
  - **minor** — ObjectGrid's host-driven pagination mode is a declared interface instead of twelve `(rest as any)` reads (objectui `51ac39f73`)
  - **minor** — `resolveHostAppSegment` is published from `@object-ui/app-shell`'s package root, and the console's local copy of it is deleted (objectui `e4d1c085e`)
  - **minor** — An unloadable app list no longer lands you on `/home` as though you had no default app — and the Applications page's Set-as-default / Disable / Delete now actually write (objectui `3b7d1cc6d`)
  - **minor** — **BREAKING** — Close `ActionDef` — delete the `[key: string]: any` index signature and converge `visible` / `disabled` on the spec's unified shape. (objectui `ee66e2ebf`)
  - **minor** — Internal `/forms/:name` renders inside the console shell, and an internal submit lands on the record it just created (objectui `90e792e11`)
  - **minor** — The console's language menu now asks the app which locales it actually ships, instead of always offering the same ten. (objectui `66fb4fae2`)
  - **minor** — **BREAKING** — data-objectstack: retire the phantom `CloudOperations` surface — the class, its three `Cloud*` types, and the module that claimed to integrate a cloud namespace no client has ever… (objectui `2776b110b`)
  - **minor** — `element:record_picker` publishes `sort`, `limit` and `emptyText` as authoring inputs (objectui#4167). (objectui `bb68488ff`)
  - **minor** — **BREAKING** — Stop declaring 14 symbols under names `@objectstack/spec` owns at `17.0.0-rc.6` (objectui#4167, objectstack#4115). (objectui `bb68488ff`)
  - **patch** — fix(react): the spec bridge abstains on a non-string `rowHeight` instead of coercing it to a density, matching core (objectui `47f551b06`)
  - **patch** — `element:button`'s action forward is excess-property checked again — a misspelled key on that payload is now a compile error, not silence (objectui `b4d3c2204`)
  - **patch** — standalone ObjectGrid resolves off-spec `rowHeight` to compact, matching ListView and the spec bridge, instead of silently styling it as medium (objectui `5e514c424`)
  - **patch** — The spec bridge abstains on prototype-member `rowHeight` spellings instead of leaking a function into `density`. (objectui `8f85f8bed`)
  - **patch** — fix(plugin-calendar): authoring `events` on a `calendar-view` node no longer takes the calendar down (objectui `49b9de6a6`)
  - **patch** — Every plain `<button>` now declares its `type`. HTML defaults an untyped button to `type="submit"`, so any of these buttons would submit the form it was composed into instead of r… (objectui `d0c3b26ca`)
  - **patch** — `AiChatPage` narrows the chat hook's messages through the exported `toRuntimeMessages` adapter instead of five casts (objectui `d8d0d665d`)
  - **patch** — KPI cards no longer write their own schema onto the DOM — `MetricWidget` and `MetricCard` keep `SchemaRenderer`'s schema-shaped props out of the `...props` spread (objectui#4357). (objectui `306c10136`)
  - **patch** — fields: the currency adornment has one symbol channel (objectui `3a9021e26`)
  - **patch** — `@object-ui/components` compiles under `noImplicitAny` — the workspace's last strict-relaxing package (objectui `4dadf0d3d`)
  - **patch** — data-table row menu — the built-in Edit/Delete predicate parameters are derived from the authoring type, not hand-restated (objectui `4b70d287c`)
  - **patch** — Replace the three `messages as any` casts at the `@object-ui/types` ↔ `@object-ui/plugin-chatbot` `ChatMessage` boundary with one explicit typed adapter (`toRuntimeMessages` / `au… (objectui `37bbc42d1`)
  - **patch** — Currency amounts now follow each currency's own ISO 4217 fraction-digit convention instead of a hardcoded 2 (objectui#4361). (objectui `0f2134831`)
  - **patch** — Analytics: `ObjectChart` consumes the shared label-net helpers instead of a third copy (objectui `0b49d6032`)
  - **patch** — Inline-edit toggle reads "Edit fields" without an I18nProvider, matching every locale pack (objectui `e076fd50f`)
  - **patch** — `@object-ui/plugin-detail` now declares `react-router-dom` as a peer dependency (`^6.0.0 || ^7.0.0`), the range its three siblings already use. (objectui `456aac831`)
  - **patch** — refactor(app-shell): collapse the metadata-admin designer table's byte-identical key pairs (objectui `f762f5bdf`)
  - **patch** — Analytics: the dimension label net's fetch-and-memo glue is written once, not once per surface (objectui `ee26e65e7`)
  - **patch** — Six i18n keys no longer render as raw key strings on hosts with no `I18nProvider` (objectui#4396) (objectui `dad805d8f`)
  - **patch** — Publishing a view from the console no longer serves a five-minute-stale override map — every writer now routes through one invalidation seam (objectui `d2f6e6b1b`)
  - **patch** — `ActionParamDialog`'s `select` branch no longer renders a hardcoded English `Select...` placeholder. The fallback used when an action param declares no `placeholder` of its own no… (objectui `5bf09fdba`)
  - **patch** — i18n: the two search placeholders become pack values, and four values the packs served in English get translated (objectui `bb58d1d61`)
  - **patch** — Analytics: a LOCAL select dimension on a table / pivot widget — and on a dataset-bound report — now renders its option label through the locale bundle (objectui `326a70f32`)
  - **patch** — A gantt task titled `A$&B` no longer prints `{{title}}` back into its own delete dialog — the two hand-rolled provider-less fallback interpolators are literal, like i18next (objectui `0ca6096ff`)
  - **patch** — fix(app-shell): the metadata-admin designer's own i18n table uses the typographic ellipsis (objectui `b31827358`)
  - **patch** — i18n copy: one ellipsis glyph across the ten packs, `usted` in the es draft-preview empty state, and a pt sentence that stops contracting `de` onto its own hole (objectui `3e19fe78a`)
  - **patch** — i18n: `createSafeTranslation`'s provider-less fallback now honours a call site's inline `defaultValue` (objectui `d46f9b8c4`)
  - **patch** — Every view write path now invalidates the override map — a created, renamed or deleted view is no longer shadowed by a five-minute-stale batch read (objectui `85a3082e6`)
  - **patch** — `detail.showEmptyRelated` renders Russian and Arabic again — the "+N empty" button no longer falls through to English at the counts it takes most often (objectui `2fea4d2fa`)
  - **patch** — Retire the dormant bespoke object-detail page factory and its seven widgets (objectui `275d7df13`)
  - **patch** — fix(fields): `formatCurrency` keeps both cents digits on a fractional amount (objectui `d2e2caf40`)
  - **patch** — `pickLocalized` reads own properties only, and takes only string values, on every limb (objectui `405e80875`)
  - **patch** — fix(dashboard,i18n): KPI cards and dashboard filters resolve authored labels instead of dropping them (#4032) (objectui `7e4f0e530`)
  - **patch** — Home's action centre badges everything that is waiting, not the five rows it has room for (objectui `de627792e`)
  - **patch** — The Applications page's search box no longer takes the page out on the first keystroke when an app carries a non-string label (objectui `3b4d78ea0`)
  - **patch** — The console's Applications page is localized — its own chrome only, never the server's words (objectui#4307). (objectui `734d186a0`)
  - **patch** — Studio's read-only packages stop advertising writability they do not have — the `access` header badge and the `Data → Form` layout caption now report the gate that actually govern… (objectui `f046f885a`)
  - **patch** — List sort: the relational hint stops recommending a formula field, the one type the server refuses to sort by (objectui `7f1cb3323`)
  - **patch** — Numbers render in the user's locale, and a `Field.number` year is no longer `2,026` (objectui `45e1949b4`)
  - **patch** — `record:related_list` and the detail synthesizer now declare two shapes they already accepted at runtime. (objectui `63fe8fdda`)
  - **patch** — Home's action centre stops counting messages the user has already read, and the inbox is read once per page instead of twice (#4316, #4225) (objectui `bed18a5c2`)
  - **patch** — `object-map` reads its configuration from the declared `map` input only — `filter` is the query filter, and a map authored with both stopped rendering markers (objectui `b388d0eb0`)
  - **patch** — Analytics surfaces now run resolved select-option labels through the locale bundle — the chart legend and the related list on one page stop disagreeing (objectui `5900ac56f`)
  - **patch** — Home's action centre no longer says "You're all caught up" to a user whose inbox it failed to read (#4235) (objectui `771466aa5`)
  - **patch** — Action confirm dialogs and success toasts now honour the bundle's translated `confirmText` / `successMessage`, not just `label` (objectui#4265). (objectui `ceccdcfa3`)
  - **patch** — A collapsed sidebar now survives a reload — `SidebarProvider` reads the `sidebar_state` cookie it has always written (objectui `f5e114348`)
  - **patch** — Form actions no longer carry a record id across an object boundary (#4292). (objectui `9461dd395`)
  - **patch** — API Console renders the Storage group again — its catalog key now names the canonical `file-storage` slot instead of the route (objectui `a00d23c0d`)
  - **patch** — List sort: the picker stops borrowing the filter whitelist, and a header click is no longer a one-way door out of the view's declared sort (objectui `33c32bf33`)
  - **patch** — Dashboard `combo` widgets draw as combos on the dataset path — the dataset owns the data, the author owns the presentation (objectui `3c6e84cca`)
  - **patch** — A `type: 'form'` action fired from a record now EDITS that record instead of creating a duplicate (objectui `6d8231cc4`)
  - **patch** — fix(plugin-detail): synthesize page components in the spec's `properties` carrier so Studio page-create can persist (objectui `35997cea5`)
  - **patch** — `DeclaredActionsBar` reads `visible` / `disabled` off the typed action def instead of through `(action as any)`. (objectui `ee66e2ebf`)
  - **patch** — Pivot buckets encode an empty dimension value as JSON `null`, so it no longer collides with a row whose value is literally the placeholder character (objectui `49ae9f42d`)
  - **patch** — fix(dashboard): resolve a dotted dimension's labels on table and pivot dataset widgets (objectui `436681e72`)
  - **patch** — `DeclaredActionsBar` binds its row through the shared `usePredicateRecordContext` (objectui `4cb0562b5`)
  - **patch** — `list-view` now reads its `dataSource` binding through the shared `ElementDataSourceGate` instead of a private copy of the precedence table (objectui `37cd8e4ff`)
  - **patch** — metadata-admin: diagnose a path on the right-hand side of `==` / `!=` in a visibility predicate (objectui `b95412031`)
  - **patch** — A dataset dimension on a dotted relationship path now renders its option labels instead of the raw stored enum (objectui `613b16707`)
  - **patch** — Retire `params.newTab` on a url action — `openIn: 'new-tab'` is the sanctioned spelling (objectui `d6aa1726a`)
  - **patch** — The second metadata client class surfaces the runtime authoring gate's advisories instead of discarding them (objectui `605b74720`)
  - **patch** — fix(console): a Setup-only environment lands on `/home`, not Setup's all-zero System Overview (objectui `234238ed7`)
  - **patch** — `richtext` fields are placed like the long-form fields they are — four layout sets stopped spelling the type three ways the spec rejects (objectui `c32a8a1bf`)
  - **patch** — A dependency-gated option list no longer deletes the field's stored value on mount (objectui `bc64bfe0f`)
  - **patch** — Inline edit no longer offers a record picker for a spec-spelled `autonumber` field that carries a `reference_to` (objectui `6d01319dd`)
  - **patch** — metadata-admin: retire the standalone `validation` resource, and move `ValidationPreview` onto the embedded path the framework actually evaluates (objectui#4132) (objectui `3032107dd`)
  - **patch** — `record:details` stops publishing a `layout` key the spec removed and the renderer never honoured (objectui `7d04b0e84`)
  - **patch** — The Unpublished-app banner now reads the ADR-0045 publish gate `_unpublished`, not the navigation flag `hidden` — so a published app that is merely kept out of the launcher no lon… (objectui `690ae0f04`)
  - **patch** — fix(detail): inline edit no longer destroys array values or flattens types on the record page (objectui `e7663f2ff`)
  - **patch** — A dashboard date filter's default has one spelling again — the bare preset name — and the `{ preset }` object becomes a documented legacy alias with a retirement window (objectui `abb0f81d3`)
  - **patch** — The bell popover's and Home's "see all" drills open inside an app the user can actually open, not the setup app (objectui `f812de6bd`)
  - **patch** — A `password` or `secret` field on the record detail page is no longer inline-editable: it renders no pencil / double-click affordance and produces no editor, on both the details b… (objectui `5e2e9fa8c`)
  - **patch** — `DatasourcePreview` no longer renders three key groups `DatasourceSchema` rejects (objectui#4131). `retryPolicy`, `healthCheck` and `capabilities` were removed from the datasource… (objectui `ab37c5f59`)
  - **patch** — Set-default on a saved view fires its write again — a stored `id` can no longer rename the tab out from under the overlay read (objectui `79a40adae`)
  - **patch** — The bell's Approvals and Activity tabs fill in on Home, Organizations and the AI screen — from the same fetch the cards below them already use (objectui `8b971f826`)
  - **patch** — Studio surfaces the runtime authoring gate's advisory findings instead of discarding them client-side (objectui `c0f9a4bd5`)
  - **patch** — An inline per-locale label now renders its locale's string at the thirteen read sites the `@objectstack/spec` 17.0.0-rc.6 bump exposed (objectui `bb68488ff`)

  ⚠️ 10 of these carry a breaking change: 10 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 11 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ chore(lint): bring e2e/ under the lint gate; fix the 3 errors it exposes (#4456) (#4470) (objectui `6d77acfe3`)
  - _(no changeset)_ fix(scripts): check-type-check-coverage sees a chain entry whose project is missing (#4347) (#4449) (objectui `8b33a42af`)
  - _(no changeset)_ docs(agents): state the git stash ban in AGENTS.md §9 as a rule of its own (#4448) (objectui `c7360f6f8`)
  - _(no changeset)_ chore(config): retire the dead tailwind.config.js eslint ignore; reword the postcss blind-spot docblock (#4350) (#4444) (objectui `6a0f4a598`)
  - _(no changeset)_ docs(tests): qualify the last two present-tense paths-ignore twins (#4384) (#4395) (objectui `2329d9032`)
  - _(no changeset)_ docs: resolve the four suspected-dead repo paths in content/docs prose (#3867) (#4393) (objectui `2f58c8ba2`)
  - _(no changeset)_ docs(ci): close the falsified paths-ignore sweep — three named sites plus five found (#4381) (#4382) (objectui `079f15571`)
  - _(no changeset)_ docs(ci): correct the four remaining copies of the falsified paths-ignore premise (#4369) (#4380) (objectui `63c75d0fd`)
  - _(no changeset)_ docs: correct the paths-ignore claim in three agent-facing texts, and the metadataTypeRegistry verdict (#3857, #3859) (#4371) (objectui `1bbd856e0`)
  - _(no changeset)_ chore(config): delete three Tailwind config files nothing reads (#4065, #4066) (#4349) (objectui `78b6c4a88`)
  - _(no changeset)_ docs(agents): require commit-then-revert for reverse verification (#4301) (#4339) (objectui `c880799bc`)

  <!-- adr-0087: not-required (no-migration-prescription) All ten declared-breaking entries in this range are TypeScript declaration surfaces of objectui's OWN npm packages, judged one by one against their upstream changesets rather than as a batch: `@object-ui/core` (`rowHeightToDensityMode`'s coerce-to-`comfortable` fallback; `ActionEngine.addMapping()` / `dispatch()` / the `ActionMapping` interface; `ActionDef`'s `[key: string]: any` index signature), `@object-ui/react` (`bridgeListView`'s four `rowHeight` spellings `RowHeightSchema` never admitted), `@object-ui/components` (six exported action declarations moving from the deprecated `ActionSchema` to `UIActionSchema`), `@object-ui/types` + `@object-ui/permissions` (`ObjectLevelPermission` and the batch-3 zero-consumer surfaces), `@object-ui/plugin-chatbot` (`ChatMessage` collapsing from two exported types to one, a widening), `@object-ui/data-objectstack` (the phantom `CloudOperations` class and its three `Cloud*` types), and the fourteen symbols renamed off names `@objectstack/spec` owns at `17.0.0-rc.6`. None of them is reachable through `@objectstack/console`, which publishes a frozen prebuilt SPA: its `files` list is `["dist", "README.md", "CHANGELOG.md"]` and its sole `exports` entry is `./package.json`, so it forwards no `@object-ui/*` module entry point and re-exports none of these types. No `packages/spec` schema, authorable metadata key or protocol surface changes in this range, so there is no stored-metadata rewrite for `objectstack migrate meta` to prescribe and therefore no ADR-0087 ledger entry to write or to name. Where a prescription does exist it runs the opposite way and is already this repo's own: `ActionDef`'s unified three-arm `visible` / `disabled` shape and the fourteen renamed symbols are objectui CATCHING UP to spec `17.0.0-rc.6`, whose spec-side halves landed in objectstack's own PRs and were disposed of there. This bump adds no ledger entry and claims none. -->

  objectui range: `6314e87f2d49...6d77acfe3125`

- 072806a: Console (objectui) refreshed to `785b8a5d432c` — the 2026-08-02 objectui batch reaches v17 (#4665).

  Until this pin moves, a merged objectui fix exists only on objectui's `main`: the
  release pipeline clones objectui at `.objectui-sha`, so anything newer is simply not
  in the artifact the platform ships, and its frontend changeset never reaches the
  platform's release history (#3340). Four of the seven PRs merged that day changed
  published packages, and one of them is **breaking for authoring** — so that
  migration is written out here, in the layer the release notes are compiled from,
  rather than left implicit in a SHA.

  ## Breaking for authoring — an action param's picker target is `reference`, and only `reference` (objectui#3203)

  `ActionParam` in `@object-ui/types` no longer declares the nine resolved-side picker
  keys: `referenceTo`, `displayField`, `idField`, `descriptionField`, `titleFormat`,
  `lookupColumns`, `lookupFilters`, `lookupPageSize`, `dependsOn`.

  Migration:

  - **Inline picker target** — rewrite to `reference`:
    FROM `{ name: 'account_id', type: 'lookup', referenceTo: 'account' }`
    TO `{ name: 'account_id', type: 'lookup', reference: 'account' }`
  - **The other eight** — make the param **field-backed** and it inherits the whole
    picker group from the object field: `{ field: 'account_id' }`.

  **This removes a compile-time illusion, not a capability.** Those keys were never
  storable: `@objectstack/spec`'s `ActionParamSchema` is `.strict()`, its authorable key
  list carries `reference` and not `referenceTo`, and its alias table names
  `referenceto → reference` by hand — so an authored `referenceTo` has always been a
  hard parse rejection on the server. Only `tsc` waved it through, against objectui's
  public type, which meant the mistake surfaced at publish time instead of at the
  authoring keystroke. `ActionParam` is now derived from the spec schema
  (`Omit< z.input< typeof ActionParamSchema >, 'type' >`), so the authoring type and
  the parser can no longer disagree about a spelling, and `resolveActionParams()`
  additionally names any resolved-only key it meets in a dev-mode warning with the
  prescription above — covering params authored in plain JS or JSON, which `tsc` never
  sees.

  ## Also author-visible in this batch

  - **An unrecognised dashboard date-filter value is skipped and named, not compared**
    (objectui#3196, `@object-ui/core` minor — the other half of #4475). A `date` /
    `dateRange` value that is neither a known preset nor a parseable date used to fall
    through to "bare string means equality on that day", so a typo
    (`defaultValue: 'last_7_dayz'`) reached the backend as `WHERE created_at = $1` and
    answered `200 OK` with zero rows — indistinguishable from "this range has no data".
    Such a filter is now dropped with a `console.warn` naming the filter, the offending
    value and the accepted spellings; the widget's numbers go from 0 to unfiltered.
  - **`record:activity` fetches a feed instead of rendering a permanently empty one**
    (objectui#3204, `@object-ui/plugin-detail`). The block's eleven declared inputs were
    filters over a hard-coded `items={[]}`; the feed now resolves from `items` → a
    mounted `DiscussionContext` → a self-fetch of `sys_activity` scoped to the bound
    record, and the read-side inputs actually filter. `showSubscriptionToggle` is
    labelled `NOT IMPLEMENTED` in its own input description rather than left looking
    configurable.
  - **A fetching activity feed says "loading", not "No activity recorded"**
    (objectui#3210, `@object-ui/plugin-detail` patch). The declared `loading` prop was
    destructured into `_loading` and never read, so the panel asserted the record had no
    activity for the whole duration of every fetch.
  - **`managedBy: 'system'` → `'system-data'` follow-through** (objectui#3214): the
    Console now speaks the vocabulary this platform's retirement left standing.

  Full frontend range below. `fix(ci)` / CI-only commits are omitted — they release
  nothing and are not in the shipped bundle.

  - fix(fields)!: FieldWidgetComponentProps stops claiming to have every key (#3221) (#3230)
  - fix(app-shell): inspectors read and write the expression envelope (#3218) (#3228)
  - fix(app-shell): flow simulator evaluates a `{ dialect, source }` edge guard (#3216) (#3217)
  - feat(types,core,app-shell)!: follow the `managedBy: 'system'` → `'system-data'` retirement (objectstack#3355) (#3214)
  - fix(app-shell): flow branch editor stamps an id on the edges it creates (#3202) (#3215)
  - fix(plugin-detail): a fetching activity feed says "loading", not "No activity recorded" (#3205) (#3210)
  - feat(plugin-detail): record:activity fetches a feed instead of rendering an empty one (#3165) (#3204)
  - fix(types,app-shell)!: `reference` 是 action param 唯一可作者化的 picker 目标 (#3174) (#3203)
  - fix(deps): #3184 可合并版 —— focus-scope 栈驱逐竞态补丁,解冲突 + 补丁存废说明 (#3200)
  - fix(core): 未知的 date filter 值改为跳过并警告,不再降级成永不命中的等值 (#3151) (#3196)
  - fix(types): retarget the objectstack#4171 inverted pins at their real trigger (#3177) (#3194)
  - fix(components,grid): a grid's search box searches the list, not the page you can see (#3118) (#3192)
  - feat(core): declare the 18 spec-owned action keys ActionDef absorbed silently (#3190)
  - fix(app-shell): actually compile `spec-symbol-parity.test.ts`'s type assertions (#3181) (#3187)
  - feat(app-shell): wire navigation action items to the console action runtime (framework#4509) (#3180)
  - feat(deps)!: upgrade to @objectstack/spec 17.0.0-rc.1 and retire the wait timeout fields (#3101) (#3178)
  - fix(studio,timeline,list): 表单设计器解析对象翻译；timeline 认它自己配置的日期字段 (#3134, #3129) (#3175)
  - feat(flow-designer)!: the script node authors a function call, and nothing else (framework#4343) (#3170)
  - fix(studio): stop offering the retired `action.shortcut` / `action.bulkEnabled` keys (#3154)
  - fix(dashboard): date 型 globalFilter 的预设名默认值应提升为区间 (objectstack#4475) (#3150)
  - fix(dashboard,report): honor the declared percent scale so a ratio of 1 renders as 100.0% (#3136) (#3140)
  - fix(charts): name the slices — pie/donut legends lost their labels to a `type` dimension (#3135) (#3138)
  - fix(approvals): record-header Reject fires after one dialog again (#3126) (#3128)
  - fix(console): binding-reach 探针少报了自己 6 个块的覆盖面，而且是静默的 (#3149) (#3153)
  - fix(flow-designer): the default path is the edge marker, not the branch (#3148)
  - fix(plugin-list,plugin-form): 在注册表路径上把 dataSource 接到 list-view / embeddable-form (#3144) (#3147)
  - fix(actions): one placement rule for `locations` — declare it or it renders nowhere (#3145)
  - fix(app-shell): datasource preview 不再报告读副本数量 (objectstack#4468) (#3143)
  - feat(grid): aggregate single-call mode for bulk actions — execution: 'aggregate' (#3141)
  - fix(form): `required` is presence, not truthiness — `false` and `0` are values (#3137)
  - fix(environment): localize the entitlement dialog + read cloud's nested error envelope (#3130)
  - fix(i18n): resolve qualified view ids (#3132)

  objectui range: `7d9734d5e321...785b8a5d432c`

- 302e972: Console (objectui) refreshed to `7d9734d5e321`. Frontend changes in this range:

  - feat(core): say which column identity key won, out loud (#3104 PR3) (#3124)
  - fix(detail): Attachments become a peer tab with a live count badge, and their copy is translated (objectstack#4358) (#3123)
  - fix(console,app-shell): readable reassign hand-off + "System" label for svc:\* audit actors (objectstack#4365, objectstack#4366) (#3121)
  - fix(fields): lookup multi-value hydration batches via $in and shows loading instead of the empty placeholder (#3108) (#3120)
  - fix(list,grid,detail,tree,core): every column resolver reads one key (#3104 PR2) (#3122)
  - fix(core,list): 列身份归一到 ingestion chokepoint — 一列一个身份 (#3104 PR1) (#3119)
  - fix(detail): a related list has one sorting semantics instead of two (#3106) (#3113)
  - feat(components,grid,list): a column-header sort orders the whole list, not the page you can see (#3106) (#3112)
  - fix(data-objectstack): a string `$orderby` reaches the server as a sort, not a list of character indices (#3106) (#3109)
  - fix(types,core): the `*Validation` five derive from spec 17, and the engine stops disagreeing with the server (#3103) (#3107)
  - fix(app-shell): lookup-param helpText only renders when the param actually degraded to a raw-id input (#3094) (#3095)
  - fix(form): numeric/boolean option values survive selection typed (#3090 PR3b) (#3100)
  - fix(list,detail): sorting a lookup column stops ordering by an invisible key (#3096) (#3102)
  - feat(flow-designer): the script node's form authors what the executor runs (framework#4278) (#3099)
  - fix(form): declare the runtime field metadata slot, ban the spec FormField misimport (#3090 PR3a) (#3097)
  - fix(console): LocalizationFetchProvider retries a transient /me/localization failure (#3098)
  - fix(app-shell,i18n): drop the developer-voiced default form subtitle (#3093)
  - fix(form): spec-vocabulary fields stop crashing the standalone form; every surface names the boundary (#3090) (#3092)
  - fix(form): harden the spec↔runtime form-field chokepoint, derive SelectOption, complete FormFieldSchema (#3090) (#3091)
  - fix(types,layout): navigation metadata stops losing the spec fields the renderer already honours (objectstack#4115) (#3088)

  objectui range: `bebaebd39ace...7d9734d5e321`

- 7fa2aae: Console (objectui) refreshed to `8aad9fd50b16`. Frontend changes in this range:

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

- 24d22f4: Console (objectui) refreshed to `92c0b1f403f7`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 13 releasing of 16 changesets added across 29 non-merge commits; omitted: 3 release-nothing changesets, 13 commits carrying no changeset (they ship no package code).

  - **minor** — `DatasetResultField` is now `@objectstack/spec`'s `AnalyticsResult.fields[]` element itself, not a hand-written restatement of it (objectui `e9011318f`)
  - **minor** — fix(fields,plugin-form): stop the inline child grid from collapsing `datetime`/`time` columns onto the `date` control (objectui `1bd6faa61`)
  - **patch** — `ObjectChart`'s category option-color / dimension-label probe now rides the host's authenticated fetch (`SchemaRendererContext.apiFetch`) instead of the bare global `fetch`. (objectui `bcd3e0219`)
  - **patch** — Align 43 inline `defaultValue` strings with the `en` pack, and make the call-site gate enforce it (objectui#3810) (objectui `297534b78`)
  - **patch** — Fix `objectui init`'s scaffold failing its own `npm run build`, and put the third generator under the real `tsc` gate (objectui `64cda47e7`)
  - **patch** — `element:record_picker.filter` is now discoverable from the published `inputs` (objectui `bfdf3d419`)
  - **patch** — Make the generated temp app pass the strict `tsconfig.json` the generator writes beside it, and gate it with a real `tsc` (objectui `9b9fa4961`)
  - **patch** — List row Edit/Delete, bulk delete and related-list CRUD now run the caller's own permission, not just the object's API exposure (objectui#4096) (objectui `aeb8424ba`)
  - **patch** — metadata-admin: wire client-side Zod validation for `sharing_rule`, `translation` and `connector` (objectui#3561) (objectui `877385a76`)
  - **patch** — `evalRowPredicate`: the fail-closed report now names the engine's failure reason, and the ROW always wins over host scope (objectui#3792, objectui#3796) (objectui `6bb454ac0`)
  - **patch** — Move the generator templates' dependency ranges onto the repo's current ones (objectui `c29ceffb8`)
  - **patch** — A required field whose `defaultValue` is a runtime token is submittable from a create form (objectui `8497579db`)
  - **patch** — `object-grid` publishes the filter key it actually reads: `filter`, singular (objectui#4041) (objectui `9154d9e90`)

  **In this console build, declared nowhere** — objectui merged 13 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(data-objectstack): document the real headless surface, not a phantom React API (#4129) (objectui `92c0b1f40`)
  - _(no changeset)_ fix(scripts): rewrite demo imports by usage, and clear the 106 stale ones (#4116) (objectui `e9ab52f90`)
  - _(no changeset)_ docs(data-objectstack): describe the real dependency contract, not a peer one (#3781) (#4127) (objectui `1b6188d41`)
  - _(no changeset)_ chore: release packages (#3598) (objectui `cfeb378b5`)
  - _(no changeset)_ fix(console-starter): close the vite alias table over its real import graph (#4103) (objectui `0af9826ab`)
  - _(no changeset)_ chore(deps-dev): bump the dev-dependencies group across 1 directory with 7 updates (#4088) (objectui `1592b2124`)
  - _(no changeset)_ test(e2e): the console smoke test asserts a boot state the app actually settles in (#4086) (#4095) (objectui `361dfdc01`)
  - _(no changeset)_ chore(deps): bump next from 16.2.12 to 16.3.0 (#4094) (objectui `47737ecb3`)
  - _(no changeset)_ chore(deps): bump lucide-react from 1.28.0 to 1.29.0 (#4091) (objectui `a49a3a008`)
  - _(no changeset)_ chore(deps): bump shiki from 4.3.1 to 4.4.2 (#4090) (objectui `ed5964304`)
  - _(no changeset)_ chore(deps): bump maplibre-gl from 6.1.0 to 6.2.0 (#4092) (objectui `9920ae2d3`)
  - _(no changeset)_ chore(deps): bump react-hook-form in the react group (#4089) (objectui `49396b524`)
  - _(no changeset)_ chore(deps): bump the patch-updates group with 10 updates (#4087) (objectui `d897b74bc`)

  objectui range: `8aad9fd50b16...92c0b1f403f7`

- 4580597: Console (objectui) refreshed to `96ee72e85439`. Frontend changes in this range:

  - fix(console): render the redaction notice on the enveloped resolve body (objectstack#3983) (#2980)
  - feat(sdui): guard the public contract against silent drift (#2979)
  - fix(sdui): lazy public blocks reach a kind:'react' page scope; ReactRunner keeps its errors (#2976)
  - fix(list,data): bridge every spec view operator onto the filter AST (#2901) (#2974)
  - fix(errors): error-code branches survive the framework's ADR-0112 rename (objectstack#3841) (#2977)
  - fix(fields): a select no longer wipes itself when its value outruns its options (#2968) (#2969)
  - fix(approvals): decision outputs reach both decision surfaces (#2955) (#2961)

  objectui range: `e651c936870e...96ee72e85439`

- eb9230c: Console (objectui) refreshed to `a136322f8723`. Frontend changes in this range:

  - fix(app-shell)!: a modal action is client-side only — drop the server fallthrough (objectstack#3959) (#2973)
  - fix(app-shell)!: the server-action URL identifies an action by `name`, not `target` (ADR-0110 D1) (#2970)
  - fix(form): a server rejection that names fields now marks those fields (#2966)
  - fix(actions): one source for the /actions envelope rule, and redirectUrl finally works (#2967)
  - fix(actions): apply the ADR-0066 D4 capability gate on every action surface (framework#3923) (#2965)
  - fix(detail): multi-value lookup is selectable in inline edit (#2957)
  - fix(actions): a failed server action no longer reports as success (green toast) (#2963)
  - fix(fields): the criteria builder stops calling an empty criteria "All records" (#2962)
  - feat(report): carry a report's `order` into the dataset selection (framework#3916) (#2964)
  - feat(views): the list toolbar speaks one vocabulary — `userActions` (#2890) (#2948)

  objectui range: `4a4829d0ef39...a136322f8723`

  **Release-critical for v17.** The previous pin (`4a4829d0ef39`) predates the
  ADR-0110 D1 client fix, so the console it builds still posts `action.target`
  to `/api/v1/actions/:object/:action`. Against a v17 server — which resolves
  the declaration by `name` and refuses an unresolvable one (D3) — every
  target-bound script action would return 404 from the shipped console. The
  lockstep the ADR called for is enforced by THIS pin, not by merging the
  objectui PR, so v17 must not ship without this bump.

- 29e5a0e: Console (objectui) refreshed to `bebaebd39ace`. Frontend changes in this range:

  - fix(console): marketplace read cloud errors seven different ways — two break on the conversion, two are broken today (cloud#944) (#3086)
  - feat(console): settings validation errors render against the fields that caused them (objectstack#4224 follow-up) (#3083)
  - fix(notifications): the config, position and action variant are read instead of forked or ignored (#3014 follow-up) (#3085)
  - fix(data-objectstack,core): an object filter no longer depends on whether the query expands a lookup (#3084)
  - fix(app-shell): a published configSchema can no longer delete a node's sibling-block editors (objectstack#4045) (#3082)
  - fix(view,list,core): a view's filter no longer disappears, or arrives as a predicate on columns that don't exist (#3081)
  - fix(console): read the SETTINGS_LOCKED key from `error.details`, tolerating both shapes (objectstack#4224) (#3079)
  - fix(list,data-objectstack,types): exporting a searched list no longer downloads the unsearched superset (#3078)
  - fix(types,app-shell): one ObjectPermission, and the preview stops hiding three of its fields (objectstack#4115) (#3077)
  - fix(notifications): the spec `icon` is read instead of stored and ignored (#3014 follow-up) (#3076)
  - fix(plugin-grid): bulk-action params render the shared form field widgets — lookup errors get Retry, sys_user params get the PeoplePicker (#3064, ADR-0059) (#3073)
  - feat(app-shell): the console mounts the notification surfaces (#3014 follow-up) (#3075)
  - fix(data-objectstack): a view's own filter no longer vanishes when the user adds one (#3072)
  - feat(notifications): each spec displayType gets its own presentation (#3014) (#3071)
  - fix(grid): evaluate a bulk action's `visible` per selected record (#3067) (#3070)
  - feat(sdui): curate the page:_, element:_ and action:\* families into the public contract (#3069)
  - fix(list,i18n): a 400 from the server no longer reads as "check your connection" (#3066)
  - feat(page,element): declare inputs for the eight configurable page:_/element:_ blocks (#3065)
  - fix(app-shell,plugin-grid,i18n): autonumber/readonly fields become match-only import targets so "update if the record number exists" works (#3061)
  - fix(types): Page/App/Dashboard validate the spec's own fields instead of passing them through (objectstack#4115 group C) (#3063)
  - fix(plugin-form,i18n): form edit saves send If-Match and surface 409 conflicts instead of silently overwriting (#3060)
  - fix(console): 403 blamed on the network, ⌘K search capped at 8 objects, nav gating fields inert (#3044)
  - fix(grid): a bulk delete / by-name action clears the row checkboxes too (#3056) (#3058)
  - fix(types,detail): derive five spec-named symbols instead of forking them (objectstack#4115) (#3057)
  - fix(grid): drop the `bulkEnabled` derivation — the spec key is a tombstone (#3002) (#3053)
  - fix(permissions,console): retry a transient /me/permissions failure instead of stranding the app on its loading state (#3050) (#3052)
  - fix(test-setup): stop shadowing ten real registrations, and declare page:header's inputs (#3051)
  - fix(scripts): --check reports real divergence instead of calling all 46 components "modified" (#3049)
  - fix(view): the chart view gets a label and an icon in the view switcher (#2916) (#3040)
  - feat(form): SplitForm honours the spec's new `FormSection.pane` (#3041)
  - fix(types,layout): nav item type 'component' joins NavigationItemType and its zod enum (#2918) (#3039)
  - fix(registry): prefix every namespaced key exactly once, in every namespace (#3037)
  - fix(scripts): shadcn-sync refuses to silently delete local edits, and compiles the package after it writes (#3035)
  - fix(scripts): shadcn-sync rewrites the registry paths Shadcn actually serves, and refuses to write a file when it cannot (#3033)
  - fix(grid,types): an object-declared bulk action runs over the selected records (#3002) (#3031)
  - fix(form): a wizard with `allowSkip` no longer submits past the fields you skipped (#3030)
  - fix(components): resizable is a diverged file, not a synced one — stop the sync from breaking the build, and finish the v4 migration in it (#3029)
  - feat(studio): a page button created in Studio can be given an action (#2997) (#3028)
  - feat(record): declare inputs for the seven configurable record:\* blocks, and curate six (#3027)
  - feat(eslint): ban dynamic imports in test hooks, and convert the last 33 sites (#3026)

  objectui range: `96ee72e85439...bebaebd39ace`

- bec0f9a: Console (objectui) backfill for `2cb8d78e24ad...c6cfdf1288b6` — the one refresh in
  the v17 window that landed with no changeset.

  `scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every bump
  precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`). One
  bump in this window did not, so 25 commits — including two breaking ones — were
  absent from the release history and from the curated v17 page. This entry records
  them after the fact; it declares no new SHA move (`.objectui-sha` already points
  past this range at `4a4829d0ef39`).

  Frontend changes in this range:

  - feat(react)!: trim dead device/preference delegates from useClientNotifications (objectstack#3612 companion) (#2862)
  - feat(types)!: drop the ObjectStack/ObjectOS/ObjectQL/ObjectUI Capabilities re-exports (#2860)
  - feat: gate detail/form edit & delete on the server's effective operation set (framework#3546) (#2832)
  - feat(app-shell): approver values become record lookups (framework#3508) (#2834)
  - feat(console): group tenancy posture affordances — org switcher as write context + org attribution (ADR-0105 Phase 1) (#2858)
  - feat(console): i18n the system-settings hub (objectui#2851 P2) (#2859)
  - fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework#3574) (#2857)
  - fix(grid): validate email format in the import preview (objectstack#3566) (#2840)
  - fix(fields): consistent image-field rendering + click-to-zoom (#2836) (#2837)
  - fix(app-shell): stop the flow-node repeater from committing during render (#2838) (#2839)

  Plus 15 dependency bumps, three of them major for the Console's own build:
  `maplibre-gl` 5→6, `chalk` 5→6, `jsdom` 29→30 (dev).

  objectui range: `2cb8d78e24ad...c6cfdf1288b6`

- be25f97: Console (objectui) refreshed to `f5bc4c78be76`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 11 releasing of 11 changesets added across 31 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

  - **minor** — Field widgets are finally told when their field fails validation, and the props slot that carries it takes the name the published contract gives it (objectui#3222). (objectui `56409c28c`)
  - **minor** — Retire `validation` from the action-param contract — it was declared on both halves, read by neither, and rejected outright by the server (objectui#3201). (objectui `f833d3ae4`)
  - **patch** — Five metadata designers stop rendering keys `@objectstack/spec` rejects, and start rendering the keys it declares (objectui#3275, objectui#3281). (objectui `8ff3ad7b8`)
  - **patch** — The Page block inspector's conditional-visibility control now authors `visibleWhen`, and says "Visible when" while doing it (objectui#3229). (objectui `8e02ad7f2`)
  - **patch** — The record discussion panel no longer shows the PREVIOUS record's comments and activity (objectui#3268). (objectui `a8aa57663`)
  - **patch** — The form renderer's built-in `select` branch stops saying "No options available" in English to non-English sessions (objectui#3263). (objectui `a7651e640`)
  - **patch** — The record discussion panel now says "loading" while it is loading, instead of "No comments yet" (objectui#3209). (objectui `12bf6691e`)
  - **patch** — The legacy `page-header` alias stops advertising `description` as an authorable key (objectui#3226). (objectui `d2363e710`)
  - **patch** — The option widgets' "this list cannot be filled" message now has one source, and it is translated (objectui#3231). (objectui `825bbe33c`)
  - **patch** — `ToolPreview` stops advertising retired `ToolSchema` flags (objectui#3236). (objectui `30ac2e1ee`)
  - **patch** — `TextAreaField`'s mobile fullscreen flag converges on its one real producer (objectui#3232). (objectui `a321fa461`)

  objectui range: `785b8a5d432c...f5bc4c78be76`

- ce1155c: Console (objectui) refreshed to `f995a452d2ca`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 64 releasing of 65 changesets added across 98 non-merge commits; omitted: 1 release-nothing changeset, 33 commits carrying no changeset (they ship no package code).

  - **minor** — The record detail page now shows a read-gated approval panel (#3461). A record in approval used to expose NOTHING about the running approval to anyone but the current pending appr… (objectui `5af285210`)
  - **minor** — `DrillDownConfig` now declares only keys a renderer reads, and `target: 'navigate'` is honoured on charts too (#3354). (objectui `9e9e9a92f`)
  - **minor** — Console chrome i18n gaps (objectstack#5407). (objectui `3889ffb4c`)
  - **minor** — The console language choice now survives a reload. `I18nProvider` writes every language change to `localStorage` (`objectui-locale`, exported as `LOCALE_STORAGE_KEY`) and boots th… (objectui `0554e889c`)
  - **minor** — `<ObjectChart>` declares `drillDown` as a registry input, so the SDUI save gate treats the segment drill as a contract prop instead of an unknown one (framework#5022). (objectui `524a6357b`)
  - **minor** — The environment entitlement dialog now reads its context from `error.details.*` — the single declared location — and the flat dual-dialect tolerance is deleted (objectui#3329, the… (objectui `8ec406728`)
  - **minor** — `@object-ui/core` now ships the server-action dispatcher factory — `createServerActionHandler({ fetch, baseUrl, resolveObject, ... })` — so any consumer of the runner (standalone… (objectui `5781fb15a`)
  - **minor** — `AppSchemaRenderer` now derives area visibility from the items inside the area, closing the visible-but-empty regression the spec 17.0.0 area-key retirement left behind (objectui#… (objectui `608669eb5`)
  - **minor** — Track `@objectstack/spec` 17.0.0-rc.2 (objectui#3235, #3208, #3287, #3264). (objectui `d22ae31ce`)
  - **minor** — Field widgets no longer spread renderer-only props — or arbitrary keys from a field config — onto the DOM element they render (objectui#3291). (objectui `19b8c9be3`)
  - **minor** — `RichTextField` honours `mobile_fullscreen`, so `mobile.fullscreenLongText` is finally true of rich text too (objectui#3301). (objectui `30ae33a77`)
  - **minor** — `mobile.fullscreenLongText` finally reaches auto-generated long-text fields, and `mobile_fullscreen` gets one declared carrier (objectui#3245). (objectui `f44d8727f`)
  - **minor** — **BREAKING (v17)** — The flow designer writes node geometry as the spec's `FlowNode.position`, not its own `ui: { x, y }` (objectui#3172). (objectui `6e794a19e`)
  - **minor** — **BREAKING (v17)** — field widgets receive their metadata on ONE key, `field`. `schema` is removed from the widget contract (objectui#3233). (objectui `042e09d77`)
  - **patch** — `UserFilters` no longer carries its own operator table when it lowers a `ViewTab.filter` preset into an ObjectQL AST node. The private `specOperatorToAst` was the second hand-kept… (objectui `d7f350a89`)
  - **patch** — Name `CommentThread`'s three emoji-only buttons, and follow the session language past the 7-day mark (objectui#3441) (objectui `65516ba4a`)
  - **patch** — `toFilterNode` now lowers a spec `ViewFilterRule[]` into ObjectQL AST nodes instead of returning the array verbatim, so a saved view's stored filter reaches `$filter` as something… (objectui `2a9513d81`)
  - **patch** — Localize the create / edit / view form title `ObjectView` builds itself (objectui#3462) (objectui `28b2e6571`)
  - **patch** — Localize the record-detail headings that `ObjectKanban`, `ObjectTree` and `ObjectView` build themselves (objectui#3459) (objectui `aa36e6073`)
  - **patch** — Localize the record-detail overlay heading that `ListView` and `ObjectGrid` build themselves (objectui#3426) (objectui `61958416e`)
  - **patch** — The close button that the `Sheet` and `Dialog` primitives auto-render now announces itself in the session locale instead of always in English. Both buttons are icon-only (a lucide… (objectui `71be40696`)
  - **patch** — Localize `PresenceAvatars` — the avatar stack's accessible name and tooltips follow the session language (objectui#3440) (objectui `ca0fa8fab`)
  - **patch** — `PageRenderer` no longer renders its own `<h1>` when the page authors a titled `page:header`, so a page has exactly one level-1 heading. Every non-record page used to render the p… (objectui `06632e9d1`)
  - **patch** — Localize `@object-ui/collaboration` — `CommentThread` no longer hardcodes English (objectstack#5506) (objectui `94c5b7c4e`)
  - **patch** — `TextAreaField`'s fullscreen edit dialog now gives screen reader users the character count it has always shown sighted ones. The dialog's footer counter was a bare `{n}/{max}` spa… (objectui `f789c3b3a`)
  - **patch** — `ObjectDataPage`'s "Save as view" now folds the active URL drill conditions into `@objectstack/spec` `ViewFilterRule`s before persisting them, instead of writing the runtime filte… (objectui `875c5fafb`)
  - **patch** — Localize `RecordDetailDrawer`'s drag-resize handle (objectstack#5733) (objectui `5a24ad9cb`)
  - **patch** — The record picker's filter panel now sends the AUTHORED value of a picked `select` filter option instead of the control's stringified form. Radix `Select` speaks strings — options… (objectui `34d9169f6`)
  - **patch** — Localize the record-overlay and tab-badge chrome that #5430's sweep left behind (objectstack#5506) (objectui `5dd012776`)
  - **patch** — The lookup "Browse all records" Record Picker's filter panel now offers the options a `select` field declares in its schema (objectui#3336). `LookupField` turns each typed picker… (objectui `5881a2cc4`)
  - **patch** — `TextAreaField`'s character counter no longer re-announces itself on every keystroke. Measured on `main` in a zh session with `maxLength: 500`, typing a 52-character sentence one… (objectui `789fe3ee2`)
  - **patch** — Fix matrix report cells showing another bucket's numbers when dimension values run together. (objectui `509104a1b`)
  - **patch** — Fix dataset pivot cells showing another row's numbers when a dimension value contains a space. (objectui `ce7cbe5af`)
  - **patch** — Give `InlineCreateRelated`'s card-header close button an accessible name (objectui#3411 — the neighbouring defect found while implementing #3381/PR #3410, in the same file and lef… (objectui `58a00f0b4`)
  - **patch** — Give `InlineCreateRelated`'s "Link Existing" search box a real accessible name (objectui#3381 — the neighbouring defect found while implementing #3341/PR #3380, and left out of th… (objectui `b17ce4c25`)
  - **patch** — `TextAreaField`'s character counter now announces itself in the session locale. The counter block — rendered only when the field declares `maxLength` — carried the accessible name… (objectui `2409e1d04`)
  - **patch** — fix(fields): translate the registered path's fullscreen long-text dialog (objectui#3404) (objectui `6fe485bf2`)
  - **patch** — `TextAreaField` / `RichTextField` now honour `disabled` on their fullscreen editing path. `disabled` used to reach the inline control only: `showFullscreenButton` never consulted… (objectui `7d08c3feb`)
  - **patch** — The form renderer's built-in `textarea` branch now honours `readonly` / `disabled` on its fullscreen exit, which previously bypassed both (objectui#3400). `renderFieldComponent` d… (objectui `fd54c3e7a`)
  - **patch** — 表单内置 `textarea` 的全屏编辑对话框现在能拿到字段自己的 label：对话框标题显示字段名而不是恒定的通用词「编辑文本」，同一张表单上多个长文本字段的展开按钮也终于有了互不相同的无障碍名（objectui#3393）。 (objectui `85c4c9ce0`)
  - **patch** — The form renderer's built-in `textarea` branch reads the fullscreen long-text flag on one spelling (objectui#3303). (objectui `9cbcbf478`)
  - **patch** — The form renderer's last user-visible English literals now go through i18n (#3272). The fullscreen long-text editor (`mobile_fullscreen`) was an entire untranslated dialog — title… (objectui `4eeb932aa`)
  - **patch** — Localize the last untranslated console-chrome accessible names (objectstack#5430) (objectui `b71fc92f3`)
  - **patch** — `ObjectGantt`'s quick-filter bar is now localized instead of pinned to Chinese. The four `QuickFilterBar` labels (`all`, `clear`, `empty`, `resultSummary`) were hardcoded as Chine… (objectui `5c856ecb5`)
  - **patch** — Associate the label with its control at the two form surfaces where the two were never programmatically connected (objectui#3341 — found while implementing #3299/PR #3340, and del… (objectui `53811d179`)
  - **patch** — `ActionEngine.getActionsForLocation` now evaluates a `{ dialect: 'cel', source }` action `visible` predicate on the canonical `@objectstack/formula` engine instead of the legacy J… (objectui `18cd43289`)
  - **patch** — Settings pages read the declared `{ success, data }` response envelope, so the whole Setup → Configuration section works again against a framework#3843 server (objectui#3366). (objectui `7d0c6de39`)
  - **patch** — The flow designer no longer seeds new `wait` nodes with the retired `waitEventConfig.onTimeout` (objectui#3316). (objectui `35da149c5`)
  - **patch** — Gallery covers now resolve the `coverField` value through its **file value shape** instead of assuming the field value _is_ a URL string, so an ADR-0104-conforming `image` value r… (objectui `978705c8f`)
  - **patch** — The list toolbar's "Filter" now saves. Saving a filter from the runtime toolbar PUT the FilterBuilder's whole group object (`{ id, logic, conditions }`) into the view's `filter`,… (objectui `68b6a2855`)
  - **patch** — The lookup "Browse all records" Record Picker now formats its columns with the same field metadata the list view uses (objectui#3333). Previously the dialog handed cell renderers… (objectui `9bc3709b9`)
  - **patch** — Behavior change — **an authored display `type` can NARROW inline editability, but never WIDEN it** (objectui#3355). (objectui `bbbde1207`)
  - **patch** — `record:highlights` now honours a `readonly: true` on an authored field entry, so a header chip for a platform-owned column no longer offers inline edit. `HeaderHighlight`'s edita… (objectui `23018cc03`)
  - **patch** — Deliver the required state to the control in the five renderers outside the object form that still painted it as an asterisk only (objectui#3299 — the same defect #3290/#3298 fixe… (objectui `532cf8b9e`)
  - **patch** — The Combobox trigger now declares `type="button"` explicitly, so it can never submit an enclosing `<form>` (objectui#3344). The current Radix `PopoverTrigger` happens to supply `t… (objectui `34595eb45`)
  - **patch** — `TagsField` no longer ships a hardcoded Chinese input placeholder (objectui#3342, AGENTS.md Commandment #-1). The placeholder now resolves through the pinned chain: the author-dec… (objectui `c7ed4c366`)
  - **patch** — AddressField / GeolocationField sub-inputs now derive their DOM ids from a `useId()` prefix + sub-field name (the RadioField / CheckboxesField `groupId` paradigm) instead of hardc… (objectui `b7165ce47`)
  - **patch** — 20 more registered field widgets now announce a failed validation to assistive tech: `multiselect`, `radio`, `checkboxes`, `tags`, `lookup`, `master_detail`, `user`, `owner`, `fil… (objectui `8d8094a7c`)
  - **patch** — `field:permission-facet-link` now registers through `withFieldCarrier` — the repo's only raw `field:` registration bypassed the single-metadata-carrier seam (objectui#3233), so un… (objectui `c7fba276e`)
  - **patch** — The console server-action wrapper's `opensInNewTab` choreography no longer ships hard-coded bilingual Chinese/English copy (objectui#3321, AGENTS.md Commandment #-1): the pre-open… (objectui `a41568462`)
  - **patch** — `AppSidebar` and `UnifiedSidebar` area switchers now adopt the derived area visibility introduced for `AppSchemaRenderer` in objectui#3311, closing the same visible-but-empty gap… (objectui `8d9984c2e`)
  - **patch** — RecordDetailView's `type:'modal'` dispatch no longer falls back to the server-side action handler when the target resolves to neither a page nor an object. That fallthrough could… (objectui `94755bb88`)
  - **patch** — `field:select` now announces its validation state to assistive tech: the widget's DOM pass-through lands on the Radix `SelectTrigger` — the focusable `<button role="combobox">` a… (objectui `49f7449f9`)
  - **patch** — The required state now reaches the input control as `aria-required`, instead of existing only as part of the control's accessible name (objectui#3290). (objectui `680080ada`)

  objectui range: `f5bc4c78be76...f995a452d2ca`

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 6ba3788: Console (objectui) refreshed to `09c6a177bb4a`. Frontend changes in this range:

  - fix(grid): localize import result errors (objectstack#3566) (#2861)

  objectui range: `c6cfdf1288b6...09c6a177bb4a`

- 72b55d3: Console (objectui) refreshed to `7dfbeb704e1e`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 9 releasing of 9 changesets added across 28 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

  - **patch** — The bulk selection bar now applies the ADR-0066 D4 `requiredPermissions` capability gate, and short-circuits a boolean `visible` instead of treating it as a broken expression (#34… (objectui `d915c47b3`)
  - **patch** — Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface… (objectui `d915c47b3`)
  - **patch** — Conditional-rule predicates that fail to evaluate are no longer silent (objectstack#5149, appeal 2). `evalFieldPredicate` — the canonical funnel for `visibleWhen` / `readonlyWhen`… (objectui `a4cff5bd1`)
  - **patch** — `useAppContextSelectors` now derives each context selector's URL scope key from its own `id` instead of hardcoding the literal `package` query key. `App.contextSelectors` is an ar… (objectui `f59406d4e`)
  - **patch** — `toPredicateInput` is now re-exported from `@object-ui/core` instead of being reimplemented in `@object-ui/react`. Behaviour is byte-for-byte identical — the renderer-side copy in… (objectui `175bd79d8`)
  - **patch** — The group-tenancy write-target badge is now translated in all ten locales (objectui#3517) (objectui `7e2406abf`)
  - **patch** — Give `CommentThread`'s `+` reaction picker a real accessible name (objectui#3478) (objectui `d0d71df0e`)
  - **patch** — `RecordFormPage` no longer passes an inline `defaultValue` to the seven `t()` lookups whose keys are defined in all ten locale packs (`form.createTitle`, `form.editTitle`, `form.c… (objectui `c0c771c2f`)
  - **patch** — `createSafeTranslation`'s no-provider fallback interpolation now replaces **all** occurrences of each placeholder, matching i18next semantics on the provider path. (objectui `a6ec93d24`)

  objectui range: `f995a452d2ca...7dfbeb704e1e`

- 0c49b50: Console (objectui) refreshed to `b1204af0a1f7`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 8 releasing of 8 changesets added across 22 non-merge commits; omitted: 14 commits carrying no changeset (they ship no package code).

  - **patch** — Anchor the scaffold's build-side `devDependencies` to this repo's real toolchain, and pin the whole generated manifest against drift (objectui `e473b6c29`)
  - **patch** — fix(data-table): don't render a row overflow ("⋮") trigger that opens an empty menu (objectui `7ed3360dc`)
  - **patch** — Show the `compareTo` comparison in a dataset pivot cross-tab instead of dropping it (objectui `02eb44490`)
  - **patch** — data-objectstack: type `queryDataset(selection)` as the spec's `DatasetSelection` instead of a hand-written copy (objectui `5f08c052d`)
  - **patch** — Point the `sys-objects` navigation entries at the canonical metadata-admin route instead of the `system/metadata/object` alias, removing a redirect hop from each click (objectui#3… (objectui `b7b05da7f`)
  - **patch** — create-plugin: make the scaffolded plugin's own test suite runnable (objectui `f4f42b4ae`)
  - **patch** — Accept React 19 in `@object-ui/plugin-report`'s peer range, the last UI package still declaring React 18 alone (objectui#3690). (objectui `3b1f888e5`)
  - **patch** — Point System Hub's Permissions card — both its link and its count — at `sys_permission_set`, closing the last of the five `system/*` navigation targets (objectui#3655). (objectui `cc95c2c31`)

  **In this console build, declared nowhere** — objectui merged 14 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(create-plugin): 按 route B 收缩到不漂移的部分,产物一律指向 buildPluginFiles() (#3715) (#3760) (objectui `b1204af0a`)
  - _(no changeset)_ test(scripts): assert every peer-line restatement against its own manifest (#3717) (#3751) (objectui `0c28a0720`)
  - _(no changeset)_ fix(runner): 删掉 vite 别名表里指向不存在包目录的 data-objectql 条目 (#3747) (objectui `5a297c3cd`)
  - _(no changeset)_ docs(ci): delete the unpinned .github/WORKFLOWS.md duplicate inventory, move what was true into the pinned guide page (#3724) (#3745) (objectui `28364bdd9`)
  - _(no changeset)_ ci(docs): fail OPEN when the Build Docs path gate cannot compute its diff (#3723) (#3744) (objectui `b1a67e0f6`)
  - _(no changeset)_ docs(skills): point console-development.md's 13 relocated symbols at their real paths (#3730) (#3734) (objectui `8ad6070fb`)
  - _(no changeset)_ docs(ROADMAP): P1.12/P1.16 的 MetadataManagerPage 铺与 Total 计数按现实改写 (#3712) (#3732) (objectui `3835d121c`)
  - _(no changeset)_ docs(skills): rewrite console-development.md to the post-cccdf84d reality and sync its eval (#3713) (#3729) (objectui `4e93e40d7`)
  - _(no changeset)_ docs: 清偿 #3711 门禁记账里属这三单的 8 处版本失真,并同步收缩 ledger (#3726) (objectui `fbf7d6d01`)
  - _(no changeset)_ docs(runner): Error Boundaries 一条改为可达的 SchemaErrorBoundary (#3635) (#3725) (objectui `b887282cb`)
  - _(no changeset)_ fix(fields): echo stored date values in the sub-grid's native date cells (#3718) (objectui `918888a30`)
  - _(no changeset)_ docs(console): drop the objectstack.config.ts ghost, the dead app-creation entries, and the routing-table overreach (#3580) (objectui `15a0d366b`)
  - _(no changeset)_ test(app-shell): 同步 pseudoRouteSegments 里的第二份 MetadataRedirectStub,并用整链断言钉住 (#3669) (#3691) (objectui `ae3bd96a1`)
  - _(no changeset)_ ci: subscribe the four gate workflows to merge_group, and move ci/lint path filtering into the jobs (#3523 steps 1-2) (#3722) (objectui `f710fc4e3`)

  objectui range: `0cf8f0f70d10...b1204af0a1f7`

- 60110bb: Console (objectui) backfill for `96ee72e85439...bebaebd39ace` — the 27 fix
  commits that refresh's changeset did not enumerate.

  `scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every
  bump precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`),
  and the `console-bebaebd39ace.md` entry it wrote covers only the tail of its own
  range: the range holds **94** first-parent commits, the enumeration lists 40,
  and its oldest entry is #3026. Everything that merged earlier inside the same
  range went unrecorded — in the release history and in the curated v17 page.
  This is the second instance of the failure `console-c6cfdf1288b6-backfill.md`
  records; it declares no SHA move (`.objectui-sha` already points at
  `7d9734d5e321`, past this range).

  The 27 are all `fix`, hence `patch`. Several are data-loss fixes an upgrading
  Console user feels immediately:

  - fix(form): a tabbed/sectioned modal keeps every tab's values (#2959, #2153) (#2987)
  - fix(form): a split form keeps BOTH panels' values (#2153) (#3012)
  - fix(form): a defaultValues change no longer discards the field being filled (#2982) (#2991)
  - fix(components): apply new form defaultValues in the commit that renders them (#3001)
  - fix(plugin-form): block page unload while a modal/drawer form has unsaved input (#2998)
  - fix(plugin-form): swapping recordId no longer leaves the previous record on screen (#3005)
  - fix(plugin-form): a wizard that ends on a field-less review step can finish (#2986)
  - fix(form): a tabbed/split form honours the form view's own `columns` (#3018)
  - fix(console): a flow or action that failed under HTTP 200 stops reporting success (#2958) (#2995)
  - fix(grid): a legacy string row action runs instead of green-toasting a no-op (#2960) (#2996)
  - fix(spec-parity): render the six Tier-1 spec values right instead of silently wrong (#2941) (#2993)
  - fix(spec-parity): the Tier-2 spec values render instead of validating into nothing (#2942) (#3008)
  - fix(spec-parity): the Tier-3 spec values render instead of red-boxing (#2943) (#3011)
  - fix(view,components): the spec→FilterBuilder operator table covers the whole view vocabulary (#2945) (#2989)
  - fix(view): the spec→FilterBuilder map follows the four operators #2942 added (#3022)
  - fix(charts): a spec `series[].type` draws, and a spec-shape `series` plots at all (#2945) (#3004)
  - fix(charts): say so when rows carry no category key, instead of drawing an empty axis (#3007)
  - fix(analytics): a missing analytics capability no longer renders as an empty KPI (objectstack#3891) (#2981)
  - fix(chatbot): read the agent catalog in the declared envelope too (objectstack#4053) (#2992)
  - fix(sdui): a react page keeps its state; a source that exports nothing fails loudly (#2984)
  - fix(sdui): a kind:'html' page can use lazily-registered blocks, and recovers when one registers late (#2988)
  - fix(sdui): stop the react page's "no adapter yet" fallback churning its provider context (#3000)
  - fix(sdui): the curated contract lists record:line_items, the tag that actually resolves (#3006)
  - fix(record): register the record:\* blocks under one key, prefixed once (#3023)
  - fix(plugin-list,plugin-grid): drop undeliverable formats from the export menu (#2999)
  - fix(components): a stacked resizable group gets a divider, not a 1px sliver (#3024)
  - fix(components,app-shell): the last two `direction` props follow v4's rename to `orientation` (#3025)

  Also in the range and deliberately not listed here: the refactor/chore/test/
  build/ci PRs the bump script's fix/feat filter excludes by design — including
  three breaking-flagged refactors already reflected in the spec-side work
  (#2990 the `execute` alias deleted from the action runner, objectstack#3856;
  #3003 action sub-vocabularies derived from spec, and #3020 authoring types
  become input types, both objectstack#4074).

  objectui range: `96ee72e85439...bebaebd39ace`

- 6fd0786: Console (objectui) refreshed to `e651c936870e`. Frontend changes in this range:

  - fix(app-shell): unwrap the declared response envelope on the datasource page and the api-action runner (objectstack#3843) (#2972)
  - fix(actions): read objectstack#3962's single-wrapped /actions responses (#2971)

  objectui range: `a136322f8723...e651c936870e`

## 17.0.0-rc.6

### Minor Changes

- 19d8948: Console (objectui) refreshed to `09987b680d53`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 41 releasing of 45 changesets added across 57 non-merge commits; omitted: 4 release-nothing changesets, 13 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — `ApproveOutcome` / `RejectOutcome` are now derived from `@objectstack/spec` instead of hand-transcribed (objectui#3783). Same failure class #3220 cleared from the same file for `P… (objectui `d9ce38529`)
  - **minor** — **BREAKING** — Retire the `capability-multiselect` field widget name, which existed only on the docs-site registration path and which nothing ever stamped (objectui#3308, ADR-0049 enforce-or-rem… (objectui `ecae40064`)
  - **patch** — `record:details` section editor now offers the `name` i18n anchor (objectui `2937bcf7d`)
  - **patch** — 相关列表 Add 选择器兑现 `add.picker.filter`:作者限定的候选范围现在真的生效 (objectui `c2ecbaed9`)
  - **patch** — The plan card's "Building…" badge follows the console UI locale, like every other label on it (objectui#3837) (objectui `b3439f420`)
  - **patch** — `record:related_list`: an `add` without `add.picker` no longer takes the whole related list down. (objectui `acc34c57b`)
  - **patch** — 修复 `objectui dev` 生成的临时 app 的 CSS 管线:整套从 Tailwind 3 迁到 Tailwind 4 (objectui `8277053bd`)
  - **patch** — Backfill the last 17 missing locale keys and both remaining template-key families, emptying the call-site key ratchet (objectui#3546, slice seven — final) (objectui `f9faa7d62`)
  - **patch** — `preview.draftBar` speaks one second person in `es` — the draft-preview banner no longer switches from tú to usted when a Spanish user publishes (#3844) (objectui `b750823f0`)
  - **patch** — An empty `disabled` predicate no longer refuses to run the action (objectui#3848) (objectui `56ff0916e`)
  - **patch** — Give `@object-ui/react-runtime`'s React peer range an upper bound: `peerDependencies.react` narrows from `>=18` to `^18.0.0 || ^19.0.0`, the spelling the other 30 react peers in t… (objectui `d11996ea5`)
  - **patch** — 回填 `perm` + `home` 两命名空间 14 个缺失语言 key,十个语言包补齐(#3546 切片六) (objectui `e64a52ec3`)
  - **patch** — `disabled: ''` no longer greys out the remaining five action surfaces (objectui#3849) (objectui `f0a625aa7`)
  - **patch** — Generated temp apps now declare every package they import, at ranges anchored to this repo (objectui `c32323e1e`)
  - **patch** — An action declaring `disabled: ''` is no longer greyed out forever (objectui#3842) (objectui `993336f7c`)
  - **patch** — Backfill the `marketplace` and `preview` namespaces' 37 missing locale keys plus the `marketplace.disclosure.runtime.` template-key family (objectui#3546, slice five) (objectui `844d17fc9`)
  - **patch** — Four spec keys the renderers already honoured are now discoverable from the published `inputs` (objectui `aca561a77`)
  - **patch** — Export `hasDeclaredVisibilityGate` from the package barrel (objectui#3835) (objectui `d3e738af8`)
  - **patch** — Server-declared actions declaring `visible: false` are now hidden instead of rendered as live buttons (objectui#3835) (objectui `d3e738af8`)
  - **patch** — Backfill the `console` namespace's 41 missing locale keys plus the `console.ai.group.` template family (objectui#3546, slice four) (objectui `f5f874491`)
  - **patch** — Grid row actions: the inline button budget is now spent on the primaries that actually render (objectui `14c59c0b9`)
  - **patch** — `action:bar` member actions declaring `visible: false` are now hidden instead of rendered (objectui `794c497c5`)
  - **patch** — Remove the scaffold's unused pinned icon dependency, and make its generated schema interface reachable (objectui `c85268256`)
  - **patch** — Action-face member actions declaring `visible: false` are now hidden instead of rendered (objectui `b5980f471`)
  - **patch** — data-objectstack: pass the server's `drillRanges` date-bucket drill scope through `queryDataset` (restores date drill-through) (objectui `376567890`)
  - **patch** — `record:details` 的 `sections` 输入说明改为从 spec 形状派生的对象形,不再教已被退役的「Section IDs」 (objectui `4178d5a2e`)
  - **patch** — data-objectstack: type `queryDataset`'s result `fields[]` as the spec's `AnalyticsResult.fields[]` element instead of a hand-written copy (objectui `d83f6b3de`)
  - **patch** — Backfill the auth family's 54 missing locale keys — `auth` 26 + `oauth` 16 + `acceptInvitation` 12 (objectui#3546, slice three) (objectui `7864f0340`)
  - **patch** — Row actions declaring `visible: false` are now hidden instead of rendered (objectui `97b63d761`)
  - **patch** — `parseAiQuotaError` now reads the AI quota refusal code from all three shapes the cloud 429 producers use, instead of only the flat `error`-holds-the-code dialect. (objectui `2a54e860c`)
  - **patch** — console: hold the environment list's create CTA with a skeleton until entitlements resolve, instead of showing a label that is about to be overwritten (objectui#3482, part of clou… (objectui `0ef94cae1`)
  - **patch** — Dataset-bound metric cards honour their declared `colorVariant` (objectui#3359, objectstack#5010 ruling B) (objectui `c4c0ac897`)
  - **patch** — Record page header action predicates now speak CEL, like every other action surface (objectui `e24d767e4`)
  - **patch** — `record:highlights` publishes the `readonly` entry key, so an AI author can discover it from the manifest (objectui `7b3e04820`)
  - **patch** — Fix saved list-view preferences never reading back (density, column widths, sort, hidden columns, inline edit) (objectui `7e2b7e94c`)
  - **patch** — `BulkActionParam.options` entries now accept the widget config the renderer already forwards (objectui `d229dfa7b`)
  - **patch** — Ask the view composer for a container's view identities instead of deriving `list.name || 'list'`, so the default list view's translated label resolves (objectui `b691f060e`)
  - **patch** — Record detail pages: a header ⟳ that refreshes the record, its related lists and its tab counts in place — no browser reload (objectui `54233b14a`)
  - **patch** — Resolve `_views` translation keys by the bare view name only — the prefixed full name is no longer a second candidate (objectui `32413ec24`)
  - **patch** — Action params that inherit a field's options now keep the keys that field declared (objectui `fbc23e094`)
  - **patch** — fix(plugin-grid): don't render a row "⋮" trigger that opens an empty menu (objectui `1a33b1aba`)

  ⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 13 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(layout): page-header 的 Responsive Behavior 按 PageHeader 现状改写 Spacing 一行 (#3902) (#3915) (objectui `09987b680`)
  - _(no changeset)_ docs(layout): align PageHeader Styling/Container with the code and make its demo use the component (#3786, #3787) (#3905) (objectui `50fa3766e`)
  - _(no changeset)_ docs(scripts): 删除 scripts/README.md —— 一份无门禁覆盖、无入站链接的第二份清单 (#3882) (objectui `47f607854`)
  - _(no changeset)_ fix(test): runner 的包级 test 入口指回仓根配置,不再落到 app 的 vite.config (#3746) (#3869) (objectui `39136cccb`)
  - _(no changeset)_ ci(skills): skills 指南正文反引号里的仓内路径上门禁,豁免走双向陈旧检测的 baseline (#3735) (#3864) (objectui `74370641d`)
  - _(no changeset)_ docs(ROADMAP): P1.12.3 / P1.16 九条同源漂移按现实改写 (#3738) (#3858) (objectui `6402e253f`)
  - _(no changeset)_ docs(skills): console-development.md 顶部注记的搬家归因改成 04-21→04-23 的 commit 链,cccdf84d7 降为其中一步 (#3737) (#3856) (objectui `6422aa891`)
  - _(no changeset)_ fix(scripts): check-i18n-en-drift 的显式 base 提为权威,解析不出即失败 (#3766) (#3821) (objectui `32bd84236`)
  - _(no changeset)_ docs(layout): page-header 两处文档按组件实读收敛到 subtitle,删掉不存在的 breadcrumbs (#3785) (objectui `f9d70a72e`)
  - _(no changeset)_ docs(ci): 去掉 check-lint-coverage.mjs 头注里的 object-ui 规则点数,并把守卫扩到该文件 (#3279) (#3784) (objectui `4028adfc3`)
  - _(no changeset)_ fix(docs): 按清单校正 9 行 peer 陈述,并把断言加宽到整个 Peer Dependencies 区块 (#3750) (#3779) (objectui `00b9451d8`)
  - _(no changeset)_ ci(changeset): 改了发版包 src/ 却没带 changeset 的 PR 一律失败,空 frontmatter 为显式豁免 (#3387) (#3769) (objectui `a4f837c7d`)
  - _(no changeset)_ docs(hooks): guard-shared-stash header says 32 self-test cases, with the counting rule (#3721) (#3763) (objectui `dbc44b4be`)

  <!-- adr-0087: not-required (no-migration-prescription) Neither break reaches a consumer of @objectstack/console, which publishes objectui's built SPA and exports no objectui type. capability-multiselect was registered only on registerFields(), whose sole caller is objectui's docs site, so the name was unreachable on the live registerAllFields() path and a field still carrying it degrades to its declared type renderer — the defined behaviour for an unregistered widget, with permission-facet-link unchanged as what is actually stamped. ApproveOutcome/RejectOutcome narrow a TypeScript type exported by @object-ui/plugin-chatbot, a package objectstack neither publishes nor re-exports; the removed ApproveOutcome.id was already undefined at runtime, so no shipped behaviour changes and there is nothing for the ledger to prescribe. -->

  objectui range: `b1204af0a1f7...09987b680d53`

- 379b749: Console (objectui) refreshed to `0cf8f0f70d10`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 24 releasing of 24 changesets added across 66 non-merge commits; omitted: 42 commits carrying no changeset (they ship no package code).

  - **minor** — **BREAKING** — Reclaim the natural names `GestureType` and `GestureConfig` (objectui#3363). (objectui `e6fdbdcc4`)
  - **minor** — **BREAKING** — Track the `@objectstack` family at `17.0.0-rc.5` (objectui#3560). (objectui `48132f7e6`)
  - **patch** — metadata-admin: name the offending key when only one union member ever read the value (objectui `be9cd38ac`)
  - **patch** — System Hub: a card count that failed to load no longer renders as `0` (objectui `c1a18ed99`)
  - **patch** — Count System Hub's Organizations card through `sys_organization`, the object the framework actually registers — it asked for `sys_org`, which does not exist, so the card read `0`… (objectui `278f57c36`)
  - **patch** — metadata-admin: name the offending column when `config.columns` is rejected (objectui `949b2f147`)
  - **patch** — Declare the retired `system/{users,organizations,roles,positions}` console URLs as redirects onto the framework-owned system objects (objectui#3655). (objectui `9961df297`)
  - **patch** — Point the last four navigation producers at the canonical metadata-admin routes instead of the deprecated `component/metadata` alias, removing a redirect hop from each (objectui#3… (objectui `d2fd044b7`)
  - **patch** — `view.readonlyTooltip` — the tooltip on a view tab's read-only lock — is retranslated in the eight packs (ja/ko/de/fr/es/pt/ru/ar) that still described the retired "duplicate to c… (objectui `33526fd51`)
  - **patch** — Send the console host's legacy URL redirects straight to the canonical metadata-admin routes instead of routing them through the deprecated `component/metadata/resource` alias (ob… (objectui `7883c0250`)
  - **patch** — Match the built-in pseudo-routes on whole path segments, so a mistyped app name can no longer render a different app (objectui#3638). (objectui `5f752a089`)
  - **patch** — Make the zero-app console's "Object Manager" / "Datasources" entries resolve, and give that branch a not-found screen instead of a blank one (objectui#3610). (objectui `fa3ba5bf1`)
  - **patch** — Point the four remaining "Settings" senders at the system hub `/apps/setup/system` instead of the bare `/apps/setup` (objectui#3611). (objectui `6b3d47b34`)
  - **patch** — Render the `/home` Administration group as a real group, so its nine system-administration entries are reachable (objectui#3609). (objectui `13b72c740`)
  - **patch** — `console.objectView.systemViewReadonly` and `console.objectView.expandToPage` are translated in the eight packs that stored English for them, so a Japanese, Korean, German, French… (objectui `4dcd52abe`)
  - **patch** — metadata-admin: restore per-field diagnostics when editing an invalid stored `view` (objectui `c993ff26a`)
  - **patch** — Point the "System Settings" entries at the system hub `/apps/setup/system` instead of the bare `/apps/setup` (objectui#3590). (objectui `d1be43673`)
  - **patch** — Converge dashboard widget `compareTo` on the executor's `{ kind, dimension? }` contract, and make the dataset path actually render a comparison (objectui `4bc6c2340`)
  - **patch** — metadata-admin no longer false-rejects a stored `view` that has been pinned or reordered. The editor's live client-side validation judged BOTH the create and the edit draft with t… (objectui `4cf76ce45`)
  - **patch** — The organization-management console is translatable. The 90 keys under `organization.*` — the org layout and its tabs, the members list, the whole invitation flow, organization se… (objectui `42ae5c62a`)
  - **patch** — Complete `packages/runner/vite.config.ts`'s workspace alias table to the full transitive import closure, so `@object-ui/runner` boots and builds from the monorepo sources without… (objectui `03f25f7a3`)
  - **patch** — Runner in-app navigation now carries the current query string across to the pushed URL instead of `pushState`-ing a bare path. Opening the Runner with `?api=<base>` and clicking a… (objectui `04fb8b8ab`)
  - **patch** — The no-apps empty state's "Create Your First App" CTA now opens the app-creation flow instead of silently bouncing the user back to the landing page. It called `navigate('/create-… (objectui `9089d8503`)
  - **patch** — The five locale keys behind #3546's eight no-fallback `t()` call sites are now defined in all ten packs, so the built-in-view toasts, the activity-timeline source link, the wizard… (objectui `6d762da7a`)

  ⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

  **In this console build, declared nowhere** — objectui merged 42 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(ROADMAP): P1.12 Routes/Tests 两条 PermissionManagementPage 记录按现实改写 (#3704) (#3714) (objectui `0cf8f0f70`)
  - _(no changeset)_ test(scripts): gate version literals written into docs prose (#3711) (objectui `36bf20235`)
  - _(no changeset)_ test(app-shell): pin what `invalid_value` at a union node means, and decline the relaxation (#3706) (objectui `f1310e40f`)
  - _(no changeset)_ fix(react-runtime,sdui-parser,console): 补上三包声明了 MIT 却从未随包发布的许可证文本,并加门禁封死该类 (#3696, #3702) (#3703) (objectui `2267d6399`)
  - _(no changeset)_ docs(ROADMAP): rewrite P1.12.2 + Permission Management to the post-#3673/#3699 reality (#3700) (#3705) (objectui `35e84b65f`)
  - _(no changeset)_ test(scripts): 棘轮陈旧消息按实际成因分句,覆盖全部三条退休路径 (#3674) (#3701) (objectui `45cdd4cb4`)
  - _(no changeset)_ chore(console): remove the orphaned SystemObjectViewPage + systemObjects dead code (#3672) (#3699) (objectui `b19f54f39`)
  - _(no changeset)_ docs(cli): point the Node row at root engines, drop the ghost spec compatibility row (#3698) (objectui `d46b40324`)
  - _(no changeset)_ docs(plugin-tree): add the `## License` section the other 36 published READMEs carry (#3664) (#3695) (objectui `3e601773e`)
  - _(no changeset)_ docs(packages): retire the dead release-metadata §Compatibility block from 36 package READMEs (#3688) (objectui `4747344da`)
  - _(no changeset)_ fix(cli,create-plugin): drop the `templates` files entry neither package has ever had (#3665) (#3687) (objectui `dcff16e06`)
  - _(no changeset)_ docs(ci): type-check 作业行补两道 i18n 门禁,并把该表的钉粒度降到步骤级 (#3653) (#3683) (objectui `9cd84de2e`)
  - _(no changeset)_ docs(agents): 补一条 prettier 假红护栏(#3682) (#3684) (objectui `074ec53d6`)
  - _(no changeset)_ chore(deps): remove the unwired prettier devDependency (#3657) (#3681) (objectui `f953b5884`)
  - _(no changeset)_ docs(runner): 按实测闭合 §Features 插件断言,三处 main.tsx 订正为 App.tsx (#3619) (#3652) (#3676) (objectui `0fcd57199`)
  - _(no changeset)_ chore(deps): Bump mermaid from 11.16.0 to 11.16.1 (#3675) (objectui `2ce5c31f0`)
  - _(no changeset)_ feat(scripts): en 文案改动必须由九个译文包同批跟改的门禁 (#3650) (#3659) (objectui `880e06905`)
  - _(no changeset)_ docs(scripts): 按真实机制改写两处 Lychee 门禁描述,并删掉 judgeHref 重复注释 (#3587) (#3648) (#3656) (objectui `f4b828857`)
  - _(no changeset)_ test(app-shell): 把 MetadataRedirectStub 同步回宿主实现,并用整链断言钉住转录真实性 (#3661) (#3671) (objectui `e98702190`)
  - _(no changeset)_ test(scripts): gate that package.json `files` entries exist on disk (#3663) (#3667) (objectui `fe4d4da37`)
  - _(no changeset)_ docs(runner): 把 README 两处开放集合的插件措辞按实测闭合 (#3632) (#3644) (objectui `c6acd7b8f`)
  - _(no changeset)_ test(filter-parity): 给两处 spec 词表减法加排除项存活棘轮 (#3628) (#3640) (objectui `1e635d654`)
  - _(no changeset)_ fix(plugin-tree): ship the MIT LICENSE the package.json files field already declares (#3647) (#3662) (objectui `dae1ac41e`)
  - _(no changeset)_ docs(runner): §vite.config.ts 改写为指路真实文件 + 点名两个承重不变量 (#3643) (#3651) (objectui `93c261992`)
  - _(no changeset)_ feat(scripts): check-doc-links 扫描面第四扩 packages/\*/README.md,并付清入场价的 11 条死链 (#3622) (#3649) (objectui `0d5da5394`)
  - _(no changeset)_ docs(runner): §Add Custom Routes 改写为指向 Add Custom Schemas 的元数据路由说明 (#3618) (#3646) (objectui `54dd7ec1f`)
  - _(no changeset)_ docs(runner): 删掉 Best Practices 里复活的环境变量配置面 (#3617) (#3633) (objectui `d9a03fe9a`)
  - _(no changeset)_ docs(runner): README §Features 的 Hot Reload 按两个 loader 分路限定 (#3620) (#3634) (objectui `8098c8585`)
  - _(no changeset)_ fix(docs,scripts): 清掉 9 条包 README 死链,并让链接门禁认站内绝对 URL (#3603) (#3629) (objectui `0e4ea07b2`)
  - _(no changeset)_ test(types): drop 37 spec-retired DROPPED_SCHEMA_EXPORTS rows, add liveness ratchet (#3601) (#3623) (objectui `2904a7cd3`)
  - _(no changeset)_ docs(runner): README §Development Workflow 按两个 loader 的真相改写第 1、3 步 (#3604) (#3621) (objectui `8d5418e59`)
  - _(no changeset)_ docs(runner): 删掉 runner.mdx 的幽灵目录与「内置示例 schema」断言,重写 Package Information (#3577) (#3616) (objectui `616353ad1`)
  - _(no changeset)_ docs(contributing): 按真实 root scripts 重写三条死的开发服务器命令 (#3596) (#3615) (objectui `ee3b42021`)
  - _(no changeset)_ feat(scripts): check-doc-links 扫描面第三扩 CONTRIBUTING/ROADMAP/docs (#3572) (#3589) (objectui `6632114bc`)
  - _(no changeset)_ docs(runner): 删掉 README 两处虚构能力面,修正 404 文档链接 (#3576) (#3602) (objectui `622c23082`)
  - _(no changeset)_ docs(contributing): 按现状改写文档目录说明,站点源是 content/docs/ (#3584) (#3597) (objectui `74387e314`)
  - _(no changeset)_ chore(scripts): remove dead start-app.mjs, fix stale MetadataLoader comment (#3591) (objectui `39477b03b`)
  - _(no changeset)_ docs(contributing): 按现状改写链接门禁分工,换掉三条死的"正确示例"路由 (#3570) (#3585) (objectui `7a1a449c8`)
  - _(no changeset)_ docs(runner): 记录 `api` 查询参数这一真实的元数据加载配置面 (#3537) (#3581) (objectui `632c07c5b`)
  - _(no changeset)_ fix(tsconfig): 根 tsconfig.node.json 加 noEmit,堵住全仓排放 (#3574) (objectui `c35fed098`)
  - _(no changeset)_ docs: 修正 CONTRIBUTING.md / ROADMAP.md 的 3 条死链 (#3545) (#3571) (objectui `d126607dc`)
  - _(no changeset)_ fix(fields): 编辑弹窗 datetime/date 字段回显存量值 (#3565) (objectui `b785a77b3`)

  objectui range: `7dfbeb704e1e...0cf8f0f70d10`

  <!-- adr-0087: not-required (already-registered dashboard-widget-action-aria-removed) 本条目声明的两处破坏都落在 objectui 自家 npm 包的 TypeScript 导出面（@object-ui/types / core / react / mobile 的类型重命名与 re-export 移除），而 @objectstack/console 发布的是按 pin SHA 构建的冻结 SPA 产物、不转发这些类型入口，所以没有需要新登记的元数据迁移。区间内唯一触及元数据作者面的处方是 dashboard.widgets[] 的 actionUrl/actionType/actionIcon/aria 改为具名报错并附 os migrate meta --from 16 —— 那是 objectstack 自己 protocol-17 的改动，已由 packages/spec/src/conversions/registry.ts 的 dashboard-widget-action-aria-removed 登记（surface 逐字覆盖这四个键，toMajor 17，带 apply 与 fixture），并列在 packages/spec/src/migrations/registry.ts step17 的 conversionIds 中；该条目在 merge base 上即已存在，本 PR 未新增任何台账条目。 -->

- 7fa2aae: Console (objectui) refreshed to `8aad9fd50b16`. Frontend changes in this range:

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

- 24d22f4: Console (objectui) refreshed to `92c0b1f403f7`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 13 releasing of 16 changesets added across 29 non-merge commits; omitted: 3 release-nothing changesets, 13 commits carrying no changeset (they ship no package code).

  - **minor** — `DatasetResultField` is now `@objectstack/spec`'s `AnalyticsResult.fields[]` element itself, not a hand-written restatement of it (objectui `e9011318f`)
  - **minor** — fix(fields,plugin-form): stop the inline child grid from collapsing `datetime`/`time` columns onto the `date` control (objectui `1bd6faa61`)
  - **patch** — `ObjectChart`'s category option-color / dimension-label probe now rides the host's authenticated fetch (`SchemaRendererContext.apiFetch`) instead of the bare global `fetch`. (objectui `bcd3e0219`)
  - **patch** — Align 43 inline `defaultValue` strings with the `en` pack, and make the call-site gate enforce it (objectui#3810) (objectui `297534b78`)
  - **patch** — Fix `objectui init`'s scaffold failing its own `npm run build`, and put the third generator under the real `tsc` gate (objectui `64cda47e7`)
  - **patch** — `element:record_picker.filter` is now discoverable from the published `inputs` (objectui `bfdf3d419`)
  - **patch** — Make the generated temp app pass the strict `tsconfig.json` the generator writes beside it, and gate it with a real `tsc` (objectui `9b9fa4961`)
  - **patch** — List row Edit/Delete, bulk delete and related-list CRUD now run the caller's own permission, not just the object's API exposure (objectui#4096) (objectui `aeb8424ba`)
  - **patch** — metadata-admin: wire client-side Zod validation for `sharing_rule`, `translation` and `connector` (objectui#3561) (objectui `877385a76`)
  - **patch** — `evalRowPredicate`: the fail-closed report now names the engine's failure reason, and the ROW always wins over host scope (objectui#3792, objectui#3796) (objectui `6bb454ac0`)
  - **patch** — Move the generator templates' dependency ranges onto the repo's current ones (objectui `c29ceffb8`)
  - **patch** — A required field whose `defaultValue` is a runtime token is submittable from a create form (objectui `8497579db`)
  - **patch** — `object-grid` publishes the filter key it actually reads: `filter`, singular (objectui#4041) (objectui `9154d9e90`)

  **In this console build, declared nowhere** — objectui merged 13 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(data-objectstack): document the real headless surface, not a phantom React API (#4129) (objectui `92c0b1f40`)
  - _(no changeset)_ fix(scripts): rewrite demo imports by usage, and clear the 106 stale ones (#4116) (objectui `e9ab52f90`)
  - _(no changeset)_ docs(data-objectstack): describe the real dependency contract, not a peer one (#3781) (#4127) (objectui `1b6188d41`)
  - _(no changeset)_ chore: release packages (#3598) (objectui `cfeb378b5`)
  - _(no changeset)_ fix(console-starter): close the vite alias table over its real import graph (#4103) (objectui `0af9826ab`)
  - _(no changeset)_ chore(deps-dev): bump the dev-dependencies group across 1 directory with 7 updates (#4088) (objectui `1592b2124`)
  - _(no changeset)_ test(e2e): the console smoke test asserts a boot state the app actually settles in (#4086) (#4095) (objectui `361dfdc01`)
  - _(no changeset)_ chore(deps): bump next from 16.2.12 to 16.3.0 (#4094) (objectui `47737ecb3`)
  - _(no changeset)_ chore(deps): bump lucide-react from 1.28.0 to 1.29.0 (#4091) (objectui `a49a3a008`)
  - _(no changeset)_ chore(deps): bump shiki from 4.3.1 to 4.4.2 (#4090) (objectui `ed5964304`)
  - _(no changeset)_ chore(deps): bump maplibre-gl from 6.1.0 to 6.2.0 (#4092) (objectui `9920ae2d3`)
  - _(no changeset)_ chore(deps): bump react-hook-form in the react group (#4089) (objectui `49396b524`)
  - _(no changeset)_ chore(deps): bump the patch-updates group with 10 updates (#4087) (objectui `d897b74bc`)

  objectui range: `8aad9fd50b16...92c0b1f403f7`

### Patch Changes

- 0c49b50: Console (objectui) refreshed to `b1204af0a1f7`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 8 releasing of 8 changesets added across 22 non-merge commits; omitted: 14 commits carrying no changeset (they ship no package code).

  - **patch** — Anchor the scaffold's build-side `devDependencies` to this repo's real toolchain, and pin the whole generated manifest against drift (objectui `e473b6c29`)
  - **patch** — fix(data-table): don't render a row overflow ("⋮") trigger that opens an empty menu (objectui `7ed3360dc`)
  - **patch** — Show the `compareTo` comparison in a dataset pivot cross-tab instead of dropping it (objectui `02eb44490`)
  - **patch** — data-objectstack: type `queryDataset(selection)` as the spec's `DatasetSelection` instead of a hand-written copy (objectui `5f08c052d`)
  - **patch** — Point the `sys-objects` navigation entries at the canonical metadata-admin route instead of the `system/metadata/object` alias, removing a redirect hop from each click (objectui#3… (objectui `b7b05da7f`)
  - **patch** — create-plugin: make the scaffolded plugin's own test suite runnable (objectui `f4f42b4ae`)
  - **patch** — Accept React 19 in `@object-ui/plugin-report`'s peer range, the last UI package still declaring React 18 alone (objectui#3690). (objectui `3b1f888e5`)
  - **patch** — Point System Hub's Permissions card — both its link and its count — at `sys_permission_set`, closing the last of the five `system/*` navigation targets (objectui#3655). (objectui `cc95c2c31`)

  **In this console build, declared nowhere** — objectui merged 14 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

  - _(no changeset)_ docs(create-plugin): 按 route B 收缩到不漂移的部分,产物一律指向 buildPluginFiles() (#3715) (#3760) (objectui `b1204af0a`)
  - _(no changeset)_ test(scripts): assert every peer-line restatement against its own manifest (#3717) (#3751) (objectui `0c28a0720`)
  - _(no changeset)_ fix(runner): 删掉 vite 别名表里指向不存在包目录的 data-objectql 条目 (#3747) (objectui `5a297c3cd`)
  - _(no changeset)_ docs(ci): delete the unpinned .github/WORKFLOWS.md duplicate inventory, move what was true into the pinned guide page (#3724) (#3745) (objectui `28364bdd9`)
  - _(no changeset)_ ci(docs): fail OPEN when the Build Docs path gate cannot compute its diff (#3723) (#3744) (objectui `b1a67e0f6`)
  - _(no changeset)_ docs(skills): point console-development.md's 13 relocated symbols at their real paths (#3730) (#3734) (objectui `8ad6070fb`)
  - _(no changeset)_ docs(ROADMAP): P1.12/P1.16 的 MetadataManagerPage 铺与 Total 计数按现实改写 (#3712) (#3732) (objectui `3835d121c`)
  - _(no changeset)_ docs(skills): rewrite console-development.md to the post-cccdf84d reality and sync its eval (#3713) (#3729) (objectui `4e93e40d7`)
  - _(no changeset)_ docs: 清偿 #3711 门禁记账里属这三单的 8 处版本失真,并同步收缩 ledger (#3726) (objectui `fbf7d6d01`)
  - _(no changeset)_ docs(runner): Error Boundaries 一条改为可达的 SchemaErrorBoundary (#3635) (#3725) (objectui `b887282cb`)
  - _(no changeset)_ fix(fields): echo stored date values in the sub-grid's native date cells (#3718) (objectui `918888a30`)
  - _(no changeset)_ docs(console): drop the objectstack.config.ts ghost, the dead app-creation entries, and the routing-table overreach (#3580) (objectui `15a0d366b`)
  - _(no changeset)_ test(app-shell): 同步 pseudoRouteSegments 里的第二份 MetadataRedirectStub,并用整链断言钉住 (#3669) (#3691) (objectui `ae3bd96a1`)
  - _(no changeset)_ ci: subscribe the four gate workflows to merge_group, and move ci/lint path filtering into the jobs (#3523 steps 1-2) (#3722) (objectui `f710fc4e3`)

  objectui range: `0cf8f0f70d10...b1204af0a1f7`

## 17.0.0-rc.5

### Patch Changes

- 72b55d3: Console (objectui) refreshed to `7dfbeb704e1e`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 9 releasing of 9 changesets added across 28 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

  - **patch** — The bulk selection bar now applies the ADR-0066 D4 `requiredPermissions` capability gate, and short-circuits a boolean `visible` instead of treating it as a broken expression (#34… (objectui `d915c47b3`)
  - **patch** — Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface… (objectui `d915c47b3`)
  - **patch** — Conditional-rule predicates that fail to evaluate are no longer silent (objectstack#5149, appeal 2). `evalFieldPredicate` — the canonical funnel for `visibleWhen` / `readonlyWhen`… (objectui `a4cff5bd1`)
  - **patch** — `useAppContextSelectors` now derives each context selector's URL scope key from its own `id` instead of hardcoding the literal `package` query key. `App.contextSelectors` is an ar… (objectui `f59406d4e`)
  - **patch** — `toPredicateInput` is now re-exported from `@object-ui/core` instead of being reimplemented in `@object-ui/react`. Behaviour is byte-for-byte identical — the renderer-side copy in… (objectui `175bd79d8`)
  - **patch** — The group-tenancy write-target badge is now translated in all ten locales (objectui#3517) (objectui `7e2406abf`)
  - **patch** — Give `CommentThread`'s `+` reaction picker a real accessible name (objectui#3478) (objectui `d0d71df0e`)
  - **patch** — `RecordFormPage` no longer passes an inline `defaultValue` to the seven `t()` lookups whose keys are defined in all ten locale packs (`form.createTitle`, `form.editTitle`, `form.c… (objectui `c0c771c2f`)
  - **patch** — `createSafeTranslation`'s no-provider fallback interpolation now replaces **all** occurrences of each placeholder, matching i18next semantics on the provider path. (objectui `a6ec93d24`)

  objectui range: `f995a452d2ca...7dfbeb704e1e`

## 17.0.0-rc.4

### Minor Changes

- ce1155c: Console (objectui) refreshed to `f995a452d2ca`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 64 releasing of 65 changesets added across 98 non-merge commits; omitted: 1 release-nothing changeset, 33 commits carrying no changeset (they ship no package code).

  - **minor** — The record detail page now shows a read-gated approval panel (#3461). A record in approval used to expose NOTHING about the running approval to anyone but the current pending appr… (objectui `5af285210`)
  - **minor** — `DrillDownConfig` now declares only keys a renderer reads, and `target: 'navigate'` is honoured on charts too (#3354). (objectui `9e9e9a92f`)
  - **minor** — Console chrome i18n gaps (objectstack#5407). (objectui `3889ffb4c`)
  - **minor** — The console language choice now survives a reload. `I18nProvider` writes every language change to `localStorage` (`objectui-locale`, exported as `LOCALE_STORAGE_KEY`) and boots th… (objectui `0554e889c`)
  - **minor** — `<ObjectChart>` declares `drillDown` as a registry input, so the SDUI save gate treats the segment drill as a contract prop instead of an unknown one (framework#5022). (objectui `524a6357b`)
  - **minor** — The environment entitlement dialog now reads its context from `error.details.*` — the single declared location — and the flat dual-dialect tolerance is deleted (objectui#3329, the… (objectui `8ec406728`)
  - **minor** — `@object-ui/core` now ships the server-action dispatcher factory — `createServerActionHandler({ fetch, baseUrl, resolveObject, ... })` — so any consumer of the runner (standalone… (objectui `5781fb15a`)
  - **minor** — `AppSchemaRenderer` now derives area visibility from the items inside the area, closing the visible-but-empty regression the spec 17.0.0 area-key retirement left behind (objectui#… (objectui `608669eb5`)
  - **minor** — Track `@objectstack/spec` 17.0.0-rc.2 (objectui#3235, #3208, #3287, #3264). (objectui `d22ae31ce`)
  - **minor** — Field widgets no longer spread renderer-only props — or arbitrary keys from a field config — onto the DOM element they render (objectui#3291). (objectui `19b8c9be3`)
  - **minor** — `RichTextField` honours `mobile_fullscreen`, so `mobile.fullscreenLongText` is finally true of rich text too (objectui#3301). (objectui `30ae33a77`)
  - **minor** — `mobile.fullscreenLongText` finally reaches auto-generated long-text fields, and `mobile_fullscreen` gets one declared carrier (objectui#3245). (objectui `f44d8727f`)
  - **minor** — **BREAKING (v17)** — The flow designer writes node geometry as the spec's `FlowNode.position`, not its own `ui: { x, y }` (objectui#3172). (objectui `6e794a19e`)
  - **minor** — **BREAKING (v17)** — field widgets receive their metadata on ONE key, `field`. `schema` is removed from the widget contract (objectui#3233). (objectui `042e09d77`)
  - **patch** — `UserFilters` no longer carries its own operator table when it lowers a `ViewTab.filter` preset into an ObjectQL AST node. The private `specOperatorToAst` was the second hand-kept… (objectui `d7f350a89`)
  - **patch** — Name `CommentThread`'s three emoji-only buttons, and follow the session language past the 7-day mark (objectui#3441) (objectui `65516ba4a`)
  - **patch** — `toFilterNode` now lowers a spec `ViewFilterRule[]` into ObjectQL AST nodes instead of returning the array verbatim, so a saved view's stored filter reaches `$filter` as something… (objectui `2a9513d81`)
  - **patch** — Localize the create / edit / view form title `ObjectView` builds itself (objectui#3462) (objectui `28b2e6571`)
  - **patch** — Localize the record-detail headings that `ObjectKanban`, `ObjectTree` and `ObjectView` build themselves (objectui#3459) (objectui `aa36e6073`)
  - **patch** — Localize the record-detail overlay heading that `ListView` and `ObjectGrid` build themselves (objectui#3426) (objectui `61958416e`)
  - **patch** — The close button that the `Sheet` and `Dialog` primitives auto-render now announces itself in the session locale instead of always in English. Both buttons are icon-only (a lucide… (objectui `71be40696`)
  - **patch** — Localize `PresenceAvatars` — the avatar stack's accessible name and tooltips follow the session language (objectui#3440) (objectui `ca0fa8fab`)
  - **patch** — `PageRenderer` no longer renders its own `<h1>` when the page authors a titled `page:header`, so a page has exactly one level-1 heading. Every non-record page used to render the p… (objectui `06632e9d1`)
  - **patch** — Localize `@object-ui/collaboration` — `CommentThread` no longer hardcodes English (objectstack#5506) (objectui `94c5b7c4e`)
  - **patch** — `TextAreaField`'s fullscreen edit dialog now gives screen reader users the character count it has always shown sighted ones. The dialog's footer counter was a bare `{n}/{max}` spa… (objectui `f789c3b3a`)
  - **patch** — `ObjectDataPage`'s "Save as view" now folds the active URL drill conditions into `@objectstack/spec` `ViewFilterRule`s before persisting them, instead of writing the runtime filte… (objectui `875c5fafb`)
  - **patch** — Localize `RecordDetailDrawer`'s drag-resize handle (objectstack#5733) (objectui `5a24ad9cb`)
  - **patch** — The record picker's filter panel now sends the AUTHORED value of a picked `select` filter option instead of the control's stringified form. Radix `Select` speaks strings — options… (objectui `34d9169f6`)
  - **patch** — Localize the record-overlay and tab-badge chrome that #5430's sweep left behind (objectstack#5506) (objectui `5dd012776`)
  - **patch** — The lookup "Browse all records" Record Picker's filter panel now offers the options a `select` field declares in its schema (objectui#3336). `LookupField` turns each typed picker… (objectui `5881a2cc4`)
  - **patch** — `TextAreaField`'s character counter no longer re-announces itself on every keystroke. Measured on `main` in a zh session with `maxLength: 500`, typing a 52-character sentence one… (objectui `789fe3ee2`)
  - **patch** — Fix matrix report cells showing another bucket's numbers when dimension values run together. (objectui `509104a1b`)
  - **patch** — Fix dataset pivot cells showing another row's numbers when a dimension value contains a space. (objectui `ce7cbe5af`)
  - **patch** — Give `InlineCreateRelated`'s card-header close button an accessible name (objectui#3411 — the neighbouring defect found while implementing #3381/PR #3410, in the same file and lef… (objectui `58a00f0b4`)
  - **patch** — Give `InlineCreateRelated`'s "Link Existing" search box a real accessible name (objectui#3381 — the neighbouring defect found while implementing #3341/PR #3380, and left out of th… (objectui `b17ce4c25`)
  - **patch** — `TextAreaField`'s character counter now announces itself in the session locale. The counter block — rendered only when the field declares `maxLength` — carried the accessible name… (objectui `2409e1d04`)
  - **patch** — fix(fields): translate the registered path's fullscreen long-text dialog (objectui#3404) (objectui `6fe485bf2`)
  - **patch** — `TextAreaField` / `RichTextField` now honour `disabled` on their fullscreen editing path. `disabled` used to reach the inline control only: `showFullscreenButton` never consulted… (objectui `7d08c3feb`)
  - **patch** — The form renderer's built-in `textarea` branch now honours `readonly` / `disabled` on its fullscreen exit, which previously bypassed both (objectui#3400). `renderFieldComponent` d… (objectui `fd54c3e7a`)
  - **patch** — 表单内置 `textarea` 的全屏编辑对话框现在能拿到字段自己的 label：对话框标题显示字段名而不是恒定的通用词「编辑文本」，同一张表单上多个长文本字段的展开按钮也终于有了互不相同的无障碍名（objectui#3393）。 (objectui `85c4c9ce0`)
  - **patch** — The form renderer's built-in `textarea` branch reads the fullscreen long-text flag on one spelling (objectui#3303). (objectui `9cbcbf478`)
  - **patch** — The form renderer's last user-visible English literals now go through i18n (#3272). The fullscreen long-text editor (`mobile_fullscreen`) was an entire untranslated dialog — title… (objectui `4eeb932aa`)
  - **patch** — Localize the last untranslated console-chrome accessible names (objectstack#5430) (objectui `b71fc92f3`)
  - **patch** — `ObjectGantt`'s quick-filter bar is now localized instead of pinned to Chinese. The four `QuickFilterBar` labels (`all`, `clear`, `empty`, `resultSummary`) were hardcoded as Chine… (objectui `5c856ecb5`)
  - **patch** — Associate the label with its control at the two form surfaces where the two were never programmatically connected (objectui#3341 — found while implementing #3299/PR #3340, and del… (objectui `53811d179`)
  - **patch** — `ActionEngine.getActionsForLocation` now evaluates a `{ dialect: 'cel', source }` action `visible` predicate on the canonical `@objectstack/formula` engine instead of the legacy J… (objectui `18cd43289`)
  - **patch** — Settings pages read the declared `{ success, data }` response envelope, so the whole Setup → Configuration section works again against a framework#3843 server (objectui#3366). (objectui `7d0c6de39`)
  - **patch** — The flow designer no longer seeds new `wait` nodes with the retired `waitEventConfig.onTimeout` (objectui#3316). (objectui `35da149c5`)
  - **patch** — Gallery covers now resolve the `coverField` value through its **file value shape** instead of assuming the field value _is_ a URL string, so an ADR-0104-conforming `image` value r… (objectui `978705c8f`)
  - **patch** — The list toolbar's "Filter" now saves. Saving a filter from the runtime toolbar PUT the FilterBuilder's whole group object (`{ id, logic, conditions }`) into the view's `filter`,… (objectui `68b6a2855`)
  - **patch** — The lookup "Browse all records" Record Picker now formats its columns with the same field metadata the list view uses (objectui#3333). Previously the dialog handed cell renderers… (objectui `9bc3709b9`)
  - **patch** — Behavior change — **an authored display `type` can NARROW inline editability, but never WIDEN it** (objectui#3355). (objectui `bbbde1207`)
  - **patch** — `record:highlights` now honours a `readonly: true` on an authored field entry, so a header chip for a platform-owned column no longer offers inline edit. `HeaderHighlight`'s edita… (objectui `23018cc03`)
  - **patch** — Deliver the required state to the control in the five renderers outside the object form that still painted it as an asterisk only (objectui#3299 — the same defect #3290/#3298 fixe… (objectui `532cf8b9e`)
  - **patch** — The Combobox trigger now declares `type="button"` explicitly, so it can never submit an enclosing `<form>` (objectui#3344). The current Radix `PopoverTrigger` happens to supply `t… (objectui `34595eb45`)
  - **patch** — `TagsField` no longer ships a hardcoded Chinese input placeholder (objectui#3342, AGENTS.md Commandment #-1). The placeholder now resolves through the pinned chain: the author-dec… (objectui `c7ed4c366`)
  - **patch** — AddressField / GeolocationField sub-inputs now derive their DOM ids from a `useId()` prefix + sub-field name (the RadioField / CheckboxesField `groupId` paradigm) instead of hardc… (objectui `b7165ce47`)
  - **patch** — 20 more registered field widgets now announce a failed validation to assistive tech: `multiselect`, `radio`, `checkboxes`, `tags`, `lookup`, `master_detail`, `user`, `owner`, `fil… (objectui `8d8094a7c`)
  - **patch** — `field:permission-facet-link` now registers through `withFieldCarrier` — the repo's only raw `field:` registration bypassed the single-metadata-carrier seam (objectui#3233), so un… (objectui `c7fba276e`)
  - **patch** — The console server-action wrapper's `opensInNewTab` choreography no longer ships hard-coded bilingual Chinese/English copy (objectui#3321, AGENTS.md Commandment #-1): the pre-open… (objectui `a41568462`)
  - **patch** — `AppSidebar` and `UnifiedSidebar` area switchers now adopt the derived area visibility introduced for `AppSchemaRenderer` in objectui#3311, closing the same visible-but-empty gap… (objectui `8d9984c2e`)
  - **patch** — RecordDetailView's `type:'modal'` dispatch no longer falls back to the server-side action handler when the target resolves to neither a page nor an object. That fallthrough could… (objectui `94755bb88`)
  - **patch** — `field:select` now announces its validation state to assistive tech: the widget's DOM pass-through lands on the Radix `SelectTrigger` — the focusable `<button role="combobox">` a… (objectui `49f7449f9`)
  - **patch** — The required state now reaches the input control as `aria-required`, instead of existing only as part of the control's accessible name (objectui#3290). (objectui `680080ada`)

  objectui range: `f5bc4c78be76...f995a452d2ca`

## 17.0.0-rc.2

### Minor Changes

- 072806a: Console (objectui) refreshed to `785b8a5d432c` — the 2026-08-02 objectui batch reaches v17 (#4665).

  Until this pin moves, a merged objectui fix exists only on objectui's `main`: the
  release pipeline clones objectui at `.objectui-sha`, so anything newer is simply not
  in the artifact the platform ships, and its frontend changeset never reaches the
  platform's release history (#3340). Four of the seven PRs merged that day changed
  published packages, and one of them is **breaking for authoring** — so that
  migration is written out here, in the layer the release notes are compiled from,
  rather than left implicit in a SHA.

  ## Breaking for authoring — an action param's picker target is `reference`, and only `reference` (objectui#3203)

  `ActionParam` in `@object-ui/types` no longer declares the nine resolved-side picker
  keys: `referenceTo`, `displayField`, `idField`, `descriptionField`, `titleFormat`,
  `lookupColumns`, `lookupFilters`, `lookupPageSize`, `dependsOn`.

  Migration:

  - **Inline picker target** — rewrite to `reference`:
    FROM `{ name: 'account_id', type: 'lookup', referenceTo: 'account' }`
    TO `{ name: 'account_id', type: 'lookup', reference: 'account' }`
  - **The other eight** — make the param **field-backed** and it inherits the whole
    picker group from the object field: `{ field: 'account_id' }`.

  **This removes a compile-time illusion, not a capability.** Those keys were never
  storable: `@objectstack/spec`'s `ActionParamSchema` is `.strict()`, its authorable key
  list carries `reference` and not `referenceTo`, and its alias table names
  `referenceto → reference` by hand — so an authored `referenceTo` has always been a
  hard parse rejection on the server. Only `tsc` waved it through, against objectui's
  public type, which meant the mistake surfaced at publish time instead of at the
  authoring keystroke. `ActionParam` is now derived from the spec schema
  (`Omit< z.input< typeof ActionParamSchema >, 'type' >`), so the authoring type and
  the parser can no longer disagree about a spelling, and `resolveActionParams()`
  additionally names any resolved-only key it meets in a dev-mode warning with the
  prescription above — covering params authored in plain JS or JSON, which `tsc` never
  sees.

  ## Also author-visible in this batch

  - **An unrecognised dashboard date-filter value is skipped and named, not compared**
    (objectui#3196, `@object-ui/core` minor — the other half of #4475). A `date` /
    `dateRange` value that is neither a known preset nor a parseable date used to fall
    through to "bare string means equality on that day", so a typo
    (`defaultValue: 'last_7_dayz'`) reached the backend as `WHERE created_at = $1` and
    answered `200 OK` with zero rows — indistinguishable from "this range has no data".
    Such a filter is now dropped with a `console.warn` naming the filter, the offending
    value and the accepted spellings; the widget's numbers go from 0 to unfiltered.
  - **`record:activity` fetches a feed instead of rendering a permanently empty one**
    (objectui#3204, `@object-ui/plugin-detail`). The block's eleven declared inputs were
    filters over a hard-coded `items={[]}`; the feed now resolves from `items` → a
    mounted `DiscussionContext` → a self-fetch of `sys_activity` scoped to the bound
    record, and the read-side inputs actually filter. `showSubscriptionToggle` is
    labelled `NOT IMPLEMENTED` in its own input description rather than left looking
    configurable.
  - **A fetching activity feed says "loading", not "No activity recorded"**
    (objectui#3210, `@object-ui/plugin-detail` patch). The declared `loading` prop was
    destructured into `_loading` and never read, so the panel asserted the record had no
    activity for the whole duration of every fetch.
  - **`managedBy: 'system'` → `'system-data'` follow-through** (objectui#3214): the
    Console now speaks the vocabulary this platform's retirement left standing.

  Full frontend range below. `fix(ci)` / CI-only commits are omitted — they release
  nothing and are not in the shipped bundle.

  - fix(fields)!: FieldWidgetComponentProps stops claiming to have every key (#3221) (#3230)
  - fix(app-shell): inspectors read and write the expression envelope (#3218) (#3228)
  - fix(app-shell): flow simulator evaluates a `{ dialect, source }` edge guard (#3216) (#3217)
  - feat(types,core,app-shell)!: follow the `managedBy: 'system'` → `'system-data'` retirement (objectstack#3355) (#3214)
  - fix(app-shell): flow branch editor stamps an id on the edges it creates (#3202) (#3215)
  - fix(plugin-detail): a fetching activity feed says "loading", not "No activity recorded" (#3205) (#3210)
  - feat(plugin-detail): record:activity fetches a feed instead of rendering an empty one (#3165) (#3204)
  - fix(types,app-shell)!: `reference` 是 action param 唯一可作者化的 picker 目标 (#3174) (#3203)
  - fix(deps): #3184 可合并版 —— focus-scope 栈驱逐竞态补丁,解冲突 + 补丁存废说明 (#3200)
  - fix(core): 未知的 date filter 值改为跳过并警告,不再降级成永不命中的等值 (#3151) (#3196)
  - fix(types): retarget the objectstack#4171 inverted pins at their real trigger (#3177) (#3194)
  - fix(components,grid): a grid's search box searches the list, not the page you can see (#3118) (#3192)
  - feat(core): declare the 18 spec-owned action keys ActionDef absorbed silently (#3190)
  - fix(app-shell): actually compile `spec-symbol-parity.test.ts`'s type assertions (#3181) (#3187)
  - feat(app-shell): wire navigation action items to the console action runtime (framework#4509) (#3180)
  - feat(deps)!: upgrade to @objectstack/spec 17.0.0-rc.1 and retire the wait timeout fields (#3101) (#3178)
  - fix(studio,timeline,list): 表单设计器解析对象翻译；timeline 认它自己配置的日期字段 (#3134, #3129) (#3175)
  - feat(flow-designer)!: the script node authors a function call, and nothing else (framework#4343) (#3170)
  - fix(studio): stop offering the retired `action.shortcut` / `action.bulkEnabled` keys (#3154)
  - fix(dashboard): date 型 globalFilter 的预设名默认值应提升为区间 (objectstack#4475) (#3150)
  - fix(dashboard,report): honor the declared percent scale so a ratio of 1 renders as 100.0% (#3136) (#3140)
  - fix(charts): name the slices — pie/donut legends lost their labels to a `type` dimension (#3135) (#3138)
  - fix(approvals): record-header Reject fires after one dialog again (#3126) (#3128)
  - fix(console): binding-reach 探针少报了自己 6 个块的覆盖面，而且是静默的 (#3149) (#3153)
  - fix(flow-designer): the default path is the edge marker, not the branch (#3148)
  - fix(plugin-list,plugin-form): 在注册表路径上把 dataSource 接到 list-view / embeddable-form (#3144) (#3147)
  - fix(actions): one placement rule for `locations` — declare it or it renders nowhere (#3145)
  - fix(app-shell): datasource preview 不再报告读副本数量 (objectstack#4468) (#3143)
  - feat(grid): aggregate single-call mode for bulk actions — execution: 'aggregate' (#3141)
  - fix(form): `required` is presence, not truthiness — `false` and `0` are values (#3137)
  - fix(environment): localize the entitlement dialog + read cloud's nested error envelope (#3130)
  - fix(i18n): resolve qualified view ids (#3132)

  objectui range: `7d9734d5e321...785b8a5d432c`

- be25f97: Console (objectui) refreshed to `f5bc4c78be76`. Frontend changes in this range:

  Derived from the changesets objectui declared over the range — 11 releasing of 11 changesets added across 31 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

  - **minor** — Field widgets are finally told when their field fails validation, and the props slot that carries it takes the name the published contract gives it (objectui#3222). (objectui `56409c28c`)
  - **minor** — Retire `validation` from the action-param contract — it was declared on both halves, read by neither, and rejected outright by the server (objectui#3201). (objectui `f833d3ae4`)
  - **patch** — Five metadata designers stop rendering keys `@objectstack/spec` rejects, and start rendering the keys it declares (objectui#3275, objectui#3281). (objectui `8ff3ad7b8`)
  - **patch** — The Page block inspector's conditional-visibility control now authors `visibleWhen`, and says "Visible when" while doing it (objectui#3229). (objectui `8e02ad7f2`)
  - **patch** — The record discussion panel no longer shows the PREVIOUS record's comments and activity (objectui#3268). (objectui `a8aa57663`)
  - **patch** — The form renderer's built-in `select` branch stops saying "No options available" in English to non-English sessions (objectui#3263). (objectui `a7651e640`)
  - **patch** — The record discussion panel now says "loading" while it is loading, instead of "No comments yet" (objectui#3209). (objectui `12bf6691e`)
  - **patch** — The legacy `page-header` alias stops advertising `description` as an authorable key (objectui#3226). (objectui `d2363e710`)
  - **patch** — The option widgets' "this list cannot be filled" message now has one source, and it is translated (objectui#3231). (objectui `825bbe33c`)
  - **patch** — `ToolPreview` stops advertising retired `ToolSchema` flags (objectui#3236). (objectui `30ac2e1ee`)
  - **patch** — `TextAreaField`'s mobile fullscreen flag converges on its one real producer (objectui#3232). (objectui `a321fa461`)

  objectui range: `785b8a5d432c...f5bc4c78be76`

## 17.0.0-rc.1

### Minor Changes

- 302e972: Console (objectui) refreshed to `7d9734d5e321`. Frontend changes in this range:

  - feat(core): say which column identity key won, out loud (#3104 PR3) (#3124)
  - fix(detail): Attachments become a peer tab with a live count badge, and their copy is translated (objectstack#4358) (#3123)
  - fix(console,app-shell): readable reassign hand-off + "System" label for svc:\* audit actors (objectstack#4365, objectstack#4366) (#3121)
  - fix(fields): lookup multi-value hydration batches via $in and shows loading instead of the empty placeholder (#3108) (#3120)
  - fix(list,grid,detail,tree,core): every column resolver reads one key (#3104 PR2) (#3122)
  - fix(core,list): 列身份归一到 ingestion chokepoint — 一列一个身份 (#3104 PR1) (#3119)
  - fix(detail): a related list has one sorting semantics instead of two (#3106) (#3113)
  - feat(components,grid,list): a column-header sort orders the whole list, not the page you can see (#3106) (#3112)
  - fix(data-objectstack): a string `$orderby` reaches the server as a sort, not a list of character indices (#3106) (#3109)
  - fix(types,core): the `*Validation` five derive from spec 17, and the engine stops disagreeing with the server (#3103) (#3107)
  - fix(app-shell): lookup-param helpText only renders when the param actually degraded to a raw-id input (#3094) (#3095)
  - fix(form): numeric/boolean option values survive selection typed (#3090 PR3b) (#3100)
  - fix(list,detail): sorting a lookup column stops ordering by an invisible key (#3096) (#3102)
  - feat(flow-designer): the script node's form authors what the executor runs (framework#4278) (#3099)
  - fix(form): declare the runtime field metadata slot, ban the spec FormField misimport (#3090 PR3a) (#3097)
  - fix(console): LocalizationFetchProvider retries a transient /me/localization failure (#3098)
  - fix(app-shell,i18n): drop the developer-voiced default form subtitle (#3093)
  - fix(form): spec-vocabulary fields stop crashing the standalone form; every surface names the boundary (#3090) (#3092)
  - fix(form): harden the spec↔runtime form-field chokepoint, derive SelectOption, complete FormFieldSchema (#3090) (#3091)
  - fix(types,layout): navigation metadata stops losing the spec fields the renderer already honours (objectstack#4115) (#3088)

  objectui range: `bebaebd39ace...7d9734d5e321`

- 4580597: Console (objectui) refreshed to `96ee72e85439`. Frontend changes in this range:

  - fix(console): render the redaction notice on the enveloped resolve body (objectstack#3983) (#2980)
  - feat(sdui): guard the public contract against silent drift (#2979)
  - fix(sdui): lazy public blocks reach a kind:'react' page scope; ReactRunner keeps its errors (#2976)
  - fix(list,data): bridge every spec view operator onto the filter AST (#2901) (#2974)
  - fix(errors): error-code branches survive the framework's ADR-0112 rename (objectstack#3841) (#2977)
  - fix(fields): a select no longer wipes itself when its value outruns its options (#2968) (#2969)
  - fix(approvals): decision outputs reach both decision surfaces (#2955) (#2961)

  objectui range: `e651c936870e...96ee72e85439`

- eb9230c: Console (objectui) refreshed to `a136322f8723`. Frontend changes in this range:

  - fix(app-shell)!: a modal action is client-side only — drop the server fallthrough (objectstack#3959) (#2973)
  - fix(app-shell)!: the server-action URL identifies an action by `name`, not `target` (ADR-0110 D1) (#2970)
  - fix(form): a server rejection that names fields now marks those fields (#2966)
  - fix(actions): one source for the /actions envelope rule, and redirectUrl finally works (#2967)
  - fix(actions): apply the ADR-0066 D4 capability gate on every action surface (framework#3923) (#2965)
  - fix(detail): multi-value lookup is selectable in inline edit (#2957)
  - fix(actions): a failed server action no longer reports as success (green toast) (#2963)
  - fix(fields): the criteria builder stops calling an empty criteria "All records" (#2962)
  - feat(report): carry a report's `order` into the dataset selection (framework#3916) (#2964)
  - feat(views): the list toolbar speaks one vocabulary — `userActions` (#2890) (#2948)

  objectui range: `4a4829d0ef39...a136322f8723`

  **Release-critical for v17.** The previous pin (`4a4829d0ef39`) predates the
  ADR-0110 D1 client fix, so the console it builds still posts `action.target`
  to `/api/v1/actions/:object/:action`. Against a v17 server — which resolves
  the declaration by `name` and refuses an unresolvable one (D3) — every
  target-bound script action would return 404 from the shipped console. The
  lockstep the ADR called for is enforced by THIS pin, not by merging the
  objectui PR, so v17 must not ship without this bump.

- 29e5a0e: Console (objectui) refreshed to `bebaebd39ace`. Frontend changes in this range:

  - fix(console): marketplace read cloud errors seven different ways — two break on the conversion, two are broken today (cloud#944) (#3086)
  - feat(console): settings validation errors render against the fields that caused them (objectstack#4224 follow-up) (#3083)
  - fix(notifications): the config, position and action variant are read instead of forked or ignored (#3014 follow-up) (#3085)
  - fix(data-objectstack,core): an object filter no longer depends on whether the query expands a lookup (#3084)
  - fix(app-shell): a published configSchema can no longer delete a node's sibling-block editors (objectstack#4045) (#3082)
  - fix(view,list,core): a view's filter no longer disappears, or arrives as a predicate on columns that don't exist (#3081)
  - fix(console): read the SETTINGS_LOCKED key from `error.details`, tolerating both shapes (objectstack#4224) (#3079)
  - fix(list,data-objectstack,types): exporting a searched list no longer downloads the unsearched superset (#3078)
  - fix(types,app-shell): one ObjectPermission, and the preview stops hiding three of its fields (objectstack#4115) (#3077)
  - fix(notifications): the spec `icon` is read instead of stored and ignored (#3014 follow-up) (#3076)
  - fix(plugin-grid): bulk-action params render the shared form field widgets — lookup errors get Retry, sys_user params get the PeoplePicker (#3064, ADR-0059) (#3073)
  - feat(app-shell): the console mounts the notification surfaces (#3014 follow-up) (#3075)
  - fix(data-objectstack): a view's own filter no longer vanishes when the user adds one (#3072)
  - feat(notifications): each spec displayType gets its own presentation (#3014) (#3071)
  - fix(grid): evaluate a bulk action's `visible` per selected record (#3067) (#3070)
  - feat(sdui): curate the page:_, element:_ and action:\* families into the public contract (#3069)
  - fix(list,i18n): a 400 from the server no longer reads as "check your connection" (#3066)
  - feat(page,element): declare inputs for the eight configurable page:_/element:_ blocks (#3065)
  - fix(app-shell,plugin-grid,i18n): autonumber/readonly fields become match-only import targets so "update if the record number exists" works (#3061)
  - fix(types): Page/App/Dashboard validate the spec's own fields instead of passing them through (objectstack#4115 group C) (#3063)
  - fix(plugin-form,i18n): form edit saves send If-Match and surface 409 conflicts instead of silently overwriting (#3060)
  - fix(console): 403 blamed on the network, ⌘K search capped at 8 objects, nav gating fields inert (#3044)
  - fix(grid): a bulk delete / by-name action clears the row checkboxes too (#3056) (#3058)
  - fix(types,detail): derive five spec-named symbols instead of forking them (objectstack#4115) (#3057)
  - fix(grid): drop the `bulkEnabled` derivation — the spec key is a tombstone (#3002) (#3053)
  - fix(permissions,console): retry a transient /me/permissions failure instead of stranding the app on its loading state (#3050) (#3052)
  - fix(test-setup): stop shadowing ten real registrations, and declare page:header's inputs (#3051)
  - fix(scripts): --check reports real divergence instead of calling all 46 components "modified" (#3049)
  - fix(view): the chart view gets a label and an icon in the view switcher (#2916) (#3040)
  - feat(form): SplitForm honours the spec's new `FormSection.pane` (#3041)
  - fix(types,layout): nav item type 'component' joins NavigationItemType and its zod enum (#2918) (#3039)
  - fix(registry): prefix every namespaced key exactly once, in every namespace (#3037)
  - fix(scripts): shadcn-sync refuses to silently delete local edits, and compiles the package after it writes (#3035)
  - fix(scripts): shadcn-sync rewrites the registry paths Shadcn actually serves, and refuses to write a file when it cannot (#3033)
  - fix(grid,types): an object-declared bulk action runs over the selected records (#3002) (#3031)
  - fix(form): a wizard with `allowSkip` no longer submits past the fields you skipped (#3030)
  - fix(components): resizable is a diverged file, not a synced one — stop the sync from breaking the build, and finish the v4 migration in it (#3029)
  - feat(studio): a page button created in Studio can be given an action (#2997) (#3028)
  - feat(record): declare inputs for the seven configurable record:\* blocks, and curate six (#3027)
  - feat(eslint): ban dynamic imports in test hooks, and convert the last 33 sites (#3026)

  objectui range: `96ee72e85439...bebaebd39ace`

- bec0f9a: Console (objectui) backfill for `2cb8d78e24ad...c6cfdf1288b6` — the one refresh in
  the v17 window that landed with no changeset.

  `scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every bump
  precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`). One
  bump in this window did not, so 25 commits — including two breaking ones — were
  absent from the release history and from the curated v17 page. This entry records
  them after the fact; it declares no new SHA move (`.objectui-sha` already points
  past this range at `4a4829d0ef39`).

  Frontend changes in this range:

  - feat(react)!: trim dead device/preference delegates from useClientNotifications (objectstack#3612 companion) (#2862)
  - feat(types)!: drop the ObjectStack/ObjectOS/ObjectQL/ObjectUI Capabilities re-exports (#2860)
  - feat: gate detail/form edit & delete on the server's effective operation set (framework#3546) (#2832)
  - feat(app-shell): approver values become record lookups (framework#3508) (#2834)
  - feat(console): group tenancy posture affordances — org switcher as write context + org attribution (ADR-0105 Phase 1) (#2858)
  - feat(console): i18n the system-settings hub (objectui#2851 P2) (#2859)
  - fix(dashboard,charts): resolve `{current_user_id}` in widget filters (framework#3574) (#2857)
  - fix(grid): validate email format in the import preview (objectstack#3566) (#2840)
  - fix(fields): consistent image-field rendering + click-to-zoom (#2836) (#2837)
  - fix(app-shell): stop the flow-node repeater from committing during render (#2838) (#2839)

  Plus 15 dependency bumps, three of them major for the Console's own build:
  `maplibre-gl` 5→6, `chalk` 5→6, `jsdom` 29→30 (dev).

  objectui range: `2cb8d78e24ad...c6cfdf1288b6`

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 60110bb: Console (objectui) backfill for `96ee72e85439...bebaebd39ace` — the 27 fix
  commits that refresh's changeset did not enumerate.

  `scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every
  bump precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`),
  and the `console-bebaebd39ace.md` entry it wrote covers only the tail of its own
  range: the range holds **94** first-parent commits, the enumeration lists 40,
  and its oldest entry is #3026. Everything that merged earlier inside the same
  range went unrecorded — in the release history and in the curated v17 page.
  This is the second instance of the failure `console-c6cfdf1288b6-backfill.md`
  records; it declares no SHA move (`.objectui-sha` already points at
  `7d9734d5e321`, past this range).

  The 27 are all `fix`, hence `patch`. Several are data-loss fixes an upgrading
  Console user feels immediately:

  - fix(form): a tabbed/sectioned modal keeps every tab's values (#2959, #2153) (#2987)
  - fix(form): a split form keeps BOTH panels' values (#2153) (#3012)
  - fix(form): a defaultValues change no longer discards the field being filled (#2982) (#2991)
  - fix(components): apply new form defaultValues in the commit that renders them (#3001)
  - fix(plugin-form): block page unload while a modal/drawer form has unsaved input (#2998)
  - fix(plugin-form): swapping recordId no longer leaves the previous record on screen (#3005)
  - fix(plugin-form): a wizard that ends on a field-less review step can finish (#2986)
  - fix(form): a tabbed/split form honours the form view's own `columns` (#3018)
  - fix(console): a flow or action that failed under HTTP 200 stops reporting success (#2958) (#2995)
  - fix(grid): a legacy string row action runs instead of green-toasting a no-op (#2960) (#2996)
  - fix(spec-parity): render the six Tier-1 spec values right instead of silently wrong (#2941) (#2993)
  - fix(spec-parity): the Tier-2 spec values render instead of validating into nothing (#2942) (#3008)
  - fix(spec-parity): the Tier-3 spec values render instead of red-boxing (#2943) (#3011)
  - fix(view,components): the spec→FilterBuilder operator table covers the whole view vocabulary (#2945) (#2989)
  - fix(view): the spec→FilterBuilder map follows the four operators #2942 added (#3022)
  - fix(charts): a spec `series[].type` draws, and a spec-shape `series` plots at all (#2945) (#3004)
  - fix(charts): say so when rows carry no category key, instead of drawing an empty axis (#3007)
  - fix(analytics): a missing analytics capability no longer renders as an empty KPI (objectstack#3891) (#2981)
  - fix(chatbot): read the agent catalog in the declared envelope too (objectstack#4053) (#2992)
  - fix(sdui): a react page keeps its state; a source that exports nothing fails loudly (#2984)
  - fix(sdui): a kind:'html' page can use lazily-registered blocks, and recovers when one registers late (#2988)
  - fix(sdui): stop the react page's "no adapter yet" fallback churning its provider context (#3000)
  - fix(sdui): the curated contract lists record:line_items, the tag that actually resolves (#3006)
  - fix(record): register the record:\* blocks under one key, prefixed once (#3023)
  - fix(plugin-list,plugin-grid): drop undeliverable formats from the export menu (#2999)
  - fix(components): a stacked resizable group gets a divider, not a 1px sliver (#3024)
  - fix(components,app-shell): the last two `direction` props follow v4's rename to `orientation` (#3025)

  Also in the range and deliberately not listed here: the refactor/chore/test/
  build/ci PRs the bump script's fix/feat filter excludes by design — including
  three breaking-flagged refactors already reflected in the spec-side work
  (#2990 the `execute` alias deleted from the action runner, objectstack#3856;
  #3003 action sub-vocabularies derived from spec, and #3020 authoring types
  become input types, both objectstack#4074).

  objectui range: `96ee72e85439...bebaebd39ace`

- 6fd0786: Console (objectui) refreshed to `e651c936870e`. Frontend changes in this range:

  - fix(app-shell): unwrap the declared response envelope on the datasource page and the api-action runner (objectstack#3843) (#2972)
  - fix(actions): read objectstack#3962's single-wrapped /actions responses (#2971)

  objectui range: `a136322f8723...e651c936870e`

## 17.0.0-rc.0

### Minor Changes

- 8607a55: Console (objectui) refreshed to `1bb77aa24514`. Frontend changes in this range:

  - fix(flow-runner): honor a screen field's `visibleWhen` — render and validation (framework#3528) (#2899)
  - fix(i18n): unconditional Chinese in the chatbot confirm card and field inspector (#2884, #2885) (#2900)
  - fix(actions): one precedence for `target`/`execute`, and stop mislabeling server-side `body` (#2896) (#2895)
  - fix(i18n): close the last three zh-branch gaps (#2871, part 3) (#2898)
  - feat(grid): compute all eleven spec column summary aggregations (#2890)
  - feat(console): make `delegated_admin` reachable and narrow both role pickers (framework#3697) (#2891)
  - fix(app-shell): localize the two DeclaredActionsBar strings that bypassed i18n (#2762 P0-3) (#2894)
  - fix(i18n): delete the four `pick({en,zh})` clones (#2871, part 2) (#2893)
  - fix(views): the five per-view-type configs speak the spec vocabulary (#2231 phase 3) (#2892)
  - feat(grid): gate list row Edit/Delete and bulk delete on the effective operation set (objectstack#3720) (#2889)
  - feat(charts): honor `ChartAxis.stepSize`, `ChartConfig.description` and `.height` (framework#3752) (#2888)
  - fix(i18n): retire four hand-rolled zh/en branches (#2871, part 1) (#2887)
  - feat(charts): ObjectChart honors the spec `ChartConfig` author shape (#2880) (#2883)
  - fix(hooks): stop calling translation hooks inside try/catch (#2879) (#2881)
  - fix(charts): a fieldless `count` aggregate keyed its value column `undefined` (framework#3701) (#2878)
  - fix(i18n): make `en` the complete source of truth for grid import and set-password (#2872 b/c) (#2877)
  - fix(auth): localize the ADR-0069 remediation gate and the auth split-panel (#2870) (#2875)
  - fix(metadata-admin): drop the SkillPreview "Required Permissions" panel (framework#3686) (#2874)
  - feat(console): scoped-invitation placement — invite straight into a unit and positions (framework ADR-0105 D8) (#2868)
  - fix(attachments): read the storage service's new error envelope so gated downloads keep their friendly copy (objectstack#3675) (#2869)
  - fix(fls): wire real per-caller FLS into import targets and grid columns, drop dead field.permissions shape (objectstack#3661) (#2866)
  - fix(page,field): consume the spec's type/label/maxLength keys (framework#1878 §3 recheck) (#2867)
  - fix(cloud-connection): localize the Cloud Connection panel (objectstack#3589 follow-up) (#2865)
  - fix(dashboard,charts): send widget query options to the server, order funnel stages by the pipeline (#2864)
  - fix(action): honor the spec disabled predicate on every action-rendering surface (#1885 follow-through) (#2863)

  objectui range: `09c6a177bb4a...1bb77aa24514`

- b96c11b: Console (objectui) refreshed to `2cb8d78e24ad`. Frontend changes in this range:

  - fix(console): dispatch flow actions from every surface + cover the screen-flow round trip (framework#3528) (#2833)
  - feat(approvals): typed output pickers, quick-path guard, expression completion (framework#3447, #2829) (#2831)
  - fix(console): make a paused screen flow completable, and stop the runner from tearing down its host (framework#3528) (#2830)
  - feat(fields): adopt the file-as-reference value shape — ObjectStack ADR-0104 D3 wave 2 (PR-7) (#2828)
  - fix(console): resolve a modal action's `target` as a page, not an object (#3530) (#2826)
  - feat(approvals): dynamic decision-output fields + expression approver editing (framework#3447 P2) (#2827)
  - feat: render the server's effective API operation set (#3391 PR-4) (#2823)
  - fix(console): approval timeline attachment chip shows its name and opens (#2820) (#2821)
  - fix(i18n): localize FileField upload widget + approvals snapshot field labels (#2819)
  - feat(report)!: drop SpecReportColumn/SpecReportGrouping re-exports + retire the legacy ReportViewer chart fallback (#3463) (#2816)
  - feat(plugin-grid): "Import as historical data" option in the Import Wizard (framework #3479) (#2815)
  - feat(app-shell): toast when a save silently dropped read-only fields (framework #3431/#3455) (#2814)
  - fix(app-shell): remove never-firing `record-change` option from the flow trigger picker (#3427) (#2812)
  - fix(form): scroll+focus the first errored field on invalid submit (#2793) (#2813)
  - feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
  - feat(approvals): label pending-approver chips with their group (objectui#2807) (#2811)
  - fix(approvals): surface the admin override for a stuck request in the inbox (#3424) (#2810)
  - feat(studio): first-class notify flow node in the Studio palette + inspector (#2808)
  - feat(app-shell): Studio flow start node offers a "Record created or updated" trigger (#3427) (#2809)
  - fix: read spec-canonical keys for dashboard header title and field length rules (#2806)
  - fix(kanban): surface off-column records in an Uncategorized lane (#2792) (#2804)
  - fix(approvals): Approval Center density + amount emphasis (#2762 P2) (#2805)
  - fix(i18n): 补齐记录详情审批按钮与弹窗的国际化文案 (#2791)
  - fix(approvals): Approval Center triage + drawer readability pass (#2762 P1-2/3/4/5, P2) (#2803)
  - feat(app-shell): surface step warnings in the Flow Runs panel (#3407) (#2802)
  - feat(studio): surface the enable.searchable toggle in ObjectSettingsPanel (#2800) (#2801)
  - feat(app-shell): localize the automations flow designer & inspector (en-US + zh-CN) (#2796)
  - feat(form): consume spec-aligned FormView buttons/defaults in ObjectForm (#2790)
  - fix(approvals): Approval Center UX pass — badge nowrap, approve confirm, progress bar, localized declared actions (#2762) (#2789)
  - feat(app-shell): group/coalesce repeat notifications in the message center (#2765) (#2788)
  - fix(app-shell): 首页与消息中心的未国际化文案 (#2787)
  - fix(app-shell): give inline `lookup` action params a real record picker (#3405) (#2786)
  - fix(app-shell): map raw sys_activity rows in the inbox Activity tab (#2781) (#2782)
  - fix(app-shell): i18n the "Switch Object" breadcrumb dropdown label (#2783)
  - fix(data-table): keep right-pinned action column header sticky on horizontal scroll (#2785)
  - fix(app-shell): keep list-origin back link when switching detail tabs (#2775)

  objectui range: `cf2d56e32a11...2cb8d78e24ad`

- d69918d: Console (objectui) refreshed to `4a4829d0ef39`. Frontend changes in this range:

  - fix(fields): emit the spec's `$notContains`, and keep `secret` out of inline edit (#2901) (#2940)
  - fix(detail): distinguish "in approval (editable)" from locked, and stop losing write warnings (#2914)
  - fix(types): zod example teaches the Zod 4 `.issues` accessor, and `examples/` is type-checked (#2919) (#2939)
  - fix(plugin-grid,plugin-form,cli,+2): type-check the last five unchecked packages, and fix the two runtime bugs hiding there (#2919) (#2936)
  - fix(views): ListView reads the spec-canonical `filter` (#2890) (#2935)
  - fix(console,runner): render the approvals inbox against one ticking clock, and lint both packages (#2927) (#2930)
  - feat(lint): run ESLint on PRs, and cover every package (#2923) (#2928)
  - feat(setup): the datasource list shows the real connect verdict, with the operator-facing reason (framework#3827) (#2926)
  - fix(fields,core,detail): make the sharing-rule dialog usable — i18n, a picker that lists people, and permission-aware CTAs (#2920)
  - fix(detail): the approval band honors the node's `lockRecord` instead of assuming every approval locks (#2902) (#2906)
  - fix(console): the API console lists the whole AI family, and the tool preview stops linking to a 404 (framework#3718) (#2925)
  - fix(runner): type-check the package at all, fix the hidden DataSource violation (#2917) (#2922)
  - fix(console): the API console's AI group lists the routes that exist (framework#3718) (#2921)
  - fix(plugin-map): drop the `maplibre-gl@6` default import + gate type-check in CI (#2911) (#2915)
  - fix(i18n): compose the AI-model diagnostics summary client-side (#2886) (#2912)
  - fix(flow-designer): read approver value sources off the schema instead of mirroring them (framework#3508 follow-up) (#2910)
  - feat(i18n): complete the locale backfill — all ten packs reach full key parity (#2872) (#2909)
  - fix(list): show real match total in record-count bar under server pagination (#2873)
  - fix(i18n): the change card's Confirm button sent text the cloud gate rejects, + parity ratchet (#2905)
  - feat(i18n): translate the four highest-traffic namespaces into the eight trailing locales (#2872 part a) (#2903)

  objectui range: `1bb77aa24514...4a4829d0ef39`

### Patch Changes

- 6ba3788: Console (objectui) refreshed to `09c6a177bb4a`. Frontend changes in this range:

  - fix(grid): localize import result errors (objectstack#3566) (#2861)

  objectui range: `c6cfdf1288b6...09c6a177bb4a`

## 16.1.0

### Minor Changes

- 7b07417: Console (objectui) refreshed to `cf2d56e32a11`. Frontend changes in this range:

  - fix(list): keep injected owner_id out of auto-generated list columns (#2777) (#2779)
  - feat(search): surface record hits on the full search page + i18n group labels (#2776)
  - fix(i18n): apply globalActions label overlays on record-detail action bars (#2770)
  - fix(command-palette): surface record search hits from /api/v1/search (#3371) (#2772)
  - fix(SchemaForm): render sort repeater rows for union schemas (objectstack#3379) (#2771)

  objectui range: `9a5f016f7d5c...cf2d56e32a11`

## 16.0.0

### Minor Changes

- bfa3c3f: Console (objectui) refreshed to `3b2e4d98d904`. Frontend changes in this range:

  - fix(list): route remaining system-field groupings through shared classifier (#2706)
  - feat(console): user-import wizard defaults to the `auto` password policy (tracks framework#3236) (#2701)
  - feat(flow-designer): schema-driven keyValue + numberList mapping (#3304) (#2708)

  objectui range: `0318118e02fd...3b2e4d98d904`

- 39b56d0: Console (objectui) refreshed to `94d4876df090`. Frontend changes in this range:

  - feat(dashboard): Studio authors the ADR-0021 dataset shape only (framework#3251) (#2703)
  - feat(app-shell): render ActionParamDialog params through the shared form field-widget renderer (#2700, ADR-0059) (#2704)
  - feat(app-shell): distinguish writable system objects from engine-owned in badge + empty-state (ADR-0103 / #3220) (#2705)
  - fix(list): keep injected owner_id out of leading auto-derived list columns (#2702)
  - feat(flow-designer): #2670 Phase 3 — nested container node selection + schema-driven editing (#2699)
  - feat(approvals-inbox): retire hardcoded secondary buttons for server-declared actions (#2697)

  objectui range: `fd45313b4d00...94d4876df090`

- 447465a: Console (objectui) refreshed to `e164196801bd`. Frontend changes in this range:

  - fix(app-shell,plugin-detail): record History tab renders display values, not raw audit payloads (#2691)
  - fix(plugin-gantt): mirror the row 「→」 slot in the task-list header (#2690)
  - fix(plugin-detail): #2688 header Record-#id floor + raw audit user id in meta footer (#2689)
  - feat(plugin-gantt)!: remove the mobile QR share (移动端二维码) context-menu feature (#2687)
  - feat(plugin-gantt): dependencyTypes switch — hide the type switcher for id-only dependency stores (#2686)
  - feat(approvals): decision attachments + progress display + deep link + designer sync (#2681)
  - feat(studio): inline push-down expansion of loop/parallel/try_catch regions on the flow canvas (#2680)
  - feat(plugin-gantt): ownership-aware reschedule + confirm-first auto-schedule, export fixes, business time zone (#2683)
  - fix(app-shell): skip resultDialog fields whose path does not resolve (#2674)
  - feat(studio): visualize loop/parallel/try_catch nested regions on the flow canvas (#2670) (#2675)
  - feat(plugin-gantt): manual-scheduling summary bars, interaction switches, beforeTaskUpdate veto + tooltip/scrollbar/cursor fixes (#2677)
  - fix(flow-designer): author the canonical config.schedule the runtime reads (#2671)
  - feat(report): drill a date-bucket cell into its time range, not a superset (#1752) (#2672)
  - feat(studio): filter editor for roll-up summary fields (framework#1868) (#2669)
  - feat(flow-designer): first-class panel for the time-relative trigger (#1874) (#2668)
  - feat(studio): nest per-iteration / per-region step logs in the flow Runs panel (#2667)
  - fix(metadata-admin): dashboard label fallback + skill activation editors (#1878) (#2666)

  objectui range: `2e7d7f0f7ee7...e164196801bd`

- a140ff0: Console (objectui) refreshed to `fd45313b4d00`. Frontend changes in this range:

  - feat(app-shell): DeclaredActionsBar — render server-declared object actions on bespoke pages (#2678 P2-4) (#2692)
  - feat(data): unify master-detail saves behind DataSource.batchTransaction; isolate non-atomic fallback in the adapter (#2679) (#2684)

  objectui range: `e164196801bd...fd45313b4d00`

### Patch Changes

- a276969: Console (objectui) refreshed to `0318118e02fd`. Frontend changes in this range:

  - fix(app-shell): guard ActionParamDialog submit during file upload + map spec `autonumber` (ADR-0059 follow-ups) (#2707)

  objectui range: `94d4876df090...0318118e02fd`

- 47d923c: Console (objectui) refreshed to `2e7d7f0f7ee7`. Frontend changes in this range:

  - feat(evaluator): route CEL-dialect component/action predicates to the canonical engine (#2664)
  - fix(grid): explain the import wizard's disabled Next and silent downgrade (#2640, #2639) (#2646)
  - fix(form+detail): single-file children stay inline grids; drop non-spec `attachment` (#2654, #2655) (#2656)
  - feat(access): localize curated capability labels client-side (#2600 B5 follow-up) (#2657)
  - feat(access): localize capability picker group headers (#2600 B5, objectui side) (#2653)
  - fix(access): Studio permission matrix — stop clipping the Bulk column at narrow widths (#2600 B3) (#2652)
  - feat(access): Studio permission matrix — field-level bulk + filter for wide objects (#2600 B4) (#2651)
  - feat(access): Studio Explain panel — package-scoped object dropdown instead of free-text api-name (#2600 B2) (#2650)
  - feat(access): Studio permission matrix — collapse identity + zero-grant capabilities so the matrix hits the first screen (#2600 B1) (#2649)
  - feat(plugin-list): 列表工具栏增加手动刷新按钮 (#2634) (#2645)
  - fix(studio): approver Type dropdown drops deprecated `role`, membership-tier picker (#2643)
  - fix(components): route internal html-page links through the SPA navigation handler (#2642)
  - feat(discovery): trust only handlerReady/available services (ADR-0076 D12) (#2637)
  - feat(types)!: adopt @objectstack/spec 15.1.1; drop value-erased spec/ui `…Schema` re-exports (#2589)
  - feat(console): dev-seeded admin credentials hint on the login page (#2635)
  - fix(auth): 注册页去掉重复的「or」分隔线(与 #2629 登录页修复对齐) (#2633)
  - feat(app-shell/react): adapt to framework 15.1 — atomic publish rendering + honest discovery (#2630)
  - fix(chatbot): plan approval flips the card to a Building… badge immediately (#2632)
  - fix(app-shell,components): welcome CTA deep-links into the environment create dialog (#2631)
  - fix(auth): login-page config race + sign-in watchdog — never strand SSO-only users on a password wall (#2629)
  - feat(types): derive ListViewSchema from @objectstack/spec/ui (#2231) (#2622)

  objectui range: `077e45b4bc55...2e7d7f0f7ee7`

- a791200: Console (objectui) refreshed to `69fa5d163a97`. Frontend changes in this range:

  - fix(app-shell): mark notifications read via the REST surface, not direct receipt writes (#2743)

  objectui range: `af1b0db96e44...69fa5d163a97`

- db34d54: Console (objectui) refreshed to `9a5f016f7d5c`. Frontend changes in this range:

  - feat(flow-designer): nested-array columns in the node property form (#2678 P2-5) (#2761)
  - fix: redo record-list "Add View" flow — empty-name 405, invisible drafts, canonical naming (#2768)
  - feat(SchemaForm): field-type-aware operators + values for view filter (#2766)
  - fix(plugin-charts): draw dashboard chart bars on first paint via isAnimationActive=false (#2756) (#2759)
  - feat(data-objectstack): gate non-atomic batch fallback on discovery transactionalBatch capability (#2693) (#2755)

  objectui range: `69fa5d163a97...9a5f016f7d5c`

- 1965549: Console (objectui) refreshed to `af1b0db96e44`. Frontend changes in this range:

  - feat(i18n): localize action result dialogs via \_actions.<action>.resultDialog (#2736)
  - feat(data): thread the host's authenticated fetch into provider:'api' data sources (#2725) (#2732)
  - feat(managedBy): add explicit `engine-owned` lifecycle bucket (tracks framework ADR-0103 addendum, #3343) (#2739)
  - feat(fields): CheckboxesField visibleWhen cascading + dependsOn gating (completes option-widget parity) (#2735)
  - feat(fields): RadioField visibleWhen cascading + dependsOn gating; single-source the option resolver (#2728)
  - fix(kanban,calendar): surface write failures instead of silently swallowing them (#2716)
  - fix(plugin-charts): draw dashboard bars on first paint via one settle re-mount (#2727)
  - feat(dashboard): retire pre-ADR-0021 inline-analytics renderer branches (framework#3320) (#2723)
  - fix(data-objectstack): type the exportDownload test fetch mock so its type-check passes (#2726)
  - feat(detail): related lists paginate by default with server-side $top/$skip windows (#2711) (#2722)
  - fix(approvals-inbox): align participant gating with the server-computed viewer block (#2719)
  - fix(plugin-view): coerce i18n tab-label helpers to string (TS2322) (#2721)
  - feat(fields): MultiSelectField per-option visibleWhen cascading + dependsOn gating (#2715) (#2717)
  - fix(site): make docs build resilient to remote badge fetch failures (#2695) (#2718)
  - feat(approvals-inbox): retire the approve/reject composer for declared actions with file attachments (#2698) (#2710)
  - feat(fields): select+multiple → multi-value chip picker; restore fields/core lint gates (#2709)

  objectui range: `3b2e4d98d904...af1b0db96e44`

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: Console (objectui) refreshed to `3b2e4d98d904`. Frontend changes in this range:

  - fix(list): route remaining system-field groupings through shared classifier (#2706)
  - feat(console): user-import wizard defaults to the `auto` password policy (tracks framework#3236) (#2701)
  - feat(flow-designer): schema-driven keyValue + numberList mapping (#3304) (#2708)

  objectui range: `0318118e02fd...3b2e4d98d904`

### Patch Changes

- a276969: Console (objectui) refreshed to `0318118e02fd`. Frontend changes in this range:

  - fix(app-shell): guard ActionParamDialog submit during file upload + map spec `autonumber` (ADR-0059 follow-ups) (#2707)

  objectui range: `94d4876df090...0318118e02fd`

- a791200: Console (objectui) refreshed to `69fa5d163a97`. Frontend changes in this range:

  - fix(app-shell): mark notifications read via the REST surface, not direct receipt writes (#2743)

  objectui range: `af1b0db96e44...69fa5d163a97`

- 1965549: Console (objectui) refreshed to `af1b0db96e44`. Frontend changes in this range:

  - feat(i18n): localize action result dialogs via \_actions.<action>.resultDialog (#2736)
  - feat(data): thread the host's authenticated fetch into provider:'api' data sources (#2725) (#2732)
  - feat(managedBy): add explicit `engine-owned` lifecycle bucket (tracks framework ADR-0103 addendum, #3343) (#2739)
  - feat(fields): CheckboxesField visibleWhen cascading + dependsOn gating (completes option-widget parity) (#2735)
  - feat(fields): RadioField visibleWhen cascading + dependsOn gating; single-source the option resolver (#2728)
  - fix(kanban,calendar): surface write failures instead of silently swallowing them (#2716)
  - fix(plugin-charts): draw dashboard bars on first paint via one settle re-mount (#2727)
  - feat(dashboard): retire pre-ADR-0021 inline-analytics renderer branches (framework#3320) (#2723)
  - fix(data-objectstack): type the exportDownload test fetch mock so its type-check passes (#2726)
  - feat(detail): related lists paginate by default with server-side $top/$skip windows (#2711) (#2722)
  - fix(approvals-inbox): align participant gating with the server-computed viewer block (#2719)
  - fix(plugin-view): coerce i18n tab-label helpers to string (TS2322) (#2721)
  - feat(fields): MultiSelectField per-option visibleWhen cascading + dependsOn gating (#2715) (#2717)
  - fix(site): make docs build resilient to remote badge fetch failures (#2695) (#2718)
  - feat(approvals-inbox): retire the approve/reject composer for declared actions with file attachments (#2698) (#2710)
  - feat(fields): select+multiple → multi-value chip picker; restore fields/core lint gates (#2709)

  objectui range: `3b2e4d98d904...af1b0db96e44`

## 16.0.0-rc.0

### Major Changes

- 39b56d0: Console (objectui) refreshed to `94d4876df090`. Frontend changes in this range:

  - feat(dashboard): Studio authors the ADR-0021 dataset shape only (framework#3251) (#2703)
  - feat(app-shell): render ActionParamDialog params through the shared form field-widget renderer (#2700, ADR-0059) (#2704)
  - feat(app-shell): distinguish writable system objects from engine-owned in badge + empty-state (ADR-0103 / #3220) (#2705)
  - fix(list): keep injected owner_id out of leading auto-derived list columns (#2702)
  - feat(flow-designer): #2670 Phase 3 — nested container node selection + schema-driven editing (#2699)
  - feat(approvals-inbox): retire hardcoded secondary buttons for server-declared actions (#2697)

  objectui range: `fd45313b4d00...94d4876df090`

### Minor Changes

- 447465a: Console (objectui) refreshed to `e164196801bd`. Frontend changes in this range:

  - fix(app-shell,plugin-detail): record History tab renders display values, not raw audit payloads (#2691)
  - fix(plugin-gantt): mirror the row 「→」 slot in the task-list header (#2690)
  - fix(plugin-detail): #2688 header Record-#id floor + raw audit user id in meta footer (#2689)
  - feat(plugin-gantt)!: remove the mobile QR share (移动端二维码) context-menu feature (#2687)
  - feat(plugin-gantt): dependencyTypes switch — hide the type switcher for id-only dependency stores (#2686)
  - feat(approvals): decision attachments + progress display + deep link + designer sync (#2681)
  - feat(studio): inline push-down expansion of loop/parallel/try_catch regions on the flow canvas (#2680)
  - feat(plugin-gantt): ownership-aware reschedule + confirm-first auto-schedule, export fixes, business time zone (#2683)
  - fix(app-shell): skip resultDialog fields whose path does not resolve (#2674)
  - feat(studio): visualize loop/parallel/try_catch nested regions on the flow canvas (#2670) (#2675)
  - feat(plugin-gantt): manual-scheduling summary bars, interaction switches, beforeTaskUpdate veto + tooltip/scrollbar/cursor fixes (#2677)
  - fix(flow-designer): author the canonical config.schedule the runtime reads (#2671)
  - feat(report): drill a date-bucket cell into its time range, not a superset (#1752) (#2672)
  - feat(studio): filter editor for roll-up summary fields (framework#1868) (#2669)
  - feat(flow-designer): first-class panel for the time-relative trigger (#1874) (#2668)
  - feat(studio): nest per-iteration / per-region step logs in the flow Runs panel (#2667)
  - fix(metadata-admin): dashboard label fallback + skill activation editors (#1878) (#2666)

  objectui range: `2e7d7f0f7ee7...e164196801bd`

- a140ff0: Console (objectui) refreshed to `fd45313b4d00`. Frontend changes in this range:

  - feat(app-shell): DeclaredActionsBar — render server-declared object actions on bespoke pages (#2678 P2-4) (#2692)
  - feat(data): unify master-detail saves behind DataSource.batchTransaction; isolate non-atomic fallback in the adapter (#2679) (#2684)

  objectui range: `e164196801bd...fd45313b4d00`

### Patch Changes

- 47d923c: Console (objectui) refreshed to `2e7d7f0f7ee7`. Frontend changes in this range:

  - feat(evaluator): route CEL-dialect component/action predicates to the canonical engine (#2664)
  - fix(grid): explain the import wizard's disabled Next and silent downgrade (#2640, #2639) (#2646)
  - fix(form+detail): single-file children stay inline grids; drop non-spec `attachment` (#2654, #2655) (#2656)
  - feat(access): localize curated capability labels client-side (#2600 B5 follow-up) (#2657)
  - feat(access): localize capability picker group headers (#2600 B5, objectui side) (#2653)
  - fix(access): Studio permission matrix — stop clipping the Bulk column at narrow widths (#2600 B3) (#2652)
  - feat(access): Studio permission matrix — field-level bulk + filter for wide objects (#2600 B4) (#2651)
  - feat(access): Studio Explain panel — package-scoped object dropdown instead of free-text api-name (#2600 B2) (#2650)
  - feat(access): Studio permission matrix — collapse identity + zero-grant capabilities so the matrix hits the first screen (#2600 B1) (#2649)
  - feat(plugin-list): 列表工具栏增加手动刷新按钮 (#2634) (#2645)
  - fix(studio): approver Type dropdown drops deprecated `role`, membership-tier picker (#2643)
  - fix(components): route internal html-page links through the SPA navigation handler (#2642)
  - feat(discovery): trust only handlerReady/available services (ADR-0076 D12) (#2637)
  - feat(types)!: adopt @objectstack/spec 15.1.1; drop value-erased spec/ui `…Schema` re-exports (#2589)
  - feat(console): dev-seeded admin credentials hint on the login page (#2635)
  - fix(auth): 注册页去掉重复的「or」分隔线(与 #2629 登录页修复对齐) (#2633)
  - feat(app-shell/react): adapt to framework 15.1 — atomic publish rendering + honest discovery (#2630)
  - fix(chatbot): plan approval flips the card to a Building… badge immediately (#2632)
  - fix(app-shell,components): welcome CTA deep-links into the environment create dialog (#2631)
  - fix(auth): login-page config race + sign-in watchdog — never strand SSO-only users on a password wall (#2629)
  - feat(types): derive ListViewSchema from @objectstack/spec/ui (#2231) (#2622)

  objectui range: `077e45b4bc55...2e7d7f0f7ee7`

## 15.1.1

## 15.1.0

### Minor Changes

- d14a387: Console (objectui) refreshed to `1d95cd3659d8`. Frontend changes in this range:

  - feat(ai-build): cold-start handoff to Studio — primary CTA + artifact pillar deep links (ADR-0080 D5) (#2623)
  - fix(detail): render approval-lock band from host signal on request-tracked backends (#2618) (#2619)
  - feat(grid): built-in row Edit/Delete honor per-record CEL predicates (#2614) (#2617)
  - fix(form): thread live dependentValues to cascading option fields (#2284) (#2620)

  objectui range: `8918202dcfc2...1d95cd3659d8`

- f531a26: Console (objectui) refreshed to `b8967495be73`. Frontend changes in this range:

  - fix(app-shell): guard unsaved OWD overview rows in the Access rail and Studio header nav (#2600 follow-up) (#2610)
  - fix(actions): defuse the three action-visibility traps (#2358) (#2611)
  - fix(studio): confirm before header SPA nav discards unsaved pillar edits (#2600) (#2606)
  - feat(studio): CEL formula editor with inferred result type; structured summary roll-up editor (#1582) (#2609)

  objectui range: `23d65c396b8c...b8967495be73`

- f531a26: Console (objectui) refreshed to `fb35e4828fdb`. Frontend changes in this range:

  - fix(data-objectstack): emit MutationEvents from batchTransaction and bulk so master-detail saves refresh bound views (#2584)
  - feat(dashboard-filters): #2578 item-5 enhancements — nested variable merging, metadata-aware default bindings, server-side optionsFrom distinct (#2590)
  - feat(fields+form+detail): file/image upload cells in inline line-item grids (#2360) (#2585)
  - feat(app-shell): visual filterBindings editor in the dashboard widget inspector (#2578) (#2586)
  - fix(detail): highlight strip lookup editor honors ObjectStack `reference` key (#2407) (#2587)
  - fix(app-shell): guard Studio Access pillar against silently discarding unsaved matrix edits (#2588)
  - feat(dashboard-filters): #2578 follow-ups — catalog examples, guide tutorial, i18n entries, spec-alignment cleanup (#2581)
  - fix(detail+fields+app-shell): ADR-0085 #2548 follow-ups — strip title dedupe, group icon/description, currency channel, approvals Bearer (#2577)
  - feat(dashboard): dashboard-level filters driving multiple charts (framework#2501) (#2576)
  - feat(page-header): metadata-driven multi-button record header (#2361) (#2574)

  objectui range: `092bd859934f...fb35e4828fdb`

### Patch Changes

- 5ffff3b: Console (objectui) refreshed to `077e45b4bc55`. Frontend changes in this range:

  - fix(auth): OIDC provider sign-in via POST /sign-in/social (better-auth ≥ 1.7) (#2621)

  objectui range: `1d95cd3659d8...077e45b4bc55`

- f531a26: Console (objectui) refreshed to `092bd859934f`. Frontend changes in this range:

  - fix(app-shell): bind current_user.positions into the client predicate scope; align role-gating examples (#1583 / ADR-0058) (#2573)
  - feat(app-shell): CEL lint + field autocomplete for condition predicates (#1582) (#2567)
  - fix(detail): gate related lists on the current user's child-object read permission (#2359) (#2565)
  - feat(flow-designer): connector picker lists dispatchable connectors + marks declarative instances (#2563)
  - feat(app-shell): Studio CEL editor for list-view conditional formatting (#1584 / #1582) (#2558)
  - fix(fields): resolve lookup chip display name via referenced object schema, not the autonumber-prone key heuristic (#2357) (#2551)
  - feat(kanban): accept CEL { condition, style } conditional-formatting rules (#1584 follow-up) (#2550)
  - fix(plugin-grid): sniff CSV encoding in import wizard (GB18030 fallback) (#2557)
  - feat(detail): editable record highlights on the shared inline-edit draft (#2549)
  - fix(spec-bridge/form): #2545 stop dropping spec FormViewSchema keys; normalize legacy groups → sections (#2552)
  - feat(flow-designer): localize palette headings + cloud-sync recents + guide (#2553)
  - fix(studio): refresh builder top-bar name after a package rename (#2554)
  - feat(core): B3 cascading-option guardrail, role-gated demo, ADR + browser e2e (#1583) (#2547)
  - feat(list): unify conditional formatting + row-action visibility onto the CEL engine (#1584) (#2544)
  - feat(detail): record-level inline edit — shared InlineEditContext + one atomic Save (#2542)
  - feat(flow-designer): search box + keyboard nav + recents in the add-node palette (#2543)
  - feat(kanban): default card fields to object highlightFields (ADR-0085, #2162) (#2541)
  - fix(types/plugin-grid): #1763 declare spec-canonical bulkActions on ObjectGridSchema (#2539)
  - fix(attachments): download attachments via authenticated signed URL (framework #2970)
  - feat(studio): spec-driven package create/edit/view form in a modal (#2535)
  - fix(permissions/fields): #2926 ④⑧ — FLS fail-open + lookup display_field (#2537)
  - feat(app-shell): CEL authoring safety for RLS policies — lint, field autocomplete, test-run (#2533)
  - fix(auth): gate DeviceAuthPage on features.deviceAuthorization (framework#2874 / #2513) (#2536)
  - fix(app-shell): close view config panel on discard in edit mode (#2320)
  - feat(metadata-admin): create form-family views through the View create UI (#2531)
  - fix(app-shell): render action's objectName as an object selector (#2325)
  - fix(components): exit inline edit mode for injected cell editors (#2534)
  - fix(attachments): authenticated uploads + friendly denial copy in RecordAttachmentsPanel (#2755) (#2532)
  - feat(components): page:tabs honors item-level visibleWhen — conditional tabs (framework#2606) (#2516)
  - feat(metadata-admin): page variable source is a component picker (#2328) (#2523)
  - fix(studio-design): make object canvas overridable via studio-canvas-preview registry (#2337) (#2527)
  - fix(metadata-admin): seed flow createDefaults with required `type` (#2525)
  - fix(metadata-admin): give hook create form a createSchema so object renders as a ref:object picker (#2521)
  - feat(studio): enforce package namespace prefix at authoring time (framework#2694) (#2524)
  - fix(app-shell): render View create-form Object field as ref:object picker (#2526)
  - feat(components): add `variant === 'primary'` tie-break to action:bar ordering (#2339) (#2519)
  - fix(build): stop TS6059 rootDir errors in dts build across 21 packages (#2520)
  - fix(app-nav): exclude record-detail pages from the 'page' nav picker (#2333) (#2517)
  - fix(plugin-report): stop TS6059 rootDir errors in dts build (#2334) (#2518)
  - feat(flow-designer): add 'position' xRef picker kind for approval approvers / escalateTo (#2778) (#2515)

  objectui range: `cc2156841787...092bd859934f`

- f531a26: Console (objectui) refreshed to `23d65c396b8c`. Frontend changes in this range:

  - fix(i18n): drop try/catch-around-hook in createSafeTranslation / useSafeTranslate (#2605)
  - fix(app-shell): Studio Access matrix — history opens in-place sheet, breadcrumb stops escaping the pillar (#2599)
  - fix(data-objectstack): emit mutation events from batchTransaction/bulk so related lists refresh after master-detail saves (#2607)
  - fix(metadata-admin): follow the live app locale, not just navigator.language (#2602)
  - feat(detail+fields+components+app-shell): record inline-edit polish (#2572) (#2604)
  - fix(app-shell+kanban+list): row-predicate CEL authoring advertises runtime-bound roots; kanban binds host scope (#2571 follow-up) (#2603)
  - fix(plugin-list): spec bare-string sort form crashed ListView (#2578 shape-mismatch audit) (#2601)
  - fix(app-shell): lock the Access pillar permission matrix in read-only packages (#2570)
  - fix(fields): localize relative-date humanize via Intl.RelativeTimeFormat (framework#3040) (#2593)
  - fix(components): pin sticky leading cells at measured header widths (#2592)
  - fix(app-shell,core): keep error-envelope objects out of toast.error — React #31 page crash (#2579) (#2580)
  - feat(flow-designer): pick the target node per branch in the Decision Branches editor (#1942) (#2568)
  - fix(core+data-objectstack+app-shell): canonicalize reference/reference_to at the schema chokepoints (#2407) (#2598)
  - fix(dashboard-filters): spec-form filter options crashed the dashboard; add guide screenshots (#2578) (#2597)
  - fix(fields): PeoplePicker cursor resets only on real result changes (de-flakes keyboard test) (#2594)
  - fix(studio): stop force-opening the new-object dialog on empty packages (#2569)
  - feat(studio): CEL editor with validate + autocomplete for field conditional rules (#1582) (#2571)
  - feat(kanban): default lane field honours the ADR-0085 stageField role (#2596)
  - fix(fields+detail): resolve pre-existing rules-of-hooks violations in cell renderers (#2595)

  objectui range: `fb35e4828fdb...23d65c396b8c`

## 15.0.0

### Patch Changes

- 56e42a6: Console (objectui) refreshed to `cc2156841787`. Frontend changes in this range:

  - fix(studio): restore copilot composer + collapsible properties inspector (#2504)
  - fix(plugin-grid): default ImportWizard 'run automations & triggers' to ON (framework#2922) (#2503)
  - feat(app-shell): C2-β — AccessExplainPanel record 粒度渲染 (framework#2920) (#2502)
  - feat(app-shell): A4 — 权限来源三态徽标 (framework#2920) (#2501)
  - feat(app-shell): proactive AI usage indicator in the ChatDock (ADR-0057 #8) (#2498)
  - fix(app-shell): hydration lifts ask-decline builder handoff + changes-proposed cards (#2497)
  - fix(plugin-chatbot): ask-decline shows a live pending indicator + earlier handoff card (#2458) (#2496)

  objectui range: `60610531013f...cc2156841787`

## 14.8.0

### Patch Changes

- d1b1a94: Console (objectui) refreshed to `60610531013f`. Frontend changes in this range:

  - fix @object-ui/console
  - fix(plugin-chatbot): build-result summary truncates on mobile instead of overflowing (#2493) (#2495)
  - feat(grid,list,core,i18n): 导出文件名本地化 + 导入模板中文化修复 (#2491)
  - fix(app-shell): package-owned permission set delete reads as reset, not delete (ADR-0094) (#2494)
  - fix(console-ai): Live Canvas is full-screen opt-in preview on mobile, not a broken split (#2481) (#2492)
  - feat(react,types): read canonical visibleWhen in renderers (ADR-0089) (#2490)
  - fix(i18n): localize profile page, inline label objects, managed-by badges and record quick actions (#2489)
  - fix(plugin-gantt): #2482 删除冗余行定位图标;「→」详情按钮改独立操作槽(不压结束列、24px 热区) (#2487)
  - fix(console-ai): clear plaintext chat cache on logout / user switch (#2485)
  - fix(plugin-grid): pin the row-actions column right so it survives horizontal scroll (#2486)
  - feat(console-ai): mobile chat sheet bridges to full-page /ai — cleanly (ADR-0057 UX #2477) (#2483)
  - fix(plugin-grid): stop row-action buttons clipping in the list actions column (#2484)
  - fix(plugin-gantt): #2473 抽屉拉真实记录+真实 schema、写回失败 toast、锁定连线菜单禁用 (#2479)
  - fix(plugin-list): show active search keyword on the toolbar search button (#2472)
  - fix(console-ai): Studio dock remembers a collapse; folded layout side-by-side at xl (ADR-0057 UX, #2477) (#2478)
  - feat(console-ai): edit-mode empty state distinct from magic-flow build (ADR-0057 A1.b) (#2476)
  - fix(console-ai): A1.b switcher hides platform built-in apps (setup/account) (#2474)
  - feat(console-ai): ChatDock follow-ups — mobile sheet, wide side-by-side, exact collapse landing (ADR-0057 P3) (#2470)

  objectui range: `95835581f1d0...60610531013f`

## 14.7.0

### Minor Changes

- f71339c: Console (objectui) refreshed to `6a741605b1e0`. Frontend changes in this range:

  - feat(fields): pickers for the sharing rule form (object / criteria / recipient) (#2421)

  objectui range: `e7bebe929349...6a741605b1e0`

- 35f6c61: Console (objectui) refreshed to `a44e7b6b28c6`. Frontend changes in this range:

  - fix(form): honor field widget hint on the section-layout path
  - feat(plugin-gantt): 写后回读服务端重算字段 + 工具栏手动刷新按钮 (#2436 第 6/7 项) (#2442)
  - fix(plugin-detail,plugin-gantt): 记录抽屉尊重行级锁定——能力由 handler 是否传入决定 (#2436 第 5 项) (#2441)
  - feat(console-ai): ask→build handoff carries conversation context + live verification (ADR-0057 P4) (#2444)
  - feat(console-ai): explicit "Open in Builder →" ask→build handoff (ADR-0057 P4) (#2439)
  - feat(plugin-gantt): 逐任务预警描边 borderColorField(超期红/临期橙) (#2440)
  - fix(plugin-gantt): 快速筛选树感知——命中任务保留全部祖先链 (#2438)
  - feat(plugin-gantt): 连线校验——锁定行/分组行落点拒绝、全量成环检测、onBeforeDependencyCreate 否决钩子 (#2437)
  - feat(plugin-gantt): api 数据源支持读取 + 全部回写（改期/依赖/删除/内联编辑） (#2423)
  - fix(console-ai): preserve ?package= across the /ai URL mirror (ADR-0057 P1 hardening) (#2422)

  objectui range: `6a741605b1e0...a44e7b6b28c6`

- 956208e: chore(console): refresh vendored `@object-ui/console` SPA to objectui@95835581

  Bumps the pinned `.objectui-sha` from `2f3ab55a` to `95835581` (11 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(console-ai): ChatDock — right-docked AI rail, now DEFAULT ON with the flag as a kill-switch (ADR-0057 P3 go-live), FAB launcher, `/ai` maximized dock + Studio right-dock reflow, bind-on-create conversations
  - feat(plugin-gantt): #2460 interactive batches — row single-click locate / double-click detail, day-snap drag, layout with tray + filters, mobile QR code, lock hints
  - feat(plugin-gantt): summaryExtent 'self' + tooltip fallback formatting when no schema
  - fix(plugin-gantt): delete-dialog i18n, dependency candidate search box, exclude group/locked from summary
  - fix(auth): login silent-failure UX — SSO pending states, redirect-URL contract, OAuth callback error banner

### Patch Changes

- 9f03fdd: Console (objectui) refreshed to `2f3ab55adcbd`. Frontend changes in this range:

  - Create plenty-cities-worry.md

  objectui range: `a44e7b6b28c6...2f3ab55adcbd`

## 14.6.0

### Minor Changes

- 1d4c359: Console (objectui) refreshed to `94d00d41b1bd`. Frontend changes in this range:

  - feat(auth): phone number + password sign-in on the login page (#2418)

  objectui range: `2fb38edbeb12...94d00d41b1bd`

- 1d4c359: Console (objectui) refreshed to `e7bebe929349`. Frontend changes in this range:

  - fix(plugin-gantt): 拖边缘调时长——整高边缘带命中判定，修复 headless 命中不稳 (#2420)
  - feat(console-ai): unify AI chat — one conversation key + one surface→agent resolver (ADR-0057 P1+P2) (#2414)

  objectui range: `94d00d41b1bd...e7bebe929349`

### Patch Changes

- b42ae3d: Console (objectui) refreshed to `2fb38edbeb12`. Frontend changes in this range:

  - fix(app-shell): propagate action-param `visible` predicate through resolveActionParams (#2419)

  Completes the create-user phone fix: `resolveActionParams` now carries the
  `visible` CEL predicate through to `ActionParamDialog`, so the `phoneNumber`
  field is hidden when the `phoneNumber` auth plugin is off
  (`features.phoneNumber == false`) instead of rendering a field the backend
  rejects.

  objectui range: `9138e68413f3...2fb38edbeb12`

## 14.5.0

### Minor Changes

- 0719fc7: Console (objectui) refreshed to `839536b1f4c0`. Frontend changes in this range:

  - feat(plugin-detail,app-shell): Edit as primary CTA; enter inline edit by double-clicking a field (#2401) (#2402)
  - feat(app-shell,plugin-detail): permission sets — Studio designs, Setup assigns (ADR-0056) (#2403)

  objectui range: `787b0e7bd90f...839536b1f4c0`

### Patch Changes

- 6da03ee: Console (objectui) refreshed to `5da9905b30fc`. Frontend changes in this range:

  - fix(plugin-form): honor userActions.edit on managed objects, don't blanket-disable fields (ADR-0092 D4) (#2395)

  objectui range: `6fa8e6aeb67c...5da9905b30fc`

- 0719fc7: Console (objectui) refreshed to `787b0e7bd90f`. Frontend changes in this range:

  - fix(app-shell,components): Setup-app UX — accurate teams empty state + stop form prop leak (#2397)
  - fix(app-shell): unwrap the {success,data} envelope in apiHandler so resultDialog fields resolve (#2396)

  objectui range: `5da9905b30fc...787b0e7bd90f`

## 14.4.0

## 14.3.0

## 14.2.0

## 14.1.0

## 14.0.0

## 13.0.0

## 12.6.0

## 12.5.0

### Minor Changes

- 12e11b6: remove studio app

## 12.4.0

### Minor Changes

- f66e8af: chore(console): refresh vendored `@object-ui/console` SPA to objectui@6cbccf38

  Bumps the pinned `.objectui-sha` from `ffad2a13` to `6cbccf38` (2 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(app-shell,plugin-list): persist list filters per-user across navigation
  - fix(components,fields): localize form validation, toast client-side failures, fix dark-mode date icon

## 12.3.0

## 12.2.0

## 12.1.0

## 12.0.0

## 11.10.0

### Minor Changes

- 3500820: chore(console): refresh vendored `@object-ui/console` SPA to objectui@09e1b261

  Bumps the pinned `.objectui-sha` from `2cfa36e9` to `09e1b261` (5 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(studio): Access pillar — fourth content pillar (permission matrix)
  - feat(studio): 复制 (duplicate base) on writable packages in the builder landing
  - feat(fields): default relation pickers to inline "create related record"
  - fix(plugin-form): hydrate widget types on hand-authored subform columns
  - fix(fields): show line-item row actions always, not on hover

## 11.9.0

### Minor Changes

- 1a29234: chore(console): refresh vendored `@object-ui/console` SPA to objectui@9aec6817

  Bumps the pinned `.objectui-sha` from `144ab55b` to `9aec6817` (13 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(studio): Data pillar Validations + Settings views (builder-ui Phase B)
  - feat(studio): package switcher + inline new-writable-package in the top bar
  - feat(home,studio): builder cover on Home + builder→app bridge; builder landing joins the login journey
  - fix(app-shell): stop double-toasting failed script/modal action errors; don't show recovery-password reminder on SSO-enforced envs or first landing
  - fix(plugin-grid): keep row selection in sync when bulk-action dialog closes; i18n the bulk-action dialog; readable import preview
  - fix(form): de-emphasize field labels so fieldGroups hierarchy reads

## 11.8.0

### Minor Changes

- 5c15ccd: Bump the vendored console to objectui@144ab55b2: the ADR-0085 consumer switch (single-source fieldGroups derivation from spec 11.7.0, `stageField: false` stepper suppression, `highlightFields` reads with `compactLayout` fallback, dead `views.*`/`detail.*` reads removed) plus Studio Data rail search.

## 11.7.0

## 11.6.0

### Minor Changes

- e778a93: chore(console): refresh vendored `@object-ui/console` SPA to objectui@d006128c

  Bumps the pinned `.objectui-sha` from `46a12ef9` to `d006128c` (6 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(detail): wire object fieldGroups into detail sections; read hints from spec-writable `detail.*` block
  - fix(form): render object fieldGroups in create/edit modal; auto-layout parity for grouped ObjectForm
  - fix(grid): refresh list after a bulk/row action succeeds
  - fix(grid): inline-edit toggle takes effect immediately + staged editor closes on save
  - fix(components): keep dialog/drawer open when a click closes an open dropdown

### Patch Changes

- b990bc2: 修复 console 产物打包旧版 @objectstack/client 的问题:`build-console.sh` 现在通过 `OBJECTSTACK_CLIENT_DIST` 把本仓库、本版本的 client 注入 console bundle(此前由 objectui lockfile 决定,11.5.0 因此发布了新导入 UI + client 11.2.0,运行时报 "does not support async import jobs")。构建拆为 deps(turbo)+ console 本体(直跑,避开 turbo strict env 剥离环境变量),并新增产物 canary 断言防止旧 client 再次静默发布。

## 11.5.0

### Minor Changes

- cabce27: chore(console): refresh vendored `@object-ui/console` SPA to objectui@1432efe8

  Bumps the pinned `.objectui-sha` from `2b86379` to `1432efe8` (8 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat(studio): WYSIWYG form-layout designer in the Data pillar
  - fix(fields): inline lookup editor shows the selected record's name; align inline lookup value resolution with the read cell
  - fix(grid): BulkActionBar is now the single, i18n'd selection indicator; keep the bulk action bar inside the overflow-hidden container
  - fix(studio): drop unused index param in ObjectFormDesigner container map

## 11.4.0

## 11.3.0

## 11.2.0

## 11.1.0

## 11.0.0

## 10.3.0

## 10.2.0

## 10.1.0

## 10.0.0

## 9.11.0

## 9.10.0

## 9.9.1

### Patch Changes

- 4f5c9c3: fix form

## 9.9.0

### Minor Changes

- b112416: chore(console): refresh vendored `@object-ui/console` SPA to objectui@e6fd254

  Bumps the pinned `.objectui-sha` from `6d4cc09` to `e6fd254` (14 commits) and rebuilds the prebuilt Console SPA shipped in `@objectstack/console`.

  Notable upstream changes pulled in:

  - feat: book metadata display UI + book-driven documentation portal (ADR-0046 §6)
  - feat: render object fieldGroups as full-width, collapsible form sections
  - feat: full object forms (incl. master-detail) inside screen-flow wizard steps
  - feat: action progress state + Undo affordance, action/flow completion messaging
  - feat: CEL on action buttons + i18n for sort/filter builders and view/manage-views menus
  - fix: public share link URL + ShareDialog audiences; grouped-view pagination + shared scrollbar
  - fix: docs ToC scrolls in JS so `<base href>` no longer bounces to home

## 9.8.0

## 9.7.0

## 9.6.0

## 9.5.1

## 9.5.0

## 9.4.0

## 9.3.0

## 9.2.0

## 9.1.0

## 9.0.1

## 9.0.0

## 8.0.1

## 8.0.0

## 7.9.0

## 7.8.0

## 7.7.0

## 7.6.0

## 7.5.0

## 7.4.1

### Patch Changes

- d7f86db: fix

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

### Minor Changes

- d662c01: fix

## 7.1.0

## 7.0.0

### Patch Changes

- 9496b5b: Vendor `@object-ui/console` as `@objectstack/console`, a new dist-only
  package shipped at the framework version. A single `pnpm add
@objectstack/framework` now installs a version-matched Console SPA — no
  second npm dep to keep in sync.

  The Console source-of-truth remains [`@object-ui/console`](https://github.com/objectstack-ai/objectui).
  The framework pins it by SHA in `.objectui-sha`; CI's release workflow
  clones objectui at that SHA, builds the SPA, and publishes the dist as
  `@objectstack/console`.

  The CLI's `resolveConsolePath()` now prefers `@objectstack/console` and
  falls back to `@object-ui/console`, so cloud's Docker overlay flow and
  advanced users who pin `@object-ui/console` directly still take
  precedence. `@object-ui/console` has been demoted from CLI runtime
  dependency to dev fallback.
