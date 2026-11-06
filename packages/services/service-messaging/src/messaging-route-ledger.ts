// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Messaging route ledger — the audited disposition of every HTTP route
 * `registerPreferenceOptionsRoutes` (`preference-options-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `MessagingServicePlugin` reaches for the `http-server`
 * service and registers straight on `IHttpServer`, so neither the dispatcher
 * ledger nor the REST ledger sees its route, the same shape as the storage,
 * settings and print families. `messaging-route-ledger.conformance.test.ts`
 * fails when the registrar mounts a route with no row here, and when a row
 * names a route it no longer mounts; the dogfood live-mount parity gate reads
 * this ledger beside the others on a real boot. The inbox routes
 * (`/api/v1/notifications*`) are not here: the runtime dispatcher serves them,
 * and they are rows of its own ledger.
 *
 * NOT SDK SURFACE. `@objectstack/client` expresses no method for it: the
 * consumer is the console's notification preference and template forms, over
 * plain HTTP. That is a `server-only` disposition.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single messaging route. Same vocabulary as the REST ledger. */
export type MessagingRouteDisposition =
    /** Expressed by the SDK — `client` names the method (dotted path). */
    | 'sdk'
    /** Should be in the SDK and is not — an open, acknowledged gap. */
    | 'gap'
    /** Deliberately not SDK surface. */
    | 'server-only'
    /** Public, unauthenticated browser-facing route. */
    | 'public'
    /** Server and client disagree on the shape — needs reconciliation. */
    | 'mismatch';

export interface MessagingRouteLedgerEntry {
    /** `VERB /api/v1/messaging/...` — the full wire path. */
    route: string;
    /** Registrar family, for grouping and diff messages. */
    family: string;
    disposition: MessagingRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const MESSAGING_ROUTE_LEDGER: readonly MessagingRouteLedgerEntry[] = [
    { route: 'GET /api/v1/messaging/preference-options', family: 'messaging', disposition: 'server-only',
        note: 'the topics and channels a notification preference or template can name, for the console\'s pick-or-type inputs; any signed-in member, read-only' },
];
