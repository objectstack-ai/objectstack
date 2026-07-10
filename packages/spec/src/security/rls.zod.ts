// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

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
 * - A small, fixed expression grammar (equality, set-membership, always-true)
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

export type RLSOperation = z.infer<typeof RLSOperation>;

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
export const RowLevelSecurityPolicySchema = lazySchema(() => z.object({
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
   * This is a constrained, SQL-like expression compiled into an ObjectQL
   * filter (see the supported grammar below). Only rows the compiled filter
   * matches are accessible.
   *
   * **Note**: For INSERT-only policies, USING is not required (only CHECK is needed).
   * For SELECT/UPDATE/DELETE operations, USING is required.
   *
   * **Security Note**: the compiler maps each form to a structured filter and
   * binds context values as parameters at the driver layer — context values
   * are never string-concatenated into SQL. Policy `using` strings are
   * authored by administrators, not end users.
   *
   * **Supported expression grammar (reference compiler)**
   *
   * The reference RLS compiler implements a deliberately **small, fixed
   * grammar** rather than a general SQL parser. Exactly four forms compile;
   * anything else fails closed (the policy matches zero rows). Keep `using`
   * to one of:
   *
   * 1. `field = current_user.<prop>` — equality against a context value
   * 2. `field = 'literal'` — equality against a single-quoted string literal
   * 3. `field IN (current_user.<array_prop>)` — set membership against a
   *    pre-resolved id array (see "Dynamic membership" below)
   * 4. `1 = 1` — always true / no restriction (privileged-position allow-all)
   *
   * There is intentionally **no** support for `AND`/`OR`/`NOT`, comparison
   * operators other than `=`, `IS NULL`/`IS NOT NULL`, `NOT IN`, `LIKE`/
   * `ILIKE`, regex (`~`/`!~`), `ANY`/`ALL`, subqueries, or `NOW()`/
   * `CURRENT_DATE`/`CURRENT_TIME`. Combine conditions by defining multiple
   * policies (they OR-combine); express anything subquery-shaped as a
   * pre-resolved `current_user.*` array instead.
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
   * `field IN (current_user.<key>)`. This keeps the compiler subquery-free
   * while still supporting hierarchy- and sharing-based access.
   *
   * **Prohibited**: Dynamic SQL, DDL statements, DML statements (INSERT/UPDATE/DELETE)
   *
   * @example "organization_id = current_user.organization_id"
   * @example "owner_id = current_user.id"
   * @example "status = 'published'"
   * @example "assigned_to_id IN (current_user.team_member_ids)" // §7.3.1 pre-resolved
   * @example "1 = 1" // privileged-position allow-all
   */
  using: z.string()
    .optional()
    .describe('Filter condition for SELECT/UPDATE/DELETE. One of the four compiler-supported forms: `field = current_user.<prop>`, `field = \'literal\'`, `field IN (current_user.<array>)`, or `1 = 1`. Optional for INSERT-only policies.'),

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
   * @example "status IN ('draft', 'pending')" - Only allow certain statuses
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
   * Policy priority for conflict resolution.
   * Higher numbers = higher priority.
   * When multiple policies apply, the most permissive wins (OR logic).
   * Priority is only used for ordering evaluation (performance).
   * 
   * @default 0
   */
  priority: z.number()
    .int()
    .default(0)
    .describe('Policy evaluation priority (higher = evaluated first)'),

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
   * User role(s)
   */
  role: z.union([
    z.string(),
    z.array(z.string()),
  ])
    .optional()
    .describe('User role(s)'),

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
export type RowLevelSecurityPolicy = z.infer<typeof RowLevelSecurityPolicySchema>;
export type RLSUserContext = z.infer<typeof RLSUserContextSchema>;
export type RLSEvaluationResult = z.infer<typeof RLSEvaluationResultSchema>;

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
    priority: 0,
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
    priority: 0,
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
    priority: 0,
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
    priority: 0,
  }),
} as const;
