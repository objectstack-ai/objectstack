# @objectstack/studio

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- 1a4f079: feat(ADR-0046): seed first-party package docs for the Setup and Studio apps

  A fresh platform install shipped **no** first-party `doc` metadata, so the
  in-product documentation hub (`/_console/docs`) opened completely empty and the
  ADR-0046 feature had zero reference implementation. This seeds a deliberately
  minimal first version — one short overview per built-in app — so the hub is
  non-empty out of the box and there is a worked example to copy.

  - `@objectstack/setup` registers `setup_overview` (for administrators: users &
    authentication, the roles & permissions model, and record visibility/sharing).
  - `@objectstack/studio` registers `studio_overview` (for builders: the
    metadata-first model, the invisible draft/overlay precedence rule per
    ADR-0005/ADR-0033, and publish vs deploy).

  Both follow the HotCRM principle — document the _invisible_ business logic, not
  what the UI already shows — and link to <https://docs.objectstack.ai> for depth.

  Mechanism note: these are TS-first code packages built by `tsup`, not user apps
  built by `os build`, so they do **not** go through the flat `src/docs/*.md`
  collection + lint. The docs are declared inline as `Doc` items on each package's
  `manifest.register({ docs })` call — the path `DocSchema` explicitly blesses for
  TS-first stacks. They register under their owning package id, so the docs hub
  groups them under Setup and Studio respectively. No framework change was needed.

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0

## 9.4.0

### Minor Changes

- 593d43b: feat(apps): extract Studio into its own `@objectstack/studio` app package (ADR-0048)

  ADR-0048 "one app per package": Studio gets a distinct package id
  (`com.objectstack.studio`) and namespace (`studio`) so `/apps/<packageId>`
  resolves unambiguously instead of being lost inside a multi-app package.

  This change adds the package skeleton (`packages/apps/studio`) with a thin
  registration plugin. Transitional: `STUDIO_APP` is still imported from
  `@objectstack/platform-objects/apps`, and the package is not yet wired into the
  dev/serve plugin set — that boot-path switch (and dropping the app from
  `plugin-auth`'s manifest) lands in a follow-up so it can be verified against a
  live `os dev` boot.

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/platform-objects@9.4.0
