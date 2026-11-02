// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28786] A `save_notice` node ahead of an `approval` node, across a real
 * persisted suspension.
 *
 * ## What is claimed (#28251)
 *
 * The record-change trigger hands a record-triggered run the triggering
 * write's notice channel (`AutomationContext.saveNotice`). A `save_notice`
 * node BEFORE the approval sets the sentence on that write's answer. The
 * approval then suspends the run, the run state is persisted as JSON in
 * `sys_automation_run`, and the decision resumes it from there. JSON keeps the
 * channel's `locale` and drops its `set` function, so a `save_notice` node on
 * the resumed leg finds no channel and is refused by name: there is no write
 * left to answer.
 *
 * [#28806] A `save_notice` that a suspending node reaches on the flow's own
 * graph is now refused at the parse, so the resumed leg is reached through a
 * `subflow` that asks the approval: the parse cannot see that a subflow
 * pauses (it does only when its child does), so that is where the run-time
 * refusal is still the guard. The parse refusal itself is pinned at
 * `registerFlow` in the second case.
 *
 * The executor's own suite pins the run-time refusal with a hand-built
 * context. This suite pins it through the real round trip, so a store that
 * started keeping (or re-binding) the channel, or an engine that resumed from
 * an in-memory copy instead of the store, is caught here.
 *
 * ## The rig
 *
 * A real kernel: `ObjectQLPlugin` over `SqlDriver` (better-sqlite3, in memory,
 * real DDL), `AutomationServicePlugin` with its default (`'auto'`) durable store
 * (`ObjectStoreSuspendedRunStore` over `sys_automation_run`, which the plugin
 * registers), and `RecordChangeTriggerPlugin`. The real `ApprovalService` is
 * attached to the real automation engine behind the real approval node, so the
 * decision resumes the run the way a deployment does. A resumed subflow parent
 * that fails makes the decision answer the approvals' existing subflow-parent
 * strand (#4420: `resumeFailure` names the parent run, `resumeError` its
 * refusal); that is existing behaviour, read here, not a new refusal.
 *
 * ## Coverage pin
 *
 * Ablated: with the executor's no-channel refusal replaced by a success, the
 * resumed-leg assertions go red (`save-notice-node.ts`), and are green again
 * once it is restored.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { registerApprovalNode } from './approval-node.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const SUBMITTER = 'u_sub';
const APPROVER = 'u_mgr';
const FLOW = 'deal_sent_for_approval';

const text = (name: string, label: string) => ({ name, label, type: 'text' as const });
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: { id: { ...text('id', 'Id'), primaryKey: true }, name: text('name', 'Name'), email: text('email', 'Email') },
};
const deal = {
  name: 'snr_deal',
  label: 'Deal',
  fields: { name: text('name', 'Name') },
};

/**
 * The shape #28251 documents: tell the saver it went for approval, then ask.
 *
 * [#28806] A `save_notice` that a suspending node reaches on the flow's own
 * graph is refused at the parse now, so the second notice cannot stand right
 * after the `approval` node any more (`DIRECT_AFTER` below is that refusal's
 * pin at `registerFlow`). The approval is asked in a SUBFLOW instead: a
 * `subflow` pauses only when its child does, which the parse cannot see, so
 * the graph is accepted, the parent suspends with its child, persists, and
 * resumes from storage when the decision completes the child. The resumed
 * parent leg is where the second `save_notice` meets the run-time refusal.
 */
const CHILD = 'deal_manager_review';
const child = {
  name: CHILD,
  label: 'Manager review',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'ask', type: 'approval', label: 'Manager', config: { approvers: [{ type: 'user', value: APPROVER }] } },
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'c1', source: 'start', target: 'ask' },
    { id: 'c2', source: 'ask', target: 'ok', label: 'approve' },
    { id: 'c3', source: 'ask', target: 'no', label: 'reject' },
  ],
};
const START = { id: 'start', type: 'start', label: 'Start', config: { objectName: deal.name, triggerType: 'record-after-create' } };
const TELL = { id: 'tell', type: 'save_notice', label: 'Tell', config: { message: 'Sent {{ record.name }} to your manager for approval' } };
const TELL_AFTER = { id: 'tell_after', type: 'save_notice', label: 'Tell again', config: { message: '{{ record.name }} was approved' } };
const flow = {
  name: FLOW,
  label: 'Deal sent for approval',
  type: 'record_change',
  nodes: [
    START,
    TELL,
    { id: 'review', type: 'subflow', label: 'Manager review', config: { flowName: CHILD } },
    TELL_AFTER,
    { id: 'ok', type: 'end', label: 'Done' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'tell' },
    { id: 'e2', source: 'tell', target: 'review' },
    { id: 'e3', source: 'review', target: 'tell_after' },
    { id: 'e4', source: 'tell_after', target: 'ok' },
  ],
};
/** The #28786 shape: the second notice right after the approval, on this flow's own graph. */
const DIRECT_AFTER = {
  name: 'deal_notice_after_approval',
  label: 'Deal notice after approval',
  type: 'record_change',
  nodes: [
    START,
    TELL,
    { id: 'ask', type: 'approval', label: 'Manager', config: { approvers: [{ type: 'user', value: APPROVER }] } },
    TELL_AFTER,
    { id: 'ok', type: 'end', label: 'Approved' },
    { id: 'no', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'tell' },
    { id: 'e2', source: 'tell', target: 'ask' },
    { id: 'e3', source: 'ask', target: 'tell_after', label: 'approve' },
    { id: 'e4', source: 'ask', target: 'no', label: 'reject' },
    { id: 'e5', source: 'tell_after', target: 'ok' },
  ],
};

