// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 items 2 and 3 — the handle's two update doors that 17.7.0 lacked.
 *
 *  - Item 2, the SYSTEM-context update: `hooks.run(object, 'update', input,
 *    { system: true })`. `seed` only inserts, and `hooks.run` ran as a person
 *    only, so an app's suite reached `objectql.update(…, { context:
 *    { isSystem: true } })` on the booted kernel by hand (hotcrm's
 *    `systemUpdate`).
 *  - Item 3, the PREDICATE update: `hooks.updateWhere(object, where, data,
 *    opts)`. `hooks.run` addresses one row by `input.id` and the REST bulk
 *    ingress (`POST /data/:object/updateMany`) writes by id, so the engine's
 *    predicate path (`multi: true`) had no door (hotcrm's `predicateUpdate`).
 *
 * Each door is the engine's own write, so every claim below is read off what
 * only the engine produces on that path: the permission gate's refusal (and
 * its absence for the system), the bound hook chain's view of the write (the
 * caller it saw, the pre-image it was bound to, once per matched row, and the
 * engine's own dispatch verdict, which tells its predicate path from a loop of
 * by-id writes), the declared validation rule's refusal, and the
 * record-change trigger's flow runs and their writes.
 *
 * The fixture is neutral. `upd_case` is readable but not editable by a fresh
 * member, so a member's update of it is the refusal the system door's success
 * is measured against. `upd_deal` is editable by the member, and its
 * transition flow (`stage != previous.stage`) writes one ledger row per
 * record whose OWN pre-image differs, so a per-row `previous` is observable
 * in stored rows, not only in a hook's memory.
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

const DEAL = 'upd_deal';
const CASE = 'upd_case';
const LEDGER = 'upd_ledger';
const DEAL_MOVED = 'upd_deal_stage_moved';
const CASE_CHANGED = 'upd_case_changed';

/** One dispatch the bound hook chain received. */
interface HookSeen {
  object: string;
  event: string;
  id: unknown;
  /** The pre-image's `stage` (deal) or `status` (case), as the engine bound it. */
  previous: unknown;
  isSystem: boolean;
  userId: unknown;
  /**
   * The engine's dispatch verdict for this call (`HookContext.dispatch.mode`):
   * `'per-row'` is one of N dispatches of ONE predicate write, `'record'` is a
   * write of one row by id. A loop of by-id updates would read `'record'`.
   */
  mode: unknown;
}
const hookSaw: HookSeen[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookCtx = { event: string; input: Record<string, any>; previous?: Record<string, any>; session?: Record<string, any>; dispatch?: { mode?: string } };

const capture = (object: string, prior: 'stage' | 'status') => async (ctx: HookCtx) => {
  hookSaw.push({
    object,
    event: ctx.event,
    id: ctx.input.id,
    previous: ctx.previous?.[prior],
    isSystem: ctx.session?.isSystem === true,
    userId: ctx.session?.userId,
    mode: ctx.dispatch?.mode,
  });
};

const Deal = ObjectSchema.create({
  name: DEAL,
  // The gate under test is the object grant; owner-sharing is kept out of the way.
  sharingModel: 'public_read_write',
  label: 'Deal',
  pluralLabel: 'Deals',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    batch: Field.text({ label: 'Batch' }),
    stage: Field.text({ label: 'Stage' }),
    note: Field.text({ label: 'Note' }),
  },
});

const Case = ObjectSchema.create({
  name: CASE,
  sharingModel: 'public_read_write',
  label: 'Case',
  pluralLabel: 'Cases',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    batch: Field.text({ label: 'Batch' }),
    status: Field.text({ label: 'Status' }),
    priority: Field.number({ label: 'Priority' }),
  },
  validations: [
    {
      name: 'priority_in_range',
      type: 'script',
      severity: 'error',
      message: 'Priority must be 1 to 5',
      condition: 'record.priority > 5',
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
    from_value: Field.text({ label: 'From' }),
    to_value: Field.text({ label: 'To' }),
  },
});

/** start (record-after-update, `condition`) → create_record(upd_ledger) → end. */
function ledgerWriter(name: string, objectName: string, field: 'stage' | 'status', condition?: string): Flow {
  return {
    name,
    label: name,
    type: 'autolaunched',
    status: 'active',
    // The ledger is the flow's witness, written whoever (or nobody) triggered it.
    runAs: 'system',
    nodes: [
      {
        id: 'start',
        type: 'start',
        label: 'On update',
        config: { objectName, triggerType: 'record-after-update', ...(condition ? { condition } : {}) },
      },
      {
        id: 'write',
        type: 'create_record',
        label: 'Ledger',
        config: {
          objectName: LEDGER,
          fields: {
            name,
            record_id: { dialect: 'cel', source: 'record.id' },
            from_value: { dialect: 'cel', source: `previous.${field}` },
            to_value: { dialect: 'cel', source: `record.${field}` },
          },
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'end' },
    ],
  } as Flow;
}

const memberSet = PermissionSetSchema.parse({
  name: 'upd_member_default',
  label: 'Update doors fixture member (default)',
  isDefault: true,
  objects: {
    [DEAL]: { allowRead: true, allowCreate: true, allowEdit: true },
    // Readable, never editable: the member's update of a case is refused.
    [CASE]: { allowRead: true },
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.update-doors',
    namespace: 'upd',
    version: '0.0.0',
    type: 'app',
    name: 'Verify Update Doors Fixture',
    description: 'An editable deal, a read-only case, a capture hook on each and a record-change flow on each.',
  },
  // ADR-0097: a record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Deal, Case, Ledger],
  hooks: [
    { name: 'upd_deal_capture', object: DEAL, events: ['beforeUpdate', 'afterUpdate'], handler: capture(DEAL, 'stage') },
    { name: 'upd_case_capture', object: CASE, events: ['beforeUpdate', 'afterUpdate'], handler: capture(CASE, 'status') },
  ],
  flows: [
    ledgerWriter(DEAL_MOVED, DEAL, 'stage', 'stage != previous.stage'),
    ledgerWriter(CASE_CHANGED, CASE, 'status'),
  ],
  permissions: [memberSet],
} as never);

let stack: VerifyStack;
let admin: string;
let adminId: string;
let member: string;
let memberId: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack);
  admin = await stack.signIn();
  adminId = String((await stack.contextFor(admin)).userId);
  // The first user is the seeded dev admin, so this sign-up is a plain member.
  member = await stack.signUp('upd-member@verify.test');
  memberId = String((await stack.contextFor(member)).userId);
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

const seenFor = (id: unknown, event?: string): HookSeen[] =>
  hookSaw.filter((h) => h.id === id && (event === undefined || h.event === event));

const ledgerFor = (flow: string, ids: readonly unknown[]): Promise<EngineRow[]> =>
  stack.rows(LEDGER, { name: flow }).then((rows) => rows.filter((r) => ids.includes(r.record_id)));

/**
 * The engine's run log for `flow`, narrowed to runs `recordId` triggered: what
 * the record-change trigger handed the automation service. The log is the
 * synchronous witness; the durable `sys_automation_run` row is written after
 * the triggering write has already returned.
 */
async function runsFor(flow: string, recordId: string): Promise<Array<{ status: string; trigger: Record<string, unknown> }>> {
  const automation = stack.kernel.getService('automation') as {
    listRuns(name: string): Promise<Array<{ status: string; trigger?: Record<string, unknown> }>>;
  };
  return (await automation.listRuns(flow))
    .filter((r) => r.trigger?.recordId === recordId)
    .map((r) => ({ status: r.status, trigger: r.trigger ?? {} }));
}

describe("item 2 — hooks.run(object, 'update', input, { system: true })", () => {
  it('an update the member may not make succeeds as the system; the same update as the member is refused', async () => {
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'open', priority: 1 }]);

    // Control first: the member holds read but not edit on upd_case.
    const refused = await refusalOf(stack.hooks.run(CASE, 'update', { id: kase.id, status: 'closed' }, { as: member }));
    expect(envelope(refused)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await stack.rows(CASE, { id: kase.id }))[0].status, 'the refused write left the row').toBe('open');

    const written = await stack.hooks.run(CASE, 'update', { id: kase.id, status: 'closed' }, { system: true });
    expect(written.status).toBe('closed');
    expect((await stack.rows(CASE, { id: kase.id }))[0].status).toBe('closed');
  });

  it('it is a real system write: the hooks see the system and no user, and the record flow runs with no trigger user', async () => {
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'open', priority: 1 }]);
    // `seed` fires no record trigger and dispatches no update hook: nothing is
    // on the books for this row before the write under test.
    expect(seenFor(kase.id)).toEqual([]);
    expect(await runsFor(CASE_CHANGED, kase.id)).toEqual([]);

    await stack.hooks.run(CASE, 'update', { id: kase.id, status: 'triaged' }, { system: true });

    const system = seenFor(kase.id);
    expect(system.map((h) => h.event)).toEqual(['beforeUpdate', 'afterUpdate']);
    for (const h of system) {
      expect(h).toMatchObject({ isSystem: true, userId: undefined, previous: 'open', mode: 'record' });
    }
    const systemRuns = await runsFor(CASE_CHANGED, kase.id);
    expect(systemRuns, 'the record-change trigger fired the flow on a system update').toHaveLength(1);
    expect(systemRuns[0].status).toBe('completed');
    expect(systemRuns[0].trigger).toMatchObject({ type: 'record-after-update', object: CASE });
    expect(systemRuns[0].trigger.userId, 'no trigger user').toBeUndefined();
    expect(await ledgerFor(CASE_CHANGED, [kase.id])).toMatchObject([{ from_value: 'open', to_value: 'triaged' }]);

    // Control that DISCRIMINATES: the same update by a person (the admin, who
    // may edit) reaches the same hooks and the same flow carrying that person.
    await stack.hooks.run(CASE, 'update', { id: kase.id, status: 'closed' }, { as: admin });
    const person = seenFor(kase.id).slice(2);
    expect(person.map((h) => h.event)).toEqual(['beforeUpdate', 'afterUpdate']);
    for (const h of person) {
      expect(h).toMatchObject({ isSystem: false, userId: adminId, previous: 'triaged' });
    }
    const runs = await runsFor(CASE_CHANGED, kase.id);
    expect(runs.map((r) => r.trigger.userId ?? null).sort()).toEqual([adminId, null].sort());
  });

  it("the declared validation still runs: a system update the rule refuses is refused with the engine's envelope", async () => {
    const [kase] = await stack.seed(CASE, [{ name: uniq('case'), status: 'open', priority: 1 }]);
    const refused = await refusalOf(stack.hooks.run(CASE, 'update', { id: kase.id, priority: 9 }, { system: true }));
    // The engine's `ValidationError`, rethrown unchanged: its `code` and the
    // structured `fields` it carries. It has no status of its own (the REST
    // boundary maps `VALIDATION_FAILED` to 400), so none is asserted here.
    expect(refused).toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: '_record', code: 'rule_violation' }] });
    expect((await stack.rows(CASE, { id: kase.id }))[0].priority).toBe(1);
    // Control: an in-range value through the same door is written.
    await stack.hooks.run(CASE, 'update', { id: kase.id, priority: 4 }, { system: true });
    expect((await stack.rows(CASE, { id: kase.id }))[0].priority).toBe(4);
  });

  it('the system is accepted on update only, and never beside a token — refused before the engine is touched', async () => {
    const name = uniq('case');
    const [kase] = await stack.seed(CASE, [{ name, status: 'open', priority: 1 }]);
    const asSystem = { system: true } as never;

    const insert = await refusalOf(stack.hooks.run(CASE, 'insert', { name: `${name}-x` }, asSystem));
    expect(envelope(insert)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    expect(await stack.rows(CASE, { name: `${name}-x` })).toEqual([]);

    const del = await refusalOf(stack.hooks.run(CASE, 'delete', { id: kase.id }, asSystem));
    expect(envelope(del)).toEqual({ code: 'INVALID_REQUEST', status: 400 });

    const both = await refusalOf(
      stack.hooks.run(CASE, 'update', { id: kase.id, status: 'closed' }, { as: admin, system: true } as never),
    );
    expect(envelope(both)).toEqual({ code: 'INVALID_REQUEST', status: 400 });

    expect((await stack.rows(CASE, { id: kase.id }))[0].status, 'none of the three wrote').toBe('open');
    expect(seenFor(kase.id), 'and no hook was dispatched').toEqual([]);
  });
});

describe('item 3 — hooks.updateWhere(object, where, data, opts): the predicate path', () => {
  /** Three deals the predicate matches (one already won) and two it does not. */
  async function deals(): Promise<{ matched: EngineRow[]; other: EngineRow[]; batch: string }> {
    const batch = uniq('batch');
    const matched = await stack.seed(DEAL, [
      { name: uniq('d'), batch, stage: 'open', note: 'n1' },
      { name: uniq('d'), batch, stage: 'working', note: 'n2' },
      { name: uniq('d'), batch, stage: 'won', note: 'n3' },
    ]);
    const other = await stack.seed(DEAL, [
      { name: uniq('d'), batch: `${batch}-other`, stage: 'open', note: 'o1' },
      { name: uniq('d'), batch: `${batch}-other`, stage: 'working', note: 'o2' },
    ]);
    return { matched, other, batch };
  }

  it('writes exactly the N rows the predicate selects, and leaves every other row as it was', async () => {
    const { matched, other, batch } = await deals();

    const count = await stack.hooks.updateWhere(DEAL, { batch }, { stage: 'won', note: 'bulk' }, { as: member });
    expect(count).toBe(3);

    const after = await stack.rows(DEAL, { batch });
    expect(after.map((r) => r.id).sort()).toEqual(matched.map((r) => r.id).sort());
    expect(after.every((r) => r.stage === 'won' && r.note === 'bulk')).toBe(true);
    for (const row of other) {
      const [now] = await stack.rows(DEAL, { id: row.id });
      expect({ stage: now.stage, note: now.note }).toEqual({ stage: row.stage, note: row.note });
    }
  });

  it("is the engine's predicate path: hooks once per matched row, each bound to that row's OWN pre-image, as the caller", async () => {
    const { matched, other, batch } = await deals();

    await stack.hooks.updateWhere(DEAL, { batch }, { stage: 'won' }, { as: member });

    for (const row of matched) {
      for (const event of ['beforeUpdate', 'afterUpdate']) {
        const seen = seenFor(row.id, event);
        expect(seen, `${event} once for ${String(row.stage)}`).toHaveLength(1);
        expect(seen[0]).toMatchObject({ previous: row.stage, isSystem: false, userId: memberId, mode: 'per-row' });
      }
    }
    for (const row of other) expect(seenFor(row.id)).toEqual([]);
  });

  it("the record-change trigger evaluates per row: the transition flow fires for each row whose own pre-image differs", async () => {
    const { matched, other, batch } = await deals();

    await stack.hooks.updateWhere(DEAL, { batch }, { stage: 'won' }, { as: member });

    const ledger = await ledgerFor(DEAL_MOVED, [...matched, ...other].map((r) => r.id));
    const moved = matched.filter((r) => r.stage !== 'won');
    // The already-won row was written too (it is in the count above), and its
    // pre-image says it did not move: no ledger row. One shared `previous`
    // would have fired for all three or for none.
    expect(ledger.map((r) => ({ id: r.record_id, from: r.from_value, to: r.to_value })).sort((a, b) =>
      String(a.from).localeCompare(String(b.from)),
    )).toEqual(
      moved.map((r) => ({ id: r.id, from: r.stage, to: 'won' })).sort((a, b) => String(a.from).localeCompare(String(b.from))),
    );
  });

  it('takes the system too: a predicate update the member may not make is refused, and succeeds as the system', async () => {
    const batch = uniq('batch');
    const cases = await stack.seed(CASE, [
      { name: uniq('c'), batch, status: 'open', priority: 1 },
      { name: uniq('c'), batch, status: 'open', priority: 2 },
    ]);

    const refused = await refusalOf(stack.hooks.updateWhere(CASE, { batch }, { status: 'closed' }, { as: member }));
    expect(envelope(refused)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await stack.rows(CASE, { batch })).map((r) => r.status)).toEqual(['open', 'open']);

    expect(await stack.hooks.updateWhere(CASE, { batch }, { status: 'closed' }, { system: true })).toBe(2);
    expect((await stack.rows(CASE, { batch })).map((r) => r.status)).toEqual(['closed', 'closed']);
    for (const kase of cases) {
      expect(seenFor(kase.id, 'beforeUpdate')).toMatchObject([
        { isSystem: true, userId: undefined, previous: 'open', mode: 'per-row' },
      ]);
    }
  });

  it("refuses, before the engine is touched, a call the engine's own dispatch would write by id", async () => {
    const { matched, batch } = await deals();
    const [first] = matched;

    const whereOnlyId = await refusalOf(stack.hooks.updateWhere(DEAL, { id: first.id }, { note: 'x' }, { as: member }));
    expect(envelope(whereOnlyId)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    // A payload id beside a predicate that selects nothing else: the engine
    // binds it as the row address. (Beside a REAL predicate the engine refuses
    // the call itself, its own way, which this door leaves unchanged.)
    const idInData = await refusalOf(stack.hooks.updateWhere(DEAL, {}, { id: first.id, note: 'x' }, { as: member }));
    expect(envelope(idInData)).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    const noPredicate = await refusalOf(stack.hooks.updateWhere(DEAL, undefined as never, { note: 'x' }, { as: member }));
    expect(envelope(noPredicate)).toEqual({ code: 'INVALID_REQUEST', status: 400 });

    expect((await stack.rows(DEAL, { batch })).every((r) => r.note !== 'x'), 'none of the three wrote').toBe(true);
    expect(seenFor(first.id), 'and no hook was dispatched').toEqual([]);

    // Control: an id INSIDE a real predicate (the compare-and-set spelling,
    // `where: { id, …more }`) is the engine's predicate path, and goes through.
    expect(await stack.hooks.updateWhere(DEAL, { id: first.id, batch }, { note: 'x' }, { as: member })).toBe(1);
    expect((await stack.rows(DEAL, { id: first.id }))[0].note).toBe('x');
  });
});
