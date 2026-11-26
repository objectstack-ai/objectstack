---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/cli': patch
---

feat(platform-objects): built-in tasks and notes, `sys_task` and `sys_note`, in every environment

Clause-②: yes (widening)
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

`@objectstack/plugin-security`: the member baseline `member_default` grants `sys_task` and
`sys_note` read, create and edit, with no delete (maintainer ruling 7131539862, option A). It opens
the objects only: which rows a member sees stays with each object's private sharing, so a task is
read by its creator and its assignee and a note by its creator.

`@objectstack/cli`: the organization-ownership inventory (ADR-0131 D10) gives `sys_task` and
`sys_note` the `attribution` fate, so `os migrate organization-ownership` and the `os dev` upgrade
plan databases that hold them instead of refusing an object with no fate.

Clause-② reads `yes (widening)`: `defineStack` now accepts a top-level action whose `objectName` is
`sys_task` or `sys_note`, and the public surface grows. `Metadata-protocol: none` follows the
`sys_unit` roster-addition precedent: no metadata key, type or schema value is added, and a
reference that already parsed now resolves.
