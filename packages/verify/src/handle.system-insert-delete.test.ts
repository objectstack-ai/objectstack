// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 5 — a user-less record trigger on an insert or a delete, and a
 * flow over a record the engine no longer holds.
 *
 * `hooks.run(object, 'insert' | 'delete', input, { system: true })` is the
 * engine's own `insert` / `delete` under `{ isSystem: true }`, the write an
 * integration or a system job makes. Before this, `hooks.run` took the system
 * principal on `update` only, `seed` skips record-change flows, and every other
 * write door runs as a person, so an app's suite handed a flow a record through
 * the automation service by hand (hotcrm's `runRecordFlow`).
 *
 * Every claim below is read off what only the engine produces on that path:
 * the permission gate's refusal of the person (and its absence for the system),
 * the bound hook chain's view of the write (the caller it saw, the pre-image it
 * was bound to), the declared validation rule's refusal, and the record-change
 * trigger's flow runs and the rows those runs wrote.
 *
 * The fixture is neutral. `sid_case` is readable but neither creatable nor
 * deletable by a fresh member, so the member's write is the refusal the system
 * door's success is measured against. Its three flows each write one ledger row
 * per run: on create; before a delete; after a delete. The two delete flows
 * read the case back with `get_record` first, so the ledger records whether the
 * engine still held the row when the flow read it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { bootStack, type VerifyStack } from './harness.js';
import type { EngineRow } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const CASE = 'sid_case';
const LEDGER = 'sid_ledger';
const CREATED = 'sid_case_created';
const BEFORE_DELETE = 'sid_case_before_delete';
const DELETED = 'sid_case_deleted';

/** One dispatch the bound hook chain received. */
interface HookSeen {
  event: string;
  name: unknown;
  isSystem: boolean;
  userId: unknown;
  /** The pre-image's `status`, as the engine bound it (a delete's only view of the row). */
  previous: unknown;
}
const hookSaw: HookSeen[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookCtx = { event: string; input?: Record<string, any>; previous?: Record<string, any>; session?: Record<string, any> };

const capture = async (ctx: HookCtx) => {
  hookSaw.push({
    event: ctx.event,
    // An insert carries its payload; a delete carries no payload, only the pre-image.
    name: ctx.input?.data?.name ?? ctx.previous?.name,
    isSystem: ctx.session?.isSystem === true,
    userId: ctx.session?.userId,
    previous: ctx.previous?.status,
  });
};

const Case = ObjectSchema.create({
  name: CASE,
  // The gate under test is the object grant; owner-sharing is kept out of the way.
  sharingModel: 'public_read_write',
  label: 'Case',
  pluralLabel: 'Cases',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
    priority: Field.number({ label: 'Priority' }),
  },
  validations: [
    {
      name: 'priority_in_range',
      type: 'script',
      severity: 'error',
      message: 'Priority must be 1 to 5',
      // A case is born without a priority, so the rule guards the null.
      condition: 'record.priority != null && record.priority > 5',
    },
  ],
});

/** What the record-change flows write: one row per run that reached its write. */
const Ledger = ObjectSchema.create({
  name: LEDGER,
  sharingModel: 'public_read_write',
  label: 'Ledger',
  pluralLabel: 'Ledgers',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    record_id: Field.text({ label: 'Record' }),
    record_status: Field.text({ label: 'Record status' }),
    previous_status: Field.text({ label: 'Previous status' }),
    held: Field.text({ label: 'Held' }),
  },
});

const ledgerWrite = (name: string, fields: Record<string, unknown>) => ({
  id: 'write',
  type: 'create_record',
  label: 'Ledger',
  config: {
    objectName: LEDGER,
    fields: { name, record_id: { dialect: 'cel', source: 'record.id' }, record_status: { dialect: 'cel', source: 'record.status' }, ...fields },
  },
});

/** start (record-after-create) → create_record(sid_ledger) → end. */
const onCreate: Flow = {
  name: CREATED,
  label: CREATED,
  type: 'autolaunched',
  status: 'active',
  // The ledger is the flow's witness, written whoever (or nobody) triggered it.
  runAs: 'system',
  nodes: [
    { id: 'start', type: 'start', label: 'On create', config: { objectName: CASE, triggerType: 'record-after-create' } },
    ledgerWrite(CREATED, {}),
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'write' },
    { id: 'e2', source: 'write', target: 'end' },
  ],
} as Flow;

/**
 * start (`triggerType`) → get_record(sid_case, this row's id) → create_record(sid_ledger) → end.
 * `held` records what the read found: `'held'` for a row, `'gone'` for none.
 */
function deleteReader(name: string, triggerType: 'record-before-delete' | 'record-after-delete'): Flow {
  return {
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', label: 'On delete', config: { objectName: CASE, triggerType } },
      {
        id: 'read',
        type: 'get_record',
        label: 'Read the case back',
        config: { objectName: CASE, filter: { id: '{record.id}' }, outputVariable: 'held' },
      },
      ledgerWrite(name, {
        previous_status: { dialect: 'cel', source: 'previous.status' },
        held: { dialect: 'cel', source: "vars.held == null ? 'gone' : 'held'" },
      }),
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'read' },
      { id: 'e2', source: 'read', target: 'write' },
      { id: 'e3', source: 'write', target: 'end' },
    ],
  } as Flow;
}

