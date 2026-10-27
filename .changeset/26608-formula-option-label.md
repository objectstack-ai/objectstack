---
'@objectstack/formula': minor
'@objectstack/objectql': minor
---

feat(formula): `label(record.<field>)` reads a select field's option label in the reader's locale, so a record name composed in a formula renders `v2 · 清稿` to a zh-CN reader and `v2 · Clean` to an en-US one (#26608)

Clause-②: yes (widening)
Metadata-protocol: added

A select field stores its option's value, so a formula `nameField` such as `'v' + string(record.version_no) + ' · ' + record.kind` printed `v2 · clean` to every reader. Wrap the field in `label()` and the name prints the label the select control shows that reader.

- **The function (`@objectstack/formula`).** `label(record.<field>)` is a new CEL stdlib function, advertised in `CEL_STDLIB_FUNCTIONS`. It takes exactly `record.<field>`; any other argument is refused when the expression compiles. It reads only data: the new `EvalContext.optionLabels` (field → stored value → label, type `EvalOptionLabels`), which the caller resolves in the reader's locale before evaluating. An empty value reads `''`; a value no option declares reads as itself; a field with no options, a multi-value select, and an evaluation whose context carries no `optionLabels` fail loudly.
- **Where it answers (`@objectstack/objectql`).** The engine pins the map for every read and write it serves formula fields on: `find`, `findOne`, and the insert and update responses. The labels are the object's declared `options` with the i18n service's bundle laid over them by `translateObject`, the function `GET /meta/object/:name` serves the object with, in `ExecutionContext.locale` (the request's `Accept-Language`). The field-level key `objects.<object>.fields.<field>.options.<value>` wins over a shared picklist's `picklists.<picklist>.options.<value>`, and both over the declared label. No new keys and no new bundle. A read with no locale, an engine with no i18n service, and an i18n service that throws all read the declared labels.
- **Stored values.** A stored computed field (a non-formula field with an `expression`) is computed once, on the write, so it stores the declared label whatever the writer's locale. Search never indexes formula fields, so what search indexes is unchanged.
- **`setI18nService`** accepts the optional `getTranslations`, `getFallbackLocale` and `getDefaultLocale` the engine now reads. An `II18nService` already carries all three.
