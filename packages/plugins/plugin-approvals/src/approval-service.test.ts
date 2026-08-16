// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Node-era approval service tests (ADR-0019).
 *
 * Approval is a flow node — there is no standalone process engine. These tests
 * exercise the service directly: opening a node-driven request, recording
 * decisions (first_response / unanimous), the public `decide()` resume bridge,
 * the read API, and the global record-lock hook.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import { ApprovalService, REMIND_COOLDOWN_MS } from './approval-service.js';
import { bindApprovalLockHook, bindDelegationWriteGuard, unbindAllHooks } from './lifecycle-hooks.js';

interface FakeRow { [k: string]: any }

function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  const hooks: Record<string, Array<{ handler: (ctx: any) => any | Promise<any>; object?: string | string[]; packageId?: string }>> = {};

  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      // The record lock intersects the caller's predicate with the locked ids
      // (#4778), so the fake has to compose branches the way a driver does.
      if (k === '$and') {
        if (!(v as any[]).every(sub => matches(row, sub))) return false;
        continue;
      }
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$contains' in (v as any)) {
        if (!String(rv ?? '').includes(String((v as any).$contains))) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  /** Every `update` the service made, with the context it presented (#3783). */
  const writes: Array<{ object: string; data: any; context: any }> = [];
  /** Every `find` anyone made — pins what a guard does NOT query (#4778). */
  const finds: Array<{ object: string; options: any }> = [];

  return {
    _tables: tables,
    _hooks: hooks,
    _writes: writes,
    _finds: finds,
    async find(object: string, options?: any) {
      finds.push({ object, options });
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
        // Canonical SortNode key only (spec/data/query.zod.ts): a sloppy
        // `direction:` key must fall through to the schema default (asc),
        // exactly like the real engine — that's how the remind() cool-down
        // regression stayed invisible when this mock honored both keys.
        const { field, order } = options.orderBy[0];
        rows.sort((a, b) => {
          const av = a[field]; const bv = b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return order === 'desc' ? -cmp : cmp;
        });
      }
      const start = options?.offset ?? 0;
      return rows.slice(start, start + (options?.limit ?? 1000));
    },
    async insert(object: string, data: any) {
      ensure(object).push({ ...data });
      return { ...data };
    },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      writes.push({ object, data, context: _opts?.context });
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const id = options?.where?.id ?? options?.id;
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table.splice(i, 1);
      return { id };
    },
    // ── hook surface (for the record-lock hook) ──
    registerHook(event: string, handler: (ctx: any) => any, options?: any) {
      (hooks[event] ??= []).push({ handler, object: options?.object, packageId: options?.packageId });
    },
    unregisterHooksByPackage(packageId: string): number {
      let n = 0;
      for (const ev of Object.keys(hooks)) {
        const before = hooks[ev].length;
        hooks[ev] = hooks[ev].filter(h => h.packageId !== packageId);
        n += before - hooks[ev].length;
      }
      return n;
    },
    async fire(event: string, ctx: any) {
      for (const h of hooks[event] ?? []) {
        if (h.object) {
          const objs = Array.isArray(h.object) ? h.object : [h.object];
          if (!objs.includes(ctx.object)) continue;
        }
        await h.handler(ctx);
      }
    },
  };
}

const CTX = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
const SYS = { isSystem: true, positions: [], permissions: [] } as any;

/**
 * Every session shape that could plausibly be read as "this caller is an admin"
 * — pinned as NOT exempt by the guards in `lifecycle-hooks.ts` (#4839).
 *
 * Two families, and both matter:
 *
 *   - the **retired dialect** (`roles: ['admin']`), which is what the deleted
 *     branches actually tested. It has no producer at all — ObjectQL's
 *     `buildSession()` never writes `roles` — so a test that only proved this
 *     shape is refused would pass against a guard that had simply been rewired
 *     to the live vocabulary instead;
 *   - the **live ADR-0095 vocabulary** (`permissions` / `positions` / derived
 *     `posture`), i.e. the exact signals `ApprovalService.isOverrideActor`
 *     reads. These DO resolve on a real request, which is why they are the
 *     shapes the pin is really for: the maintainer's ruling is that the record
 *     lock and the delegation guard have no admin override, not that the
 *     override moved to a better spelling.
 */
const ADMIN_SESSIONS: Array<[string, any]> = [
  ['the retired `roles: [admin]` dialect', { isSystem: false, roles: ['admin'], userId: 'root' }],
  ['an ADR-0095 platform admin (admin_full_access)',
    { isSystem: false, userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] }],
  ['an ADR-0095 platform admin (platform_admin position)',
    { isSystem: false, userId: 'root', tenantId: 't1', positions: ['platform_admin'], permissions: [] }],
  ['an ADR-0095 tenant admin (org_admin position)',
    { isSystem: false, userId: 'root', tenantId: 't1', positions: ['org_admin'], permissions: [] }],
  ['an ADR-0095 derived posture (PLATFORM_ADMIN)',
    { isSystem: false, userId: 'root', tenantId: 't1', positions: [], permissions: [], posture: 'PLATFORM_ADMIN' }],
];

/**
 * The signed-in caller, when it is someone other than {@link CTX}'s `u1`.
 * An approval action is recorded against the AUTHENTICATED caller (#3800), so a
 * test that acts as `u9` has to present `u9`'s context — naming them in
 * `actorId` while calling as `u1` is the impersonation the service now refuses.
 */
const asUser = (userId: string) =>
  ({ userId, tenantId: 't1', positions: [], permissions: [] }) as any;

function nodeConfig(approvers: string[], extra: Record<string, any> = {}) {
  return {
    approvers: approvers.map(v => ({ type: 'user' as const, value: v })),
    behavior: 'first_response' as const,
    lockRecord: true,
    ...extra,
  };
}

function openInput(approvers: string[], extra: Record<string, any> = {}, configExtra: Record<string, any> = {}) {
  return {
    object: 'opportunity',
    recordId: 'opp1',
    runId: 'run_1',
    nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: nodeConfig(approvers, configExtra),
    record: { id: 'opp1', amount: 100 },
    ...extra,
  };
}

