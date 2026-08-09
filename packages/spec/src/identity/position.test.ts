import { describe, it, expect } from 'vitest';
import { PositionSchema, type Position } from './position.zod';

describe('PositionSchema', () => {
  describe('Basic Properties', () => {
    it('should accept minimal position', () => {
      const position: Position = {
        name: 'ceo',
        label: 'CEO',
      };

      expect(() => PositionSchema.parse(position)).not.toThrow();
    });

    it('should enforce snake_case for position name', () => {
      const validNames = ['ceo', 'vp_sales', 'sales_manager', 'account_exec'];
      validNames.forEach(name => {
        expect(() => PositionSchema.parse({ name, label: 'Test' })).not.toThrow();
      });

      const invalidNames = ['CEO', 'VP-Sales', 'salesManager', '123position', '_internal'];
      invalidNames.forEach(name => {
        expect(() => PositionSchema.parse({ name, label: 'Test' })).toThrow();
      });
    });

    it('should accept position with description', () => {
      const position: Position = {
        name: 'sales_director',
        label: 'Sales Director',
        description: 'Oversees all sales operations',
      };

      expect(() => PositionSchema.parse(position)).not.toThrow();
    });
  });

  describe('Delegation (ADR-0091 D3)', () => {
    it('defaults delegatable to false (opt-in)', () => {
      const parsed = PositionSchema.parse({ name: 'approver', label: 'Approver' });
      expect(parsed.delegatable).toBe(false);
    });

    it('accepts an explicit delegatable flag', () => {
      expect(PositionSchema.parse({ name: 'approver', label: 'Approver', delegatable: true }).delegatable).toBe(true);
      expect(PositionSchema.parse({ name: 'approver', label: 'Approver', delegatable: false }).delegatable).toBe(false);
    });

    it('rejects a non-boolean delegatable', () => {
      expect(() => PositionSchema.parse({ name: 'approver', label: 'Approver', delegatable: 'yes' as any })).toThrow();
    });
  });

  describe('Hierarchy', () => {
    it('should accept position without parent (top level)', () => {
      const position: Position = {
        name: 'ceo',
        label: 'Chief Executive Officer',
      };

      expect(() => PositionSchema.parse(position)).not.toThrow();
    });

    it('rejects the retired `parent` hierarchy key (positions are flat, ADR-0090 D3)', () => {
      // Pre-ADR-0090 this test asserted `parent` parsed — which only "worked"
      // because zod's default `.strip` silently ate the key; no position tree
      // ever existed. Since #4001 the fiction is a loud error instead.
      const result = PositionSchema.safeParse({
        name: 'vp_sales',
        label: 'VP of Sales',
        parent: 'ceo',
      });
      expect(result.success).toBe(false);
      expect(
        result.error!.issues.find((i) => i.code === 'unrecognized_keys')!.message,
      ).toContain('business-unit');
    });
  });

  describe('Real-World Position Examples', () => {
    it('should accept a complete sales organization (flat — ADR-0090 D3)', () => {
      const positions: Position[] = [
        {
          name: 'ceo',
          label: 'Chief Executive Officer',
          description: 'Top executive position',
        },
        {
          name: 'vp_sales',
          label: 'VP of Sales',
          description: 'Leads entire sales organization',
        },
        {
          name: 'regional_sales_director',
          label: 'Regional Sales Director',
          description: 'Manages sales for a specific region',
        },
        {
          name: 'sales_manager',
          label: 'Sales Manager',
          description: 'Manages a team of sales representatives',
        },
        {
          name: 'senior_sales_rep',
          label: 'Senior Sales Representative',
          description: 'Senior member of sales team',
        },
        {
          name: 'sales_rep',
          label: 'Sales Representative',
          description: 'Individual contributor in sales',
        },
      ];

      positions.forEach(position => {
        expect(() => PositionSchema.parse(position)).not.toThrow();
      });
    });

    it('should accept a service organization (flat)', () => {
      const positions: Position[] = [
        {
          name: 'vp_customer_success',
          label: 'VP of Customer Success',
        },
        {
          name: 'support_manager',
          label: 'Support Manager',
        },
        {
          name: 'senior_support_agent',
          label: 'Senior Support Agent',
        },
        {
          name: 'support_agent',
          label: 'Support Agent',
        },
      ];

      positions.forEach(position => {
        expect(() => PositionSchema.parse(position)).not.toThrow();
      });
    });

    it('should accept a product organization (flat)', () => {
      const positions: Position[] = [
        {
          name: 'cto',
          label: 'Chief Technology Officer',
        },
        {
          name: 'vp_engineering',
          label: 'VP of Engineering',
        },
        {
          name: 'engineering_manager',
          label: 'Engineering Manager',
          description: 'Manages engineering team',
        },
        {
          name: 'tech_lead',
          label: 'Technical Lead',
        },
        {
          name: 'senior_engineer',
          label: 'Senior Software Engineer',
        },
        {
          name: 'engineer',
          label: 'Software Engineer',
        },
      ];

      positions.forEach(position => {
        expect(() => PositionSchema.parse(position)).not.toThrow();
      });
    });

    it('should accept a matrix organization (reporting lines live on sys_user.manager_id, not positions)', () => {
      const positions: Position[] = [
        {
          name: 'ceo',
          label: 'CEO',
        },
        {
          name: 'regional_vp_americas',
          label: 'Regional VP - Americas',
        },
        {
          name: 'regional_vp_emea',
          label: 'Regional VP - EMEA',
        },
        {
          name: 'regional_vp_apac',
          label: 'Regional VP - APAC',
        },
        {
          name: 'country_manager_us',
          label: 'Country Manager - US',
        },
        {
          name: 'country_manager_uk',
          label: 'Country Manager - UK',
        },
      ];

      positions.forEach(position => {
        expect(() => PositionSchema.parse(position)).not.toThrow();
      });
    });

    it('should accept flat organization', () => {
      const positions: Position[] = [
        {
          name: 'founder',
          label: 'Founder',
        },
        {
          name: 'team_member',
          label: 'Team Member',
        },
      ];

      positions.forEach(position => {
        expect(() => PositionSchema.parse(position)).not.toThrow();
      });
    });
  });
});

