---
'@objectstack/spec': patch
---

A served object field no longer carries an undeclared `help` key. `translateObject` now serves a field's translated help on the field's `description` (#21948).

Clause-②: no

- **What moved.** A bundle's `objects.<object>.fields.<field>.help` entry is the translation of the field's `description`, because the i18n extractor writes it from that key. `translateObject` (and so `GET /api/v1/meta/object/:name` in a non-English locale) used to put it on a `help` key that `FieldSchema` does not declare. The served field then failed `FieldSchema` with `unrecognized_keys`. A consumer that reads only declared keys rendered the English `description`, and the console logged one ingestion warning per such field. The translation is now served on `description`, and the served field carries no `help`.
- **Precedence (ADR-0029 D9.2a).** The catalog applies only while the served field's `description` still equals the packaged field's. This is judged by the same comparison the object scalars, views and dashboards use. A description that diverged (an `objectExtensions` field, or a tenant's own edit) keeps its authored value in every locale. With no packaged base supplied, the catalog applies, as before. A field's `label` is unchanged and stays a flat `catalog ?? document`.
- **`ObjectFieldLike`** (`@objectstack/spec/system`) drops its `help?: string` member. Its `[key: string]: any` index signature still accepts and types a `help` key, so a caller that writes or reads one still compiles. `inlineHelpText` is not touched.
- Readers that fall back from `help` to `description` (`field.help || field.description`) render the same translated text as before.
- ⛔ No schema, parse or export change. The translation bundle's own field `help` key is unchanged.
