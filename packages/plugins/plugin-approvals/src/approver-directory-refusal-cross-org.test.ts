// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D6 as amended; ruling record 6599731698 on #29604, letter B] The
 * ADR-0105 D9 cross-organization read filter is a read behind a `position` or
 * `team` approver as much as the directory expansion is. When it fails, the
 * node refuses to open with `ApproverDirectoryUnreadableError`, naming THAT
 * read — on the static resolver (its `bounded` filter) and on an `expression`
 * approver's `resolveAs` values alike.
 *
 * `filterApproversWhoCanRead` answers its own failed `sys_member` read by
 * keeping the slate, so the only way to make it fail is to make it reject: the
 * module is wrapped here with a pass-through spy, and each case says when it
 * rejects. Same scenario as `approver-cross-org.integration.test.ts`: a Plant A
 * request routed to the group CFO.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalService, ApproverDirectoryUnreadableError } from './approval-service.js';
import { filterApproversWhoCanRead } from './approver-org-scope.js';

vi.mock('./approver-org-scope.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./approver-org-scope.js')>();
  return { ...actual, filterApproversWhoCanRead: vi.fn(actual.filterApproversWhoCanRead) };
});

interface Row { [k: string]: any }

function makeEngine(seed: Record<string, Row[]>) {
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
    async update() { return {}; },
    async delete() { return {}; },
    async count(object: string) { return ensure(object).length; },
    registerHook() { /* no-op */ },
    unregisterHooksByPackage() { /* no-op */ },
  };
}

const SEED = () => ({
  sys_user: [{ id: 'u_cfo' }],
  sys_organization: [
    { id: 'o_group', slug: 'acme-group', parent_organization_id: null },
    { id: 'o_plant', slug: 'acme-plant-a', parent_organization_id: 'o_group' },
  ],
  sys_user_position: [{ id: 'up1', user_id: 'u_cfo', position: 'cfo', organization_id: 'o_group' }],
  sys_member: [{ id: 'm1', user_id: 'u_cfo', organization_id: 'o_plant', role: 'member' }],
});

const CTX = { userId: 'u_submitter', organizationId: 'o_plant', positions: [], permissions: [] } as any;

const node = (approver: Record<string, unknown>) => ({
  object: 'purchase_order',
  recordId: 'po1',
  runId: 'run_1',
  nodeId: 'group_signoff',
  flowName: 'po_approval',
  config: { approvers: [approver as any], behavior: 'unanimous' as const, lockRecord: false, onEmptyApprovers: 'admin_rescue' as const },
  record: { id: 'po1', signoff_position: 'cfo' },
});

const STATIC_CFO = { type: 'position', value: 'cfo', organization: '$root' };
const EXPRESSION_CFO = { type: 'expression', value: 'trigger.signoff_position', resolveAs: 'position', organization: '$root' };

const FILTER_READ = /^the cross-organization read filter \(who among the people of organization 'o_group' can read this request of organization 'o_plant'\) could not be read: membership read filter down\.$/;

describe('ADR-0142 D6 — a failed cross-organization read filter refuses the node, named as that read (#29604)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let svc: ApprovalService;
  let n = 0;

  beforeEach(() => {
    vi.mocked(filterApproversWhoCanRead).mockClear();
    engine = makeEngine(SEED());
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(1767000000000 + (n++) * 1000) },
      tenancyPosture: () => 'group',
    });
  });

  const refusalOf = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
  const filterDown = () => vi.mocked(filterApproversWhoCanRead).mockRejectedValueOnce(new Error('membership read filter down'));

  for (const [label, approver, type, value] of [
    ['a static position approver', STATIC_CFO, 'position', 'cfo'],
    ['an expression approver resolving as position', EXPRESSION_CFO, 'position', 'cfo'],
  ] as const) {
    it(`control — ${label} reaches the group CFO through the filter`, async () => {
      const req = await svc.openNodeRequest(node(approver), CTX) as any;
      expect(req.pending_approvers).toEqual(['u_cfo']);
      expect(filterApproversWhoCanRead).toHaveBeenCalledTimes(1);
    });

    it(`${label}: the filter's failure refuses the node and names the filter's read`, async () => {
      filterDown();
      const refusal = await refusalOf(svc.openNodeRequest(node(approver), CTX));

      expect(refusal).toBeInstanceOf(ApproverDirectoryUnreadableError);
      expect(refusal).toMatchObject({ approverType: type, approverValue: value, retryable: true });
      expect((refusal as ApproverDirectoryUnreadableError).failedRead).toMatch(FILTER_READ);
      expect(engine._tables['sys_approval_request'] ?? []).toEqual([]);
    });
  }
});
