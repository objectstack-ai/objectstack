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
   * [#4586] The real HUMAN behind a write whose authorization subject is the
   * SYSTEM — **attribution only, never authorization**.
   *
   * The case it exists for: better-auth owns every write to the identity
   * tables (`sys_member`, `sys_user`, …) and its adapter runs them
   * `isSystem: true` **on purpose** — the route already authorized the action
   * under better-auth's own ACL (ADR-0092 D2 refuses user-context writes to
   * those tables outright). So the person who clicked *make admin* was known
   * exactly once, in the hook layer where the session exists, and was then
   * discarded: every `sys_member` role transition recorded "system" as its
   * actor. This field is the one hop that carries them through.
   *
   * **The invariant, and it is load-bearing:** nothing in the authorization
   * path reads this. It is not {@link userId} — that is the subject the
   * engine authorizes AS (RLS `current_user`, ownership stamps, permission
   * resolution). Promoting the attributed human to the write's authorization
   * subject would re-adjudicate a decision better-auth already made, opening
   * the second adjudication track ADR-0095 D3 closed. A context carrying only
   * this field authorizes exactly like a context carrying nothing —
   * ANONYMOUS, per ADR-0118 D2 ("absence is never system") — and a context
   * carrying it beside `isSystem: true` authorizes exactly like `isSystem`
   * alone. Attribution and authorization are separate fields on purpose.
   *
   * Relationship to {@link actor}: same intent (audit attribution), different
   * principal. `actor` is a LABEL for a caller that is not a user at all
   * (`svc:<name>`) and lands on `sys_audit_log.actor`; this is a real
   * `sys_user` id and lands on `sys_audit_log.user_id`, keeping that lookup
   * column joinable (ADR-0118 D1 — a user-lookup column holds an id or null,
   * never a sentinel). Absent = the write is genuinely machine-originated
   * (boot sync, migration, scheduled job) and records as `null`.
   *
   * Server-constructed only, never client-supplied — exactly like
   * {@link isSystem} and {@link flowRunId}. Surfaced to hooks as
   * `HookContext.provenance.attributedUserId`, deliberately NOT folded into
   * `session`: a hook that gates on `session.userId` must keep seeing "no
   * caller" here, because there is none.
   */
  attributedUserId: z.string().optional(),

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
   * [ADR-0105 D2] Every organization this principal currently holds a valid
   * membership in — the caller's **org access set**, resolved once by
   * `resolveAuthzContext` from `sys_member` under ADR-0091 validity windows.
   *
   * This is the read reach of the `group` tenancy posture, where the Layer 0
   * wall is `organization_id IN accessible_org_ids` (MOAC semantics: union
   * access across the member's organizations, no context switching). It is a
   * FIRST-CLASS authorization dimension, not a convenience: the wall compiler
   * reads it directly, and RLS policies may reference it as
   * `organization_id IN (current_user.accessible_org_ids)`.
   *
   * Relationship to {@link tenantId}: `tenantId` remains the ACTIVE
   * organization — the default write target and the UI's current context. In
   * `isolated` posture it also bounds reads (the wall is equality); in `group`
   * posture it does not — membership does. In `single` posture the set is
   * resolved but no wall consumes it.
   *
   * An authenticated principal with no valid membership resolves to an EMPTY
   * set, which fails the group wall closed (zero rows) — never fail-open.
   *
   * @example ['org_plant_a', 'org_plant_b', 'org_group_hq']
   */
  accessible_org_ids: z.array(z.string()).optional(),

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
   * Id of the automation flow RUN performing this operation, when the write
   * originates from a flow's data node. Server-constructed by the automation
   * engine at run setup and threaded through `resolveRunDataContext` — never
   * client-supplied, exactly like {@link isSystem} (this envelope is built from
   * the authenticated session, not from request input).
   *
   * Provenance, NOT authorization: it grants nothing on its own and no security
   * middleware keys on it. It exists so a hook can tell "the run that owns this
   * externalized state" from "an unrelated caller" — the approvals record lock
   * (#3456) uses it to let the run that opened a pending approval still write
   * its own target record, which `isSystem` cannot express for a
   * `runAs:'user'` run without elevating it.
   *
   * It may be the ONLY populated field of the envelope. A run that resolves no
   * principal (a schedule-triggered `runAs:'user'` run) passes exactly
   * `{ flowRunId }`: every principal gate keys on `isSystem`/`userId`/
   * `positions`/`permissions`, so such a context authorizes identically to no
   * context at all, and the run keeps the #1888 unscoped posture it already had
   * while becoming attributable (#3712). Surfaced to hooks as
   * `HookContext.provenance`, deliberately not folded into `session`.
   */
  flowRunId: z.string().optional(),

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
   * Skip the object's `state_machine` validation rule for this write — both the
   * `initialStates` entry check on insert and the `transitions` check on update
   * (#3479). Same engine behavior as {@link seedReplay}, but a GENERAL,
   * server-set flag for any CURATED write of established facts that is not seed
   * replay: notably a data import flagged "historical" (migrating a batch of
   * already-`closed` tickets or `closed_won` deals), where the FSM entry point
   * would otherwise reject every mid-lifecycle row.
   *
   * `seedReplay` is the seed-specific specialization (it also implies
   * {@link skipTriggers} semantics at its callers); this is the plain
   * skip-the-state-machine intent. The engine treats either flag identically.
   * Server-constructed only, never client-supplied — the REST import runner sets
   * it from the request's explicit `treatAsHistorical` option, gated so a normal
   * import still walks the FSM. SCOPE is identical to `seedReplay`: only the
   * `state_machine` rule is skipped; every other validation still runs.
   */
  skipStateMachine: z.boolean().optional(),

  /**
   * Preserve the ORIGINAL audit timeline for this write instead of stamping it
   * "now" (#3493, the other half of a "historical" import — {@link skipStateMachine}
   * covers the FSM half). When set:
   *
   *   - the built-in audit hook (`packages/objectql/src/plugin.ts`) treats
   *     `updated_at` / `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`),
   *     symmetric with how `created_at` / `created_by` already behave on insert,
   *     so a supplied historical last-modified survives instead of being
   *     overwritten with the import instant;
   *   - the static-`readonly` write strip (`stripReadonlyFields`) admits a
   *     WHITELIST — the audit/timestamp family (`created_at` / `created_by` /
   *     `updated_at` / `updated_by`) plus author-declared business `readonly`
   *     fields (`closed_at`, `resolved_by`, …) — so migrating established facts
   *     doesn't silently drop them on the upsert-update path. Platform-managed
   *     `system` columns OUTSIDE that family (`organization_id` / tenancy, and
   *     any generated column) STAY stripped: this reinstates a timeline, it is
   *     NOT a backdoor to forge tenancy;
   *   - the SQL driver's update stamp respects a supplied `updated_at` rather
   *     than force-advancing it to `now` (`DriverOptions.preserveAudit`).
   *
   * Opt-IN and server-constructed only, never client-supplied — the REST import
   * runner sets it from the request's explicit `treatAsHistorical` option, gated
   * so a NORMAL write still auto-stamps and strips as before. Permissions / RLS /
   * field-level security are unaffected: this changes only which audit/readonly
   * values the runtime overwrites, never who may write the record.
   */
  preserveAudit: z.boolean().optional().describe('Historical import: preserve the ORIGINAL audit timeline for this write instead of stamping it "now" (#3493). Opt-in and server-constructed only, never client-supplied. On the UPDATE path it admits a whitelist — the audit/timestamp family (created_at / created_by / updated_at / updated_by) plus author-declared business `readonly` fields — while platform-managed `system` columns (tenancy, generated) stay stripped. On INSERT the exemption does NOT apply (#6640): a create is stripped earlier, at the DataProtocol ingress, whose only exemption is `context.isSystem`, so a non-system create carrying `preserveAudit` still has those fields stripped and is warned (WARN) that the exemption is UPDATE-only — replaying archival readonly facts on create requires a system context. Permissions / RLS / field-level security are unaffected.'),

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

/**
 * The CALLER-SUPPLIED form of the execution envelope — any subset of it.
 *
 * `positions`/`permissions`/`isSystem` carry parse-time defaults, so they are
 * required in the parsed shape ({@link ExecutionContextParsed}) even though a
 * caller never has to write them. This is the *input* side: what a data
 * operation may actually be handed. Use it wherever a context arrives from a
 * caller rather than out of a parse — `options.context` and everything the
 * engine threads it into.
 *
 * Some callers have no principal to state at all: a system read passes
 * `{ isSystem: true }`, and a flow run with no resolvable identity passes
 * provenance alone (`{ flowRunId }`, #3712).
 *
 * Spelled `ExecutionContextInput` until protocol 17; ADR-0122 phase 2 moved the
 * author state onto the bare name and retired that synonym.
 */
export type ExecutionContext = z.input<typeof ExecutionContextSchema>;
/** Post-parse shape of {@link ExecutionContext} — defaults applied, transforms run (ADR-0122). */
export type ExecutionContextParsed = z.infer<typeof ExecutionContextSchema>;

