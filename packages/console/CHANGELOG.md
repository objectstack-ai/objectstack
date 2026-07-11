# @objectstack/console

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
