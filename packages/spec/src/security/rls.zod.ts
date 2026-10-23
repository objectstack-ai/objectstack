// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { RESERVED_RLS_MEMBERSHIP_KEYS } from '../contracts/rls-membership-resolver';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
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
 *      (`territory_account_ids` is not a kernel value: the app supplies it in
 *      `ExecutionContext.rlsMembership`, see "Where a membership key comes
 *      from" below; until something does, the policy matches no rows)
 *
 * 5. **Manager / Hierarchy Access (§7.3.1 dynamic membership)**
 *    - Managers see records assigned to anyone they manage
 *    - `using: "assigned_to_id in current_user.team_member_ids"`
 *      (likewise app-supplied, no subquery needed)
 *
 * 6. **Portal / Partner Access (§7.3.1 dynamic membership)**
 *    - A supplier's contacts see only that supplier's orders
 *    - `using: "supplier in current_user.portal_supplier_ids"`
 *      (declared as `membershipKeys.portal_supplier_ids` on the supplier-contact
 *      roster object, see `MembershipKeySchema`)
 *
 * ## Where a membership key comes from
 *
 * The kernel resolves `current_user.id`, `organization_id`, `positions`,
 * `org_user_ids`, `accessible_org_ids` and `email` itself. Any other
 * `current_user.KEY` read with `in` is a membership set the APP supplies,
 * through one of two sources:
 *
 * - a **registered membership resolver** (ADR-0105 D11, the
 *   `rls-membership-resolver` service), code an installed plugin runs; or
 * - a **declared membership key**: `ObjectSchema.membershipKeys` on the roster
 *   object whose rows define the set. Not applied yet: the security plugin
 *   does not read the declaration in this release.
 *
 * The platform stages no other key. A policy reading a key neither source
 * supplies drops out and matches no rows (fail closed).
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
 * - Multiple policies OR-combine on reads (any match allows); for writes see `check`
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
 * 2. **Default Deny, among the policies that apply**: once a policy applies to
 *    the caller and the operation, a row that none of them admits is denied,
 *    and a policy that cannot be evaluated fails closed. When no policy applies,
 *    the policies restrict nothing (the tenant wall, a separate layer, still
 *    applies): object permissions, not RLS policies, stop an un-permissioned
 *    user
 * 3. **Context Variables**: Ensure current_user context is always set
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
 * The upgrade prescription for the retired `rowLevelSecurity[].tags` (#20321).
 * Declared above the schema that reads it: under `OS_EAGER_SCHEMAS=1` every
 * `lazySchema` factory runs at module init in file order, and a `const` below
 * its first eager reader is a TDZ error.
 *
 * ⚠️ The version sentence names the npm release this ships in, never the
 * protocol major the migration entries are numbered at (ADR-0087, the level
 * half of its 2026-09-13 amendment).
 */
const RLS_POLICY_TAGS_RETIRED =
  '`rowLevelSecurity[].tags` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) '
  + '— nothing ever read it: the RLS compiler never consulted a policy\'s tags and nothing else acted '
  + 'on them, so a tag scoped, restricted and reported nothing. Delete the key. A tag never limited '
  + 'whom a policy applies to; to do that, list the positions in `positions`. A policy is identified '
  + 'by its `name` and its `object`; say why it exists in `description`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * The curated near-miss answers of a row policy's unknown keys, shared by both
 * carriers of the policy shape: {@link RowLevelSecurityPolicySchema} and
 * {@link DefaultRowScopeSchema}. One table, so the two surfaces cannot answer
 * the same slip differently. Declared above its first eager reader, for the
 * TDZ reason {@link RLS_POLICY_TAGS_RETIRED} gives.
 *
 * The suggestion pool is `Object.keys(shape)` minus anything that accepts
 * nothing (#5593). `priority` and `tags` are exactly that case and the
 * exclusion is deliberate: each is a {@link retiredKey} tombstone, declared so
 * its rejection carries the upgrade prescription, never offered as a rename
 * target. The hand-transcribed list this replaced had to state the same
 * exclusion in prose and be trusted to keep it.
 */
const RLS_POLICY_ALIASES: Readonly<Record<string, string>> = {
  // ADR-0090 D3 renamed the pre-D3 `roles` vocabulary to `positions`.
  roles: 'positions',
  role: 'positions',
  // PostgreSQL spells the write-side clause `WITH CHECK`.
  withcheck: 'check',
  // The read-side clause under other names an author reaches for first.
  condition: 'using',
  filter: 'using',
  where: 'using',
};

/**
 * The policy members the two rules below read. Neither reads `object`, which
 * is why a carrier that implies the object ({@link DefaultRowScopeSchema})
 * takes both rules unchanged.
 */
interface RowLevelSecurityPolicyClauses {
  operation: z.infer<typeof RLSOperation>;
  using?: string;
  check?: string;
}

/**
 * The cross-field rules of a row policy, named so both carriers of the policy
 * shape run the same function: {@link RowLevelSecurityPolicySchema} and
 * {@link DefaultRowScopeSchema}. Named rather than inherited because zod 4
 * refuses `.omit()` / `.pick()` on an object schema that carries a refinement
 * (`.omit() cannot be used on object schemas containing refinements`), so the
 * object-implied shape cannot be cut from the refined policy schema and keep
 * its rules; it is rebuilt from the same members and given the same rules.
 */
function refineRowLevelSecurityPolicy(data: RowLevelSecurityPolicyClauses, ctx: z.RefinementCtx): void {
  // Ensure at least one of USING or CHECK is provided
  if (!data.using && !data.check) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'At least one of "using" or "check" must be specified. A `select` or `delete` policy takes "using": ' +
        'the rows it lets a caller read or delete. An `insert` policy takes "check", which judges each row ' +
        'an insert writes; a "using" alone is that check when no applicable insert policy declares one. ' +
        'An `update` or `all` policy takes either or both: "using" limits the existing rows it admits, and ' +
        '"check" judges each row written.',
    });
  }

  // [ADR-0049 · ADR-0058 D4] `check` judges the post-image of a write — the
  // new row of an insert, the changed row of an update. A `select` or `delete`
  // policy has no post-image, and the runtime's write gate never collects one
  // (plugin-security `writeCheckPolicies` is handed only the policies whose
  // `operation` is the write's own or `all`). A `check` there was stored and
  // never evaluated, so an author who wrote one on a `delete` policy believed
  // it guarded deletes. Declared ≠ enforced ⇒ refused here, at the key's own
  // path, naming the operation and what to write instead. "Declares" is the
  // runtime's test (a non-blank string): a blank `check` declares nothing and
  // is left to the rule above.
  if (
    (data.operation === 'select' || data.operation === 'delete') &&
    typeof data.check === 'string' &&
    data.check.trim() !== ''
  ) {
    const verb = data.operation === 'select' ? 'read' : 'delete';
    const act = data.operation === 'select' ? 'a read' : 'a delete';
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['check'],
      message:
        `\`check\` is never evaluated on a \`${data.operation}\` policy: it validates the new row an insert ` +
        `or an update writes, and ${act} writes none. Remove \`check\` from this policy. To limit which ` +
        `rows the policy lets a caller ${verb}, write that predicate as \`using\`; to validate rows as ` +
        'they are written, declare the `check` on a policy whose `operation` is `insert`, `update` or `all`.',
    });
  }

  // With both rules above, a non-blank `using` is the only predicate a
  // `select` or `delete` policy can carry. An `insert`, `update` or `all`
  // policy may carry either clause or both; what each does per operation is
  // on the `using` and `check` docs.
}

