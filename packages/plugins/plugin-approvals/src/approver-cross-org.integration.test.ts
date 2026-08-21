// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D9] Cross-organization approver targeting, through the SERVICE.
 *
 * `approver-org-scope.test.ts` owns the resolver's own rules. What only this
 * level can show is that the resolved organization actually reaches the
 * directory lookups — the wiring D9 is: one organization id used to decide
 * three different things at once (where the request lives, where its inbox rows
 * live, where its approvers are looked up), and only the third moves.
 *
 * The scenario is the one D9 exists for: a purchase order raised in PLANT A
 * needs the group CFO, who holds `cfo` in the GROUP organization and would have
 * matched nobody before.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';

interface Row { [k: string]: any }

function makeEngine(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { ...seed };
  const ensure = (n: string) => (tables[n] ??= []);
  const matches = (row: Row, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  };
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      return ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
    },
    async insert(object: string, data: Row) { ensure(object).push({ ...data }); return { ...data }; },
    async update(_o: string, _w: any, _d: any) { return {}; },
    async delete() { return {}; },
    async count(object: string) { return ensure(object).length; },
    registerHook() { /* no-op */ },
    unregisterHooksByPackage() { /* no-op */ },
  };
}

/** Plant A sits under the group; the CFO's position lives in the group org. */
const SEED = () => ({
  sys_organization: [
    { id: 'o_group', slug: 'acme-group', parent_organization_id: null },
    { id: 'o_plant', slug: 'acme-plant-a', parent_organization_id: 'o_group' },
  ],
  sys_user_position: [
    { id: 'up1', user_id: 'u_cfo', position: 'cfo', organization_id: 'o_group' },
    { id: 'up2', user_id: 'u_plant_mgr', position: 'plant_manager', organization_id: 'o_plant' },
  ],
  sys_member: [
    // The intended group shape: group staff hold a membership in every plant
    // (so D2's union lets them READ the request) while their POSITION lives in
    // the group organization.
    { id: 'm1', user_id: 'u_cfo', organization_id: 'o_plant', role: 'member' },
    { id: 'm2', user_id: 'u_plant_mgr', organization_id: 'o_plant', role: 'member' },
  ],
});

const CTX = { userId: 'u_submitter', organizationId: 'o_plant', positions: [], permissions: [] } as any;

function openInput(approvers: any[], extra: Record<string, any> = {}) {
  return {
    object: 'purchase_order',
    recordId: 'po1',
    runId: 'run_1',
    nodeId: 'group_signoff',
    flowName: 'po_approval',
    config: { approvers, behavior: 'unanimous' as const, lockRecord: false },
    record: { id: 'po1', amount: 500000 },
    ...extra,
  };
}

