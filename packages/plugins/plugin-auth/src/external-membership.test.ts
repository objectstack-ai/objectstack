// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling 6355206139, letter B, stage 1, E5/E6] The `external` role's write-side
 * invariants, driven through the registered hooks with the HookContext shapes
 * the engine builds (`input.data`, and `previous` on an update).
 */

import { describe, it, expect } from 'vitest';
import { validationFailureDetails } from '@objectstack/types';
import {
  assertExternalRoleExclusive,
  carriesExternalRole,
  isExternalMembershipRole,
  registerExternalMembershipGuard,
} from './external-membership.js';

type Handler = (ctx: any) => Promise<void>;

/** A fake engine: captured hooks, and `find` over in-memory tables with `$in`. */
function makeEngine(tables: Record<string, any[]>) {
  const hooks: Array<{ event: string; object: string; priority: number; handler: Handler }> = [];
  const engine = {
    getSchema: (name: string) => (name in tables ? { name } : undefined),
    registerHook: (event: string, handler: Handler, opts: any) => {
      hooks.push({ event, object: opts.object, priority: opts.priority, handler });
    },
    find: async (object: string, opts: any) => {
      const where = opts?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) =>
          v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(r[k]) : r[k] === v,
        ),
      );
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
  };
  registerExternalMembershipGuard(engine, { packageId: 'test' });
  const fire = async (event: string, object: string, ctx: any) => {
    for (const h of hooks.filter((x) => x.event === event && x.object === object)) await h.handler(ctx);
  };
  return { hooks, fire };
}

async function refusal(run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    return { details: validationFailureDetails(e), message: (e as Error).message };
  }
  return undefined;
}

const TABLES = () => ({
  sys_member: [
    { id: 'm_ext', user_id: 'u_ext', organization_id: 'org_a', role: 'external' },
    { id: 'm_emp', user_id: 'u_emp', organization_id: 'org_a', role: 'member' },
    { id: 'm_ext_b', user_id: 'u_ext', organization_id: 'org_b', role: 'member' },
  ],
  sys_invitation: [],
  sys_business_unit: [
    { id: 'bu_a', organization_id: 'org_a' },
    { id: 'bu_b', organization_id: 'org_b' },
  ],
  sys_business_unit_member: [{ id: 'bum_emp', user_id: 'u_emp', business_unit_id: 'bu_a' }],
  sys_user_position: [] as any[],
});

describe('the external role predicates', () => {
  it('reads the canonical spelling and the list form', () => {
    expect(isExternalMembershipRole('external')).toBe(true);
    expect(isExternalMembershipRole(' External ')).toBe(true);
    expect(isExternalMembershipRole('external,member')).toBe(false);
    expect(carriesExternalRole('external,member')).toBe(true);
    expect(carriesExternalRole('member')).toBe(false);
    expect(isExternalMembershipRole(undefined)).toBe(false);
  });

  it('E5: external beside another role is refused, external alone is not', () => {
    expect(() => assertExternalRoleExclusive('external,member')).toThrow(/cannot be combined/);
    expect(() => assertExternalRoleExclusive('admin, external')).toThrow(/cannot be combined/);
    expect(() => assertExternalRoleExclusive('external')).not.toThrow();
    expect(() => assertExternalRoleExclusive('owner,admin')).not.toThrow();
  });
});