/**
 * Row-Level Security Policy Schema
 * 
 * Defines a single RLS policy that filters records based on conditions.
 * Multiple policies can be defined for the same object. On a read, their
 * `using` clauses are combined with OR logic (union of results); on an insert
 * or an update, which predicates judge the written rows is decided per
 * operation across the applicable policies (see `check`).
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
 *   // `team_member_ids` is app-supplied (a registered membership resolver
 *   // fills ExecutionContext.rlsMembership.team_member_ids), no subquery needed.
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
 *   // `territory_account_ids` is app-supplied: a registered membership resolver
 *   // stages the rep's territory accounts in
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
    // Shared with the object-implied carrier; the table's docblock carries
    // why the two tombstones are not in the suggestion pool.
    aliases: RLS_POLICY_ALIASES,
    history:
      'Until this shape was closed, these were dropped silently — the policy still parsed, so a ' +
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
   * USING clause - The existing rows the policy admits, and the stand-in
   * write check when no applicable policy declares `check`.
   *
   * A constrained CEL predicate (ADR-0058 D1) compiled into an ObjectQL
   * filter (see the supported grammar below). Only rows the compiled filter
   * matches are accessible.
   *
   * **What it does, per `operation`**:
   * - `select`: the rows a read returns. `delete`: the rows a delete may
   *   remove. `using` is the only predicate such a policy can carry (a
   *   non-blank `check` there is refused), so it needs one.
   * - `update`: the existing rows an update may change, by id or
   *   `multi: true`. It is not required: a policy that declares only `check`
   *   is accepted and enforced. Its `check` judges the rows the update writes,
   *   and the rows the caller may change then come from the other applicable
   *   `update` / `all` policies' `using`, or, when none carries one, from the
   *   caller's `select` policies.
   * - `insert`: an insert has no existing row, so `using` filters nothing.
   *   It is not required either (a `check` alone is enough), but it is not
   *   inert: it is the insert's check whenever no applicable policy for that
   *   insert declares `check`.
   * - `all`: each of the above for its operation.
   *
   * **The stand-in check**: on an insert or an update, when no applicable
   * policy for that operation declares `check`, each applicable policy's
   * `using` is its check, OR-combined, on every row written. When
   * any applicable policy declares `check`, only the declared checks decide
   * and a USING-only sibling adds nothing (see `check`).
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
   * - any other key an app supplies in `ExecutionContext.rlsMembership` (a
   *   registered membership resolver; see "Where a membership key comes
   *   from" in the module docblock)
   *
   * A referenced value that is missing/`null` (scalar) or empty (array)
   * makes that policy drop out — **fail-closed**, never fail-open.
   *
   * **Dynamic membership (§7.3.1)** — set-membership that would otherwise
   * need a subquery ("tasks assigned to anyone I manage", "accounts in my
   * territories") is resolved per request, by an app-supplied source, into
   * `ExecutionContext.rlsMembership` under a stable key, then referenced as
   * `field in current_user.<key>`. This keeps the compiler subquery-free
   * while still supporting hierarchy- and sharing-based access.
   *
   * **Prohibited**: Dynamic SQL, DDL statements, DML statements (INSERT/UPDATE/DELETE)
   *
   * @example "organization_id == current_user.organization_id"
   * @example "owner_id == current_user.id"
   * @example "status == 'published'"
   * @example "assigned_to_id in current_user.team_member_ids" // §7.3.1 app-supplied set
   * @example "true" // privileged-position allow-all
   */
  using: z.string()
    .optional()
    .describe('Row predicate, authored in canonical CEL (ADR-0058 D1): the rows a `select` policy lets a caller read, and the existing rows an `update` or `delete` policy lets a caller change or remove. On an insert or an update, when no applicable policy for that operation declares `check`, each applicable policy\'s `using` also stands in as its check on every row written (see `check`); on an `insert` policy that is its only effect. It enforces when the predicate lowers to an ObjectQL filter: a field compared against a literal or a `current_user.*` context value using `==`, `!=`, `<`, `<=`, `>` or `>=`; `in` against a `current_user.*` array or an inline literal list (e.g. status in [\'draft\', \'pending\']); these combined with `&&` / `||`; or the bare allow-all `true`. Anything that does not lower fails closed — the policy matches zero rows. The legacy SQL-ish spellings are still accepted through a transitional bridge that rewrites `=` to `==` and `IN` to `in` (deprecated under ADR-0058 D1); SQL `AND` / `OR` / `NOT IN` / `IS NULL` / `LIKE` are NOT bridged and fail closed. Needed on a `select` or `delete` policy (a `check` there is refused); optional on an `insert`, `update` or `all` policy that declares `check`.'),

  /**
   * CHECK clause - Validation of every row an insert or an update writes,
   * enforced at application level through the engine's
   * `OperationContext.postHookWriteImageCheck` seam (introduced for inserts
   * by commit a016f08b8a, whose original card no longer resolves; extended by
   * #19950, #19964 and #19989):
   * - an insert, an array insert included: each row as its `beforeInsert`
   *   hooks leave it. Values the engine fills in after that point (an
   *   autonumber, a `secret` field's stored reference, an absent tenant
   *   column) are not on the judged image;
   * - an update, by id or `multi: true`: each row it changes, as the prior
   *   row merged with the final payload once its `beforeUpdate` hooks have
   *   run.
   *
   * One failing row refuses the whole write. A by-id update is judged a
   * second time, before its hooks, on the prior row merged with the change
   * set as sent, so a change set the check refuses is refused even when a
   * hook would have overwritten the refused value.
   *
   * **Default Behavior**: the `using` → `check` default is decided per write
   * operation across the applicable policies, not policy by policy. A policy
   * is applicable to a write when it is not `enabled: false`, its `object` is
   * the written object or `'*'`, its `operation` is the write's own (`insert`
   * or `update`) or `'all'`, and, when it lists `positions`, the caller holds
   * one of them.
   *
   * - When any applicable policy declares `check`, only the declared checks
   *   decide, OR-combined. A USING-only sibling adds nothing: its `using` is
   *   not part of the check.
   * - When none declares `check`, each applicable policy's `using` stands in as
   *   its check, OR-combined. The platform's own ownership floor
   *   (`owner_only_writes`) takes part only where the write's own row gate
   *   kept it (plugin-security `writeCheckPolicies`).
   *
   * So declaring `check` on one policy replaces, for the callers that policy
   * applies to, the `using` its USING-only siblings would otherwise have
   * contributed to the check.
   *
   * **Refused on a `select` or `delete` policy** (ADR-0049 enforce-or-remove).
   * Neither operation writes a new row, so there is no post-image for a
   * `check` to judge: the write gate only ever collects `insert`, `update`
   * and `all` policies, and a `check` on a `select` or `delete` policy was
   * stored, never evaluated, and never took part in the choice above. The
   * schema now refuses it at the `check` path, naming the operation. To limit
   * which rows such a policy admits, write the predicate as `using`; to
   * validate written rows, declare the `check` on an `insert`, `update` or
   * `all` policy. A blank `check` declares nothing (the runtime reads a blank
   * clause as absent) and is not refused.
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
    .describe('Validation condition judged on every row an insert or an update writes (enforced at application level): each row of an insert, an array insert included, as its `beforeInsert` hooks leave it, and each row an update changes, by id or `multi: true`, as the prior row merged with the final payload after its `beforeUpdate` hooks. One failing row refuses the whole write. A by-id update is also judged, before its hooks, on the prior row merged with the change set as sent. The default to `using` is decided per operation across the applicable policies, not per policy: when any applicable policy for that operation declares `check`, only the declared checks decide (OR-combined) and a USING-only sibling adds nothing; only when none declares `check` does each applicable policy\'s `using` stand in as its check (OR-combined). Applicable = not `enabled: false`, `object` matches or is \'*\', `operation` matches or is \'all\', and the caller holds one of its `positions` when it lists any. Refused on a policy whose `operation` is `select` or `delete`, which write no new row to check: limit the rows such a policy admits with `using`, and declare the `check` on an `insert`, `update` or `all` policy.'),

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
   * No outcome depends on an order. On a read, the applicable policies' `using`
   * clauses OR-combine (any match allows access). On an insert or an update,
   * which predicates judge the written rows is decided once per operation
   * across the applicable policies (the declared `check`s when any exists,
   * otherwise each `using`; see `check`), and the chosen ones OR-combine. So
   * there is never a conflict to order and evaluation order cannot change an
   * outcome. Nothing ever read the key: the 2026-07-30
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
    '`rowLevelSecurity[].priority` was removed in @objectstack/spec 17.0.0. ' +
    'It never had an effect. Delete the key — policy outcomes are unchanged. ' +
    'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.',
  ),

  /**
   * REMOVED — `tags` promised "categorization and reporting" for governance and
   * compliance, and nothing ever read it (#20321, ADR-0049 enforce-or-remove).
   *
   * The census before removal found no reader in this repo, in objectui (the
   * permission preview renders the policy COUNT, never a policy's fields; the
   * policy editor neither seeds nor reads the key) or in cloud, and no writer
   * in the examples, the default permission sets or cloud. The capability was
   * judged by the maintainer's criterion for this family — does a mainstream
   * platform have it? — and none does: Salesforce sharing rules, Dataverse
   * security roles and PostgreSQL RLS policies carry no tag attribute, and
   * compliance reporting there keys on the rule itself. On a SECURITY policy an
   * inert free-form label is worse than dead: an author (very often an AI,
   * ADR-0033) may write `tags: ['managers_only']` believing it scopes the
   * policy, when only `positions` does. Tombstoned, like `priority` above, so
   * the removal is audible (tsc `never` + the parse-time prescription) instead
   * of an unknown-key verdict with no upgrade text.
   */
  tags: retiredKey(RLS_POLICY_TAGS_RETIRED),
}).superRefine(refineRowLevelSecurityPolicy));

