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
  /** Why it is experimental/removed, or a roadmap pointer. */
  note?: string;
}

export const AUTHZ_CONFORMANCE: AuthzPrimitive[] = [
  // ── Enforced + end-to-end proven ───────────────────────────────────────
  { id: 'rls-read', summary: 'RLS `using` read filter', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeRlsFilter (AND-injected)', proof: 'rls-fixture.dogfood.test.ts' },
  { id: 'rls-by-id-write', summary: 'by-id write enforcement (#1994)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts pre-image re-read', proof: 'rls-fixture.dogfood.test.ts' },
  { id: 'owd-private', summary: 'OWD private (owner-only)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts effectiveSharingModel=private', proof: 'showcase-private-owd.dogfood.test.ts' },
  { id: 'owd-public-read', summary: 'OWD public_read (everyone reads, owner writes)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts (read model + canEdit)', proof: 'showcase-public-read-owd.dogfood.test.ts' },
  { id: 'controlled-by-parent', summary: 'master-detail controlled_by_parent', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts computeControlledByParentFilter + assertControlledByParentWrite', proof: 'controlled-by-parent.dogfood.test.ts' },
  { id: 'multi-tenant', summary: 'organization isolation', state: 'enforced',
    enforcement: 'plugin-org-scoping + wildcard tenant RLS', proof: 'rls-multitenant.dogfood.test.ts' },
  { id: 'anonymous-deny', summary: 'secure-by-default anonymous posture (capability)', state: 'enforced',
    enforcement: 'rest/rest-server.ts enforceAuth (requireAuth)', proof: 'showcase-anonymous-deny.dogfood.test.ts' },
  { id: 'default-profile', summary: 'app-declared default profile (isDefault)', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts fallback resolution', proof: 'showcase-default-profile.dogfood.test.ts' },

  // ── Enforced (unit-proven; e2e proof is a follow-on) ───────────────────
  { id: 'object-crud', summary: 'object CRUD permissions', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts checkObjectPermission (fail-closed 403)' },
  { id: 'fls', summary: 'field-level security (read mask + write deny)', state: 'enforced',
    enforcement: 'plugin-security/field-masker.ts + detectForbiddenWrites' },
  { id: 'ownership-stamp', summary: 'owner_id auto-stamp on insert', state: 'enforced',
    enforcement: 'plugin-security/security-plugin.ts (insert owner_id inject)' },
  { id: 'record-share', summary: 'manual record shares (sys_record_share)', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-service.ts buildReadFilter/canEdit' },
  { id: 'sharing-rules', summary: 'criteria/owner sharing rules', state: 'enforced',
    enforcement: 'plugin-sharing/sharing-rule-service.ts (materialized into sys_record_share)' },
  { id: 'role-hierarchy', summary: 'role-hierarchy widening (role_and_subordinates)', state: 'enforced',
    enforcement: 'plugin-sharing/role-graph.ts RoleGraphService (sys_role.parent)' },
  { id: 'rls-compiler-fail-closed', summary: 'uncompilable RLS predicate is surfaced/denied, not dropped', state: 'enforced',
    enforcement: 'plugin-security/rls-compiler.ts isSupportedRlsExpression + warn' },
  { id: 'system-permissions', summary: 'systemPermissions / tab-app gating', state: 'enforced',
    enforcement: 'rest/rest-server.ts filterAppForUser' },

  // ── Experimental — declared, NOT enforced (ADR-0049/0056 D8) ───────────
  { id: 'compliance-configs', summary: 'GDPR/HIPAA/PCI configs', state: 'experimental', note: 'no runtime consumer; marked [EXPERIMENTAL] (D8)' },
  { id: 'field-encryption', summary: 'at-rest field encryption', state: 'experimental', note: 'no crypto provider reads the config; marked [EXPERIMENTAL] (D8)' },
  { id: 'data-masking', summary: 'role-based data masking', state: 'experimental', note: 'FLS is the enforced field-visibility path; marked [EXPERIMENTAL] (D8)' },
  { id: 'rls-config-global', summary: 'global RLSConfig / RLSAuditEvent', state: 'experimental', note: 'not read by the RLS path; marked [EXPERIMENTAL] (D8)' },
  { id: 'requireAuth-default-flip', summary: 'flip the global requireAuth default to secure-by-default', state: 'experimental',
    note: 'D2 warn landed; the flip is release-gated. Pre-req: built-in guest_portal so public forms survive (share-links already read as SYSTEM after token validation, so they are safe).' },

  // ── Removed — by ADR-0049 (roadmap M2) ─────────────────────────────────
  { id: 'allow-transfer-restore-purge', summary: 'transfer/restore/purge ops', state: 'removed', note: 'ADR-0049 → roadmap M2' },
  { id: 'flow-run-as', summary: 'flow runAs', state: 'removed', note: 'ADR-0049 → roadmap M2' },
];
