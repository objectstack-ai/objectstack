// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An admin override of a STAFFED approver slate is recorded as an override (#4466).
 *
 * The reproduction is the issue's: `showcase_dynamic_approval` stage 2 resolved
 * its `expression` approvers correctly to exactly one designated user, and the
 * admin — who was not in that slate — approved it anyway through the #3424
 * privileged path. The designated approver then got `409 INVALID_STATE`.
 *
 * The override itself is defensible; what was not is the audit trail. Before
 * this, `sys_approval_action` had no override column at all, so an admin
 * overriding a properly-staffed slate wrote a row byte-for-byte identical to the
 * designated approver approving normally. A reader of the timeline saw `approve`
 * by the admin and could not tell which had happened, and the bypassed
 * approver's 409 was the only trace — existing only if they happened to try.
 *
 * The platform KNOWS at decision time: it took the `isOverrideActor` branch to
 * admit the call. This was dropped information, not unavailable information.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApprovalService } from './approval-service.js';

interface FakeRow { [k: string]: any }

/** The same minimal engine shape `approval-service.test.ts` uses. */
function makeFakeEngine() {
  const tables: Record<string, FakeRow[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: FakeRow, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some(sub => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported filter operator ${k}`);
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    async find(object: string, options?: any) {
      const rows = ensure(object).filter(r => matches(r, options?.filter ?? options?.where));
      if (options?.orderBy?.[0]) {
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
    async insert(object: string, data: any) { ensure(object).push({ ...data }); return { ...data }; },
    async update(object: string, idOrData: any, _opts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : _opts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const table = ensure(object);
      const i = table.findIndex(r => r.id === id);
      if (i >= 0) table[i] = { ...table[i], ...data };
      return table[i];
    },
    async delete(object: string, options?: any) {
      const table = ensure(object);
      const i = table.findIndex(r => r.id === (options?.where?.id ?? options?.id));
      if (i >= 0) table.splice(i, 1);
      return {};
    },
    registerHook() {}, unregisterHooksByPackage() { return 0; }, async fire() {},
  };
}

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
const SUBMITTER = { userId: 'u1', tenantId: 't1', positions: [], permissions: [] } as any;
/** The designated approver the slate actually names. */
const DESIGNATED = { userId: 'u9', tenantId: 't1', positions: [], permissions: [] } as any;
/** An admin who is NOT in the slate — the issue's actor. */
const ADMIN = { userId: 'root', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;
/** An admin who IS a designated approver — approving normally, not overriding. */
const ADMIN_ON_SLATE = { userId: 'u9', tenantId: 't1', positions: [], permissions: ['admin_full_access'] } as any;

describe('approval override audit marker (#4466)', () => {
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

  /** A request whose slate is properly STAFFED — one real, designated user. */
  const staffedInput = (extra: Record<string, any> = {}) => ({
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'co_sign',
    flowName: 'showcase_dynamic_approval',
    config: {
      approvers: [{ type: 'user' as const, value: 'u9' }],
      behavior: 'first_response' as const, lockRecord: true,
    },
    record: { id: 'opp1', amount: 100 },
    ...extra,
  });

  it('the repro: the slate names exactly one designated user, and the admin is not on it', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    expect(req.pending_approvers).toEqual(['u9']);
    expect(req.pending_approvers).not.toContain('root');
  });

  it('marks an admin override of a STAFFED slate as `via_override`', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'root', comment: 'not mine' }, ADMIN);

    const acts = await svc.listActions(req.id, SYS);
    const decision = acts.at(-1)!;
    expect(decision).toMatchObject({ action: 'approve', actor_id: 'root', comment: 'not mine' });
    // The bit the audit trail used to drop entirely.
    expect(decision.via_override).toBe(true);
  });

  it('does NOT mark the designated approver’s own approval', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, DESIGNATED);

    const decision = (await svc.listActions(req.id, SYS)).at(-1)!;
    expect(decision).toMatchObject({ action: 'approve', actor_id: 'u9' });
    // An explicit `false`, not absent: "checked, and it was not an override" is
    // a different claim from a legacy row's "not recorded".
    expect(decision.via_override).toBe(false);
  });

  it('does NOT mark an admin who is ALSO a designated approver — that is an ordinary approval', async () => {
    // The marker is about which BRANCH admitted the call, not about whether the
    // actor happens to hold admin rights. Collapsing the two would make every
    // admin's ordinary decision read as a slate bypass.
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.decideNode(req.id, { decision: 'approve', actorId: 'u9' }, ADMIN_ON_SLATE);

    expect((await svc.listActions(req.id, SYS)).at(-1)!.via_override).toBe(false);
  });

  it('marks an override REJECTION too — the direction of the decision is irrelevant', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.decideNode(req.id, { decision: 'reject', actorId: 'root' }, ADMIN);

    const decision = (await svc.listActions(req.id, SYS)).at(-1)!;
    expect(decision).toMatchObject({ action: 'reject', via_override: true });
  });

  it('the override and the ordinary approval are no longer identical rows', async () => {
    // The issue's core claim, asserted directly: before the column, these two
    // decisions differed only in `actor_id` — and an `actor_id` alone cannot
    // answer "were they entitled to?".
    const a = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.decideNode(a.id, { decision: 'approve', actorId: 'root' }, ADMIN);
    const overrideRow = (await svc.listActions(a.id, SYS)).at(-1)!;

    const b = await svc.openNodeRequest(
      staffedInput({ recordId: 'opp2', runId: 'run_2', record: { id: 'opp2', amount: 100 } }),
      SUBMITTER,
    );
    await svc.decideNode(b.id, { decision: 'approve', actorId: 'u9' }, DESIGNATED);
    const normalRow = (await svc.listActions(b.id, SYS)).at(-1)!;

    expect(overrideRow.action).toBe(normalRow.action);
    expect(overrideRow.via_override).not.toBe(normalRow.via_override);
  });

  it('marks an admin RESCUE reassign of a slate they hold no slot in', async () => {
    // #3424's other privileged action: handing a stuck (or staffed) request to
    // a real approver. Same fact, same column.
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.reassign(req.id, { actorId: 'root', to: 'u7' }, ADMIN);

    const row = (await svc.listActions(req.id, SYS)).at(-1)!;
    expect(row).toMatchObject({ action: 'reassign', reassign_to: 'u7', via_override: true });
  });

  it('does NOT mark a slot holder handing over their own slot', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    await svc.reassign(req.id, { actorId: 'u9', to: 'u7' }, DESIGNATED);

    expect((await svc.listActions(req.id, SYS)).at(-1)!.via_override).toBe(false);
  });

  it('a legacy row (written before the column existed) reads as UNRECORDED, not as "not an override"', async () => {
    const req = await svc.openNodeRequest(staffedInput(), SUBMITTER);
    // Simulate a row persisted by an older build: the column is simply absent.
    const rows = engine._tables['sys_approval_action'];
    delete rows[rows.length - 1].via_override;

    const row = (await svc.listActions(req.id, SYS)).at(-1)!;
    expect(row.via_override).toBeUndefined();
    expect(row.via_override).not.toBe(false);
  });
});
