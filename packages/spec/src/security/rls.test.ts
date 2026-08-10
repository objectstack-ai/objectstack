import { describe, it, expect } from 'vitest';
import {
  RowLevelSecurityPolicySchema,
  RLSUserContextSchema,
  RLSEvaluationResultSchema,
  RLSOperation,
  RLS,
  type RowLevelSecurityPolicy,
} from './rls.zod';

describe('Row-Level Security (RLS) Protocol', () => {
  describe('RLSOperation', () => {
    it('should validate allowed operations', () => {
      expect(RLSOperation.parse('select')).toBe('select');
      expect(RLSOperation.parse('insert')).toBe('insert');
      expect(RLSOperation.parse('update')).toBe('update');
      expect(RLSOperation.parse('delete')).toBe('delete');
      expect(RLSOperation.parse('all')).toBe('all');
    });

    it('should reject invalid operations', () => {
      expect(() => RLSOperation.parse('invalid')).toThrow();
      expect(() => RLSOperation.parse('merge')).toThrow();
    });
  });

  describe('RowLevelSecurityPolicySchema', () => {
    it('should validate a minimal policy', () => {
      const policy = {
        name: 'tenant_isolation',
        object: 'account',
        operation: 'select',
        using: 'organization_id == current_user.organization_id',
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.name).toBe('tenant_isolation');
      expect(result.enabled).toBe(true); // default
      expect('priority' in result, 'retired key contributes nothing to the parsed output').toBe(false);
    });

    it('should validate a complete policy with all fields', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'manager_team_access',
        label: 'Managers Can View Team Records',
        description: 'Allow managers to view records of their team members',
        object: 'task',
        operation: 'select',
        using: 'assigned_to_id IN (SELECT id FROM users WHERE manager_id = current_user.id)',
        check: 'assigned_to_id IN (SELECT id FROM users WHERE manager_id = current_user.id)',
        positions: ['manager', 'director'],
        enabled: true,
        tags: ['team_access', 'hierarchy'],
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result).toEqual(policy);
    });

    it('should enforce snake_case naming convention', () => {
      const validPolicy = {
        name: 'valid_policy_name',
        object: 'account',
        operation: 'select',
        using: 'owner_id == current_user.id',
      };

      expect(() => RowLevelSecurityPolicySchema.parse(validPolicy)).not.toThrow();

      const invalidPolicy = {
        name: 'InvalidPolicyName', // camelCase not allowed
        object: 'account',
        operation: 'select',
        using: 'owner_id == current_user.id',
      };

      expect(() => RowLevelSecurityPolicySchema.parse(invalidPolicy)).toThrow();
    });

    it('should allow complex USING clauses', () => {
      const complexPolicies = [
        {
          name: 'multi_condition',
          object: 'opportunity',
          operation: 'select',
          using: 'owner_id = current_user.id OR team_id = current_user.team_id',
        },
        {
          name: 'with_subquery',
          object: 'account',
          operation: 'select',
          using: 'region IN (SELECT region FROM user_territories WHERE user_id = current_user.id)',
        },
        {
          name: 'time_based',
          object: 'contract',
          operation: 'select',
          using: 'status = "active" AND start_date <= NOW() AND end_date >= NOW()',
        },
      ];

      complexPolicies.forEach(policy => {
        expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
      });
    });

    it('should default enabled to true if not specified', () => {
      const policy = {
        name: 'test_policy',
        object: 'account',
        operation: 'select',
        using: 'owner_id == current_user.id',
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.enabled).toBe(true);
    });

    it('priority is RETIRED: absent parses clean, authored rejects with the prescription', () => {
      // Removed by the 2026-07-30 #3896 security audit: policies OR-combine
      // (most permissive wins), so the promised "conflict resolution" cannot
      // exist and nothing ever read the key. The tombstone keeps the removal
      // audible instead of silently stripping an authored value.
      const policy = {
        name: 'test_policy',
        object: 'account',
        operation: 'select',
        using: 'owner_id == current_user.id',
      };
      expect('priority' in RowLevelSecurityPolicySchema.parse(policy)).toBe(false);

      const authored = { ...policy, priority: 10 } as never;
      const r = RowLevelSecurityPolicySchema.safeParse(authored);
      expect(r.success).toBe(false);
      expect(JSON.stringify(!r.success ? r.error.issues : [])).toContain('removed in @objectstack/spec 17.0.0');
    });

    it('should handle policies for all operations', () => {
      const policy = {
        name: 'tenant_all_ops',
        object: 'account',
        operation: 'all',
        using: 'organization_id == current_user.organization_id',
        check: 'organization_id == current_user.organization_id',
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.operation).toBe('all');
    });

    it('should validate position restrictions', () => {
      const policy = {
        name: 'sales_only',
        object: 'opportunity',
        operation: 'select',
        using: 'region = current_user.region',
        positions: ['sales_rep', 'sales_manager'],
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.positions).toEqual(['sales_rep', 'sales_manager']);
    });

    it('should validate tags', () => {
      const policy = {
        name: 'gdpr_policy',
        object: 'customer',
        operation: 'select',
        using: 'country IN (SELECT country FROM gdpr_countries)',
        tags: ['compliance', 'gdpr', 'privacy'],
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.tags).toEqual(['compliance', 'gdpr', 'privacy']);
    });
  });

  describe('RLSUserContextSchema', () => {
    it('should validate minimal user context', () => {
      const context = {
        id: 'user_123',
      };

      const result = RLSUserContextSchema.parse(context);
      expect(result.id).toBe('user_123');
    });

    it('should validate complete user context', () => {
      const context = {
        id: 'user_123',
        email: 'john@example.com',
        tenantId: 'tenant_456',
        positions: ['sales_rep'],
        department: 'sales',
        attributes: {
          region: 'US-West',
          manager_id: 'user_789',
          custom_field: 'custom_value',
        },
      };

      const result = RLSUserContextSchema.parse(context);
      expect(result).toEqual(context);
    });

    it('should validate positions as an array (ADR-0090 D3 — formerly `role`)', () => {
      const context = {
        id: 'user_123',
        positions: ['sales_rep', 'team_lead'],
      };

      const result = RLSUserContextSchema.parse(context);
      expect(result.positions).toEqual(['sales_rep', 'team_lead']);
    });

    it('should validate email format', () => {
      const validContext = {
        id: 'user_123',
        email: 'valid@example.com',
      };
      expect(() => RLSUserContextSchema.parse(validContext)).not.toThrow();

      const invalidContext = {
        id: 'user_123',
        email: 'invalid-email',
      };
      expect(() => RLSUserContextSchema.parse(invalidContext)).toThrow();
    });

    it('should allow custom attributes', () => {
      const context = {
        id: 'user_123',
        attributes: {
          custom_field_1: 'value1',
          custom_field_2: 123,
          custom_field_3: true,
          nested_object: {
            key: 'value',
          },
        },
      };

      const result = RLSUserContextSchema.parse(context);
      expect(result.attributes).toEqual(context.attributes);
    });
  });

  describe('RLSEvaluationResultSchema', () => {
    it('should validate minimal evaluation result', () => {
      const result = {
        policyName: 'tenant_isolation',
        granted: true,
      };

      expect(() => RLSEvaluationResultSchema.parse(result)).not.toThrow();
    });

    it('should validate complete evaluation result', () => {
      const result = {
        policyName: 'owner_access',
        granted: true,
        durationMs: 15.5,
        usingResult: true,
        checkResult: true,
      };

      const parsed = RLSEvaluationResultSchema.parse(result);
      expect(parsed).toEqual(result);
    });

    it('should validate failed evaluation with error', () => {
      const result = {
        policyName: 'complex_policy',
        granted: false,
        durationMs: 25.3,
        error: 'Failed to evaluate subquery',
        usingResult: false,
      };

      const parsed = RLSEvaluationResultSchema.parse(result);
      expect(parsed.granted).toBe(false);
      expect(parsed.error).toBe('Failed to evaluate subquery');
    });
  });

  describe('RLS Helper Factory', () => {
    describe('ownerPolicy', () => {
      it('should create owner-based policy with default owner field', () => {
        const policy = RLS.ownerPolicy('opportunity');

        expect(policy.name).toBe('opportunity_owner_access');
        expect(policy.object).toBe('opportunity');
        expect(policy.operation).toBe('all');
        expect(policy.using).toBe('owner_id == current_user.id');
        expect(policy.enabled).toBe(true);
      });

      it('should create owner-based policy with custom owner field', () => {
        const policy = RLS.ownerPolicy('task', 'assigned_to_id');

        expect(policy.using).toBe('assigned_to_id == current_user.id');
      });
    });

    describe('tenantPolicy', () => {
      it('should create tenant isolation policy with default field', () => {
        const policy = RLS.tenantPolicy('account');

        expect(policy.name).toBe('account_tenant_isolation');
        expect(policy.object).toBe('account');
        expect(policy.operation).toBe('all');
        expect(policy.using).toBe('organization_id == current_user.organization_id');
        expect(policy.check).toBe('organization_id == current_user.organization_id');
        expect(policy.enabled).toBe(true);
      });

      it('should create tenant isolation policy with custom field', () => {
        const policy = RLS.tenantPolicy('order', 'workspace_id');

        expect(policy.using).toBe('workspace_id == current_user.organization_id');
        expect(policy.check).toBe('workspace_id == current_user.organization_id');
      });
    });

    describe('positionPolicy', () => {
      it('should create a position-scoped policy', () => {
        const policy = RLS.positionPolicy(
          'sensitive_data',
          ['manager', 'director'],
          'department = current_user.department'
        );

        expect(policy.name).toBe('sensitive_data_manager_director_access');
        expect(policy.object).toBe('sensitive_data');
        expect(policy.operation).toBe('select');
        expect(policy.using).toBe('department = current_user.department');
        expect(policy.positions).toEqual(['manager', 'director']);
        expect(policy.enabled).toBe(true);
      });
    });

    describe('allowAllPolicy', () => {
      it('should create permissive policy for specified positions', () => {
        const policy = RLS.allowAllPolicy('account', ['ceo', 'cfo']);

        expect(policy.name).toBe('account_ceo_cfo_full_access');
        expect(policy.object).toBe('account');
        expect(policy.operation).toBe('all');
        expect(policy.using).toBe('1 == 1'); // Always true
        expect(policy.positions).toEqual(['ceo', 'cfo']);
        expect(policy.enabled).toBe(true);
      });
    });
  });

  describe('Real-World Use Cases', () => {
    it('should support multi-tenant SaaS isolation', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'saas_tenant_isolation',
        label: 'Multi-Tenant Data Isolation',
        description: 'Ensure users only access data from their own organization',
        object: 'customer',
        operation: 'all',
        using: 'organization_id == current_user.organization_id',
        check: 'organization_id == current_user.organization_id',
        enabled: true,
        tags: ['multi-tenant', 'security'],
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.using).toContain('organization_id');
    });

    it('should support hierarchical access (manager sees team data)', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'manager_team_hierarchy',
        label: 'Manager Team Hierarchy Access',
        object: 'performance_review',
        operation: 'select',
        using: `
          employee_id = current_user.id 
          OR employee_id IN (
            SELECT id FROM users 
            WHERE manager_id = current_user.id
          )
        `,
        positions: ['manager', 'director'],
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
    });

    it('should support regional sales territory access', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'sales_territory_access',
        label: 'Sales Territory-Based Access',
        object: 'account',
        operation: 'select',
        using: 'territory IN (SELECT territory FROM user_territories WHERE user_id = current_user.id)',
        positions: ['sales_rep'],
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
    });

    it('should support time-based access (active contracts only)', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'active_contracts_only',
        label: 'Active Contracts Only',
        object: 'contract',
        operation: 'select',
        using: 'status = "active" AND start_date <= NOW() AND end_date >= NOW()',
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
    });

    it('should support GDPR compliance (data residency)', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'gdpr_data_residency',
        label: 'GDPR Data Residency Compliance',
        description: 'Users can only access data from their allowed regions',
        object: 'customer_data',
        operation: 'select',
        using: 'country IN (SELECT country FROM user_allowed_countries WHERE user_id = current_user.id)',
        enabled: true,
        tags: ['gdpr', 'compliance', 'privacy'],
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.tags).toContain('gdpr');
    });

    it('should support shared team records', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'team_shared_access',
        label: 'Team Shared Records',
        object: 'project',
        operation: 'select',
        using: `
          owner_id = current_user.id 
          OR id IN (
            SELECT environment_id FROM project_members 
            WHERE user_id = current_user.id
          )
        `,
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
    });

    it('should support executive full access bypass', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'executive_full_access',
        label: 'Executive Full Access',
        description: 'C-level executives can view all data',
        object: 'financial_data',
        operation: 'all',
        using: '1 == 1', // Always true - see everything
        positions: ['ceo', 'cfo', 'cto'],
        enabled: true,
      };

      const result = RowLevelSecurityPolicySchema.parse(policy);
      expect(result.using).toBe('1 == 1');
    });
  });

  describe('Integration with Other Protocols', () => {
    it('should work alongside object permissions', () => {
      // Object permission grants read access
      // RLS filters which specific records can be read
      const rlsPolicy: RowLevelSecurityPolicy = {
        name: 'department_access',
        object: 'employee',
        operation: 'select',
        using: 'department = current_user.department',
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(rlsPolicy)).not.toThrow();
    });

    it('should support validation rules integration', () => {
      const policy: RowLevelSecurityPolicy = {
        name: 'prevent_backdating',
        object: 'transaction',
        operation: 'insert',
        using: '1 == 1',
        check: 'transaction_date >= CURRENT_DATE - INTERVAL "30 days"',
        enabled: true,
      };

      expect(() => RowLevelSecurityPolicySchema.parse(policy)).not.toThrow();
    });
  });
});

