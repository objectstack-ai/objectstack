// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the discovery service configuration (route and route-less slots).
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import { inProcessServiceMessage } from '@objectstack/spec/system';

/**
 * Service Configuration for Discovery
 * Maps service names to their routes and plugin providers.
 *
 * A missing `route` means the service has NO HTTP surface — discovery must
 * not advertise a route for it (ADR-0076 D12, #2462: an advertised route
 * with no mounted handler 404s and misleads consumers). Such entries carry
 * `noHttpSurface` instead, stating how to report an occupant that does not
 * self-describe: `realtime`'s advertised capability IS the missing HTTP/WS
 * surface, so an in-process bus is `degraded`; `cache`/`queue`/`job` are
 * kernel-internal contracts fully served in-process (#4318), so an unmarked
 * real implementation stays `available`. Either way `handlerReady` is
 * reported `false` — for a route-less slot it is not a proxy for anything,
 * it is the fact itself.
 */
/**
 * [#4093 follow-up] `plugin` is no longer written here. It named the package a
 * consumer should install, and ten of the fifteen names did not exist —
 * `plugin-redis` / `plugin-bullmq` / `job-scheduler` / `plugin-notifications` /
 * `plugin-storage` / `plugin-automation` / `ui-plugin`, plus `plugin-ai`,
 * `plugin-search` and `plugin-workflow` for slots nothing implements at all.
 * The value is surfaced as discovery's `provider` and as its remedy line, so a
 * wrong name is a dead end handed to whoever is trying to fix their stack.
 *
 * It now comes from `CORE_SERVICE_PROVIDER` in `@objectstack/spec/system`, the
 * one table both discovery builders read, verified against what actually
 * registers each slot and guarded by `scripts/check-service-providers.mjs`.
 * Only the ROUTE stays local — that is this builder's own knowledge.
 */
const SERVICE_CONFIG: Record<string, {
    route?: string;
    /** Route-less slots only: status + message for an occupant with no self-description. */
    noHttpSurface?: { statusWhenUnmarked: 'available' | 'degraded'; message: string };
}> = {
    // Plugin-provided like every other optional service since the degraded
    // ObjectQL fallback was retired (#3891): advertised iff the real engine
    // is registered — never hardcoded 'available' (the pre-#2462 lie the
    // fallback existed to paper over).
    analytics:    { route: '/api/v1/analytics' },
    auth:         { route: '/api/v1/auth' },
    automation:   { route: '/api/v1/automation' },
    // Kernel-internal slots (#4318): their providers (service-cache/-queue/
    // -job) mount no HTTP routes — these are in-process contracts, not HTTP
    // capabilities, so there is no route to advertise and never will be. The
    // /api/v1/cache|queue|jobs paths this table used to declare existed
    // nowhere else in the repository; every default boot advertised them next
    // to the fallbacks' own `handlerReady: false` — a single ServiceInfo
    // contradicting itself.
    cache:        { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('cache') } },
    queue:        { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('queue') } },
    job:          { noHttpSurface: { statusWhenUnmarked: 'available', message: inProcessServiceMessage('job') } },
    ui:           { route: '/api/v1/ui' },
    // `workflow: { route: '/api/v1/workflow' }` retired with the slot (#4451,
    // v17): nothing ever registered or resolved it (ADR-0115 Evidence 5) and
    // no host ever mounted the path. State machines are `state_machine`
    // validation rules; approvals are flow nodes (ADR-0019).
    // service-realtime is an in-process pub/sub bus; nothing mounts
    // /api/v1/realtime, so no route is advertised (D12, #2462). Unlike the
    // kernel-internal slots above, the capability this slot advertises is
    // realtime push to clients — without a surface that IS reduced, so an
    // unmarked bus reports degraded. Message matches the dispatcher builder.
    //
    // [#14646] And it is the one CHANNEL SLOT (`CHANNEL_SURFACE_SLOTS`,
    // `@objectstack/spec/api` — the one place that membership is declared, read
    // by BOTH discovery producers, which is why it is not a field of this
    // table). The row used to yield `enabled: true` ("the slot is filled")
    // beside the message below ("no surface is mounted") — both true at once,
    // which is how `enabled` came to carry two meanings and a console client
    // came to subscribe to nothing. `enabled` is now `isSubscribableChannel`
    // and the route is the one the occupant names, so the stock in-process bus
    // advertises no channel while a host that really mounts one still does
    // (maintainer ruling A, 2026-09-04 — realtime stays out of open core).
    // `noHttpSurface` stays: it supplies the status and the sentence for the
    // unmounted case, which is every host the open framework ships.
    realtime:     { noHttpSurface: { statusWhenUnmarked: 'degraded', message: 'In-process event bus only — no HTTP/WS realtime surface is mounted' } },
    notification: { route: '/api/v1/notifications' },
    ai:           { route: '/api/v1/ai' },
    i18n:         { route: '/api/v1/i18n' },
    // `graphql: { route: '/graphql' }` was here until #4451. It was never a
    // `CoreServiceName`, so nothing could ever occupy the slot and the entry
    // was unreachable — but it declared a path the dispatcher had already
    // removed as out of the product plan (`http-dispatcher.ts`: "/graphql
    // removed — GraphQL is not in the product plan", #2462 follow-on). A
    // route nobody serves, for a slot that does not exist, in the table SDKs
    // and AI clients read.
    // Canonical slot since #9683 (was `file-storage`; that spelling stays a
    // deprecated v17 registry alias, mirrored verbatim into the services map
    // after the loop below — never a SERVICE_CONFIG row of its own).
    storage:      { route: '/api/v1/storage' },
    search:       { route: '/api/v1/search' },
};

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { SERVICE_CONFIG };
