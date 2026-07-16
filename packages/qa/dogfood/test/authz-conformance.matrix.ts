// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D10 — Authorization Conformance Matrix.
//
// The durable encoding of the ADR-0056 audit: one row per authorization
// primitive, each in EXACTLY ONE honest state (enforced / experimental /
// removed). `enforced` rows name their runtime enforcement site; high-risk
// enforced rows additionally reference an end-to-end dogfood proof. The
// companion test (`authz-conformance.test.ts`) asserts the matrix is complete
// and that every referenced proof file exists — so "the permission model is
// landed" is a CHECKED artifact, not a one-time scan. A new fail-open (a
// declared-but-unenforced primitive) or a deleted proof breaks CI.

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
    enforcement: 'plugin-security/security-plugin.ts pre-image re-read', proof: 'rls-fixture.dogfood.test.ts' },
  { id: 'rls-write-check', summary: 'RLS `check` write post-image validation (ADR-0058 D4)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.6 — compileCelToFilter + matchesFilterCondition against the post-image (fail-closed)',
    note: 'Unit-proven in plugin-security/security-plugin.test.ts (RLS check enforcement); see ADR-0058 D7 ledger.' },
  { id: 'owd-private', summary: 'OWD private (owner-only)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts effectiveSharingModel=private', proof: 'showcase-private-owd.dogfood.test.ts' },
  { id: 'owd-public-read', summary: 'OWD public_read (everyone reads, owner writes)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts (read model + canEdit)', proof: 'showcase-public-read-owd.dogfood.test.ts' },
  { id: 'controlled-by-parent', summary: 'master-detail controlled_by_parent', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeControlledByParentFilter + assertControlledByParentWrite', proof: 'controlled-by-parent.dogfood.test.ts' },
  { id: 'multi-tenant', summary: 'organization isolation', state: 'enforced',
    enforcement: '@objectstack/organizations (enterprise) + Layer 0 tenant wall (plugin-security/tenant-layer.ts, AND-composed ahead of business RLS — ADR-0095 D1)', proof: 'rls-multitenant.dogfood.test.ts' },
  { id: 'multi-tenant-write-postimage', summary: 'Layer 0 tenant post-image check on INSERT + UPDATE (#2937 / Finding 1 — a forged OR re-pointed organization_id cannot cross the tenant wall)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts step 3.7 — computeWriteTenantCheckFilter (reuses computeLayeredRlsFilter\'s Layer 0) matched against the write post-image (fail-closed) for BOTH insert and update; enterprise auto-stamp authoritatively overwrites a user-context organization_id (@objectstack/organizations Middleware A)',
    note: 'INSERT has no pre-image and UPDATE\'s pre-image (step 2.7) validates only the OLD organization_id, so the AND-composed Layer 0 wall never inspected the NEW value: a member could INSERT a forged cross-tenant organization_id (#2937) or UPDATE a row to RE-POINT it into a victim tenant (Finding 1, BLOCKER). A supplied cross-tenant organization_id is now DENIED on both paths — organization_id is effectively immutable in non-platform user contexts (platform-admin posture on a posture-permitting object + single-mode exempt, same rule as the read side). Unit-proven in plugin-security/authz-matrix-gate.test.ts ([#2937] insert + [Finding 1 / #2937] update post-image tenant guard). Multi-org is enterprise-only so it is not in the open-core dogfood boot; see ADR-0095 D1.' },
  { id: 'multi-tenant-exemption-posture', summary: 'Layer 0 cross-tenant exemption requires the PLATFORM_ADMIN posture (Finding 2 — org_admin does not cross the wall)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts hasPlatformAdminPosture (platform-exclusive systemPermissions) gates the tenant-layer.ts Layer 0 exemption; the superuser bit (viewAllRecords/modifyAllRecords) governs only the Layer 1 business-RLS short-circuit',
    note: 'An organization_admin holds the superuser bit via its `*` wildcard, so it used to also get the Layer 0 exemption and read/write EVERY tenant\'s rows on private tenant objects. The exemption now requires a platform-exclusive capability (manage_metadata/manage_platform_settings/studio.access/manage_users), which org_admin deliberately lacks — a SECURITY NARROWING: org admin is walled to its own org, a true platform admin still crosses, the better-auth carve-out is untouched. Unit-proven in plugin-security/authz-matrix-gate.test.ts ([Finding 2 / #2937] Layer 0 cross-tenant exemption requires the platform posture).' },
  { id: 'anonymous-deny', summary: 'secure-by-default anonymous posture (capability)', state: 'enforced',
    enforcement: 'rest/rest-server.ts enforceAuth (requireAuth)', proof: 'showcase-anonymous-deny.dogfood.test.ts' },
  // ── #2567 — the anonymous-deny posture is UNIFORM across HTTP surfaces, not
  // just REST `/data`. Each sibling surface that reaches ObjectQL now consults
  // the same `requireAuth` gate; these rows pin every entry point so a new
  // ungated surface (or a silent regression) fails CI, not review.
  { id: 'anonymous-deny-meta', summary: 'anonymous-deny on the metadata endpoints (#2567 surface 1)', state: 'enforced',
    enforcement: 'rest/rest-server.ts registerMetadataEndpoints guarded registrar (enforceAuth → shouldDenyAnonymous) — every /meta route inherits the gate; runtime/http-dispatcher.ts handleMetadata mirrors it for the dispatcher metadata catch-all',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['meta:rest-server.ts:registerMetadataEndpoints', 'meta:http-dispatcher.ts:handleMetadata'] },
  { id: 'anonymous-deny-graphql', summary: 'anonymous-deny on the dispatcher GraphQL endpoint (#2567 surface 2)', state: 'enforced',
    enforcement: 'runtime/http-dispatcher.ts handleGraphQL (shouldDenyAnonymous, resolves identity for the direct /graphql route) + runtime/dispatcher-plugin.ts requireAuth default(true), mirroring rest-server.ts',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['graphql:http-dispatcher.ts:handleGraphQL', 'graphql:dispatcher-plugin.ts:POST /api/v1/graphql'],
    note: 'GraphQL reaches the same object data as /data through kernel.graphql, whose security middleware falls OPEN for an anonymous context. Unit-proven in runtime/http-dispatcher.requireauth.test.ts (GraphQL block); e2e on the platform default in the surfaces proof.' },
  { id: 'anonymous-deny-hono-data', summary: 'anonymous-deny on the raw-hono standard /data routes (#2567 surface 3)', state: 'enforced',
    enforcement: 'plugin-hono-server/hono-plugin.ts denyAnonymous gate (shouldDenyAnonymous) on the standard /data routes (requireAuth ?? true, mirroring rest-server.ts)',
    proof: 'showcase-anonymous-deny-surfaces.dogfood.test.ts',
    covers: ['data:hono-plugin.ts:POST /data/:object', 'data:hono-plugin.ts:GET /data/:object/:id', 'data:hono-plugin.ts:GET /data/:object'],
    note: 'These routes delegate straight to ObjectQL and were only shadowed when the REST plugin registered the same paths FIRST — so the posture depended on plugin registration order (a load-order change silently reopened it, no test failing). Gating each route makes the deny decision a property of this entry point too. Handler-level proof in plugin-hono-server/hono-anonymous-deny.test.ts.' },

  // ── #2992 / ADR-0096 D4 — latent execution surfaces (pre-wiring identity
  // admission). Neither surface is reachable by a client today; these rows
  // register their identity posture NOW so the ratchet (see the probes +
  // transport tripwires in authz-conformance.test.ts) blocks wiring a client
  // transport without the identity story — in CI, not in an adversarial
  // review after the fact.
  { id: 'graphql-identity-thread', summary: 'GraphQL entry point threads the caller identity to the engine (#2992 surface 1, ADR-0096 D1)', state: 'enforced',
    enforcement: 'runtime/http-dispatcher.ts handleGraphQL — resolves the caller ExecutionContext (also on the direct dispatcher-plugin route, requireAuth on or off) and threads it as options.context on every kernel.graphql call; spec IGraphQLService.execute documents that implementations MUST forward it to ObjectQL as options.context',
    covers: ['graphql:http-dispatcher.ts:kernel.graphql(context-threaded)'],
    note: 'Surface posture: user (caller identity), latent — kernel.graphql is never assigned in the monorepo, so every POST /graphql 501s before an engine call; the only IGraphQLService is the plugin-dev stub. The threading exists so the FIRST real engine runs caller-scoped instead of context-less (the security middleware falls OPEN on a missing principal = full authority). Threading unit-proven in runtime/http-dispatcher.requireauth.test.ts (identity threading block); removing it goes STALE here and fails CI.' },
  { id: 'realtime-delivery-authz', summary: 'realtime delivery fan-out has NO per-recipient authorization — trusted server-internal subscribers only (#2992 surface 2)', state: 'experimental',
    covers: ['realtime:in-memory-realtime-adapter.ts:publish(trusted-fan-out)'],
    note: 'Surface posture: system (trusted-implicit), pre-wiring — no end-user transport exists (handleUpgrade unimplemented, no REST subscribe route, client RealtimeAPI is a placeholder); the only subscribers are server-internal plugins (webhook auto-enqueuer, knowledge sync). Structural defect: Subscription carries no principal, matchesSubscription filters only by object+eventTypes (RealtimeSubscriptionOptions.filter is declared but never read), and the engine publishes the FULL after-row — so any future external subscriber would receive record bodies cross-tenant that its own find would hide. ADMISSION REQUIREMENT before any WebSocket/SSE/subscribe transport ships: per-recipient RLS/FLS/tenant re-check on delivery (subscription carries the subscriber ExecutionContext) OR id-only payload + client re-fetch. The transport tripwire probes in authz-conformance.test.ts turn a wired transport into an UNCLASSIFIED surface → red CI until this row is upgraded with the enforcement site.' },
  { id: 'default-profile', summary: 'app-declared default profile (isDefault)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts fallback resolution', proof: 'showcase-default-profile.dogfood.test.ts' },
  { id: 'readonly-static-write', summary: 'static `readonly: true` stripped from non-system UPDATE payloads (#2948 / #3003 — a direct PATCH cannot forge approval/status/amount columns the UI never renders)', state: 'enforced',
    enforcement: 'objectql/engine.ts update — stripReadonlyFields on both the single-id and multi-row paths (caller-supplied keys only, so audit-hook/middleware server stamps survive; isSystem exempt; symmetric with the readonlyWhen strip)',
    proof: 'showcase-static-readonly.dogfood.test.ts',
    note: 'The #3003 field report: `readonly: true` used to be UI-only, so a logged-in non-admin self-approved a 4-stage approval (approval_status/approval_stage/confirmed_total) with one same-session REST PATCH on a draft record — RECORD_LOCKED only guards pending flows, and the draft never entered one. The strip is SILENT (HTTP 200, persisted value kept — reject-vs-strip decided in #2948 for readonlyWhen symmetry). INSERT is deliberately exempt (create may seed a readonly column: defaultValue, import, migration), also symmetric with readonlyWhen. Engine-level unit/integration proof in objectql/plugin.integration.test.ts (#2948 suite: forge stripped, server stamp survives, system context allowed).' },

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
  { id: 'sharing-rules', summary: 'criteria/owner sharing rules', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-rule-service.ts (materialized into sys_record_share)', proof: 'showcase-bu-hierarchy-sharing.dogfood.test.ts' },
  { id: 'hierarchy-widening', summary: 'hierarchy widening — a unit + its subordinate units gain access', state: 'enforced',
    enforcement: 'plugin-sharing/business-unit-graph.ts BusinessUnitGraphService subtree (business_unit recipient) — ADR-0057 D5 re-homed off the never-existent sys_position.parent', proof: 'showcase-bu-hierarchy-sharing.dogfood.test.ts' },
  { id: 'rls-compiler-fail-closed', summary: 'uncompilable RLS predicate is surfaced/denied, not dropped', state: 'enforced',
    enforcement: 'plugin-security/rls-compiler.ts isSupportedRlsExpression + warn' },
  { id: 'system-permissions', summary: 'systemPermissions / tab-app gating', state: 'enforced',
    enforcement: 'rest/rest-server.ts filterAppForUser' },
  { id: 'secure-by-default-posture', summary: 'ADR-0066 ④ — sensitive system objects opt out of the wildcard grant (access.default: private)', state: 'enforced',
    enforcement: 'plugin-security/permission-evaluator.ts resolveObjectPermission (plain wildcard does not cover a private object) + posture-gated superuser bypass; declarations in platform-objects (sys_secret, sys_jwks, sys_verification, sys_oauth_access_token, sys_oauth_refresh_token, sys_device_code) + sys_scim_provider D3 capability gate',
    note: 'Primitive enforcement unit-proven in plugin-security/security-plugin.test.ts (ADR-0066 posture suite); the per-object declarations are pinned by platform-objects.test.ts "secure-by-default posture" so dropping the flag from a secret store fails CI, not review. Member self-service objects (sys_session, sys_api_key, sys_oauth_application, sys_two_factor) deliberately stay public-posture — the Account app reads them with a member context; row scoping (owner/tenant RLS + _self carve-outs) is their guard.' },

  // ── Experimental — declared, NOT enforced (ADR-0049/0056 D8) ───────────
  { id: 'field-encryption', summary: 'at-rest field encryption', state: 'experimental',
    note: 'no crypto provider reads the config; marked [EXPERIMENTAL] (D8). Deliberately KEPT (2026-07 D8 disposition): at-rest encryption is a real enterprise roadmap item with a stable schema shape — removing and re-adding would cost more (ADR-0087) than carrying it marked.' },
  { id: 'agent-visibility', summary: 'AI agent `visibility` listing scope (#1901)', state: 'experimental',
    note: 'Intentionally NOT enforced — the chat-access evaluator excludes it (service-ai agent-access.ts) and the agent list route does not filter by it. Schema + authoring form carry EXPERIMENTAL banners (2026-07) so authors are told `private` does not hide the agent; `access`/`permissions` ARE enforced at the chat route (#1884). Enforce when the agent listing surface gains owner/org semantics — #1901.' },

  // ── Removed — by ADR-0056 D8 "design+enforce or remove" (2026-07) ──────
  { id: 'compliance-configs', summary: 'GDPR/HIPAA/PCI configs', state: 'removed',
    note: 'REMOVED from spec (system/compliance.zod.ts deleted). Compliance-grade config must never merely look live: a parsed-but-dead `gdpr:` block is a liability in an audit. A real compliance subsystem will be designed top-down (data-subject rights engine, retention enforcer) when scheduled.' },
  { id: 'data-masking', summary: 'role-based data masking', state: 'removed',
    note: 'REMOVED from spec (system/masking.zod.ts deleted). FLS (plugin-security field-masker) is the enforced field-visibility path; a masking/deny layer would be redesigned with the ADR-0066 ⑦/⑧ muting work anyway, so the dead config was pure drift risk.' },
  { id: 'rls-config-global', summary: 'global RLSConfig / RLSAuditEvent', state: 'removed',
    note: 'REMOVED from spec (rls.zod.ts — RLSConfigSchema/RLSAuditEventSchema/RLSAuditConfigSchema deleted). The enforced RLS path (plugin-security computeRlsFilter) never read them; per-policy RowLevelSecurityPolicySchema is the live surface and is unchanged.' },
  { id: 'requireAuth-default-flip', summary: 'global requireAuth default is secure-by-default (deny anonymous)', state: 'enforced',
    enforcement: 'spec/api/rest-server.zod.ts requireAuth default(true) + rest/rest-server.ts normalizeConfig ?? true; explicit requireAuth:false opt-out warns at boot (rest-api-plugin)',
    proof: 'showcase-anonymous-deny.dogfood.test.ts',
    note: 'ADR-0056 D2 flip LANDED. The verify harness boots on the platform default (no override), so anonymous-deny AND public-form survival (showcase-public-form.dogfood.test.ts — the publicFormGrant pre-req that unblocked the flip) are proven on the default posture. Share-links read as SYSTEM after token validation. CLI carve-out: auth-less stacks get an explicit fail-open (warned).' },

  // ── Removed — by ADR-0049 (roadmap M2) ─────────────────────────────────
  { id: 'allow-transfer-restore-purge', summary: 'transfer/restore/purge ops (RBAC gate pre-mapped)', state: 'removed',
    note: 'ADR-0049 → roadmap M2. #1883: the ops still do not exist in ObjectQL, but the evaluator PRE-MAPS them (OPERATION_TO_PERMISSION transfer/restore/purge → allowTransfer/allowRestore/allowPurge, modifyAllRecords bypass, unmapped destructive ops fail closed) — there is no ungated window when the ops ship. Unit-proven in plugin-security/security-plugin.test.ts.' },
  { id: 'flow-run-as', summary: 'flow runAs', state: 'removed', note: 'ADR-0049 → roadmap M2' },
];