// #4001 step 2 — the authorable RLS policy is `.strict()`: an undeclared key
// used to be dropped by zod's default `.strip`, so a row-level restriction the
// author wrote was never compiled into the filter and nothing failed.
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const policy = {
    name: 'p', object: 'account', operation: 'select' as const,
    using: 'owner_id == current_user.id',
  };
  const unknownKeyIssue = (value: unknown) => {
    const result = RowLevelSecurityPolicySchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
  };

  it('rejects an undeclared key instead of silently dropping it', () => {
    expect(unknownKeyIssue({ ...policy, notAKey: 1 })!.message).toContain('`notAKey`');
  });

  it('points the pre-ADR-0090 `roles` vocabulary at `positions`', () => {
    expect(unknownKeyIssue({ ...policy, roles: ['manager'] })!.message)
      .toContain('`roles` → `positions`');
  });

  it('points PostgreSQL `WITH CHECK` spelling at `check`', () => {
    expect(unknownKeyIssue({ ...policy, withCheck: 'x = 1' })!.message)
      .toContain('`withCheck` → `check`');
  });

  it('points condition/filter/where at `using`', () => {
    for (const key of ['condition', 'filter', 'where']) {
      expect(unknownKeyIssue({ ...policy, [key]: 'x = 1' })!.message)
        .toContain(`\`${key}\` → \`using\``);
    }
  });

  it('keeps the retired `priority` tombstone prescription (not a bare strict error)', () => {
    const result = RowLevelSecurityPolicySchema.safeParse({ ...policy, priority: 10 });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('#3896');
    expect(messages).toContain('Delete the key');
  });
});

