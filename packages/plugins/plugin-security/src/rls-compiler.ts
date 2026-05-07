// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * RLS User Context
 * Variables available for RLS expression evaluation.
 */
interface RLSUserContext {
  id?: string;
  /**
   * Active organization id for the request. RLS expressions reference
   * this as `current_user.organization_id`. Sourced from
   * `ExecutionContext.tenantId` (the runtime keeps the abstract
   * "tenant" name, but at the data/RLS layer the canonical column is
   * `organization_id` — see better-auth's organization plugin).
   */
  organization_id?: string;
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Sentinel filter used when applicable RLS policies exist but none can
 * be compiled against the current execution context (typically because a
 * required `current_user.*` variable is missing — e.g. the user has no
 * active organization). The filter compares `id` against a non-printable
 * UUID-shaped string that no real record will ever carry, so the upstream
 * SQL layer naturally returns zero rows without raising an error. This
 * gives us **fail-closed** semantics for select/update/delete on tables
 * that the user is not entitled to see, without forcing every caller to
 * handle a thrown `PermissionDeniedError` for what is conceptually an
 * empty result set.
 *
 * Exposed for the SecurityPlugin's optional short-circuit path and for
 * tests; see {@link RLSCompiler.compileFilter}.
 */
export const RLS_DENY_FILTER: Record<string, unknown> = Object.freeze({
  id: '__rls_deny__:00000000-0000-0000-0000-000000000000',
});

/**
 * RLSCompiler
 * 
 * Compiles Row-Level Security policy expressions into query filters.
 * Converts `using` / `check` expressions into ObjectQL-compatible filter conditions.
 */
export class RLSCompiler {
  /**
   * Compile RLS policies into a query filter for the given user context.
   * Multiple policies for the same object/operation are OR-combined (any match allows access).
   *
   * Return-value semantics:
   * - `null`   → no policies applicable → caller applies no RLS filter.
   * - non-null → caller AND's it onto the existing where clause.
   * - {@link RLS_DENY_FILTER} → policies were defined but none could be
   *   compiled (e.g. wildcard `tenant_isolation` against a user with no
   *   active organization). The caller must treat this as "deny by
   *   default" — its `id` comparison naturally yields zero rows on
   *   select/update/delete, which is the safe fail-closed answer.
   */
  compileFilter(
    policies: RowLevelSecurityPolicy[],
    executionContext?: ExecutionContext
  ): Record<string, unknown> | null {
    if (policies.length === 0) return null;

    const userCtx: RLSUserContext = {
      id: executionContext?.userId,
      organization_id: executionContext?.tenantId,
      roles: executionContext?.roles,
    };

    const filters: Record<string, unknown>[] = [];

    for (const policy of policies) {
      if (!policy.using) continue;
      const filter = this.compileExpression(policy.using, userCtx);
      if (filter) {
        filters.push(filter);
      }
    }

    if (filters.length === 0) {
      // Policies *were* applicable but every one of them depended on a
      // `current_user.*` variable that wasn't populated (or used an
      // expression we couldn't compile). Fail closed — return a sentinel
      // filter that matches no rows. This prevents the "user without an
      // active org sees every tenant's data" class of bug.
      return RLS_DENY_FILTER;
    }
    if (filters.length === 1) return filters[0];

    // Multiple policies: OR-combine (any policy allows access)
    return { $or: filters };
  }

  /**
   * Compile a single RLS expression into a query filter.
   * 
   * Supports simple expressions like:
   * - "field_name = current_user.property"
   * - "field_name IN (current_user.array_property)"
   * - "field_name = 'literal_value'"
   */
  compileExpression(
    expression: string,
    userCtx: RLSUserContext
  ): Record<string, unknown> | null {
    if (!expression) return null;

    // Handle simple equality: "field = current_user.property"
    const eqMatch = expression.match(/^\s*(\w+)\s*=\s*current_user\.(\w+)\s*$/);
    if (eqMatch) {
      const [, field, prop] = eqMatch;
      const value = userCtx[prop];
      // Skip when the user-context value is missing (undefined or null).
      // A `null` `organization_id` means "no active organization" — applying
      // the filter as `organization_id IS NULL` would silently expose every
      // un-tenanted row across tenants and break system tables that lack the
      // column entirely. Treating null as "skip this policy" makes the
      // tenant_isolation rule safely opt-out for users without an active org
      // while still applying when one is set.
      if (value === undefined || value === null) return null;
      return { [field]: value };
    }

    // Handle literal equality: "field = 'value'"
    const litMatch = expression.match(/^\s*(\w+)\s*=\s*'([^']*)'\s*$/);
    if (litMatch) {
      const [, field, value] = litMatch;
      return { [field]: value };
    }

    // Handle IN: "field IN (current_user.array_property)"
    const inMatch = expression.match(/^\s*(\w+)\s+IN\s+\(\s*current_user\.(\w+)\s*\)\s*$/i);
    if (inMatch) {
      const [, field, prop] = inMatch;
      const value = userCtx[prop];
      if (!Array.isArray(value) || value.length === 0) return null;
      return { [field]: { $in: value } };
    }

    // Unsupported expression: return null (no additional RLS filter applied).
    // Note: callers should treat absence of RLS policies as "allow all" only when
    // no policies are defined. If policies exist but cannot be compiled, the caller
    // may want to deny access as a safety measure.
    return null;
  }

  /**
   * Get applicable RLS policies for a given object and operation.
   */
  getApplicablePolicies(
    objectName: string,
    operation: string,
    allPolicies: RowLevelSecurityPolicy[]
  ): RowLevelSecurityPolicy[] {
    // Map engine operation to RLS operation type
    const rlsOp = this.mapOperationToRLS(operation);

    return allPolicies.filter(policy => {
      // Check object match
      if (policy.object !== objectName && policy.object !== '*') return false;

      // Check operation match
      if (policy.operation === 'all') return true;
      if (policy.operation === rlsOp) return true;

      return false;
    });
  }

  private mapOperationToRLS(operation: string): string {
    switch (operation) {
      case 'find':
      case 'findOne':
      case 'count':
      case 'aggregate':
        return 'select';
      case 'insert':
        return 'insert';
      case 'update':
        return 'update';
      case 'delete':
        return 'delete';
      default:
        return 'select';
    }
  }
}
