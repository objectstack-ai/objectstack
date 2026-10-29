// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131] An out-of-office delegation applies only in its own organization.
 *
 * `ApprovalService.lookupActiveDelegation` reads a `sys_approval_delegation`
 * row the way `grantAppliesInTenant` (`@objectstack/core`) reads a stored
 * position or permission-set grant: the row reroutes an approver only when its
 * organization is the request's organization. The reading it replaces kept a
 * row with no organization in EVERY organization ("null = applies across
 * tenants") and kept every row for a request with no organization — the
 * "NULL means every organization" reading ADR-0131 D1 retired.
 *
 * Under a wall no write produces an organization-less row any more, so the
 * population is stored state from before: the D10 ceremony has no anchor to
 * attribute a delegation by under a wall, and reports it and leaves it NULL.
 * Such a row rerouted every organization's approvals for its delegator.
 *
 * The rule is the same in every posture (ADR-0131 D11), so each case runs
 * under `isolated` and `group`; `single` gets the Default Organization case,
 * where D9 stamps the delegation and the record alike.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';
import { ApprovalService } from './approval-service.js';

interface Row { [k: string]: any }

/**
 * The accounts this suite routes `user` approver slots to: a `user` approver
 * holds a slot only when an account carries it (#27397), so the double's
 * directory starts with them.
 */
const ROUTED_USERS = ['alice', 'carol'];

function makeEngine(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { sys_user: ROUTED_USERS.map((id) => ({ id })), ...seed };
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
      const rows = ensure(object).filter((r) => matches(r, options?.filter ?? options?.where));
      return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
    },
    async insert(object: string, data: Row) { ensure(object).push({ ...data }); return { ...data }; },
    // Writes check their call shape through the engine's own predicates, so
    // the double is no looser than ObjectQL (`check:engine-double-contract`).
    async update(object: string, data: Row, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        let n = 0;
        for (let i = 0; i < table.length; i++) {
          if (matches(table[i], options?.where)) { table[i] = { ...table[i], ...data }; n++; }
        }
        return { updated: n };
      }
      const i = table.findIndex((r) => r.id === dispatch.id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return i >= 0 ? { ...table[i] } : null;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const table = ensure(object);
      if (dispatch.kind === 'multi') {
        const survivors = table.filter((r) => !matches(r, options?.where));
        const deleted = table.length - survivors.length;
        table.splice(0, table.length, ...survivors);
        return { deleted };
      }
      const i = table.findIndex((r) => r.id === dispatch.id);
      if (i >= 0) table.splice(i, 1);
      return { id: dispatch.id };
    },
    async count(object: string) { return ensure(object).length; },
    // The record a request is about carries its own organization, so the
    // request's organization is the record's, not the acting context's.
    getSchema(object: string) {
      return object === 'purchase_order' ? { name: object, fields: { organization_id: { type: 'lookup' } } } : undefined;
    },
    registerHook() { /* no-op */ },
    unregisterHooksByPackage() { /* no-op */ },
  };
}

/** Mid-window: every delegation below is active at this instant. */
const NOW = new Date('2026-05-27T10:00:00Z').getTime();

function delegation(id: string, delegator: string, delegate: string, organization: string | null | undefined): Row {
  const row: Row = {
    id,
    delegator_id: delegator,
    delegate_id: delegate,
    valid_from: '2026-05-26T00:00:00Z',
    valid_until: '2026-05-30T00:00:00Z',
    reason: 'Annual leave',
  };
  if (organization !== undefined) row.organization_id = organization;
  return row;
}

/** One individually-routed approver, on a record of `organization` (or none). */
function openInput(approver: string, organization: string | null) {
  const record: Row = { id: 'po1', amount: 500 };
  if (organization !== null) record.organization_id = organization;
  return {
    object: 'purchase_order',
    recordId: 'po1',
    runId: 'run_1',
    nodeId: 'signoff',
    flowName: 'po_approval',
    config: { approvers: [{ type: 'user' as const, value: approver }], behavior: 'first_response' as const, lockRecord: false },
    record,
  };
}

/** The acting member, signed in to `organization` (or to none). */
function ctx(organization: string | null) {
  return organization === null
    ? { userId: 'u_submitter', positions: [], permissions: [] } as any
    : { userId: 'u_submitter', organizationId: organization, tenantId: organization, positions: [], permissions: [] } as any;
}

function rig(posture: string, seed: Record<string, Row[]>) {
  const engine = makeEngine(seed);
  const warn = vi.fn();
  const svc = new ApprovalService({
    engine: engine as any,
    clock: { now: () => new Date(NOW) },
    logger: { warn },
    tenancyPosture: () => posture,
  });
  /** Every request here routes to a named approver, so it opens rather than auto-completing. */
  const open = async (input: ReturnType<typeof openInput>, c: any) =>
    (await svc.openNodeRequest(input, c)) as ApprovalRequestRow;
  const substitutions = () => engine._tables['sys_approval_action']?.filter((a) => a.action === 'ooo_substitute') ?? [];
  return { engine, svc, warn, open, substitutions };
}

/** Two organizations; alice is out of office in A, carol's rule names no organization. */
const WALLED_SEED = () => ({
  sys_organization: [
    { id: 'o_a', slug: 'org-a' },
    { id: 'o_b', slug: 'org-b' },
  ],
  sys_approval_delegation: [
    delegation('del_a', 'alice', 'bob', 'o_a'),
    delegation('del_none', 'carol', 'dave', null),
  ],
});