describe('ApprovalService (node era)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(baseTime + (n++) * 1000) },
    });
  });

  // ── openNodeRequest ─────────────────────────────────────────────

  it('openNodeRequest: creates a pending request + submit action with flow correlation', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.status).toBe('pending');
    expect(req.process_name).toBe('flow:deal_approval');
    expect(req.flow_run_id).toBe('run_1');
    expect(req.flow_node_id).toBe('approve_step');
    expect(req.pending_approvers).toEqual(['u9']);
    expect(engine._tables['sys_approval_request']).toHaveLength(1);
    expect(engine._tables['sys_approval_action'][0].action).toBe('submit');
  });

  it('openNodeRequest: snapshots the node config on the row', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const raw = engine._tables['sys_approval_request'][0];
    expect(JSON.parse(raw.node_config_json)).toMatchObject({ behavior: 'first_response', lockRecord: true });
  });

  // ── record-lock policy on the read row (objectui#2902) ──────────
  //
  // The lock is enforced in `lifecycle-hooks.ts` off `node_config_json`, but
  // the row projection used to drop the flag entirely — so a client could see
  // "a pending request exists" and nothing more, and had to assume every
  // pending node locked the record. Chaining nodes with different policies
  // made that visibly wrong. These pin the flag onto every read path.

  it('lock_record: true when the node locks (the schema default)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.lock_record).toBe(true);
    const [listed] = await svc.listRequests({ object: 'opportunity', recordId: 'opp1' }, SYS);
    expect(listed.lock_record).toBe(true);
    expect((await svc.getRequest(req.id, SYS))!.lock_record).toBe(true);
  });

  it('lock_record: false when the node opts out — the same read the hook honors', async () => {
    const req = await svc.openNodeRequest(openInput(['u9'], {}, { lockRecord: false }), CTX);
    expect(req.lock_record).toBe(false);
    const [listed] = await svc.listRequests({ object: 'opportunity', recordId: 'opp1' }, SYS);
    expect(listed.lock_record).toBe(false);
    expect((await svc.getRequest(req.id, SYS))!.lock_record).toBe(false);
  });

  it('lock_record: an unset lockRecord reads as locked, matching the hook default', async () => {
    // The hook allows the write only on an explicit `=== false`; the flag must
    // default the same way or the UI would offer an edit the server rejects.
    const req = await svc.openNodeRequest(
      { ...openInput(['u9']), config: { approvers: [{ type: 'user' as const, value: 'u9' }], behavior: 'first_response' as const } } as any,
      CTX,
    );
    expect(req.lock_record).toBe(true);
  });

  it('openNodeRequest: deduplicates a pending request per (object, record)', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.openNodeRequest(openInput(['u9'], { runId: 'run_2' }), CTX))
      .rejects.toThrow(/DUPLICATE_REQUEST/);
  });

  it('openNodeRequest: requires object, recordId, runId', async () => {
    await expect(svc.openNodeRequest(openInput(['u9'], { object: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.openNodeRequest(openInput(['u9'], { recordId: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(svc.openNodeRequest(openInput(['u9'], { runId: '' }), CTX)).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('openNodeRequest: mirrors status onto the business record when configured', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    expect(engine._tables['opportunity'][0].approval_status).toBe('pending');
  });

  // ── approver expansion: field (live re-read + fan-out, #3447) ────
  //
  // A `field` approver names WHO decides from a record field. It must bind to
  // the record's LIVE value at node entry — an earlier step (or the approver of
  // an earlier step) may have written it after submit — not the trigger snapshot
  // the run froze into `$record`. A multi-select user field fans out into one
  // slot per user.

  const fieldInput = (extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: {
      approvers: [{ type: 'field' as const, value: 'approvers_dynamic' }],
      behavior: 'unanimous' as const,
      lockRecord: true,
    },
    ...extra,
  });

  it('field approver: resolves against the LIVE record, not the trigger snapshot (#3447)', async () => {
    // The minimal repro: submitted with the routing field empty; a prior step
    // wrote the co-reviewers mid-flow. Resolution must see them.
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100, approvers_dynamic: ['u2', 'u3'] }];
    const req = await svc.openNodeRequest(
      fieldInput({ record: { id: 'opp1', amount: 100, approvers_dynamic: [] } }), CTX,
    );
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3']);
  });

  it('field approver: the live value WINS over a stale snapshot value (#3447)', async () => {
    // Snapshot named u1; the record now names u2. u2 decides.
    engine._tables['opportunity'] = [{ id: 'opp1', approvers_dynamic: ['u2'] }];
    const req = await svc.openNodeRequest(
      fieldInput({ record: { id: 'opp1', approvers_dynamic: ['u1'] } }), CTX,
    );
    expect(req.pending_approvers).toEqual(['u2']);
  });

  it('field approver: fans a multi-select user field into one slot per user (#3447)', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', approvers_dynamic: ['u2', 'u3', 'u4'] }];
    const req = await svc.openNodeRequest(fieldInput({ record: { id: 'opp1' } }), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3', 'u4']);
  });

  it('field approver: fans a legacy CSV string field into multiple slots (#3447)', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', approvers_dynamic: 'u2,u3' }];
    const req = await svc.openNodeRequest(fieldInput({ record: { id: 'opp1' } }), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3']);
  });

  it('field approver: falls back to the trigger snapshot when the record is gone (#3447)', async () => {
    // No `opportunity` row — hard-deleted between submit and node entry. The
    // snapshot still carries a value, so the request opens against it (warn but
    // proceed) rather than wedging the flow.
    const req = await svc.openNodeRequest(
      fieldInput({ record: { id: 'opp1', approvers_dynamic: ['u7'] } }), CTX,
    );
    expect(req.pending_approvers).toEqual(['u7']);
  });

  // ── approver expansion: expression (#3447 P2) ───────────────────
  //
  // A CEL expression resolved at node entry over three EXPLICIT roots:
  // `current.*` (live record), `trigger.*` (submit snapshot), `vars.*` (flow
  // variables). `record` / bare fields are rejected before evaluation — the
  // runtime env would resolve them as dyn → null → a silently-empty slate.

  const exprInput = (
    value: string,
    extra: Record<string, any> = {},
    approverExtra: Record<string, any> = {},
    configExtra: Record<string, any> = {},
  ) => ({
    ...openInput([]),
    config: {
      approvers: [{ type: 'expression' as const, value, ...approverExtra }],
      behavior: 'unanimous' as const,
      lockRecord: true,
      ...configExtra,
    },
    ...extra,
  });

  it('expression: current.* reads the LIVE record at node entry (#3447 P2)', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', approvers_dynamic: ['u2', 'u3'] }];
    const req = await svc.openNodeRequest(
      exprInput('current.approvers_dynamic', { record: { id: 'opp1', approvers_dynamic: [] } }), CTX,
    ) as any;
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3']);
  });

  it('expression: trigger.* reads the submit-time snapshot, not the live row (#3447 P2)', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', reviewer: 'new_reviewer' }];
    const req = await svc.openNodeRequest(
      exprInput('trigger.reviewer', { record: { id: 'opp1', reviewer: 'old_reviewer' } }), CTX,
    ) as any;
    expect(req.pending_approvers).toEqual(['old_reviewer']);
  });

  it('expression: vars.* reads flow variables; a CSV string fans out (#3447 P2)', async () => {
    const req = await svc.openNodeRequest(
      exprInput('vars.approval_lead.next_reviewers', {
        variables: { approval_lead: { next_reviewers: 'u5, u6' } },
      }), CTX,
    ) as any;
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('expression: an array result fans out into one slot per id (#3447 P2)', async () => {
    const req = await svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: ['u2', 'u3', 'u4'] } }), CTX,
    ) as any;
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3', 'u4']);
  });

  it('expression: OOO delegation applies per resolved user (#3447 P2 / #1322)', async () => {
    engine._tables['sys_approval_delegation'] = [{
      id: 'del1', delegator_id: 'u2', delegate_id: 'u9',
      valid_from: '2026-01-01T00:00:00Z', valid_until: '2026-12-31T00:00:00Z',
      reason: 'leave', organization_id: 't1',
    }];
    const req = await svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: ['u2', 'u3'] } }), CTX,
    ) as any;
    expect(req.pending_approvers.sort()).toEqual(['u3', 'u9']);
  });

  it('expression: rejects a `record` root BEFORE evaluation, prescribing current/trigger (#3447 P2)', async () => {
    await expect(svc.openNodeRequest(exprInput('record.approvers_dynamic'), CTX))
      .rejects.toThrow(/VALIDATION_FAILED[\s\S]*`record`[\s\S]*current\.<field>/);
  });

  it('expression: rejects an unknown bare root with the closed-root hint (#3447 P2)', async () => {
    await expect(svc.openNodeRequest(exprInput('approvers_dynamic'), CTX))
      .rejects.toThrow(/VALIDATION_FAILED.*approvers_dynamic.*current\.\*/s);
  });

  it('expression: a non-parsing source fails loudly, not as an empty slate (#3447 P2)', async () => {
    await expect(svc.openNodeRequest(exprInput('current..'), CTX))
      .rejects.toThrow(/VALIDATION_FAILED.*does not parse/s);
  });

  it('expression: a non-id result type (bool) fails loudly (#3447 P2)', async () => {
    const req = svc.openNodeRequest(
      exprInput('current.amount > 100', { record: { id: 'opp1', amount: 500 } }), CTX,
    );
    await expect(req).rejects.toThrow(/EXPRESSION_FAILED.*must yield ids/s);
  });

  it('expression + resolveAs department: expands each returned id through the graph, one per_group group per department (#3447 P2)', async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'd1', active: true, organization_id: 't1' },
      { id: 'd2', active: true, organization_id: 't1' },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'm1', business_unit_id: 'd1', user_id: 'u2' },
      { id: 'm2', business_unit_id: 'd1', user_id: 'u3' },
      { id: 'm3', business_unit_id: 'd2', user_id: 'u4' },
    ];
    const req = await svc.openNodeRequest(
      exprInput('vars.picked_departments', {
        variables: { picked_departments: ['d1', 'd2'] },
      }, { resolveAs: 'department' }, { behavior: 'per_group' }), CTX,
    ) as any;
    expect(req.pending_approvers.sort()).toEqual(['u2', 'u3', 'u4']);
    // Each department forms its own sub-group: one sign-off per department.
    const raw = engine._tables['sys_approval_request'][0];
    const snapshot = JSON.parse(raw.node_config_json);
    expect(snapshot.__approverGroups).toEqual({
      u2: ['#0:d1'], u3: ['#0:d1'], u4: ['#0:d2'],
    });
  });

  it('expression + resolveAs: an unstaffed department keeps a literal slot (#3447 P2)', async () => {
    engine._tables['sys_business_unit'] = [{ id: 'd9', active: true, organization_id: 't1' }];
    const req = await svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: ['d9'] } }, { resolveAs: 'department' }), CTX,
    ) as any;
    expect(req.pending_approvers).toEqual(['department:d9']);
  });

  it('expression: __resolvedFrom snapshots the resolution INPUT for audit (#3447 P2)', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', approvers_dynamic: ['u2'] }];
    await svc.openNodeRequest(exprInput('current.approvers_dynamic', { record: { id: 'opp1' } }), CTX);
    const raw = engine._tables['sys_approval_request'][0];
    const snapshot = JSON.parse(raw.node_config_json);
    expect(snapshot.__resolvedFrom).toEqual({ 'expression#0': ['u2'] });
  });

  it('expression: a MISSING key is a loud error, never a silent empty slate (#3447 P2)', async () => {
    // CEL map access on an absent key throws ("No such key") — deliberate:
    // referencing a variable nobody wrote is a wiring bug, not "no approvers".
    // An EMPTY slate is expressed by a present-but-empty value (next test
    // group); authors guard optional inputs with `has(...)` / `.?` explicitly.
    await expect(svc.openNodeRequest(
      exprInput('vars.never_written', { variables: {} }), CTX,
    )).rejects.toThrow(/EXPRESSION_FAILED.*No such key/s);
  });

  // ── onEmptyApprovers policy (#3447 P2) ──────────────────────────
  //
  // "Empty" = the expression/field RESOLVED (key present) but yielded nobody.
  // A missing key is a loud error instead (test above).

  it("onEmptyApprovers 'fail': an empty slate fails the open loudly", async () => {
    await expect(svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: [] } }, {}, { onEmptyApprovers: 'fail' }), CTX,
    )).rejects.toThrow(/NO_APPROVERS/);
    expect(engine._tables['sys_approval_request'] ?? []).toHaveLength(0);
  });

  it("onEmptyApprovers 'auto_approve': no request opens, outcome says autoApproved", async () => {
    const outcome = await svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: [] } }, {}, { onEmptyApprovers: 'auto_approve' }), CTX,
    );
    expect(outcome).toEqual({ autoApproved: true, reason: 'empty_approvers' });
    expect(engine._tables['sys_approval_request'] ?? []).toHaveLength(0);
  });

  it("onEmptyApprovers default ('admin_rescue'): the request still opens for admin takeover (#3424)", async () => {
    const req = await svc.openNodeRequest(
      exprInput('vars.picked', { variables: { picked: [] } }), CTX,
    ) as any;
    expect(req.status).toBe('pending');
    expect(req.pending_approvers).toEqual([]);
    expect(engine._tables['sys_approval_request']).toHaveLength(1);
  });

  // ── decision outputs (#3447 P2) ─────────────────────────────────

  it('decision outputs: rejected when the node declares none', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { next: 'u2' },
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*declares no decisionOutputs/s);
  });

  it('decision outputs: rejected when a key is undeclared', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { decisionOutputs: ['next_reviewers'] }), CTX,
    );
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { other_key: 1 },
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*other_key.*not declared/s);
  });

  it('decision outputs: reserved keys are rejected even when declared', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { decisionOutputs: ['decision'] }), CTX,
    );
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { decision: 'spoofed' },
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*reserved/s);
  });

  it('decision outputs: typed declarations normalize — whitelist by key, defs surfaced for the UI', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, {
        decisionOutputs: [
          { key: 'next_reviewers', label: 'Next Reviewers', type: 'user', multiple: true },
          'note',
        ],
      }), CTX,
    ) as any;
    // Key list stays the version-skew-safe shape; defs carry the typed form.
    expect(req.decision_outputs).toEqual(['next_reviewers', 'note']);
    expect(req.decision_output_defs).toEqual([
      { key: 'next_reviewers', label: 'Next Reviewers', type: 'user', multiple: true },
      { key: 'note' },
    ]);
    // A typed declaration whitelists exactly like a bare key.
    const out = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { next_reviewers: ['u2', 'u3'] },
    }, SYS);
    expect(out.outputs).toEqual({ next_reviewers: ['u2', 'u3'] });
  });

  it('decision outputs: declared keys surface on the request row as decision_outputs (#3447 P2 UI)', async () => {
    // The decision UI renders one input per declared key — the keys ride the
    // request read (per-request; the static action params can't carry them).
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { decisionOutputs: ['next_reviewers', 'note'] }), CTX,
    ) as any;
    expect(req.decision_outputs).toEqual(['next_reviewers', 'note']);
    const listed = await svc.listRequests({ status: 'pending' }, SYS);
    expect((listed[0] as any).decision_outputs).toEqual(['next_reviewers', 'note']);
    // A node declaring none omits the field entirely.
    engine._tables['sys_approval_request'] = [];
    const plain = await svc.openNodeRequest(openInput(['u9']), CTX) as any;
    expect(plain.decision_outputs).toBeUndefined();
  });

  it('decision outputs: accepted keys return from decideNode and snapshot as __decisionOutputs', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { decisionOutputs: ['next_reviewers', 'note'] }), CTX,
    );
    const out = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { next_reviewers: ['u2', 'u3'] },
    }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.outputs).toEqual({ next_reviewers: ['u2', 'u3'] });
    const raw = engine._tables['sys_approval_request'][0];
    expect(JSON.parse(raw.node_config_json).__decisionOutputs).toEqual({ next_reviewers: ['u2', 'u3'] });
  });

  it('decision outputs: co-sign votes accumulate, the finalizing decision hands the merged set over', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u1', 'u2'], {}, { behavior: 'unanimous', decisionOutputs: ['legal_note', 'finance_note'] }), CTX,
    );
    const first = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u1', outputs: { legal_note: 'ok' },
    }, SYS);
    expect(first.finalized).toBe(false);
    const second = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u2', outputs: { finance_note: 'ok too' },
    }, SYS);
    expect(second.finalized).toBe(true);
    expect(second.outputs).toEqual({ legal_note: 'ok', finance_note: 'ok too' });
  });

  // ── required decision outputs (objectui#2955) ───────────────────
  //
  // `type`/`multiple` only shape the input widget; `required` is the one
  // declaration the RUNTIME enforces. Without it the author's only backstop
  // was `onEmptyApprovers`: the approve went through with the key missing, the
  // next node's `expression` approver resolved nobody, and the run stalled for
  // an admin rescue — long after the approver who could have supplied it left.

  const requiredInput = (extra: Record<string, any> = {}) => openInput(['u9'], {}, {
    decisionOutputs: [
      { key: 'parallel_positions', label: 'Co-signing positions', type: 'position', multiple: true, required: true },
      { key: 'note' },
    ],
    ...extra,
  });

  it('required outputs: surfaced on the request row so the UI can block before the round trip', async () => {
    const req = await svc.openNodeRequest(requiredInput(), CTX) as any;
    expect(req.decision_output_defs).toEqual([
      { key: 'parallel_positions', label: 'Co-signing positions', type: 'position', multiple: true, required: true },
      { key: 'note' },
    ]);
  });

  it('required outputs: an approve that omits one is rejected before any write', async () => {
    const req = await svc.openNodeRequest(requiredInput(), CTX);
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { note: 'looks fine' },
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*parallel_positions.*required to approve/s);
    // Atomic: the decision left no audit row (only the open-time submit), and
    // the request is untouched.
    expect((engine._tables['sys_approval_action'] ?? []).map((a: any) => a.action)).toEqual(['submit']);
    expect(engine._tables['sys_approval_request'][0].status).toBe('pending');
  });

  it('required outputs: an approve carrying no outputs at all is rejected too', async () => {
    // The regression that matters — a decision surface that collects nothing
    // (objectui#2955: the record header) used to sail straight through here.
    const req = await svc.openNodeRequest(requiredInput(), CTX);
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9',
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*parallel_positions.*required to approve/s);
  });

  it('required outputs: present-but-blank does not satisfy the requirement', async () => {
    // An untouched widget submits '' or [] — accepting those would hand the
    // downstream expression approver an empty slate, i.e. the exact stall.
    for (const blank of ['', '   ', [], [''], null]) {
      engine._tables['sys_approval_request'] = [];
      engine._tables['sys_approval_action'] = [];
      const req = await svc.openNodeRequest(requiredInput(), CTX);
      await expect(svc.decideNode(req.id, {
        decision: 'approve', actorId: 'u9', outputs: { parallel_positions: blank },
      }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*required to approve/s);
    }
  });

  it('required outputs: a filled approve goes through and hands the value to the flow', async () => {
    const req = await svc.openNodeRequest(requiredInput(), CTX);
    const out = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u9', outputs: { parallel_positions: ['pos_1', 'pos_2'] },
    }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.outputs).toEqual({ parallel_positions: ['pos_1', 'pos_2'] });
  });

  it('required outputs: a REJECT never needs them', async () => {
    // The run leaves down the reject edge, where nothing reads the outputs —
    // demanding routing data to say "no" would trap the rejection.
    const req = await svc.openNodeRequest(requiredInput(), CTX);
    const out = await svc.decideNode(req.id, { decision: 'reject', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.decision).toBe('reject');
  });

  it('required outputs: an unrelated node is unaffected', async () => {
    // No `required` anywhere → the pre-#2955 behaviour, byte for byte.
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { decisionOutputs: ['note'] }), CTX,
    );
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
  });

  it('required outputs: every approver of a multi-approver node must supply them', async () => {
    // Enforced per decision, not per node: each approve is a decision that
    // could be the one that resumes the run, and each approver sees the field.
    const req = await svc.openNodeRequest(
      openInput(['u1', 'u2'], {}, {
        behavior: 'unanimous',
        decisionOutputs: [{ key: 'co_signer', type: 'user', required: true }],
      }), CTX,
    );
    await expect(svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u1',
    }, SYS)).rejects.toThrow(/VALIDATION_FAILED.*co_signer.*required to approve/s);
    const first = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u1', outputs: { co_signer: 'u7' },
    }, SYS);
    expect(first.finalized).toBe(false);
    const second = await svc.decideNode(req.id, {
      decision: 'approve', actorId: 'u2', outputs: { co_signer: 'u8' },
    }, SYS);
    expect(second.finalized).toBe(true);
    // Last decision wins the merge — the finalizing approver's pick is what
    // the flow resumes with.
    expect(second.outputs).toEqual({ co_signer: 'u8' });
  });

  // ── approver expansion: position (ADR-0090 D3) ──────────────────

  const positionInput = (extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: {
      approvers: [{ type: 'position' as const, value: 'sales_manager' }],
      behavior: 'first_response' as const,
      lockRecord: true,
    },
    ...extra,
  });

  it('position approver: expands via sys_user_position, org-scoped', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'sales_manager', organization_id: 't1' },
      { id: 'up2', user_id: 'u6', position: 'sales_manager', organization_id: 't1' },
      { id: 'up3', user_id: 'u7', position: 'sales_manager', organization_id: 't2' }, // other tenant
      { id: 'up4', user_id: 'u8', position: 'cfo', organization_id: 't1' },           // other position
    ];
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('position approver: unions the sys_member.role transition source (ADR-0057 D4)', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'sales_manager', organization_id: 't1' },
    ];
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u6', role: 'sales_manager', organization_id: 't1' },
      { id: 'm2', user_id: 'u5', role: 'sales_manager', organization_id: 't1' }, // deduped
    ];
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('position approver: falls back to a position: literal when nobody holds it', async () => {
    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers).toEqual(['position:sales_manager']);
  });

  // ── the #8710 carve-out, asserted on THIS side (#8863) ──────────────────
  //
  // Maintainer ruling, 2026-08-15 (#8710, inheriting #8613), verbatim:
  //
  //   > Access-conferring paths filter deactivated positions; addressing
  //   > paths do not.
  //
  // Approver routing is an ADDRESSING path, so `expandPositionUsers` reads the
  // directory RAW where `PositionGraphService.expandPositionUsers` (sharing,
  // access-conferring) filters. Until these two cases the carve-out was held up
  // on this side by a doc comment alone: `sharing-rule.test.ts`'s
  // `the ADDRESSING primitive stays a RAW directory read` guards the sharing
  // helper, not this one, so "fixing" the apparent oversight here left the whole
  // suite green. The regression it would ship is a step that routes to NOBODY —
  // the expansion comes back short, and when it comes back empty the slot falls
  // through to the `position:sales_manager` literal no user can ever act on, i.e.
  // the permanently stuck request of #3807 / #3424, surfacing a deployment later.
  // Dropping a holder here is fail-OPEN; that is why the lapsed holder stays.

  it('position approver: an EXPIRED sys_user_position row STILL routes (ADR-0091 D2 is not applied here)', async () => {
    // ⛔ The load-bearing negative pin. An ablation that adds the ADR-0091 D2
    // window to `expandPositionUsers` — the `isGrantActive` filter plus the
    // `valid_from`/`valid_until` projection that sharing's `position-graph.ts`
    // carries — turns this red on `u5`.
    //
    // ⚠️ The pin is only worth its line count if the fixture is REALLY expired:
    // an assertion that "the expired holder is still in the slate" degrades into
    // a tautology the moment the seeded row stops carrying a lapsed window, and
    // it degrades SILENTLY (`isGrantActive` reads an absent bound as unbounded,
    // so a window-less row survives any filter and the case passes green with
    // its own subject ablated — measured on a sibling pin, #9085). The window
    // columns below are therefore load-bearing fixture, not decoration, and the
    // two guards under them fail loudly if a later edit dulls the blade.
    const LAPSED_UNTIL = '2025-06-30T00:00:00Z';
    const OPEN_UNTIL = '2099-01-01T00:00:00Z';
    // Past/future of BOTH clocks on purpose — the injected test clock and the
    // wall clock — so the pin does not quietly depend on which one a would-be
    // filter reads (sharing's reads `Date.now()`; this service has a `clock`).
    expect(Date.parse(LAPSED_UNTIL)).toBeLessThan(Math.min(baseTime, Date.now()));
    expect(Date.parse(OPEN_UNTIL)).toBeGreaterThan(Math.max(baseTime, Date.now()));

    engine._tables['sys_user_position'] = [
      // Lapsed over a year before the request opens — a filter WOULD drop this.
      { id: 'up_lapsed', user_id: 'u5', position: 'sales_manager', organization_id: 't1',
        valid_from: '2024-01-01T00:00:00Z', valid_until: LAPSED_UNTIL },
      // The in-window control: proves an ablation's red is the window filter
      // biting, not the fixture failing to seed or the org scope excluding both.
      { id: 'up_current', user_id: 'u6', position: 'sales_manager', organization_id: 't1',
        valid_from: '2024-01-01T00:00:00Z', valid_until: OPEN_UNTIL },
    ];

    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('position approver: the routing read never consults the sys_position catalogue', async () => {
    // Limb 3 of the same ruling. `sys_position.active` is gated on the sharing
    // side at the RULE EVALUATOR's call site (`positionConfersAccess` in
    // `sharing-rule-service.ts`), never inside the graph primitive; the ruling
    // gives this path no counterpart gate, so a deactivated position keeps
    // routing here too.
    //
    // Pinned on the READ and not only on the slate, because the slate alone
    // cannot fail: nothing here queries `sys_position` at all, so a deactivated
    // row is not "kept despite the flag", it is never looked at — and an
    // outcome-only assertion would pass for that reason rather than for the
    // ruled one. Asserting the absent read is what an ablation adding the
    // catalogue lookup + `active` filter turns red.
    engine._tables['sys_position'] = [
      { id: 'pos_sm', name: 'sales_manager', organization_id: 't1', active: false },
    ];
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'sales_manager', organization_id: 't1' },
    ];

    const req = await svc.openNodeRequest(positionInput(), CTX);
    expect(req.pending_approvers).toEqual(['u5']);
    expect(engine._finds.map(f => f.object)).not.toContain('sys_position');
  });

  // ── approver expansion: org_membership_level + its deprecated `role` alias
  //    (ADR-0090 D3) ────────────────────────────────────────────────────────

  // `recordId` is parameterised: the service rejects a second pending request
  // on the same record, and the alias test deliberately opens two.
  const tierInput = (type: 'org_membership_level' | 'role', recordId = 'opp1') => ({
    ...openInput([]),
    recordId,
    record: { id: recordId, amount: 100 },
    config: {
      approvers: [{ type: type as any, value: 'admin' }],
      behavior: 'first_response' as const,
      lockRecord: true,
    },
  });

  it('org_membership_level approver: expands the better-auth tier, org-scoped', async () => {
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u1', role: 'admin', organization_id: 't1' },
      { id: 'm2', user_id: 'u2', role: 'admin', organization_id: 't1' },
      { id: 'm3', user_id: 'u3', role: 'admin', organization_id: 't2' },  // other tenant
      { id: 'm4', user_id: 'u4', role: 'member', organization_id: 't1' }, // other tier
    ];
    const req = await svc.openNodeRequest(tierInput('org_membership_level'), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u1', 'u2']);
  });

  it('deprecated `role` alias resolves IDENTICALLY to org_membership_level', async () => {
    engine._tables['sys_member'] = [
      { id: 'm1', user_id: 'u1', role: 'admin', organization_id: 't1' },
      { id: 'm2', user_id: 'u4', role: 'member', organization_id: 't1' },
    ];
    const canonical = await svc.openNodeRequest(tierInput('org_membership_level', 'opp_canon'), CTX);
    const deprecated = await svc.openNodeRequest(tierInput('role', 'opp_depr'), CTX);
    expect(deprecated.pending_approvers).toEqual(canonical.pending_approvers);
    expect(deprecated.pending_approvers).toEqual(['u1']);
  });

  // The fallback literal keeps the AUTHORED spelling: `sys_approval_approver`
  // rows and `pending_approvers` slots written by 15.x carry `role:<v>`, and
  // canonicalising the literal here would orphan every one of them.
  it('deprecated `role` alias keeps its legacy literal on fallback (no orphaned slots)', async () => {
    const req = await svc.openNodeRequest(tierInput('role'), CTX);
    expect(req.pending_approvers).toEqual(['role:admin']);
  });

  it('org_membership_level falls back to its own canonical literal', async () => {
    const req = await svc.openNodeRequest(tierInput('org_membership_level'), CTX);
    expect(req.pending_approvers).toEqual(['org_membership_level:admin']);
  });

  it("department approver: honors the spec enum value 'department' (not just the business_unit dialect)", async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'bu1', organization_id: 't1', active: true },
      { id: 'bu2', parent_business_unit_id: 'bu1', organization_id: 't1', active: true },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu1', user_id: 'u5' },
      { id: 'bm2', business_unit_id: 'bu2', user_id: 'u6' },
    ];
    const req = await svc.openNodeRequest(positionInput({
      config: {
        approvers: [{ type: 'department' as const, value: 'bu1' }],
        behavior: 'first_response' as const,
        lockRecord: true,
      },
    }), CTX);
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  // #3807 — an app's org tree is normally SEEDED, and a seed cannot know the
  // organization id the runtime mints at boot, so those rows carry
  // `organization_id = null` while every approval request carries an org. The
  // old strict equality made each of them invisible and every `department`
  // approver resolved to the dead `department:<id>` literal.
  const departmentInput = (value: string) => positionInput({
    config: {
      approvers: [{ type: 'department' as const, value }],
      behavior: 'first_response' as const,
      lockRecord: true,
    },
  });

  it('department approver: an env-wide (null-org) business unit still resolves (#3807)', async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'bu_seeded', organization_id: null, active: true },
      { id: 'bu_seeded_child', parent_business_unit_id: 'bu_seeded', organization_id: null, active: true },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu_seeded', user_id: 'u5' },
      { id: 'bm2', business_unit_id: 'bu_seeded_child', user_id: 'u6' },
    ];
    const req = await svc.openNodeRequest(departmentInput('bu_seeded'), CTX);
    // Both the seed check AND the subtree descent must see the null-org rows.
    expect(req.pending_approvers.sort()).toEqual(['u5', 'u6']);
  });

  it('department approver: another organization’s unit stays invisible (#3807 keeps the wall)', async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'bu_other', organization_id: 't2', active: true },
      { id: 'bu_other_child', parent_business_unit_id: 'bu_other', organization_id: 't2', active: true },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu_other', user_id: 'intruder' },
      { id: 'bm2', business_unit_id: 'bu_other_child', user_id: 'intruder2' },
    ];
    const req = await svc.openNodeRequest(departmentInput('bu_other'), CTX);
    expect(req.pending_approvers).toEqual(['department:bu_other']);
  });

  it('department approver: a null-org subtree does not drag in another org’s child unit (#3807)', async () => {
    engine._tables['sys_business_unit'] = [
      { id: 'bu_seeded', organization_id: null, active: true },
      { id: 'bu_mine', parent_business_unit_id: 'bu_seeded', organization_id: 't1', active: true },
      { id: 'bu_theirs', parent_business_unit_id: 'bu_seeded', organization_id: 't2', active: true },
    ];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu_mine', user_id: 'u5' },
      { id: 'bm2', business_unit_id: 'bu_theirs', user_id: 'intruder' },
    ];
    const req = await svc.openNodeRequest(departmentInput('bu_seeded'), CTX);
    expect(req.pending_approvers).toEqual(['u5']);
  });

  it('department approver: an inactive env-wide unit still contributes nobody (#3807)', async () => {
    engine._tables['sys_business_unit'] = [{ id: 'bu_seeded', organization_id: null, active: false }];
    engine._tables['sys_business_unit_member'] = [
      { id: 'bm1', business_unit_id: 'bu_seeded', user_id: 'u5' },
    ];
    const req = await svc.openNodeRequest(departmentInput('bu_seeded'), CTX);
    expect(req.pending_approvers).toEqual(['department:bu_seeded']);
  });

  // ── decideNode ──────────────────────────────────────────────────

  it('decideNode: first_response approve finalizes immediately', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.decision).toBe('approve');
    expect(out.runId).toBe('run_1');
    expect(out.nodeId).toBe('approve_step');
    expect(out.request.status).toBe('approved');
  });

  it('decideNode: reject finalizes as rejected', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decideNode(req.id, { decision: 'reject', actorId: 'u9', comment: 'no' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
  });

  it('decideNode: unanimous holds until every approver acts', async () => {
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    const first = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(first.finalized).toBe(false);
    expect(first.request.pending_approvers).toEqual(['u2']);
    const second = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(second.finalized).toBe(true);
    expect(second.request.status).toBe('approved');
  });

  it('decideNode: blocks a non-approver in a non-system context', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: 'mallory' }, { isSystem: false, positions: [], permissions: [] } as any),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('decideNode: rejects a decision on a non-pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS)).rejects.toThrow(/INVALID_STATE/);
  });

  it('decideNode: mirrors the terminal status onto the business record', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    const req = await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(engine._tables['opportunity'][0].approval_status).toBe('approved');
  });

  // ── decide(): public contract + resume bridge ───────────────────

  it('decide: resumes the owning run down the matching branch on finalize', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(true);
    expect(out.runId).toBe('run_1');
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ runId: 'run_1', signal: { branchLabel: 'approve' } });
  });

  it('decide: does not resume while a unanimous request is still pending', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId) { resumed.push(runId); } });
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(out.finalized).toBe(false);
    expect(out.resumed).toBe(false);
    expect(resumed).toHaveLength(0);
  });

  it('decide: finalizes even when no automation is attached (resumed=false)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decide(req.id, { decision: 'reject', actorId: 'u9' }, SYS);
    expect(out.finalized).toBe(true);
    expect(out.resumed).toBe(false);
  });

  // ── #4420: a REPORTED resume failure is a failure ────────────────
  //
  // The engine answers a lost run with `{ success: false }` rather than by
  // throwing, so every one of these used to come back as `resumed: true`.

  it('decide: refuses before writing anything when the run is already gone', async () => {
    svc.attachAutomation({
      async hasSuspendedRun() { return false; },
      async resume() { return { success: true }; },
    } as any);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    await expect(svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS))
      .rejects.toThrow(/RESUME_TARGET_LOST/);
    const [row] = await engine.find('sys_approval_request', { where: { id: req.id } });
    expect(row.status, 'nothing recorded against a run that cannot advance').toBe('pending');
  });

  it('decide: fails loudly when a resume reports failure without throwing', async () => {
    svc.attachAutomation({
      async resume() { return { success: false, code: 'RUN_NOT_FOUND', error: `No suspended run 'run_1'` }; },
    } as any);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    await expect(svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS))
      .rejects.toThrow(/RESUME_FAILED/);
  });

  it('decide: a resume that returns nothing still counts as success', async () => {
    // The historical shape: an engine (or a test double) that reports nothing
    // is reporting no failure, and must not be read as one.
    svc.attachAutomation({ async resume() { /* returns undefined */ } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(out.resumed).toBe(true);
  });

  // ── read API ────────────────────────────────────────────────────

  it('listRequests: filters by approver and status', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const pending = await svc.listRequests({ status: 'pending', approverId: 'u9' }, SYS);
    expect(pending).toHaveLength(1);
    const none = await svc.listRequests({ approverId: 'nobody' }, SYS);
    expect(none).toHaveLength(0);
  });

  it('listRequests: approverId accepts a list and matches ANY identity', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    // None of these identities individually except the last is the approver.
    const hit = await svc.listRequests(
      { status: 'pending', approverId: ['someone-else', 'user@example.com', 'u9'] },
      SYS,
    );
    expect(hit).toHaveLength(1);
    // A list with no matching identity returns nothing.
    const miss = await svc.listRequests({ approverId: ['a', 'b', 'role:viewer'] }, SYS);
    expect(miss).toHaveLength(0);
    // Empty / whitespace-only ids are ignored, not treated as a match-all.
    const ignored = await svc.listRequests({ approverId: ['', '  '] }, SYS);
    expect(ignored).toHaveLength(1);
  });

  it('listActions: returns the audit trail for a request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'approve']);
  });

  it('getRequest: returns null for an unknown id', async () => {
    expect(await svc.getRequest('nope', SYS)).toBeNull();
  });

  // ── viewer capability (#3310) ───────────────────────────────────
  it('getRequest: viewer.can_act is true for a pending approver, false for the submitter', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX); // submitter u1, approver u9
    const asApprover = await svc.getRequest(req.id, { userId: 'u9', tenantId: 't1' } as any);
    expect(asApprover!.viewer).toEqual({ can_act: true, is_submitter: false, can_override: false });
    const asSubmitter = await svc.getRequest(req.id, { userId: 'u1', tenantId: 't1' } as any);
    expect(asSubmitter!.viewer).toEqual({ can_act: false, is_submitter: true, can_override: false });
    // #3590: a same-tenant stranger participates in nothing, so the request is
    // not readable at all — previously it came back with an all-false viewer
    // block, which meant every authenticated user could read every request.
    expect(await svc.getRequest(req.id, { userId: 'u_stranger', tenantId: 't1' } as any)).toBeNull();
  });

  it('getRequest: viewer.can_act drops to false once the request is finalized', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS); // → approved
    const after = await svc.getRequest(req.id, { userId: 'u9', tenantId: 't1' } as any);
    expect(after!.status).toBe('approved');
    expect(after!.viewer!.can_act).toBe(false);
  });

  it('listRequests: attaches viewer to every row from the caller context', async () => {
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, { userId: 'u9', tenantId: 't1' } as any);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.viewer != null)).toBe(true);
    expect(rows[0].viewer!.can_act).toBe(true);
  });

  // ── recall ──────────────────────────────────────────────────────

  it('recall: submitter withdraws a pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.recall(req.id, { actorId: 'u1', comment: 'changed my mind' }, CTX);
    expect(out.request.status).toBe('recalled');
    expect(out.request.completed_at).toBeTruthy();
    expect(out.request.pending_approvers).toEqual([]);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'recall']);
    expect(actions[1].comment).toBe('changed my mind');
  });

  it('recall: blocks a non-submitter in a non-system context', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.recall(req.id, { actorId: 'u9' }, { positions: [], permissions: [] } as any))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('recall: rejects a recall on a non-pending request', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    await expect(svc.recall(req.id, { actorId: 'u1' }, SYS)).rejects.toThrow(/INVALID_STATE/);
  });

  it('recall: resumes the owning run down the reject branch with decision=recall', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(out.resumed).toBe(true);
    expect(resumed[0]).toMatchObject({
      runId: 'run_1',
      signal: { branchLabel: 'reject', output: { decision: 'recall' } },
    });
  });

  it('recall: mirrors `recalled` onto the business record when configured', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
    const req = await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(engine._tables['opportunity'][0].approval_status).toBe('recalled');
  });

  // ── inbox display fields ────────────────────────────────────────

  it('rows expose submitted_at as an alias of created_at', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.submitted_at).toBeTruthy();
    expect(req.submitted_at).toBe(req.created_at);
    const listed = await svc.listRequests({ status: 'pending' }, SYS);
    expect(listed[0].submitted_at).toBe(listed[0].created_at);
  });

  it('rows carry authored flow/node labels when provided', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], { flowLabel: 'Deal Approval', nodeLabel: 'Manager Review' }), CTX,
    );
    expect(req.process_label).toBe('Deal Approval');
    expect(req.step_label).toBe('Manager Review');
  });

  it('rows fall back to prettified machine names when labels are absent', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(req.process_label).toBe('Deal Approval'); // from `flow:deal_approval`
    expect(req.step_label).toBe('Approve Step');     // from `approve_step`
  });

  it('listRequests enriches record_title and submitter_name', async () => {
    engine._tables['opportunity'] = [{ id: 'opp1', name: 'Acme Renewal', amount: 100 }];
    engine._tables['sys_user'] = [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }];
    await svc.openNodeRequest(openInput(['u9']), CTX); // submitter_id = u1 (CTX.userId)
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].record_title).toBe('Acme Renewal');
    expect(rows[0].submitter_name).toBe('Ada Lovelace');
  });

  it('enrichment falls back to the payload snapshot when the record is gone', async () => {
    await svc.openNodeRequest(
      openInput(['u9'], { record: { id: 'opp1', name: 'Snapshot Title', amount: 1 } }), CTX,
    );
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].record_title).toBe('Snapshot Title');
  });

  it('enrichment resolves lookup foreign keys in the payload to record titles', async () => {
    (engine as any).getSchema = (name: string) =>
      name === 'opportunity'
        ? { label: 'Opportunity', fields: { name: {}, account: { type: 'lookup', reference: 'account' } } }
        : name === 'account' ? { label: 'Account', fields: { name: {} } } : undefined;
    engine._tables['opportunity'] = [{ id: 'opp1', name: 'Acme Renewal', account: 'acc1' }];
    engine._tables['account'] = [{ id: 'acc1', name: 'Acme Corp' }];
    await svc.openNodeRequest(openInput(['u9'], { record: { id: 'opp1', name: 'Acme Renewal', account: 'acc1' } }), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].object_label).toBe('Opportunity');
    expect(rows[0].payload_display).toEqual({ account: 'Acme Corp' });
  });

  it('enrichment maps snapshot field keys to the object field labels', async () => {
    (engine as any).getSchema = (name: string) =>
      name === 'opportunity'
        ? {
            label: 'Opportunity',
            fields: {
              id: {}, // no label → excluded from payload_labels
              name: { label: 'Deal Name' },
              amount: { label: 'Deal Amount' },
            },
          }
        : undefined;
    await svc.openNodeRequest(
      openInput(['u9'], { record: { id: 'opp1', name: 'Acme Renewal', amount: 100 } }), CTX,
    );
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    // Only keys present in the snapshot AND carrying a schema label are mapped;
    // `id` (unlabeled) is dropped.
    expect(rows[0].payload_labels).toEqual({ name: 'Deal Name', amount: 'Deal Amount' });
  });

  it('enrichment maps user-id approvers to display names', async () => {
    engine._tables['sys_user'] = [{ id: 'u9', name: 'Grace Hopper', email: 'grace@example.com' }];
    await svc.openNodeRequest(openInput(['u9']), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].pending_approver_names).toEqual({ u9: 'Grace Hopper' });
  });

  it('listActions resolves actor display names', async () => {
    engine._tables['sys_user'] = [
      { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'u9', name: 'Grace Hopper', email: 'grace@example.com' },
    ];
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => (a as any).actor_name)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  // ── thread interactions ─────────────────────────────────────────

  it('reassign: hands the slot to a new approver and audits the move on structured fields (#4365)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    const out = await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, asUser('u9'));
    expect(out.request.pending_approvers).toEqual(['u7', 'u2']);
    const actions = await svc.listActions(req.id, SYS);
    const audit = actions.at(-1)!;
    expect(audit).toMatchObject({ action: 'reassign', actor_id: 'u9', reassign_from: 'u9', reassign_to: 'u7' });
    // No user comment → none invented. The old default baked raw user ids
    // into user-facing text ("u9 → u7").
    expect(audit.comment).toBeUndefined();
  });

  it('reassign: a user comment is stored verbatim alongside the structured fields (#4365)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7', comment: 'On leave next week' }, asUser('u9'));
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({
      action: 'reassign', reassign_from: 'u9', reassign_to: 'u7', comment: 'On leave next week',
    });
  });

  it('reassign: listActions resolves the hand-off parties to display names (#4365)', async () => {
    engine._tables['sys_user'] = [
      { id: 'u9', name: 'Grace Hopper', email: 'grace@example.com' },
      { id: 'u7', name: 'Ada Lovelace', email: 'ada@example.com' },
    ];
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, asUser('u9'));
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({
      reassign_from_name: 'Grace Hopper', reassign_to_name: 'Ada Lovelace',
    });
  });

  it('reassign: notifies the new approver via messaging', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, asUser('u9'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ topic: 'approval.reassigned', audience: ['u7'] });
  });

  it('reassign: blocks a non-holder and duplicate targets', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    await expect(svc.reassign(req.id, { actorId: 'intruder', to: 'u7' }, asUser('intruder'))).rejects.toThrow(/FORBIDDEN/);
    await expect(svc.reassign(req.id, { actorId: 'u9', to: 'u2' }, asUser('u9'))).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('remind: notifies pending approvers, audits, and throttles repeats', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9', 'u2']), CTX);
    const out = await svc.remind(req.id, { actorId: 'u1' }, CTX); // u1 = submitter (CTX.userId)
    expect(out.notified).toBe(2);
    // ADR-0043: per-approver fan-out so each reminder carries personal links.
    const reminders = emitted.filter(e => e.topic === 'approval.reminder');
    expect(reminders.map(r => r.audience)).toEqual([['u9'], ['u2']]);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)?.action).toBe('remind');
    // The fake clock steps 1s per call — well inside the 4h cool-down.
    await expect(svc.remind(req.id, { actorId: 'u1' }, CTX)).rejects.toThrow(/THROTTLED/);
  });

  it('remind: cool-down measures from the NEWEST reminder, not the first', async () => {
    // Regression: the throttle query sorted with the non-canonical
    // `direction: 'desc'` key, which SortNode strips — so it sorted asc and
    // compared against the FIRST reminder ever sent. Once 4h passed after
    // reminder #1, every later remind() sailed through unthrottled.
    let nowMs = baseTime;
    const localSvc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(nowMs += 1000) },
    });
    const req = await localSvc.openNodeRequest(openInput(['u9']), CTX);
    await localSvc.remind(req.id, { actorId: 'u1' }, CTX);
    // Jump past the cool-down: a second reminder is legitimately allowed.
    nowMs += REMIND_COOLDOWN_MS;
    await localSvc.remind(req.id, { actorId: 'u1' }, CTX);
    // Immediately after reminder #2 the throttle must bite again — with the
    // wrong sort key it compared against reminder #1 (now >4h old) and let
    // unlimited reminders through.
    await expect(localSvc.remind(req.id, { actorId: 'u1' }, CTX)).rejects.toThrow(/THROTTLED/);
  });

  it('remind: only the submitter may nudge', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await expect(svc.remind(req.id, { actorId: 'u9' }, { positions: [], permissions: [] } as any))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('requestInfo: keeps the request pending and notifies the submitter', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const out = await svc.requestInfo(req.id, { actorId: 'u9', comment: 'Need the Q3 numbers' }, asUser('u9'));
    expect(out.request.status).toBe('pending');
    expect(out.request.pending_approvers).toEqual(['u9']);
    expect(emitted[0]).toMatchObject({ topic: 'approval.request_info', audience: ['u1'] });
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'request_info', comment: 'Need the Q3 numbers' });
  });

  it('comment: submitter and approver may reply; outsiders may not', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.comment(req.id, { actorId: 'u1', comment: 'Numbers attached.' }, CTX);
    await svc.comment(req.id, { actorId: 'u9', comment: 'Thanks, reviewing.' }, asUser('u9'));
    await expect(svc.comment(req.id, { actorId: 'outsider', comment: 'hi' }, asUser('outsider')))
      .rejects.toThrow(/FORBIDDEN/);
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.filter(a => a.action === 'comment')).toHaveLength(2);
  });

  // ── actionable links (ADR-0043) ─────────────────────────────────

  it('issueActionTokens: stores hashes only and binds approver + action', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const tokens = await svc.issueActionTokens(req.id, 'u9');
    expect(tokens.approve).not.toBe(tokens.reject);
    const rows = engine._tables['sys_approval_token'];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.token_hash.length === 64)).toBe(true); // sha256 hex, never the raw token
    expect(rows.every(r => !JSON.stringify(r).includes(tokens.approve))).toBe(true);
    await expect(svc.issueActionTokens(req.id, 'stranger')).rejects.toThrow(/FORBIDDEN/);
  });

  it('redeem: approves as the bound approver and burns the token (single-use)', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const { approve } = await svc.issueActionTokens(req.id, 'u9');
    const out = await svc.redeemActionToken(approve);
    expect(out).toMatchObject({ ok: true, action: 'approve', approverId: 'u9' });
    expect((out as any).request.status).toBe('approved');
    expect(resumed[0]?.signal?.branchLabel).toBe('approve');
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.at(-1)).toMatchObject({ action: 'approve', actor_id: 'u9', comment: 'Via action link' });
    // replay
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: false, reason: 'consumed' });
  });

  it('peek: validates without consuming (GET never mutates)', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const { reject } = await svc.issueActionTokens(req.id, 'u9');
    expect(await svc.peekActionToken(reject)).toMatchObject({ ok: true, action: 'reject' });
    expect(await svc.peekActionToken(reject)).toMatchObject({ ok: true }); // still live
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
  });

  it('redeem: dead tokens — invalid, expired, decided request, reassigned slot', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    expect(await svc.redeemActionToken('garbage')).toMatchObject({ ok: false, reason: 'invalid' });

    const short = await svc.issueActionTokens(req.id, 'u9', { ttlMs: 1 });
    // fake clock advances 1s per call — far beyond a 1ms TTL
    expect(await svc.redeemActionToken(short.approve)).toMatchObject({ ok: false, reason: 'expired' });

    const live = await svc.issueActionTokens(req.id, 'u9');
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, asUser('u9'));
    expect(await svc.redeemActionToken(live.approve)).toMatchObject({ ok: false, reason: 'not_approver' });

    const forU7 = await svc.issueActionTokens(req.id, 'u7');
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u7' }, SYS);
    expect(await svc.redeemActionToken(forU7.reject)).toMatchObject({ ok: false, reason: 'not_pending' });
  });

  it('remind: each concrete approver gets their own action links', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u9', 'ada@example.com']), CTX);
    await svc.remind(req.id, { actorId: 'u1' }, CTX);
    const reminders = emitted.filter(e => e.topic === 'approval.reminder');
    expect(reminders).toHaveLength(2);
    for (const r of reminders) {
      expect(r.audience).toHaveLength(1);
      expect(r.payload.actions).toHaveLength(2);
      expect(r.payload.actions[0].url).toContain('/api/v1/approvals/act?token=');
    }
    const urls = reminders.flatMap(r => r.payload.actions.map((a: any) => a.url));
    expect(new Set(urls).size).toBe(4); // every link is personal + per-action
  });

  // ── pagination + search pushdown (#1745) ────────────────────────

  async function openMany(n: number) {
    for (let i = 0; i < n; i++) {
      await svc.openNodeRequest(openInput(['u9'], {
        recordId: `opp${i}`, record: { id: `opp${i}`, name: `Deal ${i}` },
      }), CTX);
    }
  }

  it('listRequests: windows pushable queries newest-first with limit/offset', async () => {
    await openMany(5);
    const page1 = await svc.listRequests({ limit: 2, offset: 0 }, SYS);
    const page2 = await svc.listRequests({ limit: 2, offset: 2 }, SYS);
    expect(page1.map(r => r.record_id)).toEqual(['opp4', 'opp3']); // created_at desc
    expect(page2.map(r => r.record_id)).toEqual(['opp2', 'opp1']);
  });

  it('listRequests: q matches the payload snapshot (record titles) via pushdown', async () => {
    await openMany(3);
    const hit = await svc.listRequests({ q: 'Deal 1', limit: 10 }, SYS);
    expect(hit.map(r => r.record_id)).toEqual(['opp1']);
    const miss = await svc.listRequests({ q: 'no-such-thing', limit: 10 }, SYS);
    expect(miss).toHaveLength(0);
  });

  it('countRequests: returns the unwindowed total for a filter', async () => {
    await openMany(4);
    expect(await svc.countRequests({ status: 'pending' }, SYS)).toBe(4);
    expect(await svc.countRequests({ q: 'Deal 2' }, SYS)).toBe(1);
  });

  it('listRequests: approver queries resolve via the index and window engine-side', async () => {
    await openMany(4); // approver u9 on all
    await svc.openNodeRequest(openInput(['someone-else'], {
      recordId: 'oppX', record: { id: 'oppX', name: 'Other' },
    }), CTX);
    const page = await svc.listRequests({ approverId: 'u9', limit: 2, offset: 2 }, SYS);
    expect(page).toHaveLength(2);
    expect(page.every(r => r.pending_approvers?.includes('u9'))).toBe(true);
    expect(await svc.countRequests({ approverId: 'u9' }, SYS)).toBe(4);
  });

  it('listRequests/countRequests: status arrays push down as $in', async () => {
    await openMany(3);
    const all = await svc.listRequests({ status: 'pending' }, SYS);
    await svc.decideNode(all[0].id, { decision: 'approve', actorId: 'u9' }, SYS);
    await svc.decideNode(all[1].id, { decision: 'reject', actorId: 'u9' }, SYS);
    const done = await svc.listRequests({ status: ['approved', 'rejected'] }, SYS);
    expect(done.map(r => r.status).sort()).toEqual(['approved', 'rejected']);
    expect(await svc.countRequests({ status: ['approved', 'rejected'] }, SYS)).toBe(2);
    expect(await svc.countRequests({ status: ['recalled'] }, SYS)).toBe(0);
  });

  // ── pending-approver index (#1745 join table) ───────────────────

  const indexRows = () => (engine._tables['sys_approval_approver'] ?? [])
    .map(r => ({ request_id: r.request_id, approver: r.approver }));

  it('openNodeRequest mirrors every approver identity into the index', async () => {
    const req = await svc.openNodeRequest(openInput(['u9', 'ada@example.com', 'role:finance']), CTX);
    expect(indexRows()).toEqual([
      { request_id: req.id, approver: 'u9' },
      { request_id: req.id, approver: 'ada@example.com' },
      { request_id: req.id, approver: 'role:finance' },
    ]);
  });

  it('decide and recall clear the request\'s index rows', async () => {
    const a = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(a.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(indexRows()).toHaveLength(0);

    const b = await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    await svc.recall(b.id, { actorId: 'u1' }, CTX);
    expect(indexRows()).toHaveLength(0);
  });

  it('unanimous partial approval shrinks the index to the still-pending set', async () => {
    const req = await svc.openNodeRequest(openInput(['u1', 'u2'], {}, { behavior: 'unanimous' }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(indexRows()).toEqual([{ request_id: req.id, approver: 'u2' }]);
  });

  it('reassign and SLA-reassign rewrite the index rows', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9', 'u2'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'boss', notifySubmitter: false } }), CTX,
    );
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, SYS);
    expect(indexRows().map(r => r.approver).sort()).toEqual(['u2', 'u7']);

    makeOverdue(req.id);
    await svc.runEscalations();
    expect(indexRows()).toEqual([{ request_id: req.id, approver: 'boss' }]);
  });

  it('approver-filtered pages stay correct past the old 500-row scan window', async () => {
    // 30 u9 requests are the OLDEST rows, buried under 510 newer non-matching
    // ones — the pre-#1745 bounded scan (limit 500, newest-first) could never
    // reach them. Seeded directly: 540 openNodeRequest round-trips are noise.
    const reqs = (engine._tables['sys_approval_request'] ??= []);
    const idx = (engine._tables['sys_approval_approver'] ??= []);
    const ts = (i: number) => new Date(baseTime + i * 1000).toISOString();
    for (let i = 0; i < 30; i++) {
      reqs.push({
        id: `match_${i}`, process_name: 'flow:f', object_name: 'o', record_id: `m${i}`,
        status: 'pending', pending_approvers: 'u9', created_at: ts(i), updated_at: ts(i),
      });
      idx.push({ id: `aapr_m${i}`, request_id: `match_${i}`, approver: 'u9', organization_id: null, created_at: ts(i) });
    }
    for (let i = 0; i < 510; i++) {
      reqs.push({
        id: `noise_${i}`, process_name: 'flow:f', object_name: 'o', record_id: `n${i}`,
        status: 'pending', pending_approvers: 'someone-else', created_at: ts(100 + i), updated_at: ts(100 + i),
      });
      idx.push({ id: `aapr_n${i}`, request_id: `noise_${i}`, approver: 'someone-else', organization_id: null, created_at: ts(100 + i) });
    }

    expect(await svc.countRequests({ approverId: 'u9' }, SYS)).toBe(30);
    const page = await svc.listRequests({ approverId: 'u9', limit: 10, offset: 20 }, SYS);
    // Newest-first within the matches: offset 20 of 30 → match_9 … match_0.
    expect(page.map(r => r.id)).toEqual(Array.from({ length: 10 }, (_, k) => `match_${9 - k}`));
    expect(page.every(r => r.pending_approvers?.includes('u9'))).toBe(true);
  });

  it('rebuildApproverIndex backfills legacy rows, drops orphans + stale entries, and is idempotent', async () => {
    const reqs = (engine._tables['sys_approval_request'] ??= []);
    const idx = (engine._tables['sys_approval_approver'] ??= []);
    const ts = new Date(baseTime).toISOString();
    // Legacy pending row written before the index existed.
    reqs.push({
      id: 'legacy_1', process_name: 'flow:f', object_name: 'o', record_id: 'r1',
      status: 'pending', pending_approvers: 'u1,u2', created_at: ts, updated_at: ts,
    });
    // Completed row whose index rows were never cleaned (orphan).
    reqs.push({
      id: 'done_1', process_name: 'flow:f', object_name: 'o', record_id: 'r2',
      status: 'approved', pending_approvers: null, created_at: ts, updated_at: ts,
    });
    idx.push({ id: 'aapr_orphan', request_id: 'done_1', approver: 'u3', organization_id: null, created_at: ts });
    // Pending row whose index drifted (holds an approver no longer in the CSV).
    reqs.push({
      id: 'drift_1', process_name: 'flow:f', object_name: 'o', record_id: 'r3',
      status: 'pending', pending_approvers: 'u5', created_at: ts, updated_at: ts,
    });
    idx.push({ id: 'aapr_stale', request_id: 'drift_1', approver: 'u4', organization_id: null, created_at: ts });

    const out = await svc.rebuildApproverIndex();
    expect(out).toEqual({ requests: 2, inserted: 3, deleted: 2 }); // +u1 +u2 +u5 / -orphan -stale
    expect(indexRows().sort((a, b) => a.approver.localeCompare(b.approver))).toEqual([
      { request_id: 'legacy_1', approver: 'u1' },
      { request_id: 'legacy_1', approver: 'u2' },
      { request_id: 'drift_1', approver: 'u5' },
    ]);

    const again = await svc.rebuildApproverIndex();
    expect(again).toEqual({ requests: 2, inserted: 0, deleted: 0 });
  });

  // ── SLA escalation (ADR-0042) ───────────────────────────────────

  function makeOverdue(reqId: string) {
    // Push created_at into the past so a small timeoutHours is breached.
    const row = engine._tables['sys_approval_request'].find(r => r.id === reqId)!;
    row.created_at = new Date(baseTime - 10 * 3600_000).toISOString();
  }

  it('runEscalations: notify action messages approvers + escalateTo + submitter, once', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 2, action: 'notify', escalateTo: 'boss', notifySubmitter: true } }), CTX,
    );
    makeOverdue(req.id);
    const first = await svc.runEscalations();
    expect(first.escalated).toBe(1);
    expect(emitted.map(e => e.topic)).toEqual(['approval.sla_breached', 'approval.sla_breached']);
    expect(emitted[0].audience).toEqual(['u9', 'boss']);
    expect(emitted[1].audience).toEqual(['u1']); // submitter
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.at(-1)).toMatchObject({ action: 'escalate', actor_id: 'system:sla', comment: 'notify → boss' });
    // Single-shot: second sweep is a no-op.
    const second = await svc.runEscalations();
    expect(second.escalated).toBe(0);
    expect(emitted).toHaveLength(2);
  });

  it('runEscalations: auto_approve decides as system:sla and resumes the flow', async () => {
    const resumed: any[] = [];
    svc.attachAutomation({ async resume(runId, signal) { resumed.push({ runId, signal }); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'auto_approve', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    const out = await svc.runEscalations();
    expect(out.escalated).toBe(1);
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('approved');
    expect(resumed[0]).toMatchObject({ runId: 'run_1', signal: { branchLabel: 'approve' } });
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.map(a => a.action)).toEqual(['submit', 'escalate', 'approve']);
    expect(actions.at(-1)?.actor_id).toBe('system:sla');
  });

  it('runEscalations: auto_reject decides as system:sla', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'auto_reject', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('rejected');
  });

  it('runEscalations: reassign replaces the approver set with escalateTo', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9', 'u2'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'boss', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
    expect(fresh?.pending_approvers).toEqual(['boss']);
  });

  it('runEscalations: reassign expands a position escalateTo to its holders (ADR-0090 D3)', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'approvals_supervisor', organization_id: 't1' },
      { id: 'up2', user_id: 'u6', position: 'approvals_supervisor', organization_id: 't1' },
      { id: 'up3', user_id: 'u7', position: 'approvals_supervisor', organization_id: 't2' }, // other tenant
    ];
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'approvals_supervisor', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('pending');
    expect(fresh?.pending_approvers?.slice().sort()).toEqual(['u5', 'u6']);
    // The audit trail keeps the AUTHORED target, not the expansion.
    const actions = await svc.listActions(req.id, SYS);
    expect(actions.find(a => a.action === 'escalate')?.comment).toBe('reassign → approvals_supervisor');
  });

  it('runEscalations: notify expands a position escalateTo into the audience', async () => {
    engine._tables['sys_user_position'] = [
      { id: 'up1', user_id: 'u5', position: 'approvals_supervisor', organization_id: 't1' },
    ];
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 2, action: 'notify', escalateTo: 'approvals_supervisor', notifySubmitter: false } }), CTX,
    );
    makeOverdue(req.id);
    await svc.runEscalations();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].audience).toEqual(['u9', 'u5']);
  });

  it('runEscalations: skips requests that are not yet due or have no SLA', async () => {
    await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 1000, action: 'auto_approve' } }), CTX,
    );
    await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    const out = await svc.runEscalations();
    expect(out.scanned).toBe(2);
    expect(out.escalated).toBe(0);
  });

  // ── SLA + flow steps ────────────────────────────────────────────

  it('rows expose sla_due_at when the node declares escalation.timeoutHours', async () => {
    const req = await svc.openNodeRequest(
      openInput(['u9'], {}, { escalation: { timeoutHours: 48, action: 'notify', notifySubmitter: true } }), CTX,
    );
    expect(req.sla_due_at).toBe(new Date(Date.parse(req.created_at!) + 48 * 3600_000).toISOString());
    const noSla = await svc.openNodeRequest(openInput(['u9'], { recordId: 'opp2', record: { id: 'opp2' } }), CTX);
    expect(noSla.sla_due_at).toBeUndefined();
  });

  it('getRequest attaches flow_steps from the owning flow graph', async () => {
    svc.attachAutomation({
      async getFlow(name: string) {
        if (name !== 'deal_approval') return null;
        return {
          name: 'deal_approval',
          nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'approve_step', type: 'approval', label: 'Manager Approval' },
            { id: 'gate', type: 'decision', label: 'Big?' },
            { id: 'exec_step', type: 'approval', label: 'Executive Approval' },
            { id: 'end', type: 'end', label: 'End' },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'approve_step' },
            { id: 'e2', source: 'approve_step', target: 'gate', label: 'approve' },
            { id: 'e3', source: 'gate', target: 'exec_step', label: 'true' },
            { id: 'e4', source: 'exec_step', target: 'end', label: 'approve' },
          ],
        };
      },
    });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.flow_steps).toEqual([
      { id: 'approve_step', label: 'Manager Approval', state: 'current' },
      { id: 'exec_step', label: 'Executive Approval', state: 'upcoming' },
    ]);
  });

  it('enrichment resolves an email submitter via sys_user.email', async () => {
    engine._tables['sys_user'] = [{ id: 'u7', name: 'Grace Hopper', email: 'grace@example.com' }];
    await svc.openNodeRequest(openInput(['u9'], { submitterId: 'grace@example.com' }), CTX);
    const rows = await svc.listRequests({ status: 'pending' }, SYS);
    expect(rows[0].submitter_name).toBe('Grace Hopper');
  });
});

