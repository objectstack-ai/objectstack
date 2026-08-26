// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * metadata route ledger — the audited disposition of every HTTP route this
 * package mounts on the host app's framework-native handle, against what
 * `@objectstack/client` can express (#11882, in the #3636 / #11863 pattern).
 *
 * WHY THIS EXISTS. `MetadataPlugin.start()` resolves the
 * `http.server`/`http-server` service, takes the Hono handle through
 * `getRawApp()`, and hands it to `registerMetadataHmrRoutes()`
 * (`plugin.ts:485`), which registers the HMR endpoints straight on it. That
 * mount is outside every ledger the platform had, and outside the reach of the
 * #7526 live-mount parity gate as well: that gate reads
 * `IHttpServer.getMountedRoutes()`, and "routes an adapter mounts on its
 * framework-native handle behind `getRawApp` are outside this table by
 * construction" — the contract's own words
 * (`packages/spec/src/contracts/http-server.ts`). These two routes are not "not
 * yet found" by it; they are UNFINDABLE by it. Per-package ledgers (#3636) are
 * the only instrument that reaches them.
 *
 * SCOPE, re-derived on `origin/main` @ 2ba4329e rather than inherited from the
 * filing: two routes, one registrar module, one wire path served by both verbs.
 *
 * BOTH ROWS ARE NOW CONDITIONAL, and the condition is part of each row's
 * disposition rather than a footnote to it (#12140). `registerMetadataHmrRoutes`
 * refuses to mount anything unless the process runs an explicit
 * `NODE_ENV=development` posture, so on every production-shaped boot this
 * package's mounted-route census is EMPTY. A census that describes what is
 * mounted has to say when: this ledger describes the development posture, which
 * is the only posture in which either route exists. The conformance guard reads
 * SOURCE TEXT rather than a live mount (see its header for why), so it keeps
 * accounting for both rows on either side of the gate — the gate changes what a
 * running server serves, not what this module mounts on the line the scan reads.
 *
 * THE PATH HAS A CONFIGURABLE SEAM, AND IT IS UNUSED. `registerMetadataHmrRoutes`
 * accepts `options.path` and falls back to `/api/v1/dev/metadata-events`
 * (`routes/hmr-routes.ts:163`). Both rows below carry the DEFAULT, and that is
 * exact rather than approximate, because the seam is unreachable from outside
 * this package: `registerMetadataHmrRoutes` is not re-exported from `index.ts`
 * or `node.ts`, and its sole in-repo caller — `plugin.ts:485` — passes no
 * options at all. The guard asserts both halves, so the day the seam is
 * exported or a caller starts passing a path, these rows stop being the whole
 * truth loudly rather than quietly.
 *
 * WHY NEITHER ROW IS `sdk`, measured rather than assumed. `@objectstack/client`
 * was grepped for `metadata-events`: zero hits. No client method builds this
 * URL. That is the #11882 audit's finding for this package, and the guard
 * asserts it as a measurement rather than letting the `sdk`-row hygiene rule
 * hold vacuously.
 *
 * The live half of that measurement is enforced next door BY OMISSION: this
 * ledger is deliberately NOT one of `client-url-conformance.test.ts`'s union
 * inputs, so a client method that started calling this route would fail there
 * for matching no ledger row at all.
 *
 * This module is package-internal (not exported from `index.ts`): it is the
 * guard's data, not public API — nothing imports it into the bundle, so the
 * published surface of `@objectstack/metadata` is unchanged. It must stay
 * import-free.
 */

/** Disposition of a single metadata route. Same vocabulary as the REST ledger. */
export type MetadataRouteDisposition =
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

export interface MetadataRouteLedgerEntry {
    /** `VERB /api/v1/...` — the full wire path, verbatim as mounted. */
    route: string;
    /** Registrar family, for grouping and diff messages. */
    family: string;
    /** The `src/`-relative file whose mount call produced this row. */
    mountedIn: string;
    disposition: MetadataRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /**
     * Name of the `@objectstack/spec/api` export declaring this route's response
     * PAYLOAD.
     *
     * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE — the same rule the
     * REST, storage and datasource ledgers carry (#3877). A name written ahead
     * of the test it points at would BE the "declared but unverified" surface
     * the programme exists to remove. Both rows below are unfilled: the SSE
     * stream emits `event:`-framed JSON rather than the `{ success, data }`
     * envelope, and no schema export declares either payload.
     */
    responseSchema?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const METADATA_ROUTE_LEDGER: readonly MetadataRouteLedgerEntry[] = [
    // ── metadata HMR (dev preview loop) ────────────────────────────────
    {
        route: 'GET /api/v1/dev/metadata-events',
        family: 'metadata-hmr',
        mountedIn: 'routes/hmr-routes.ts',
        disposition: 'public',
        note:
            'a Server-Sent Events stream that pushes `metadata-change` / `reload` frames to Studio so an agent edit '
            + 'refreshes the preview without a manual reload. `public` because that is what the word means here — an '
            + 'anonymous browser surface: grepped for a session/principal/401 gate in `routes/hmr-routes.ts` and there is '
            + 'none. Not SDK surface: the consumer is an EventSource in the Studio shell, and `@objectstack/client` models '
            + 'request/response calls, not long-lived SSE subscriptions (its realtime channel is a separate transport). '
            + 'Zero hits for `metadata-events` anywhere in the client package. POSTURE (#12140): `public` is scoped by an '
            + 'environment gate — the registrar mounts this route only under an explicit `NODE_ENV=development`, so the '
            + 'anonymous surface exists on a dev workstation and on no production-shaped boot. It stays anonymous WHEN '
            + 'mounted, deliberately: the consumer is an EventSource, which cannot set an `Authorization` header, and the '
            + 'gate rather than a credential is what bounds who can reach it. Worth naming because the frames carry a '
            + '`path` field holding a server-side filesystem path.',
    },
    {
        route: 'POST /api/v1/dev/metadata-events',
        family: 'metadata-hmr',
        mountedIn: 'routes/hmr-routes.ts',
        disposition: 'server-only',
        note:
            'the manual reload trigger an external watch-recompile pipeline posts to after rebuilding the artifact — the '
            + 'package header names the caller: `os dev` watching TS sources. Who builds this URL instead, measured: the '
            + 'CLI, not the SDK (`packages/cli/src/commands/dev.ts:553` documents the endpoint as the one it drives). A '
            + 'build-tool loopback is deliberately not application SDK surface. POSTURE, recorded because a ledger row is '
            + 'where it becomes reviewable — and CHANGED by #12140, so this row moved with it. What this row used to say: '
            + 'the door carried no authentication and MetadataPlugin applied no environment gate of its own, mounting it '
            + 'whenever a raw-app-capable HTTP server was present, while the only `isDev` guard in the tree sat on the '
            + 'CLI\'s SUPPLEMENTARY composition in `serve.ts` and never reached this mount. That was measured to be '
            + 'reachable rather than theoretical: the official image runs `os start` under `NODE_ENV=production`, that '
            + 'boot reaches `createStandaloneStack`, and the stack composes MetadataPlugin unconditionally onto a kernel '
            + 'that registers the Hono server whenever it serves. What it says now: `registerMetadataHmrRoutes` mounts '
            + 'nothing and returns `null` unless `NODE_ENV` is exactly `development` (unset reads as production, per the '
            + 'maintainer\'s 2026-08-06 ruling), so this write-shaped door exists only on a boot that declared itself a '
            + 'development one. Still no authentication WHEN mounted, and that is the deliberate half: an environment gate '
            + 'closes the door instead of putting a lock on it, because promoting a build-tool loopback into an '
            + 'authenticated production surface would widen what this endpoint is rather than harden it.',
    },
];
