---
"@objectstack/plugin-approvals": patch
---

Clause-②: no

fix(plugin-approvals): every approval notification body names its record by the object's label and the record id

- **What changed.** The reminder, SLA-breach (to approvers and to the submitter), escalation, hand-off, revision-limit, send-back (with no note) and both out-of-office notification bodies named the record as `<object_name>/<record_id>`, for example `crm_deal/D_123`. They now name it the way `approval.requested` already did: the object's label and the record id, for example `Deal D_123`. An object whose schema declares no label is named by its API name and the id, for example `crm_memo D_123`.
- **No title.** No body carries the record's title, from the live record or from the submit snapshot. The body is stored and may be e-mailed, and it has no single reader whose field access it could be narrowed for.
- **Unchanged.** Each sentence's other wording, every topic, title, `actionUrl`, action link and audience, and the `DUPLICATE_REQUEST` refusal text.
