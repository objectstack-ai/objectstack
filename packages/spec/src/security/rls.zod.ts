// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';

/**
 * # Row-Level Security (RLS) Protocol
 * 
 * Implements fine-grained record-level access control inspired by PostgreSQL RLS
 * and Salesforce Criteria-Based Sharing Rules.
 * 
 * ## Overview
 * 
 * Row-Level Security (RLS) allows you to control which rows users can access
 * in database tables based on their identity and positions. Unlike
 * object-level permissions (CRUD), RLS provides record-level filtering.
 * 
 * ## Use Cases
 * 
 * 1. **Multi-Tenant Data Isolation**
 *    - Users only see records from their organization
 *    - `using: "organization_id == current_user.organization_id"`
 * 
 * 2. **Ownership-Based Access**
 *    - Users only see records they own
 *    - `using: "owner_id == current_user.id"`
 * 
 * 3. **Organization Member Visibility**
 *    - Users see fellow members of their active organization
 *    - `using: "id in current_user.org_user_ids"`
 *      (`org_user_ids` is pre-resolved by the runtime)
 *
 * 4. **Territory / Regional Access (§7.3.1 dynamic membership)**
 *    - Sales reps only see accounts in their assigned territories
 *    - `using: "account_id in current_user.territory_account_ids"`
 *      (the runtime stages `territory_account_ids` in `ExecutionContext.rlsMembership`)
 *
 * 5. **Manager / Hierarchy Access (§7.3.1 dynamic membership)**
 *    - Managers see records assigned to anyone they manage
 *    - `using: "assigned_to_id in current_user.team_member_ids"`
 *      (the runtime pre-resolves `team_member_ids`, no subquery needed)
 * 
 * ## PostgreSQL RLS Comparison
 * 
 * PostgreSQL RLS Example:
 * ```sql
 * CREATE POLICY tenant_isolation ON accounts
 *   FOR SELECT
 *   USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
 * 
 * CREATE POLICY account_insert ON accounts
 *   FOR INSERT
 *   WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
 * ```
 * 
 * ObjectStack RLS Equivalent:
 * ```typescript
 * {
 *   name: 'tenant_isolation',
 *   object: 'account',
 *   operation: 'select',
 *   using: 'organization_id == current_user.organization_id'
 * }
 * ```
 * 
 * ## Salesforce Sharing Rules Comparison
 * 
 * Salesforce uses "Sharing Rules" and a visibility hierarchy for record-level
 * access (our equivalent hierarchy is the business-unit tree, ADR-0090 D3).
 * ObjectStack RLS provides similar functionality with more flexibility.
 *
 * Salesforce:
 * - Criteria-Based Sharing: Share records matching criteria with users/groups
 * - Owner-Based Sharing: Share records based on who owns them
 * - Manual Sharing: Individual record sharing
 * 
 * ObjectStack RLS:
 * - A constrained CEL predicate grammar: comparisons and set-membership against literals or `current_user.*` values, composable with `&&` / `||`; anything that does not lower to a filter fails closed
 * - Subquery-shaped needs are pre-resolved by the runtime (§7.3.1)
 * - Multiple policies OR-combine for union (any-match-allows) semantics
 * 
 * ## Best Practices
 * 
 * 1. **Always Define SELECT Policy**: Control what users can view
 * 2. **Define INSERT/UPDATE CHECK Policies**: Prevent data leakage
 * 3. **Use Position-Scoped Policies**: Apply different rules to different positions
 * 4. **Test Thoroughly**: RLS can have complex interactions
 * 5. **Monitor Performance**: Complex RLS policies can impact query performance
 * 
 * ## Security Considerations
 * 
 * 1. **Defense in Depth**: RLS is one layer; use with object permissions
 * 2. **Default Deny**: If no policy matches, access is denied
 * 3. **Policy Precedence**: More permissive policy wins (OR logic)
 * 4. **Context Variables**: Ensure current_user context is always set
 * 
 * @see https://www.postgresql.org/docs/current/ddl-rowsecurity.html
 * @see https://help.salesforce.com/s/articleView?id=sf.security_sharing_rules.htm
 */