/**
 * What an author who writes `object` on a default row scope is told. Hoisted
 * above its eager reader, for the TDZ reason {@link RLS_POLICY_TAGS_RETIRED}
 * gives.
 */
const DEFAULT_ROW_SCOPE_OBJECT_GUIDANCE =
  '`object` is implied on a default row scope: the scope belongs to the object that declares it, so it '
  + 'names no target. Delete the key. A policy for some other object is written in a permission set\'s '
  + '`rowLevelSecurity`, where `object` names its target.';

/**
 * An object's default row scope: {@link RowLevelSecurityPolicySchema} without
 * `object`, which the declaring object implies. It is the value of
 * `ObjectSchema.defaultRowScope` (`data/object.zod.ts`), whose describe states
 * what the security plugin's row-policy collection does with it.
 *
 * ## Why it is rebuilt, not cut
 *
 * The obvious spelling, `RowLevelSecurityPolicySchema.omit({ object: true })`,
 * throws in zod 4 (`.omit() cannot be used on object schemas containing
 * refinements`). So this schema is built from the same three parts as the
 * policy schema, each shared by reference rather than copied:
 *
 * - **the members**: the policy schema's own `shape` minus `object`, so every
 *   member and its describe are the same schema instances. The two
 *   `retiredKey()` tombstones (`priority`, `tags`) are left out with it: they
 *   accept no value, so leaving them out changes nothing this schema accepts,
 *   and their prescriptions are upgrade text for `rowLevelSecurity[]`, a path
 *   this surface never had. Either key is refused here as an unknown key;
 * - **the rules**: {@link refineRowLevelSecurityPolicy}, which reads
 *   `operation`, `using` and `check` and never `object`, so both rules hold as
 *   written: at least one of `using` / `check`, and no `check` on a `select` or
 *   `delete` policy;
 * - **the near-miss table**: {@link RLS_POLICY_ALIASES}.
 *
 * What differs is the surface name, the `object` guidance, the history
 * sentence and the two absent tombstones. `object` is refused as an unknown key, with the guidance above, so
 * a policy copied from a permission set fails loudly instead of parsing with a
 * target the runtime would never read.
 *
 * Reader and writers (#24164 ruling E′): the reader is the security plugin's
 * `collectRLSPolicies` (#24340). When no held permission set carries a row
 * policy for the declaring object and the operation, it collects this scope as
 * one policy for that object and judges it exactly as it judges a held
 * policy: the same applicability filter reads `operation`, `positions` and
 * `enabled`, the same compiler compiles `using` and `check` (an un-lowerable
 * predicate fails closed there, as an authored one does), and explain names
 * it by `name`, `label` and `description` as the object's own. The writers are
 * to be the platform identity objects (#24341); until they land, no object in
 * this tree declares it.
 */