// #4001 step 2 — PositionSchema joins the strict ratchet, and gains the
// ADR-0010 protection envelope the #4071 ledger flagged as the known sibling
// gap (applyProtection stamps EVERY registered metadata type; position could
// not represent the stamp).
describe('unknown keys are rejected, not stripped (#4001)', () => {
  const unknownKeyIssue = (value: unknown) => {
    const result = PositionSchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.error!.issues.find((i) => i.code === 'unrecognized_keys');
  };

  it('rejects an undeclared key instead of silently dropping it', () => {
    expect(unknownKeyIssue({ name: 'p', label: 'P', notAKey: 1 })!.message)
      .toContain('`notAKey`');
  });

  it('points permissionSets/users/parent at the runtime binding or flatness rule', () => {
    expect(unknownKeyIssue({ name: 'p', label: 'P', permissionSets: [] })!.message)
      .toContain('sys_position_permission_set');
    expect(unknownKeyIssue({ name: 'p', label: 'P', users: [] })!.message)
      .toContain('sys_user_position');
    expect(unknownKeyIssue({ name: 'p', label: 'P', parent: 'boss' })!.message)
      .toContain('FLAT');
  });

  it('round-trips the ADR-0010 runtime protection envelope', () => {
    const parsed = PositionSchema.parse({
      name: 'auditor', label: 'Auditor',
      _packageId: 'com.showcase', _provenance: 'package', _lock: 'full',
    });
    expect(parsed._packageId).toBe('com.showcase');
    expect(parsed._lock).toBe('full');
  });
});
