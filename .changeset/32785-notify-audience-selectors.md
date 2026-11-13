---
'@objectstack/skills': patch
---

docs(skills): objectstack-automation teaches the `notify` audience selectors, `org:members` included

Clause-②: no
Metadata-protocol: none

`skills/objectstack-automation/SKILL.md`'s `notify` section taught a recipient as an id, a list, an envelope or `emailField` only, so an agent asked for an announcement listed users by hand. It now names the three selectors a recipient string may be, written or evaluated: `team:ID` (that team's members), `owner_of:OBJECT:ID` (that record's owner) and `org:members` (every member of the run's organization, else that of the record the notification is about; any other `org:` value reaches nobody, with a warning).

`skills/objectstack-automation/evals/flows-triggers-approvals.json` gains case 22: an administrator-started announcement to the whole organization. The accept set requires `recipients: 'org:members'` and refuses a `get_record` over `sys_member` or `sys_user`.

The new lines are paid for in the same file by deleting restatement, so the file stays under its token ceiling.
