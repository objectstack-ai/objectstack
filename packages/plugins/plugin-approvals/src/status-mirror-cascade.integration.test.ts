// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3783 — an approval decision cascades as the deciding user.
 *
 * "When the invoice is approved, do X" is the single most natural approvals
 * automation there is, and until now it could not be written the obvious way.
 * The status mirror — the write that puts `approved` on the business record, and
 * therefore the write that fires that object's record-change flows — presented a
 * bare `{ isSystem: true }` context with no `userId`. `isSystem` does not
 * suppress trigger dispatch, so the flow DID fire; it just fired with no trigger
 * user, and since #3760 a `runAs:'user'` run with no trigger user has its data
 * operations refused. Authors were pushed to declare `runAs:'system'` — blanket
 * elevation — for a case where a perfectly good scoped identity existed all
 * along, sitting right there at the call site.
 *
 * The seam is invisible in a unit test of any single hop, so this one refuses to
 * stub any of them: a real {@link ObjectKernel} with the real ObjectQL engine,
 * the real record-change trigger, the real automation engine, and the real
 * {@link ApprovalService}. The mirror is produced by an actual decision, not
 * hand-written.
 *
 * The negative case is load-bearing, not decoration. It fires the SAME flow off
 * the dead-run sweep's mirror, which has no human behind it and stays user-less
 * on purpose — and shows it is still refused. Without it, the positive case
 * would prove only that the flow runs, never that it runs *because* the identity
 * arrived.
 *
 * The record lock is deliberately not bound here: it is a separate concern with
 * its own end-to-end coverage (`record-lock-schedule-run.integration.test.ts`).
 *
 * Backend note (#5704 批次 3 / #5785): "refuses to stub any of them" used to
 * stop one layer short — the store was a hand-written Map behind the real
 * kernel. It is now `@objectstack/driver-sql` + better-sqlite3 `:memory:`, so
 * the mirror write, the cascading flow's `update_record`, and the audit stamp
 * this file reads back all land in a real table.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { ApprovalService } from './approval-service.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';
import { SysApprovalApprover } from './sys-approval-approver.object.js';
// [#11081] `@objectstack/runtime`'s shared expected-noise capture. This import
// escapes the package on PURPOSE, so it is DECLARED rather than left for CI to
// discover: `CROSS_PACKAGE_TEST_INPUTS` in
// `scripts/check-cross-package-test-inputs.mjs` names the one file, and
// `@objectstack/plugin-approvals#test` in `turbo.json` hashes the same path so
// the cache moves with it. The radius is that ONE file rather than
// `packages/runtime/src/**` (what `plugin-auth` and `dogfood` declare) because
// the helper imports nothing — it is the whole read.
import { captureExpectedReadRefusals } from '../../../runtime/src/expected-read-refusal-noise.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * [#11081] The tables this fixture deliberately never provisions — and so the
 * ONLY read refusals whose log frames may be withheld here.
 *
 * `beforeEach` boots a kernel with no datasource and attaches sqlite late, then
 * syncs exactly four objects. Every approval decision below therefore probes
 * the six authz tables `resolveUserAuthzGrants` reads plus
 * `sys_approval_delegation`, which `ApprovalService.lookupActiveDelegation`
 * reads best-effort on each decision. All are fail-soft, so the reads are
 * EXPECTED — but the driver and the engine each log the fault on the way out.
 *
 * ⛔ MEASURED, not copied from the probers' source: a run of this file at
 * `logger: { level: 'info' }` emitted 25 `refused a read on '<t>'` driver lines
 * and 25 matching `ERROR Find operation failed` engine frames — sys_user 5 /
 * sys_member 4 / sys_position 4 / sys_user_position 4 /
 * sys_user_permission_set 4 / sys_organization 2 / sys_approval_delegation 2.
 *
 * ## Why a capture instead of the blanket `silent` this replaces
 *
 * `logger: { level: 'silent' }` stays — it is the key `ObjectKernelConfig`
 * actually reads, and it is what keeps this file's ~186 INFO and ~12 WARN
 * frames out of the shared shard log. What it cannot do is tell the 25 expected
 * refusals apart from a 26th that means something. The capture withholds only a
 * line naming one of these tables AND carrying that same table's `no such
 * table` reason, forwards every other driver fault to the real console, and
 * COUNTS what it withheld so `afterAll` can assert the expected reads still
 * happen. A capture nobody asserts is a mute.
 */
const EXPECTED_ABSENT_PROBE_TABLES = [
  'sys_user',
  'sys_member',
  'sys_user_position',
  'sys_user_permission_set',
  'sys_position',
  'sys_organization',
  'sys_approval_delegation',
] as const;

/** [#11081] Shared by both kernels this file boots; asserted once in `afterAll`. */
const noise = captureExpectedReadRefusals([...EXPECTED_ABSENT_PROBE_TABLES]);

/**
 * [#11081] The PIN half. ⛔ Repairing a failure here means re-deriving the list
 * above or finding out why a probe stopped firing — NEVER deleting the channel.
 * In particular a silent `sys_approval_delegation` means the out-of-office
 * delegation lookup stopped running on a decision, which is a finding.
 */
afterAll(() => {
  expect(noise.silentChannels()).toEqual([]);
});

const SUBMITTER = { userId: 'submitter', positions: [], permissions: [] } as any;
const APPROVER = { userId: 'approver', positions: [], permissions: [] } as any;

/**
 * The real backend: better-sqlite3 `:memory:` through `@objectstack/driver-sql`,
 * built the canonical way (`examples/app-crm`, `cli db clean`, PR #5715).
 */
function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const opportunity = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    amount: { name: 'amount', label: 'Amount', type: 'number' },
    approval_status: { name: 'approval_status', label: 'Approval Status', type: 'text' },
    cascaded: { name: 'cascaded', label: 'Cascaded', type: 'text' },
  },
};

/**
 * The automation an author actually wants to write: react to the approval, no
 * `runAs` — the spec default `'user'`. That default is the whole point; a flow
 * forced to say `runAs:'system'` to work at all is the bug being fixed.
 */
const onApprovedFlow = {
  name: 'on_approved',
  label: 'On Approved',
  type: 'record_change',
  nodes: [
    {
      id: 'start', type: 'start', label: 'Start',
      config: {
        objectName: 'opportunity',
        triggerType: 'record-after-update',
        // Fires on BOTH terminal mirrors, so the two cases below differ only in
        // whether the mirror that fired it carried a user — nothing else.
        condition: "approval_status == 'approved' || approval_status == 'recalled'",
      },
    },
    {
      id: 'stamp', type: 'update_record', label: 'Stamp',
      config: { objectName: 'opportunity', filter: { id: '{record.id}' }, fields: { cascaded: 'yes' } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'stamp' },
    { id: 'e2', source: 'stamp', target: 'end' },
  ],
};

const nodeConfig = {
  approvers: [{ type: 'user' as const, value: 'approver' }],
  behavior: 'first_response' as const,
  lockRecord: false,
  approvalStatusField: 'approval_status',
};

describe('an approval decision cascades as the deciding user (#3783)', () => {
  let data: any;
  let svc: ApprovalService;
  let engine: any;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService('objectql') as any;
    engine = objectql;
    data = kernel.getService('data') as any;
    const automation = kernel.getService<AutomationEngine>('automation');

    // The engine's own `init()` ran during bootstrap, before this driver
    // existed, so the connect the engine would have done is done here.
    const driver = makeSqliteDriver();
    // [#11081] Before `connect()` — i.e. before the driver runs any statement.
    // The sink also RESTORES a loud channel: an unexpected driver fault reaches
    // the real console from here even though the kernel logger is `silent`.
    noise.captureDriver(driver);
    await driver.connect();
    objectql.registerDriver(driver, true);
    noise.captureEngine(objectql);
    for (const def of [opportunity, SysApprovalRequest, SysApprovalAction, SysApprovalApprover]) {
      objectql.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
    }
    // Real DDL for all four objects — including the three sys_approval_* tables
    // the ApprovalService writes through.
    await objectql.syncSchemas();
    automation.registerFlow('on_approved', onApprovedFlow as any);

    svc = new ApprovalService({ engine: objectql });
    await data.insert('opportunity', { id: 'opp1', amount: 100 }, { context: { isSystem: true } });
  });

  const readBack = () => data.findOne('opportunity', { where: { id: 'opp1' } });

  const openRequest = () => svc.openNodeRequest({
    object: 'opportunity', recordId: 'opp1', runId: 'run_1', nodeId: 'approve_step',
    flowName: 'deal_approval', config: nodeConfig, submitterId: 'submitter',
    record: { id: 'opp1', amount: 100 },
  }, SUBMITTER);

  it('the approve mirror hands the flow a trigger user, so its data node runs', async () => {
    const req = await openRequest();
    await svc.decide(req.id as string, { decision: 'approve', actorId: 'approver' }, APPROVER);
    await sleep(300);

    const row = await readBack();
    expect(row?.approval_status, 'the mirror itself must still land').toBe('approved');
    // Before #3783 this stayed undefined: the run inherited no trigger user, so
    // `resolveRunDataContext` refused its `update_record` outright.
    expect(row?.cascaded).toBe('yes');
    // ObjectQL's audit stamp is gated on the write context's `userId` alone —
    // `isSystem` buys no exemption — so this is direct evidence the elevated
    // mirror named a user rather than nobody.
    expect(row?.updated_by).toBe('approver');
  });

  it('a dead-run release cascades user-less, and is still refused', async () => {
    await openRequest();
    svc.attachAutomation({ getRun: async () => ({ status: 'failed' }) } as any);
    await svc.releaseDeadRunRequests();
    await sleep(300);

    const row = await readBack();
    expect(row?.approval_status, 'the sweep must still release the record').toBe('recalled');
    // No human abandoned this request — a sweep did. The cascade therefore has
    // no identity to inherit and stays refused; an author who wants to react to
    // a dead-run release declares `runAs:'system'` and means it.
    expect(row?.cascaded).toBeFalsy();
  });
});
