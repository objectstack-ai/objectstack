---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the dashboard metadata-form bundles follow the `refreshIntervalSeconds` rename (#14478)

The `metadataForms.dashboard` translation bundles key the auto-refresh field as
`refreshIntervalSeconds`, following the `@objectstack/spec` rename of the
authored key. Regenerated with `node scripts/check-i18n-bundles.mjs --write`; the
hand-written `zh-CN` / `ja-JP` / `es-ES` label and help text were carried across
the rename unchanged, because the field still means what it meant and each help
text already named the unit.