// ── Admin / privileged override (#3424) ──────────────────────────────
//
// An approval routed to a position/team with NO holders resolves to only the
// unresolvable `position:<name>` literal — no concrete user is in the slate, so
// every normal decision is FORBIDDEN and (with lockRecord) the record stays
// locked forever with no in-product recovery. A platform or tenant admin may
// act on the pending request to release it: approve, reject, reassign it to a
// real approver, or recall it. Privilege is org-scoped for tenant admins.
describe('ApprovalService — admin override (#3424)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  // Admin exec contexts, shaped like the resolved authz envelope (permissions
  // carry the permission-set names the shared resolver aggregates).
  const PLATFORM_ADMIN = { userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;
  const TENANT_ADMIN = { userId: 'owner', tenantId: 't1', positions: [], permissions: ['organization_admin'] } as any;
  const OTHER_TENANT_ADMIN = { userId: 'owner2', tenantId: 't2', positions: [], permissions: ['organization_admin'] } as any;
  const MEMBER = { userId: 'nobody', tenantId: 't1', positions: [], permissions: [] } as any;

  // A request routed to an UNSTAFFED position → `pending_approvers` falls back to
  // the `position:sales_manager` literal, undecidable by any normal user.
  const stuckInput = (extra: Record<string, any> = {}) => ({
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval',
    config: { approvers: [{ type: 'position' as const, value: 'sales_manager' }], behavior: 'first_response' as const, lockRecord: true },
    record: { id: 'opp1', amount: 100 },
    ...extra,
  });

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
  });

  it('the stuck request is undecidable by any normal user (repro)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    expect(req.pending_approvers).toEqual(['position:sales_manager']);
    // Even the org owner-by-id is not in the resolved (empty) slate.
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'nobody' }, MEMBER))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('a tenant admin can approve a stuck request, finalizing it (which releases the lock)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
    // No pending request remains → the record-lock hook no longer blocks edits.
    const fresh = await svc.getRequest(req.id, SYS);
    expect(fresh?.status).toBe('approved');
    expect(fresh?.pending_approvers).toEqual([]);
    // Audited under the admin's own id — never spoofed as an approver.
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.at(-1)).toMatchObject({ action: 'approve', actor_id: 'owner' });
  });

  it('a platform admin can reject a stuck request', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.decide(req.id, { decision: 'reject', actorId: 'root' }, PLATFORM_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('rejected');
  });

  it('an admin override finalizes even a unanimous request immediately (not one vote among the slate)', async () => {
    const req = await svc.openNodeRequest(stuckInput({
      config: { approvers: [{ type: 'position' as const, value: 'sales_manager' }], behavior: 'unanimous' as const, lockRecord: true },
    }), CTX);
    const out = await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    expect(out.finalized).toBe(true);
    expect(out.request.status).toBe('approved');
  });

  it('an admin can reassign a stuck request to a real approver, who then decides normally', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.reassign(req.id, { actorId: 'owner', to: 'u7' }, TENANT_ADMIN);
    expect(out.request.pending_approvers).toEqual(['u7']);
    const decided = await svc.decideNode(
      req.id, { decision: 'approve', actorId: 'u7' },
      { userId: 'u7', tenantId: 't1', positions: [], permissions: [] } as any,
    );
    expect(decided.finalized).toBe(true);
  });

  it('an admin can recall (withdraw) a stuck request', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const out = await svc.recall(req.id, { actorId: 'owner', comment: 'unstaffed role' }, TENANT_ADMIN);
    expect(out.request.status).toBe('recalled');
    expect(out.request.pending_approvers).toEqual([]);
  });

  it('a tenant admin of a DIFFERENT org cannot override (privilege is org-scoped)', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX); // organization_id = t1
    await expect(svc.decideNode(req.id, { decision: 'approve', actorId: 'owner2' }, OTHER_TENANT_ADMIN))
      .rejects.toThrow(/FORBIDDEN/);
  });

  it('viewer.can_override reflects the privilege, and drops once finalized', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    const asAdmin = await svc.getRequest(req.id, TENANT_ADMIN);
    expect(asAdmin!.viewer).toMatchObject({ can_act: false, can_override: true });
    // Someone who CAN see the request but holds no override privilege — the
    // submitter. `can_override` is about the privilege, not about access, so
    // the check needs a participant rather than a stranger.
    const asSubmitter = await svc.getRequest(req.id, CTX);
    expect(asSubmitter!.viewer!.can_override).toBe(false);
    await svc.decide(req.id, { decision: 'approve', actorId: 'owner' }, TENANT_ADMIN);
    const after = await svc.getRequest(req.id, TENANT_ADMIN);
    expect(after!.viewer!.can_override).toBe(false);
  });

  // #3590: a plain member who participates in nothing now sees nothing — a
  // request is no longer readable merely because you are in the same tenant.
  it('a non-participant member cannot read the request at all', async () => {
    const req = await svc.openNodeRequest(stuckInput(), CTX);
    expect(await svc.getRequest(req.id, MEMBER)).toBeNull();
  });
});

