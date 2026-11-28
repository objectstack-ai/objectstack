---
'@objectstack/skills': patch
---

docs(skills): four skill pages follow code that has merged — the `_milestones` translation key, the remedy for a hidden related-list entry, `kanban.cardFooter`, and the rule that refuses an ungranted action write

Clause-②: no
Metadata-protocol: none

`skills/objectstack-i18n/SKILL.md`: the object sub-key table gains a `_milestones.{field}.{value}` row. Its `summary` is the timeline sentence of the `activityMilestones` entry that fires on that field and value, with the same `{field}` tokens; the row is composed at read time in the reader's language, a select token shows as its option label, the stored row is unchanged, and field redaction applies as it does to the stored sentence. The `_relatedLists` row's remedy for a hidden entry now says the entry is re-stated shown, with the owner's label.

`skills/objectstack-data/rules/relationships.md`: the same remedy; a bare child name in a `.custom` arrangement, labelled or not, covers each of that child's `child.field` lists; and an import scope the engine cannot filter by (such as a formula) answers `reference_not_found`.

`skills/objectstack-ui/rules/list-views.md`: the kanban example and its notes carry `cardFooter: { comments, attachments }`. `comments` counts the record's open top-level threads, `attachments` its files, shown only where the object has `enable.files`; no other member is accepted.

`skills/objectstack-ui/rules/actions.md`: a body that writes without `capabilities: ['api.write']` is named by its rule, `action-body-write-capability-undeclared`, in place of the sentence about the sandbox throwing.

Each addition is paid for in its own file (shortened examples and asides); no token ceiling moves.
