---
'@objectstack/skills': patch
---

docs(skills): the objectstack-project platform catalog lists the built-in `sys_task` and `sys_note` objects

Clause-②: no
Metadata-protocol: none

The catalog's "Platform objects an app would otherwise build" section gains a "Tasks and notes" group, so an app that needs to-dos or notes uses the platform's objects instead of declaring its own. Each row says what the object holds, that it carries no link to another record, which list views ship (`assigned_to_me`, `created_by_me`, `all` on `sys_task`; `mine`, `all` on `sys_note`), and that rows are private (a task to its creator and assignee, a note to its creator) while `member_default` grants read, create and edit without widening that. The `sys_comment` row no longer reads as the notes table. One eval case covers the to-do request.
