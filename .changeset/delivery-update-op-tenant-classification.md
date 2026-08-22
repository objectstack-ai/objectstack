---
"@objectstack/service-messaging": minor
"@objectstack/plugin-webhooks": minor
---

fix(service-messaging,plugin-webhooks): the `update`-op tenant-audit surface on the delivery outboxes is classified — `ack` is a dispatcher sweep, `redeliver` threads the caller's tenant (#10740)

**BREAKING** signature change on `IHttpOutbox.redeliver` and
`MessagingService.redeliverHttp`, shipped as `minor` under the repo's
launch-window convention for breaking changes.

`sys_http_delivery` and `sys_notification_delivery` carry three single-record
(`multi: false`) writes that the SQL driver audits under the **`update`** op —
a different op, and a different throttle key, from the `updateMany` half
classified previously. Their correct classifications are **opposite**, and
treating them as one sweep is the dangerous reading:

| site | reachable from | classification |
| --- | --- | --- |
| `SqlNotificationOutbox.ack` | dispatcher tick only | global sweep |
| `SqlHttpOutbox.ack` | dispatcher tick only | global sweep |
| `SqlHttpOutbox.redeliver` | `POST /api/v1/webhooks/redeliver` | request-contextual |

**The two `ack` sites** are declared global sweeps through a new
`dispatcherAckOptions()` helper, sibling to `dispatcherSweepOptions()` and
deliberately not the same function — that one returns `& { multi: true }`, so a
`multi: false` site cannot borrow it by accident. The warrant was re-derived
against the current tree rather than inherited: `ack` has exactly two callers,
both inside `runPartition()` on a `setInterval` tick holding a per-partition
cluster lock, so no request context exists to thread; and the row being acked
was claimed by a sweep that crosses organizations by construction
(`hash(refId | notificationId | digestKey) mod N` is a load-spreading key, and
one outbox per environment drains the whole queue). Passing the claimed row's
own `organization_id` is documented at the helper as the tempting wrong answer:
a predicate read off the row you are about to write matches exactly that row,
adds no isolation, and silences the audit anyway — the appearance of scoping
without the substance.

**`redeliver` is not that**, and it is the reason this shipped separately. The
route in front of it is served to any authenticated user, so on a walled
deployment (`OS_TENANCY_POSTURE=isolated|group`) an unscoped replay is an
authenticated user writing another organization's delivery row — the case the
tenant audit exists to catch. It now carries the caller's tenant, applied to
the rows it reads as well as the row it writes, and it must never be given
`bypassTenantAudit`: a scoped write and a bypassed write produce the same
silence in the log, so the flag would convert a detectable hole into an
undetectable one. The webhook route resolves the session's
`activeOrganizationId` and threads it.

Behaviour change at the endpoint: a delivery row outside the caller's
organization is now **not found** (`RESOURCE_NOT_FOUND`, HTTP 404) rather than
replayed. It is deliberately invisible rather than forbidden, so the endpoint
is not an existence oracle for other tenants' delivery ids. An in-tenant
redelivery is unchanged.

Migrating a caller: `redeliver(id, guard?)` becomes
`redeliver(id, { tenantId, guard? })`, and `redeliverHttp(id)` becomes
`redeliverHttp(id, { tenantId })`. `tenantId` is a **required** property typed
`string | undefined`, so omitting it does not compile — a caller with no tenant
has to write `tenantId: undefined` and mean it. That is the point of the shape:
an optional property would let the dangerous case, a request path that simply
forgot, type-check in silence. Passing `undefined` leaves the write unscoped
and the audit line still fires, which is the intended reporting behaviour on a
deployment that cannot resolve an organization for the caller.

<!-- adr-0087: not-required (runtime-interface-only packages/services/service-messaging/src/http-outbox.ts#IHttpOutbox.redeliver, packages/services/service-messaging/src/messaging-service.ts#MessagingService.redeliverHttp) Both symbols are TypeScript interfaces in a service package with no `packages/spec` schema behind them: no metadata author writes a `redeliver` key, there is no authorable spelling and no `retiredKey()` tombstone, so `os migrate meta` has no stack source to rewrite. The change is a required second argument on two in-process methods — a compile error at every call site, which is the notification channel, not a silent runtime gap. -->