/**
 * RLS Operation Enum
 * Specifies which database operation this policy applies to.
 * 
 * - **select**: Controls which rows can be read (SELECT queries)
 * - **insert**: Controls which rows can be inserted (INSERT statements)
 * - **update**: Controls which rows can be updated (UPDATE statements)
 * - **delete**: Controls which rows can be deleted (DELETE statements)
 * - **all**: Shorthand for all operations (equivalent to defining 4 separate policies)
 */
import { lazySchema } from '../shared/lazy-schema';
export const RLSOperation = z.enum(['select', 'insert', 'update', 'delete', 'all']);

export type RLSOperation = z.input<typeof RLSOperation>;

/**
 * Row-Level Security Policy Schema
 * 
 * Defines a single RLS policy that filters records based on conditions.
 * Multiple policies can be defined for the same object, and they are
 * combined with OR logic (union of results).
 * 
 * @example Multi-Tenant Isolation
 * ```typescript
 * {
 *   name: 'tenant_isolation',
 *   label: 'Multi-Tenant Data Isolation',
 *   object: 'account',
 *   operation: 'select',
 *   using: 'organization_id == current_user.organization_id',
 *   enabled: true
 * }
 * ```
 * 
 * @example Owner-Based Access
 * ```typescript
 * {
 *   name: 'owner_access',
 *   label: 'Users Can View Their Own Records',
 *   object: 'opportunity',
 *   operation: 'select',
 *   using: 'owner_id == current_user.id',
 *   enabled: true
 * }
 * ```
 * 
 * @example Manager Can View Team Records (§7.3.1 dynamic membership)
 * ```typescript
 * {
 *   name: 'manager_team_access',
 *   label: 'Managers Can View Team Records',
 *   object: 'task',
 *   operation: 'select',
 *   // The runtime resolves the manager's reports into
 *   // ExecutionContext.rlsMembership.team_member_ids — no subquery needed.
 *   using: 'assigned_to_id in current_user.team_member_ids',
 *   positions: ['manager', 'director'],
 *   enabled: true
 * }
 * ```
 * 
 * @example Prevent Cross-Tenant Data Insertion
 * ```typescript
 * {
 *   name: 'tenant_insert_check',
 *   label: 'Prevent Cross-Tenant Data Creation',
 *   object: 'account',
 *   operation: 'insert',
 *   check: 'organization_id == current_user.organization_id',
 *   enabled: true
 * }
 * ```
 * 
 * @example Regional Sales Access (§7.3.1 dynamic membership)
 * ```typescript
 * {
 *   name: 'regional_sales_access',
 *   label: 'Sales Reps Access Regional Accounts',
 *   object: 'account',
 *   operation: 'select',
 *   // The runtime stages the rep's territory accounts in
 *   // ExecutionContext.rlsMembership.territory_account_ids.
 *   using: 'id in current_user.territory_account_ids',
 *   positions: ['sales_rep'],
 *   enabled: true
 * }
 * ```
 *
 * @example Status-Based Access (literal match)
 * ```typescript
 * {
 *   name: 'published_only',
 *   label: 'Users Only Access Published Records',
 *   object: 'contract',
 *   operation: 'select',
 *   using: "status = 'published'",
 *   enabled: true
 * }
 * ```
 * 
 * @example Hierarchical Access (Role-Based)
 * ```typescript
 * {
 *   name: 'executive_full_access',
 *   label: 'Executives See All Records',
 *   object: 'account',
 *   operation: 'all',
 *   using: '1 == 1', // Always true - see everything
 *   positions: ['ceo', 'cfo', 'cto'],
 *   enabled: true
 * }
 * ```
 */
