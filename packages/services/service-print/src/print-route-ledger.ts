// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Print route ledger — the audited disposition of every HTTP route
 * `registerPrintRoutes` (`print-routes.ts`) mounts.
 *
 * WHY THIS EXISTS. `PrintServicePlugin` reaches for the `http-server` service
 * and registers straight on `IHttpServer`, so neither the dispatcher ledger nor
 * the REST ledger sees its route, the same shape as the storage and settings
 * families. `print-route-ledger.conformance.test.ts` fails when the registrar
 * mounts a route with no row here, and when a row names a route it no longer
 * mounts; the dogfood live-mount parity gate reads this ledger beside the
 * others on a real boot.
 *
 * NOT SDK SURFACE. `@objectstack/client` expresses no print method: the
 * consumer is the console, through an app's declared `type: 'api'` action
 * whose `target` is the route. That is a `server-only` disposition.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single print route. Same vocabulary as the REST ledger. */
export type PrintRouteDisposition =
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

export interface PrintRouteLedgerEntry {
  /** `VERB /api/v1/print/...` — the full wire path. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: PrintRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const PRINT_ROUTE_LEDGER: readonly PrintRouteLedgerEntry[] = [
  { route: 'POST /api/v1/print/records', family: 'print', disposition: 'server-only',
    note: "print a record's print page to a PDF as the caller and archive it on the record; called by a declared type:'api' console action" },
];
