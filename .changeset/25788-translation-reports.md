---
'@objectstack/spec': minor
'@objectstack/cli': minor
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
---

feat(spec,cli): reports are translatable — `reports.<name>` in the translation bundle

Clause-②: yes
Metadata-protocol: added

An app authored in one language listed its reports (`reports[].label`, `reports[].description`) in that language on the app's report index and the report page heading. Before this change the translation bundle had no key for them: `reports` was a retired object-first dialect key, so a bundle carrying it was refused by `os validate`, and `os i18n check` could not report the gap.

- **`@objectstack/spec`:** `TranslationData` (and the registered `translation` item and the platform bundle, which share its groups) gains `reports`, keyed by the report's `name`, carrying `label` and `description` (strict: any other key is refused — `name` or `title` with a message pointing at `label`, and the singular spelling `report` with a message pointing at `reports`). `reports` leaves `LEGACY_OBJECT_FIRST_KEYS`, so a stored translation row carrying it now loads through the authored-row sync instead of being skipped as a retired dialect; the legacy dialect never used the key. A new translator, `translateReport`, overlays the two strings and is registered in the metadata-document dispatch, so `GET /meta/report` (list and item) is served in the request's locale. A key the bundle does not carry keeps the authored string. A report is overlay-editable (ADR-0126 Regime O), so the translator honours the packaged base: a label or description an org re-authored is served as written (ADR-0029 D9.2a), and the strings it did not touch are still translated.
- **`@objectstack/metadata-protocol`:** `getPackagedReportBase(name)` returns the shipped report document beneath any overlay, the base the REST read path hands the translator.
- **`@objectstack/rest`:** the meta read path supplies that base for `report`, as it does for `dashboard` and `view`.
- **`@objectstack/lint`:** `translation-target-unknown` reports a `reports.<name>` key that names no report a package of the stack declares, as an error with the nearest declared name.
- **`@objectstack/cli`:** `os i18n extract` scaffolds `reports.<name>.label` / `.description` from the stack's `reports[]`, and `os i18n check` / `os lint` coverage report an untranslated one in its own bucket (`i18n/missing-report`).

Example (`zh-CN` bundle of an English-authored app):

```ts
reports: { opps_by_stage: { label: '各阶段商机', description: '按阶段汇总的商机' } },
```
