---
'@objectstack/plugin-approvals': minor
---

fix(approvals): a snapshot field the reader is served masked on the data plane is no longer served as stored (#20964)

Clause-②: yes (widening)

The approval payload snapshot is redacted at serve time by the security service's read projection, `getReadableFields`. That projection counts a field whose `maskingRule` applies to the reader as readable, because the data plane serves the column with its value replaced. So the snapshot kept such a field and served it as captured at submission. The redaction now also reads the security contract's `getQueryableFields`, which differs from the read projection by exactly the fields the reader is served masked, and drops those fields, with their derived labels, on both read doors: the approvals inbox reads and the generic data door on the request object. A reader for whom the masking rule is lifted still sees the stored value. The full snapshot stays at rest.

The field is dropped rather than masked. The contract names which fields are masked for a reader, not the masked value, and reproducing the mask in this plugin would be a second copy of the masking rule.

The one public-surface addition is an optional `getQueryableFields(object, context)` member on the field-visibility source that `ApprovalServiceOptions.fieldVisibility` and `ApprovalService.attachFieldVisibility` accept.

A host that constructs `ApprovalService` itself and passes its own `fieldVisibility` source: that source must now also answer `getQueryableFields` (delegate it to the `security` service). A source without it cannot say which readable fields are masked for the reader, so the redaction fails closed and serves no snapshot field. The approvals plugin's own wiring already forwards it.
