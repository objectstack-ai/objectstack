---
'@objectstack/skills': patch
---

docs(skills): the i18n skill lists a lookup or master-detail field's translatable `relatedListTitle`

Clause-②: no
Metadata-protocol: none

- **Before.** The `objectstack-i18n` object-level table listed `label`, `help`, `placeholder`, `options` and `inlineTitle` under `fields.{field_name}`, so an author had no word that the related-list title on a parent's record page is translatable.
- **Now.** The row adds `relatedListTitle`: the title of the related list a `lookup` or `master_detail` field draws on its parent's record page. The key sits on the child object's field, and an untranslated title keeps its authored text, never the child's label.
- The paragraph under *Diff & Coverage Schemas* saying `getCoverage()` / `suggestTranslations()` have no shipped implementation is cut; *Service Contract* in the same file says the same. No schema, key or behaviour changes.
