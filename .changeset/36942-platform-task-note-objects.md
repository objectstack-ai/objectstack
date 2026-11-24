---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(platform-objects): built-in tasks and notes, `sys_task` and `sys_note`, in every environment

Clause-②: no
Metadata-protocol: none

`PlatformObjectsPlugin` now registers two ordinary, customizable objects on their own manifest
(`com.objectstack.platform-objects.work`), so any application can put tasks and notes in its menu
without declaring its own:

- `sys_task` — title (required), description (rich text), status (To Do / In Progress / Done,
  default To Do), due time, assignee (a user, defaulting to the creator) and a read-only completion
  time the platform writes when the status becomes Done and clears when it leaves Done.
- `sys_note` — an optional title and a rich-text body; lists show a read-only heading that is the
  title, or the body's first line when the title is empty.

Each keeps its own sharing: `sharingModel: 'private'` over a declared `owner_id` (the creator), and a
task is also shared, with edit access, with its assignee through the declared `sys_task_assignee`
sharing rule. Neither links to, grants access to, or derives access from any other record. Default
views: tasks Assigned to Me (open, by due time), Created by Me and All Tasks (a board by status);
notes My Notes and All Notes. Attachments are on for both.

Both names join `PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` in `@objectstack/spec`, so
validation treats them as platform-provided: an app's navigation entry reaches them with
`requiresObject` beside `objectName` (`{ type: 'object', objectName: 'sys_task', requiresObject:
'sys_task' }`), which `defineStack` accepts and the console hides on a kernel without the object.
Their labels ship in the platform's eleven locales (zh-CN 任务 / 备忘).

Members reach both through a permission set that grants the objects: the platform's member baseline
grants neither.
