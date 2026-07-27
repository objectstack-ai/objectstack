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

function makeService(overrides: { assert?: any; ql?: any } = {}) {
  const assert = overrides.assert ?? vi.fn(async () => {});
  const ql = overrides.ql ?? {
    findOne: vi.fn(async () => null),
    insert: vi.fn(async (_o: string, row: any) => ({ id: 'row', ...row })),
  };
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
    const actorContext = { userId: 'u_issuer', tenantId: 'org_1' };

    await svc.assertIssuable({ intent: INTENT, actorContext, organizationId: 'org_1' });

    expect(assert).toHaveBeenCalledTimes(1);
    const opCtx = assert.mock.calls[0][0];
    expect(opCtx.object).toBe('sys_user_position');
    expect(opCtx.operation).toBe('insert');
    expect(opCtx.context).toBe(actorContext);
    // One row per requested position, each anchored to the target unit — the
    // exact shape `assertAssignmentWrite` boundary-checks.
    expect(opCtx.data).toEqual([
      { position: 'qc_inspector', business_unit_id: 'bu_plant_a', organization_id: 'org_1' },
      { position: 'line_lead', business_unit_id: 'bu_plant_a', organization_id: 'org_1' },
    ]);
  });

  it('propagates the gate refusal — an unauthorized placement is not swallowed', async () => {
    const assert = vi.fn(async () => {
      throw new Error("business unit 'bu_plant_b' is outside the delegated subtree");
    });
    const { svc } = makeService({ assert });
    await expect(
      svc.assertIssuable({ intent: INTENT, actorContext: { userId: 'u' }, organizationId: 'org_1' }),
    ).rejects.toThrow(/outside the delegated subtree/);
  });

  it('does not stamp organization_id when the deployment has no org context (single posture)', async () => {
    const { svc, assert } = makeService();
    await svc.assertIssuable({ intent: INTENT, actorContext: { userId: 'u' }, organizationId: null });
    expect(assert.mock.calls[0][0].data[0]).toEqual({
      position: 'qc_inspector',
      business_unit_id: 'bu_plant_a',
    });
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
