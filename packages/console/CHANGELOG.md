# @objectstack/console

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