describe('ADR-0105 D9 — cross-org approver targeting through ApprovalService', () => {
  let engine: ReturnType<typeof makeEngine>;
  let svc: ApprovalService;
  let n = 0;

  beforeEach(() => {
    engine = makeEngine(SEED());
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(1767000000000 + (n++) * 1000) },
      tenancyPosture: () => 'group',
    });
  });

  it('without targeting, a group position matches NOBODY — the gap D9 closes', async () => {
    // The `cfo` position exists, but in the group org; the request is Plant A's.
    // Pre-D9 this was the only possible outcome, and it was silent.
    const req = await svc.openNodeRequest(openInput([{ type: 'position', value: 'cfo' }]), CTX);
    expect(req.pending_approvers).toEqual(['position:cfo']); // the dead literal slot
  });

  it('`organization: $root` resolves the CFO against the GROUP directory', async () => {
    const req = await svc.openNodeRequest(
      openInput([{ type: 'position', value: 'cfo', organization: '$root' }]),
      CTX,
    );
    expect(req.pending_approvers).toEqual(['u_cfo']);
  });

  it('the request and its inbox rows still belong to the REQUEST org — only the lookup moved', async () => {
    await svc.openNodeRequest(
      openInput([{ type: 'position', value: 'cfo', organization: '$root' }]),
      CTX,
    );
    // This is the whole point of the split: targeting must not relocate the
    // request into the approver's organization, or the plant would lose its own
    // audit trail to the group.
    // (#10331 has since declared `organization_id` on the contract row types,
    // so returned rows carry it typed; these persisted-row reads stay because
    // storage placement across all three tables is exactly what's pinned here.)
    expect(engine._tables['sys_approval_request'][0].organization_id).toBe('o_plant');
    expect(engine._tables['sys_approval_approver'][0].organization_id).toBe('o_plant');
    expect(engine._tables['sys_approval_action'][0].organization_id).toBe('o_plant');
  });

  it('mixes a plant approver and a group approver in ONE node — why targeting is per-approver', async () => {
    // A node-level declaration could not express this: the plant manager and the
    // group CFO sign off in parallel, each resolved in a different directory.
    const req = await svc.openNodeRequest(
      openInput([
        { type: 'position', value: 'plant_manager', group: 'plant' },
        { type: 'position', value: 'cfo', organization: '$root', group: 'finance' },
      ]),
      CTX,
    );
    expect(new Set(req.pending_approvers)).toEqual(new Set(['u_plant_mgr', 'u_cfo']));
  });

  it('drops a targeted approver who could not READ the request, leaving the empty-slate path', async () => {
    // Same flow, but the CFO holds no membership in Plant A — D2's union wall
    // would hide the request from her. Better an empty slate (which the node has
    // an `onEmptyApprovers` policy for) than a task she cannot open.
    engine._tables['sys_member'] = engine._tables['sys_member'].filter((m) => m.user_id !== 'u_cfo');
    const req = await svc.openNodeRequest(
      openInput([{ type: 'position', value: 'cfo', organization: '$root' }]),
      CTX,
    );
    expect(req.pending_approvers).toEqual(['position:cfo']);
  });

  // Regression: `user` / `field` / `manager` return EARLY in
  // `resolveApproverSpec`, before the graph-expansion branch. D9's resolution
  // originally sat after those returns, so the declaration on a directory-less
  // type was silently INERT rather than refused — the one behaviour ADR-0105 D9
  // and the authoring docs both promise it is not. The resolver's own unit test
  // could not see it (it calls the resolver directly); only a request opened
  // through the service reaches the early return. Caught by cloud's
  // group-posture dogfood.
  it('refuses `organization` on a directory-less type — the early return must not skip the check', async () => {
    for (const spec of [
      { type: 'user', value: 'u_cfo', organization: '$root' },
      { type: 'field', value: 'owner_id', organization: '$root' },
      { type: 'manager', organization: '$root' },
    ]) {
      await expect(
        svc.openNodeRequest(openInput([spec]), CTX),
        `approver type '${spec.type}' must refuse a cross-org declaration`,
      ).rejects.toThrow(/VALIDATION_FAILED.*no effect/);
    }
  });

  it('a directory-less approver with NO declaration is untouched by D9', async () => {
    // The guard must not cost the ordinary case anything.
    const req = await svc.openNodeRequest(openInput([{ type: 'user', value: 'u_plant_mgr' }]), CTX);
    expect(req.pending_approvers).toEqual(['u_plant_mgr']);
  });

  it('refuses a target outside the group — loudly, and no request is created', async () => {
    engine._tables['sys_organization'].push({ id: 'o_rival', slug: 'rival-co', parent_organization_id: null });
    await expect(
      svc.openNodeRequest(openInput([{ type: 'position', value: 'cfo', organization: 'rival-co' }]), CTX),
    ).rejects.toThrow(/VALIDATION_FAILED.*not in the same group/);
    expect(engine._tables['sys_approval_request'] ?? []).toHaveLength(0);
  });

  it('refuses under a non-group posture — a posture migration cannot silently reroute', async () => {
    const isolated = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(1767000000000) },
      tenancyPosture: () => 'isolated',
    });
    await expect(
      isolated.openNodeRequest(openInput([{ type: 'position', value: 'cfo', organization: '$root' }]), CTX),
    ).rejects.toThrow(/VALIDATION_FAILED.*'group' tenancy posture/);
  });
});
