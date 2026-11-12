---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/service-storage': patch
---

fix(service-storage, plugin-security): every signed-in member can attach files to the records they may edit, and see those of the records they may read — the storage service contributes its own attachment set to the member baseline, beside the row gates that scope it

Clause-②: yes (widening)
Metadata-protocol: none

A member who could edit a record could not attach a file to it: no permission set granted the attachment object, so every attach was refused before the attachment row gates were consulted. The storage service now contributes `storage_attachment_member` — read and create on `sys_attachment`, nothing else, no edit and no delete — and every signed-in member holds it through the `everyone` anchor, beside `member_default` (ADR-0090 D5). `member_default` itself is unchanged (ADR-0090 D9). `GET /security/explain` names the set as an additive-baseline contributor.

The set is contributed only once all three attachment row gates are installed: the write rule (attach only to a record you may edit), the read-visibility gate (see only the attachments of records you may read) and the download door's parent-record check. A kernel missing any of them contributes nothing and says which gate is missing at warn level, so the object stays refused rather than ungated. A host without the storage service, a deployment that declares no member baseline (`fallbackPermissionSet: null`), external users and agents gain nothing.

**Upgrade-day change.** Attachments already stored become visible again to every member who can read the parent record, and a member can attach files to records they can edit. Managing other people's attachments — edit and delete — still needs an explicit set distributed by position.

`ISecurityService` gains an optional member, `contributePlatformBaselineSet(contributor, set)`, the seam a platform service contributes its baseline set through. It admits only read and create, only on objects the contributing package registered itself, one set per contributor, and only during boot; a wildcard, any other permission bit, a row policy, another package's object or a late call is refused, and every admission and refusal is logged. Feature-detect it: a security service without it contributes nothing, and the contributor keeps its object refused. It is for platform services, not tenant packages.