// ---------------------------------------------------------------------------
// #6762 — the published `using` description must describe what the compiler
// actually lowers, in the canonical dialect.
//
// It previously advertised "one of the four compiler-supported forms" and
// spelled all four in the SQL-ish dialect. Both halves were wrong in the same
// direction — it UNDER-promised, and it steered authors at the dialect being
// retired:
//
//   - `isSupportedRlsExpression` (`@objectstack/formula/src/rls-predicate.ts`)
//     is broader than four forms. Measured against the gate on this branch,
//     `!=`, `<`, `<=`, `>`, `>=`, `in` over an inline literal list, `&&`, `||`
//     and the bare `true` all ENFORCE — `rls-predicate.test.ts` already pins
//     that behaviour, so this file pins only that the PROSE agrees with it.
//   - ADR-0058 D1 makes CEL canonical and marks `sqlPredicateToCel`
//     `@deprecated`, so the SQL spellings are the transitional bridge, not the
//     definition.
//
// Deliberately NOT asserted: a count. Replacing an under-promising "four" with
// a differently-wrong number is the same defect, so the pin holds the SHAPE
// (which operators are advertised) and forbids the closed count instead.
//
// Asserted by IDIOM, not by sentence. The first case is the anti-vacuity arm:
// the negative assertion below would pass vacuously against `.describe('')`,
// so the non-empty check is what makes this pin fail on an emptied string
// rather than only on changed wording.
// ---------------------------------------------------------------------------
describe('RowLevelSecurityPolicySchema.using — the published description (#6762)', () => {
  const description = RowLevelSecurityPolicySchema.shape.using.description ?? '';

  it('is present and non-empty, so the generated reference row is not blank', () => {
    expect(description).not.toBe('');
    expect(description.trim().length).toBeGreaterThan(0);
  });

  it('names CEL as the dialect the predicate is authored in', () => {
    expect(description).toMatch(/\bCEL\b/);
  });

  it('advertises the comparison operators the compiler really lowers', () => {
    for (const operator of ['==', '!=', '<=', '>=']) {
      expect(description, `operator ${operator} must be advertised`).toContain(operator);
    }
  });

  it('advertises membership and boolean combination', () => {
    expect(description).toMatch(/\bin\b/);
    expect(description).toMatch(/&&/);
  });

  it('states the fail-closed verdict for anything that does not lower', () => {
    expect(description).toMatch(/fails? closed/i);
  });

  it('frames the SQL spellings as the transitional bridge, not the definition', () => {
    expect(description).toMatch(/transitional|bridge|deprecated/i);
  });

  it('does not re-close the set with a fixed count of forms', () => {
    expect(description).not.toMatch(/\bfour\b/i);
    expect(description).not.toMatch(/\b(one|two|three|four|five)\s+(compiler-supported\s+)?forms\b/i);
  });
});
