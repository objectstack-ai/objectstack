// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud-connection route ledger — the audited disposition of every HTTP route
 * this package mounts on the host app's framework-native handle, against what
 * `@objectstack/client` can express (#11882, in the #3636 / #11863 pattern).
 *
 * WHY THIS EXISTS. All four registrars in this package resolve the
 * `http-server` service at `kernel:ready`, take the Hono handle through
 * `getRawApp()`, and register straight on it. That mount is outside every
 * ledger the platform had, and — this is the part that makes a per-package
 * ledger the ONLY available instrument — outside the reach of the #7526
 * live-mount parity gate as well:
 *
 *  - the dispatcher ledger (`packages/runtime/src/route-ledger.ts`) sees
 *    `RouteManager` branches; none of these is one;
 *  - the REST ledger (`packages/rest/src/rest-route-ledger.ts`) sees whatever
 *    `RestServer.getRoutes()` reports, which never sees these mounts;
 *  - `route-ledger-live-mount-parity.dogfood.test.ts` boots a server and reads
 *    `IHttpServer.getMountedRoutes()`, and "routes an adapter mounts on its
 *    framework-native handle behind `getRawApp` are outside this table by
 *    construction" — the contract's own words
 *    (`packages/spec/src/contracts/http-server.ts`). These routes are not
 *    "not yet found" by that gate; they are UNFINDABLE by it.
 *
 * So the #3636 shape is the right one, and the guard is
 * `cloud-connection-route-ledger.conformance.test.ts`. That guard reads this
 * package's own SOURCE rather than driving four plugin lifecycles: every one of
 * these registrars mounts from inside a `kernel:ready` hook behind a
 * multi-service resolution (`env-registry`, `kernel-manager`, `manifest`,
 * `metadata`, `objectql`), so a lifecycle drive would be mostly mock scaffolding
 * and would fail OPEN — observing no mounts — exactly when a resolution changed.
 * A source scan cannot be quietly emptied that way, and it is the shape
 * `check-auth-mount-ledger.mjs` (#10534) established for `rawApp` mounts.
 *
 * SCOPE, re-derived on `origin/main` @ 2ba4329e rather than inherited from the
 * filing: sixteen routes across four registrar families. Every path below was
 * read off the mount call itself, with the module-scope prefix constant
 * resolved; none is composed from configuration, so each row carries its wire
 * path verbatim.
 *
 * WHY NO ROW IS `sdk`, measured rather than assumed. `@objectstack/client` was
 * grepped for all four families — `cloud-connection`, `marketplace`,
 * `runtime/config`, `install-local`. There is exactly ONE hit in the whole
 * package and it is a doc comment (`index.ts:1526`, describing a payload shape
 * "the same shape `marketplace-install-local` consumes"). No client method
 * builds any of these URLs. That is the #11882 audit's finding, and the guard
 * asserts it as a measurement rather than letting the `sdk`-row hygiene rule
 * hold vacuously.
 *
 * The live half of that measurement is enforced next door BY OMISSION: this
 * ledger is deliberately NOT one of `client-url-conformance.test.ts`'s union
 * inputs, so a client method that started calling one of these routes would
 * fail there for matching no ledger row at all. Adding this file to that union
 * would remove exactly that protection.
 *
 * This module is package-internal (not exported from `index.ts`): it is the
 * guard's data, not public API — nothing imports it into the bundle, so the
 * published surface of `@objectstack/cloud-connection` is unchanged. It must
 * stay import-free.
 */

/** Disposition of a single cloud-connection route. Same vocabulary as the REST ledger. */
export type CloudConnectionRouteDisposition =
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

export interface CloudConnectionRouteLedgerEntry {
    /** `VERB /api/v1/...` — the full wire path, verbatim as mounted. */
    route: string;
    /** Registrar family, for grouping and diff messages. */
    family: string;
    /** The `src/` file whose mount call produced this row. */
    mountedIn: string;
    disposition: CloudConnectionRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /**
     * Name of the `@objectstack/spec/api` export declaring this route's response
     * PAYLOAD.
     *
     * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE — the same rule the
     * REST, storage and datasource ledgers carry (#3877). A name written ahead
     * of the test it points at would BE the "declared but unverified" surface
     * the programme exists to remove. Every row below is unfilled: this
     * package's suites assert status + body per outcome directly, not a payload
     * schema, so none has earned the field.
     */
    responseSchema?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const CLOUD_CONNECTION_ROUTE_LEDGER: readonly CloudConnectionRouteLedgerEntry[] = [
    // ── cloud binding + install proxy (ADR-0008 Phase 1) ───────────────
    // Same-origin doors for the Console's Setup surface. The SPA cannot call
    // the control plane from a tenant subdomain (cross-origin, cross-site
    // cookie), so the runtime answers on its own origin and talks to cloud
    // server-to-server. The caller is the Console on the SAME origin, holding
    // an environment session — not an SDK consumer.
    {
        route: 'GET /api/v1/cloud-connection/status',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'boot probe for the Console Setup panel: is this environment bound to a cloud account? Measured, not assumed — '
            + 'no `@objectstack/client` method builds a `/cloud-connection/*` URL; the consumer is the Console SPA\'s '
            + 'CloudConnectionPanel on the SAME origin, which this plugin\'s own header already names as the shape it serves. '
            + 'A same-origin deployment/binding console surface is deliberately not application-developer SDK surface.',
    },
    {
        route: 'POST /api/v1/cloud-connection/bind/start',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'begins an RFC 8628 device-code bind — the RUNTIME is the genuine device-flow client; it asks cloud for a device '
            + 'and user code and hands them to the Setup UI for an operator to approve in the cloud console. An SDK method '
            + 'here would put the device-flow client in the browser, which is the opposite of what ADR-0008 Phase 1 wires.',
    },
    {
        route: 'POST /api/v1/cloud-connection/bind/poll',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'polls the device-token endpoint and PERSISTS the resulting `oscc_…` runtime bearer to the on-disk credential '
            + 'store. The secret must never reach a browser, so this half of the bind flow is structurally server-side; the '
            + 'Console only drives it. No client method builds this URL.',
    },
    {
        route: 'POST /api/v1/cloud-connection/unbind',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'clears the persisted runtime binding — the mirror of bind/poll, and server-side for the same reason: it mutates '
            + 'the on-disk credential store, which no browser-side SDK can or should reach. NOTE: this route is absent from '
            + 'the plugin file\'s own header list, which documents seven of the eight; the census below reads the mount calls, '
            + 'not the header, which is how it is ledgered here at all.',
    },
    {
        route: 'POST /api/v1/cloud-connection/install',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'installs a package into this environment VIA the control plane, authorized by the env→cloud service credential '
            + 'the browser never holds. The SPA drives it same-origin; the credential and the cloud round-trip stay on the '
            + 'runtime. No `@objectstack/client` method builds a `/cloud-connection/install` URL.',
    },
    {
        route: 'GET /api/v1/cloud-connection/installation',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'single-package installed-state probe, read by the Console marketplace to decide whether to offer Install or '
            + 'Open. Same posture as its siblings: a same-origin proxy over a credentialed control-plane read, consumed by '
            + 'the Console rather than by any SDK method.',
    },
    {
        route: 'GET /api/v1/cloud-connection/installed',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'the environment\'s full installed list, backing the Console\'s "Installed" view. Proxies a credentialed '
            + 'control-plane read on the runtime\'s own origin; no client method builds this URL and the browser holds no '
            + 'credential that could replace the proxy.',
    },
    {
        route: 'GET /api/v1/cloud-connection/org-packages',
        family: 'cloud-connection',
        mountedIn: 'cloud-connection-plugin.ts',
        disposition: 'server-only',
        note:
            'the owning organization\'s own catalog, backing the Console\'s "Your organization" view. Requires the env→cloud '
            + 'service credential to enumerate private org packages, so it is a runtime-side proxy by construction rather '
            + 'than an SDK call the browser could make itself.',
    },

    // ── offline / local install (cloud ADR-0009) ────────────────────────
    // The one family with a measured NON-browser consumer: the CLI builds
    // these URLs directly (`packages/cli/src/commands/package/install.ts:170`,
    // `${runtime}/api/v1/marketplace/install-local`). That is the evidence the
    // `server-only` claim rests on — a named caller that is not the SDK.
    {
        route: 'POST /api/v1/marketplace/install-local',
        family: 'marketplace-install-local',
        mountedIn: 'marketplace-install-local-plugin.ts',
        disposition: 'server-only',
        note:
            'installs a marketplace package into THIS kernel and caches the manifest to disk. Who builds this URL instead, '
            + 'measured: `packages/cli/src/commands/package/install.ts:170` composes it directly against the runtime base, '
            + 'and the Console\'s "Installed Apps" view calls it same-origin. Gated on `manage_metadata` (#8976). No '
            + '`@objectstack/client` method builds it.',
    },
    {
        route: 'GET /api/v1/marketplace/install-local',
        family: 'marketplace-install-local',
        mountedIn: 'marketplace-install-local-plugin.ts',
        disposition: 'server-only',
        note:
            'lists locally installed marketplace packages. Requires an authenticated principal (anonymous → 401), and '
            + '`installedBy` / `storageDir` are served only to a `manage_metadata` holder (#9011) — a per-principal '
            + 'projection the SDK does not model. Consumed by the CLI and the Console\'s Installed Apps view, not by any '
            + 'client method.',
    },
    {
        route: 'DELETE /api/v1/marketplace/install-local/:manifestId',
        family: 'marketplace-install-local',
        mountedIn: 'marketplace-install-local-plugin.ts',
        disposition: 'server-only',
        note:
            'removes the cached manifest from this runtime\'s disk; the kernel must restart to fully unload, since '
            + '`engine.registerApp` is additive only. A filesystem-mutating, restart-coupled operation local to one runtime '
            + 'is deliberately not SDK surface — the CLI and the Console Setup view drive it. Requires `manage_metadata` (#8976).',
    },
    {
        route: 'POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data',
        family: 'marketplace-install-local',
        mountedIn: 'marketplace-install-local-plugin.ts',
        disposition: 'server-only',
        note:
            'replays a packaged app\'s sample-data seed into this runtime — a local development/demo affordance behind '
            + '`manage_metadata` (#8976), driven from the Console\'s Installed Apps view. Not modelled by any client method, '
            + 'and not a shape an application SDK should be able to trigger against a remote environment.',
    },
    {
        route: 'POST /api/v1/marketplace/install-local/:manifestId/purge-sample-data',
        family: 'marketplace-install-local',
        mountedIn: 'marketplace-install-local-plugin.ts',
        disposition: 'server-only',
        note:
            'the destructive mirror of reseed: drops the packaged app\'s seeded rows from this runtime. Behind '
            + '`manage_metadata` (#8976) and driven from the Console. No `@objectstack/client` method builds this URL, and '
            + 'a bulk data-purge door is deliberately not something the application SDK exposes.',
    },

    // ── marketplace browse passthrough ─────────────────────────────────
    {
        route: 'ALL /api/v1/marketplace/*',
        family: 'marketplace-proxy',
        mountedIn: 'marketplace-proxy-plugin.ts',
        disposition: 'public',
        note:
            'forwards marketplace browse to the configured control plane. `public` and not `server-only` because it is '
            + 'exactly what that word means here — an anonymous BROWSER surface: the cloud catalog endpoint is '
            + 'unauthenticated (it exposes only `sys_package.marketplace_listed = true` packages) and this proxy "passes '
            + 'through without any credentials", in the plugin header\'s own words. It exists so the Console SPA stays on '
            + 'the tenant origin and needs no CORS on the cloud side. Ledgered rather than waved through as a lane: an '
            + '`.all()` that ANSWERS requests is a route, per the trigger-api precedent (#11863); the auth ledger\'s '
            + 'catch-all exclusion covers a `.all()` that DELEGATES to a vendor router, which this does not.',
    },

    // ── boot-time runtime configuration ────────────────────────────────
    {
        route: 'GET /api/v1/runtime/config',
        family: 'runtime-config',
        mountedIn: 'runtime-config-plugin.ts',
        disposition: 'public',
        note:
            'the anonymous boot-time read that tells the Console/Studio SPA its cloud URL, capability flags, branding and '
            + 'telemetry posture. Unauthenticated by construction — grepped for a session/principal/401 gate in this plugin '
            + 'and there is none, because the SPA must read it BEFORE it can authenticate. An SDK method here would be '
            + 'circular: this payload is what a client needs in order to know where to point, so it cannot be fetched '
            + 'through a configured client.',
    },
    {
        route: 'GET /api/v1/studio/runtime-config',
        family: 'runtime-config',
        mountedIn: 'runtime-config-plugin.ts',
        disposition: 'public',
        note:
            'legacy alias for older Studio bundles, mounted with the SAME handler instance as `/api/v1/runtime/config` — '
            + 'identical payload, identical anonymous posture. Ledgered as its own row because it is its own wire path: a '
            + 'census that folded aliases into their canonical sibling would stop reporting the day one of them moved.',
    },
];
