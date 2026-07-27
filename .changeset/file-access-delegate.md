---
"@objectstack/spec": minor
"@objectstack/service-storage": patch
"@objectstack/plugin-approvals": patch
---

fix(storage): let an object delegate file-read authorization to its service

Fixes a regression from the governed-download change (ADR-0104 D3 wave 2): a
**legitimate approver could see a decision attachment's filename but got 403
opening it**, found by driving app-showcase in a browser as a real non-admin
approver.

Cause: a field-owned file's download was authorized by testing whether the
caller can READ the owning row. For an ordinary business object that is right —
row readability *is* the access rule. For `sys_approval_action` it is the wrong
authority: the audit table is deliberately closed to ordinary approver
positions (`operation 'find' … is not permitted for positions [auditor,
everyone]`), so the test denied the very approver the attachment was filed for.
The approvals *service* has always had the real rule, which is why the timeline
listing the attachment returned 200 while the bytes returned 403.

An object may now name a service to answer the question instead:

- `ObjectSchema.fileAccessDelegate` — a kernel service that authorizes
  downloads of files owned by that object's media fields.
- `IFileAccessDelegate.authorizeFileRead(recordId, context)` — the contract.
- `sys_approval_action` declares `'approvals'`; `ApprovalService.authorizeFileRead`
  reuses the *same* gate `listActions` applies (visibility of the parent
  request) rather than inventing a second, looser rule for the bytes.

**Fails closed**: a declared delegate that is missing or does not implement the
method denies, rather than silently reverting to the raw read it was declared to
replace. Objects without the declaration are unchanged.

Verified in the browser against app-showcase, both sides of the gate: the
approver now downloads the real PDF (200), and an anonymous request is still
refused (401) — the anonymous capability URL the original change closed stays
closed. A decision attachment ends up exactly as readable as the decision it
hangs off: never more, and no longer less.
