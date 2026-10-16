---
'@objectstack/spec': patch
---

fix(spec): `translateView` localizes a form view's `sections` through `objects.OBJECT._sections.NAME` (#23632)

A served form view (`viewKind: 'form'`) carries its sections at `config.sections`. `translateView`, and `translateMetadataDocument('view', …)` that dispatches to it, translated the view's `label`, `description` and `config.bulkActionDefs`, and never a section. So a reader that translates on the caller's behalf served every section heading as authored, beside translated field labels. The anonymous public form is one: its visitor cannot load the translation bundle.

Each named section's `label` and `description` now resolve through `objects.OBJECT._sections.NAME.label` / `.description`, the key `TranslationDataSchema` already declares and `os i18n extract` already scaffolds. They use the same locale chain as every other resolver here (requested locale, then the declared `fallbackChain`, never walked for the `defaultLocale`):

- A missing key keeps the authored text.
- A section with no `name` has no key and is served exactly as authored.
- Only authored copy is translated. A section that authors no `label` or no `description` gains neither from the bundle.
- The form's own `data.object` binding decides the object, before the view's, as the extractor and the translation linter already bind it.
- An explicit override beats the catalog, by the rule the view's other strings follow (ADR-0029 D9.2a). Given `packagedBase`, a section whose string diverged from the packaged section of the same `name` keeps its string. A section the base does not carry keeps its strings.

No export, parameter or type changes. Every caller of `translateView` / `translateMetadataDocument('view', …)` now receives a form view's section copy in the requested locale.

Clause-②: no
