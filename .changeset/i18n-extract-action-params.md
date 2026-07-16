---
'@objectstack/cli': minor
'@objectstack/platform-objects': patch
---

feat(cli): `os i18n extract` now emits action param keys (`o.<object>._actions.<action>.params.<param>.*`) so action-dialog forms are translatable (#3030)

The console client already resolves param labels, help text, placeholders and
option labels from `o.<object>._actions.<action>.params.*`, but the extractor
never walked `actions[].params`, so those keys were absent from generated
bundles and dialogs like Setup → Create User rendered raw English under any
locale. The extractor now emits:

- inline params → `label` / `helpText` / `placeholder` / `options.<value>`;
- field-backed params (`{ field: '…' }`) → only when they carry a literal
  override (field translations already cover them at runtime);
- both object actions and top-level (global) actions.

`@objectstack/platform-objects` regenerates its en/zh-CN/ja-JP/es-ES bundles
with the new keys filled (user admin actions, sys_jwks fields, page variable
forms). Re-running extract with `--merge` stays idempotent.
