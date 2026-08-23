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
 * audit exists to prevent.
 *
 * ⛔ **`multi: false` sites do not use this helper** — its return type says
 * `multi: true` so they cannot, deliberately. The single-record writes on
 * these same objects are audited under a DIFFERENT op (`update`, not
 * `updateMany`) and they do **not** share one classification:
 * {@link dispatcherAckOptions} carries the sweep warrant to the two `ack`
 * sites, and `SqlHttpOutbox.redeliver` — request-reachable — carries a
 * threaded tenant and no bypass at all.
 *
 * ⛔ [#11009] `redeliver` is now ALSO a `multi: true` write (its terminal-
 * status compare-and-set must ride the predicate path to be evaluated at
 * all), which makes it TYPE-compatible with this helper — and still the one
 * write on these objects that must never use it: this helper's warrant is
 * "no request context exists", and `redeliver` is precisely the site that
 * has one. `multi` stopped discriminating the two; the classification —
 * threaded tenant vs declared-global bypass — is the line that still does.
 *
 * @param where Predicate identifying the rows this sweep claims or reaps.
 */
export function dispatcherSweepOptions(
    where: Record<string, unknown>,
): EngineUpdateOptions & { multi: true; bypassTenantAudit: true } {
    return { where, multi: true, bypassTenantAudit: true };
}


/**
 * The write options for a dispatcher **`ack`** — the single-record
 * (`multi: false`) write that records one delivery attempt's outcome, on
 * `SqlNotificationOutbox.ack` and `SqlHttpOutbox.ack`.
 *
 * ## Why a second helper instead of {@link dispatcherSweepOptions}
 * These are audited under the driver's **`update`** op, not `updateMany`, and
 * the two ops are separate keys in `auditMissingTenant`'s throttle — so a
 * classification made for the sweeps says nothing about these. The sweep
 * helper's return type is `& { multi: true }`, which makes the confusion a
 * compile error rather than a judgement call.
 *
 * ## The warrant, re-derived rather than inherited
 * It is the same warrant as the sweeps', and every limb was re-checked
 * against this tree:
 *
 *  1. **No request context exists to thread.** `ack` has exactly two callers,
 *     `NotificationDispatcher.dispatchOne` / `HttpDispatcher.dispatchOne`,
 *     both inside `runPartition()` — a `setInterval` tick holding the
 *     `notify.dispatcher.partition.<n>` / `http.dispatcher.partition.<n>`
 *     cluster lock. There is no HTTP request, no session and no active
 *     organization anywhere on that path.
 *  2. **The row being acked was claimed by a deliberately global sweep.**
 *     `claim()` crosses organizations by construction (partitioning is
 *     `hash(refId | notificationId | digestKey) mod N`, a load-spreading key,
 *     never an org key), and one outbox per ENVIRONMENT drains the whole
 *     queue. An `ack` that could not write the row its own tick just claimed
 *     would leave that row `in_flight` until the visibility timeout, forever,
 *     for every organization but one.
 *
 * ## ⛔ Why not "just pass the claimed row's own organization_id"
 * It is available on the notification claim result, so it is the tempting
 * answer, and it is the WRONG one — worse than this bypass, not better. A
 * predicate derived from the row you are about to write is tautological: it
 * matches exactly the row it was read from and can never exclude anything, so
 * it adds no isolation whatsoever. What it does add is the appearance of
 * isolation — it silences the audit line, and the next reader finds a
 * tenant-scoped write instead of a declared global one. The audit's question
 * is "did the CALLER's tenant reach this write?", and on a dispatcher tick
 * the honest answer is "there is no caller tenant", which is what this flag
 * states.
 *
 * ⚠️ Diagnostics only, exactly as above: it never changes what the write
 * touches. `ack` already targets one row by primary key.
 *
 * @param id Primary key of the delivery row this attempt outcome belongs to.
 */
export function dispatcherAckOptions(
    id: string,
): EngineUpdateOptions & { multi: false; bypassTenantAudit: true } {
    return { where: { id }, multi: false, bypassTenantAudit: true };
}
