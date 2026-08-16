// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D10 — Authorization Conformance Matrix.
//
// The durable encoding of the ADR-0056 audit: one row per authorization
// primitive, each in EXACTLY ONE honest state (enforced / experimental /
// removed). `enforced` rows name their runtime enforcement site; high-risk
// enforced rows additionally reference an end-to-end dogfood proof. The
// companion test (`authz-conformance.test.ts`) asserts every referenced proof
// file exists and that the row ↔ proof pairing is MUTUAL (#7976 below), AND
// ratchets completeness over a CURATED table of HTTP/transport entry points
// (`discover()`: 15 probes over 11 named source files) — a new ungated route
// there is UNCLASSIFIED, a deleted guard is STALE, and either breaks CI.
//
// [#8711] That completeness is over ROUTES, not over primitives: a primitive
// enforced by a predicate inside an existing resolver adds no entry point, so
// it can be neither UNCLASSIFIED nor STALE. Measured against the rows below:
// 43 of 50 carry no `covers` key at all (7 rows, 9 keys, every one an
// HTTP/transport pin), and 37 of the file's 43 `enforced` rows are exactly
// that in-resolver shape — the ADR-0049/#8613 `active` rows among them (see
// their own block further down) are the normal case, not an exception. Of the
// 9 `covers` keys that DO exist, 5 are GATE pins tied to the enforcement call
// itself, not merely a function name — delete `shouldDenyAnonymous` from
// `/actions`, `/automation` or `/packages`, or drop the MCP context-threading
// / stdio principal binding, and the pinned key vanishes from source, its row
// goes STALE, and CI catches the regression. That anti-regression property is
// real and is what this file mechanically delivers. Outside the curated
// table, "one row per primitive, each in EXACTLY ONE honest state" is a
// HAND-MAINTAINED invariant, not a checked one: a primitive added without its
// row is not something this ratchet can see (a primitive-discovery ratchet
// was measured unachievable in general form — there is no syntactic signature
// for "a predicate that decides a grant"; `isRowActive` looks exactly like any
// other `.filter()`).
//
// [#7976] Existence used to be the whole `proof` contract, which meant a row
// could cite a file exercising a NEIGHBOURING primitive and stay green forever:
// `rls-read` and `rls-by-id-write` cite the same file, and until PR #7975
// nothing could tell whether it exercised one, the other, or both. "Does this
// test prove this row" is not mechanically decidable and is deliberately NOT
// attempted. The checkable question it is converted into: each proof file NAMES
// the rows it is the proof for (a header `// authz-row: <id>` line), and the
// checker asserts both directions — a cited file must claim the citing row, and
// every claim must be reciprocated by the ledger. A shared proof file therefore
// has to SAY which rows it covers, and a row whose proof will not claim it
// loses the citation out loud instead of borrowing a sibling's credibility.

export type AuthzState = 'enforced' | 'experimental' | 'removed';

export interface AuthzPrimitive {
  id: string;
  summary: string;
  state: AuthzState;
  /** Runtime enforcement site (required when state === 'enforced'). */
  enforcement?: string;
  /** Dogfood proof filename in this directory (required for high-risk enforced). */
  proof?: string;
  /**
   * Ratchet keys this row accounts for (ADR-0060), matched against the test's
   * `discover()`. A discovered HTTP entry point with no covering row fails CI as
   * UNCLASSIFIED; a `covers` key no longer in source fails as STALE. See
   * authz-conformance.test.ts (#2567 anonymous-deny surface enumeration).
   */
  covers?: string[];
  /** Why it is experimental/removed, or a roadmap pointer. */
  note?: string;
}

