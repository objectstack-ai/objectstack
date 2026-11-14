// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling record 6787890900] A `runAs:'system'` flow does not change or
 * delete the rows of an append-only object.
 *
 * A system run's data nodes write under `{ isSystem: true, …, flowRunId }`
 * (`resolveRunDataContext`). The security middleware refuses that context's
 * update, delete, transfer, restore or purge of an object declared
 * `managedBy: 'append-only'`, ahead of its `isSystem` short-circuit, by the
 * predicate the identity-assignment refusal reads
 * (`flow-system-identity-write-refusal.ts`, plugin-security). Directions
 * decided before running:
 *
 *  - an `update_record` or `delete_record` node aimed at `sys_audit_log` or
 *    `sys_activity` fails the run with `PERMISSION_DENIED` carried to its
 *    caller, user-triggered and user-less alike, and the row does not move —
 *    whichever organization the row names;
 *  - the same run's delete of a record a ledger row references is refused
 *    whole with `PERMISSION_DENIED` (the engine's clean-up of that reference
 *    is a change to the ledger row), and nothing changes; a platform delete of
 *    the same record lands and clears the reference;
 *  - CONTROL, the platform's own writers, whose system context carries no run
 *    (the retention sweeper, a migration), update and delete both ledgers as
 *    before;
 *  - CONTROL, the same flow still reads both ledgers and still writes an
 *    ordinary object, and the audit writer still records that write in both
 *    ledgers.
 *
 * The real stack: ObjectKernel, ObjectQLPlugin, driver-sql on better-sqlite3
 * `:memory:`, the identity objects, the real SecurityPlugin and the real
 * AuditPlugin (whose `sys_audit_log` and `sys_activity` are the append-only
 * objects judged, read off the live registry), plus the real AutomationEngine
 * and its CRUD nodes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const SYS = { isSystem: true } as const;

const text = (name: string) => ({ name, label: name, type: 'text' as const });

/** An ordinary object: the control that a system flow's other writes are unchanged. */
const noteObject = { name: 'aor_note', label: 'Note', fields: { title: text('title') } };

type Node = { id: string; type: string; label: string; config: Record<string, unknown> };

/** start → one data node → end, as a `runAs: 'system'` flow. */
const systemFlow = (name: string, node: Omit<Node, 'id' | 'label'>) => ({
  name, label: name, type: 'autolaunched', runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'data', label: 'Data', ...node },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'data' }, { id: 'e2', source: 'data', target: 'end' }],
});
const update = (objectName: string, id: string, fields: Record<string, unknown>) => ({ type: 'update_record', config: { objectName, filter: { id }, fields } });
const remove = (objectName: string, id: string) => ({ type: 'delete_record', config: { objectName, filter: { id } } });
const read = (objectName: string, id: string) => ({ type: 'get_record', config: { objectName, filter: { id } } });
const create = (objectName: string, fields: Record<string, unknown>) => ({ type: 'create_record', config: { objectName, fields } });

