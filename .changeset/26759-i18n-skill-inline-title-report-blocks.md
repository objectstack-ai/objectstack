---
'@objectstack/skills': patch
---

docs(skills): the i18n skill's group table names `fields.{field}.inlineTitle` and `reports.{report}.blocks.{block}.{label,description}`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-i18n/SKILL.md` did not name two keys the 18.2 translation bundle already accepts and the runtime already serves, so an AI author writing a bundle from the skill left a master-detail field's inline child-grid heading and a joined report's block headings in the authoring language. The `fields.{field_name}` row now names `inlineTitle` (addressed on the child object that owns the field; untranslated it keeps its authored text, with no fallback to the child's plural label), the `reports` sentence names `reports.{report}.blocks.{block_name}.{label,description}` (keyed by the block's required `name`), and one example row each, spelled as the shipped `app-crm` and `app-showcase` bundles spell them, follows the group table. The eval file gains one prompt covering both keys.