describe('record-lock hook (node era)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  beforeEach(async () => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    bindApprovalLockHook(engine as any);
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
  });

  it('blocks a user edit to a record with a pending approval', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: false, positions: [], userId: 'u1' },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('allows a status-mirror write (only the approvalStatusField changes)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { approval_status: 'approved' } },
        session: { isSystem: false, positions: [] },
      }),
    ).resolves.toBeUndefined();
  });

  it('allows engine self-writes (system session)', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: true, positions: [] },
      }),
    ).resolves.toBeUndefined();
  });

  // ── #4839: there is NO admin exemption on the record lock ─────────
  //
  // The hook used to bypass on `session.roles.includes('admin')`. `roles` has no
  // producer (ObjectQL's `buildSession()` never writes it), so the branch was
  // dead and the lock has always applied to admins; the maintainer's ruling
  // deletes it rather than reviving it under the ADR-0095 vocabulary. An admin
  // releases a locked record through the audited #3424 rescue path
  // (recall / reject / reassign), never by editing the record under a live
  // approval. Both shapes below are pinned: the dead dialect must not come back,
  // and the live privilege vocabulary must not be wired in here instead.
  it.each(ADMIN_SESSIONS)('does NOT exempt %s from the record lock', async (_label, session) => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session,
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('does not lock records without a pending request', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'other_record', data: { amount: 200 } },
        session: { isSystem: false, positions: [] },
      }),
    ).resolves.toBeUndefined();
  });

  // ── #3456 prevention half: the lock must not kill the run that owns it ──

  it('allows the OWNING run to write its own target record', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        // Neither elevated nor admin — the exemption rides on run identity
        // alone, so a `runAs:'user'` run stays RLS-scoped while it writes.
        session: { isSystem: false, positions: [], userId: 'u1' },
        provenance: { flowRunId: 'run_1' },
      }),
    ).resolves.toBeUndefined();
  });

  // #3712 — the residual #3703 left open. A schedule-triggered run resolves NO
  // principal, so it arrives with no session at all; provenance is the only
  // thing it carries, and the exemption must key on that rather than on an
  // identity the run does not have.
  it('allows an identity-less (schedule-triggered) owning run — no session at all', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        provenance: { flowRunId: 'run_1' },
      }),
    ).resolves.toBeUndefined();
  });

  it('still blocks a DIFFERENT run writing the locked record', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: false, positions: [], userId: 'u1' },
        provenance: { flowRunId: 'run_other' },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks an identity-less caller with no provenance at all', async () => {
    // The bare-kernel / no-context write. Nothing to match, nothing exempted.
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('does not exempt anyone when the pending request carries no run id', async () => {
    // A request with no owning run has nothing to match against — a stray
    // `flowRunId` must not become a skeleton key.
    engine._tables['sys_approval_request'][0].flow_run_id = null;
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { id: 'opp1', data: { amount: 200 } },
        session: { isSystem: false, positions: [], userId: 'u1' },
        provenance: { flowRunId: 'run_1' },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('unbindAllHooks removes the lock hook', () => {
    expect(unbindAllHooks(engine as any)).toBe(1);
    expect(engine._hooks['beforeUpdate']).toHaveLength(0);
  });
});

