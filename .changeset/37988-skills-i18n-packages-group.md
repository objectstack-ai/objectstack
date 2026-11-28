---
'@objectstack/skills': patch
---

docs(skills): `objectstack-i18n` teaches the bundle's `packages` group, and both related-list skills name the two ways a `.custom` arrangement's tab title is translated

Clause-②: no
Metadata-protocol: none

`skills/objectstack-i18n/SKILL.md`, the top-level group list: `packages` holds a package's display `name` / `description`, keyed by its `manifest.id` with the dotted id as one key (`packages: { 'com.acme.crm': { name: '客户关系' } }`). A locale with no row shows `manifest.name`, and `os i18n check` warns `i18n/missing-package` until that package's own bundle carries the row.

`skills/objectstack-i18n/SKILL.md`, the `_relatedLists.{list}` row, and `skills/objectstack-data/rules/relationships.md`, the `relatedLists` bullet: where the paired `.custom` arrangement leaves a list with no key, the remedy is to drop the key or re-state the entry, shown, with a `label`. The owner's own `label` keeps the owner's translation; a `label` of the arrangement's own is translated at the same `objects.{parent}._relatedLists.{list}.label` key in the `.custom` package's bundle, which `os i18n check` expects.

Nothing an author can write changes. Neither file grows: `objectstack-i18n/SKILL.md` moves down to its measurement (6333 to 6328), the additions paid by replacing the translation-reference paragraph's list of action keys judged against a declaration, each already conditioned in the `_actions` row, with one sentence pointing at that row, and by dropping a code comment that repeats the sentence introducing its example; `rules/relationships.md` stays at 4181, paid by three restating phrases in the same file.