export const DefaultRowScopeSchema = lazySchema(() => {
  const { object: _implied, priority: _priority, tags: _tags, ...members } = RowLevelSecurityPolicySchema.shape;
  return strictObject(
    {
      surface: "this object's default row scope",
      aliases: RLS_POLICY_ALIASES,
      guidance: { object: DEFAULT_ROW_SCOPE_OBJECT_GUIDANCE },
      history:
        'A key this scope does not declare is refused rather than dropped: a dropped member of a row '
        + 'scope would be a row restriction its author believes is in force.',
    },
    members,
  ).superRefine(refineRowLevelSecurityPolicy);
});

/**
 * ## Declarative membership keys (ADR-0105 D11, the metadata twin; #25234 ruling A)
 *
 * A membership key is a `current_user.KEY` set an RLS policy reads with `in`
 * (`supplier in current_user.portal_supplier_ids`). Until this key, the only
 * producer was a registered code resolver ({@link IRlsMembershipResolver}),
 * which hosted environments cannot run. A declaration on the ROSTER object X
 * names the same set in metadata:
 *
 * > `current_user.KEY` = the distinct non-null values of `valueField` (F) on the
 * > rows of X whose `userField` (U) equals the caller's user id and on which
 * > `filter` holds.
 *
 * X is implied by the declaring object, as `defaultRowScope` implies its object.
 * The map is record-keyed (`ObjectSchema.membershipKeys`), so one object cannot
 * declare a key twice; `defineStack` and `composeStacks` refuse one key declared
 * on two objects.
 *
 * What the shape itself makes unwritable (refusals 1, 2, 8, 9 and 10 of the
 * ruled list, and the U = F half of 6):
 *
 * - an unknown member, or a key name that is not snake_case (strict shape);
 * - a key named like a kernel context value ({@link RESERVED_RLS_MEMBERSHIP_KEYS},
 *   read from the contract, never copied);
 * - `valueField` naming the same column as `userField`;
 * - a cycle or a chain: there is no member that names another key, and no
 *   member sets a size (the bound is a platform constant of
 *   {@link MEMBERSHIP_KEY_MAX_VALUES}, overflow fails closed);
 * - a declaration from another package: `ObjectExtensionSchema` has no slot
 *   for this key.
 *
 * Judged against the merged object at authoring and publish, not here
 * (refusals 3 at the runtime gate, 4, 5, 6, 7, 11, 12 and 13): whether U is a
 * single-valued user reference and F a reference column on X, whether `filter`
 * lowers and reads no `current_user.*`, a key a registered resolver also owns,
 * and how a policy compares the key.
 *
 * Not read yet: the security plugin's request staging is the reader (the
 * liveness row is `planned`).
 */

