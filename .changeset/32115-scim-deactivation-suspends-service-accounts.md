---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a directory deactivation suspends the AI service accounts the person is accountable for, and a re-activation resumes none

Clause-②: no
Metadata-protocol: none

**The rule.** Deactivating a person through SCIM (`active: false`), or deleting one (`DELETE /Users/{id}`), suspends every AI service account whose accountable owner is that person, in every organization. The suspension is the ban the owner-left rule already writes, with its own reason, `Accountable owner deactivated by the directory`, so it reads apart from `Accountable owner left the organization`. Nothing is revoked: the account's keys are refused while it is suspended and work again after a resume. An account already suspended keeps its own reason.

**Resume.** A re-activation lifts the person's ban only, so the accounts stay suspended. `POST /api/v1/auth/service-account/resume` answers `409 RESOURCE_CONFLICT` while the accountable owner is still deactivated by the directory. Once the owner is re-activated, or a new owner is named (`set-owner`), an administrator of the account's organization or a platform administrator resumes it.

**Unchanged.** An administrator's own ban of the owner leaves the owner's accounts as they are. The person's local password is not changed by this release.

**If the suspension does not finish.** The deactivation still lands: the person is disabled and the SCIM request succeeds. The server logs one `error` line naming the person, how many accounts were and were not suspended, and the remedy (suspend each account whose `accountable_user_id` is that person). The next SCIM write that leaves the person inactive runs the suspension again.
