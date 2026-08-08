---
"@objectstack/console": minor
---

Console (objectui) refreshed to `0cf8f0f70d10`. Frontend changes in this range:

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
- _(no changeset)_ feat(scripts): check-doc-links 扫描面第四扩 packages/*/README.md,并付清入场价的 11 条死链 (#3622) (#3649) (objectui `0d5da5394`)
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

