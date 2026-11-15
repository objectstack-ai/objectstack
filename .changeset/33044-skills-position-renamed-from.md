---
'@objectstack/skills': patch
---

docs(skills): the security rules teach a position rename through `renamedFrom`

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md` § Renaming or removing a shipped access item gains one paragraph: a renamed position declares its earlier names in `renamedFrom: ['old_name']` and is never deleted and re-added, since holders name a position by its bare name and a deleted one leaves them granted nothing. At boot the security plugin moves the old name's holders (`sys_user_position`) to the new name in every organization, idempotently. It moves holders only: sharing-rule, queue and record-share recipients, pending approvers and invitations that name the old name are listed in the boot log for an administrator. The paragraph names the claims it does not carry: an old name still a position anywhere, claimed twice, recorded under another package in the activation ledger, switched off, or claimed by a disabled package. The file pays for the paragraph in place (no ceiling change): it drops the illustrative `com.acme` and `hr` / `ops` package examples, two of the three example wildcard sets, the `sys_secret` storage sentence (encryption at rest is taught in `rules/field-types.md`), the adapter-written-rows aside, and three short asides. No schema or runtime change.
