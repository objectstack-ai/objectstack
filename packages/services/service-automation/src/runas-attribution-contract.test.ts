// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The prose-to-code tie for `AutomationContext.flowName`'s attribution
 * contract — the one sentence a reader is most likely to act on, pinned
 * against the behaviour it describes.
 *
 * WHAT IT DEFENDS. `packages/spec/src/contracts/automation-service.ts`
 * (`AutomationContext.flowName`, published as `dist/contracts/index.d.ts`)
 * used to say a `runAs:'system'` run "resolves no user", so the
 * `svc:flow:<flowName>` actor label stands in for the audit row's
 * attribution. That reads as **"system elevation costs you the operator in
 * the audit trail"**, and it is not what ships: since #5494 elevation decides
 * AUTHORIZATION and leaves ATTRIBUTION alone — `resolveRunDataContext`
 * carries the triggering user through unchanged. The `svc:flow:` label is the
 * FALLBACK for a run that genuinely has no operator (a schedule).
 *
 * WHY A TEST AND NOT ONLY A DOC FIX. The cost of that sentence was never
 * cosmetic: downstream it was written into an adjudication as the explicit
 * STOP CONDITION for a security design ("if elevation erases the operator,
 * stop and report a fork"). A correct design was one measurement away from
 * being abandoned on a false premise. A doc fix alone leaves the next drift
 * silent, so the invariant the prose now states is asserted here: if the code
 * ever becomes what the old prose described, this file goes red instead of a
 * human having to re-measure.
 *
 * WHERE IT ASSERTS. At the END of the chain — the envelope the audit writers
 * actually read — not at `resolveRunDataContext`'s return shape, which
 * `builtin/crud-runas.test.ts` already pins:
 *
 *  - `packages/objectql/src/plugin.ts` `sys_stamp_audit_insert` /
 *    `sys_stamp_audit_update` stamp `created_by` / `updated_by` under
 *    `if (session?.userId)` — no `isSystem` test anywhere in that path;
 *  - `packages/plugins/plugin-audit/src/audit-writers.ts` records
 *    `session.userId ?? session.actor` on `sys_audit_log.actor` — the
 *    fallback, in that order.
 *
 * The hook session captured below IS that envelope (ObjectQL's
 * `buildSession` propagates `userId`, `isSystem` and `actor` into it), so the
 * two limbs are measured where the prose's claim lands.
 *
 * Directions decided before running (reverse-verification discipline):
 *  - elevated + user-triggered → `updated_by` / `created_by` = the triggering
 *    user, identical to the same write under a plain user context;
 *  - elevated + genuinely user-less (schedule shape) → user column stays
 *    NULL and `session.actor` is `svc:flow:<flowName>` (ADR-0118 D1 forbids a
 *    sentinel or pseudo-user in the user column).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

/** Real backend: better-sqlite3 `:memory:` through driver-sql. */
function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/**
 * A plain business object. The audit family (`created_by` / `updated_by`) is
 * NOT declared — the registry injects it (`applySystemFields`), exactly like a
 * production app object, so the stamps land on the injected platform columns.
 */
const crmTask = {
  name: 'crm_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** The trigger envelope a manual / record-change firing supplies: a real user. */
const OPERATOR = {
  userId: 'usr_operator',
  tenantId: 'org_1',
  positions: [] as string[],
  permissions: [] as string[],
};

/**
 * A DIFFERENT user, who creates the rows the operator later touches.
 *
 * Load-bearing, and the reverse-verification found out why: seeded by the
 * operator instead, both rows already carry `updated_by = 'usr_operator'` from
 * their own insert, so the column assertion below stays green even when
 * elevation drops the operator — it would be asserting the insert, not the
 * elevated update. Seeded by someone else, the column has to MOVE for the
 * assertion to pass, which is the claim being made.
 */
const CREATOR = {
  userId: 'usr_creator',
  tenantId: 'org_1',
  positions: [] as string[],
  permissions: [] as string[],
};

/** start → update_record(crm_task, id) → end, under runAs:'system'. */
const elevatedUpdateFlow = (name: string, recordId: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'touch',
      type: 'update_record',
      label: 'Touch',
      config: { objectName: 'crm_task', filter: { id: recordId }, fields: { status: 'done' } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'touch' },
    { id: 'e2', source: 'touch', target: 'end' },
  ],
});

/** start → create_record(crm_task) → end, under runAs:'system'. */
const elevatedCreateFlow = (name: string, title: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'mk',
      type: 'create_record',
      label: 'Create',
      config: { objectName: 'crm_task', fields: { title, status: 'open' } },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'mk' },
    { id: 'e2', source: 'mk', target: 'end' },
  ],
});

/** The three fields every audit writer keys on, as the hook layer sees them. */
interface SeenSession {
  event: string;
  isSystem: boolean | undefined;
  userId: string | undefined;
  actor: string | undefined;
}

