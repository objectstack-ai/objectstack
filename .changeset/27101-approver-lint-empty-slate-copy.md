---
'@objectstack/lint': patch
---

fix(lint): two approval-approver warnings no longer say "the request stalls"

Clause-②: no
Metadata-protocol: none

`approval-approver-not-membership-tier` (an `org_membership_level` approver whose value names no tier) and `approval-approver-type-unsupported` ended on "the request stalls". That has not been true since an approval node's `onEmptyApprovers` default became `admin_rescue`: a slate that names no one opens on the organization's administrators, or takes whatever route the node declares. Both verdicts now state only the slot ("it matches nobody" / "the slot resolves to nobody") and end on "onEmptyApprovers decides an empty slate". That stays true under every policy and whatever the default is, because it names no outcome. The `os explain approval-approver-not-membership-tier` text gets the same correction.

The `approval-approver-type-unsupported` hint now builds its "route to people the engine can expand" list from the approver bindings, so it can never offer a type that is itself unsupported. It used to offer `queue` while `queue` was the one unsupported type. Today `queue` is supported, so it stays in the list. No approver type is unsupported today, so the warning fires on no current type.

No rule fires on anything new or stops firing on anything it fired on before. Only the message and hint text changes.