export const RowLevelSecurityPolicySchema = lazySchema(() => strictObject(
  {
    surface: 'this RLS policy',
    // The suggestion pool is `Object.keys(shape)` minus anything that accepts
    // nothing (#5593). `priority` is exactly that case and the exclusion is
    // deliberate: it is a {@link retiredKey} tombstone, declared so its
    // rejection carries the upgrade prescription, never offered as a rename
    // target. The hand-transcribed list this replaced had to state the same
    // exclusion in prose and be trusted to keep it.
    aliases: {
      // ADR-0090 D3 renamed the pre-D3 `roles` vocabulary to `positions`.
      roles: 'positions',
      role: 'positions',
      // PostgreSQL spells the write-side clause `WITH CHECK`.
      withcheck: 'check',
      // The read-side clause under other names an author reaches for first.
      condition: 'using',
      filter: 'using',
      where: 'using',
    },
    history:
      'Until #4001 these were dropped silently — the policy still parsed, so a ' +
      'row-level restriction the author wrote was never compiled into the filter.',
  },
  {
  /**
   * Unique identifier for this policy.
   * Must be unique within the object.
   * Use snake_case following ObjectStack naming conventions.
   * 
   * @example "tenant_isolation", "owner_access", "manager_team_view"
   */
  name: z.string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .describe('Policy unique identifier (snake_case)'),

  /**
   * Human-readable label for the policy.
   * Used in admin UI and logs.
   * 
   * @example "Multi-Tenant Data Isolation", "Owner-Based Access"
   */
  label: z.string()
    .optional()
    .describe('Human-readable policy label'),

  /**
   * Description explaining what this policy does and why.
   * Helps with governance and compliance.
   * 
   * @example "Ensures users can only access records from their own tenant organization"
   */
  description: z.string()
    .optional()
    .describe('Policy description and business justification'),

  /**
   * Target object (table) this policy applies to.
   * Must reference a valid ObjectStack object name.
   * 
   * @example "account", "opportunity", "contact", "custom_object"
   */
  object: z.string()
    .describe('Target object name'),

  /**
   * Database operation(s) this policy applies to.
   * 
   * - **select**: Controls read access (SELECT queries)
   * - **insert**: Controls insert access (INSERT statements)
   * - **update**: Controls update access (UPDATE statements)
   * - **delete**: Controls delete access (DELETE statements)
   * - **all**: Applies to all operations
   * 
   * @example "select" - Most common, controls what users can view
   * @example "all" - Apply same rule to all operations
   */
  operation: RLSOperation
    .describe('Database operation this policy applies to'),

  /**
   * USING clause - Filter condition for SELECT/UPDATE/DELETE.
   *
   * A constrained CEL predicate (ADR-0058 D1) compiled into an ObjectQL
   * filter (see the supported grammar below). Only rows the compiled filter
   * matches are accessible.
   *
   * **Note**: For INSERT-only policies, USING is not required (only CHECK is needed).
   * For SELECT/UPDATE/DELETE operations, USING is required.
   *
   * **Security Note**: the compiler lowers each predicate to a structured
   * filter and binds context values as parameters at the driver layer —
   * context values are never string-concatenated into SQL. Policy `using`
   * strings are authored by administrators, not end users.
   *
   * **Supported expression grammar (reference compiler)**
   *
   * There is no blessed list of forms to memorise here, and no count to
   * quote: the grammar is defined by ONE question — *does the predicate lower
   * to an ObjectQL filter?* `isSupportedRlsExpression`
   * (`@objectstack/formula`, `src/rls-predicate.ts`) is that single decision
   * procedure, and `@objectstack/lint` calls it at authoring time (ADR-0056
   * D4) so a predicate that would never enforce is rejected instead of
   * silently dropped. Anything that does not lower **fails closed** — the
   * policy matches zero rows, never more.
   *
   * What lowers, written in canonical CEL:
   *
   * - **Comparison** of a field against a literal or a `current_user.*`
   *   context value with `==`, `!=`, `<`, `<=`, `>` or `>=` —
   *   `owner_id == current_user.id`, `amount > 100`, `status != 'draft'`.
   *   Either operand may be the field; `current_user.id == owner_id` lowers
   *   to the same filter.
   * - **Set membership** with `in`, against a pre-resolved `current_user.*`
   *   array (see "Dynamic membership" below) or an inline CEL list literal —
   *   `assigned_to_id in current_user.team_member_ids`,
   *   `status in ['draft', 'pending']`.
   * - **String prefix / suffix / substring** tests —
   *   `name.startsWith('AC')`, `name.endsWith('_archived')`,
   *   `name.contains('demo')`.
   * - **Composition** of the above with `&&`, `||` and parentheses —
   *   `organization_id == current_user.organization_id && status == 'published'`.
   *   `!` negates a *parenthesised comparison* (`!(status == 'draft')`); it
   *   cannot negate a bare field, because a bare field does not lower on its
   *   own.
   * - **Allow-all**: the bare literal `true` (the privileged-position escape
   *   hatch). `1 == 1` lowers as an ordinary comparison and means the same.
   *   There is no bare-`false` deny-all — to make a policy inert, set
   *   `enabled: false`.
   *
   * What does **not** lower, and therefore fails closed: SQL `AND` / `OR` /
   * `NOT`, `NOT IN`, `IS NULL` / `IS NOT NULL`, `LIKE` / `ILIKE`, regex
   * (`~` / `!~`), `ANY` / `ALL`, arithmetic (`amount + 1 > 2`), subqueries,
   * `NOW()` / `CURRENT_DATE` / `CURRENT_TIME`, traversal across objects
   * (`account.owner.id == current_user.id`), and a bare truthy field
   * (`is_active`). Combine conditions with `&&` / `||`, or by defining
   * multiple policies (they OR-combine); express anything subquery-shaped as
   * a pre-resolved `current_user.*` array instead.
   *
   * **SQL spelling is a transitional bridge, not a second dialect.** Stored
   * legacy predicates keep compiling because `sqlPredicateToCel`
   * (`@deprecated` under ADR-0058 D1) rewrites `=` to `==` and `IN` to `in`
   * before the one compiler sees them, so `owner_id = current_user.id`,
   * `status = 'published'` and `assigned_to_id IN (current_user.team_member_ids)`
   * still enforce. Only that subset is bridged. In particular SQL's
   * parenthesised value list does **not** survive the bridge —
   * `status IN ('draft', 'pending')` fails closed, where the CEL list
   * `status in ['draft', 'pending']` lowers — and SQL keywords outside the
   * subset (`AND`, `OR`, `NOT IN`, `IS NULL`, `LIKE`) are never rewritten.
   * Author new policies in CEL.
   *
   * **Context values** — `current_user.*` resolves against the request's
   * execution context (camelCase fields map to snake_case placeholders):
   * - `current_user.id` → `ExecutionContext.userId`
   * - `current_user.organization_id` → `ExecutionContext.tenantId`
   * - `current_user.positions` → `ExecutionContext.positions` (array)
   * - `current_user.org_user_ids` → ids of fellow members of the active org
   * - any key the runtime stages in `ExecutionContext.rlsMembership`
   *
   * A referenced value that is missing/`null` (scalar) or empty (array)
   * makes that policy drop out — **fail-closed**, never fail-open.
   *
   * **Dynamic membership (§7.3.1)** — set-membership that would otherwise
   * need a subquery ("tasks assigned to anyone I manage", "accounts in my
   * territories") is resolved by the runtime into
   * `ExecutionContext.rlsMembership` under a stable key, then referenced as
   * `field in current_user.<key>`. This keeps the compiler subquery-free
   * while still supporting hierarchy- and sharing-based access.
   *
   * **Prohibited**: Dynamic SQL, DDL statements, DML statements (INSERT/UPDATE/DELETE)
   *
   * @example "organization_id == current_user.organization_id"
   * @example "owner_id == current_user.id"
   * @example "status == 'published'"
   * @example "assigned_to_id in current_user.team_member_ids" // §7.3.1 pre-resolved
   * @example "true" // privileged-position allow-all
   */
  using: z.string()
    .optional()
    .describe('Filter condition for SELECT/UPDATE/DELETE, authored in canonical CEL (ADR-0058 D1). It enforces when the predicate lowers to an ObjectQL filter: a field compared against a literal or a `current_user.*` context value using `==`, `!=`, `<`, `<=`, `>` or `>=`; `in` against a `current_user.*` array or an inline literal list (e.g. status in [\'draft\', \'pending\']); these combined with `&&` / `||`; or the bare allow-all `true`. Anything that does not lower fails closed — the policy matches zero rows. The legacy SQL-ish spellings are still accepted through a transitional bridge that rewrites `=` to `==` and `IN` to `in` (deprecated under ADR-0058 D1); SQL `AND` / `OR` / `NOT IN` / `IS NULL` / `LIKE` are NOT bridged and fail closed. Optional for INSERT-only policies.'),

  /**
   * CHECK clause - Validation for INSERT/UPDATE operations.
   * 
   * Similar to USING but applies to new/modified rows.
   * Prevents users from creating/updating rows they wouldn't be able to see.
   * 
   * **Default Behavior**: If not specified, implementations should use the
   * USING clause as the CHECK clause. This ensures data integrity by preventing
   * users from creating records they cannot view.
   * 
   * Use cases:
   * - Prevent cross-tenant data creation
   * - Enforce mandatory field values
   * - Validate data integrity rules
   * - Restrict certain operations (e.g., only allow creating "draft" status)
   * 
   * @example "organization_id = current_user.organization_id"
   * @example "status in ['draft', 'pending']" - Only allow certain statuses
   * @example "created_by = current_user.id" - Must be the creator
   */
  check: z.string()
    .optional()
    .describe('Validation condition for INSERT/UPDATE (defaults to USING clause if not specified - enforced at application level)'),

  /**
   * Restrict this policy to specific positions (ADR-0090 D3; formerly
   * `roles`). If specified, only users holding one of these positions have
   * this policy applied. If omitted, the policy applies to all users
   * (except those with bypassRLS permission).
   *
   * Position names must match defined positions in the system.
   *
   * @example ["sales_rep", "account_manager"]
   * @example ["employee"] - Apply to all employees
   */
  positions: z.array(z.string())
    .optional()
    .describe('Positions this policy applies to (omit for all)'),

  /**
   * Whether this policy is currently active.
   * Disabled policies are not evaluated.
   * Useful for temporary policy changes without deletion.
   * 
   * @default true
   */
  enabled: z.boolean()
    .default(true)
    .describe('Whether this policy is active'),

  /**
   * REMOVED — `priority` promised "conflict resolution" that cannot exist.
   *
   * Applicable policies OR-combine (any match allows access — the doc above
   * `RLSCompiler.compileFilter` and this schema's own former describe both say
   * most-permissive-wins), so there is never a conflict to order and evaluation
   * order cannot change an outcome. Nothing ever read the key: the 2026-07-30
   * security-subset liveness re-verification (#3896 follow-up) closed the call
   * graph across the collection site, the projection round-trip and the
   * compiler, and found no consumer. A semantically-void knob on a SECURITY
   * policy is worse than dead — an author (very often an AI, ADR-0033) reads it
   * as a precedence lever and reasons about policy interactions that do not
   * exist. Removed per the #3715 / #3950 precedent; tombstoned so the removal
   * is audible (tsc `never` + the parse-time prescription) instead of a silent
   * strip.
   */
  priority: retiredKey(
    '`rowLevelSecurity[].priority` was removed in @objectstack/spec 17.0.0 (#3896 security audit). ' +
    'It never had an effect and could not: applicable policies OR-combine (most permissive wins), ' +
    'so there is no conflict to order. Delete the key — policy outcomes are unchanged. ' +
    'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
  ),

  /**
   * Tags for policy categorization and reporting.
   * Useful for governance, compliance, and auditing.
   * 
   * @example ["compliance", "gdpr", "pci"]
   * @example ["multi-tenant", "security"]
   */
  tags: z.array(z.string())
    .optional()
    .describe('Policy categorization tags'),
}).superRefine((data, ctx) => {
  // Ensure at least one of USING or CHECK is provided
  if (!data.using && !data.check) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one of "using" or "check" must be specified. For SELECT/UPDATE/DELETE operations, provide "using". For INSERT operations, provide "check".',
    });
  }
  
  // For non-insert operations, USING should typically be present
  // This is a soft warning through documentation, not enforced here
  // since 'all' and mixed operation types are valid
}));

