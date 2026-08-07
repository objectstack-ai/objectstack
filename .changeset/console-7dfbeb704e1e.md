---
"@objectstack/console": patch
---

Console (objectui) refreshed to `7dfbeb704e1e`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 9 releasing of 9 changesets added across 28 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

- **patch** — The bulk selection bar now applies the ADR-0066 D4 `requiredPermissions` capability gate, and short-circuits a boolean `visible` instead of treating it as a broken expression (#34… (objectui `d915c47b3`)
- **patch** — Relation fields (`lookup` / `master_detail` / `user` / `tree`) are now usable in action and conditional-formatting predicates: they bind as the stored foreign key on every surface… (objectui `d915c47b3`)
- **patch** — Conditional-rule predicates that fail to evaluate are no longer silent (objectstack#5149, appeal 2). `evalFieldPredicate` — the canonical funnel for `visibleWhen` / `readonlyWhen`… (objectui `a4cff5bd1`)
- **patch** — `useAppContextSelectors` now derives each context selector's URL scope key from its own `id` instead of hardcoding the literal `package` query key. `App.contextSelectors` is an ar… (objectui `f59406d4e`)
- **patch** — `toPredicateInput` is now re-exported from `@object-ui/core` instead of being reimplemented in `@object-ui/react`. Behaviour is byte-for-byte identical — the renderer-side copy in… (objectui `175bd79d8`)
- **patch** — The group-tenancy write-target badge is now translated in all ten locales (objectui#3517) (objectui `7e2406abf`)
- **patch** — Give `CommentThread`'s `+` reaction picker a real accessible name (objectui#3478) (objectui `d0d71df0e`)
- **patch** — `RecordFormPage` no longer passes an inline `defaultValue` to the seven `t()` lookups whose keys are defined in all ten locale packs (`form.createTitle`, `form.editTitle`, `form.c… (objectui `c0c771c2f`)
- **patch** — `createSafeTranslation`'s no-provider fallback interpolation now replaces **all** occurrences of each placeholder, matching i18next semantics on the provider path. (objectui `a6ec93d24`)

objectui range: `f995a452d2ca...7dfbeb704e1e`
