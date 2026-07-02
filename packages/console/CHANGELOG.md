# @objectstack/console

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
