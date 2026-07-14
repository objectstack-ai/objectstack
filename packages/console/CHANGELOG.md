# @objectstack/console

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