/** The plugin's own object definitions, as its manifest registers them. */
async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

describe('[#28786] a save_notice before an approval answers the write, and one on the leg resumed from storage refuses by name', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let svc: ApprovalService;

  /** Every `sys_automation_run` row of the flow, live pause or terminal history. */
  const runRows = async (): Promise<any[]> =>
    ql.find('sys_automation_run', { where: { flow_name: FLOW }, context: SYSTEM } satisfies EngineQueryOptions);

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    const automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    for (const def of [sysUser, deal, ...(await packageObjects())]) {
      ql.registry.registerObject(def as any, 'save-notice-round-trip', 'save-notice-round-trip');
    }
    await ql.syncSchemas();
    await installDefaultOrganization(ql as never);
    for (const id of [SUBMITTER, APPROVER]) {
      await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYSTEM });
    }

    svc = new ApprovalService({ engine: ql as any, logger: silent });
    svc.attachAutomation(automation as any);
    registerApprovalNode(automation as any, svc, silent);
    automation.registerFlow(CHILD, child as any);
    automation.registerFlow(FLOW, flow as any);
  });

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  it('the create hears the sentence, the run is persisted without the channel, and the resumed save_notice refuses', async () => {
    // ── The write: the save_notice ahead of the approval answers it.
    const heard: unknown[] = [];
    const created: any = await ql.insert(
      deal.name,
      { name: 'Acme' },
      { context: { userId: SUBMITTER }, onNotice: (message: unknown) => { heard.push(message); } } as any,
    );
    expect(heard, "the create's own answer carried the notice").toEqual(['Sent Acme to your manager for approval']);

    // ── Suspended and persisted: one live row, its context stored as JSON.
    const [pause] = await runRows();
    expect(pause, 'the run suspended with its child and was persisted').toBeDefined();
    expect(pause.node_id).toBe('review');
    expect(pause.status, 'a live pause, not a terminal history row').toBe('paused');
    const stored = JSON.parse(String(pause.context_json));
    // What survives JSON: the channel object without its function.
    expect(stored.saveNotice === undefined || typeof stored.saveNotice === 'object').toBe(true);
    expect(typeof stored.saveNotice?.set, 'no function survives the persisted context').toBe('undefined');

    // ── The decision completes the child, which resumes the parent from the store.
    const [request] = await ql.find('sys_approval_request', {
      where: { record_id: created.id, status: 'pending' }, context: SYSTEM,
    } satisfies EngineQueryOptions);
    expect(request?.flow_node_id, "the child's approval node opened its request").toBe('ask');
    // The parent's resumed leg fails at its save_notice. The child's own run
    // resumed and completed, so the decision answers with the parent named as
    // the stranded run (the approvals' existing subflow-parent strand, #4420):
    // recorded, not thrown, and the parent's own refusal named in it.
    const answered: any = await svc.decide(request.id, { decision: 'approve', actorId: APPROVER }, asUser(APPROVER));
    expect([answered.finalized, answered.decision, answered.resumed]).toEqual([true, 'approve', true]);
    expect(answered.resumeFailure).toMatchObject({ code: 'RESUME_FAILED', runId: pause.id, status: 'stranded' });
    expect(String(answered.resumeError)).toContain("save_notice 'tell_after': this run holds no record write to answer");

    // ── The resumed leg's save_notice is refused by name, and nothing reaches the write.
    let terminal: any;
    for (let i = 0; i < 100 && !terminal; i++) {
      terminal = (await runRows()).find((r) => String(r.id) === `run_${pause.id}`);
      if (!terminal) await new Promise((r) => setTimeout(r, 20));
    }
    expect(terminal, 'the resumed parent left its history row').toBeDefined();
    expect((await runRows()).some((r) => r.id === pause.id), 'the live pause was consumed').toBe(false);
    expect(terminal.status).toBe('failed');
    expect(String(terminal.error)).toContain("save_notice 'tell_after': this run holds no record write to answer");
    expect(heard, 'the resumed leg set nothing on the answer already sent').toEqual(['Sent Acme to your manager for approval']);
  }, 20000);

  it('[#28806] the same notice right after the approval on the flow\'s own graph is refused at registerFlow, naming the approval', () => {
    const automation = kernel.getService<AutomationEngine>('automation');
    let thrown: unknown;
    try {
      automation.registerFlow(DIRECT_AFTER.name, DIRECT_AFTER as any);
    } catch (err) {
      thrown = err;
    }
    expect(String((thrown as Error | undefined)?.message)).toContain(
      "This one is reached after `approval` node 'ask' suspends the run.",
    );
  });
});