for (const posture of ['isolated', 'group'] as const) {
  describe(`OOO delegation under the '${posture}' wall — a delegation applies only in its own organization`, () => {
    let r: ReturnType<typeof rig>;
    beforeEach(() => { r = rig(posture, WALLED_SEED()); });

    it('a delegation of organization A does not reroute an approval in organization B', async () => {
      const req = await r.open(openInput('alice', 'o_b'), ctx('o_b'));
      expect(req.pending_approvers).toEqual(['alice']);
      expect(r.substitutions()).toHaveLength(0);
      expect(r.engine._tables['sys_approval_request'][0].organization_id).toBe('o_b');
    });

    it('the same-organization delegation still applies', async () => {
      const req = await r.open(openInput('alice', 'o_a'), ctx('o_a'));
      expect(req.pending_approvers).toEqual(['bob']);
      expect(r.substitutions()).toHaveLength(1);
      expect(r.substitutions()[0].comment).toBe('alice → bob — Annual leave');
    });

    it("the request's organization is its record's: a delegation of A does not follow a member signed in to A onto B's record", async () => {
      const req = await r.open(openInput('alice', 'o_b'), ctx('o_a'));
      expect(req.pending_approvers).toEqual(['alice']);
      expect(r.substitutions()).toHaveLength(0);
    });

    it('an organization-less row reroutes nothing, in either organization, and is reported once per lookup', async () => {
      for (const org of ['o_a', 'o_b']) {
        const req = await r.open({ ...openInput('carol', org), recordId: `po_${org}` }, ctx(org));
        expect(req.pending_approvers).toEqual(['carol']);
      }
      expect(r.substitutions()).toHaveLength(0);
      // The kind and the named subject, never the wording.
      const reports = r.warn.mock.calls.filter(([, fields]) => fields?.delegationId === 'del_none');
      expect(reports).toHaveLength(2);
      expect(reports.map(([, fields]) => fields.requestOrganizationId)).toEqual(['o_a', 'o_b']);
      expect(reports[0][1]).toMatchObject({ delegatorId: 'carol', delegateId: 'dave' });
    });

    it('a row whose organization is blank or absent is organization-less too', async () => {
      r.engine._tables['sys_approval_delegation'] = [
        delegation('del_blank', 'alice', 'bob', ''),
        delegation('del_absent', 'alice', 'erin', undefined),
      ];
      const req = await r.open(openInput('alice', 'o_a'), ctx('o_a'));
      expect(req.pending_approvers).toEqual(['alice']);
      expect(r.substitutions()).toHaveLength(0);
      expect(r.warn.mock.calls.map(([, fields]) => fields?.delegationId).filter(Boolean).sort())
        .toEqual(['del_absent', 'del_blank']);
    });

    it('beside an organization-less row, the same-organization row is the one that applies', async () => {
      r.engine._tables['sys_approval_delegation'].push(delegation('del_none_alice', 'alice', 'mallory', null));
      const req = await r.open(openInput('alice', 'o_a'), ctx('o_a'));
      expect(req.pending_approvers).toEqual(['bob']);
    });

    it('a chain stops at a hop whose delegation names no organization', async () => {
      r.engine._tables['sys_approval_delegation'].push(delegation('del_bob', 'bob', 'mallory', null));
      const req = await r.open(openInput('alice', 'o_a'), ctx('o_a'));
      expect(req.pending_approvers).toEqual(['bob']);
      expect(r.substitutions()).toHaveLength(1);
    });

    it('a request with no organization takes no delegation, scoped or not', async () => {
      // No organization on the record or on the acting context. A real engine
      // under a wall refuses such a request's organization-less insert (D9);
      // this fake engine stores it, so what is pinned is the slate, which used
      // to keep every row of the delegator.
      const req = await r.open(openInput('alice', null), ctx(null));
      expect(req.pending_approvers).toEqual(['alice']);
      expect(r.substitutions()).toHaveLength(0);
    });
  });
}

describe("OOO delegation under 'single' — the Default Organization stamps both sides", () => {
  const SINGLE_SEED = () => ({
    sys_organization: [{ id: 'o_default', slug: 'default' }],
    sys_approval_delegation: [
      // What D9 writes: the delegation its author creates carries the Default Organization.
      delegation('del_default', 'alice', 'bob', 'o_default'),
      // Stored state from before the ceremony attributed it.
      delegation('del_none', 'carol', 'dave', null),
    ],
  });

  it('a delegation of the Default Organization reroutes an approval on its records', async () => {
    const r = rig('single', SINGLE_SEED());
    const req = await r.open(openInput('alice', 'o_default'), ctx('o_default'));
    expect(req.pending_approvers).toEqual(['bob']);
    expect(r.substitutions()).toHaveLength(1);
  });

  it('an organization-less row reroutes nothing here either, and is reported', async () => {
    const r = rig('single', SINGLE_SEED());
    const req = await r.open(openInput('carol', 'o_default'), ctx('o_default'));
    expect(req.pending_approvers).toEqual(['carol']);
    expect(r.substitutions()).toHaveLength(0);
    expect(r.warn.mock.calls.some(([, fields]) => fields?.delegationId === 'del_none')).toBe(true);
  });
});
