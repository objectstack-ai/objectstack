---
"@objectstack/service-messaging": minor
"@objectstack/service-automation": patch
"@objectstack/plugin-webhooks": patch
---

fix(service-messaging,service-automation,plugin-webhooks): stamp `organization_id` on `sys_http_delivery` rows so the cross-organization wall on `redeliver()` actually excludes other tenants' rows (#13546)

`sys_http_delivery` is tenant-scoped and `redeliver()` — the one
request-reachable door on it — deliberately scopes by the caller's
organization (#10740). But the enqueue door never stamped the
`organization_id` column, and the SQL driver's tenant term is
`(organization_id = :tenantId OR organization_id IS NULL)` — a deliberate
global-row fail-open — so 100% of delivery rows landed in the NULL arm:
visible to, and replayable by, every organization on a walled deployment.

The repair mirrors the notification outbox's existing convention
(`EnqueueDeliveryInput.organizationId`), end to end:

- `EnqueueHttpInput` gains an **optional** `organizationId` member (inherited
  by `UndeliverableHttpInput`, so parked rows are tenant-stamped too), and
  `HttpDelivery` surfaces it on read-back. `SqlHttpOutbox.insert` writes
  `organization_id: input.organizationId ?? null` exactly like
  `SqlOutbox.enqueue`; `MemoryHttpOutbox` stores the same field and — now
  that its rows carry a tenant — applies `RedeliverOptions.tenantId` in
  `redeliver()` with the driver's exact semantics (another organization's row
  is invisible/`RESOURCE_NOT_FOUND`; an org-less row stays a global row; a
  tenant-less caller stays unscoped).
- The flow `http` node (durable mode) threads its run's acting organization
  (`AutomationContext.tenantId` — the same source as the `notify` node's
  #11303 repair) and warns loudly when a multi-org run has none to thread.
- The webhook auto-enqueuer stamps each delivery with its subscription's own
  organization (`sys_webhook.organization_id`); org-less subscriptions
  enqueue org-less, unchanged.

Forward-stamping only: existing NULL rows are untouched (their disposition is
a separate decision). Producers with genuinely no organization — a
`single`-posture deployment, a stack before its first organization — keep
working unchanged; their rows land NULL, which is the honest global-row shape.