// RLSAuditEventSchema / RLSAuditConfigSchema / RLSConfigSchema were REMOVED
// per ADR-0056 D8 "design+enforce or remove": the global RLSConfig
// (defaultPolicy/bypassRoles/caching/audit) and the audit-event shapes were
// never read by the enforced RLS path (plugin-security computeRlsFilter) —
// declared-but-inert config. Per-policy RLS (RowLevelSecurityPolicySchema,
// below/above) is the live, enforced surface and is unchanged.

/**
 * User Context Schema
 * 
 * Represents the current user's context for RLS evaluation.
 * This data is used to evaluate USING and CHECK clauses.
 */
export const RLSUserContextSchema = lazySchema(() => z.object({
  /**
   * User ID
   */
  id: z.string()
    .describe('User ID'),

  /**
   * User email
   */
  email: z.string()
    .email()
    .optional()
    .describe('User email'),

  /**
   * Tenant/Organization ID
   */
  tenantId: z.string()
    .optional()
    .describe('Tenant/Organization ID'),

  /**
   * Positions held by the user (ADR-0090 D3 — formerly `role`; matches the
   * runtime shape the RLS compiler resolves as `current_user.positions`).
   */
  positions: z.array(z.string())
    .optional()
    .describe('Positions held by the user'),

  /**
   * User department
   */
  department: z.string()
    .optional()
    .describe('User department'),

  /**
   * Additional custom attributes
   * Can include any custom user fields for RLS evaluation
   */
  attributes: z.record(z.string(), z.unknown())
    .optional()
    .describe('Additional custom user attributes'),
}));

