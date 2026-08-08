---
"@objectstack/console": patch
---

Console (objectui) refreshed to `b1204af0a1f7`. Frontend changes in this range:

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
