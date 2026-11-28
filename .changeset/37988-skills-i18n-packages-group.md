---
'@objectstack/skills': patch
---

docs(skills): `objectstack-i18n` teaches the bundle's `packages` group, and both related-list skills name the two ways a `.custom` arrangement's tab title is translated

Clause-②: no
Metadata-protocol: none

`skills/objectstack-i18n/SKILL.md`, the top-level group list: `packages` holds a package's display `name` / `description`, keyed by its `manifest.id` with the dotted id as one key (`packages: { 'com.acme.crm': { name: '客户关系' } }`). A locale with no row shows `manifest.name`, and `os lint` warns `i18n/missing-package` (`os i18n check` lists the same gap by key) until that package's own bundle carries the row.

`skills/objectstack-i18n/SKILL.md`, the `_relatedLists.{list}` row, and `skills/objectstack-data/rules/relationships.md`, the `relatedLists` bullet: where the paired `.custom` arrangement leaves a list with no key, the remedy is to drop the key or re-state the entry, shown, with a `label`. The owner's own `label` keeps the owner's translation; a `label` of the arrangement's own is translated at the same `objects.{parent}._relatedLists.{list}.label` key in the `.custom` package's bundle, which `os i18n check` expects.

Nothing an author can write changes. Neither file grows: `objectstack-i18n/SKILL.md` moves down to its measurement (6333 to 6315), the additions paid by replacing the translation-reference paragraph's list of action keys judged against a declaration, each already conditioned in the `_actions` row, with one sentence pointing at that row, and by dropping the code-comment tails that repeat the sentence introducing the first example; `rules/relationships.md` moves down too (4181 to 4179), paid by four restating phrases in the same file.
