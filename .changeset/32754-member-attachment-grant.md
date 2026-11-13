---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/service-storage': patch
---

fix(service-storage, plugin-security): every signed-in member can attach files to the records they may edit, and see those of the records they may read — the storage service contributes its own attachment set to the member baseline, beside the row gates that scope it

Clause-②: yes (widening)
Metadata-protocol: none

A member who could edit a record could not attach a file to it: no permission set granted the attachment object, so every attach was refused before the attachment row gates were consulted. The storage service now contributes `storage_attachment_member` — read and create on `sys_attachment`, nothing else, no edit and no delete — and every signed-in member holds it through the `everyone` anchor, beside `member_default` (ADR-0090 D5). `member_default` itself is unchanged (ADR-0090 D9). `GET /security/explain` names the set as an additive-baseline contributor.

The set is contributed only once all four attachment gates are installed: the per-object opt-in gate (`enable.files`), the write rule (attach only to a record you may edit), the read-visibility gate (see only the attachments of records you may read) and the download door's parent-record check. All four are the storage service's own: it now enforces the `enable.files` opt-in itself, on every attachment insert and re-point, wherever it runs. A kernel whose data engine cannot carry a gate, or that composes no auth service for the download check, contributes nothing and says at warn level which gate is missing and what to add, so the object stays refused rather than ungated. A host without the storage service, a deployment that declares no member baseline (`fallbackPermissionSet: null`) and external users gain nothing. An agent principal gains nothing in its own right; an agent acting for a member is bounded by that member and by its own scope, so it can now attach where the member can, within that scope.

**Upgrade-day changes.**

- Attachments already stored become visible again to every member who can read the parent record, and a member can attach files to records they can edit. A member who can read a record but not edit it is now refused an attach with `ATTACHMENT_PARENT_ACCESS` instead of `PERMISSION_DENIED` (still 403). Managing other people's attachments — edit and delete — still needs an explicit set distributed by position.
- On a composition that did not mount the capability that enforced the `enable.files` opt-in before, an object that never declared the opt-in now refuses attachments for everyone, administrators and the system path included (`FILES_DISABLED`, 403), as its declaration (default off) says. An object that should take attachments declares `enable: { files: true }`.

`ISecurityService` gains an optional member, `contributePlatformBaselineSet(contributor, set)`, the seam a platform service contributes its baseline set through. It admits only read and create, only on objects the contributing package registered itself, one set per contributor, and only during boot; a wildcard, any other permission bit, a row policy, another package's object or a late call is refused, and every admission and refusal is logged. Feature-detect it: a security service without it contributes nothing, and the contributor keeps its object refused. It is for platform services, not tenant packages.