/**
 * The most values one membership key may resolve to for one request. A cost
 * ceiling, not an authorable setting: a set larger than this is left
 * unresolved, so every policy reading it fails closed. Raised only by a ruling.
 */
export const MEMBERSHIP_KEY_MAX_VALUES = 1000;

/**
 * A membership key's name: the `KEY` of `current_user.KEY`. snake_case, and
 * never one of the kernel-resolved context values, which carry authorization
 * meaning no declaration may redefine.
 */
export const MembershipKeyNameSchema = lazySchema(() => SnakeCaseIdentifierSchema.refine(
  (name) => !RESERVED_RLS_MEMBERSHIP_KEYS.includes(name),
  {
    message:
      `A membership key may not be named ${RESERVED_RLS_MEMBERSHIP_KEYS.map((k) => `'${k}'`).join(', ')}: `
      + 'the kernel resolves those `current_user.*` values itself. Choose a name that says what the set holds, '
      + 'e.g. "portal_supplier_ids".',
  },
).describe('The membership key name: policies read the set as `current_user.KEY`'));

export type MembershipKeyName = z.input<typeof MembershipKeyNameSchema>;
export type MembershipKeyNameParsed = z.infer<typeof MembershipKeyNameSchema>;

/**
 * One declarative membership key on the roster object. See the module docblock
 * for its meaning; every member names a column of the declaring object.
 */
