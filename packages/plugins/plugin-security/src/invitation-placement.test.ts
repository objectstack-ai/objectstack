// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D8] Scoped-invitation placement.
 *
 * The load-bearing property: an invitation can never place what its ISSUER
 * could not have assigned directly. That is enforced by dry-running the very
 * same `DelegatedAdminGate` (ADR-0090 D12) against the `sys_user_position`
 * rows the acceptance would write — so these tests pin the WIRING (the gate
 * sees the right operation shape) rather than re-testing the gate's own
 * subtree/allowlist logic, which `delegated-admin-gate.test.ts` owns.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createInvitationPlacementService,
  readPlacementIntent,
} from './invitation-placement.js';

const INTENT = { businessUnitId: 'bu_plant_a', positions: ['qc_inspector', 'line_lead'] };

/**
 * A `find`-capable engine stub. `assertIssuable` resolves the issuer's grants
 * through the shared authz resolver, which reads the identity tables — so the
 * stub answers per-object like the real thing (unknown tables → empty, matching
 * the resolver's fail-closed reads).
 */
function makeQl(tables: Record<string, any[]> = {}) {
  return {
    find: vi.fn(async (object: string, opts: any = {}) => {
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return rows.filter((row) =>
        Object.entries(where).every(([k, v]) =>
          { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return v && typeof v === 'object' && '$in' in (v as any)
            ? (v as any).$in.includes(row[k])
            : row[k] === v; },
        ),
      );
    }),
    findOne: vi.fn(async () => null),
    insert: vi.fn(async (_o: string, row: any) => ({ id: 'row', ...row })),
  };
}

function makeService(overrides: { assert?: any; ql?: any } = {}) {
  const assert = overrides.assert ?? vi.fn(async () => {});
  const ql = overrides.ql ?? makeQl();
  const svc = createInvitationPlacementService({ ql, gate: { assert }, logger: { info: vi.fn() } });
  return { svc, assert, ql };
}

describe('readPlacementIntent', () => {
  it('reads snake_case and camelCase rows alike', () => {
    expect(readPlacementIntent({ business_unit_id: 'bu1', positions: ['a'] })).toEqual({
      businessUnitId: 'bu1',
      positions: ['a'],
    });
    expect(readPlacementIntent({ businessUnitId: 'bu1', positions: ['a'] })).toEqual({
      businessUnitId: 'bu1',
      positions: ['a'],
    });
  });

  it('parses a positions value that round-tripped as JSON', () => {
    expect(readPlacementIntent({ business_unit_id: 'bu1', positions: '["a","b"]' })?.positions).toEqual(['a', 'b']);
  });

  it('is null for an ordinary invitation — no BU, no positions, or neither', () => {
    expect(readPlacementIntent({ business_unit_id: 'bu1' })).toBeNull();
    expect(readPlacementIntent({ positions: ['a'] })).toBeNull();
    expect(readPlacementIntent({})).toBeNull();
    expect(readPlacementIntent(null)).toBeNull();
    // Junk entries are dropped, and an all-junk list is no intent at all.
    expect(readPlacementIntent({ business_unit_id: 'bu1', positions: ['', 7, null] })).toBeNull();
  });
});

