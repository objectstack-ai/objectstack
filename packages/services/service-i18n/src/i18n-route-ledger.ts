// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n route ledger — the audited disposition of every HTTP route
 * `I18nServicePlugin` mounts, against what `@objectstack/client` can express
 * (#3636, tranche 3 of the #3563 audit).
 *
 * WHY THIS EXISTS. Like `service-storage`, this plugin reaches for the
 * `http-server` service at `kernel:ready` and registers straight on
 * `IHttpServer`, so neither the dispatcher ledger nor the REST ledger has ever
 * seen these routes. The dispatcher ledger DOES carry three `/i18n/*` rows —
 * but those guard the dispatcher's own mounts, and its guard only asks whether
 * the named client method EXISTS. It never asked whether the client speaks a
 * URL shape any server actually mounts, which is precisely what this tranche
 * caught: `i18n.getTranslations` and `i18n.getFieldLabels` shipped the
 * `?locale=` query dialect while every serving surface — this plugin, the
 * dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts` contract — mounts
 * only the path form. Both were 404s on the wire. Fixed in #3636 by moving the
 * client to the path dialect, the same resolution #3611 gave `meta.getView`.
 *
 * `i18n-route-ledger.conformance.test.ts` fails when a route appears with no
 * ledger entry, and when an entry names a route the plugin no longer mounts.
 * The client half lives in
 * `packages/client/src/service-route-ledger-coverage.test.ts` (no
 * service→client package edge, per the tranche-1 lesson).
 *
 * SCOPE & SHAPE. Rows carry full wire paths at the DEFAULT base
 * (`/api/v1/i18n`); `I18nServicePluginOptions.basePath` can move the family,
 * and the conformance test enumerates at the same default. The whole family is
 * behind the `registerRoutes` option (default on) — when a host turns it off,
 * the dispatcher's `/i18n` domain still serves the same three shapes, which is
 * why route registration stays multi-provider.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the client-side
 * guard imports it as a relative SOURCE file.
 */

/** Disposition of a single i18n route. Same vocabulary as the REST ledger. */
export type I18nRouteDisposition =
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

export interface I18nRouteLedgerEntry {
  /** `VERB /api/v1/i18n/...` — full wire path at the default base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: I18nRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const I18N_ROUTE_LEDGER: readonly I18nRouteLedgerEntry[] = [
  { route: 'GET /api/v1/i18n/locales', family: 'i18n', disposition: 'sdk', client: 'i18n.getLocales' },
  { route: 'GET /api/v1/i18n/translations/:locale', family: 'i18n', disposition: 'sdk', client: 'i18n.getTranslations',
    note: 'was a wire-level 404 — the client sent /translations?locale=xx, a shape no server mounts (the dispatcher domain body accepts it, but nothing routes a bare /translations to that body). Since #3636 the client sends the path form the spec declares.' },
  { route: 'GET /api/v1/i18n/labels/:object/:locale', family: 'i18n', disposition: 'sdk', client: 'i18n.getFieldLabels',
    note: 'ditto — the client sent /labels/:object?locale=xx against a two-path-param mount (#3636).' },
];
