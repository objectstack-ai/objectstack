---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

Studio's view property panel names the columns of its Columns, Sort and Tabs tables in the author's language, not only in English

Clause-②: no

`view.form.ts` now enumerates the row properties of the `columns`, `sort` and `tabs` repeaters, each with a `label` equal to its item schema's own `.meta({ title })`, so `os i18n extract` emits a `metadataForms.view.fields` key for each row property. The `en`, `zh-CN`, `ja-JP` and `es-ES` platform catalogs carry those keys. The translated catalogs reuse the word they already use for the same concept where they have one (`Label` → 显示名称 / 表示名 / Etiqueta, `Direction` → 排序方向 / 並び方向 / Dirección).

The row children declare no `type`, so each row input's widget is still derived from the schema. The view schema itself is unchanged.