// ── #4778: the lock has to survive a PREDICATE (multi) update ────────────
//
// `engine.update()` extracts `input.id` only from a SCALAR `where.id`; every
// other predicate is a multi-row write that routes to `updateMany` and reaches
// the hook with NO id. The hook used to open with `if (!id) return`, reading
// "no row was resolved" as "nothing to authorize" when the truth was "nothing
// was ever queried" (the #4757 / #4630 fail-open shape). Rewriting the very
// same edit as `multi: true` then walked past the lock with NO privilege at
// all — no admin, no isSystem, no `lockRecord: false`, no whitelisted field.
//
// Both halves are pinned here, because extending a guard to more rows fails
// the other way just as easily: the refusals AND every exemption, on both
// predicate shapes.
describe('record-lock hook — predicate (multi) updates (#4778)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  /** The two shapes that carry no `input.id` and used to bypass the lock. */
  const SHAPES: Array<[string, any]> = [
    ['an id-operator predicate', { id: { $in: ['opp1'] } }],
    ['a non-id predicate', { stage: 'new' }],
  ];

  const USER = { isSystem: false, positions: [], userId: 'u1' };

  /** A `multi: true` update, i.e. the ctx the engine builds for `updateMany`. */
  const predicateUpdate = (
    where: any,
    data: Record<string, unknown>,
    rest: Record<string, unknown> = {},
  ) =>
    engine.fire('beforeUpdate', {
      object: 'opportunity',
      input: { data, options: { ...(where === undefined ? {} : { where }), multi: true } },
      session: USER,
      ...rest,
    });

  /** Re-open the pending request with a different node-config snapshot. */
  const reopenWith = async (configExtra: Record<string, any>) => {
    engine._tables['sys_approval_request'] = [];
    engine._tables['sys_approval_action'] = [];
    await svc.openNodeRequest(
      openInput(['u9'], {}, { approvalStatusField: 'approval_status', ...configExtra }),
      CTX,
    );
  };

  beforeEach(async () => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    bindApprovalLockHook(engine as any);
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    // `opp1` carries the pending request; `opp2` is an unlocked neighbour that
    // the same predicates also match.
    engine._tables['opportunity'] = [
      { id: 'opp1', amount: 100, stage: 'new' },
      { id: 'opp2', amount: 100, stage: 'new' },
    ];
  });

  // ── the hole itself ───────────────────────────────────────────────

  it.each(SHAPES)('blocks %s that reaches the locked record', async (_label, where) => {
    await expect(predicateUpdate(where, { amount: 999 })).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('blocks an unscoped whole-table update — no predicate at all', async () => {
    // `updateMany` gets an AST of `{ object }`, i.e. every row, so every locked
    // row of the object is in reach. "No predicate" is the widest write there
    // is; it must not be the one that reads as "nothing to authorize".
    await expect(predicateUpdate(undefined, { amount: 999 })).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('names the locked record and its object in the refusal', async () => {
    await expect(predicateUpdate({ stage: 'new' }, { amount: 999 }))
      .rejects.toThrow(/record 'opp1' of 'opportunity' is locked/);
  });

  // ── and it must not over-block: a lock is a PER-ROW verdict ────────

  it('allows a predicate that reaches only unlocked rows', async () => {
    await expect(predicateUpdate({ id: { $in: ['opp2'] } }, { amount: 999 })).resolves.toBeUndefined();
  });

  it('allows a non-id predicate that matches no locked row', async () => {
    // `opp1` is `stage: 'new'`, so this predicate misses it. Resolving the row
    // set is what makes the difference between refusing this write and
    // refusing every bulk update on an object that has any approval open.
    await expect(predicateUpdate({ stage: 'closed' }, { amount: 999 })).resolves.toBeUndefined();
  });

  it('never scans an object that has no pending approval at all', async () => {
    engine._finds.length = 0;
    await expect(
      engine.fire('beforeUpdate', {
        object: 'other_object',
        input: { data: { amount: 999 }, options: { where: { stage: 'new' }, multi: true } },
        session: USER,
      }),
    ).resolves.toBeUndefined();
    // One bookkeeping probe, and nothing else: the bound is on locked records,
    // so a mass update of unlocked rows costs a single query.
    expect(engine._finds.map(f => f.object)).toEqual(['sys_approval_request']);
  });

  // ── fail closed when the row set cannot be decided ─────────────────

  it('fails closed past the 1000-record bound', async () => {
    for (let i = 0; i < 1001; i++) {
      engine._tables['sys_approval_request'].push({
        id: `extra_${i}`,
        object_name: 'opportunity',
        record_id: `bulk_${i}`,
        status: 'pending',
        node_config_json: JSON.stringify({ lockRecord: true }),
      });
    }
    await expect(predicateUpdate({ stage: 'new' }, { amount: 999 }))
      .rejects.toThrow(/RECORD_LOCKED.*more than 1000/s);
  });

  it('fails closed when the match set cannot be resolved', async () => {
    const realFind = engine.find.bind(engine);
    engine.find = (async (object: string, options?: any) => {
      if (object === 'opportunity') throw new Error('driver unavailable');
      return realFind(object, options);
    }) as typeof engine.find;
    await expect(predicateUpdate({ stage: 'new' }, { amount: 999 }))
      .rejects.toThrow(/RECORD_LOCKED.*cannot determine which rows/s);
  });

  // ── every exemption moves with the guard (the other failure mode) ──

  it.each(SHAPES)('allows engine self-writes (system session) via %s', async (_label, where) => {
    await expect(
      predicateUpdate(where, { amount: 999 }, { session: { isSystem: true, positions: [] } }),
    ).resolves.toBeUndefined();
  });

  // #4839 — the deny half moves with the guard too: no admin shape is exempt on
  // the predicate path either, so a `multi: true` rewrite cannot become the
  // admin bypass the by-id path no longer has.
  it.each(
    SHAPES.flatMap(([sLabel, where]) =>
      ADMIN_SESSIONS.map(([aLabel, session]) => [`${aLabel} via ${sLabel}`, where, session] as const),
    ),
  )('does NOT exempt %s', async (_label, where, session) => {
    await expect(predicateUpdate(where, { amount: 999 }, { session })).rejects.toThrow(/RECORD_LOCKED/);
  });

  it.each(SHAPES)('allows a status-mirror write via %s', async (_label, where) => {
    await expect(predicateUpdate(where, { approval_status: 'approved' })).resolves.toBeUndefined();
  });

  it.each(SHAPES)('allows the OWNING run to write its own target record via %s', async (_label, where) => {
    await expect(
      predicateUpdate(where, { amount: 999 }, { provenance: { flowRunId: 'run_1' } }),
    ).resolves.toBeUndefined();
  });

  it.each(SHAPES)('allows the write when the node opted out of the lock, via %s', async (_label, where) => {
    await reopenWith({ lockRecord: false });
    await expect(predicateUpdate(where, { amount: 999 })).resolves.toBeUndefined();
  });

  // ── …and the exemptions stay as narrow as on the by-id path ────────

  it('still blocks a DIFFERENT run on the predicate path', async () => {
    await expect(
      predicateUpdate({ stage: 'new' }, { amount: 999 }, { provenance: { flowRunId: 'run_other' } }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks a mirror write that changes anything else too', async () => {
    await expect(
      predicateUpdate({ stage: 'new' }, { approval_status: 'approved', amount: 999 }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('still blocks an identity-less caller with no provenance at all', async () => {
    await expect(
      engine.fire('beforeUpdate', {
        object: 'opportunity',
        input: { data: { amount: 999 }, options: { where: { stage: 'new' }, multi: true } },
      }),
    ).rejects.toThrow(/RECORD_LOCKED/);
  });

  it('judges a multi-row write by EACH request it reaches', async () => {
    // Two records, two independent approvals: one opted out of the lock, one
    // did not. A predicate spanning both is refused by the one that locks.
    engine._tables['sys_approval_request'].push({
      id: 'req_2',
      object_name: 'opportunity',
      record_id: 'opp2',
      status: 'pending',
      flow_run_id: 'run_2',
      node_config_json: JSON.stringify({ lockRecord: false }),
    });
    await expect(predicateUpdate({ id: { $in: ['opp2'] } }, { amount: 999 })).resolves.toBeUndefined();
    await expect(predicateUpdate({ id: { $in: ['opp1', 'opp2'] } }, { amount: 999 }))
      .rejects.toThrow(/record 'opp1'/);
  });

  it('ignores a request that is no longer pending', async () => {
    engine._tables['sys_approval_request'][0].status = 'approved';
    await expect(predicateUpdate({ stage: 'new' }, { amount: 999 })).resolves.toBeUndefined();
  });
});

// ── #3456 recovery half: release records held by a dead approval run ──
//
// The prevention half above stops a run from dying on its own lock. This sweep
// covers the runs that die anyway — including a process crash, which no in-band
// handler can clean up because the process that would run it is gone.
//
// The load-bearing property is what it must NOT do: a run merely *paused* on its
// approval is the normal state of every live request, so anything short of an
// explicit terminal status has to be read as "alive".
describe('ApprovalService — dead-run release (#3456)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  /** Attach an automation surface whose `getRun` answers with `status`. */
  const withRunStatus = (status: string | null) =>
    svc.attachAutomation({ getRun: async () => (status == null ? null : { status }) } as any);

  const requestRow = () => engine._tables['sys_approval_request'][0];

  beforeEach(async () => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    bindApprovalLockHook(engine as any);
    await svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status' }), CTX);
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
  });

  it('releases a pending request whose owning run failed', async () => {
    withRunStatus('failed');
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 1 });
    expect(requestRow().status).toBe('recalled');
    expect(requestRow().pending_approvers).toBeNull();
    expect(requestRow().completed_at).toBeTruthy();
  });

  it('audits the release as a dead-run abandonment, not a submitter recall', async () => {
    withRunStatus('failed');
    await svc.releaseDeadRunRequests();
    const action = engine._tables['sys_approval_action'].find((a: any) => a.actor_id === 'system:dead-run');
    expect(action).toBeTruthy();
    expect(action.action).toBe('recall');
    expect(action.comment).toMatch(/run_1/);
    expect(action.comment).toMatch(/failed/);
  });

  it('actually unlocks the record — a plain user edit succeeds afterwards', async () => {
    // The end-to-end point of the whole sweep.
    const edit = () => engine.fire('beforeUpdate', {
      object: 'opportunity',
      input: { id: 'opp1', data: { amount: 200 } },
      session: { isSystem: false, positions: [], userId: 'u1' },
    });
    await expect(edit()).rejects.toThrow(/RECORD_LOCKED/);   // held by the dead run
    withRunStatus('failed');
    await svc.releaseDeadRunRequests();
    await expect(edit()).resolves.toBeUndefined();            // released
  });

  it('mirrors the configured status field on release', async () => {
    withRunStatus('failed');
    await svc.releaseDeadRunRequests();
    expect(engine._tables['opportunity'][0].approval_status).toBe('recalled');
  });

  it('leaves a PAUSED run alone — that is a live approval', async () => {
    withRunStatus('paused');
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it.each([
    ['an unknown run (null)', null],
    ['an unrecognised status', 'reticulating_splines'],
    ['a still-running run', 'running'],
  ])('leaves the request pending for %s', async (_label, status) => {
    withRunStatus(status as any);
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it('leaves the request pending when getRun throws', async () => {
    svc.attachAutomation({ getRun: async () => { throw new Error('engine unreachable'); } } as any);
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it('is a no-op with no automation engine attached', async () => {
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 0, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it('is a no-op when the surface has no getRun (older engine)', async () => {
    svc.attachAutomation({ resume: async () => undefined } as any);
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 0, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it('skips a request with no owning run', async () => {
    requestRow().flow_run_id = null;
    withRunStatus('failed');
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 0 });
    expect(requestRow().status).toBe('pending');
  });

  it.each(['completed', 'cancelled', 'timed_out'])(
    'releases on the other terminal status %s', async (status) => {
      // A terminal run can never decide its request, whatever ended it — a
      // `completed` one means someone resumed the run out of band.
      withRunStatus(status);
      expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 1, released: 1 });
      expect(requestRow().status).toBe('recalled');
    },
  );

  it('one unreadable request does not stop the sweep', async () => {
    await svc.openNodeRequest(
      { ...openInput(['u9']), recordId: 'opp2', runId: 'run_2' } as any, CTX,
    );
    let call = 0;
    svc.attachAutomation({
      getRun: async () => { call++; if (call === 1) throw new Error('boom'); return { status: 'failed' }; },
    } as any);
    expect(await svc.releaseDeadRunRequests()).toEqual({ scanned: 2, released: 1 });
  });
});

// ── Out-of-office auto-skip (#1322 M1/M4) ─────────────────────────────
//
// When a resolved individual approver has declared an active OOO delegation,
// the slot is rerouted to the delegate at resolution time (never a background
// job), audited as `ooo_substitute`, and both parties are notified. Group /
// graph approvers (position/team/department/tier) are left untouched.
describe('ApprovalService — out-of-office delegation (#1322)', () => {
  // Mid-window instant for the issue's own example (leave 5/26–5/30).
  const OOO_NOW = new Date('2026-05-27T10:00:00Z').getTime();
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let emitted: any[];

  function seedDelegation(rows: Array<Record<string, any>>) {
    engine._tables['sys_approval_delegation'] = rows.map((r, i) => ({
      id: `del${i}`,
      organization_id: 't1',
      valid_from: '2026-05-26T00:00:00Z',
      valid_until: '2026-05-30T00:00:00Z',
      reason: 'Annual leave',
      ...r,
    }));
  }

  beforeEach(() => {
    engine = makeFakeEngine();
    emitted = [];
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(OOO_NOW) } });
    svc.attachMessaging({ emit: async (m: any) => { emitted.push(m); } });
  });

  it('type:user — reroutes an out-of-office approver to the delegate', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('records an ooo_substitute audit action with "A → B — reason"', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    await svc.openNodeRequest(openInput(['alice']), CTX);
    const sub = engine._tables['sys_approval_action'].find((a: any) => a.action === 'ooo_substitute');
    expect(sub).toBeTruthy();
    expect(sub.comment).toBe('alice → bob — Annual leave');
    expect(sub.actor_id).toBeNull(); // system-recorded reroute, no human actor
  });

  it('notifies both the delegate and the skipped approver', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    await svc.openNodeRequest(openInput(['alice']), CTX);
    const to = emitted.find(e => e.topic === 'approval.ooo_substituted');
    const from = emitted.find(e => e.topic === 'approval.ooo_skipped');
    expect(to?.audience).toEqual(['bob']);
    expect(from?.audience).toEqual(['alice']);
  });

  it('does not reroute before valid_from (window not yet open)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', valid_from: '2026-05-28T00:00:00Z' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
    expect(engine._tables['sys_approval_action'].some((a: any) => a.action === 'ooo_substitute')).toBe(false);
  });

  it('does not reroute at/after valid_until (half-open window)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', valid_until: '2026-05-27T10:00:00Z' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('type:field — reroutes the user stored in the record field', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      record: { id: 'opp1', reviewer: 'alice' },
      config: { approvers: [{ type: 'field', value: 'reviewer' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('type:field (multi-select) — reroutes each out-of-office user independently (#3447)', async () => {
    // Pre-#3447 the array was stringified to one bogus id ('alice,dave'), which
    // matched no delegation — OOO silently no-op'd. Fanned out, alice → bob
    // applies and dave is left untouched.
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      record: { id: 'opp1', reviewers: ['alice', 'dave'] },
      config: { approvers: [{ type: 'field', value: 'reviewers' }], behavior: 'unanimous', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    expect(req.pending_approvers.sort()).toEqual(['bob', 'dave']);
  });

  it('type:manager — reroutes when the resolved manager is out of office', async () => {
    engine._tables['sys_user'] = [{ id: 'carol', manager_id: 'alice' }];
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      record: { id: 'opp1', owner_id: 'carol' },
      config: { approvers: [{ type: 'manager', value: 'owner_id' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('follows a delegation chain A → B → C', async () => {
    seedDelegation([
      { delegator_id: 'alice', delegate_id: 'bob' },
      { delegator_id: 'bob', delegate_id: 'carol' },
    ]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['carol']);
    expect(engine._tables['sys_approval_action'].filter((a: any) => a.action === 'ooo_substitute')).toHaveLength(2);
  });

  it('stops on a cycle A → B → A without looping', async () => {
    seedDelegation([
      { delegator_id: 'alice', delegate_id: 'bob' },
      { delegator_id: 'bob', delegate_id: 'alice' },
    ]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });

  it('ignores a self-delegation (A → A)', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'alice' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
    expect(engine._tables['sys_approval_action'].some((a: any) => a.action === 'ooo_substitute')).toBe(false);
  });

  it('leaves approvers unchanged when there is no active delegation', async () => {
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('does not OOO-substitute group-routed (position) approvers', async () => {
    engine._tables['sys_user_position'] = [{ id: 'up1', user_id: 'alice', position: 'sales_manager', organization_id: 't1' }];
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob' }]);
    const input = {
      ...openInput([]),
      config: { approvers: [{ type: 'position', value: 'sales_manager' }], behavior: 'first_response', lockRecord: true },
    };
    const req = await svc.openNodeRequest(input as any, CTX);
    // Position-routed leave is ADR-0091's job, not this path: the holder stays.
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('respects tenant scope: a rule scoped to another org does not apply', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', organization_id: 't2' }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['alice']);
  });

  it('applies a cross-tenant (null org) rule regardless of request tenant', async () => {
    seedDelegation([{ delegator_id: 'alice', delegate_id: 'bob', organization_id: null }]);
    const req = await svc.openNodeRequest(openInput(['alice']), CTX);
    expect(req.pending_approvers).toEqual(['bob']);
  });
});

// ── Delegation self-service write guard (#1322 follow-up) ─────────────
//
// sys_approval_delegation is apiEnabled CRUD; a member must not be able to
// forge a delegation for someone else (delegator_id = victim) and reroute the
// victim's approvals. The guard forces delegator_id == acting user for EVERY
// non-system write — since #4839 there is no admin exemption, only the system
// context bypasses. Row-ownership on update/delete is the platform's created_by
// RLS (not exercised here).
describe('sys_approval_delegation write guard (#1322)', () => {
  const DEL = 'sys_approval_delegation';
  let engine: ReturnType<typeof makeFakeEngine>;

  beforeEach(() => {
    engine = makeFakeEngine();
    bindDelegationWriteGuard(engine as any);
  });

  const fireInsert = (data: any, session: any) =>
    (engine as any).fire('beforeInsert', { object: DEL, input: { data }, session });
  const fireUpdate = (data: any, session: any) =>
    (engine as any).fire('beforeUpdate', { object: DEL, input: { id: data?.id ?? 'd1', data }, session });
  const member = (userId?: string) => ({ isSystem: false, roles: [], ...(userId ? { userId } : {}) });

  it('allows a member to create their own delegation', async () => {
    await expect(fireInsert({ delegator_id: 'u1', delegate_id: 'u2' }, member('u1'))).resolves.toBeUndefined();
  });

  it('rejects a member forging a delegation for someone else', async () => {
    await expect(fireInsert({ delegator_id: 'victim', delegate_id: 'u1' }, member('u1'))).rejects.toThrow(/FORBIDDEN/);
  });

  it('stamps the caller as delegator when omitted on insert', async () => {
    const data: any = { delegate_id: 'u2' };
    await fireInsert(data, member('u1'));
    expect(data.delegator_id).toBe('u1');
  });

  it('rejects an unauthenticated non-system insert', async () => {
    await expect(fireInsert({ delegate_id: 'u2' }, member())).rejects.toThrow(/FORBIDDEN/);
  });

  it('bypasses the guard for system context', async () => {
    await expect(fireInsert({ delegator_id: 'victim', delegate_id: 'u1' }, { isSystem: true })).resolves.toBeUndefined();
  });

  // ── #4839: delegation is SELF-MANAGED — no admin exemption ────────
  //
  // The guard used to bypass on `roles.includes('admin')` so an admin could
  // declare a delegation on someone else's behalf. Evidence decided this
  // (maintainer's ruling, point 2): a delegation is consulted only while a
  // request is being OPENED (`applyOooDelegation` inside `resolveApproverSpec`),
  // so it could never have handled the approvals an unavailable approver is
  // ALREADY holding — and for those the sanctioned, `isOverrideActor`-gated
  // path exists (`reassign` / `recall` / `decideNode` reject). See
  // `admin-exemption-retired.test.ts` for that coverage, executed.
  it.each(ADMIN_SESSIONS)('does NOT let %s forge a delegation for someone else', async (_label, session) => {
    await expect(
      fireInsert({ delegator_id: 'victim', delegate_id: 'u2' }, { ...session, userId: 'admin1' }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it.each(ADMIN_SESSIONS)('does NOT let %s relabel an existing delegation on update', async (_label, session) => {
    await expect(
      fireUpdate({ id: 'd1', delegator_id: 'victim' }, { ...session, userId: 'admin1' }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('still lets an admin declare their OWN delegation — the guard is about the delegator, not the caller', async () => {
    await expect(
      fireInsert({ delegator_id: 'admin1', delegate_id: 'u2' },
        { isSystem: false, userId: 'admin1', permissions: ['admin_full_access'], positions: [] }),
    ).resolves.toBeUndefined();
  });

  it('rejects a member relabelling delegator on update', async () => {
    await expect(fireUpdate({ id: 'd1', delegator_id: 'victim' }, member('u1'))).rejects.toThrow(/FORBIDDEN/);
  });

  it('allows a member update that does not touch delegator_id', async () => {
    await expect(fireUpdate({ id: 'd1', valid_until: '2026-06-01T00:00:00Z' }, member('u1'))).resolves.toBeUndefined();
  });

  it('rejects a batch insert if any row names a foreign delegator', async () => {
    await expect(fireInsert(
      [{ delegator_id: 'u1', delegate_id: 'u2' }, { delegator_id: 'victim', delegate_id: 'u3' }],
      member('u1'),
    )).rejects.toThrow(/FORBIDDEN/);
  });
});

// ── Quorum & per-group sign-off (#3266) ───────────────────────────────
//
// quorum = M-of-N collective sign-off; per_group = one (or minApprovals) from
// EACH group (会签). A single rejection is always a veto. Group membership is
// snapshotted at open, so OOO-substituted approvers count for their group.
describe('ApprovalService — quorum & per_group (#3266)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  const base = new Date('2026-08-01T10:00:00Z').getTime();

  beforeEach(() => {
    engine = makeFakeEngine();
    let n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(base + (n++) * 1000) } });
  });

  // Build an openNodeRequest input with explicit approver specs + behavior.
  const cfg = (approvers: any[], behavior: string, extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: { approvers, behavior, lockRecord: true, ...extra },
  });
  const U = (v: string, group?: string) => (group ? { type: 'user', value: v, group } : { type: 'user', value: v });

  it('quorum: holds until minApprovals reached, then finalizes', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    expect(a.finalized).toBe(false);
    expect(a.request.status).toBe('pending');
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(b.finalized).toBe(true);
    expect(b.request.status).toBe('approved');
  });

  it('quorum: minApprovals clamps to the approver count (no deadlock)', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2')], 'quorum', { minApprovals: 5 }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u2' }, SYS);
    expect(b.finalized).toBe(true);
  });

  it('quorum: any reject is a veto', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    const r = await svc.decideNode(req.id, { decision: 'reject', actorId: 'u1' }, SYS);
    expect(r.finalized).toBe(true);
    expect(r.request.status).toBe('rejected');
  });

  it('per_group: advances only when EACH group approves', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    expect(a.finalized).toBe(false); // finance still pending
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f1' }, SYS);
    expect(b.finalized).toBe(true);
    expect(b.request.status).toBe('approved');
  });

  it('per_group: two approvals in ONE group do not satisfy another group', async () => {
    const req = await svc.openNodeRequest(
      cfg([U('l1', 'legal'), U('l2', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'l2' }, SYS);
    expect(b.finalized).toBe(false); // finance still missing
  });

  it('per_group: minApprovals=2 needs two from each group', async () => {
    const req = await svc.openNodeRequest(cfg(
      [U('l1', 'legal'), U('l2', 'legal'), U('f1', 'finance'), U('f2', 'finance')],
      'per_group', { minApprovals: 2 }), CTX);
    for (const u of ['l1', 'f1', 'l2']) {
      const r = await svc.decideNode(req.id, { decision: 'approve', actorId: u }, SYS);
      expect(r.finalized).toBe(false);
    }
    const done = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f2' }, SYS);
    expect(done.finalized).toBe(true);
  });

  it('per_group: reject is a veto', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    const r = await svc.decideNode(req.id, { decision: 'reject', actorId: 'l1' }, SYS);
    expect(r.request.status).toBe('rejected');
  });

  it('per_group: an OOO-substituted member still counts for their group', async () => {
    engine._tables['sys_approval_delegation'] = [
      { id: 'd', delegator_id: 'l1', delegate_id: 'lb', organization_id: 't1', valid_from: null, valid_until: null, reason: 'leave' },
    ];
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    expect(req.pending_approvers).toContain('lb');
    expect(req.pending_approvers).not.toContain('l1');
    const a = await svc.decideNode(req.id, { decision: 'approve', actorId: 'lb' }, SYS); // delegate covers legal
    expect(a.finalized).toBe(false);
    const b = await svc.decideNode(req.id, { decision: 'approve', actorId: 'f1' }, SYS);
    expect(b.finalized).toBe(true);
  });

  it('records decision attachments on the audit row', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9', attachments: ['file_1', 'file_2'] }, SYS);
    const act = engine._tables['sys_approval_action'].find((a: any) => a.action === 'approve');
    expect(act.attachments).toEqual(['file_1', 'file_2']);
  });
});

// ── Decision progress + notification deep links (#2678 P1.5) ──────────
describe('ApprovalService — decision_progress & deep links (#2678 P1.5)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;

  beforeEach(() => {
    engine = makeFakeEngine();
    let n = 0;
    const base = new Date('2026-09-01T09:00:00Z').getTime();
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(base + (n++) * 1000) } });
  });

  const cfg = (approvers: any[], behavior: string, extra: Record<string, any> = {}) => ({
    ...openInput([]),
    config: { approvers, behavior, lockRecord: true, ...extra },
  });
  const U = (v: string, group?: string) => (group ? { type: 'user', value: v, group } : { type: 'user', value: v });

  it('per_group: getRequest exposes per-group progress that updates per approval', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    let row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toMatchObject({ behavior: 'per_group', got: 0, need: 2 });
    expect(row.decision_progress.groups).toEqual([
      { group: 'finance', got: 0, need: 1, satisfied: false },
      { group: 'legal', got: 0, need: 1, satisfied: false },
    ]);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    row = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress.got).toBe(1);
    expect(row.decision_progress.groups.find((g: any) => g.group === 'legal')).toMatchObject({ got: 1, satisfied: true });
    expect(row.decision_progress.groups.find((g: any) => g.group === 'finance')).toMatchObject({ got: 0, satisfied: false });
  });

  it('per_group: pending_approver_groups maps each pending approver to its group (objectui#2807)', async () => {
    const req = await svc.openNodeRequest(cfg([U('l1', 'legal'), U('f1', 'finance')], 'per_group'), CTX);
    let row: any = await svc.getRequest(req.id, SYS);
    // Every pending slot is labeled with the group it fills.
    expect(row.pending_approver_groups).toEqual({ l1: ['legal'], f1: ['finance'] });
    // Once legal signs off, l1 drops out of pending — and out of the map.
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'l1' }, SYS);
    row = await svc.getRequest(req.id, SYS);
    expect(row.pending_approver_groups).toEqual({ f1: ['finance'] });
  });

  it('per_group with unnamed groups omits synthetic keys; non-per_group omits the map (objectui#2807)', async () => {
    // Distinct (record, run) so the two opens aren't a duplicate-pending clash.
    const mk = (approvers: any[], behavior: string, recordId: string, runId: string, extra: Record<string, any> = {}) => ({
      ...openInput([], { recordId, runId }),
      config: { approvers, behavior, lockRecord: true, ...extra },
    });
    // Unnamed approvers → synthetic `#N` group keys, which are not surfaced.
    const unnamed = await svc.openNodeRequest(mk([U('u1'), U('u2')], 'per_group', 'opp_u', 'run_u'), CTX);
    const uRow: any = await svc.getRequest(unnamed.id, SYS);
    expect(uRow.pending_approver_groups).toBeUndefined();
    // Quorum aggregates approvals, not groups — no approver→group map.
    const q = await svc.openNodeRequest(mk([U('a1'), U('a2')], 'quorum', 'opp_q', 'run_q', { minApprovals: 2 }), CTX);
    const qRow: any = await svc.getRequest(q.id, SYS);
    expect(qRow.pending_approver_groups).toBeUndefined();
  });

  it('quorum: progress reports approvals against the clamped threshold', async () => {
    const req = await svc.openNodeRequest(cfg([U('u1'), U('u2'), U('u3')], 'quorum', { minApprovals: 2 }), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u1' }, SYS);
    const row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toMatchObject({ behavior: 'quorum', got: 1, need: 2 });
  });

  it('first_response: no decision_progress', async () => {
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    const row: any = await svc.getRequest(req.id, SYS);
    expect(row.decision_progress).toBeUndefined();
  });

  it('notify: inbox actionUrl is rewritten to a request deep link', async () => {
    const emitted: any[] = [];
    svc.attachMessaging({ async emit(input) { emitted.push(input); } });
    const req = await svc.openNodeRequest(openInput(['u1', 'u2']), CTX);
    await svc.reassign(req.id, { actorId: 'u1', to: 'u7' }, SYS);
    const note = emitted.find(e => e.topic === 'approval.reassigned');
    expect(note.payload.actionUrl).toBe(`/system/approvals?request=${encodeURIComponent(req.id)}`);
  });
});

// listActions must surface decision attachments through the contract mapping
// (#3266 — the column existed but rowFromAction dropped it; caught in browser).
describe('ApprovalService — listActions attachments mapping (#3266)', () => {
  it('normalizes a bare fileId string into an attachment descriptor', async () => {
    const engine = makeFakeEngine();
    let n = 0;
    const svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(1757000000000 + (n++) * 1000) } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9', attachments: ['file_a'] }, SYS);
    const acts = await svc.listActions(req.id, SYS);
    const approve = acts.find(a => a.action === 'approve');
    expect(approve?.attachments).toEqual([{ id: 'file_a' }]);
  });

  // The normal case. The column STORES an opaque sys_file id (ADR-0104 D3);
  // the ObjectQL read path resolves it into the expanded
  // `{ id, name, size, mimeType, url }` form on the way out. The old
  // `.map(String)` turned that object into "[object Object]", so the inbox chip
  // had no name and 404'd on open. The mapping must pass it through unmangled.
  it('passes the engine-expanded file value through with its name and url', async () => {
    const engine = makeFakeEngine();
    let n = 0;
    const svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(1757000000000 + (n++) * 1000) } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    // Simulate what the read path hands back after resolving the stored id.
    const row = engine._tables['sys_approval_action'].find((a: any) => a.action === 'approve');
    row.attachments = [
      { id: 'file_a', name: 'signed-contract.pdf', mimeType: 'application/pdf', size: 24, url: '/api/v1/storage/files/file_a' },
    ];
    const acts = await svc.listActions(req.id, SYS);
    const approve = acts.find(a => a.action === 'approve');
    expect(approve?.attachments).toEqual([
      { id: 'file_a', name: 'signed-contract.pdf', mimeType: 'application/pdf', size: 24, url: '/api/v1/storage/files/file_a' },
    ]);
  });

  // Rows written before file-as-reference hold an inline blob whose keys are
  // snake_case (`file_id`, `mime_type`). They stay readable until the backfill
  // converts them, so both casings must map — the same drift that made objectui
  // stop recognising images when the expanded form arrived.
  it('maps a legacy inline blob (file_id / mime_type) written before the cutover', async () => {
    const engine = makeFakeEngine();
    let n = 0;
    const svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(1757000000000 + (n++) * 1000) } });
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    const row = engine._tables['sys_approval_action'].find((a: any) => a.action === 'approve');
    row.attachments = [
      { file_id: 'file_b', name: 'old.pdf', mime_type: 'application/pdf', size: 12, url: 'https://cdn/old.pdf' },
    ];
    const acts = await svc.listActions(req.id, SYS);
    expect(acts.find(a => a.action === 'approve')?.attachments).toEqual([
      { id: 'file_b', name: 'old.pdf', mimeType: 'application/pdf', size: 12, url: 'https://cdn/old.pdf' },
    ]);
  });
});

// #3508: `queue` is declared-but-unenforced — resolveApproverSpec has no queue
// branch, so the spec value falls through to the dead `queue:<id>` literal.
// The engine must at least WARN so operators can see the silent dead slot;
// the spec marks the type non-authorable so designers stop offering it.
describe('ApprovalService — queue approver is unresolved (#3508)', () => {
  it('falls back to the dead literal and warns', async () => {
    const engine = makeFakeEngine();
    const warnings: any[] = [];
    let n = 0;
    const svc = new ApprovalService({
      engine: engine as any,
      clock: { now: () => new Date(1757000000000 + (n++) * 1000) },
      logger: { warn: (msg: any, meta: any) => warnings.push([msg, meta]) },
    });
    const req = await svc.openNodeRequest(
      { ...openInput([]), config: { approvers: [{ type: 'queue', value: 'q_west' }], behavior: 'first_response', lockRecord: false } },
      CTX,
    );
    // No queue expansion exists: the slot is the raw `type:value` literal,
    // which matches no real user id — the request routes to nobody.
    expect(req.pending_approvers).toEqual(['queue:q_west']);
    expect(warnings.some(([msg]) => String(msg).includes("'queue'") && String(msg).includes('#3508'))).toBe(true);
  });
});

// #3807 follow-up: `queue` was not the only way to end up with a slot nobody
// can act on — every GRAPH approver type falls back to the same literal when
// its lookup finds no one, and that fallback used to happen in total silence.
// A stuck approval was the first symptom; the log said nothing. The literal
// stays (15.x slots and substring fixtures depend on it) — it just announces
// itself now.
describe('ApprovalService — a graph approver that expands to nobody warns (#3807)', () => {
  const svcWithWarnings = (engine: any) => {
    const warnings: any[] = [];
    let n = 0;
    const svc = new ApprovalService({
      engine,
      clock: { now: () => new Date(1757000000000 + (n++) * 1000) },
      logger: { warn: (msg: any, meta: any) => warnings.push([msg, meta]) },
    });
    return { svc, warnings };
  };

  const approverInput = (type: string, value: string) => ({
    ...openInput([]),
    config: { approvers: [{ type, value }], behavior: 'first_response' as const, lockRecord: false },
  });

  it.each([
    ['team', 'team_gone'],
    ['department', 'bu_gone'],
    ['position', 'nobody_holds_this'],
    ['org_membership_level', 'member'],
  ])('%s: the dead literal is logged with its type, value and org', async (type, value) => {
    const engine = makeFakeEngine();
    const { svc, warnings } = svcWithWarnings(engine);
    const req = await svc.openNodeRequest(approverInput(type, value), CTX);

    expect(req.pending_approvers).toEqual([`${type}:${value}`]);
    const hit = warnings.find(([msg]) => String(msg).includes('expanded to nobody'));
    expect(hit, `no warning for ${type}`).toBeTruthy();
    expect(String(hit[0])).toContain('#3807');
    expect(hit[1]).toMatchObject({ type, value, organizationId: 't1' });
  });

  it('stays quiet when the graph DOES resolve someone', async () => {
    const engine = makeFakeEngine();
    engine._tables['sys_team_member'] = [{ id: 'tm1', team_id: 'team_ok', user_id: 'u5' }];
    const { svc, warnings } = svcWithWarnings(engine);
    const req = await svc.openNodeRequest(approverInput('team', 'team_ok'), CTX);

    expect(req.pending_approvers).toEqual(['u5']);
    expect(warnings.filter(([msg]) => String(msg).includes('expanded to nobody'))).toEqual([]);
  });

  it('stays quiet for `user` — a literal id was never a lookup that could come back empty', async () => {
    const engine = makeFakeEngine();
    const { svc, warnings } = svcWithWarnings(engine);
    const req = await svc.openNodeRequest(approverInput('user', 'u_unknown'), CTX);

    expect(req.pending_approvers).toEqual(['u_unknown']);
    expect(warnings.filter(([msg]) => String(msg).includes('expanded to nobody'))).toEqual([]);
  });
});

// ── File-access delegate (ADR-0104 D3 wave 2) ────────────────────────
//
// A decision attachment is OWNED by its `sys_approval_action` row, so the
// storage service would otherwise authorize the download by testing whether
// the caller can READ that row. It cannot — the table is closed to ordinary
// approver positions — which denied the very approver the attachment was filed
// for (reproduced in the browser against app-showcase). `sys_approval_action`
// therefore declares `fileAccessDelegate: 'approvals'` and the service answers,
// reusing the rule that already governs seeing a decision: visibility of the
// PARENT REQUEST, exactly as listActions applies it.
describe('ApprovalService — authorizeFileRead delegate (ADR-0104 D3 wave 2)', () => {
  const svcFor = (engine: any) => {
    let n = 0;
    return new ApprovalService({
      engine,
      clock: { now: () => new Date(1757000000000 + (n++) * 1000) },
    });
  };

  const seedDecision = async (engine: any) => {
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9', attachments: ['file_a'] }, SYS);
    const action = engine._tables['sys_approval_action'].find((a: any) => a.action === 'approve');
    return { svc, req, actionId: String(action.id) };
  };

  it('allows a caller who can see the parent request', async () => {
    const engine = makeFakeEngine();
    const { svc, actionId } = await seedDecision(engine);

    expect(await svc.authorizeFileRead(actionId, SYS)).toBe(true);
  });

  it('denies a caller who cannot see the parent request', async () => {
    const engine = makeFakeEngine();
    const { svc, actionId } = await seedDecision(engine);
    // getRequest is the single gate this delegates to — when it yields nothing
    // for this caller, the bytes must be refused too.
    vi.spyOn(svc as any, 'getRequest').mockResolvedValue(null);

    expect(await svc.authorizeFileRead(actionId, CTX)).toBe(false);
  });

  it('denies an unknown action id', async () => {
    const engine = makeFakeEngine();
    const { svc } = await seedDecision(engine);

    expect(await svc.authorizeFileRead('aact_does_not_exist', SYS)).toBe(false);
    expect(await svc.authorizeFileRead('', SYS)).toBe(false);
  });

  it('fails CLOSED when the lookup throws', async () => {
    const engine = makeFakeEngine();
    const { svc, actionId } = await seedDecision(engine);
    vi.spyOn(engine as any, 'find').mockRejectedValue(new Error('driver down'));

    expect(await svc.authorizeFileRead(actionId, SYS)).toBe(false);
  });

  it('sys_approval_action declares the delegate, so the storage gate asks the service', async () => {
    const { SysApprovalAction } = await import('./sys-approval-action.object.js');
    expect((SysApprovalAction as any).fileAccessDelegate).toBe('approvals');
  });
});

// ── Participant visibility (#3590) ───────────────────────────────────
//
// getRequest/listRequests deliberately query with SYSTEM_CTX (the
// approver-visibility rule spans identity forms RLS cannot model), but only
// the TENANT half of that rule was ever applied — so any authenticated user
// could read any request in their tenant, and after #3580 its decision
// attachments too. These lock in the participant half.
describe('ApprovalService — participant visibility (#3590)', () => {
  const svcFor = (engine: any) => {
    let n = 0;
    return new ApprovalService({ engine, clock: { now: () => new Date(1757000000000 + (n++) * 1000) } });
  };
  const asUser = (userId: string) => ({ userId, tenantId: 't1', positions: [], permissions: [] } as any);
  const ADMIN = { userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;

  it('the submitter and a pending approver can read it; a same-tenant stranger cannot', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX); // submitter u1, approver u9

    expect(await svc.getRequest(req.id, asUser('u1'))).not.toBeNull();
    expect(await svc.getRequest(req.id, asUser('u9'))).not.toBeNull();
    expect(await svc.getRequest(req.id, asUser('u_stranger'))).toBeNull();
  });

  it('someone who already acted keeps access after their slot moves on', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);

    // u9 is no longer a pending approver, but the decision is theirs — the
    // audit trail (and its attachments) must not vanish from under them.
    expect(await svc.getRequest(req.id, asUser('u9'))).not.toBeNull();
  });

  it('an override admin keeps the unrestricted view the console depends on', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    expect(await svc.getRequest(req.id, ADMIN)).not.toBeNull();
  });

  it('a tokenless context sees nothing — the gate fails closed', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    expect(await svc.getRequest(req.id, { tenantId: 't1', positions: [], permissions: [] } as any)).toBeNull();
  });

  it('listRequests no longer returns the whole tenant when no approverId filter is passed', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const mine = await svc.openNodeRequest(openInput(['u9']), CTX);            // submitter u1
    await svc.openNodeRequest(openInput(['u7'], { recordId: 'opp2', record: { id: 'opp2' } }), asUser('u_other')); // unrelated to u1

    // The old behaviour: omit approverId and receive every request in the
    // tenant. `approverId` is a filter, never authorization.
    const seen = await svc.listRequests(undefined, asUser('u1'));
    expect(seen.map(r => r.id)).toEqual([mine.id]);

    const strangerSees = await svc.listRequests(undefined, asUser('u_stranger'));
    expect(strangerSees).toEqual([]);

    // The admin console still sees everything.
    expect((await svc.listRequests(undefined, ADMIN)).length).toBeGreaterThanOrEqual(2);
  });

  it('countRequests agrees with the list it paginates', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    await svc.openNodeRequest(openInput(['u9']), CTX);
    await svc.openNodeRequest(openInput(['u7'], { recordId: 'opp2', record: { id: 'opp2' } }), asUser('u_other'));

    expect(await svc.countRequests(undefined, asUser('u_stranger'))).toBe(0);
    expect(await svc.countRequests(undefined, asUser('u1'))).toBe(1);
  });

  it('a write path still echoes back its own result to the user who made it', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    // Approving CLEARS `pending_approvers`, so the approver stops being a
    // participant the instant their own write lands. The operation authorized
    // itself; re-gating the echo would turn a successful write into a null
    // result for the very person who made it.
    const res = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, asUser('u9'));
    expect(res.request).not.toBeNull();
    expect(res.request.status).toBe('approved');
  });

  it('a service-to-service write echoes back too (no session at all)', async () => {
    const engine = makeFakeEngine();
    const svc = svcFor(engine);
    const req = await svc.openNodeRequest(openInput(['u9']), CTX);

    // Flow-driven resumes and the SLA sweep carry no user. Since #3800 that is
    // expressible only as a SYSTEM context — a user-less non-system caller can
    // no longer act by naming an approver.
    const res = await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expect(res.request).not.toBeNull();
    expect(res.request.status).toBe('approved');
  });
});

