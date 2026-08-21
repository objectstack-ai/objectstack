---
"@objectstack/service-messaging": patch
---

Classify the delivery dispatchers' predicate writes on `sys_http_delivery` and
`sys_notification_delivery` as global environment sweeps (#10673). On a walled
deployment (`OS_TENANCY_POSTURE=isolated|group`) the SQL driver's tenant-audit
gate reported every `updateMany` these outboxes issue from the claim path as an
un-isolated write. The audit was right to ask: both objects are tenant-scoped
via `organization_id`. The answer is that these six writes — the
visibility-timeout reap and the atomic claim in `SqlHttpOutbox.claim`,
`SqlNotificationOutbox.claim` and `SqlNotificationOutbox.claimDigest` — are
issued by a `setInterval` dispatcher tick under a cluster lock, with no request
context and no tenant anywhere in the `ClaimOptions` contract, and they must
cross organizations: one outbox drains the whole environment's queue, so a
per-organization predicate would strand every other organization's deliveries.
They now pass `bypassTenantAudit` through a single documented helper that
carries that warrant. Diagnostics only — per its spec the flag never changes
what a write touches, and the row-level `ack` / `redeliver` writes are
unaffected.
