// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Route ledger — the audited disposition of every HTTP route the dispatcher
 * serves, against what `@objectstack/client` can express (#3563).
 *
 * WHY THIS EXISTS. #3528 shipped because a route could exist, work, and be
 * documented while the SDK had no way to call it (`resume` — fixed in #3552).
 * That was one instance of a class: at audit time, six whole domains had zero
 * client expression. This ledger makes the class visible and ratchets it —
 * `route-ledger.conformance.test.ts` fails when a dispatcher domain appears
 * with no ledger entry, and when an entry claims a client method that does not
 * exist. A new route therefore lands with an explicit, reviewed disposition or
 * not at all.
 *
 * SCOPE. Dispatcher (`http-dispatcher.ts`) routes, expressed as
 * dispatcher-internal `cleanPath` patterns (prepend `/api/v1` for the wire
 * path) — plus, since #5090, the surfaces `dispatcher-plugin.ts` mounts on the
 * host `IHttpServer` WITHOUT going through `dispatch()`, pinned in
 * {@link NON_DISPATCH_MOUNT_PREFIXES}. There is exactly one of those (the
 * declarative-endpoint fallback seam) and it is listed for the same reason
 * everything else here is: a route surface this package serves and nobody
 * reviewed the SDK disposition of is precisely what #3528 was.
 * The REST server (`@objectstack/rest`) mounts a second, larger surface
 * (search, forms, reports, sharing rules, …) that the client also reaches;
 * that surface has its own ledger + guard since #3587 —
 * `packages/rest/src/rest-route-ledger.ts`. A third surface — services that
 * mount autonomously on the host `IHttpServer` (`service-storage`,
 * `service-i18n`) — carries per-package ledgers since #3636. Background:
 * `docs/audits/2026-07-dispatcher-client-route-coverage.md`.
 *
 * A ROW HERE IS NOT A WIRE GUARANTEE. This ledger pairs a dispatcher-internal
 * path pattern with a client method that exists; it does not check that the
 * client builds a URL any server actually mounts. The three `/i18n` rows below
 * looked healthy for exactly that reason while two of the three SDK methods
 * spoke a `?locale=` dialect nothing routed (#3636). That direction is covered
 * since #3642 by `packages/client/src/client-url-conformance.test.ts`, which
 * drives every SDK method and matches the URL it builds against the UNION of
 * all four ledgers — so the `route` strings below are now load-bearing for the
 * client half too, not just for dispatcher enumeration. Note what that guard
 * can and cannot do with a `dynamic` row: a `**` row claims a prefix family,
 * not a resolvable route. `* /auth/**` was the worst of it — 54 SDK methods
 * resting on a prefix claim — until #3656 enumerated better-auth's real table
 * into `plugin-auth/src/auth-route-ledger.ts`, dropping the guard's
 * wildcard-only count 60 → 3.
 *
 * The last 3 were the `ai.*` methods on `* /ai/**`, and enumerating THAT
 * family settled the question of how much a `**` row is worth: not "weaker
 * evidence" but, in this case, WRONG evidence. `service-ai` (a Cloud/EE
 * package in the `cloud` repo) mounts 12 routes and not one of them was the
 * `/nlq` `/suggest` `/insights` the SDK called — the wildcard had been
 * certifying three URLs that nothing anywhere serves (#3718). Those three
 * methods are gone and the SDK now expresses the real table instead. The
 * capstone exempts `/api/v1/ai/` by prefix like the control plane — bounded to
 * the `ai.*` namespace, with the reachability check living in `cloud` next to
 * the routes — and the wildcard-only bound is **0**: every matched call rests
 * on an exact enumerated route.
 *
 * This module is runtime-internal (not exported from the package index): it is
 * the guard's data, not public API. Promotion to `@objectstack/spec` is a
 * deliberate later step if other packages need it.
 */

/** Disposition of a single dispatcher route. */
export type RouteDisposition =
  /** Expressed by the SDK — `client` names the method (dotted path). */
  | 'sdk'
  /** Should be in the SDK and is not — an open, acknowledged gap. */
  | 'gap'
  /** Deliberately not SDK surface (ops probes, agent/protocol endpoints). */
  | 'server-only'
  /** Public, unauthenticated browser-facing route (token links etc.). */
  | 'public'
  /** Route set is built at runtime (plugins/metadata) — not statically enumerable. */
  | 'dynamic'
  /** Dispatcher and client disagree on the shape — needs reconciliation. */
  | 'mismatch';

export interface RouteLedgerEntry {
  /** `VERB /cleanPath/:param` (or `* /prefix/**` for wildcard families). */
  route: string;
  /**
   * `true` when {@link route} is already an ABSOLUTE wire path and must NOT
   * have the `/api/v1` prefix prepended to it.
   *
   * Every other row here is a dispatcher-internal `cleanPath`, and both
   * consumers (`client-url-conformance.test.ts` and the live-mount parity
   * gate) reconstruct the wire path by prepending the prefix. `/.well-known/*`
   * is mounted at the site root by definition — a well-known URI under a
   * versioned API prefix is not a well-known URI — so prefixing it would
   * compile a pattern nothing serves. Rather than let a guard carry a quietly
   * wrong pattern (the #5078 failure), the row says so and the guards honour
   * it. [#7526]
   */
  absolute?: boolean;
  /**
   * The mounted pattern that ANSWERS this row, when the row deliberately
   * describes a SPECIALIZATION of a broader mount rather than a pattern of its
   * own.
   *
   * One row uses it: `POST /actions/global/:action` names the global-action
   * calling convention the SDK's `actions.invokeGlobal` builds, and it is
   * served by `POST /actions/:object/:action` with `:object` bound to the
   * literal `global`. There is no `/actions/global/:action` registration and
   * there should not be one.
   *
   * This is NOT an escape hatch for "the route is missing". The live-mount
   * parity gate does not take the field's word for anything — it probes a
   * concrete path and asserts the LIVE ROUTER answers with exactly this
   * pattern, so a wrong `servedBy` fails as loudly as a missing route. What the
   * field buys is that the shadowing becomes a written, reviewable claim
   * instead of an unexplained mismatch a future reader would "fix" by deleting
   * the row. [#7526]
   */
  servedBy?: string;
  /** Owning domain — a registry prefix (e.g. `/automation`) or legacy-chain prefix. */
  domain: string;
  disposition: RouteDisposition;
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

/**
 * Legacy `dispatch()` if-chain prefixes — branches not yet lifted into the
 * `DomainHandlerRegistry` (ADR-0076 D11 step ③ is still extracting them).
 * The conformance test asserts this list matches the ledger's `domain` set
 * minus the live registry prefixes; when a branch is extracted or added,
 * this list — and the ledger — must move with it.
 */
export const LEGACY_CHAIN_PREFIXES = [
  '/discovery',
  '/meta',
  '/data',
  '/mcp/skill',
  '/mcp',
  '/actions',
  // `/openapi.json` was REMOVED in #5093 (closing #5078). It was pinned here
  // for a `dispatch()` branch that duck-typed a `generateOpenApi` method
  // nothing implements, over a path nothing routes into `dispatch()` — dead
  // twice over, and deleted with the branch. The route is real and healthy;
  // `packages/rest` owns it end to end (`rest-server.ts`, and the row in
  // `rest-route-ledger.ts` that describes it truthfully). Leaving the prefix
  // pinned here would have made THIS list say "a branch of the if-chain"
  // about something that is not one — the same way the row's note said the
  // route "falls through when metadata service lacks a generator" when in
  // fact no generator has ever existed. That is the failure #5078 was filed
  // about; a list is not allowed to lie in the same PR that stops one.
  // `/__api-endpoint` (the `handleApiEndpoint` catch-all for metadata-declared
  // `apis:`) was REMOVED in #4936. It never named a mounted route: the branch
  // it stood for resolved a `matchEndpoint` method no implementation in this
  // repo ever provided, so it returned "not handled" on every request, and the
  // declared paths were never mounted for it to see in the first place. A
  // non-empty `apis:` is now rejected at publish/validate instead. When the
  // executor lands (#5040) it re-enters this file as a REAL mount, not a
  // catch-all placeholder.
] as const;

/**
 * Prefixes this package serves from OUTSIDE `dispatch()` — mounted by
 * `dispatcher-plugin.ts` straight onto the host `IHttpServer`, so neither the
 * domain registry nor {@link LEGACY_CHAIN_PREFIXES} can enumerate them.
 *
 * One member, and it is a seam rather than a route table: `/apps` is the
 * platform's reserved carve-out for metadata-declared endpoints (ADR-0121 D1),
 * reached through the `setFallbackHandler` seam — see the ledger row.
 * Deliberately NOT folded into `LEGACY_CHAIN_PREFIXES`: that list means
 * "branches of the `dispatch()` if-chain not yet lifted into the registry", and
 * this is not one. A pinned list whose name stops describing its contents is
 * how a ledger note goes quietly false (#5078).
 */
export const NON_DISPATCH_MOUNT_PREFIXES = [
  '/apps',
  // [#7526] `GET /.well-known/objectstack` — the platform's own discovery
  // document, mounted by `dispatcher-plugin.ts` straight on the host
  // `IHttpServer` and UNCONDITIONALLY owned by this plugin (no other
  // registrar may claim it; the `${prefix}/discovery` twin next to it IS
  // ceded to `@objectstack/rest`, this one never is). It was reachable,
  // documented and in NO ledger until the live-mount parity gate read it off
  // a booted server — the plain unledgered-mount case, and it sat directly
  // beside the routes this list already exists to name.
  '/.well-known/objectstack',
] as const;

export const ROUTE_LEDGER: readonly RouteLedgerEntry[] = [
  // ── well-known ────────────────────────────────────────────────────────────
  { route: 'GET /.well-known/objectstack', domain: '/.well-known/objectstack', absolute: true,
    disposition: 'server-only',
    note: 'RFC 8615 discovery document at the SITE ROOT (hence `absolute`), answering the same getDiscoveryInfo() body as GET /api/v1/discovery. Dispatcher-owned unconditionally — unlike the /discovery twin, which is ceded when @objectstack/rest is mounted. Consumed by tooling probing an unknown host, not by the SDK, which connects through /discovery' },

  // ── ops probes ────────────────────────────────────────────────────────────
  { route: 'GET /health', domain: '/health', disposition: 'server-only', note: 'liveness probe for orchestrators, not app traffic' },
  { route: 'GET /ready', domain: '/ready', disposition: 'server-only', note: 'readiness probe for orchestrators, not app traffic' },

  // ── discovery ─────────────────────────────────────────────────────────────
  // First filled `responseSchema` in this ledger (#5791), and the reason it is
  // fillable at all: #5682 gave this producer the double assertion (safeParse
  // for VALUES, key-set for undeclared KEYS) in
  // `discovery-schema-conformance.test.ts`, which is the coverage the field is
  // forbidden to be written without.
  { route: 'GET /discovery', domain: '/discovery', disposition: 'sdk', client: 'connect',
    responseSchema: 'DiscoverySchema',
    note: 'dispatch() returns this one through the { success, data } envelope, so `DiscoverySchema` names the `data` — which is exactly the value getDiscoveryInfo() produces and discovery-schema-conformance.test.ts parses (#5682)' },

  // ── analytics ─────────────────────────────────────────────────────────────
  // Capability-conditional (#3891 follow-through): the plugin mounts these
  // only when an `analytics` service is registered (or on a multi-tenant
  // host). The ledger row is the SDK-expressibility claim, not a mount
  // guarantee — see the header's "A ROW HERE IS NOT A WIRE GUARANTEE".
  { route: 'POST /analytics/query', domain: '/analytics', disposition: 'sdk', client: 'analytics.query' },
  { route: 'GET /analytics/meta', domain: '/analytics', disposition: 'sdk', client: 'analytics.meta',
    note: 'optional ?cube= filter honored server-side; was mismatch — the client called /meta/:cube, a shape no server ever mounted (#3584)' },
  { route: 'POST /analytics/sql', domain: '/analytics', disposition: 'sdk', client: 'analytics.explain',
    note: 'client keeps the explain name but calls /sql; the /explain route it used to call was served by nothing (#3584)' },

  // ── i18n ──────────────────────────────────────────────────────────────────
  { route: 'GET /i18n/locales', domain: '/i18n', disposition: 'sdk', client: 'i18n.getLocales' },
  { route: 'GET /i18n/translations/:locale', domain: '/i18n', disposition: 'sdk', client: 'i18n.getTranslations' },
  { route: 'GET /i18n/labels/:object/:locale', domain: '/i18n', disposition: 'sdk', client: 'i18n.getFieldLabels' },

  // ── notifications ─────────────────────────────────────────────────────────
  { route: 'GET /notifications', domain: '/notifications', disposition: 'sdk', client: 'notifications.list' },
  { route: 'POST /notifications/read', domain: '/notifications', disposition: 'sdk', client: 'notifications.markRead' },
  { route: 'POST /notifications/read/all', domain: '/notifications', disposition: 'sdk', client: 'notifications.markAllRead' },

  // ── security (ADR-0090 suggested audience bindings) ───────────────────────
  { route: 'GET /security/suggested-bindings', domain: '/security', disposition: 'sdk', client: 'security.suggestedBindings.list' },
  { route: 'POST /security/suggested-bindings/:id/confirm', domain: '/security', disposition: 'sdk', client: 'security.suggestedBindings.confirm' },
  { route: 'POST /security/suggested-bindings/:id/dismiss', domain: '/security', disposition: 'sdk', client: 'security.suggestedBindings.dismiss' },

  // ── keys ──────────────────────────────────────────────────────────────────
  { route: 'POST /keys', domain: '/keys', disposition: 'sdk', client: 'keys.create',
    note: 'raw secret returned once; user_id pinned server-side' },

  // ── storage ───────────────────────────────────────────────────────────────
  // RETIRED (#4087) — deliberately no rows, and the `/storage` domain is gone
  // from the registry with them. #3584 kept `POST /storage/upload` and
  // `GET /storage/file/:id` as a "low-level redirect/stream compat surface"
  // outside the SDK; re-verification found that surface never existed. The
  // upload branch called `upload(key, data, options?)` as `upload(file,
  // { request })` — a TypeError against every implementation — and the
  // download branch switched on a `{ url | redirect | stream | mimeType }`
  // result no implementation returns (`download(key)` resolves a Buffer).
  // Two routes ledgered as a compat path, neither of which could serve one
  // request. `/api/v1/storage` is service-storage's protocol, enumerated in
  // `packages/services/service-storage/src/storage-route-ledger.ts` — the
  // surface the SDK actually speaks. A dispatcher `/storage` row coming back
  // means a bridge is being rebuilt; make it speak the contract or don't
  // build it.

  // ── ui ────────────────────────────────────────────────────────────────────
  { route: 'GET /ui/view/:object/:type?', domain: '/ui', disposition: 'sdk', client: 'meta.getView',
    note: 'the one ui-route call in the SDK is filed under client.meta, not a ui surface' },

  // ── share-links ───────────────────────────────────────────────────────────
  { route: 'POST /share-links', domain: '/share-links', disposition: 'sdk', client: 'shareLinks.create' },
  { route: 'GET /share-links', domain: '/share-links', disposition: 'sdk', client: 'shareLinks.list' },
  { route: 'DELETE /share-links/:idOrToken', domain: '/share-links', disposition: 'sdk', client: 'shareLinks.revoke' },
  { route: 'GET /share-links/:token/resolve', domain: '/share-links', disposition: 'public', note: 'unauthenticated token resolution for shared-record pages' },
  { route: 'GET /share-links/:token/messages', domain: '/share-links', disposition: 'public', note: 'unauthenticated shared-conversation messages' },

  // ── packages ──────────────────────────────────────────────────────────────
  { route: 'GET /packages', domain: '/packages', disposition: 'sdk', client: 'packages.list' },
  { route: 'POST /packages', domain: '/packages', disposition: 'sdk', client: 'packages.install' },
  { route: 'GET /packages/:id', domain: '/packages', disposition: 'sdk', client: 'packages.get' },
  { route: 'DELETE /packages/:id', domain: '/packages', disposition: 'sdk', client: 'packages.uninstall' },
  { route: 'PATCH /packages/:id/enable', domain: '/packages', disposition: 'sdk', client: 'packages.enable' },
  { route: 'PATCH /packages/:id/disable', domain: '/packages', disposition: 'sdk', client: 'packages.disable' },
  { route: 'PATCH /packages/:id', domain: '/packages', disposition: 'sdk', client: 'packages.update' },
  { route: 'POST /packages/:id/publish', domain: '/packages', disposition: 'sdk', client: 'packages.publish' },
  { route: 'POST /packages/:id/publish-drafts', domain: '/packages', disposition: 'sdk', client: 'packages.publishDrafts' },
  { route: 'POST /packages/:id/discard-drafts', domain: '/packages', disposition: 'sdk', client: 'packages.discardDrafts' },
  { route: 'GET /packages/:id/commits', domain: '/packages', disposition: 'sdk', client: 'packages.listCommits' },
  { route: 'POST /packages/:id/commits/:commitId/revert', domain: '/packages', disposition: 'sdk', client: 'packages.revertCommit' },
  { route: 'POST /packages/:id/rollback', domain: '/packages', disposition: 'sdk', client: 'packages.rollback' },
  { route: 'POST /packages/:id/revert', domain: '/packages', disposition: 'sdk', client: 'packages.revert' },
  { route: 'GET /packages/:id/export', domain: '/packages', disposition: 'sdk', client: 'packages.export' },
  { route: 'POST /packages/:id/adopt-orphans', domain: '/packages', disposition: 'sdk', client: 'packages.adoptOrphans' },
  { route: 'POST /packages/:id/duplicate', domain: '/packages', disposition: 'sdk', client: 'packages.duplicate' },

  // ── automation ────────────────────────────────────────────────────────────
  { route: 'POST /automation/trigger/:name', domain: '/automation', disposition: 'sdk', client: 'automation.trigger',
    note: 'legacy verb-first shape; duplicates execute() against a different URL — candidates for consolidation' },
  { route: 'GET /automation', domain: '/automation', disposition: 'sdk', client: 'automation.list' },
  { route: 'POST /automation', domain: '/automation', disposition: 'sdk', client: 'automation.create' },
  { route: 'GET /automation/actions', domain: '/automation', disposition: 'sdk', client: 'automation.listActions' },
  { route: 'GET /automation/connectors', domain: '/automation', disposition: 'sdk', client: 'automation.listConnectors' },
  { route: 'GET /automation/_status', domain: '/automation', disposition: 'sdk', client: 'automation.getRuntimeStatus' },
  { route: 'POST /automation/:name/trigger', domain: '/automation', disposition: 'sdk', client: 'automation.execute' },
  { route: 'POST /automation/:name/toggle', domain: '/automation', disposition: 'sdk', client: 'automation.toggle' },
  { route: 'POST /automation/:name/runs/:runId/resume', domain: '/automation', disposition: 'sdk', client: 'automation.resume',
    note: "generic, so the SUSPENDED NODE gates it (#3801): a pause whose descriptor declares resumeAuthority:'service' — today `approval` / `approval_revise` — answers 403 here and continues only through its owning service (ApprovalService.decide), which authorizes and records the decision first. A node type that declares NO resumeAuthority answers 403 too, fail-closed since #5561: this door is an opt-in a descriptor states with 'any'. Screen/wait pauses are unaffected because they declare it; this route is the screen-flow runner's door" },
  { route: 'GET /automation/:name/runs/:runId/screen', domain: '/automation', disposition: 'sdk', client: 'automation.getScreen' },
  { route: 'GET /automation/:name/runs/:runId', domain: '/automation', disposition: 'sdk', client: 'automation.getRun' },
  { route: 'GET /automation/:name/runs', domain: '/automation', disposition: 'sdk', client: 'automation.listRuns' },
  { route: 'GET /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.get' },
  { route: 'PUT /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.update' },
  { route: 'DELETE /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.delete' },

  // ── auth (better-auth passthrough) ────────────────────────────────────────
  { route: '* /auth/**', domain: '/auth', disposition: 'sdk', client: 'auth.me',
    note: 'wholesale delegate to the auth service. Not enumerable route-by-route HERE, but no longer unenumerated: since #3656 plugin-auth/src/auth-route-ledger.ts carries the 55 SDK-reached routes plus the full mounted inventory, read off better-auth\'s live auth.api table' },

  // ── ai (dynamic route table, owned by another repo) ───────────────────────
  { route: '* /ai/**', domain: '/ai', disposition: 'dynamic',
    note: 'routes come from service-ai buildAIRoutes() at plugin start — service-ai is a Cloud/EE package in the `cloud` repo, so this repo cannot enumerate them and the dispatcher only proxies (or 404s "AI service is not configured"). Enumerated on the other side of that boundary since #3718: cloud packages/service-ai/src/ai-route-ledger.ts, whose conformance test drives client.ai.* against the table buildAIRoutes() really returns. The client now expresses that table — ai.chat / ai.chatStream / ai.complete / ai.models / ai.conversations.* — but do NOT read a `sdk` disposition into this row: it stays `dynamic` because THIS repo still cannot see the routes. An earlier note here claimed the client "expresses nlq/suggest/insights against the REST AI routes"; that was never verified and was FALSE — nothing has ever mounted those three paths, and both they and the methods calling them are gone (#3718)' },

  // ── meta (legacy chain) ───────────────────────────────────────────────────
  { route: 'GET /meta', domain: '/meta', disposition: 'sdk', client: 'meta.getTypes' },
  { route: 'GET /meta/types', domain: '/meta', disposition: 'server-only', note: 'richer types listing consumed by Studio tooling directly; client uses GET /meta' },
  { route: 'GET /meta/:type', domain: '/meta', disposition: 'sdk', client: 'meta.getItems' },
  { route: 'GET /meta/:type/:name', domain: '/meta', disposition: 'sdk', client: 'meta.getItem' },
  { route: 'PUT /meta/:type/:name', domain: '/meta', disposition: 'sdk', client: 'meta.saveItem' },
  { route: 'GET /meta/:type/:name/published', domain: '/meta', disposition: 'sdk', client: 'meta.getPublished' },
  { route: 'GET /meta/_drafts', domain: '/meta', disposition: 'sdk', client: 'meta.listDrafts' },
  { route: 'POST /meta/_migrate-stored', domain: '/meta', disposition: 'sdk', client: 'meta.migrateStored',
    note: 'ADR-0087 stored-row canonicalization (#4327); gated on `manage_metadata`, preview unless { apply: true }' },
  { route: 'GET /meta/objects/:name/state/:field', domain: '/meta', disposition: 'sdk', client: 'meta.getLegalNextStates' },

  // ── data (legacy chain) ───────────────────────────────────────────────────
  { route: 'POST /data/:object/query', domain: '/data', disposition: 'sdk', client: 'data.query' },
  { route: 'GET /data/:object', domain: '/data', disposition: 'sdk', client: 'data.find' },
  { route: 'GET /data/:object/:id', domain: '/data', disposition: 'sdk', client: 'data.get' },
  { route: 'POST /data/:object', domain: '/data', disposition: 'sdk', client: 'data.create' },
  { route: 'PATCH /data/:object/:id', domain: '/data', disposition: 'sdk', client: 'data.update' },
  { route: 'DELETE /data/:object/:id', domain: '/data', disposition: 'sdk', client: 'data.delete' },

  // ── mcp ───────────────────────────────────────────────────────────────────
  { route: 'GET /mcp/skill', domain: '/mcp/skill', disposition: 'server-only', note: 'public SKILL.md for agents; not JS-SDK surface' },
  { route: '* /mcp/**', domain: '/mcp', disposition: 'server-only', note: 'MCP Streamable HTTP transport — consumed by MCP clients, not this SDK' },

  // ── actions ───────────────────────────────────────────────────────────────
  { route: 'POST /actions/:object/:action', domain: '/actions', disposition: 'sdk', client: 'actions.invoke' },
  { route: 'POST /actions/:object/:action/:recordId', domain: '/actions', disposition: 'sdk', client: 'actions.invoke',
    note: 'client sends recordId in the body — both server shapes honor it' },
  { route: 'POST /actions/global/:action', domain: '/actions', disposition: 'sdk', client: 'actions.invokeGlobal',
    servedBy: '/api/v1/actions/:object/:action',
    note: '[#7526] a CALLING CONVENTION, not a registration: `global` is bound to `:object` on the row above, and handleActionsRequest routes that literal to the global-action table. Written as `servedBy` because the live-mount gate found no `/actions/global/:action` pattern and the honest answer is which pattern answers it — the gate re-derives that from the live router rather than believing this string' },
  // [#7526] The OBJECT-LESS shape, mounted since #3913 and ledgered by
  // nothing until the parity gate read it off a booted server. The empty
  // segment is deliberate and load-bearing: it is the URL an SDK with no
  // object to name emits, `:object` cannot match an empty segment, and
  // before #3913 it fell to Hono's `notFound`. Ugly on the wire and correct;
  // what was wrong was that no ledger said it existed.
  { route: 'POST /actions//:action', domain: '/actions', disposition: 'sdk', client: 'actions.invokeGlobal',
    note: 'the object-less spelling of the global-action call (#3913) — same handler and same `global` key as the row above, reached without naming an object' },

  // ── apps (declarative endpoints — the mount seam, NOT a dispatch() route) ──
  // Read this row literally; it describes what is WIRED, not what is planned.
  { route: '* /apps/**', domain: '/apps', disposition: 'dynamic',
    note: 'ADR-0121 D1 reserved carve-out for metadata-declared `apis:` endpoints, whose paths are '
      + '`<prefix>/apps/<namespace>/<subpath>` and therefore not enumerable here. Served by neither '
      + 'the domain registry nor the dispatch() if-chain: dispatcher-plugin installs an '
      + '`IHttpServer.setFallbackHandler` (Hono `app.notFound`) that runs only after every registered '
      + 'route has missed, and for paths under this prefix resolves the request\'s environment + '
      + 'identity, probes `metadata.matchEndpoint`, and on a match runs the full chain (#5040 E5b): '
      + 'the policy keys authRequired / rateLimit / cacheTtl (E4), then target delegation (E5) — '
      + '`object_operation` through the same `callData` as /data, `flow` through the automation '
      + 'service. `script` / `proxy` targets and the inputMapping / outputMapping keys are NOT '
      + 'executed and answer 501. A miss (or an occupant of the metadata slot with no matchEndpoint, '
      + 'or a multi-tenant request that resolves to no environment) writes nothing, leaving the '
      + 'transport\'s 404/405 answer untouched. LIVE since the #5040 E7 publish flip: a non-empty '
      + '`apis:` no longer fails wholesale, it is gated shape by shape '
      + '(`packages/spec/src/api/endpoint-publish-gate.ts`), so declarations exist and a real boot '
      + 'reaches this seam — the showcase serves two of them '
      + '(`packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`). '
      + 'No SDK surface — app-declared endpoints are an external-integration channel '
      + '(ADR-0121 D3), called by the integrator\'s own client, not by `@objectstack/client`',
  },

  // ── misc legacy ───────────────────────────────────────────────────────────
  // `GET /openapi.json` removed in #5093 (closing #5078). This ledger
  // enumerates the routes THIS package's dispatcher serves, and after the dead
  // `generateOpenApi` branch was deleted it serves none at that path. The route
  // itself is alive and owned by `packages/rest` — see the `GET
  // /api/v1/openapi.json` row in `packages/rest/src/rest-route-ledger.ts`,
  // which is the one place that describes it. The removed note here claimed the
  // path "falls through when metadata service lacks a generator", implying a
  // generator sometimes exists; none ever has, in this repo or its two
  // siblings, so the row was 100% fall-through wearing a conditional. Per
  // ADR-0076 §4 a machine-readable surface must not lie, and per §1 a path has
  // one owner: do not re-add a row (or a dispatcher branch) for this path.
  // `* (unmatched)` / `/__api-endpoint` removed in #4936 — see LEGACY_CHAIN_PREFIXES
  // above. It was the ledger's only row for a surface nothing served; an
  // unmatched path now falls to the semantic 404 with no pretence otherwise.
];
