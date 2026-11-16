---
'@objectstack/lint': patch
---

docs(lint): `os explain approval-approvers-may-resolve-empty` names SCIM as a route that populates `sys_user.manager_id`

Clause-②: yes (widening). A SCIM request whose `manager` is ignored today starts writing `manager_id`. A manager value naming no known user is answered as a SCIM error. The dev measures this again before the PR, including whether any request served today becomes refused.
Metadata-protocol: none

The `manager` arm's remedy said the platform declares the SCIM `manager` attribute without projecting it onto the column. plugin-auth now projects it, so the remedy says that the Enterprise User `manager` attribute, whose value is the manager's SCIM resource id, is written onto the column on every SCIM create, replace and patch through the admin operation's refusals, and that an id naming no user the connection provisioned is refused. Any other directory sync is still named as something your own deployment supplies.
