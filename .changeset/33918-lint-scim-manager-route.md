---
'@objectstack/lint': patch
---

docs(lint)!: `os explain approval-approvers-may-resolve-empty` names SCIM as a route that populates `sys_user.manager_id`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) This package changes explanation text only: no key of any authorable schema and no stored row changes, so there is nothing for `objectstack migrate meta` to rewrite. The narrowing it describes is plugin-auth's SCIM answer, declared in that package's note. -->

**BREAKING** in the behaviour this text now describes, not in the lint package: a SCIM user write whose named manager would make the user their own manager, close a cycle, run past the depth cap or cross an organization boundary was served before and is now refused with SCIM `400 invalidValue` (plugin-auth's note has the details). The lint rule and its findings are unchanged.

The `manager` arm's remedy said the platform declares the SCIM `manager` attribute without projecting it onto the column. plugin-auth now projects it, so the remedy says that the Enterprise User `manager` attribute, whose value is the manager's SCIM resource id, is written onto the column for an active user a SCIM directory holds, from the connection that provisioned that user's profile, on a create, replace or patch that names the attribute, through the admin operation's refusals. A write that does not name it leaves the column as it is, and an id naming no existing user the connection provisioned is served with the column unchanged. Any other directory sync is still named as something your own deployment supplies.
