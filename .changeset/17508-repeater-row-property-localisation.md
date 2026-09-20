---
'@objectstack/platform-objects': minor
'@objectstack/spec': minor
---

Studio's property-panel repeater tables name their columns in the author's own language: every repeater enumerates its row properties in the owning `*.form.ts`, and all four platform catalogs carry a translated name for each one

Clause-②: no

A `type: 'repeater'` renders as a table whose column heads come from the form's declared row children when it declares any, and from the served JSON Schema `items.properties[k].title` when it does not. `os i18n extract` only emits a `metadataForms.<type>.fields['<path>.<prop>']` key for a **declared** child, so a repeater that enumerated none had no localisation channel at all — #17232 (PR #17500) authored English titles on thirteen item schemas, #17505 and #17506 on four more, and every one of those column heads reached a Chinese, Japanese or Spanish author in English.

Both halves land together, because either alone is a half-state: 112 row properties across fifteen repeaters are now enumerated, each with a `label` equal to the item schema's own `.meta({ title })`, and the `en` / `zh-CN` / `ja-JP` / `es-ES` catalogs gain a leaf for each. Nothing in the accept set moves — the same author input parses identically before and after, and no row child declares a `type`, so the row widgets stay schema-derived.

Terms reuse the word each catalog already uses for the concept (`Label` → 显示名称 / 表示名 / Etiqueta, `Filter` → 筛选 / フィルター / Filtro, `Timeout (ms)` → 超时（毫秒）/ タイムアウト（ms）/ Tiempo de espera (ms)), and `field.options.*` mirrors its `object.fields.options.*` twin verbatim.

`page.variables.source` is the one existing string that moves. Its children were enumerated without labels, so the extractor emitted the humanized path `"Source"` as the English source and the bundle overlay then wrote that over the schema's authored `"Written By"`. The form now declares the label, the `en` leaf becomes `Written By`, and its three translations are re-authored with it (写入组件 / 書き込み元 / Escrito por).

`view.columns` / `view.sort` / `view.tabs` are untitled and enumerate no children — they are #17507's, and are untouched here. `object.fields.options` stays the curated four-key subset its reconciliation-ledger entry declares.
