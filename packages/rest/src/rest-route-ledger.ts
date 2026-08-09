// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST route ledger — the audited disposition of every HTTP route
 * `@objectstack/rest` mounts, against what `@objectstack/client` can express
 * (#3587, tranche 2 of the #3563 audit).
 *
 * WHY THIS EXISTS. The dispatcher tranche (#3569…#3579) closed its 27 gaps and
 * guards them; but the REST server mounts a second, LARGER surface the client
 * also reaches, and until this file it had never been audited — the exact
 * structural risk that shipped #3528 (a working route the SDK could not call,
 * with nothing failing). `rest-route-ledger.conformance.test.ts` fails when a
 * REST route appears with no ledger entry, and when an entry claims a client
 * method that does not exist (client half:
 * `packages/client/src/rest-route-ledger-coverage.test.ts`). A new REST route
 * therefore lands with an explicit, reviewed disposition or not at all.
 *
 * SCOPE & SHAPE. Rows carry full wire paths at the DEFAULT unscoped base
 * (`/api/v1`), exactly as `RestServer.getRoutes()` reports them — unlike the
 * dispatcher ledger, which uses dispatcher-internal cleanPath patterns. When
 * project scoping is on, every row is additionally mirrored under
 * `/api/v1/environments/:environmentId` (rest-server.ts registerRoutes); the
 * mirror is a mechanical duplication and is deliberately not re-ledgered.
 *
 * SOURCES. Both are enumerable through `RestServer.getRoutes()`, and since
 * #5822 that is the ONLY enumeration the conformance test runs. `route-manager`
 * rows are the ones this server registered itself; `direct-mount` rows come
 * from the two registrars that bypass RouteManager and register straight on
 * `IHttpServer` (`package-routes.ts`, `external-datasource-routes.ts`), which
 * now return what they mounted so the composition step can record it (see
 * `direct-mount.ts`). Each mounted route reports its own `source`, so the two
 * halves of this ledger stay audited separately from one table. Before that,
 * the direct-mount half was enumerated by capturing a mock server's
 * registration calls — a second enumeration that guarded the ledger but left
 * the routes out of `/openapi.json` and every other runtime introspection.
 *
 * NOT COVERED HERE (the third surface): services that autonomously mount
 * routes on the host `IHttpServer` — `service-storage` (`storage-routes.ts`,
 * the SDK's whole storage surface) and `service-i18n`. Those live outside
 * `@objectstack/rest` and carry their own per-package ledgers + guards since
 * #3636 (tranche 3): `packages/services/service-storage/src/storage-route-ledger.ts`
 * and `packages/services/service-i18n/src/i18n-route-ledger.ts`. All three
 * surfaces the SDK reaches are now ledgered.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It must stay import-free — the client-side
 * guard imports it as a relative SOURCE file.
 */

/** Disposition of a single REST route. Same vocabulary as the dispatcher ledger. */
export type RestRouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface (docs pages, machine-readable spec, aliases). */
  | 'server-only'
  /** Public, unauthenticated browser-facing route (anonymous forms etc.). */
  | 'public'
  /** Server and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface RestRouteLedgerEntry {
  /** `VERB /api/v1/...` — full wire path at the default unscoped base. */
  route: string;
  /** Registrar family, for grouping and diff messages. */
  family: string;
  /** How the route is registered — determines which enumeration guards it. */
  source: 'route-manager' | 'direct-mount';
  disposition: RestRouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
  /**
   * Name of the `@objectstack/spec/api` export declaring this route's response
   * PAYLOAD — the `data` of the shared `{ success, data }` envelope where the
   * route emits one, the whole body where it does not. The envelope itself is
   * not this field's business; `pnpm check:route-envelope` guards it
   * structurally, and a single field cannot describe both halves honestly.
   *
   * ABSENT MEANS "UNDECLARED", and that is the state of most of the mounted
   * surface: at the #3877 audit, 0 of 237 ledgered routes carried a schema
   * reference. #3877 ruled that authoring the ~190 missing ones is NOT
   * scheduled — a response schema is a product decision about what an endpoint
   * promises, and mass-producing them is precisely how declarations nobody
   * validated come to exist (the four defects #3676/#3833/#3847/#3870 fixed).
   * So this field is filled incrementally, as a family lands conformance
   * coverage or a route is touched for other reasons; a blank one changes no
   * behaviour and is not a defect.
   *
   * ⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE. The field exists to
   * make "what does this route declare" queryable so #3877's Stage D ratchet
   * can demand coverage for it; a name written ahead of the test it points at
   * would BE the "declared but unverified" surface the programme exists to
   * remove. `packages/client/src/route-ledger-response-schema.test.ts` resolves
   * every name written here against the live `@objectstack/spec/api` exports,
   * so a typo or a retired schema fails loudly rather than rotting.
   *
   * A NAME rather than a live schema object, deliberately: this module stays
   * import-free — the client-side guards compile it as a relative SOURCE file,
   * and `zod` is not a dependency of every package that owns a ledger. The
   * resolution belongs in the guard that can import the spec, not in the data.
   */
  responseSchema?: string;
  /** One-line rationale. Required for every non-`sdk` disposition. */
  note?: string;
}

export const REST_ROUTE_LEDGER: readonly RestRouteLedgerEntry[] = [
  // ── discovery ─────────────────────────────────────────────────────────────
  // The alias carries NO `responseSchema` on purpose (#5791). It shares the
  // very `discoveryHandler` closure the row below names, so the body is the
  // same object — but `discovery-schema-conformance.test.ts` resolves the
  // handler at `/api/v1/discovery` and drives only that mount, so this row has
  // no conformance coverage of its own. The field's rule is "no coverage, no
  // fill", and "same handler, therefore same shape" is an argument about the
  // code rather than a measurement of it — exactly the substitution #3877 was
  // opened about. Fill it in the PR that drives this mount, not before.
  { route: 'GET /api/v1', family: 'discovery', source: 'route-manager', disposition: 'server-only',
    note: 'bare-base discovery alias; the SDK connects via /api/v1/discovery' },
  { route: 'GET /api/v1/discovery', family: 'discovery', source: 'route-manager', disposition: 'sdk', client: 'connect',
    responseSchema: 'DiscoverySchema',
    note: 'duplicate mount with the dispatcher /discovery branch — REST registers first and wins. Answers BARE (res.json(discovery), no envelope), so `DiscoverySchema` names the whole body here while the dispatcher row names its envelope `data`; discovery-schema-conformance.test.ts drives THIS handler through the #5682 double assertion' },

  // ── openapi / docs ────────────────────────────────────────────────────────
  { route: 'GET /api/v1/openapi.json', family: 'openapi', source: 'route-manager', disposition: 'server-only',
    note: 'machine-readable OpenAPI 3.1 (503 when not bundled); docs tooling, not SDK surface' },
  { route: 'GET /api/v1/docs', family: 'openapi', source: 'route-manager', disposition: 'server-only',
    note: 'interactive Scalar HTML page' },

  // ── metadata ──────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/meta', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getTypes' },
  { route: 'GET /api/v1/meta/diagnostics', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getDiagnostics' },
  { route: 'GET /api/v1/meta/_drafts', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.listDrafts' },
  { route: 'POST /api/v1/meta/_migrate-stored', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.migrateStored',
    note: 'ADR-0087 stored-row canonicalization (#4327); gated on `manage_metadata`, preview unless { apply: true }' },
  { route: 'GET /api/v1/meta/:type', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getItems' },
  { route: 'GET /api/v1/meta/:type/:name/references', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getReferences' },
  { route: 'GET /api/v1/meta/book/:name/tree', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getBookTree' },
  // [#5882] The three-layer diagnostic projection, promoted from the
  // `?layers=true` flag on the row below to a path of its own so that one path
  // answers one response shape. `responseSchema` is filled because this mount
  // HAS conformance coverage of its own: `meta-item-layered-route.test.ts`
  // drives this handler and parses the body it answers against the named
  // schema — not "same handler, therefore same shape".
  //
  // `server-only`, and NOT `gap`: the gap ratchet is pinned at zero and a new
  // `gap` row is defined to need its own reviewed decision, which this PR does
  // not carry. The disposition is accurate on its own terms — the SDK has never
  // expressed a layered read, the `?layers=` spelling this path replaces was
  // equally unreachable through `@objectstack/client`, and Studio consumes it
  // straight over HTTP. So this row opens no gap and closes none; it records the
  // status quo under a new path. Whether the SDK SHOULD express it is a separate
  // product call.
  { route: 'GET /api/v1/meta/:type/:name/layers', family: 'metadata', source: 'route-manager', disposition: 'server-only',
    responseSchema: 'GetMetaItemLayeredResponseSchema',
    note: 'three-layer diagnostic read (code / overlay / effective) powering the Studio editor comparison tabs; consumed by objectui over plain HTTP, and the SDK expressed no layered read under the `?layers=` spelling either. Answers BARE, so the named schema is the whole body' },
  { route: 'GET /api/v1/meta/:type/:name', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getItem',
    responseSchema: 'GetMetaItemResponseSchema',
    note: '[#5950] answers BARE, so the named schema is the whole body. Filled now that meta-item-layered-route.test.ts parses BOTH branches of this mount (cached and uncached) against it — the uncached branch carries the ADR-0010 protection envelope this schema newly declares' },
  { route: 'PUT /api/v1/meta/:type/:name', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.saveItem',
    note: '[#6603] gated on `manage_metadata` (ADR-0066 D1), same mechanism as POST /meta/_migrate-stored — a session alone is no longer enough. The write-side answer to ADR-0106 D1: a masked read PUT back verbatim used to delete the fields the caller could not see' },
  { route: 'DELETE /api/v1/meta/:type/:name', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.deleteItem',
    note: 'REST-only: the dispatcher /meta branch has no DELETE handling — it falls into the read path' },
  { route: 'GET /api/v1/meta/:type/:name/history', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getHistory',
    note: 'REST-only: the dispatcher /meta branch swallows /history as a compound name and 404s' },
  { route: 'GET /api/v1/meta/:type/:name/audit', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getAudit' },
  { route: 'POST /api/v1/meta/:type/:name/publish', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.publishItem',
    note: 'per-item ADR-0033 publish; packages.publishDrafts remains the package-scoped flow' },
  { route: 'POST /api/v1/meta/:type/:name/rollback', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.rollbackItem' },
  { route: 'GET /api/v1/meta/:type/:name/diff', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.diffItem' },
  { route: 'GET /api/v1/meta/:type/:section/:name', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.getItem',
    note: 'compound names pass through getItem unencoded (URL-pinned in client.test.ts); only deleteItem encodes' },
  { route: 'PUT /api/v1/meta/:type/:section/:name', family: 'metadata', source: 'route-manager', disposition: 'sdk', client: 'meta.saveItem',
    note: 'compound names pass through saveItem unencoded (URL-pinned in client.test.ts)' },

  // ── ui ────────────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/ui/view/:object/:type', family: 'ui', source: 'route-manager', disposition: 'sdk', client: 'meta.getView',
    note: 'was mismatch — meta.getView spoke the ?type= query dialect this pattern cannot match; since #3611 the client sends the path form both surfaces accept' },

  // ── data CRUD ─────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/data/:object', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.find' },
  { route: 'GET /api/v1/data/:object/:id', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.get' },
  { route: 'POST /api/v1/data/:object', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.create' },
  { route: 'POST /api/v1/data/:object/query', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.query' },
  { route: 'PATCH /api/v1/data/:object/:id', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.update' },
  { route: 'DELETE /api/v1/data/:object/:id', family: 'crud', source: 'route-manager', disposition: 'sdk', client: 'data.delete' },

  // ── data actions (clone / import / import jobs / export) ──────────────────
  { route: 'POST /api/v1/data/:object/:id/clone', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.clone' },
  { route: 'POST /api/v1/data/:object/import', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.import' },
  { route: 'POST /api/v1/data/:object/import/jobs', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.createImportJob' },
  { route: 'POST /api/v1/data/import/jobs/:jobId/cancel', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.cancelImportJob' },
  { route: 'POST /api/v1/data/import/jobs/:jobId/undo', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.undoImportJob' },
  { route: 'GET /api/v1/data/import/jobs/:jobId/results', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.getImportJobResults' },
  { route: 'GET /api/v1/data/import/jobs/:jobId', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.getImportJobProgress' },
  { route: 'GET /api/v1/data/import/jobs', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.listImportJobs' },
  { route: 'GET /api/v1/data/:object/export', family: 'data-actions', source: 'route-manager', disposition: 'sdk', client: 'data.export',
    note: 'file-stream response; the SDK returns the raw Response rather than a JSON envelope' },

  // ── search ────────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/search', family: 'search', source: 'route-manager', disposition: 'sdk', client: 'search' },

  // ── email ─────────────────────────────────────────────────────────────────
  { route: 'POST /api/v1/email/send', family: 'email', source: 'route-manager', disposition: 'sdk', client: 'email.send' },

  // ── public forms ──────────────────────────────────────────────────────────
  { route: 'GET /api/v1/forms/:slug', family: 'forms', source: 'route-manager', disposition: 'public',
    note: 'anonymous public-form spec resolution — browser form runner, not authenticated SDK surface' },
  { route: 'POST /api/v1/forms/:slug/submit', family: 'forms', source: 'route-manager', disposition: 'public',
    note: 'anonymous public-form submission' },
  { route: 'GET /api/v1/forms/:slug/lookup/:field', family: 'forms', source: 'route-manager', disposition: 'public',
    note: 'anonymous scoped lookup picker (publicPicker-gated)' },

  // ── analytics (semantic layer) ────────────────────────────────────────────
  { route: 'POST /api/v1/analytics/dataset/query', family: 'analytics', source: 'route-manager', disposition: 'sdk', client: 'analytics.queryDataset' },

  // ── security explain (ADR-0090 D6) ────────────────────────────────────────
  { route: 'GET /api/v1/security/explain', family: 'security-explain', source: 'route-manager', disposition: 'sdk', client: 'security.explain',
    note: 'query transport of the same ExplainRequestSchema contract; the SDK speaks the POST form' },
  { route: 'POST /api/v1/security/explain', family: 'security-explain', source: 'route-manager', disposition: 'sdk', client: 'security.explain' },

  // ── delegable scope (ADR-0090 D12 / ADR-0105 D8) ──────────────────────────
  { route: 'GET /api/v1/security/my-delegable-scope', family: 'security-explain', source: 'route-manager', disposition: 'sdk', client: 'security.describeDelegableScope',
    note: "read half of the delegated-admin gate; strictly self-scoped (no target-user parameter), so a scoped-invitation picker can narrow to what the caller may actually delegate" },

  // ── per-record shares ─────────────────────────────────────────────────────
  { route: 'GET /api/v1/data/:object/:id/shares', family: 'record-shares', source: 'route-manager', disposition: 'sdk', client: 'shares.list' },
  { route: 'POST /api/v1/data/:object/:id/shares', family: 'record-shares', source: 'route-manager', disposition: 'sdk', client: 'shares.grant' },
  { route: 'DELETE /api/v1/data/:object/:id/shares/:shareId', family: 'record-shares', source: 'route-manager', disposition: 'sdk', client: 'shares.revoke' },

  // ── sharing rules ─────────────────────────────────────────────────────────
  { route: 'GET /api/v1/sharing/rules', family: 'sharing-rules', source: 'route-manager', disposition: 'sdk', client: 'shares.rules.list' },
  { route: 'POST /api/v1/sharing/rules', family: 'sharing-rules', source: 'route-manager', disposition: 'sdk', client: 'shares.rules.save' },
  { route: 'GET /api/v1/sharing/rules/:idOrName', family: 'sharing-rules', source: 'route-manager', disposition: 'sdk', client: 'shares.rules.get' },
  { route: 'DELETE /api/v1/sharing/rules/:idOrName', family: 'sharing-rules', source: 'route-manager', disposition: 'sdk', client: 'shares.rules.delete' },
  { route: 'POST /api/v1/sharing/rules/:idOrName/evaluate', family: 'sharing-rules', source: 'route-manager', disposition: 'sdk', client: 'shares.rules.evaluate' },

  // ── security suggested-bindings (ADR-0090 D5/D9) ──────────────────────────
  { route: 'GET /api/v1/security/suggested-bindings', family: 'security', source: 'route-manager', disposition: 'sdk', client: 'security.suggestedBindings.list',
    note: 'duplicate mount with the dispatcher /security domain — REST registers first and wins' },
  { route: 'POST /api/v1/security/suggested-bindings/:id/confirm', family: 'security', source: 'route-manager', disposition: 'sdk', client: 'security.suggestedBindings.confirm',
    note: 'duplicate mount with the dispatcher /security domain' },
  { route: 'POST /api/v1/security/suggested-bindings/:id/dismiss', family: 'security', source: 'route-manager', disposition: 'sdk', client: 'security.suggestedBindings.dismiss',
    note: 'duplicate mount with the dispatcher /security domain' },

  // ── reports ───────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/reports', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.list' },
  { route: 'POST /api/v1/reports', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.save' },
  { route: 'GET /api/v1/reports/:id', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.get' },
  { route: 'DELETE /api/v1/reports/:id', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.delete' },
  { route: 'POST /api/v1/reports/:id/run', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.run' },
  { route: 'POST /api/v1/reports/:id/schedule', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.schedule' },
  { route: 'GET /api/v1/reports/:id/schedules', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.listSchedules' },
  { route: 'DELETE /api/v1/reports/schedules/:scheduleId', family: 'reports', source: 'route-manager', disposition: 'sdk', client: 'reports.unschedule' },

  // ── approvals ─────────────────────────────────────────────────────────────
  { route: 'GET /api/v1/approvals/requests', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.listRequests' },
  { route: 'GET /api/v1/approvals/requests/:id', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.getRequest' },
  { route: 'POST /api/v1/approvals/requests/:id/approve', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.approve' },
  { route: 'POST /api/v1/approvals/requests/:id/reject', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.reject' },
  { route: 'POST /api/v1/approvals/requests/:id/recall', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.recall' },
  { route: 'POST /api/v1/approvals/requests/:id/revise', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.revise' },
  { route: 'POST /api/v1/approvals/requests/:id/resubmit', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.resubmit' },
  { route: 'POST /api/v1/approvals/requests/:id/reassign', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.reassign' },
  { route: 'POST /api/v1/approvals/requests/:id/remind', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.remind' },
  { route: 'POST /api/v1/approvals/requests/:id/request-info', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.requestInfo' },
  { route: 'POST /api/v1/approvals/requests/:id/comment', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.comment' },
  { route: 'GET /api/v1/approvals/requests/:id/actions', family: 'approvals', source: 'route-manager', disposition: 'sdk', client: 'approvals.listActions' },

  // ── batch ─────────────────────────────────────────────────────────────────
  { route: 'POST /api/v1/batch', family: 'batch', source: 'route-manager', disposition: 'sdk', client: 'data.batchTransaction' },
  { route: 'POST /api/v1/data/:object/batch', family: 'batch', source: 'route-manager', disposition: 'sdk', client: 'data.batch' },
  { route: 'POST /api/v1/data/:object/createMany', family: 'batch', source: 'route-manager', disposition: 'sdk', client: 'data.createMany' },
  { route: 'POST /api/v1/data/:object/updateMany', family: 'batch', source: 'route-manager', disposition: 'sdk', client: 'data.updateMany' },
  { route: 'POST /api/v1/data/:object/deleteMany', family: 'batch', source: 'route-manager', disposition: 'sdk', client: 'data.deleteMany' },

  // ── packages (direct-mount registrar, service-gated) ──────────────────────
  { route: 'POST /api/v1/packages/publish', family: 'packages', source: 'direct-mount', disposition: 'server-only',
    note: 'marketplace registry publish ({manifest, metadata}) — publisher tooling, not app-SDK surface. Moved off the bare POST /packages in #3610: that verb+path is the dispatcher install route, and REST registering it first swallowed every packages.install call with a 400.' },
  { route: 'GET /api/v1/packages', family: 'packages', source: 'direct-mount', disposition: 'sdk', client: 'packages.list',
    note: 'shadows the dispatcher twin (registered first); merges registry + database packages' },
  { route: 'GET /api/v1/packages/:id', family: 'packages', source: 'direct-mount', disposition: 'sdk', client: 'packages.get',
    note: 'shadows the dispatcher twin (registered first)' },
  { route: 'DELETE /api/v1/packages/:id', family: 'packages', source: 'direct-mount', disposition: 'sdk', client: 'packages.uninstall',
    note: 'shadows the dispatcher twin (registered first); full uninstall via protocol.deletePackage (#2747)' },

  // ── external datasource federation (ADR-0015 §6.2, direct-mount) ──────────
  { route: 'GET /api/v1/datasources/:name/external/tables', family: 'external-datasource', source: 'direct-mount', disposition: 'sdk', client: 'datasources.external.listTables' },
  { route: 'POST /api/v1/datasources/:name/external/tables/:remote/draft', family: 'external-datasource', source: 'direct-mount', disposition: 'sdk', client: 'datasources.external.draft' },
  { route: 'POST /api/v1/datasources/:name/external/tables/:remote/import', family: 'external-datasource', source: 'direct-mount', disposition: 'sdk', client: 'datasources.external.import' },
  { route: 'POST /api/v1/datasources/:name/external/refresh-catalog', family: 'external-datasource', source: 'direct-mount', disposition: 'sdk', client: 'datasources.external.refreshCatalog' },
  { route: 'POST /api/v1/datasources/:name/external/validate', family: 'external-datasource', source: 'direct-mount', disposition: 'sdk', client: 'datasources.external.validate' },
];