/**
 * RLS Policy Evaluation Result
 * 
 * Result of evaluating an RLS policy for a specific record.
 * Used for debugging and audit logging.
 */
export const RLSEvaluationResultSchema = lazySchema(() => z.object({
  /**
   * Policy name that was evaluated
   */
  policyName: z.string()
    .describe('Policy name'),

  /**
   * Whether access was granted
   */
  granted: z.boolean()
    .describe('Whether access was granted'),

  /**
   * Evaluation duration in milliseconds
   */
  durationMs: z.number()
    .optional()
    .describe('Evaluation duration in milliseconds'),

  /**
   * Error message if evaluation failed
   */
  error: z.string()
    .optional()
    .describe('Error message if evaluation failed'),

  /**
   * Evaluated USING clause result
   */
  usingResult: z.boolean()
    .optional()
    .describe('USING clause evaluation result'),

  /**
   * Evaluated CHECK clause result (for INSERT/UPDATE)
   */
  checkResult: z.boolean()
    .optional()
    .describe('CHECK clause evaluation result'),
}));

/**
 * Type exports
 */
export type RowLevelSecurityPolicy = z.input<typeof RowLevelSecurityPolicySchema>;
/** Post-parse shape of {@link RowLevelSecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type RowLevelSecurityPolicyParsed = z.infer<typeof RowLevelSecurityPolicySchema>;
export type RLSUserContext = z.input<typeof RLSUserContextSchema>;
export type RLSEvaluationResult = z.input<typeof RLSEvaluationResultSchema>;

/**
 * Helper factory for creating RLS policies
 */
