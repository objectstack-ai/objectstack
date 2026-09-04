---
"@objectstack/spec": patch
---

docs(spec): `PageTranslation.components` now says why `element:text`'s `content` is not one of its keys (#14412)

The per-component translation face names its deliberate exclusions with reasons — `help` because no component in the model declares it, `subtitle` because `page:header` is already addressed by page name. `content` was neither named nor excluded. An author looking for a bundle key for the one string `element:text` renders therefore found an absence, and an absence reads exactly like an oversight.

It is not one, and the schema comment now records that beside the other two. `element:text` declares `content: I18nLabelSchema` (`ui/component.zod.ts`), so the string is localizable at its own authoring site as an inline `{ en, 'zh-CN' }` locale map — the route `sys-user.page.ts` itself uses. Adding it to the bundle face would be the face widening the `submitLabel` retirement declined for the identical shape (#10926, ADR-0049).

No key was added and no behaviour changed: the bundle face is still `title` / `description` / `label` / `placeholder` / `emptyText`, and `translatePage` resolves exactly what it resolved before. Bundles, extractor output and existing page definitions are unaffected.

Known and tracked separately: inline locale maps are invisible to `os i18n extract` and `check:i18n-coverage`, so page prose written this way is not counted by coverage tooling. That is true of every inline `I18nLabel` field rather than this component alone, and is carried as #14749.
