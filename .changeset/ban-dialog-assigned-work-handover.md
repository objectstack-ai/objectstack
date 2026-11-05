---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the ban dialog says how many records the user holds, and offers one optional hand-over

Clause-②: no
Metadata-protocol: none

Banning a user (the platform's `ban_user` action on `sys_user`) opens a dialog that now shows, above the ban reason, the records that person holds and lets the administrator hand them to someone else before confirming the ban.

- **The counts.** Read from `security.assignedWork.count` of `@objectstack/client`, as the signed-in administrator: the total, how many the user owns (records whose `owner_id` names them) and how many they are assigned (every other user field), and one line per object and field. Objects the administrator cannot read are named as not counted; a count the server cut short says so; a multi-valued user field is counted and said not to be handed over here. The panel shows the server's answer as it came and computes no count of its own.
- **The hand-over.** Optional: pick an active person (banned users and the user being banned are not offered) and click Hand over. One click runs `security.assignedWork.transfer` once (the server moves at most 500 records per call), then reports how many moved, how many could not be moved with each record's reason, and how many still hold the user; when some remain, the button hands over the next batch. The counts are read again after each hand-over. A banned target is refused in the reader's language.
- **The ban never waits.** Confirm is still the ban and stays enabled while a count or a hand-over runs, or after either fails.
- **Where it is decided.** The dialog's host picks the panel from the platform action being run (`resolveParamDialogCompanion`); no authored metadata key selects it, and both param-dialog runtimes (`useConsoleActionRuntime` and the record page's) ask the same function.
- **Strings.** New `console.assignedWork.*` keys in all ten language packs.