export const AUTHZ_CONFORMANCE: AuthzPrimitive[] = [
  // ── Enforced + end-to-end proven ───────────────────────────────────────
  { id: 'rls-read', summary: 'RLS `using` read filter', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeRlsFilter (AND-injected)', proof: 'rls-fixture.dogfood.test.ts' },
  { id: 'rls-by-id-write', summary: 'by-id write enforcement (#1994)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 2.7 pre-image re-read, composed with computeRlsFilter\'s write-scope DERIVATION (#7665): when no update/delete-class policy applies, the write class is compiled from the caller\'s SELECT narrowing, so the pre-image gate has a predicate to enforce',
    proof: 'rls-fixture.dogfood.test.ts',
    note: '[#7685] Re-verified as `enforced`, both halves of the enforcement named because ONLY BOTH hold it. The pre-image re-read alone is a no-op under select-only authoring — that was #7665, and it is why the site had to be re-cited here: ablating the derivation while leaving the pre-image re-read fully in place turns 16 of 20 probed showcase objects into `rls-hole`. The proof is NOT vacuous for this row despite sharing `rls-fixture.dogfood.test.ts` with `rls-read`: since #7665/PR #7792 that file carries a dedicated select-only block whose member set grants FULL CRUD on `rls_note` (so a refusal is the record gate, never the object gate) asserting the by-id PATCH is refused with the row unchanged, plus that an in-scope write still lands. Second, independent measurement: `objectstack verify --rls`, whose probe persona reaches this class since #7685 — 20/23 showcase and 6/6 crm objects PROVEN, 0 holes, and 16 holes under the same ablation.' },
  { id: 'rls-write-check', summary: 'RLS `check` write post-image validation (ADR-0058 D4)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.6 — compileCelToFilter + matchesFilterCondition against the post-image (fail-closed)',
    note: 'Unit-proven in plugin-security/security-plugin.test.ts (RLS check enforcement); see ADR-0058 D7 ledger.' },
  { id: 'owd-private', summary: 'OWD private (owner-only)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts effectiveSharingModel=private', proof: 'showcase-private-owd.dogfood.test.ts' },
  { id: 'owd-public-read', summary: 'OWD public_read (everyone reads, owner writes)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts (read model + canEdit)', proof: 'showcase-public-read-owd.dogfood.test.ts' },
  { id: 'controlled-by-parent', summary: 'master-detail controlled_by_parent', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeControlledByParentFilter + assertControlledByParentWrite', proof: 'controlled-by-parent.dogfood.test.ts',
    note: '[#7685] Re-verified as `enforced` on its OWN evidence, not by association with `rls-by-id-write`. The cited proof is DEDICATED and non-vacuous: `fixtures/cbp-fixture.ts` grants the member full CRUD on BOTH `cbp_account` and `cbp_note`, so every refusal it asserts is the derived record gate rather than the object gate, and the detail carries no authored RLS at all — access is derived from the owner-scoped master. It asserts the derived READ denial, the derived by-id WRITE denial with the row unchanged as ground truth, and that a note under a master the member owns stays readable AND writable (so the guard is not over-blocking). Second measurement: `verify --rls` probes `showcase_invoice_line` — a real `controlled_by_parent` detail — as `rls-consistent`, and it flips to `rls-hole` when the #7665 write-scope derivation its master depends on is ablated.' },
  { id: 'multi-tenant', summary: 'organization isolation', state: 'enforced',
    enforcement: '@objectstack/organizations (enterprise) + Layer 0 tenant wall (plugin-security/tenant-layer.ts, AND-composed ahead of business RLS — ADR-0095 D1)', proof: 'rls-multitenant.dogfood.test.ts' },
  { id: 'multi-tenant-write-postimage', summary: 'Layer 0 tenant post-image check on INSERT + UPDATE (#2937 / Finding 1 — a forged OR re-pointed organization_id cannot cross the tenant wall)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.7 — computeWriteTenantCheckFilter (reuses computeLayeredRlsFilter\'s Layer 0) matched against the write post-image (fail-closed) for BOTH insert and update; enterprise auto-stamp authoritatively overwrites a user-context organization_id (@objectstack/organizations Middleware A)',
    note: 'INSERT has no pre-image and UPDATE\'s pre-image (step 2.7) validates only the OLD organization_id, so the AND-composed Layer 0 wall never inspected the NEW value: a member could INSERT a forged cross-tenant organization_id (#2937) or UPDATE a row to RE-POINT it into a victim tenant (Finding 1, BLOCKER). A supplied cross-tenant organization_id is now DENIED on both paths — organization_id is effectively immutable in non-platform user contexts (platform-admin posture on a posture-permitting object + single-mode exempt, same rule as the read side). Unit-proven in plugin-security/authz-matrix-gate.test.ts ([#2937] insert + [Finding 1 / #2937] update post-image tenant guard). Multi-org is enterprise-only so it is not in the open-core dogfood boot; see ADR-0095 D1.' },
  { id: 'multi-tenant-exemption-posture', summary: 'Layer 0 cross-tenant exemption requires the PLATFORM_ADMIN posture (Finding 2 — org_admin does not cross the wall)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeLayeredRlsFilter reads the carried ctx.posture rung (ADR-0099 D1 / #2956) to gate the tenant-layer.ts Layer 0 exemption — PLATFORM_ADMIN crosses, everything below is walled; the hasPlatformAdminPosture capability probe is the resolver-less fallback; the superuser bit (viewAllRecords/modifyAllRecords) governs only the Layer 1 business-RLS short-circuit',
    note: 'An organization_admin holds the superuser bit via its `*` wildcard, so it used to also get the Layer 0 exemption and read/write EVERY tenant\'s rows on private tenant objects. Crossing now requires the carried PLATFORM_ADMIN rung (ADR-0099 P1), which derives only from an unscoped admin_full_access grant — org_admin resolves to TENANT_ADMIN and a scoped grant / piecemeal platform capability to MEMBER, so all are walled to their own org (SECURITY NARROWING; a true platform admin still crosses, the better-auth carve-out is untouched). Before P1 the gate keyed on a platform-exclusive capability probe, which a scoped admin_full_access grant or a piecemeal studio.access grant could satisfy — the divergence class the equivalence gate pinned and P1 closed (invariant I1: TENANT_ADMIN never crosses). Unit-proven in plugin-security/authz-matrix-gate.test.ts ([Finding 2 / #2937] platform-posture exemption + "ADR-0099 P1 — Layer 0 exemption reads the carried rung").' },
  // ── ADR-0105 — group tenancy posture; organization scope as a first-class
  // authorization dimension. Phase 0 (F1/F2 correctness) + Phase 1 (the `group`
  // union wall). Multi-org is not in the open-core dogfood boot, so these are
  // unit-proven at the plugin-security layer, like the #2937 row above. ──
  { id: 'tenancy-posture-spectrum', summary: 'three tenancy postures — single | group | isolated (ADR-0105 D1/D2)', state: 'enforced',
    enforcement: 'plugin-auth/tenancy-service.ts resolves the posture in force; plugin-security/tenant-layer.ts computeTenantLayer0Filter switches the Layer 0 predicate on it — inert (single), `organization_id IN accessible_org_ids` (group, MOAC union), `organization_id = activeOrganizationId` (isolated); empty/absent scope → RLS_DENY_FILTER',
    note: 'Only the PREDICATE widens; composition is untouched — Layer 0 is still computed independently of the RLS compiler, AND-composed outermost, and crossable only by a true PLATFORM_ADMIN on a posture-permitting object, so ADR-0095 W1/W2 hold in every posture. BOTH walled postures require the enterprise @objectstack/organizations runtime to ACTIVATE and can resolve degraded without it (ADR-0081 D2): the wall\'s IMPLEMENTATION is open, but enabling multi-organization operation is an entitlement, and the runtime may narrow it further via `supportedPostures`. Cloud ADR-0016\'s 铁律 is satisfied by REFUSING to run an unwalled multi-org deployment (ADR-0093 D5), not by giving the posture away. Unit-proven in plugin-security/tenant-layer.test.ts and plugin-auth/tenancy-service.test.ts.' },
  { id: 'accessible-org-ids', summary: 'accessible_org_ids — core-resolved org access set (ADR-0105 D2)', state: 'enforced',
    enforcement: 'core/security/resolve-authz-context.ts resolveUserAuthzGrants reads every sys_member row for the user under ADR-0091 validity windows; carried on ExecutionContext by every transport (rest-server, runtime resolve-execution-context, mcp, hono) and read directly by the Layer 0 group wall',
    note: 'ONE read serves both the active-org position projection and the full membership set, so the two facts cannot disagree. A transport that fails to carry the set denies under `group` rather than falling back to the active org — the wall must not depend on which surface the request arrived through. Delegated (on-behalf-of) reads resolve the DELEGATOR\'s own set (explain-engine buildContextForUser), never inherit the live principal\'s.' },
  { id: 'org-write-validation', summary: 'bulk-aware organization_id write validation (ADR-0105 D5)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.7 — every SUPPLIED organization_id (single row AND bulk array) must satisfy the Layer 0 filter or the whole write is denied',
    note: 'The bulk path was a genuine hole: the pre-D5 check required a non-array payload, so an INSERT of an ARRAY could carry a forged organization_id per row — the #2937 defect one call site down. STAMPING an absent value is deliberately NOT done here: it belongs to the enterprise @objectstack/organizations runtime (Middleware A), which is also what ACTIVATES every walled posture (ADR-0105 D12), so the stamper is always present wherever a wall is. Keeping the stamp there means a forged `org-scoping` registration produces NULL-org rows the wall hides — a broken deployment, not a working unlicensed one — while validation stays open because it is a security property, not a packaging one. Unit-proven in plugin-security/security-plugin.test.ts + authz-matrix-gate.test.ts.' },
  { id: 'authored-rls-policy-survival', summary: 'app-authored org-scoped RLS policies are never silently stripped (ADR-0105 D3 / F1)', state: 'enforced',
    enforcement: 'plugin-security/platform-tenant-policies.ts — collectRLSPolicies strips by PROVENANCE (identity against the shipped declaration), not by substring-matching `current_user.organization_id`; an authored policy is retained, warned about once, and fails closed at compile time',
    note: 'The substring match dropped ANY policy using the token, including app-authored ones — a declared security policy silently unenforced, the ADR-0049 class. getReadFilter shared the defect, so analytics/raw-SQL consumers got an UNSCOPED read. Unit-proven in plugin-security/platform-tenant-policies.test.ts + security-plugin.test.ts.' },
  { id: 'vama-bounded-by-org-scope', summary: 'viewAllRecords/modifyAllRecords never cross an organization boundary, in any posture (ADR-0105 D4 / F2)', state: 'enforced',
    enforcement: 'Layer 0 owns the wall in `group` exactly as in `isolated` (the superuser bit governs only the Layer 1 short-circuit); plugin-security/auto-org-admin-grant.ts grants the de-VAMA\'d `organization_admin_no_bypass` variant under a wall-less posture and revokes the superseded variant on any posture change',
    note: 'organization_admin carries wildcard viewAllRecords/modifyAllRecords, safe only because Layer 0 bounds it. Wall-less, nothing did: with personal-org creation on signup, every owner/admin was effectively an environment-wide superuser. Deliberate blanket visibility remains available via admin_full_access or an explicitly authored set — it just stops being a side effect of a better-auth membership role. The variant is DERIVED from organization_admin (deriveWallLessOrgAdmin), never a second literal, so the two cannot drift. Unit-proven in plugin-security/auto-org-admin-grant.test.ts + objects/rbac-objects.test.ts.' },
  { id: 'anonymous-deny', summary: 'secure-by-default anonymous posture (capability)', state: 'enforced',
    enforcement: 'rest/rest-server.ts enforceAuth (requireAuth)', proof: 'showcase-anonymous-deny.dogfood.test.ts' },
  // ── #2567 — the anonymous-deny posture is UNIFORM across HTTP surfaces, not
  // just REST `/data`. Each sibling surface that reaches ObjectQL consults the
  // same unconditional anonymous-deny (#2567); these rows pin every entry point
  // so a new ungated surface (or a silent regression) fails CI, not review.
  //
  // The raw-hono `/data` row was retired with its surface (#4073): those routes
  // were duplicate supply that this plugin no longer serves, so there is no
  // entry point left to gate there. The invariant is unchanged — it simply has
  // one fewer implementation to hold it in.
  { id: 'anonymous-deny-meta', summary: 'anonymous-deny on the metadata endpoints (#2567 surface 1)', state: 'enforced',
    enforcement: 'rest/rest-server.ts registerMetadataEndpoints guarded registrar (enforceAuth → shouldDenyAnonymous) — every /meta route inherits the gate; runtime/http-dispatcher.ts handleMetadata mirrors it for the dispatcher metadata catch-all',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['meta:rest-server.ts:registerMetadataEndpoints', 'meta:http-dispatcher.ts:handleMetadata'] },
  // #5519 — the two DISPATCHER-mounted execution surfaces. `@objectstack/rest`
  // gated `/data` and `/meta`; these routes are mounted by a SECOND
  // registration path (dispatcher-plugin.ts, straight onto the host
  // IHttpServer) and inherited none of it, so the "#2567 uniform posture"
  // claim above was false on them until PR #5569. The proof artifact was
  // silent too — #5570 is the evidence half, and these two rows are what make
  // the gate's removal fail CI instead of review.
  { id: 'anonymous-deny-actions', summary: 'anonymous-deny on the business-action dispatch surface (#2567 surface 2 / #5519)', state: 'enforced',
    enforcement: 'runtime/domains/actions.ts handleActionsRequest — shouldDenyAnonymous as the handler\'s FIRST statement, ahead of the ADR-0066 D4 requiredPermissions gate and the ADR-0104 param contract; those keep their semantics and simply run after the auth baseline, so an anonymous caller never reaches action dispatch and never learns the route\'s shape',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['actions:domains/actions.ts:anonymous-gate'],
    note: 'A `type: \'script\'` action body runs `isSystem: true` (elevated), so an ungated POST was an anonymous privilege-escalating WRITE, not merely an information leak — #5519 measured `POST /actions/showcase_task/showcase_mark_done/:id` answering 200 with the update applied. Internal dispatch is unaffected: this handler is a pure HTTP seam (the MCP `run_action` bridge enters through action-execution.invokeBusinessAction, declarative endpoints through the transport fallback seam with their own `authRequired` gate), so `authRequired: false` public endpoints stay public.' },
  { id: 'anonymous-deny-automation', summary: 'anonymous-deny on the automation/flow surface (#2567 surface 3 / #5519)', state: 'enforced',
    enforcement: 'runtime/domains/automation.ts handleAutomationRequest — shouldDenyAnonymous DOMAIN-WIDE at the top, and deliberately BEFORE the isServiceServeable probe so the 401/501 difference cannot be used to fingerprint whether a deployment mounts automation',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['automation:domains/automation.ts:anonymous-gate'],
    note: 'Ungated, an anonymous caller could start real flow runs (`POST /:name/trigger`), read the full flow inventory (`GET /automation`), and DEREGISTER a registered flow (`DELETE /:name` → `{deleted:true}`) — the destructive one, which #5519 did not originally record. Gating the DOMAIN rather than each route is what keeps a newly added automation route from arriving ungated. Engine-internal triggers (record-change, schedule) never speak HTTP and are untouched.' },
  // #7033 / #7023 — the SIXTH dispatcher domain to join the baseline. `/packages`
  // was the last routed domain with ZERO authorization predicates: a survey drove
  // a guest-principal caller to a 200 on the DESTRUCTIVE `discard-drafts` and the
  // whole-package `export`. Unlike `/meta` (two separate handler bodies — REST +
  // dispatcher — which is why #6603's gate had to be re-added by #7019), every
  // `/packages` transport (the dispatcher-plugin explicit mounts, the hono
  // catch-all, and the legacy `HttpDispatcher.handlePackages` method) converges on
  // ONE handler body, `handlePackagesRequest`, so a single domain-wide gate there
  // covers them all.
  { id: 'anonymous-deny-packages', summary: 'anonymous-deny on the package-management surface (#7033 / #7023)', state: 'enforced',
    enforcement: 'runtime/domains/packages.ts handlePackagesRequest — shouldDenyAnonymous DOMAIN-WIDE as the handler\'s FIRST statement, ahead of the ObjectQL registry probe so the 401-vs-503 difference cannot fingerprint whether the package service is mounted; per-route capability predicates run after this floor — `manage_metadata` for every state-changing route (install / enable / disable / publish / publish-drafts / discard-drafts / commit-revert / rollback / revert / adopt-orphans / duplicate / manifest-PATCH / DELETE), and the ADR-0106 D4 read set (`studio.access` / `setup.access`) for every read (list / detail / commits / export)',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['packages:domains/packages.ts:anonymous-gate'],
    note: 'Ungated, a guest-principal caller reached the whole domain: `GET /packages` (the id ENUMERATION face — first step of the chain), `GET /packages/:id/export` (27 metadata types read whole), and — destructively — `POST /packages/:id/discard-drafts` (drop every pending draft) and `POST /packages/:id/publish-drafts` (promote every draft to active + load seed rows + flip ADR-0045 visibility). Gating the DOMAIN rather than each route keeps a newly added package route from arriving ungated. Engine-internal / SDK internal calls never enter this HTTP handler. The per-route capability gates are unit-pinned in runtime/domains/packages-capability-gate.test.ts.' },

  // ── #2992 / ADR-0096 D4 — latent execution surfaces (pre-wiring identity
  // admission). Neither surface is reachable by a client today; these rows
  // register their identity posture NOW so the ratchet (see the probes +
  // transport tripwires in authz-conformance.test.ts) blocks wiring a client
  // transport without the identity story — in CI, not in an adversarial
  // review after the fact.
  { id: 'realtime-delivery-authz', summary: 'realtime delivery fan-out has NO per-recipient authorization — trusted server-internal subscribers only (#2992 surface 2)', state: 'experimental',
    covers: ['realtime:in-memory-realtime-adapter.ts:publish(trusted-fan-out)'],
    note: 'Surface posture: system (trusted-implicit), pre-wiring — no end-user transport exists (handleUpgrade unimplemented, no REST subscribe route, client RealtimeAPI is a placeholder); the only subscribers are server-internal plugins (webhook auto-enqueuer, knowledge sync). Structural defect: Subscription carries no principal, matchesSubscription filters only by object+eventTypes (RealtimeSubscriptionOptions.filter is declared but never read), and the engine publishes the FULL after-row — so any future external subscriber would receive record bodies cross-tenant that its own find would hide. ADMISSION REQUIREMENT before any WebSocket/SSE/subscribe transport ships: per-recipient RLS/FLS/tenant re-check on delivery (subscription carries the subscriber ExecutionContext) OR id-only payload + client re-fetch. The transport tripwire probes in authz-conformance.test.ts turn a wired transport into an UNCLASSIFIED surface → red CI until this row is upgraded with the enforcement site.' },

  // ── ADR-0096 — MCP execution-surface identity admission (#3167). The MCP
  // server exposes ObjectStack tool execution over two transports with DIFFERENT
  // identity postures; both are pinned here so a refactor can't silently change
  // either. (Corrects #3167's premise that the HTTP admission was missing — it
  // is wired; the real gap is the opt-in stdio transport.)
  { id: 'mcp-http-identity', summary: 'MCP HTTP surface (/api/v1/mcp) admits the caller identity — anonymous denied, OAuth scope-gated, caller ExecutionContext threaded to every tool\'s data op', state: 'enforced',
    enforcement: 'runtime/http-dispatcher.ts handleMcp — requires ec.userId||ec.isSystem (401 else, RFC 9728 WWW-Authenticate advertised when the OAuth track is live); OAuth-token provenance narrows the exposed tool families to the granted MCP scopes (403 on none, #2698); buildMcpBridge(context) threads the caller ExecutionContext into every bridge op (callData(..., ec)), and mcp-server-runtime.ts handleHttpRequest builds a fresh per-request McpServer from that principal-bound bridge (registerObjectTools/registerActionTools) — so RLS / FLS / tenant apply exactly as on REST /data',
    covers: ['mcp:http-dispatcher.ts:handleMcp', 'mcp:domains/mcp.ts:buildMcpBridge(context-threaded)'],
    proof: 'showcase-mcp-http-identity.dogfood.test.ts',
    note: 'The per-request principal-bound tool server is isolated from the long-lived UNSCOPED stdio server (see mcp-stdio-authority). HIGH-RISK, proven end-to-end (#3167 PR-B): the proof boots the real showcase + security + MCP plugin and drives POST /api/v1/mcp — an anonymous tools/call is 401 before any tool runs, and a member\'s query_records over the owner-private showcase_private_note returns ONLY their own rows (if the tool ran unscoped/system — the stdio posture — the other owner\'s rows would leak). Dropping the buildMcpBridge(context) threading (or building an unscoped/system bridge for HTTP) makes the context-threaded key STALE → red CI; a new sibling MCP data handler appears as an UNCLASSIFIED surface until a row covers it. Dispatcher-level unit coverage: http-dispatcher.mcp.test.ts (401, EC-to-bridge) + http-dispatcher.mcp-oauth.test.ts (scope 403).' },
  { id: 'mcp-stdio-authority', summary: 'MCP stdio transport admits an env-supplied API-key principal — RLS/FLS/tenant applied to record reads, fail-closed on a missing/invalid key, no `system` bypass (opt-in: autoStart / OS_MCP_STDIO_ENABLED=true + OS_MCP_STDIO_API_KEY)', state: 'enforced',
    enforcement: 'mcp/plugin.ts start() — when stdio auto-start is requested it resolves OS_MCP_STDIO_API_KEY through the SAME @objectstack/core chain as HTTP/REST (resolveStdioExecutionContext → resolveAuthzContext → resolveApiKeyPrincipal), builds the caller ExecutionContext, and threads it (re-resolved per call) into the record-reader passed to mcp-server-runtime.ts bridgeResources; record_by_id reads via ql.find(obj, { where:{id}, context }) so RLS/FLS/tenant apply exactly as on REST /data. FAIL-CLOSED: no key / no objectql / an unknown|revoked|expired|owner-less key throws and refuses to start stdio — there is no unscoped fallback and deliberately no OS_MCP_STDIO_IDENTITY=system bypass (full authority = a minted admin/service key; see ADR-0101).',
    covers: ['mcp:plugin.ts:stdio-principal-bound'],
    note: 'ADR-0101. Unlike the raw pre-ADR-0101 bridge (which fed the long-lived server the RAW metadata service + data engine with no ExecutionContext), record_by_id now reads only under a principal resolved from OS_MCP_STDIO_API_KEY, re-resolved per call so a revoked/expired key stops working live. Unit-proven in @objectstack/mcp plugin.test.ts (fail-closed: no key / no objectql / unresolvable key each refuse to start) + mcp-server-runtime.test.ts (record_by_id registered only with a principal-bound reader); the scoped read shares the exact ql.find({context}) enforcement path proven end-to-end by mcp-http-identity (showcase-mcp-http-identity.dogfood.test.ts) and the RLS fixtures. Dropping the principal binding (the resolveStdioExecutionContext threading) makes the stdio-principal-bound key STALE → red CI. NOT high-risk: driving a real stdio transport in-process is impractical, but the reader path is the same RLS-applying engine call the HTTP e2e already exercises.' },
  { id: 'default-profile', summary: 'app-declared default profile (isDefault)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts fallback resolution', proof: 'showcase-default-profile.dogfood.test.ts' },
  { id: 'readonly-static-write', summary: 'static `readonly: true` stripped from non-system UPDATE (#2948 / #3003) AND INSERT (#3043) payloads — neither a direct PATCH nor a direct POST can forge approval/status/amount columns the UI never renders', state: 'enforced',
    enforcement: 'UPDATE: objectql/engine.ts stripReadonlyFields on the single-id + multi-row paths (#2948, caller-supplied VALUES only — the entry snapshot carries the caller payload, so a server stamp survives whether the hook ADDED the key or OVERWROTE one the caller also sent, #5591). INSERT: metadata-protocol/protocol.ts strips read-only keys at the DataProtocol create INGRESS (createData / createManyData / batchData / cloneData) — the single seam every external REST/GraphQL/MCP create funnels through, while trusted internal engine.insert writers (better-auth adapter, metadata repo, seed loader) bypass it; stripped before the engine so the field re-derives its defaultValue. isSystem exempt on both; symmetric with the readonlyWhen strip',
    proof: 'showcase-static-readonly.dogfood.test.ts',
    note: 'The #3003 field report: `readonly: true` used to be UI-only, so a logged-in non-admin self-approved a 4-stage approval (approval_status/approval_stage/confirmed_total) with one same-session REST PATCH on a draft record — RECORD_LOCKED only guards pending flows, and the draft never entered one. #3043 is the INSERT face: the same non-admin could skip the draft entirely and POST a record already `approval_status:"approved"` — a step SHORTER than #3003, and one the UPDATE strip never reached. Enforced at the DATA-WRITE INGRESS (not the engine) so it covers every external caller — REST, the GraphQL/MCP dispatcher, bulk import — without stripping the internal writers that legitimately seed readonly columns on create (identity provisioning, provenance, event-log cursors). The strip is SILENT on both paths (HTTP 2xx, forged value dropped; a stripped INSERT field falls back to its defaultValue). `readonlyWhen` stays INSERT-exempt (a conditional lock needs a prior record). System-context writes (import, seed replay, migration) still seed readonly columns. Ingress unit proof in metadata-protocol protocol.readonly-insert.test.ts (forge stripped, default re-seeded, system context allowed, batch rows covered, internal engine.insert unaffected).' },

  // ── ADR-0057 — ERP authorization core (enforced + e2e proven) ──────────
  { id: 'scope-depth', summary: 'permission-grant access DEPTH (own/own_and_reports/unit/unit_and_below/org)', state: 'enforced',
    enforcement: 'plugin-security getEffectiveScope (stash) + plugin-sharing delegates HIERARCHY scopes to a pluggable IHierarchyScopeResolver (open: fail-closed to own; enterprise @objectstack/security-enterprise; reference resolver in this proof) — ADR-0057 D1', proof: 'showcase-scope-depth.dogfood.test.ts' },
  { id: 'declarative-rbac-seeding', summary: 'stack-declared roles + sharingRules seeded at boot (#2077)', state: 'enforced',
    enforcement: 'plugin-security bootstrapDeclaredPositions + plugin-sharing bootstrapDeclaredSharingRules — ADR-0057 D6', proof: 'showcase-declarative-rbac-seeding.dogfood.test.ts' },
  { id: 'declarative-permission-seeding', summary: 'stack-declared permission sets seeded into sys_permission_set with package provenance (packageId + managed_by)', state: 'enforced',
    enforcement: 'plugin-security bootstrapDeclaredPermissions — ADR-0086 D5 (managed_by:package re-seeded on boot/upgrade; env-authored platform/user/legacy rows never clobbered); provenance fields ADR-0086 D3 (spec PermissionSetSchema.packageId/managedBy + sys_permission_set.package_id/managed_by)', proof: 'showcase-permission-seeding.dogfood.test.ts',
    note: 'Closes the ADR-0078 inert-metadata violation for stack.permissions — declared sets were runtime-enforced via the registry but never materialized as records (invisible to the admin surface, uninstall undefined). This row pins the seeding so it cannot silently regress to inert.' },
  { id: 'rbac-role-assignment', summary: 'platform-owned RBAC assignment (sys_user_position, decoupled from better-auth membership)', state: 'enforced',
    enforcement: 'runtime/resolve-execution-context.ts reads sys_user_position (union sys_member.role) — ADR-0057 D4' },

  // ── Enforced (unit-proven; e2e proof is a follow-on) ───────────────────
  { id: 'object-crud', summary: 'object CRUD permissions', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts checkObjectPermission (fail-closed 403)' },
  { id: 'fls', summary: 'field-level security (read mask + write deny)', state: 'enforced',
    enforcement: 'plugin-security/field-masker.ts + detectForbiddenWrites' },
  { id: 'ownership-stamp', summary: 'owner_id auto-stamp on insert', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts (insert owner_id inject)' },
  { id: 'ownership-anchor-guard', summary: 'owner_id is system-managed for non-privileged writers — no client forge (insert) / transfer (update) without the transfer grant (#3004)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.5: insert forging a foreign owner is denied unless allowTransfer/modifyAllRecords (batch rows too); update carrying owner_id is a transfer/disown, denied without the grant — single-id no-op echo tolerated via pre-image compare, bulk change-set fails closed; isSystem exempt',
    proof: 'owner-anchor-and-bulk-writes.dogfood.test.ts' },
  { id: 'bulk-write-owner-scoping', summary: 'bulk (multi) update/delete are owner-scoped on OWD-private objects, not just single-id writes (#2982)', state: 'enforced',
    enforcement: 'objectql/engine.ts seeds opCtx.ast for no-single-id update/delete BEFORE the middleware chain and hands the composed AST to driver.updateMany/deleteMany, so plugin-sharing buildWriteFilter (owner-match + shares) and plugin-security RLS write filters actually bind bulk writes',
    proof: 'owner-anchor-and-bulk-writes.dogfood.test.ts' },
  { id: 'public-form-managed-anchors', summary: 'anonymous public-form submit cannot supply server-managed anchors (owner_id / organization_id / audit / id) — #3022', state: 'enforced',
    enforcement: 'spec/security/public-form.ts PUBLIC_FORM_SERVER_MANAGED_FIELDS shared by rest/rest-server.ts form routes (allow-list + schema/section/lookup exposure) AND plugin-security publicFormGrant branch (strips every insert row before the grant admits the write — the data-layer boundary the grant otherwise bypasses; complements the #3004 step 3.5 guard, which the grant short-circuits)',
    proof: 'showcase-public-form.dogfood.test.ts',
    note: 'Proof file carries the forged owner_id/organization_id submit case; the route-level matrix is covered unit-side in rest public-form-routes.test.ts + plugin-security security-plugin.test.ts (publicFormGrant strip suite).' },
  { id: 'record-share', summary: 'manual record shares (sys_record_share)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts buildReadFilter/canEdit' },
  { id: 'sharing-rules', summary: 'criteria sharing rules (recipients: user/team/position/unit_and_subordinates/business_unit)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-rule-service.ts (materialized into sys_record_share); every authorable recipient expands in expandRecipient. The never-enforced owner-type rules + group/guest recipients were removed from the authoring spec (ADR-0078; group renamed → team)', proof: 'showcase-bu-hierarchy-sharing.dogfood.test.ts' },
  { id: 'hierarchy-widening', summary: 'hierarchy widening — a unit + its subordinate units gain access', state: 'enforced',
    enforcement: 'plugin-sharing/business-unit-graph.ts BusinessUnitGraphService.expandUsers subtree (unit_and_subordinates recipient) — ADR-0057 D5 re-homed off the never-existent sys_position.parent. The narrower business_unit recipient resolves through expandUnitMembers (exactly one unit, no descent) and is pinned by the same proof file: #7807 narrowed the runtime to the declaration after both kinds shared one subtree walk',
    proof: 'showcase-bu-hierarchy-sharing.dogfood.test.ts' },
  { id: 'rls-compiler-fail-closed', summary: 'uncompilable RLS predicate is surfaced/denied, not dropped', state: 'enforced',
    enforcement: 'plugin-security/rls-compiler.ts compileFilter (drop + warn + RLS_DENY_FILTER) on the shape gate formula/rls-predicate.ts isSupportedRlsExpression — hoisted out of plugin-security in #4983 so lint/validate-rls-predicate-enforceability.ts can REJECT the same predicate at authoring time (ADR-0056 D4), from the one definition' },
  { id: 'system-permissions', summary: 'systemPermissions / tab-app gating', state: 'enforced',
    enforcement: 'rest/rest-server.ts filterAppForUser' },
  { id: 'secure-by-default-posture', summary: 'ADR-0066 ④ — sensitive system objects opt out of the wildcard grant (access.default: private)', state: 'enforced',
    enforcement: 'plugin-security/permission-evaluator.ts resolveObjectPermission (plain wildcard does not cover a private object) + posture-gated superuser bypass; declarations in platform-objects (sys_secret, sys_jwks, sys_verification, sys_oauth_access_token, sys_oauth_refresh_token, sys_device_code) + sys_scim_provider D3 capability gate',
    note: 'Primitive enforcement unit-proven in plugin-security/security-plugin.test.ts (ADR-0066 posture suite); the per-object declarations are pinned by platform-objects.test.ts "secure-by-default posture" so dropping the flag from a secret store fails CI, not review. Member self-service objects (sys_session, sys_api_key, sys_oauth_application, sys_two_factor) deliberately stay public-posture — the Account app reads them with a member context; row scoping (owner/tenant RLS + _self carve-outs) is their guard.' },
  { id: 'flow-run-as', summary: 'flow runAs — data nodes execute under the run\'s effective identity (#1888)', state: 'enforced',
    enforcement: 'service-automation/engine.ts runAs authorization envelope → runtime-identity.ts → builtin/crud-nodes.ts (runAs:\'system\' → RLS-bypassing; runAs:\'user\' → trigger identity, RLS enforced as that user)',
    proof: 'flow-runas.dogfood.test.ts',
    note: 'ADR-0049 originally classified runAs as roadmap M2, but #1888 implemented it for flow data nodes (create/update/delete/query run under the chosen identity). Also proven for scheduled flows in flow-runas-schedule.dogfood.test.ts.' },

  // ── ADR-0049 / #8613 — the RBAC grant catalogues' `active` switch ──────
  //
  // `sys_permission_set` and `sys_position` each ship a Deactivate action whose
  // confirmation dialog promises, in four locales, that access stops. Until
  // #8613 nothing in the resolution chain read the column, so deactivation
  // moved a badge in Setup and the assignments kept granting — the ADR-0049
  // declared-≠-enforced class, on the grant itself rather than on a catalogue
  // entry. Both are now enforced at RESOLUTION time (the placement ADR-0091
  // chose for validity windows, for the same reason: a security flag honoured
  // only by a cleanup job is an unenforced security property).
  //
  // ONE shared predicate, `isRowActive` (@objectstack/core), backs all three
  // readers so they cannot drift: explicitly deactivated, never "explicitly
  // active" — an ABSENT column keeps granting (rows predating the field are not
  // mass-revoked) and the 0/1 storage shape the primary driver returns is
  // judged as well as a literal `false`.
  //
  // [#8711] Both rows carry NO `covers`, and that is a statement about the
  // RATCHET, not an omission: `discover()` enumerates HTTP entry points from a
  // curated per-file probe table, and a predicate inside an existing resolver
  // adds no entry point — so neither flag could ever have surfaced as
  // UNCLASSIFIED during the whole period it was inert. These two rows restore
  // the ledger's stated invariant. [Resolved — maintainer ruling on #8711,
  // 2026-08-15] The invariant's advertised SCOPE is narrowed to what the
  // ratchet can check, not the ratchet widened to reach in-resolver
  // predicates like this one — widening was measured unachievable in general
  // form. See this file's header for the narrowed claim and the measured
  // numbers.
  { id: 'permission-set-active', summary: '`sys_permission_set.active` — a deactivated permission set grants nothing (ADR-0049 / #8613)', state: 'enforced',
    enforcement: 'core/security/resolve-authz-context.ts step 6b — isRowActive drops the row BEFORE any derivation, so a deactivated set contributes no name to `grants.permissions`, no systemPermissions and no tabPermissions, AND `hasPlatformAdminGrant` cannot be read off a deactivated `admin_full_access`; plugin-security/security-plugin.ts dbLoader applies the SAME predicate, which is the only place a set reached by NAME is judged (position names are commonly reused as set names, so an ACTIVE position carries a DEACTIVATED set\'s name that far); plugin-auth/last-admin-guard.ts carries `active` in PERMISSION_SET_STANDING_KEYS so deactivating the last admin set is judged as an emptying rather than read as a bootstrap window',
    note: 'Unit-proven; an e2e dogfood proof is a follow-on, the same disposition as the ADR-0105 block above and for the same reason — the flag is a predicate inside the grant resolver, not an HTTP surface, so there is no route for a dogfood boot to drive at it directly. core/security/resolve-authz-context.test.ts "[#8613] the `active` flag on the grant catalogues (ADR-0049)" covers the derivation half, including THE HIGH-BLAST-RADIUS CASE (a deactivated admin_full_access confers no PLATFORM_ADMIN) and that deactivating ONE set leaves the others granting; plugin-security/permission-set-active.test.ts covers the loader half, including THE REACHABILITY CASE (a position name reaching a deactivated set of the same name) plus its non-vacuous twin (the same request with the set ACTIVE does resolve); core/security/row-active.test.ts pins the predicate itself (absent grants, junk does not revoke, 0/1 deactivates). Deliberately NOT in HIGH_RISK: that list marks primitives guarding object data through a sibling HTTP entry point, and this one guards grant DERIVATION. The honest upgrade path is a real proof (seed a deactivated set, drive REST as its holder, observe the refusal), not re-citing a neighbouring file.' },
  { id: 'position-active', summary: '`sys_position.active` — a deactivated position grants nothing, and its name cannot resolve the grant one layer down (ADR-0049 / #8613)', state: 'enforced',
    enforcement: 'core/security/resolve-authz-context.ts step 6a — isRowActive gates BOTH halves, and only both hold it: (i) only ACTIVE position ids collect their `sys_position_permission_set` linkage, so a deactivated position carries no bound set; (ii) the deactivated NAME is dropped from `grants.positions`, because resolvePermissionSetsForContext requests positions as permission-set NAMES and a name left standing resolves the same grant one layer down',
    note: 'Only a name whose `sys_position` row is EXPLICITLY deactivated is dropped — a name with no row at all (`org_owner`, a membership-derived role, the built-in `everyone` audience anchor) has no flag to read and is untouched. Deliberately NOT a blanket revocation of the sets themselves: a set held via BOTH a deactivated position AND a direct user grant still resolves, since the direct grant is a different grant (resolve-authz-context.test.ts pins exactly that case). Symmetrically, the WRITE gates and blast-radius reads in plugin-security (assertAudienceAnchorBindingGate, setsBoundToPosition, the delegated-admin surfaces) stay UNFILTERED on purpose — dropping a deactivated row there would make a refused binding permitted, narrow a delegate\'s boundary, and make a deactivated position unmanageable. Unit-proven in core/security/resolve-authz-context.test.ts (a deactivated position stops granting its sets; an active one still grants; an absent column grants; the 0/1 shape deactivates; deactivating ONE position leaves the others granting) + core/security/row-active.test.ts. Not HIGH_RISK for the same reason as `permission-set-active`.' },

  // ── Experimental — declared, NOT enforced (ADR-0049/0056 D8) ───────────
  { id: 'field-encryption', summary: 'at-rest field encryption', state: 'experimental',
    note: 'no crypto provider reads the config; marked [EXPERIMENTAL] (D8). Deliberately KEPT (2026-07 D8 disposition): at-rest encryption is a real enterprise roadmap item with a stable schema shape — removing and re-adding would cost more (ADR-0087) than carrying it marked.' },

  // ── Removed — by ADR-0056 D8 "design+enforce or remove" (2026-07) ──────
  { id: 'agent-visibility', summary: 'AI agent `visibility` listing scope (#1901)', state: 'removed',
    note: 'REMOVED from spec (agent.zod.ts `visibility` deleted, #1901). Never enforced — the chat-access evaluator excluded it and the agent list route did not filter by it, so `private` never hid an agent. Unlike field-encryption it has NO stable schema shape to preserve: correct enforcement needs owner/org anchors that do not exist (agents carry no owner field; the `EXTERNAL` posture rung is never derived), so the semantics — not just the plumbing — are undesigned. Per D8 a security-shaped field that lies is dropped, not carried marked. `access`/`permissions` ARE enforced at the chat route (#1884); re-introduce `visibility` when the listing surface gains real owner/org semantics.' },
  { id: 'compliance-configs', summary: 'GDPR/HIPAA/PCI configs', state: 'removed',
    note: 'REMOVED from spec (system/compliance.zod.ts deleted). Compliance-grade config must never merely look live: a parsed-but-dead `gdpr:` block is a liability in an audit. A real compliance subsystem will be designed top-down (data-subject rights engine, retention enforcer) when scheduled.' },
  { id: 'data-masking', summary: 'role-based data masking', state: 'removed',
    note: 'REMOVED from spec (system/masking.zod.ts deleted). FLS (plugin-security field-masker) is the enforced field-visibility path; a masking/deny layer would be redesigned with the ADR-0066 ⑦/⑧ muting work anyway, so the dead config was pure drift risk.' },
  { id: 'rls-config-global', summary: 'global RLSConfig / RLSAuditEvent', state: 'removed',
    note: 'REMOVED from spec (rls.zod.ts — RLSConfigSchema/RLSAuditEventSchema/RLSAuditConfigSchema deleted). The enforced RLS path (plugin-security computeRlsFilter) never read them; per-policy RowLevelSecurityPolicySchema is the live surface and is unchanged.' },
  { id: 'requireAuth-removed', summary: 'anonymous access to object data is denied unconditionally (no opt-out)', state: 'enforced',
    enforcement: 'core/security/anonymous-deny.ts shouldDenyAnonymous — no `requireAuth` input; every seam denies an anonymous, non-system caller outside the control-plane allowlist. spec tombstones `api.requireAuth` (retiredKey).',
    note: 'ADR-0056 D2 → #3963: the `requireAuth: false` opt-out is RETIRED, not merely defaulted-on. Legitimate session-less surfaces survive by DECLARATION, not by posture: public-form submission (publicFormGrant), share-links (token → SYSTEM read), and public-book reads (audience:public, §6.7). A stack that mounts no auth now FAILS AT BOOT (cli/serve.ts, plugin-dev) instead of getting an explicit fail-open. [#7976] The `showcase-anonymous-deny.dogfood.test.ts` CITATION WAS DROPPED under mutual attribution — that file drives the platform default and observes 401, which is precisely what the `anonymous-deny` row (same file) already claims; it never authors `requireAuth: false`, never reads the spec tombstone and never boots an auth-less stack, so it cannot prove the distinguishing half of THIS row (that there is no opt-out). The retirement is pinned elsewhere and unit-side: the spec tombstone + the ADR-0087 conversion entry `stack.api.requireAuth` (conversions/registry.ts, which strips a surviving key) and rest/rest-auth-gate.test.ts. Not high-risk, so the row is sound without a dogfood proof; writing a real one (author `api: { requireAuth: false }` → expect the boot/authoring rejection) is the honest upgrade path, not re-citing the posture proof.' },

  // ── Removed — by ADR-0049 (roadmap M2) ─────────────────────────────────
  { id: 'allow-transfer-restore-purge', summary: 'transfer/restore/purge ops (RBAC gate pre-mapped)', state: 'removed',
    note: 'ADR-0049 → roadmap M2. #1883: the ops still do not exist in ObjectQL, but the evaluator PRE-MAPS them (OPERATION_TO_PERMISSION transfer/restore/purge → allowTransfer/allowRestore/allowPurge, modifyAllRecords bypass, unmapped destructive ops fail closed) — there is no ungated window when the ops ship. Unit-proven in plugin-security/security-plugin.test.ts.' },
];
