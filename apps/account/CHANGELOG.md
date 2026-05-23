# @objectstack/account

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/client-react@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/client-react@5.1.0

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

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/client-react@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/client-react@4.2.0

## 4.1.1

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/client-react@4.1.1
  - @objectstack/spec@4.1.1

## 4.0.6

### Patch Changes

- f41466a: Trim the first-run `/setup` page. Removed the optional teammate-invite section, the manually-edited org slug field, the large shield banner and the footer note. The form is now 4 fields (name + org name on one row, then email + password) with concise copy — the new owner can invite teammates from the dashboard after first login.
- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/client-react@4.1.0

## 0.1.1

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/client-react@4.0.5
