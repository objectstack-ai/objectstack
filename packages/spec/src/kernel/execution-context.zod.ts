// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Execution Context Schema
 * 
 * Defines the runtime context that flows from HTTP request → data operations.
 * This is the "identity + environment" envelope that every data operation can carry.
 * 
 * Design:
 * - All fields are optional for backward compatibility
 * - `isSystem` bypasses permission checks (for internal/migration operations)
 * - `transaction` carries the database transaction handle for atomicity
 * - `traceId` enables distributed tracing across microservices
 * 
 * Usage:
 *   engine.find('account', { context: { userId: '...', tenantId: '...' } })
 */
import { lazySchema } from '../shared/lazy-schema';
import { AuthzPostureSchema } from '../security/explain.zod';
export const ExecutionContextSchema = lazySchema(() => z.object({
  /** Current user ID (resolved from session) */
  userId: z.string().optional(),

  /**
   * Stable principal label for AUDIT ATTRIBUTION when the operation is not a
   * real user — e.g. a service token (`svc:<name>`) or an automation. The audit
   * writer records this on `sys_audit_log.actor` so a non-user-authenticated
   * write (the class that left `user_id` null and made the os-790m7q env-delete
   * unattributable) is still attributable. `userId` takes precedence when set;
   * this is the fallback. The runtime/host sets it (e.g. the control plane's
   * service-mode auth) — the framework only defines + records the contract.
   */
  actor: z.string().optional(),

  /**
   * Current user's unique email (resolved from session, falling back to a
   * `sys_user` lookup). Exposed to RLS as `current_user.email` for seedable,
   * human-readable owner scoping. Unique by auth invariant — unlike display
   * `name`, which is intentionally not surfaced to RLS.
   */
  email: z.string().optional(),
  
  /** Current organization/tenant ID (resolved from session.activeOrganizationId) */
  tenantId: z.string().optional(),

  /**
   * Active reference timezone (IANA name, e.g. `America/New_York`), resolved
   * once per request from the `localization` settings (platform default →
   * global → tenant; ADR-0053 Phase 2). When unset, consumers treat it as
   * `UTC` — today's behavior.
   */
  timezone: z.string().optional(),

  /**
   * Active locale (BCP-47, e.g. `en-US`), resolved from the `localization`
   * settings alongside `timezone`. Drives message catalogs and number/date
   * formatting. When unset, consumers treat it as `en-US`.
   */
  locale: z.string().optional(),

  /**
   * Active default currency (ISO 4217, e.g. `USD`, `CNY`), resolved from the
   * `localization` settings alongside `timezone`/`locale`. The tenant-level
   * fallback applied when a currency field/measure omits its own (the
   * `localization.currency` manifest contract). Undefined when no tenant
   * default is configured — consumers then render a plain number.
   */
  currency: z.string().optional(),

  /**
   * Position names held by the user (ADR-0090 D3; resolved from
   * `sys_user_position` plus the built-in identity projection — the four
   * ADR-0068 org-membership names like `org_admin` are included so gating
   * predicates keep working). Formerly `roles`.
   */
  positions: z.array(z.string()).default([]),

  /**
   * [ADR-0090 D10 — P1 shape] Principal taxonomy. What KIND of caller this
   * is. Evaluation semantics phase in later (agent intersection, guest
   * position, service lints); the shape lands pre-launch so every API
   * carries it from day one. Absent = 'human'.
   */
  principalKind: z.enum(['human', 'agent', 'service', 'guest', 'system']).optional(),

  /**
   * [ADR-0090 D10/D11 — P1 shape] Whether the principal is an internal org
   * member or an external (portal/partner) identity. Externals evaluate
   * against `externalSharingModel` and skip the BU depth axis. Absent =
   * 'internal'.
   */
  audience: z.enum(['internal', 'external']).optional(),

  /**
   * [ADR-0095 D2/B2 — posture ladder] The monotonic authorization rung the
   * principal evaluated at (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER > EXTERNAL`),
   * derived once by the shared authz resolver from capability grants — never a
   * better-auth role. Carried here so enforcement/explain read the SAME derived
   * value instead of each re-deriving it (the divergence #2949 patched at the
   * explain boundary; #2947 closes the enforcement-boundary drop). Additive and
   * behavior-preserving: no enforcement decision consumes it yet — whether the
   * hot path evaluates BY posture is a larger ADR-level decision. Absent for
   * contexts resolved before the ladder existed or where no principal resolved.
   */
  posture: AuthzPostureSchema.optional(),

  /**
   * [ADR-0090 D10 — P1 shape] Delegation link for agent/service principals
   * acting on behalf of a user. Agent effective permission = the agent's own
   * grants ∩ the delegator's grants (confused-deputy prevention; enforced
   * when agent evaluation lands).
   */
  onBehalfOf: z.object({
    userId: z.string(),
    principalKind: z.enum(['human', 'agent', 'service', 'guest', 'system']).optional(),
  }).optional(),
  
  /** Aggregated permission names (resolved from PermissionSet) */
  permissions: z.array(z.string()).default([]),

  /**
   * Aggregated system permissions (union of `PermissionSet.systemPermissions`
   * across the user's resolved permission sets). Used to gate app
   * entry (`AppSchema.requiredPermissions`) and system-level capabilities
   * like `manage_users`, `studio.access`, `setup.access`.
   */
  systemPermissions: z.array(z.string()).optional(),

  /**
   * Aggregated tab/app visibility overrides (merged most-permissive across
   * the user's resolved permission sets: visible > default_on > default_off > hidden).
   * Keyed by app name. A `hidden` value forces an app off the user's
   * authorized list even if `requiredPermissions` would otherwise pass.
   */
  tabPermissions: z.record(z.string(), z.enum(['visible', 'hidden', 'default_on', 'default_off'])).optional(),

  /**
   * IDs of all users in the active organization. Pre-resolved so RLS
   * expressions can scope visibility of identity tables (`sys_user`)
   * via `IN (current_user.org_user_ids)` without needing subquery
   * support in the RLS compiler. Populated by the runtime's
   * resolveExecutionContext from `sys_member`.
   */
  org_user_ids: z.array(z.string()).optional(),

  /**
   * Pre-resolved dynamic-membership arrays for RLS (§7.3.1). The runtime
   * resolves set-membership that would otherwise need a subquery — team
   * members under a manager, accounts in a sales rep's territories,
   * records shared with the user — and stages each set here under a
   * stable key. RLS policies then reference a key via
   * `field IN (current_user.<key>)`, which the compiler resolves against
   * this bag without any subquery support.
   *
   * `org_user_ids` is the one well-known, always-populated membership set
   * and stays a named field for back-compat; everything else lives here.
   * Keys are arbitrary `current_user.*` names; values are id arrays. A
   * missing or empty array makes the referencing policy drop out and
   * (if it was the only policy) fail closed — never fail open.
   *
   * @example { team_member_ids: ['u2', 'u3'], territory_account_ids: ['a7'] }
   */
  rlsMembership: z.record(z.string(), z.array(z.string())).optional(),

  /** Whether this is a system-level operation (bypasses permission checks) */
  isSystem: z.boolean().default(false),

  /**
   * Suppress record-change AUTOMATION (autolaunched flow triggers:
   * record-after-insert / -update / -delete) for writes made under this
   * context. Lifecycle HOOKS still run (derived/default fields, validation).
   *
   * Set by bulk/reference loads — notably package metadata SEED replay — where
   * the records are pre-existing END-STATE data, not user events: firing
   * "on create/update" automation (notifications, escalations, assignments,
   * approvals) for seed rows is semantically wrong AND dangerous. The
   * 2026-07-06 incident was a seeded critical case whose escalation flow
   * self-triggered into an infinite loop that wedged the whole kernel build.
   */
  skipTriggers: z.boolean().optional(),

  /**
   * Suppress metadata-bound AUTOMATION entirely for writes made under this
   * context: lifecycle hooks bound from metadata (`bindHooksToEngine`) are
   * skipped by the engine's `triggerHooks`, and record-change flow dispatch
   * is suppressed too (implies {@link skipTriggers}). Hooks registered in
   * code by plugins — audit, capability gates, sharing projection — carry no
   * metadata binding and STILL run: this flag must never bypass security or
   * audit. Set by the data-import runner when the user opts out of
   * "run automations & triggers", and by import undo (reversing writes must
   * not re-fire automation).
   */
  skipAutomations: z.boolean().optional(),

  /**
   * True when this write is CURATED SEED data being (re)loaded by the seed
   * loader — a package's bootstrap/demo dataset, not a user-initiated event.
   * Set only by `SeedLoaderService` (server-constructed, never client-supplied,
   * exactly like {@link isSystem}).
   *
   * A seed is a Salesforce-sandbox-style snapshot of established facts: an
   * opportunity that is already `closed_won`, a case already `closed`, a
   * project already `completed`. It is NOT the record flowing through its
   * lifecycle. So the object's `state_machine` validation rule — the FSM
   * ENTRY-POINT check on insert (`initialStates`, #3165) and the TRANSITION
   * check on update — does not apply and is skipped for these writes. Without
   * this exemption a declared `initialStates` silently rejects every
   * mid-lifecycle seed row (and cascades its master-detail children), which is
   * why marketplace templates and heal/replay "installed but no data" (#3433).
   *
   * SCOPE: skips ONLY the `state_machine` rule. Every other validation
   * (field shape, `format`, `json_schema`, `cross_field`, `script`,
   * `conditional`) still runs — a seed with a malformed email or an
   * over-budget spend is a genuine bug worth catching. Automation is a
   * SEPARATE concern handled by {@link skipTriggers} (also set for seeds).
   */
  seedReplay: z.boolean().optional(),

  /**
   * OAuth 2.1 scopes granted to the access token that authenticated this
   * request, when the principal was resolved from an OAuth bearer token
   * (the MCP surface's human-client track, #2698). UNDEFINED for every
   * other provenance (session cookie, API key) — consumers must treat
   * "undefined" as "not scope-limited" and a present-but-empty array as
   * "no scopes granted" (fail-closed). Scopes only narrow the exposed tool
   * surface; permissions/RLS still bind every operation to the principal.
   */
  oauthScopes: z.array(z.string()).optional(),

  /** Raw access token (for external API call pass-through) */
  accessToken: z.string().optional(),
  
  /** Database transaction handle */
  transaction: z.unknown().optional(),
  
  /** Request trace ID (for distributed tracing) */
  traceId: z.string().optional(),
}));

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
