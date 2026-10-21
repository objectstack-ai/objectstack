---
'@objectstack/spec': minor
'@objectstack/rest': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

feat(spec): a form view's `title` is translated through `objects.<object>._views.<view>.title`, and `GET /forms/:slug` serves it in the visitor's language

Clause-②: yes (widening)

- **Before.** A form view's `title` (`FormViewSchema.title`) had no translation key. The `_views.<view>` entry named `title` as a rename onto `label`, `translateView` never read `config.title`, and `GET /forms/:slug` answered the top-level `label` from the untranslated view. A public form that declared a title served it in the authoring language to every visitor, so declaring one replaced a translated heading (the object label) with an untranslated one in every other locale.
- **Now.** `objects.<object>._views.<view>.title` is a declared key, under the same `_views` node and view key as the view's `label`. `translateView` overlays it onto a served form item's `config.title`, on the same locale chain and override rule as every other view string: only a form that authors a title is translated, a missing key keeps the authored title, and a title edited on top of the packaged view keeps the edit. `heading` and `formTitle` are named as renames onto `title`.
- **`GET /forms/:slug`.** The served form's `title` is the translated one, and the top-level `label` is taken from the translated view when the view authors a `label`. A view that authors none is still answered without one, so the console heading (`label`, then `form.title`, then the translated object label) is unchanged for it.
- **`objectstack validate`.** `@objectstack/lint`'s translation-reference check accepts a `title` key over a form view (a `formViews.<key>` entry, the default `form`, or a `viewKind: 'form'` item) and refuses it, as `translation-target-unknown`, over a list view, pointing at the view's `label` key.
- **`os i18n extract`.** The CLI extractor emits `_views.<view>.title` for each form a view container serves (keyed by the composer's runtime name) and for a `viewKind: 'form'` item, so the skeleton carries the slot and the i18n coverage gate reports an authored title a supported locale leaves untranslated.
- **Unchanged.** Every other `_views` key, the view `label` and `description` reads, and a form without a title.
