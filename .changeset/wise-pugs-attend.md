---
"@objectstack/plugin-audit": minor
---

Record-view auditing: `sys_audit_log` can now answer "who viewed which record"

`sys_audit_log` covered writes only, so the question every regulated-industry
security review opens with — *who viewed this customer record, and when?* — had
no answer short of custom work. The ledger now has a `read` action, its writer,
and the `record_views` list view that surfaces it.

Scope is deliberately narrow (maintainer ruling 2026-08-16):

- **Record-detail views only.** A read qualifies when it materialized one record
  and its predicate pinned the primary key — the shape `GET /data/:object/:id`
  produces. List and search reads are not audited.
- **Per-object opt-in, closed.** Nothing is recorded until a deployment names the
  objects: `new AuditPlugin({ readAudit: { objects: ['contact', 'account'] } })`.
  There is no global switch and no exception list, and an empty opt-in registers
  no hook at all, so the default posture costs a read nothing.
- **Batched off the request path.** The hook buffers and returns; rows are
  persisted on a later tick, size- or timer-triggered, and flushed on shutdown.
  Each row keeps the instant the record was VIEWED, not the instant its batch
  drained.

The row records who, what and when — never field values. Read auditing runs
inside the security middleware, ahead of its field masking, so the record it sees
is pre-mask; copying values in would mint a plaintext copy of exactly what
field-level security withholds, in the table compliance staff are granted broad
access to.

Two boundaries are declared rather than left to be discovered: a system-elevated
read (`api.sudo()`, formula recomputes, roll-ups) writes no row, and neither does
a read with no principal to name.
