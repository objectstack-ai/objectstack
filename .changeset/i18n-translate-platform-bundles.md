---
"@objectstack/plugin-security": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/service-storage": patch
"@objectstack/cli": patch
---

fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

Only `platform-objects` was wired into a translation-drift check. The other
**eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
ran — and four of them had already drifted out of sync with the schema, exactly
the rot `pnpm check:i18n` exists to catch, one directory over.

**Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
(15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
translations. Most were newly *visible* rather than newly missing: #3753 taught
the coverage detector to walk action `params`, `resultDialog`, `listViews` and
the rest of the declared surface, and these are what it found.

Wording was harvested from the repo's own bundles wherever a string was already
translated somewhere (1382 unambiguous source strings), so `Created At` reads
`创建时间` here because that is what it reads everywhere else, rather than a
fresh invention. Protocol tokens are deliberately left identical across locales:
`GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

**Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
`pnpm check:i18n` and checks all nine. It does not restate each package's
command — it parses the one already documented in that config's own docstring
and runs it, so the documented regenerate command and the gate cannot diverge.
The coverage ratchet grows the same way, from `examples/*` to twelve configs;
eight of them sit at zero, which makes it the strict gate there.

**Fixed a real truncation bug it exposed.** `os lint --json` on a large config
came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
by `process.exit(1)` tears the process down before an async pipe write drains,
while an interactive run (stdout is a TTY, written synchronously) looks perfect.
Every scripted consumer silently got invalid JSON. `emitJson` in
`packages/cli/src/utils/format.ts` waits for the write to drain and sets
`process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
Roughly 30 other CLI commands share the pattern and are not touched here.

The nine documented regenerate commands also gain `--no-metadata-forms` (added
in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
alone, not to a copy in every plugin.

Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
`dashboards.*` navigation and widget labels, which live outside the `objects`
subtree and cannot be scaffolded while the package extracts with
`--objects-only`. That needs an emit decision first — tracked in #3762.
