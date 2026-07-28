---
"@objectstack/cli": minor
"@objectstack/spec": patch
---

feat(cli,spec): gate the whole declared surface for i18n, and translate inline object actions server-side (#3370)

In a zh-CN workspace the platform chrome was localized while author-declared
labels leaked English — the approval drawer rendered **Approve / Reject /
Reassign** right beside the inbox's own 通过 / 拒绝. Two independent holes, both
closed here.

**The lint gate could not see them.** `os lint`'s i18n coverage kept its own
walk of the metadata, separate from the one `os i18n extract` uses to scaffold
bundles, and the two had drifted: coverage only ever walked the *top-level*
`actions` array, while `sys_approval_request` declares its decision actions
**inline on the object**. Those labels were extractable but ungated, so an
untranslated one could ship and no lint run would notice. Coverage now derives
its expected keys from `collectExpectedEntries()` — the extractor's walker — so
the gated surface and the scaffolded surface cannot disagree again. Newly gated
as a result: inline object actions, action `params` and `resultDialog` copy,
object-nested `listViews` (label / description / `emptyState`), object
`description`, field `help` / `placeholder`, and the `apps` / `dashboards` /
`pages` surfaces. Extract output is byte-identical — verified against the
committed plugin bundles.

**It stays silent for projects that do not translate.** Which locales get
checked is the project's declaration, never an assumption: `os lint`,
`os i18n check` and `os i18n extract` now read the stack's own
`i18n.defaultLocale` / `i18n.supportedLocales`, falling back to the locales a
bundle already exists for, and finally to `en`. A project with neither is
checked against its default locale alone — which its inline labels already
satisfy — so it reports zero i18n issues. That also fixes a monolingual
*non-English* project being told it owed `en` translations it never claimed to
speak. Locked by regression tests; the three bundled examples stay at 0 errors.

**The server sent English regardless of locale.** `translateObject` walked an
object's `label` / `pluralLabel` / `description` / `fields` but never its inline
`actions`, so `GET /api/v1/meta/object/:name` returned the authored English
literals even though `@objectstack/plugin-approvals` ships `_actions`
translations for all eight decision actions in zh-CN / ja-JP / es-ES. The
Console compensated by re-resolving labels client-side against a separately
fetched bundle; every other consumer — mobile, plain HTTP, SDUI — rendered the
source language. It now runs inline actions through `translateAction`, without
stamping a synthetic `objectName` onto the response.

Adds `os i18n extract --no-metadata-forms`. Whether the companion
`<locale>.metadata-forms.generated.ts` file is written was previously implicit:
every run emitted it, so `--check` demanded that file in packages that
deliberately do not commit one. The Studio metadata-form baseline is
registry-driven and identical for every stack, so exactly one package owns it
(`platform-objects`); a plugin translating only its own objects now opts out,
and its `--check` stops failing on a tree that is in sync. Defaults to emitting,
so `pnpm check:i18n` keeps covering all 8 platform bundles.