export const MembershipKeySchema = lazySchema(() => strictObject(
  {
    surface: 'this membership key',
    history:
      'A key this declaration does not define is refused rather than dropped: a dropped member of a '
      + 'membership key would change which rows the set holds, and so which records a policy lets through.',
    aliases: {
      user: 'userField',
      userColumn: 'userField',
      ownerField: 'userField',
      value: 'valueField',
      valueColumn: 'valueField',
      field: 'valueField',
      where: 'filter',
      condition: 'filter',
      using: 'filter',
    },
    guidance: {
      object:
        '`object` is implied on a membership key: the key is declared on the roster object whose rows define it. '
        + 'Delete `object`, and declare the key under that object\'s `membershipKeys`.',
      limit:
        'A membership key has no authorable size: one key resolves to at most 1,000 values per request, a '
        + 'platform constant, and a larger set fails closed. Narrow the set with `filter` instead.',
      maxValues:
        'A membership key has no authorable size: one key resolves to at most 1,000 values per request, a '
        + 'platform constant, and a larger set fails closed. Narrow the set with `filter` instead.',
    },
  },
  {
    /**
     * U: the column holding the roster row's user. A single-valued user
     * reference on this object (`user`, or a `lookup` / `master_detail` to
     * `sys_user`); a row counts for the caller when U equals their user id.
     */
    userField: SnakeCaseIdentifierSchema.describe(
      'The column of this object that holds the user a row belongs to: a single-valued user reference '
      + '(`user`, or a `lookup` / `master_detail` to `sys_user`). A row counts for the signed-in user when this '
      + 'column holds their user id.',
    ).meta({ title: 'User field' }),

    /**
     * F: the column whose values form the set. A reference column on this
     * object (`lookup`, `master_detail` or `user`); a multi-valued one is
     * flattened and de-duplicated.
     */
    valueField: SnakeCaseIdentifierSchema.describe(
      'The column of this object whose values form the set: a reference (`lookup`, `master_detail` or '
      + '`user`), multi-valued allowed. A policy compares the set with a column that references the same '
      + 'object, or with `id` on that object. Never the same column as `userField`.',
    ).meta({ title: 'Value field' }),

    /**
     * Optional narrowing over this object's own columns, in the RLS lowerable
     * subset (the grammar of a policy's `using`). It reads no `current_user.*`
     * value, which is what keeps a key from being built from another key.
     */
    filter: z.string().optional().describe(
      'Optional condition a roster row must also meet, in canonical CEL over this object\'s own columns and '
      + 'within the row-level security subset a policy\'s `using` lowers (e.g. "active == true"). It may not '
      + 'read any `current_user.*` value.',
    ).meta({ title: 'Filter' }),

    label: z.string().optional().describe('Human-readable name of the set').meta({ title: 'Label' }),

    description: z.string().optional().describe('What the set holds and who it is for').meta({ title: 'Description' }),
  },
).superRefine((key, ctx) => {
  if (key.valueField === key.userField) {
    ctx.addIssue({
      code: 'custom',
      path: ['valueField'],
      message:
        `\`valueField\` names the same column as \`userField\` ('${key.userField}'): the set would hold only `
        + 'the caller\'s own user id. Point `valueField` at the reference column whose values the policies '
        + 'compare, such as the supplier a contact belongs to.',
    });
  }
}));

