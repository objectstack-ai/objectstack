---
"@objectstack/types": patch
"@objectstack/runtime": patch
"@objectstack/cli": patch
---

fix(runtime,cli,types): `os migrate` and the dev runtime now share one `__search` companion schema view (#3955)

On a zh-locale deployment the dev runtime provisions the hidden `__search`
pinyin companion column (ADR-0098) on every eligible object, but the
`os migrate plan`/`apply` boot went through `createStandaloneStack`, which
never derived the locale-gated pinyin decision from the compiled artifact.
Its metadata therefore lacked every companion column, and `migrate plan`
reported each live `__search` column of a dev-created database as a
destructive orphan — with `--allow-destructive` as the printed remediation,
which would have dropped live feature columns.

- `@objectstack/types`: new `collectConfiguredLocales(i18n)` and
  `stampSearchPinyinEnabled(i18n)` — the single resolve-and-stamp helper for
  `OS_SEARCH_PINYIN_ENABLED`. An explicit env value still wins; only a
  positive locale-derived decision is stamped.
- `@objectstack/runtime`: `createStandaloneStack` stamps the decision from
  the artifact's `i18n` before any plugin constructs a `SchemaRegistry`, and
  surfaces `i18n` on its result like `requires`/`objects`/`manifest`.
- `@objectstack/cli`: the `serve`/`dev` boot now stamps through the same
  shared helper (behaviour unchanged), so create/serve and plan/apply cannot
  compute different schema views of the same source tree.

A fresh CLI-created database is now also born with the same `__search`
columns the dev runtime would provision, instead of acquiring them on the
next dev boot.