const memberSet = PermissionSetSchema.parse({
  name: 'sid_member_default',
  label: 'System insert/delete fixture member (default)',
  isDefault: true,
  objects: {
    // Readable, never creatable or deletable: the member's insert and delete are refused.
    [CASE]: { allowRead: true },
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.system-insert-delete',
    namespace: 'sid',
    version: '0.0.0',
    type: 'app',
    name: 'Verify System Insert/Delete Fixture',
    description: 'A case a member may read but not create or delete, a capture hook, and three record-change flows.',
  },
  // ADR-0097: a record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Case, Ledger],
  hooks: [
    {
      name: 'sid_case_capture',
      object: CASE,
      events: ['beforeInsert', 'afterInsert', 'beforeDelete', 'afterDelete'],
      handler: capture,
    },
  ],
  flows: [onCreate, deleteReader(BEFORE_DELETE, 'record-before-delete'), deleteReader(DELETED, 'record-after-delete')],
  permissions: [memberSet],
} as never);

let stack: VerifyStack;
let admin: string;
let adminId: string;
let member: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack);
  admin = await stack.signIn();
  adminId = String((await stack.contextFor(admin)).userId);
  // The first user is the seeded dev admin, so this sign-up is a plain member.
  member = await stack.signUp('sid-member@verify.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

/** Unique per call, so no assertion sees another test's rows. */
const uniq = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

/** The rejection `p` settles with, or a failure when it resolves. */
async function refusalOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a refusal, and the call resolved');
}

/** The ADR-0112 pair: `code`, and `status` (or the engine's `statusCode`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const envelope = (e: unknown) => ({ code: (e as any)?.code, status: (e as any)?.statusCode ?? (e as any)?.status });

const seenFor = (name: string): HookSeen[] => hookSaw.filter((h) => h.name === name);

const ledgerFor = (flow: string, id: unknown): Promise<EngineRow[]> => stack.rows(LEDGER, { name: flow, record_id: id });

/**
 * The engine's run log for `flow`, narrowed to runs `recordId` triggered: what
 * the record-change trigger handed the automation service. The log is the
 * synchronous witness; the durable `sys_automation_run` row is written after
 * the triggering write has already returned.
 */
async function runsFor(flow: string, recordId: unknown): Promise<Array<{ status: string; trigger: Record<string, unknown> }>> {
  const automation = stack.kernel.getService('automation') as {
    listRuns(name: string): Promise<Array<{ status: string; trigger?: Record<string, unknown> }>>;
  };
  return (await automation.listRuns(flow))
    .filter((r) => r.trigger?.recordId === recordId)
    .map((r) => ({ status: r.status, trigger: r.trigger ?? {} }));
}

describe("item 5 — hooks.run(object, 'insert', input, { system: true })", () => {
  it('an insert the member may not make succeeds as the system; the same insert as the member is refused', async () => {
    const name = uniq('case');

    // Control first: the member holds read but not create on sid_case.
    const refused = await refusalOf(stack.hooks.run(CASE, 'insert', { name, status: 'new' }, { as: member }));
    expect(envelope(refused)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await stack.rows(CASE, { name }), 'the refused write left no row').toEqual([]);

    const written = await stack.hooks.run(CASE, 'insert', { name, status: 'new' }, { system: true });
    expect(typeof written.id).toBe('string');
    expect((await stack.rows(CASE, { name })).map((r) => r.id)).toEqual([written.id]);
  });

  it('it is a real system write: the hooks see the system and no user, and the record-change flow runs with no trigger user', async () => {
    const name = uniq('case');
    const written = await stack.hooks.run(CASE, 'insert', { name, status: 'new' }, { system: true });

    const system = seenFor(name);
    expect(system.map((h) => h.event)).toEqual(['beforeInsert', 'afterInsert']);
    for (const h of system) expect(h).toMatchObject({ isSystem: true, userId: undefined });
    const runs = await runsFor(CREATED, written.id);
    expect(runs, 'the record-change trigger fired the flow on a system insert').toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].trigger).toMatchObject({ type: 'record-after-create', object: CASE });
    expect(runs[0].trigger.userId, 'no trigger user').toBeUndefined();
    expect(await ledgerFor(CREATED, written.id)).toMatchObject([{ record_status: 'new' }]);

    // Control that DISCRIMINATES: the same insert by a person (the admin, who
    // may create) reaches the same hooks and the same flow carrying that person.
    const personName = uniq('case');
    const byPerson = await stack.hooks.run(CASE, 'insert', { name: personName, status: 'new' }, { as: admin });
    for (const h of seenFor(personName)) expect(h).toMatchObject({ isSystem: false, userId: adminId });
    expect((await runsFor(CREATED, byPerson.id)).map((r) => r.trigger.userId)).toEqual([adminId]);

    // And it is not `seed`: the platform's seed context skips record-change
    // flows, so the same row seeded fires nothing.
    const [seeded] = await stack.seed(CASE, [{ name: uniq('case'), status: 'new' }]);
    expect(await runsFor(CREATED, seeded.id), 'seed fired a record-change flow').toEqual([]);
  });

  it("the declared validation still runs: a system insert the rule refuses is refused with the engine's envelope", async () => {
    const name = uniq('case');
    const refused = await refusalOf(stack.hooks.run(CASE, 'insert', { name, priority: 9 }, { system: true }));
    // The engine's `ValidationError`, rethrown unchanged (its `code` and the
    // structured `fields`; it carries no status at the engine door).
    expect(refused).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: '_record', code: 'rule_violation' }] });
    expect(await stack.rows(CASE, { name })).toEqual([]);
    // Control: an in-range value through the same door is written.
    await stack.hooks.run(CASE, 'insert', { name, priority: 4 }, { system: true });
    expect((await stack.rows(CASE, { name })).map((r) => r.priority)).toEqual([4]);
  });
});