describe('the registered guard', () => {
  it('registers before-insert and before-update on the four objects, right after the role canonicalisation', () => {
    const { hooks } = makeEngine(TABLES());
    expect(new Set(hooks.map((h) => h.object))).toEqual(
      new Set(['sys_member', 'sys_invitation', 'sys_business_unit_member', 'sys_user_position']),
    );
    for (const h of hooks) expect(h.priority).toBe(6);
  });

  describe('E5 exclusivity, at the write', () => {
    for (const object of ['sys_member', 'sys_invitation']) {
      it(`${object}: a mixed role list is refused 400 VALIDATION_FAILED on role, code invalid_value`, async () => {
        const { fire } = makeEngine(TABLES());
        const r = await refusal(() =>
          fire('beforeInsert', object, { input: { data: { user_id: 'u_new', organization_id: 'org_a', email: 'n@x.test', role: 'external,member' } } }),
        );
        expect(r?.details?.code).toBe('VALIDATION_FAILED');
        expect(r?.details?.fields).toEqual([expect.objectContaining({ field: 'role', code: 'invalid_value' })]);
      });

      it(`${object}: external alone, and an ordinary role list, pass`, async () => {
        const { fire } = makeEngine(TABLES());
        for (const role of ['external', 'member', 'owner,admin']) {
          await expect(
            fire('beforeInsert', object, { input: { data: { user_id: 'u_new', organization_id: 'org_a', email: 'n@x.test', role } } }),
          ).resolves.toBeUndefined();
        }
      });
    }

    it('sys_member: an update to a mixed list is refused too', async () => {
      const { fire } = makeEngine(TABLES());
      const r = await refusal(() =>
        fire('beforeUpdate', 'sys_member', { input: { id: 'm_emp', data: { role: 'member,external' } }, previous: TABLES().sys_member[1] }),
      );
      expect(r?.details?.fields?.[0]).toMatchObject({ field: 'role', code: 'invalid_value' });
    });
  });

  describe('E6 no placement in the department tree', () => {
    it('an external is refused a business-unit membership in its organization', async () => {
      const { fire } = makeEngine(TABLES());
      const r = await refusal(() =>
        fire('beforeInsert', 'sys_business_unit_member', { input: { data: { user_id: 'u_ext', business_unit_id: 'bu_a' } } }),
      );
      expect(r?.details?.fields?.[0]).toMatchObject({ field: 'user_id', code: 'invalid_value' });
    });

    it('the stamp is per organization: the same user, a member of org_b, is placed there', async () => {
      const { fire } = makeEngine(TABLES());
      await expect(
        fire('beforeInsert', 'sys_business_unit_member', { input: { data: { user_id: 'u_ext', business_unit_id: 'bu_b' } } }),
      ).resolves.toBeUndefined();
    });

    it('CONTROL: an ordinary member is placed as before', async () => {
      const { fire } = makeEngine(TABLES());
      await expect(
        fire('beforeInsert', 'sys_business_unit_member', { input: { data: { user_id: 'u_emp', business_unit_id: 'bu_a' } } }),
      ).resolves.toBeUndefined();
    });

    it('an update moving a placement onto an external is judged on the merged row', async () => {
      const { fire } = makeEngine(TABLES());
      const r = await refusal(() =>
        fire('beforeUpdate', 'sys_business_unit_member', {
          input: { id: 'bum_emp', data: { user_id: 'u_ext' } },
          previous: { id: 'bum_emp', user_id: 'u_emp', business_unit_id: 'bu_a' },
        }),
      );
      expect(r?.details?.code).toBe('VALIDATION_FAILED');
    });

    it('a position anchored at one of its business units is refused; an organization-wide position is admitted', async () => {
      const { fire } = makeEngine(TABLES());
      const anchored = await refusal(() =>
        fire('beforeInsert', 'sys_user_position', {
          input: { data: { user_id: 'u_ext', position: 'supplier_portal', organization_id: 'org_a', business_unit_id: 'bu_a' } },
        }),
      );
      expect(anchored?.details?.fields?.[0]).toMatchObject({ field: 'business_unit_id', code: 'invalid_value' });
      await expect(
        fire('beforeInsert', 'sys_user_position', {
          input: { data: { user_id: 'u_ext', position: 'supplier_portal', organization_id: 'org_a' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('an invitation conferring external carries no business unit; an ordinary one still may', async () => {
      const { fire } = makeEngine(TABLES());
      const r = await refusal(() =>
        fire('beforeInsert', 'sys_invitation', {
          input: { data: { email: 's@x.test', organization_id: 'org_a', role: 'external', business_unit_id: 'bu_a' } },
        }),
      );
      expect(r?.details?.fields?.[0]).toMatchObject({ field: 'business_unit_id', code: 'invalid_value' });
      await expect(
        fire('beforeInsert', 'sys_invitation', {
          input: { data: { email: 'e@x.test', organization_id: 'org_a', role: 'member', business_unit_id: 'bu_a' } },
        }),
      ).resolves.toBeUndefined();
    });

    it('a membership does not become external while a placement stands', async () => {
      const { fire } = makeEngine(TABLES());
      const r = await refusal(() =>
        fire('beforeUpdate', 'sys_member', {
          input: { id: 'm_emp', data: { role: 'external' } },
          previous: { id: 'm_emp', user_id: 'u_emp', organization_id: 'org_a', role: 'member' },
        }),
      );
      expect(r?.details?.fields?.[0]).toMatchObject({ field: 'role', code: 'invalid_value' });
    });

    it('…and does once the placement is gone', async () => {
      const tables = TABLES();
      tables.sys_business_unit_member = [];
      const { fire } = makeEngine(tables);
      await expect(
        fire('beforeUpdate', 'sys_member', {
          input: { id: 'm_emp', data: { role: 'external' } },
          previous: { id: 'm_emp', user_id: 'u_emp', organization_id: 'org_a', role: 'member' },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
