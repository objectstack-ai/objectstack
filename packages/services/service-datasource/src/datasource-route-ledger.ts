// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Datasource-admin route ledger — the audited disposition of every HTTP route
 * `registerDatasourceAdminRoutes` mounts, against what `@objectstack/client`
 * can express (#7744, tranche 3 of the #3563 audit).
 *
 * WHY THIS EXISTS. This family had no ledger anywhere. The three ledgers that
 * came before it each stop at their own package boundary, and this surface is
 * outside all of them:
 *
 *  - the dispatcher ledger (`packages/runtime/src/route-ledger.ts`) sees
 *    `RouteManager` routes;
 *  - the REST ledger (`packages/rest/src/rest-route-ledger.ts`) sees whatever
 *    `RestServer.getRoutes()` reports — its own routes plus the direct-mount
 *    registrars `mountAndRecordDirectRoutes` composes, and
 *    `registerDatasourceAdminRoutes` is not one of them;
 *  - `service-storage` and `service-i18n` carry their own ledgers (#3636)
 *    precisely because a service that reaches for the `http-server` service and
 *    registers straight on `IHttpServer` is invisible to both of the above.
 *
 * These routes are mounted that third way: `objectstack serve` builds a tiny
 * `com.objectstack.cli.datasource-admin-routes` plugin whose `init()` resolves
 * `http.server` and calls `registerDatasourceAdminRoutes(httpServer, ctx,
 * '/api/v1')` (`packages/cli/src/commands/serve.ts`). So the whole Setup →
 * Datasources backend — list, read, create, patch, remove, probe, driver
 * catalog, schema introspection — sat in the pre-#3563 posture: mounted,
 * working, and guarded by nothing.
 *
 * WHAT #7744 ACTUALLY FOUND, and what it is NOT. The REST ledger carries five
 * `datasources` rows and every one of them is the FEDERATION family, spelled
 * `/api/v1/datasources/:name/external/…`. Read quickly that looks like the
 * admin family under a different name, and "reconcile the spelling" looks like
 * the fix. It is not: the two spellings are different mounted routes, in
 * different packages, and BOTH are live. Two of them do overlap —
 * `GET /:name/remote-tables` here and `GET /:name/external/tables` there both
 * reach `IExternalDatasourceService.listRemoteTables`, as do
 * `POST /:name/object-draft` and `POST /:name/external/tables/:remote/draft`
 * over `generateObjectDraft`. That overlap is known and was deliberately
 * reconciled rather than removed: #4249 gave the two paths ONE failure contract
 * ("One operation, one failure contract now, on both paths",
 * `packages/rest/src/external-datasource-routes.ts`), and #7955 finished the
 * other half of that same principle on the REQUEST path — the admin spelling
 * had never read `?schema=`, so the filter the federation twin honoured came
 * back silently unapplied here. Both spellings now forward it, with the same
 * coercion, pinned across the two packages by
 * `packages/rest/src/remote-tables-twin.equivalence.test.ts`. A ledger describes what is
 * mounted; renaming a live route to close a bookkeeping gap would be an API
 * break performed for the bookkeeping's benefit. So every row below carries the
 * spelling the mount actually uses, and the conformance test derives its
 * expectations from the registrar rather than from a literal copied into the
 * test.
 *
 * `datasource-route-ledger.conformance.test.ts` fails when a route appears with
 * no ledger entry, and when an entry names a route the registrar no longer
 * mounts. The client half — every `sdk` row resolving to a real method — lives
 * in `packages/client/src/service-route-ledger-coverage.test.ts`, next to the
 * SDK it introspects, for the tranche-1 build-cycle reason: a service→client
 * package edge would be backwards.
 *
 * SCOPE & SHAPE. Rows carry full wire paths at the DEFAULT base (`/api/v1`) —
 * `registerDatasourceAdminRoutes`' third parameter can move the family, and the
 * conformance test enumerates at the same default so the two stay comparable.
 *
 * WHY EVERY ROW IS `server-only`. Audited at #7744: `ObjectStackClient`'s
 * `datasources` namespace contains exactly one sub-namespace, `external`, whose
 * five methods reach the FEDERATION family in `packages/rest` — no client
 * method reaches any route in this file, and neither does the CLI (its three
 * `datasource` commands all call `/external/*`). That is consistent with how
 * the family is composed: it is mounted by `objectstack serve`, not by
 * `@objectstack/rest`, and its consumers are the Setup/Studio console and one
 * declared metadata-type action (`test_connection`, contributed by
 * `DatasourceAdminServicePlugin.init()` with
 * `target: '/api/v1/datasources/${ctx.recordId}/test'`). Whether the SDK SHOULD
 * gain a datasource-lifecycle surface is a product decision, and inventing one
 * here — by writing ten `gap` rows — would be making that decision inside a
 * bookkeeping fix. It is filed as #7954 instead; promoting any row to `sdk`
 * belongs in the PR that adds the method.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the client-side
 * guard imports it as a relative SOURCE file.
 */

/** Disposition of a single datasource-admin route. Same vocabulary as the REST ledger. */
export type DatasourceRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface (console/Setup backends, static catalogs). */
  | 'server-only'
  /** Public, unauthenticated browser-facing route. */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface DatasourceRouteLedgerEntry {
  /** `VERB /api/v1/datasources/...` — full wire path at the default base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  disposition: DatasourceRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /**
   * Name of the `@objectstack/spec/api` export declaring this route's response
   * PAYLOAD — the `data` of the shared `{ success, data }` envelope.
   *
   * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE — the same rule the
   * REST and storage ledgers carry (#3877). A name written ahead of the test it
   * points at would BE the "declared but unverified" surface the programme
   * exists to remove. Every row here is unfilled today: the family's envelope
   * coverage (`__tests__/envelope.conformance.test.ts`) asserts the ENVELOPE,
   * not a payload schema, so no row has earned the field yet.
   *
   * A NAME rather than a live schema object, deliberately: this module stays
   * import-free — the client-side guards compile it as a relative SOURCE file.
   */
  responseSchema?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const DATASOURCE_ROUTE_LEDGER: readonly DatasourceRouteLedgerEntry[] = [
  // ── runtime datasource lifecycle (ADR-0015 Addendum §3.5) ─────────────────
  // Served by `datasource-admin`; 503 SERVICE_UNAVAILABLE when that service is
  // not wired, 400 DATASOURCE_ADMIN_ERROR on a refusal (#4249).
  { route: 'GET /api/v1/datasources', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'Setup → Datasources list: provenance (code/runtime) + the retained connect verdict per datasource (#3827). Console surface; the SDK expresses no datasource-lifecycle method.' },
  { route: 'GET /api/v1/datasources/:name', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'edit-form read, credential-stripped (`config` plus a `hasSecret` flag, never `credentialsRef`). Console surface. Registered AFTER the literal `/drivers` route so that segment is never captured as a name.' },
  { route: 'POST /api/v1/datasources', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'wizard "Save" — creates an `origin: runtime` datasource and answers 201 with the summary. Console surface.' },
  { route: 'PATCH /api/v1/datasources/:name', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'wizard edit; runtime-origin only (a code-defined datasource is read-only). Console surface.' },
  { route: 'DELETE /api/v1/datasources/:name', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'wizard delete; runtime-origin only, and refused while objects are still bound. Answers 204 with no body — the one route in this family outside the `{ success, data }` envelope, deliberately. Console surface.' },
  { route: 'POST /api/v1/datasources/test', family: 'datasource-lifecycle', disposition: 'server-only',
    note: 'probes an UNSAVED draft carried inline (with an optional cleartext `secret` that never reaches the persisted draft) — the wizard\'s "Test connection" before Save. Console surface. Registered before the `:name` routes so the literal `test` segment is never captured as a name.' },

  // ── driver catalog ────────────────────────────────────────────────────────
  { route: 'GET /api/v1/datasources/drivers', family: 'driver-catalog', disposition: 'server-only',
    note: 'static `DRIVER_CATALOG` + each driver\'s JSON-Schema config; drives the Studio connection form (`packages/spec/src/data/datasource.zod.ts`). Needs no service, so it answers on every boot — the one route here that never degrades to 503.' },

  // ── schema introspection for the Studio "sync objects" flow ───────────────
  // Served by `external-datasource`, so a refusal is EXTERNAL_DATASOURCE_ERROR
  // and the 503 names that service rather than `datasource-admin` (#4225/#4249).
  { route: 'GET /api/v1/datasources/:name/remote-tables', family: 'datasource-introspection', disposition: 'server-only',
    note: 'lists a datasource\'s remote tables, optionally narrowed by `?schema=`. The #7744 row: this is the LIVE admin spelling, and it is a different mounted route from the federation twin `GET /:name/external/tables` in packages/rest, which the REST ledger carries as `datasources.external.listTables`. Both reach `listRemoteTables`, share one failure contract by design (#4249) and — since #7955 — one request shape; only the federation twin is SDK-expressed.' },
  { route: 'POST /api/v1/datasources/:name/object-draft', family: 'datasource-introspection', disposition: 'server-only',
    note: 'generates an ObjectStack object draft for one remote table (introspect + type-map, no persistence). Federation twin: `POST /:name/external/tables/:remote/draft` — same `generateObjectDraft` operation, and the twin is the SDK-expressed one (`datasources.external.draft`).' },
  { route: 'POST /api/v1/datasources/:name/test', family: 'datasource-introspection', disposition: 'server-only',
    note: 'live round-trip against a SAVED datasource by name — distinct from `POST /datasources/test`, which probes an unsaved draft. This is the target of the declared `datasource` `test_connection` metadata-type action, contributed by DatasourceAdminServicePlugin.init(); the console renders the button from `/api/v1/meta`, so the caller is the action, not the SDK.' },
];
