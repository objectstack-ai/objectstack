---
'create-objectstack': patch
---

feat(scaffold): new projects start with companies and contacts, with the platform's tasks and notes in the menu

Clause-②: no
Metadata-protocol: none

`npm create objectstack` no longer ships the sample `note` object, whose name clashed with the platform's own notes. A new project now starts with the companies and contacts of the platform's Starter app, as source it owns: `src/objects/company.object.ts` and `contact.object.ts`, a grid and a board for each in `src/views/`, and a menu in `src/apps/main.app.ts` listing Companies, Contacts, Tasks and Notes. Tasks and Notes are the platform's `sys_task` and `sys_note`: the project declares no copy of them, so a task or a note never changes who may see the record it is about. The starter test is now `starter.test.ts`, and it boots the project and checks that a company needs a name, that a contact belongs to a company, and that the menu carries the four entries.

Scaffolding now moves every quoted name under the template's namespace onto the project's, references included: a lookup's target, a related list, a view's object and a menu entry move with the object they name (`blank_company` becomes `my_app_company` everywhere). Before, only `name: '…'` literals moved. A literal that is not a whole namespaced name (a platform object, a navigation id, a longer string) is left alone.

The closing summary prints what the project starts with, and the README's "What this project starts with" section says how to reshape or remove companies and contacts.

Existing projects are not changed.
