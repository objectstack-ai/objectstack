// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * trigger-api route ledger — the audited disposition of every HTTP route
 * `ApiTriggerPlugin` mounts, against what `@objectstack/client` can express
 * (#11863, in the #3636 pattern).
 *
 * WHY THIS EXISTS. This plugin mounts its inbound-hooks endpoint on the HOST
 * Hono app: it resolves the `http-server` service at `kernel:ready`, takes the
 * framework-native handle through `getRawApp()`, and registers `POST` straight
 * on it. That mount is outside every ledger the platform had:
 *
 *  - the dispatcher ledger (`packages/runtime/src/route-ledger.ts`) sees
 *    `RouteManager` branches; this is not one, and
 *    `NON_DISPATCH_MOUNT_PREFIXES` pins only dispatcher-plugin's own host
 *    mounts;
 *  - the REST ledger (`packages/rest/src/rest-route-ledger.ts`) sees whatever
 *    `RestServer.getRoutes()` reports, which never sees this mount;
 *  - `service-storage`, `service-i18n` and `service-datasource` carry their own
 *    ledgers (#3636 / #7744) precisely because a service that registers
 *    straight on `IHttpServer` is invisible to both of the above — and this
 *    package is one step further out again.
 *
 * WHY A PER-PACKAGE CONFORMANCE TEST, AND NOT THE PARITY GATE. `service-settings`
 * ledgered the same shape in #7526 and deliberately grew NO per-package guard,
 * because `route-ledger-live-mount-parity.dogfood.test.ts` boots a server and
 * reads the mount table off it. That gate structurally CANNOT see this route:
 * it reads `IHttpServer.getMountedRoutes()`, and "routes an adapter mounts on
 * its framework-native handle behind `getRawApp` are outside this table by
 * construction" — the contract's own words
 * (`packages/spec/src/contracts/http-server.ts`). It is the same reason
 * `AUTH_ROUTE_LEDGER` is not one of that gate's inputs: `plugin-auth` mounts on
 * the raw app too. So the #3636 shape is the right one here, and the guard is
 * `trigger-api-route-ledger.conformance.test.ts` — which drives the plugin's
 * real lifecycle rather than pinning a copied list, and additionally scans this
 * package's own source so a SECOND registrar cannot hide behind a one-row
 * ledger that reads as a completed census.
 *
 * SCOPE & SHAPE, re-derived on `origin/main` @ 4019e16cdc rather than inherited
 * from the filing: this package contains exactly ONE absolute-path literal
 * (`HOOKS_PATH`, `plugin.ts:25`), exactly one mount call (`rawApp.post`,
 * `plugin.ts:83`), and exactly one module that reaches for the host app
 * (`plugin.ts`). The path is a fixed constant — there is no configurable base
 * to move this family, unlike the storage/i18n/settings ledgers — so the row
 * carries the wire path verbatim.
 *
 * WHY THE ONE ROW IS `server-only`, measured. `@objectstack/client`'s entire
 * `automation` namespace targets the DISPATCHER domain (`getRoute('automation')`
 * → `/api/v1/automation`); no client method builds a `/automation/hooks/*` URL,
 * and none should — the caller here is a third-party sender holding the flow's
 * shared secret, not the SDK. Nor is it `public`: `public` in this vocabulary
 * is an anonymous BROWSER surface (public forms, share-link resolution), and
 * this is a machine-to-machine door — the same shape `service-storage` ledgers
 * its HMAC-token `_local/raw/:token` routes with, `server-only`. Promoting this
 * row to `sdk` would be a public-surface widening and belongs in the PR that
 * adds the method, with the disposition re-reviewed there.
 *
 * The live half of that measurement is enforced next door BY OMISSION: this
 * ledger is deliberately NOT one of `client-url-conformance.test.ts`'s union
 * inputs, so a client method that started calling this route would fail there
 * for matching no ledger row at all. Adding this file to that union would
 * remove exactly that protection.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API — nothing imports it into the bundle, so the
 * published surface of `@objectstack/trigger-api` is unchanged. It must stay
 * import-free.
 */

/** Disposition of a single trigger-api route. Same vocabulary as the REST ledger. */
export type TriggerApiRouteDisposition =
    /** Expressed by the SDK — `client` names the method (dotted path). */
    | 'sdk'
    /** Should be in the SDK and is not — an open, acknowledged gap. */
    | 'gap'
    /** Deliberately not SDK surface (inbound integration doors, loopbacks). */
    | 'server-only'
    /** Public, unauthenticated browser-facing route. */
    | 'public'
    /** Server and client disagree on the shape — needs reconciliation. */
    | 'mismatch';

export interface TriggerApiRouteLedgerEntry {
    /** `VERB /api/v1/...` — the full wire path, verbatim as mounted. */
    route: string;
    /** Registrar family, for grouping and diff messages. */
    family: string;
    disposition: TriggerApiRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /**
     * Name of the `@objectstack/spec/api` export declaring this route's response
     * PAYLOAD — the `data` of the shared `{ success, data }` envelope where the
     * route emits one, the whole body where it does not.
     *
     * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE — the same rule the
     * REST, storage and datasource ledgers carry (#3877). A name written ahead
     * of the test it points at would BE the "declared but unverified" surface
     * the programme exists to remove. The row below is unfilled: this endpoint's
     * coverage (`api-trigger.test.ts`) asserts the STATUS + body of each
     * outcome directly, not a payload schema, so it has not earned the field.
     *
     * A NAME rather than a live schema object, deliberately: this module stays
     * import-free.
     */
    responseSchema?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const TRIGGER_API_ROUTE_LEDGER: readonly TriggerApiRouteLedgerEntry[] = [
    // ── inbound webhook door (ADR-0041 Tier 1) ─────────────────────────
    {
        route: 'POST /api/v1/automation/hooks/:flowName/:hookId',
        family: 'inbound-hooks',
        disposition: 'server-only',
        note:
            'the door a third-party sender posts through, not an SDK call: GitHub/Stripe-style HMAC over the raw body '
            + '(`x-objectstack-signature`, constant-time) against the flow start-node `secret`, then ENQUEUE + 202 — the flow '
            + 'runs on the queue consumer, never in-band (ADR-0041 §5). Measured, not assumed: `@objectstack/client`\'s whole '
            + '`automation` namespace targets the dispatcher domain `/api/v1/automation`, and no client method builds a '
            + '`/automation/hooks/*` URL. Not `public` either — that disposition means an anonymous BROWSER surface (public '
            + 'forms, share-link resolution); this is machine-to-machine, the shape `service-storage` ledgers its HMAC-token '
            + '`_local/raw/:token` routes with. A flow that declares no `secret` accepts unsigned posts (warned at arm time): '
            + 'that is a flow-authoring posture, not an SDK disposition.',
    },
];
