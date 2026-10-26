---
'@objectstack/platform-objects': patch
---

fix(platform-objects): a business unit membership is titled by the person's and the unit's names, not their ids

Clause-②: no (no exported type, schema field or spec key changes; `sys_business_unit_member.display_title` stays a text formula and `titleFormat` is unchanged)
Metadata-protocol: none

`sys_business_unit_member.display_title`, the record title Setup → Business Unit Members shows in its Title column and on the record heading, read `record.user_id + ' in ' + record.business_unit_id`, so it showed two raw ids. It now reads the user's name (their email where the name is blank) and the business unit's name, one hop through each lookup, the traversal the formula read path already serves (ADR-0079 addendum, 2026-10-18), as `sys_user_permission_set`'s title does. The title reads "Ada Lovelace in EMEA Sales".

Nothing is stored and no hook is added: a write costs nothing more, and a read that serves the title makes one batched read of `sys_user` and one of `sys_business_unit` per page. A renamed user or unit, or a membership moved to another user or unit, shows the new names on the next read. Both hops are read with the reader's permissions: where the reader may not read the user or the unit, or it no longer exists, the title is empty and the console falls back to `titleFormat`. The title is still not sortable or searchable, as before.