describe("a runAs:'system' flow does not change or delete an append-only object's rows", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  const ORG_B = 'org_aor_b';

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite', type: 'standard', version: '1.0.0',
      async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }));
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');
    ql.registry.registerObject(noteObject as any, 'append-only-refusal-test', 'append-only-refusal-test');
    await ql.syncSchemas();

    const orgs = await ql.find('sys_organization', { context: SYS });
    orgA = String(orgs[0].id);
    await ql.insert('sys_organization', { id: ORG_B, name: 'Organization B', slug: 'aor-b' }, { context: SYS });
    await ql.insert('sys_user', { id: 'usr_admin', name: 'usr_admin', email: 'usr_admin@example.test' }, { context: SYS });
    await ql.insert('sys_member', { id: 'mem_admin', user_id: 'usr_admin', organization_id: orgA, role: 'owner' }, { context: SYS });
  }, 30_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /** A row of each ledger in `org`, written by the platform: setup is not the subject. */
  const LEDGERS = {
    sys_audit_log: {
      row: (id: string, org: string) => ({ id, action: 'create', object_name: 'aor_note', record_id: 'r1', tenant_id: org, created_at: new Date().toISOString() }),
      edit: { action: 'delete' },
    },
    sys_activity: {
      row: (id: string, org: string) => ({ id, type: 'created', summary: 'Note created', timestamp: new Date().toISOString(), organization_id: org }),
      edit: { summary: 'Note edited' },
    },
  } as const;
  type Ledger = keyof typeof LEDGERS;
  const LEDGER_NAMES = Object.keys(LEDGERS) as Ledger[];

  let seq = 0;
  async function seed(object: Ledger, org: string): Promise<{ id: string; before: Record<string, unknown> }> {
    const id = `${object}_${++seq}`;
    await ql.insert(object, LEDGERS[object].row(id, org), { context: { isSystem: true, tenantId: org } });
    const [before] = (await ql.find(object, { where: { id }, context: SYS })) as any[];
    return { id, before };
  }
  const stored = async (object: string, id: string) => ((await ql.find(object, { where: { id }, context: SYS })) as any[])[0] ?? null;

  /** Register a one-node system flow and run it; triggered by the administrator in organisation A, or user-less when `userless`. */
  async function run(node: Omit<Node, 'id' | 'label'>, userless = false) {
    const name = `aor_flow_${++seq}`;
    automation.registerFlow(name, systemFlow(name, node) as never);
    const trigger = userless ? { event: 'schedule', params: {} } : { userId: 'usr_admin', tenantId: orgA };
    return automation.execute(name, trigger as never);
  }

  function expectRefused(res: any, object: string, operation: string) {
    expect(res.success, `the run succeeded: ${JSON.stringify(res)}`).toBe(false);
    expect(res.innerRefusal?.code).toBe('PERMISSION_DENIED');
    expect(res.innerRefusal?.message).toMatch(new RegExp(`'${operation}' on '${object}' from a flow that runs as system`));
    expect(res.innerRefusal?.message).toMatch(new RegExp(`'${object}' is append-only`));
  }

  for (const object of LEDGER_NAMES) {
    for (const [label, userless] of [['user-triggered', false], ['user-less', true]] as const) {
      it(`${object}: a ${label} run's update and delete are refused, on its own organization's row and another's, and neither row moves`, async () => {
        for (const org of [orgA, ORG_B]) {
          const { id, before } = await seed(object, org);
          expectRefused(await run(update(object, id, LEDGERS[object].edit), userless), object, 'update');
          expectRefused(await run(remove(object, id), userless), object, 'delete');
          expect(await stored(object, id), `${object} row of ${org}`).toEqual(before);
        }
      });
    }
  }

  // [Seat decision on the contract review] Deleting a record that a ledger row
  // references makes the engine clear that reference on the ledger row, under
  // the deleting context: a change to an append-only object, so the delete is
  // refused whole.
  for (const [object, field, row] of [
    ['sys_activity', 'actor_id', (id: string, user: string) => ({ ...LEDGERS.sys_activity.row(id, orgA), actor_id: user })],
    ['sys_audit_log', 'user_id', (id: string, user: string) => ({ ...LEDGERS.sys_audit_log.row(id, orgA), user_id: user })],
  ] as const) {
    it(`a ${object} row references a user: a runAs:'system' flow's delete of that user is refused with PERMISSION_DENIED and nothing changes; a platform delete of the same user lands`, async () => {
      const user = `usr_departed_${++seq}`;
      const ledgerId = `${object}_ref_${seq}`;
      await ql.insert('sys_user', { id: user, name: user, email: `${user}@example.test` }, { context: SYS });
      await ql.insert(object, row(ledgerId, user), { context: { isSystem: true, tenantId: orgA } });
      const ledgerBefore = await stored(object, ledgerId);
      const userBefore = await stored('sys_user', user);

      const res: any = await run(remove('sys_user', user));
      expect(res.success, `the run succeeded: ${JSON.stringify(res)}`).toBe(false);
      expect(res.innerRefusal?.code).toBe('PERMISSION_DENIED');
      expect(res.innerRefusal?.message).toMatch(/deleting a 'sys_user' record from a flow that runs as system \(runAs: 'system'\) is refused/);
      expect(res.innerRefusal?.message).toMatch(/deleting this record would change a record in an append-only ledger that references it/);
      expect(await stored('sys_user', user)).toEqual(userBefore);
      expect(await stored(object, ledgerId)).toEqual(ledgerBefore);

      await ql.delete('sys_user', { where: { id: user }, context: SYS } as never);
      expect(await stored('sys_user', user)).toBe(null);
      expect(await stored(object, ledgerId)).toMatchObject({ id: ledgerId, [field]: null });
    });
  }

  it("CONTROL: a platform writer's system context, which carries no run, updates and deletes both ledgers as before", async () => {
    for (const object of LEDGER_NAMES) {
      const { id } = await seed(object, orgA);
      await ql.update(object, { id, ...LEDGERS[object].edit }, { context: SYS });
      expect(await stored(object, id)).toMatchObject(LEDGERS[object].edit);
      await ql.delete(object, { where: { id }, context: SYS } as never);
      expect(await stored(object, id)).toBe(null);
    }
  });

  it('CONTROL: the same flow still reads both ledgers and writes an ordinary object, and the audit writer still records that write in both ledgers', async () => {
    for (const object of LEDGER_NAMES) {
      const { id } = await seed(object, orgA);
      const res = await run(read(object, id));
      expect(res.success, `reading ${object}: ${JSON.stringify(res)}`).toBe(true);
    }

    const res = await run(create('aor_note', { title: 'by the flow' }));
    expect(res.success, JSON.stringify(res)).toBe(true);
    const [note] = (await ql.find('aor_note', { where: { title: 'by the flow' }, context: SYS })) as any[];
    expect(note?.id).toBeTruthy();
    expect(await ql.find('sys_audit_log', { where: { object_name: 'aor_note', record_id: note.id }, context: SYS })).toHaveLength(1);
    expect(await ql.find('sys_activity', { where: { object_name: 'aor_note', record_id: note.id }, context: SYS })).toHaveLength(1);
  });
});
