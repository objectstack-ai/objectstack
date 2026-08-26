// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cli console route ledger — the audited disposition of every HTTP route this
 * package mounts on the host app's framework-native handle (#11882, in the
 * #3636 / #11863 pattern).
 *
 * WHY THIS EXISTS. Both plugin factories in `utils/console.ts` resolve the HTTP
 * server, take the Hono handle through `getRawApp()`, and register straight on
 * it. Those mounts are outside every ledger the platform had, and outside the
 * reach of the #7526 live-mount parity gate as well: that gate reads
 * `IHttpServer.getMountedRoutes()`, and "routes an adapter mounts on its
 * framework-native handle behind `getRawApp` are outside this table by
 * construction" — the contract's own words
 * (`packages/spec/src/contracts/http-server.ts`).
 *
 * ## WHY THIS LEDGER HAS A SIXTH DISPOSITION, AND WHY THAT IS NOT A DISTORTION
 *
 * This is the family #11882 singled out. The routing comment on that card
 * (2026-08-24) and the card body both flag it: these rows are **static-asset
 * serving, not API surface**. None of the five words the REST-ledger vocabulary
 * carries describes them truthfully, and the nearest one is actively
 * misleading:
 *
 *   - `sdk`         — false. No client method builds these URLs, and none should.
 *   - `gap`         — false, and it is the WRONG KIND of false: `gap` means
 *                     "should be in the SDK and is not", and it is ratcheted to
 *                     <= 0 across this programme. Filing a static file server as
 *                     a gap would assert that `@objectstack/client` ought to
 *                     grow a method for fetching `index.html`, and would reverse
 *                     a ratchet to say it.
 *   - `server-only` — false. That word means an inbound integration door or a
 *                     loopback (webhooks, HMAC-token reads). These are the
 *                     opposite: outbound bytes to a browser.
 *   - `public`      — TRUE but insufficient, and this is the trap. These routes
 *                     ARE anonymous and browser-facing, so `public` is the
 *                     nearest allowed word — which is exactly why it is the
 *                     wrong one to reach for. It would file a static file
 *                     server alongside genuine anonymous API endpoints like
 *                     `GET /api/v1/runtime/config`, and a reader auditing the
 *                     platform's unauthenticated API surface would find four
 *                     rows here that are not API at all. The peer group is the
 *                     discriminator (`check-auth-mount-ledger.mjs`'s rule), and
 *                     these routes' peer group is a CDN, not an endpoint.
 *
 * `check-auth-mount-ledger.mjs` states the governing rule for precisely this
 * situation: *"IF YOU CANNOT DECIDE, DO NOT PICK THE NEAREST ALLOWED WORD."*
 * Here the disposition is not undecided — the card, the routing comment and the
 * source all agree on what these are — so this ledger says it in a word that is
 * true: `static-asset`. The precedent that a per-package ledger may extend the
 * vocabulary when the shared words are false is `plugin-auth`, whose
 * `AUTH_ROUTE_LEDGER` carries a sixth disposition of its own (`disabled`).
 *
 * The extension is deliberately CONTAINED: this type is package-local, so it
 * cannot widen the vocabulary any other ledger is read against, and the guard
 * asserts that `static-asset` is used ONLY for routes that serve bytes off
 * disk — a word that could be reached for by an API route would just be a new
 * parking space.
 *
 * SCOPE, re-derived on `origin/main` @ 2ba4329e rather than inherited from the
 * filing: four routes across two plugin factories, both in `utils/console.ts`,
 * which the guard confirms is the ONLY file in this package's 109 sources that
 * mounts a route at all.
 *
 * This module is package-internal: it is the guard's data, not public API, and
 * `@objectstack/cli` is a binary rather than a consumed library surface. It
 * must stay import-free.
 */

/**
 * Disposition of a single cli-mounted route. The five REST-ledger words, plus
 * `static-asset` — see the header for why the five cannot express this family.
 */
export type ConsoleRouteDisposition =
    /** Expressed by the SDK — `client` names the method (dotted path). */
    | 'sdk'
    /** Should be in the SDK and is not — an open, acknowledged gap. */
    | 'gap'
    /** Deliberately not SDK surface (inbound integration doors, loopbacks). */
    | 'server-only'
    /** Public, unauthenticated browser-facing API route. */
    | 'public'
    /** Server and client disagree on the shape — needs reconciliation. */
    | 'mismatch'
    /**
     * Not API surface at all: serves bytes off disk (or redirects to something
     * that does). An SDK method here would be a category error, so this word
     * records a reviewed NON-question rather than a deferred one.
     */
    | 'static-asset';

export interface ConsoleRouteLedgerEntry {
    /** `VERB /path` — the full wire path, verbatim as mounted. */
    route: string;
    /** Registrar family (the plugin factory that mounts it). */
    family: string;
    /** The `src/`-relative file whose mount call produced this row. */
    mountedIn: string;
    disposition: ConsoleRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /**
     * True when the mount is guarded by a condition rather than unconditional.
     * Recorded because the census reads SOURCE: it sees the mount call, not the
     * branch around it, and a row that silently implied "always mounted" would
     * overstate the surface.
     */
    conditional?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const CONSOLE_ROUTE_LEDGER: readonly ConsoleRouteLedgerEntry[] = [
    // ── console SPA static serving (createConsoleStaticPlugin) ─────────
    {
        route: 'GET /',
        family: 'console-static',
        mountedIn: 'utils/console.ts',
        disposition: 'static-asset',
        conditional: 'options.rootRedirect !== false (default: mounted)',
        note:
            'redirects the site root to `/_console/`. The Console is the default end-user surface, so claiming `/` is the '
            + 'intended behaviour in both dev and production once the Console is mounted at all; `os serve` gates whether '
            + 'it mounts via `--no-console` / `OS_DISABLE_CONSOLE=1`. Not API surface — a redirect to a static bundle. '
            + 'CONDITIONAL, and the ledger says so because the census reads the mount call and cannot see the branch.',
    },
    {
        route: 'GET /_console',
        family: 'console-static',
        mountedIn: 'utils/console.ts',
        disposition: 'static-asset',
        note:
            'redirects the bare mount path to its trailing-slash form, the ordinary SPA convention — the Console is built '
            + 'with `base: \'/_console/\'`, so relative asset URLs only resolve from the slashed path. Pure navigation '
            + 'plumbing for a static bundle; there is nothing here for an SDK to express.',
    },
    {
        route: 'GET /_console/*',
        family: 'console-static',
        mountedIn: 'utils/console.ts',
        disposition: 'static-asset',
        note:
            'serves the pre-built Console SPA verbatim from `dist/`, with HTML entry points routed through base-tag '
            + 'injection and an SPA fallback for client-side routes. Reads files off disk behind a path-traversal guard '
            + '(any resolved path escaping `dist/` is refused 403). A file server, not an endpoint: its peer group is a '
            + 'CDN origin, so no client method builds these URLs and none should.',
    },

    // ── runtime asset serving (second factory in the same module) ──────
    {
        route: 'GET /runtime/assets/:filename',
        family: 'runtime-assets',
        mountedIn: 'utils/console.ts',
        disposition: 'static-asset',
        note:
            'serves individual build assets off disk by filename, behind two guards: separators are stripped from the '
            + 'parameter and any resolved path escaping the assets directory is refused 403. Sent with a one-hour '
            + '`cache-control`, which is the tell that this is CDN-shaped rather than API-shaped. A distinct family from '
            + '`console-static` because it is a separate plugin factory with its own dist root and its own mount guard.',
    },
];