// ── The ordering invariant the dead-run sweep rests on (#3456) ─────────
//
// `releaseDeadRunRequests` recalls a PENDING request whose owning run has
// reached a TERMINAL state, on the premise that such a pair can only be an
// orphan. That premise is not self-evident — it holds only because every
// in-band transition moves the request OUT of `pending` before it hands the run
// back. Resume first and a run that finishes promptly afterwards would be
// indistinguishable from an orphan, so the sweep would cancel a LIVE approval —
// precisely the one failure mode it is built never to have.
//
// Nothing enforces that ordering: it is a convention spread across four public
// methods and seven resume/cancelRun call sites, any of which a refactor could
// reorder without a single existing test going red. So pin the invariant
// itself rather than the call order of any one method — at the instant the run
// is handed back, no request owned by that run may still be `pending`.
describe('in-band transitions finalise before they resume (#3456 invariant)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();
  /** One entry per hand-back, with any still-pending requests owned by the run. */
  let handoffs: Array<{ hook: string; stillPending: string[] }>;

  /** A flow whose approval node declares the `revise` out-edge send-back needs. */
  const REVISE_FLOW = {
    name: 'deal_approval',
    // The revise window must be the service-owned node type — `sendBack`
    // checks the edge's TARGET as well as its existence (#3823), so the stub
    // has to declare the node, not just the edge.
    nodes: [
      { id: 'approve_step', type: 'approval' },
      { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE },
    ],
    edges: [{ id: 'e_rev', source: 'approve_step', target: 'wait_revision', label: 'revise' }],
  };

  function recordHandoff(hook: string) {
    const rows = (engine._tables['sys_approval_request'] ?? []) as any[];
    handoffs.push({
      hook,
      stillPending: rows
        .filter(r => String(r.flow_run_id ?? '') === 'run_1' && r.status === 'pending')
        .map(r => String(r.id)),
    });
  }

  /** Assert every hand-back this scenario made was clean. */
  function expectCleanHandoffs() {
    expect(
      handoffs.length,
      'the run was never handed back — this scenario did not exercise the invariant',
    ).toBeGreaterThan(0);
    for (const h of handoffs) {
      expect(
        h.stillPending,
        `${h.hook}() handed run_1 back while it still owned a pending request — `
        + 'the dead-run sweep would treat that as an orphan and cancel a live approval',
      ).toEqual([]);
    }
  }

  beforeEach(async () => {
    engine = makeFakeEngine();
    n = 0;
    handoffs = [];
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    svc.attachAutomation({
      async resume() { recordHandoff('resume'); },
      async cancelRun() { recordHandoff('cancelRun'); },
      async getFlow() { return REVISE_FLOW; },
    } as any);
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
  });

  const open = (configExtra: Record<string, any> = {}) =>
    svc.openNodeRequest(openInput(['u9'], {}, configExtra), CTX);

  it('decide(approve) finalises before resuming', async () => {
    const req = await open();
    await svc.decide(req.id, { decision: 'approve', actorId: 'u9' }, SYS);
    expectCleanHandoffs();
  });

  it('decide(reject) finalises before resuming', async () => {
    const req = await open();
    await svc.decide(req.id, { decision: 'reject', actorId: 'u9' }, SYS);
    expectCleanHandoffs();
  });

  it('recall finalises before resuming', async () => {
    const req = await open();
    await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expectCleanHandoffs();
  });

  it('sendBack finalises before resuming', async () => {
    const req = await open();
    await svc.sendBack(req.id, { actorId: 'u9', comment: 'fix the totals' }, asUser('u9'));
    expectCleanHandoffs();
  });

  it('sendBack past the revision budget auto-rejects before resuming', async () => {
    // `maxRevisions: 0` takes the ADR-0044 loop-guard branch on the first
    // send-back — a separate resume site from the normal path above.
    const req = await open({ maxRevisions: 0 });
    const out = await svc.sendBack(req.id, { actorId: 'u9' }, asUser('u9'));
    expect(out.autoRejected, 'expected the auto-reject branch').toBe(true);
    expectCleanHandoffs();
  });

  it('recall inside the revise window cancels the run without a pending request', async () => {
    const req = await open();
    await svc.sendBack(req.id, { actorId: 'u9' }, asUser('u9'));
    handoffs = [];                                   // isolate the recall's own hand-back
    await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(handoffs.map(h => h.hook)).toContain('cancelRun');
    expectCleanHandoffs();
  });

  it('resubmit re-enters the node without leaving the old request pending', async () => {
    const req = await open();
    await svc.sendBack(req.id, { actorId: 'u9' }, asUser('u9'));
    handoffs = [];                                   // isolate the resubmit's own hand-back
    await svc.resubmit(req.id, { actorId: 'u1' }, CTX);
    expectCleanHandoffs();
  });
});