export type MembershipKey = z.input<typeof MembershipKeySchema>;
export type MembershipKeyParsed = z.infer<typeof MembershipKeySchema>;

/**
 * `ObjectSchema.membershipKeys`: the membership keys this roster object
 * declares, by name.
 */
export const MembershipKeysSchema = lazySchema(() => z.record(z.string(), MembershipKeySchema).superRefine(
  // The name is judged here, not as the record's key schema: a refused record
  // key surfaces only as zod's generic "Invalid key in record", which would hide
  // WHICH rule the name broke. Each broken rule is one issue at the key's path.
  (keys, ctx) => {
    for (const name of Object.keys(keys)) {
      const verdict = MembershipKeyNameSchema.safeParse(name);
      if (verdict.success) continue;
      for (const issue of verdict.error.issues) {
        ctx.addIssue({ code: 'custom', path: [name], message: `Membership key '${name}': ${issue.message}` });
      }
    }
  },
));

export type MembershipKeys = z.input<typeof MembershipKeysSchema>;
export type MembershipKeysParsed = z.infer<typeof MembershipKeysSchema>;

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
/** An object's default row scope — {@link RowLevelSecurityPolicy} without `object`. */
export type DefaultRowScope = z.input<typeof DefaultRowScopeSchema>;
/** Post-parse shape of {@link DefaultRowScope} — defaults applied (ADR-0122). */
export type DefaultRowScopeParsed = z.infer<typeof DefaultRowScopeSchema>;
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
