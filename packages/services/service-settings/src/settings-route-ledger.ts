// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings route ledger — the audited disposition of every HTTP route
 * `SettingsServicePlugin` mounts (#7526, closing the largest unledgered live
 * mount the route-ledger ↔ live-mount parity gate measured).
 *
 * WHY THIS EXISTS. Same shape as tranche 3 (`service-storage`,
 * `service-i18n`): this plugin reaches for the `http-server` service and
 * registers straight on `IHttpServer`, so neither the dispatcher ledger nor
 * the REST ledger has ever seen these four routes and nothing anywhere
 * recorded a disposition for them. They were found the only way an unledgered
 * mount CAN be found — by reading the live mount table off a booted server and
 * asking which rows nobody claims (PENDING-GAPS §E; the gate is
 * `packages/qa/dogfood/test/route-ledger-live-mount-parity.dogfood.test.ts`).
 *
 * WHAT GUARDS IT. That parity gate, in both directions: a row here whose
 * route the plugin stops mounting fails it, and a fifth route mounted without
 * a row here fails it too. Deliberately NOT a fifth per-package conformance
 * test — the sibling ledgers each grew one because nothing else could see
 * their registrar, and the gate now can. A second guard over the same fact
 * would be the "two places to remember" shape this issue is about.
 *
 * SCOPE & SHAPE. Rows carry full wire paths at the DEFAULT base
 * (`/api/settings` — note NOT under `/api/v1`; this surface predates the
 * versioned prefix and `SettingsRoutesOptions.basePath` can move the family).
 * The gate enumerates a boot that leaves the default in place.
 *
 * NOT SDK SURFACE, all four. `@objectstack/client` expresses no settings
 * method: the consumer is the Setup/admin UI over plain HTTP, and the values
 * here are deployment configuration (mail credentials, storage drivers, SMS
 * providers) rather than application data. That is a `server-only` disposition
 * and not a `gap` — a gap row is an acknowledged debt with an owner, and
 * nothing has ever asked the SDK for this.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the gate imports it
 * as a relative SOURCE file.
 */

/** Disposition of a single settings route. Same vocabulary as the REST ledger. */
export type SettingsRouteDisposition =
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

export interface SettingsRouteLedgerEntry {
  /** `VERB /api/settings/...` — full wire path at the default base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: SettingsRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const SETTINGS_ROUTE_LEDGER: readonly SettingsRouteLedgerEntry[] = [
  { route: 'GET /api/settings', family: 'settings', disposition: 'server-only',
    note: 'manifests the caller may see, filtered by their capabilities (ADR-0007 §REST) — the Setup UI\'s namespace index' },
  { route: 'GET /api/settings/:namespace', family: 'settings', disposition: 'server-only',
    note: 'one namespace as { manifest, values }; secret-typed keys come back masked' },
  { route: 'PUT /api/settings/:namespace', family: 'settings', disposition: 'server-only',
    note: 'batch upsert of one namespace, validated against its manifest; refuses locked keys' },
  { route: 'POST /api/settings/:namespace/:actionId', family: 'settings', disposition: 'server-only',
    note: 'invoke an action the namespace manifest declares (test-connection probes and the like), not a data write' },
];
