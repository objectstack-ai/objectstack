---
'@objectstack/skills': patch
---

docs(skills): the ai and data skills stop teaching that View All or Modify All opens a field

Clause-②: no
Metadata-protocol: none

From 19, View All (`viewAllRecords`) and Modify All (`modifyAllRecords`) widen records only and cast no field vote; `viewAllFields` is the one "every field" bit. Four published texts still taught the meaning before 19 and now teach this one:

- `skills/objectstack-ai/SKILL.md` (pitfall 2): a field permission without `editable` binds every caller none of whose sets grants the field with an `editable: true` row. It no longer says Modify All grants that edit.
- `skills/objectstack-data/rules/relationships.md` (roll-up visibility): masking a summary on a permission set no longer asks to remove the set's Modify All on the parent first. The mask binds beside it.
- `skills/objectstack-data/rules/security.md` (high-sensitivity fields): `requiredPermissions` is strictest-wins over every field row and `viewAllFields`. View All and Modify All leave the list, since they are no field vote.
- `skills/objectstack-data/evals/hooks-security-seeds-datasources.json`: the expected outputs of cases 20 and 37 match the three sentences above.