describe("item 5 — hooks.run(object, 'delete', { id }, { system: true })", () => {
  it('a delete the member may not make succeeds as the system; the same delete as the member is refused', async () => {
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'open' }]);

    // Control first: the member holds read but not delete on sid_case.
    const refused = await refusalOf(stack.hooks.run(CASE, 'delete', { id: kase.id }, { as: member }));
    expect(envelope(refused)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await stack.rows(CASE, { id: kase.id }), 'the refused delete left the row').toHaveLength(1);

    await stack.hooks.run(CASE, 'delete', { id: kase.id }, { system: true });
    expect(await stack.rows(CASE, { id: kase.id })).toEqual([]);
  });

  it('the hooks see the system and the pre-image, and the record-change flow runs with no trigger user', async () => {
    const name = uniq('case');
    const [kase] = await stack.seed(CASE, [{ name, status: 'closing' }]);
    // `seed` dispatches no delete hook and fires no delete flow: nothing is on
    // the books for this row before the write under test.
    expect(await runsFor(DELETED, kase.id)).toEqual([]);

    await stack.hooks.run(CASE, 'delete', { id: kase.id }, { system: true });

    const system = seenFor(name).filter((h) => h.event.endsWith('Delete'));
    expect(system.map((h) => h.event)).toEqual(['beforeDelete', 'afterDelete']);
    for (const h of system) expect(h).toMatchObject({ isSystem: true, userId: undefined, previous: 'closing' });
    const runs = await runsFor(DELETED, kase.id);
    expect(runs, 'the record-change trigger fired the flow on a system delete').toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].trigger).toMatchObject({ type: 'record-after-delete', object: CASE });
    expect(runs[0].trigger.userId, 'no trigger user').toBeUndefined();

    // Control that DISCRIMINATES: the same delete by a person (the admin, who
    // may delete) fires the same flow carrying that person.
    const [other] = await stack.seed(CASE, [{ name: uniq('case'), status: 'closing' }]);
    await stack.hooks.run(CASE, 'delete', { id: other.id }, { as: admin });
    expect((await runsFor(DELETED, other.id)).map((r) => r.trigger.userId)).toEqual([adminId]);
  });

  it('a delete-triggered flow is handed the pre-image, and its get_record finds a row the engine no longer holds', async () => {
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'closing' }]);

    await stack.hooks.run(CASE, 'delete', { id: kase.id }, { system: true });

    // After the delete: `record` and `previous` are both the pre-image, and the
    // flow's read of that same id finds nothing.
    expect(await ledgerFor(DELETED, kase.id)).toMatchObject([
      { record_status: 'closing', previous_status: 'closing', held: 'gone' },
    ]);
    // Control on the SAME delete: the before-delete flow reads the row back
    // through the same `get_record`, and finds it, so `'gone'` above is the
    // engine's answer about a deleted row, not a read that never matches.
    expect(await ledgerFor(BEFORE_DELETE, kase.id)).toMatchObject([{ record_status: 'closing', held: 'held' }]);
  });
});

describe('item 5 — the caller is named once', () => {
  it('a system insert or delete beside a token is refused, before the engine is touched', async () => {
    const name = uniq('case');
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'open' }]);
    const both = { as: admin, system: true } as never;

    const insert = await refusalOf(stack.hooks.run(CASE, 'insert', { name, status: 'new' }, both));
    expect(envelope(insert)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    expect(await stack.rows(CASE, { name }), 'the refused insert wrote nothing').toEqual([]);
    expect(seenFor(name), 'and dispatched no hook').toEqual([]);

    const del = await refusalOf(stack.hooks.run(CASE, 'delete', { id: kase.id }, both));
    expect(envelope(del)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    expect(await stack.rows(CASE, { id: kase.id }), 'the refused delete left the row').toHaveLength(1);
    expect(await runsFor(DELETED, kase.id), 'and fired no flow').toEqual([]);
  });
});
