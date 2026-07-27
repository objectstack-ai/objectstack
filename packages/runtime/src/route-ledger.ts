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
 * SCOPE. Dispatcher (`http-dispatcher.ts`) routes only, expressed as
 * dispatcher-internal `cleanPath` patterns (prepend `/api/v1` for the wire
 * path). The REST server (`@objectstack/rest`) mounts a second, larger surface
 * (search, forms, reports, sharing rules, …) that the client also reaches;
 * auditing that surface is follow-up work tracked in #3563 — see
 * `docs/audits/2026-07-dispatcher-client-route-coverage.md`.
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
  /** Owning domain — a registry prefix (e.g. `/automation`) or legacy-chain prefix. */
  domain: string;
  disposition: RouteDisposition;
  /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
  client?: string;
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
  '/openapi.json',
  '/__api-endpoint', // handleApiEndpoint catch-all (metadata-declared endpoints)
] as const;

export const ROUTE_LEDGER: readonly RouteLedgerEntry[] = [
  // ── ops probes ────────────────────────────────────────────────────────────
  { route: 'GET /health', domain: '/health', disposition: 'server-only', note: 'liveness probe for orchestrators, not app traffic' },
  { route: 'GET /ready', domain: '/ready', disposition: 'server-only', note: 'readiness probe for orchestrators, not app traffic' },

  // ── discovery ─────────────────────────────────────────────────────────────
  { route: 'GET /discovery', domain: '/discovery', disposition: 'sdk', client: 'connect' },

  // ── analytics ─────────────────────────────────────────────────────────────
  { route: 'POST /analytics/query', domain: '/analytics', disposition: 'sdk', client: 'analytics.query' },
  { route: 'GET /analytics/meta', domain: '/analytics', disposition: 'mismatch', client: 'analytics.meta',
    note: 'dispatcher serves GET /analytics/meta; client calls GET /analytics/meta/:cube — extra path segment only the REST server understands' },
  { route: 'POST /analytics/sql', domain: '/analytics', disposition: 'mismatch', client: 'analytics.explain',
    note: 'dispatcher serves POST /analytics/sql; client calls POST /analytics/explain — different route name entirely' },

  // ── i18n ──────────────────────────────────────────────────────────────────
  { route: 'GET /i18n/locales', domain: '/i18n', disposition: 'sdk', client: 'i18n.getLocales' },
  { route: 'GET /i18n/translations/:locale', domain: '/i18n', disposition: 'sdk', client: 'i18n.getTranslations' },
  { route: 'GET /i18n/labels/:object/:locale', domain: '/i18n', disposition: 'sdk', client: 'i18n.getFieldLabels' },

  // ── notifications ─────────────────────────────────────────────────────────
  { route: 'GET /notifications', domain: '/notifications', disposition: 'sdk', client: 'notifications.list' },
  { route: 'POST /notifications/read', domain: '/notifications', disposition: 'sdk', client: 'notifications.markRead' },
  { route: 'POST /notifications/read/all', domain: '/notifications', disposition: 'sdk', client: 'notifications.markAllRead' },

  // ── security (ADR-0090 suggested audience bindings) ───────────────────────
  { route: 'GET /security/suggested-bindings', domain: '/security', disposition: 'gap', note: 'no client expression for the whole domain' },
  { route: 'POST /security/suggested-bindings/:id/confirm', domain: '/security', disposition: 'gap', note: 'no client expression' },
  { route: 'POST /security/suggested-bindings/:id/dismiss', domain: '/security', disposition: 'gap', note: 'no client expression' },

  // ── keys ──────────────────────────────────────────────────────────────────
  { route: 'POST /keys', domain: '/keys', disposition: 'gap',
    note: 'mints a sys_api_key (secret returned once); there is NO SDK path to create an API key' },

  // ── storage ───────────────────────────────────────────────────────────────
  { route: 'POST /storage/upload', domain: '/storage', disposition: 'mismatch', client: 'storage.upload',
    note: 'dispatcher serves plain POST /storage/upload; client speaks the REST presigned/chunked protocol (/upload/presigned, /upload/complete, /upload/chunked/*)' },
  { route: 'GET /storage/file/:id', domain: '/storage', disposition: 'mismatch', client: 'storage.getDownloadUrl',
    note: 'dispatcher serves /storage/file/:id; client calls /storage/files/:id/url (REST shape)' },

  // ── ui ────────────────────────────────────────────────────────────────────
  { route: 'GET /ui/view/:object/:type?', domain: '/ui', disposition: 'sdk', client: 'meta.getView',
    note: 'the one ui-route call in the SDK is filed under client.meta, not a ui surface' },

  // ── share-links ───────────────────────────────────────────────────────────
  { route: 'POST /share-links', domain: '/share-links', disposition: 'gap', note: 'create a link — no client expression for the whole domain' },
  { route: 'GET /share-links', domain: '/share-links', disposition: 'gap', note: 'list own links — no client expression' },
  { route: 'DELETE /share-links/:idOrToken', domain: '/share-links', disposition: 'gap', note: 'revoke — no client expression' },
  { route: 'GET /share-links/:token/resolve', domain: '/share-links', disposition: 'public', note: 'unauthenticated token resolution for shared-record pages' },
  { route: 'GET /share-links/:token/messages', domain: '/share-links', disposition: 'public', note: 'unauthenticated shared-conversation messages' },

  // ── packages ──────────────────────────────────────────────────────────────
  { route: 'GET /packages', domain: '/packages', disposition: 'sdk', client: 'packages.list' },
  { route: 'POST /packages', domain: '/packages', disposition: 'sdk', client: 'packages.install' },
  { route: 'GET /packages/:id', domain: '/packages', disposition: 'sdk', client: 'packages.get' },
  { route: 'DELETE /packages/:id', domain: '/packages', disposition: 'sdk', client: 'packages.uninstall' },
  { route: 'PATCH /packages/:id/enable', domain: '/packages', disposition: 'sdk', client: 'packages.enable' },
  { route: 'PATCH /packages/:id/disable', domain: '/packages', disposition: 'sdk', client: 'packages.disable' },
  { route: 'PATCH /packages/:id', domain: '/packages', disposition: 'gap', note: 'edit manifest — Studio-only via raw fetch today' },
  { route: 'POST /packages/:id/publish', domain: '/packages', disposition: 'gap', note: 'ADR-0033 publish — no client expression' },
  { route: 'POST /packages/:id/publish-drafts', domain: '/packages', disposition: 'gap', note: 'ADR-0033 — no client expression' },
  { route: 'POST /packages/:id/discard-drafts', domain: '/packages', disposition: 'gap', note: 'ADR-0033 — no client expression' },
  { route: 'GET /packages/:id/commits', domain: '/packages', disposition: 'gap', note: 'ADR-0067 timeline — no client expression' },
  { route: 'POST /packages/:id/commits/:commitId/revert', domain: '/packages', disposition: 'gap', note: 'ADR-0067 — no client expression' },
  { route: 'POST /packages/:id/rollback', domain: '/packages', disposition: 'gap', note: 'ADR-0067 — no client expression' },
  { route: 'POST /packages/:id/revert', domain: '/packages', disposition: 'gap', note: 'revert to published — no client expression' },
  { route: 'GET /packages/:id/export', domain: '/packages', disposition: 'gap', note: 'ADR-0070 export — no client expression' },
  { route: 'POST /packages/:id/adopt-orphans', domain: '/packages', disposition: 'gap', note: 'ADR-0070 D5 — no client expression' },
  { route: 'POST /packages/:id/duplicate', domain: '/packages', disposition: 'gap', note: 'ADR-0070 D4 — no client expression' },

  // ── automation ────────────────────────────────────────────────────────────
  { route: 'POST /automation/trigger/:name', domain: '/automation', disposition: 'sdk', client: 'automation.trigger',
    note: 'legacy verb-first shape; duplicates execute() against a different URL — candidates for consolidation' },
  { route: 'GET /automation', domain: '/automation', disposition: 'sdk', client: 'automation.list' },
  { route: 'POST /automation', domain: '/automation', disposition: 'sdk', client: 'automation.create' },
  { route: 'GET /automation/actions', domain: '/automation', disposition: 'gap', note: 'ADR-0018 action descriptors — no client expression' },
  { route: 'GET /automation/connectors', domain: '/automation', disposition: 'gap', note: 'ADR-0022 connector descriptors — no client expression' },
  { route: 'GET /automation/_status', domain: '/automation', disposition: 'gap', note: 'per-flow runtime state — no client expression' },
  { route: 'POST /automation/:name/trigger', domain: '/automation', disposition: 'sdk', client: 'automation.execute' },
  { route: 'POST /automation/:name/toggle', domain: '/automation', disposition: 'sdk', client: 'automation.toggle' },
  { route: 'POST /automation/:name/runs/:runId/resume', domain: '/automation', disposition: 'sdk', client: 'automation.resume' },
  { route: 'GET /automation/:name/runs/:runId/screen', domain: '/automation', disposition: 'sdk', client: 'automation.getScreen' },
  { route: 'GET /automation/:name/runs/:runId', domain: '/automation', disposition: 'sdk', client: 'automation.getRun' },
  { route: 'GET /automation/:name/runs', domain: '/automation', disposition: 'sdk', client: 'automation.listRuns' },
  { route: 'GET /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.get' },
  { route: 'PUT /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.update' },
  { route: 'DELETE /automation/:name', domain: '/automation', disposition: 'sdk', client: 'automation.delete' },

  // ── auth (better-auth passthrough) ────────────────────────────────────────
  { route: '* /auth/**', domain: '/auth', disposition: 'sdk', client: 'auth.me',
    note: 'wholesale delegate to the auth service; the client expresses 26 selected better-auth endpoints (auth/oauth/organizations surfaces) — not enumerable route-by-route here' },

  // ── ai (dynamic route table) ──────────────────────────────────────────────
  { route: '* /ai/**', domain: '/ai', disposition: 'dynamic',
    note: 'routes come from service-ai buildAIRoutes() at plugin start; client expresses nlq/suggest/insights against the REST AI routes' },

  // ── meta (legacy chain) ───────────────────────────────────────────────────
  { route: 'GET /meta', domain: '/meta', disposition: 'sdk', client: 'meta.getTypes' },
  { route: 'GET /meta/types', domain: '/meta', disposition: 'server-only', note: 'richer types listing consumed by Studio tooling directly; client uses GET /meta' },
  { route: 'GET /meta/:type', domain: '/meta', disposition: 'sdk', client: 'meta.getItems' },
  { route: 'GET /meta/:type/:name', domain: '/meta', disposition: 'sdk', client: 'meta.getItem' },
  { route: 'PUT /meta/:type/:name', domain: '/meta', disposition: 'sdk', client: 'meta.saveItem' },
  { route: 'GET /meta/:type/:name/published', domain: '/meta', disposition: 'gap', note: 'ADR-0033 published version — no client expression' },
  { route: 'GET /meta/_drafts', domain: '/meta', disposition: 'gap', note: 'ADR-0033 pending drafts — no client expression' },
  { route: 'GET /meta/objects/:name/state/:field', domain: '/meta', disposition: 'gap', note: 'ADR-0020 legal next FSM states — no client expression' },

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
  { route: 'POST /actions/:object/:action', domain: '/actions', disposition: 'gap',
    note: 'server-registered actions (engine.registerAction) are entirely unreachable from the SDK — the largest functional hole' },
  { route: 'POST /actions/:object/:action/:recordId', domain: '/actions', disposition: 'gap', note: 'record-scoped variant — same hole' },
  { route: 'POST /actions/global/:action', domain: '/actions', disposition: 'gap', note: 'wildcard variant — same hole' },

  // ── misc legacy ───────────────────────────────────────────────────────────
  { route: 'GET /openapi.json', domain: '/openapi.json', disposition: 'server-only', note: 'docs tooling; falls through when metadata service lacks a generator' },
  { route: '* (unmatched)', domain: '/__api-endpoint', disposition: 'dynamic', note: 'metadata-declared custom endpoints (flow/script/object_operation/proxy)' },
];
