---
'@objectstack/skills': patch
---

docs(skills): the i18n skill names the action table column label keys

Clause-②: no
Metadata-protocol: none

objectstack-i18n's SKILL.md lists `resultDialog.columns.{path}.{column_path}` and `preflight.columns.{path}.{column_path}` in the `_actions.{action_name}` row of its key table: the header labels of a `format: 'table'` answer field's columns, written beside `fields` and keyed by the table field's literal `path`, then by the literal `path` of one of its `columns[]`, each value a plain string. The `translation-target-unknown` paragraph gains the matching refusal (a field path that is no declared table field, or a column path the field's `columns[]` does not list), and the zh-CN example block shows the key as the platform's `sys_user` bundle spells it. One new eval case grades a result-dialog table whose headers stayed English, and the preflight eval case no longer says a `preflight` node holds only `fields`. The text is paid for in the same file by cutting four restatements, so the skill's token ceiling does not move.