/**
 * #3783 — the status mirror names the human who caused the transition.
 *
 * The mirror write lands on the CUSTOMER's object, so it is what fires that
 * object's record-change flows. It has to stay `isSystem` (the record is locked
 * while its approval is live), but dropping the actor left every one of those
 * cascades with no trigger user — which #3760 now refuses outright, forcing
 * "when the invoice is approved, do X" to declare `runAs:'system'`.
 *
 * Each case therefore asserts BOTH halves: the elevation survives (or the lock
 * hook stops mirroring at all) and the identity is present.
 */
describe('status mirror identity (#3783)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let svc: ApprovalService;
  let n = 0;
  const baseTime = new Date('2026-01-15T10:00:00Z').getTime();

  const REVISE_FLOW = {
    name: 'deal_approval',
    // The revise window must be the service-owned node type — `sendBack`
    // checks the edge's TARGET as well as its existence (#3823), so the stub
    // has to declare the node, not just the edge.
    nodes: [
      { id: 'approve_step', type: 'approval' },
      { id: 'wait_revision', type: APPROVAL_REVISE_NODE_TYPE },
    ],
    edges: [{ id: 'e_rev', source: 'approve_step', target: 'wait_revision', label: 'revise' }],
  };

  /** The context the service presented on the mirror write, or undefined. */
  const mirrorContext = () =>
    engine._writes.filter(w => w.object === 'opportunity').at(-1)?.context as any;

  const open = (configExtra: Record<string, any> = {}, ctx: any = CTX) =>
    svc.openNodeRequest(openInput(['u9'], {}, { approvalStatusField: 'approval_status', ...configExtra }), ctx);

  beforeEach(() => {
    engine = makeFakeEngine();
    n = 0;
    svc = new ApprovalService({ engine: engine as any, clock: { now: () => new Date(baseTime + (n++) * 1000) } });
    svc.attachAutomation({
      async resume() {},
      async cancelRun() {},
      async getFlow() { return REVISE_FLOW; },
    } as any);
    engine._tables['opportunity'] = [{ id: 'opp1', amount: 100 }];
  });

  it('submit: mirrors as the submitter, still elevated', async () => {
    await open();
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u1' });
  });

  it('decide: mirrors as the deciding user', async () => {
    const req = await open();
    const approver = { ...CTX, userId: 'u9' };
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, approver as any);
    expect(engine._tables['opportunity'][0].approval_status).toBe('approved');
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u9' });
  });

  it('recall: mirrors as the recalling user', async () => {
    const req = await open();
    await svc.recall(req.id, { actorId: 'u1' }, CTX);
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u1' });
  });

  it('sendBack: mirrors as the approver who returned it', async () => {
    const req = await open();
    const approver = { ...CTX, userId: 'u9' };
    await svc.sendBack(req.id, { actorId: 'u9', comment: 'redo the totals' }, approver as any);
    expect(engine._tables['opportunity'][0].approval_status).toBe('returned');
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u9' });
  });

  it('sendBack past the revision budget: the auto-reject mirror names the approver too', async () => {
    const req = await open({ maxRevisions: 0 });
    const approver = { ...CTX, userId: 'u9' };
    const out = await svc.sendBack(req.id, { actorId: 'u9' }, approver as any);
    expect(out.autoRejected, 'expected the auto-reject branch').toBe(true);
    expect(engine._tables['opportunity'][0].approval_status).toBe('rejected');
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u9' });
  });

  it('action link: mirrors as the approver the token is bound to', async () => {
    // ADR-0043 email approval — no session at all, but the single-use hashed
    // token names exactly one approver, and `resolveActionToken` has just
    // re-checked they still hold a pending slot. That IS an authenticated act.
    const req = await open();
    const { approve } = await svc.issueActionTokens(req.id, 'u9');
    expect(await svc.redeemActionToken(approve)).toMatchObject({ ok: true });
    expect(mirrorContext()).toMatchObject({ isSystem: true, userId: 'u9' });
  });

  it('never takes the identity from the caller-supplied actorId', async () => {
    // `actorId` arrives in the REST body (`body.actorId ?? context.userId`).
    // #3783 kept it out of the mirror identity; #3800 then stopped it from
    // reaching the slate check too, so borrowing a slot holder's identity now
    // fails outright rather than merely mislabelling the write. The mirror is
    // the second line here, not the first — assert both, so neither can regress
    // silently behind the other.
    const req = await open();
    const someoneElse = { ...CTX, userId: 'intruder' };
    await expect(
      svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, someoneElse as any),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(engine._tables['opportunity'][0].approval_status).toBe('pending');
    expect(mirrorContext()?.userId).not.toBe('u9');
  });

  it('SLA auto-decision: stays user-less — no human did it', async () => {
    const req = await open({ escalation: { timeoutHours: 1, action: 'auto_approve', notifySubmitter: false } });
    const raw = engine._tables['sys_approval_request'].find((r: any) => r.id === req.id)!;
    raw.created_at = new Date(baseTime - 3 * 60 * 60 * 1000).toISOString();
    await svc.runEscalations();
    expect(engine._tables['opportunity'][0].approval_status).toBe('approved');
    // `system:sla` is a reserved audit actor, not a user — it must never be
    // presented as one. The cascade stays user-less on purpose; a flow that
    // wants to react to an SLA auto-decision declares runAs:'system'.
    expect(mirrorContext()?.userId).toBeUndefined();
    expect(mirrorContext()).toMatchObject({ isSystem: true });
  });

  it('dead-run sweep: stays user-less — no human did it', async () => {
    await open();
    svc.attachAutomation({ getRun: async () => ({ status: 'failed' }) } as any);
    expect(await svc.releaseDeadRunRequests()).toMatchObject({ released: 1 });
    expect(engine._tables['opportunity'][0].approval_status).toBe('recalled');
    expect(mirrorContext()?.userId).toBeUndefined();
    expect(mirrorContext()).toMatchObject({ isSystem: true });
  });

  it('carries the actor WITHOUT org-scoping the write', async () => {
    // `tenantId` on an ExecutionContext is a driver-scoping knob, not
    // attribution: ObjectQL turns it into a tenant predicate on the update. The
    // submitter's org (`t1` on CTX) must therefore not ride along, or the mirror
    // would silently no-op on a record whose org differs from the request's.
    await open();
    expect(mirrorContext()).not.toHaveProperty('tenantId');
    expect(mirrorContext()).not.toHaveProperty('organizationId');
  });
});
