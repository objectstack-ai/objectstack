// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { EngineUpdateOptions } from '@objectstack/spec/data';

/**
 * The write options for a delivery-outbox **dispatcher sweep** — every
 * predicate write (`multi: true`, i.e. `driver.updateMany`) that
 * {@link SqlNotificationOutbox} and {@link SqlHttpOutbox} issue against
 * `sys_notification_delivery` / `sys_http_delivery` from the claim path.
 *
 * ## Why these writes carry `bypassTenantAudit` instead of a `tenantId`
 *
 * Both objects are tenant-scoped: the kernel provisions `organization_id` on
 * them, so `SqlDriver.resolveTenantField()` answers `organization_id` and the
 * driver's `auditMissingTenant` gate treats every unscoped write to them as a
 * finding on a walled deployment (`OS_TENANCY_POSTURE=isolated|group`). That
 * gate is right to ask, and the two legal answers are "thread the caller's
 * tenant" or "declare this write global, and say why". These sweeps are the
 * second, and the warrant is structural rather than aesthetic:
 *
 *  1. **No request context exists to thread.** The only callers are
 *     `NotificationDispatcher` and `HttpDispatcher`, whose `runPartition()`
 *     runs off a `setInterval` tick under a cluster lock keyed
 *     `notify.dispatcher.partition.<n>` / `http.dispatcher.partition.<n>`.
 *     There is no HTTP request, no session and no active organization on that
 *     path — the tick is a platform actor, not a tenant's.
 *  2. **The outbox contract has no tenant to thread even in principle.**
 *     `ClaimOptions` / `HttpClaimOptions` are `{ nodeId, limit, partition,
 *     claimTtlMs, now }`. Partitioning is `hash(refId | notificationId |
 *     digestKey) mod N` — a load-spreading key, deliberately *not* an
 *     organization key — so a partition holds rows from every organization by
 *     construction.
 *  3. **Scoping them would break delivery, not isolate it.** One outbox and
 *     one dispatcher pair are constructed per ENVIRONMENT
 *     (`messaging-service-plugin.ts`), and they drain the whole environment's
 *     queue. An `organization_id = <one org>` predicate on the claim would
 *     strand every other organization's pending notifications and callouts
 *     forever, and one on the visibility-timeout reap would leave rows a
 *     crashed node abandoned for other organizations permanently `in_flight`.
 *     Crossing organizations is the operation's *semantics*, not an oversight.
 *
 * ⚠️ This is a **diagnostics** flag and nothing else: per its spec
 * (`DriverOptionsSchema.bypassTenantAudit`) it "never changes what the write
 * touches". It silences a warning about a write that was already, and
 * correctly, environment-wide. It must never be reached for to quiet a write
 * that a request context could have scoped — that is the failure mode the
 * audit exists to prevent, and the row-level writes on these same objects
 * (`ack`, `redeliver`) are single-record `multi: false` writes that do **not**
 * use this helper.
 *
 * @param where Predicate identifying the rows this sweep claims or reaps.
 */
export function dispatcherSweepOptions(
    where: Record<string, unknown>,
): EngineUpdateOptions & { multi: true; bypassTenantAudit: true } {
    return { where, multi: true, bypassTenantAudit: true };
}