describe("runAs:'system' attribution contract — elevation decides authorization, not attribution", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let seen: SeenSession[];

  afterEach(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  async function boot() {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = makeSqliteDriver();
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(crmTask as any, 'attribution-test', 'attribution-test');
    await ql.syncSchemas();

    // Observe the SAME session envelope the audit stamp hooks and
    // plugin-audit's `writeAudit` read. Registered at priority 100 so it runs
    // after the built-in stamp hooks (priority 10) — it only reads.
    seen = [];
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      (ql as any).registerHook(
        event,
        async (hookCtx: any) => {
          const s = hookCtx.session ?? {};
          seen.push({ event, isSystem: s.isSystem, userId: s.userId, actor: s.actor });
        },
        { object: 'crm_task', priority: 100 },
      );
    }
  }

  const SYS = { isSystem: true } as const;
  const taskByTitle = (title: string) =>
    ql.findOne('crm_task', { where: { title }, context: SYS });

  it('an ELEVATED, user-triggered run still stamps the OPERATOR — the same value a plain user write produces (#5494)', async () => {
    await boot();

    // Two identical rows, both created by SOMEONE ELSE on the ordinary user
    // path — so `updated_by` must MOVE to the operator for the assertions
    // below to pass (see CREATOR).
    await ql.insert('crm_task', { title: 'elevated', status: 'open' }, { context: { ...CREATOR } });
    await ql.insert('crm_task', { title: 'control', status: 'open' }, { context: { ...CREATOR } });
    const elevatedRow = await taskByTitle('elevated');
    const controlRow = await taskByTitle('control');

    // (a) the elevated path: a `runAs:'system'` flow updates the row.
    automation.registerFlow('elevated_touch', elevatedUpdateFlow('elevated_touch', String(elevatedRow.id)) as any);
    const res = await automation.execute('elevated_touch', { ...OPERATOR });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    // (b) the control: the same write, plain user context, no elevation.
    await ql.update('crm_task', { id: controlRow.id, status: 'done' }, { context: { ...OPERATOR } });

    const afterElevated = await taskByTitle('elevated');
    const afterControl = await taskByTitle('control');

    // THE INVARIANT. The old prose said an elevated run "resolves no user", so
    // its writes would land unattributed and lean on the actor label instead.
    // They do not: the operator is stamped, and byte-identically to the
    // unelevated write.
    expect(afterElevated.updated_by, 'the elevated run must stamp the triggering operator').toBe('usr_operator');
    expect(afterElevated.updated_by, 'elevated attribution must equal the plain user path').toBe(afterControl.updated_by);
    // The column MOVED off the creator — the assertion above is about this
    // update, not about the insert that seeded the row.
    expect(afterElevated.created_by, 'the original creator is untouched').toBe('usr_creator');
    expect(afterElevated.status, 'the run must actually have written').toBe('done');

    // …and the envelope the audit writers read carries BOTH: elevation on
    // `isSystem` (authorization) and the operator on `userId` (attribution),
    // with the flow label riding beside them rather than replacing the user.
    const elevatedUpdate = seen.find((s) => s.event === 'beforeUpdate' && s.isSystem === true);
    expect(elevatedUpdate, 'the elevated update must have reached the hook layer').toBeTruthy();
    expect(elevatedUpdate!.userId, 'elevation must not strip the operator (#5494)').toBe('usr_operator');
    expect(elevatedUpdate!.actor, 'the flow label names WHICH automation wrote (ADR-0014 D2)').toBe('svc:flow:elevated_touch');
  });

  it('a genuinely USER-LESS run falls back to the `svc:flow:` label — that is the case the label exists for (#4366)', async () => {
    await boot();

    // What ScheduleTrigger actually supplies: an event and params, NO user.
    automation.registerFlow('night_sweep', elevatedCreateFlow('night_sweep', 'nightly') as any);
    const res = await automation.execute('night_sweep', { event: 'schedule', params: {} } as any);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    const row = await taskByTitle('nightly');
    expect(row, 'the sweep must have created the row').toBeTruthy();

    // There is no operator to carry, so the user column stays NULL — ADR-0118
    // D1 forbids a sentinel or pseudo-user standing in for one.
    expect(row.created_by ?? null, 'a user-less run has no operator to stamp').toBeNull();

    // …and the actor label is what keeps the write attributable anyway. This
    // is the half of the old prose that was TRUE — it was only ever true here.
    const userlessInsert = seen.find((s) => s.event === 'beforeInsert' && s.isSystem === true);
    expect(userlessInsert, 'the user-less insert must have reached the hook layer').toBeTruthy();
    expect(userlessInsert!.userId ?? null, 'a schedule resolves no user').toBeNull();
    expect(userlessInsert!.actor, 'the svc:flow: label is the fallback attribution').toBe('svc:flow:night_sweep');
  });
});