describe('assertIssuable — the gate decides, verbatim', () => {
  it('dry-runs the gate against the sys_user_position rows the acceptance would write', async () => {
    const { svc, assert } = makeService();

    await svc.assertIssuable({ intent: INTENT, actorUserId: 'u_issuer', organizationId: 'org_1' });

    expect(assert).toHaveBeenCalledTimes(1);
    const opCtx = assert.mock.calls[0][0];
    expect(opCtx.object).toBe('sys_user_position');
    expect(opCtx.operation).toBe('insert');
    expect(opCtx.context).toMatchObject({ userId: 'u_issuer', tenantId: 'org_1' });
    // One row per requested position, each anchored to the target unit — the
    // exact shape `assertAssignmentWrite` boundary-checks.
    expect(opCtx.data).toEqual([
      { position: 'qc_inspector', business_unit_id: 'bu_plant_a', organization_id: 'org_1' },
      { position: 'line_lead', business_unit_id: 'bu_plant_a', organization_id: 'org_1' },
    ]);
  });

  // ── Regression (#3663): the gate reads authority off `context.positions` /
  //    `context.permissions`. Issuance used to hand it a hand-built
  //    `{ userId, tenantId }`, which resolves to the additive baseline and
  //    nothing else — so EVERY delegate was refused and the whole feature was
  //    fail-closed but dead. The issuer's grants must be RESOLVED, not assumed.
  it("carries the issuer's real grants — a delegate's adminScope reaches the gate", async () => {
    const ql = makeQl({
      sys_user: [{ id: 'u_issuer', email: 'plant.admin@x.test' }],
      sys_member: [{ user_id: 'u_issuer', organization_id: 'org_1', role: 'member' }],
      sys_user_position: [
        { user_id: 'u_issuer', position: 'plant_admin', organization_id: 'org_1' },
      ],
    });
    const { svc, assert } = makeService({ ql });

    await svc.assertIssuable({ intent: INTENT, actorUserId: 'u_issuer', organizationId: 'org_1' });

    const ctx = assert.mock.calls[0][0].context;
    expect(ctx.positions).toContain('plant_admin');
    // The gate's own set resolution turns positions into permission sets — the
    // wiring's job is only to make sure they are THERE to resolve.
    expect(Array.isArray(ctx.permissions)).toBe(true);
  });

  it('propagates the gate refusal — an unauthorized placement is not swallowed', async () => {
    const assert = vi.fn(async () => {
      throw new Error("business unit 'bu_plant_b' is outside the delegated subtree");
    });
    const { svc } = makeService({ assert });
    await expect(
      svc.assertIssuable({ intent: INTENT, actorUserId: 'u', organizationId: 'org_1' }),
    ).rejects.toThrow(/outside the delegated subtree/);
  });

  it('does not stamp organization_id when the deployment has no org context (single posture)', async () => {
    const { svc, assert } = makeService();
    await svc.assertIssuable({ intent: INTENT, actorUserId: 'u', organizationId: null });
    expect(assert.mock.calls[0][0].data[0]).toEqual({
      position: 'qc_inspector',
      business_unit_id: 'bu_plant_a',
    });
  });

  it('an issuer-less call reaches the gate with no principal — it owns that refusal', async () => {
    const { svc, assert } = makeService();
    await svc.assertIssuable({ intent: INTENT, actorUserId: null, organizationId: 'org_1' });
    // Empty context ⇒ the gate's principal-less branch denies. Deciding here
    // instead would put a second refusal path on the security boundary.
    expect(assert.mock.calls[0][0].context).toEqual({});
  });
});

describe('apply — accept-time placement', () => {
  it('creates one assignment per position, stamped with the issuer as granted_by', async () => {
    const { svc, ql } = makeService();
    const result = await svc.apply({
      intent: INTENT,
      userId: 'u_invitee',
      organizationId: 'org_1',
      grantedBy: 'u_issuer',
    });

    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(ql.insert).toHaveBeenCalledTimes(2);
    const [object, row, opts] = ql.insert.mock.calls[0];
    expect(object).toBe('sys_user_position');
    expect(row).toMatchObject({
      user_id: 'u_invitee',
      position: 'qc_inspector',
      business_unit_id: 'bu_plant_a',
      organization_id: 'org_1',
      granted_by: 'u_issuer',
    });
    // Applied under system context: the acceptance actor is the INVITEE, who
    // holds no RBAC-write authority. The authorization already happened at
    // issuance, against the issuer.
    expect(opts.context).toMatchObject({ isSystem: true });
  });

  it('is idempotent — a replayed acceptance converges instead of duplicating', async () => {
    const ql = {
      findOne: vi.fn(async () => ({ id: 'existing' })),
      insert: vi.fn(async () => ({ id: 'x' })),
    };
    const { svc } = makeService({ ql });
    const result = await svc.apply({ intent: INTENT, userId: 'u_invitee', organizationId: 'org_1' });
    expect(result).toEqual({ created: 0, skipped: 2 });
    expect(ql.insert).not.toHaveBeenCalled();
  });

  it('an unreadable pre-image does not block placement (treated as absent)', async () => {
    const ql = {
      findOne: vi.fn(async () => {
        throw new Error('driver hiccup');
      }),
      insert: vi.fn(async () => ({ id: 'x' })),
    };
    const { svc } = makeService({ ql });
    const result = await svc.apply({ intent: INTENT, userId: 'u', organizationId: 'org_1' });
    expect(result.created).toBe(2);
  });
});
