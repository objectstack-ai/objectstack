# @objectstack/console

## 5.2.0

## 5.1.0

## 5.0.0

### Major Changes

- bb32755: Publish `@objectstack/account` and `@objectstack/console` to npm (major release).

  Previously both apps were marked `private: true`, which prevented `changeset publish`
  from releasing them. The CLI (`@objectstack/cli`) resolves these packages from
  `node_modules/@objectstack/{account,console,studio}` to serve their built `dist`
  assets, so third-party projects could not consume them via `pnpm add`.

  - Removed `private: true` from `apps/account` and `apps/console`.
  - Added `publishConfig.access: public` to `account`, `console`, and `studio` for
    scoped-package publish safety.

## 4.2.0

### Minor Changes

- f197c7e: upgrade objectui

## 4.1.1
