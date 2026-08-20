---
"@objectstack/spec": minor
---

Declare `organization_id?: string | null` on `ApprovalRequestRow` and
`ApprovalActionRow` (#10331). The approval service has always stamped the
tenancy placement on the rows it inserts — and returns it on request-row
reads — but the published contract types omitted the field, so consumers had
to cast past the contract to reach it. Type-only widening: one declared
optional field per row, no runtime change.
