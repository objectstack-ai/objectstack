# @objectstack/console

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
