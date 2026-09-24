---
"@objectstack/objectql": patch
---

fix(objectql): `parent.*` validation predicates no longer read another organization's header, and, outside the `group` posture, the dangling-reference audit reports cross-organization references

**Master-detail `parent.*` predicates.** A detail object's `requiredWhen` and `readonlyWhen` can read the master-detail header as `parent` (for example `requiredWhen: "parent.status == 'locked'"`). The engine read that header without the caller's organization, so it found the header in any organization. A user in one organization who put another organization's header id on a detail record got an answer that depended on that header's fields: on create, a `locked` header answered "`note` is required" while an `open` one answered `reference_not_found`; on update, a `readonlyWhen` field was dropped or kept, and a strict write was refused or not. That leaked one bit of another organization's record per write.

The header is now read only where the caller's organization can see, like the reference check. A header outside the caller's tenant scope (another organization; under the `group` posture, an organization outside the caller's membership set) is treated exactly like a header that does not exist: `parent` is left unbound. On create and on repoint, the write gets the same `VALIDATION_FAILED` / `reference_not_found` answer whatever the header's state. A `readonlyWhen` that needs `parent` stays locked, as it already did for a header that cannot be read. A `requiredWhen` that needs `parent` is skipped, as it already was in that case.

What does not change:

- Headers in the caller's own organization bind as before, so their `requiredWhen` and `readonlyWhen` rules apply as before.
- Headers of platform-global masters (`tenancy: { enabled: false }`), federated masters, and headers with no organization still bind from any organization.
- The header read still ignores row-level security.
- System-context writes with no organization (seed replay, provisioning) still read the header from any organization.

One case to check: a detail record that already points at a header in an organization the editor cannot see (another organization; under the `group` posture, one outside the editor's membership set), written before this fix or by a system-context write, now edits as if its header were missing. Its `parent`-scoped `readonlyWhen` fields stay locked, and its `parent`-scoped `requiredWhen` rules are not enforced. Outside the `group` posture, the dangling-reference audit below now reports such records, so you can find and fix them. Under `group` it does not; see the audit paragraph below.

**Dangling-reference audit.** `inspectDanglingReferences` (the read-only audit that runs with the lifecycle sweep) checked each stored reference across all organizations. A reference to a record in another organization therefore looked fine, even though the write path now refuses it. Outside the `group` tenancy posture, the audit now checks each record's references in that record's own organization. A cross-organization reference is reported in `dangling`, and records with no organization are still checked across all organizations. Under the `group` posture the audit still checks across all organizations, as before. There, a member of several organizations may legitimately link records across them, and the stored record does not say which organizations its writer could see. So under `group`, a reference into another organization is reported only when the target does not exist anywhere. Custom `DanglingReferenceAuditPort` implementations get the record's organization, or `null`, as a new third argument to `probe`. Implementations that ignore it keep working.