export const RLS = {
  /**
   * Create a simple owner-based policy
   */
  ownerPolicy: (object: string, ownerField: string = 'owner_id'): RowLevelSecurityPolicy => ({
    name: `${object}_owner_access`,
    label: `Owner Access for ${object}`,
    object,
    operation: 'all',
    using: `${ownerField} == current_user.id`,
    enabled: true,
  }),

  /**
   * Create a tenant isolation policy.
   *
   * The default `tenantField` is `organization_id` to match better-auth's
   * organization plugin and the canonical platform schema. The
   * `current_user.organization_id` placeholder is resolved by
   * `RLSCompiler` from `ExecutionContext.tenantId` at request time.
   * Pass a custom field name if your schema uses a different column.
   */
  tenantPolicy: (object: string, tenantField: string = 'organization_id'): RowLevelSecurityPolicy => ({
    name: `${object}_tenant_isolation`,
    label: `Tenant Isolation for ${object}`,
    object,
    operation: 'all',
    using: `${tenantField} == current_user.organization_id`,
    check: `${tenantField} == current_user.organization_id`,
    enabled: true,
  }),

  /**
   * Create a position-scoped policy
   */
  positionPolicy: (object: string, positions: string[], condition: string): RowLevelSecurityPolicy => ({
    name: `${object}_${positions.join('_')}_access`,
    label: `${positions.join(', ')} Access for ${object}`,
    object,
    operation: 'select',
    using: condition,
    positions,
    enabled: true,
  }),

  /**
   * Create a permissive policy (allow all for specific positions)
   */
  allowAllPolicy: (object: string, positions: string[]): RowLevelSecurityPolicy => ({
    name: `${object}_${positions.join('_')}_full_access`,
    label: `Full Access for ${positions.join(', ')}`,
    object,
    operation: 'all',
    using: '1 == 1', // Always true
    positions,
    enabled: true,
  }),
} as const;
