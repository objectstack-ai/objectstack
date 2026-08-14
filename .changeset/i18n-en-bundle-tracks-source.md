---
'@objectstack/cli': minor
'@objectstack/spec': minor
'@objectstack/plugin-approvals': patch
'@objectstack/platform-objects': patch
'@objectstack/plugin-audit': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-messaging': patch
---

The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

- `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
- Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
- New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.
