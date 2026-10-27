// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22301 item 6 — observe what a hook handed the engine.
 *
 * `observeWrites(fn)` records the writes the booted engine receives while `fn`
 * runs and what the engine answered each one. It is one middleware on the
 * engine's own chain that passes every operation straight on, so each claim
 * below is read off the engine's own answer: the validation rule's refusal,
 * the unique conflict, a hook's swallowed failure, a fire-and-forget hook's
 * late write. Nothing here is decided by the handle.
 *
 * The three needs the card names, and what holds each:
 *
 *   1. A refused write leaves no row. The observation shows it, refused, with
 *      the engine's own error.
 *   2. An `async: true` hook's completion is invisible to the write that fired
 *      it. `settled(match)` waits for the write that hook makes.
 *   3. A refusal cannot be staged without a spy. It is staged through the app's
 *      own rules: seeded state the unique field refuses, a value the declared
 *      validation rule refuses.
 *
 * And the boundary the observer's position fixes, pinned so the documentation
 * cannot drift from it: a write a gate refuses (here, the permission check)
 * never reaches the observer.
 *
 * The fixture is neutral. Writing an `ow_order` fires afterInsert hooks that
 * write elsewhere through `ctx.api`, the hook's own door to the engine, and
 * swallow what the engine answers into `hookCaught`, so the triggering write
 * succeeds either way. That is the shape whose refusal used to be invisible.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { bootStack, type VerifyStack } from './harness.js';
import type { EngineRow, ObservedWrite, WriteObservation } from './handle.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const ORDER = 'ow_order';
const TASK = 'ow_task';
const VAULT = 'ow_vault';

/** What each hook's own `ctx.api` call answered: the error's code, or `ok`. */
const hookCaught = new Map<string, string>();

/**
 * The latch the fire-and-forget hook waits on before it writes, so "the write
 * has not landed when the triggering write returns" is a fact of the test,
 * not of the machine's speed. Released by the test.
 */
let releaseAsync: () => void = () => undefined;
let asyncGate: Promise<void> = Promise.resolve();
const armAsyncGate = () => {
  asyncGate = new Promise<void>((resolve) => {
    releaseAsync = resolve;
  });
};

type HookCtx = { input?: { data?: Record<string, any> }; api: any };

/** Write through the hook's `ctx.api` and record what the engine answered, swallowing a refusal. */
async function hookWrite(ctx: HookCtx, object: string, row: EngineRow): Promise<void> {
  const name = String(row.name);
  try {
    await ctx.api.object(object).insert(row);
    hookCaught.set(name, 'ok');
  } catch (e) {
    hookCaught.set(name, String((e as { code?: unknown })?.code));
  }
}

const Order = ObjectSchema.create({
  name: ORDER,
  sharingModel: 'public_read_write',
  label: 'Order',
  pluralLabel: 'Orders',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    /** Which hook acts on this order: `task`, `vault` or `async`. */
    mode: Field.text({ label: 'Mode' }),
    task_title: Field.text({ label: 'Task title' }),
    task_code: Field.text({ label: 'Task code' }),
  },
});

const Task = ObjectSchema.create({
  name: TASK,
  sharingModel: 'public_read_write',
  label: 'Task',
  pluralLabel: 'Tasks',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    title: Field.text({ label: 'Title' }),
    // One holder per installation: seeding a holder stages the conflict.
    code: Field.text({ label: 'Code', unique: 'global' }),
  },
  validations: [
    {
      name: 'title_not_blocked',
      type: 'script',
      severity: 'error',
      message: 'This title is blocked',
      condition: "record.title == 'blocked'",
    },
  ],
});

/** Granted to nobody but the platform admin. */
const Vault = ObjectSchema.create({
  name: VAULT,
  sharingModel: 'public_read_write',
  label: 'Vault',
  pluralLabel: 'Vaults',
  fields: { name: Field.text({ label: 'Name', required: true }) },
});

const memberSet = PermissionSetSchema.parse({
  name: 'ow_member_default',
  label: 'Observe-writes fixture member (default)',
  isDefault: true,
  objects: {
    [ORDER]: { allowRead: true, allowCreate: true, allowEdit: true },
    [TASK]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.objectstack.verify.observe-writes',
    namespace: 'ow',
    version: '0.0.0',
    type: 'app',
    name: 'Verify Observe-Writes Fixture',
    description: 'An order whose afterInsert hooks write a task, a vault row, or a task later.',
  },
  objects: [Order, Task, Vault],
  hooks: [
    {
      name: 'ow_order_task',
      object: ORDER,
      events: ['afterInsert'],
      handler: async (ctx: HookCtx) => {
        const order = ctx.input?.data ?? {};
        if (order.mode !== 'task') return;
        await hookWrite(ctx, TASK, {
          name: order.name,
          title: order.task_title,
          ...(order.task_code ? { code: order.task_code } : {}),
        });
      },
    },
    {
      name: 'ow_order_vault',
      object: ORDER,
      events: ['afterInsert'],
      handler: async (ctx: HookCtx) => {
        const order = ctx.input?.data ?? {};
        if (order.mode !== 'vault') return;
        await hookWrite(ctx, VAULT, { name: order.name });
      },
    },
    {
      name: 'ow_order_async_task',
      object: ORDER,
      events: ['afterInsert'],
      // Fire-and-forget: the triggering write does not wait for it.
      async: true,
      handler: async (ctx: HookCtx) => {
        const order = ctx.input?.data ?? {};
        if (order.mode !== 'async') return;
        await asyncGate;
        await hookWrite(ctx, TASK, { name: `${order.name}-async`, title: order.task_title });
      },
    },
  ],
  permissions: [memberSet],
} as never);

let stack: VerifyStack;
let admin: string;
let member: string;
let memberId: string;

beforeAll(async () => {
  stack = await bootStack(fixtureStack);
  admin = await stack.signIn();
  // The first user is the seeded dev admin, so this sign-up is a plain member.
  member = await stack.signUp('ow-member@verify.test');
  memberId = String((await stack.contextFor(member)).userId);
}, BOOT_TIMEOUT);

afterAll(async () => {
  releaseAsync();
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
const envelope = (e: unknown) => ({ code: (e as any)?.code, status: (e as any)?.statusCode ?? (e as any)?.status });

/** The observed writes to the fixture's objects: the window also holds the stack's own writes. */
const fixtureWrites = (writes: readonly ObservedWrite[]): ObservedWrite[] =>
  writes.filter((w) => w.object === ORDER || w.object === TASK || w.object === VAULT);

/** A write's first (or only) payload row. */
const rowOf = (w: ObservedWrite): EngineRow => (Array.isArray(w.data) ? w.data[0] : w.data) ?? {};

/** `object` + `status` (+ `code` when refused), the shape most assertions read. */
const summary = (w: ObservedWrite) => ({
  object: w.object,
  operation: w.operation,
  status: w.outcome.status,
  ...(w.outcome.status === 'refused' ? { code: w.outcome.code } : {}),
});

describe('item 6 — a refused write leaves no row, and the observation shows it', () => {
  it("a hook's write the declared validation rule refuses is recorded refused, with the engine's own error", async () => {
    const name = uniq('order');
    let order: EngineRow | undefined;
    const writes = await stack.observeWrites(async () => {
      order = await stack.hooks.run(ORDER, 'insert', { name, mode: 'task', task_title: 'blocked' }, { as: member });
    });

    // The hook swallowed the refusal, so the triggering write succeeded and
    // the task left no row: before this door, nothing in the test said why.
    expect(typeof order?.id).toBe('string');
    expect(hookCaught.get(name)).toBe('VALIDATION_FAILED');
    expect(await stack.rows(TASK, { name }), 'the refused write left no row').toEqual([]);

    const seen = fixtureWrites(writes);
    expect(seen.map(summary)).toEqual([
      { object: ORDER, operation: 'insert', status: 'resolved' },
      { object: TASK, operation: 'insert', status: 'refused', code: 'VALIDATION_FAILED' },
    ]);
    const task = seen[1];
    expect(rowOf(task)).toMatchObject({ name, title: 'blocked' });
    expect(task.context?.userId, "the hook's write carried the triggering user").toBe(memberId);
    expect(task.outcome.status === 'refused' && task.outcome.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: '_record', code: 'rule_violation' }],
    });

    // Control that DISCRIMINATES: the same hook with a title the rule accepts
    // is recorded resolved, and its row is there.
    const okName = uniq('order');
    const okWrites = await stack.observeWrites(async () => {
      await stack.hooks.run(ORDER, 'insert', { name: okName, mode: 'task', task_title: 'fine' }, { as: member });
    });
    expect(fixtureWrites(okWrites).map(summary)).toEqual([
      { object: ORDER, operation: 'insert', status: 'resolved' },
      { object: TASK, operation: 'insert', status: 'resolved' },
    ]);
    expect((await stack.rows(TASK, { name: okName })).map((r) => r.title)).toEqual(['fine']);
  });

  it('the observer changes nothing: the caller gets the very error recorded, and the same call unobserved answers the same', async () => {
    const name = uniq('task');
    let caught: unknown;
    const writes = await stack.observeWrites(async () => {
      caught = await refusalOf(stack.hooks.run(TASK, 'insert', { name, title: 'blocked' }, { as: member }));
    });
    const [task] = fixtureWrites(writes);
    expect(task.outcome.status).toBe('refused');
    expect(task.outcome.status === 'refused' && task.outcome.error, 'the same error object, not a copy').toBe(caught);

    const unobserved = await refusalOf(stack.hooks.run(TASK, 'insert', { name, title: 'blocked' }, { as: member }));
    expect(envelope(unobserved)).toEqual(envelope(caught));
    expect(await stack.rows(TASK, { name })).toEqual([]);
  });
});

describe('item 6 — an async: true hook', () => {
  it('its write lands after the triggering write returned, and settled() waits for it', async () => {
    armAsyncGate();
    const name = uniq('order');
    const asyncName = `${name}-async`;
    const writes = await stack.observeWrites(async (observation) => {
      await stack.hooks.run(ORDER, 'insert', { name, mode: 'async', task_title: 'later' }, { as: member });
      // The triggering write has returned, and the hook has not written yet:
      // this is the completion the write itself cannot show.
      expect(observation.writes.some((w) => w.object === TASK)).toBe(false);
      expect(await stack.rows(TASK, { name: asyncName })).toEqual([]);

      releaseAsync();
      const task = await observation.settled((w) => w.object === TASK && rowOf(w).name === asyncName);
      expect(summary(task)).toEqual({ object: TASK, operation: 'insert', status: 'resolved' });
    });
    expect(fixtureWrites(writes).map((w) => w.object)).toEqual([ORDER, TASK]);
    expect((await stack.rows(TASK, { name: asyncName })).map((r) => r.title)).toEqual(['later']);
  });

  it("settled() also answers a fire-and-forget write the engine refuses, which leaves no row", async () => {
    armAsyncGate();
    const name = uniq('order');
    const asyncName = `${name}-async`;
    await stack.observeWrites(async (observation) => {
      await stack.hooks.run(ORDER, 'insert', { name, mode: 'async', task_title: 'blocked' }, { as: member });
      releaseAsync();
      const task = await observation.settled((w) => w.object === TASK && rowOf(w).name === asyncName);
      expect(summary(task)).toEqual({ object: TASK, operation: 'insert', status: 'refused', code: 'VALIDATION_FAILED' });
    });
    expect(await stack.rows(TASK, { name: asyncName })).toEqual([]);
  });
});

describe("item 6 — a refusal staged through the app's own rules, never a switch", () => {
  it('seeded state: the row that already holds the unique value makes the engine refuse the hook\'s write', async () => {
    const code = uniq('CODE');
    await stack.seed(TASK, [{ name: uniq('holder'), code }]);

    const name = uniq('order');
    const writes = await stack.observeWrites(async () => {
      await stack.hooks.run(ORDER, 'insert', { name, mode: 'task', task_title: 'dup', task_code: code }, { as: member });
    });
    expect(hookCaught.get(name)).toBe('DUPLICATE_RECORD');
    expect(fixtureWrites(writes).map(summary)).toEqual([
      { object: ORDER, operation: 'insert', status: 'resolved' },
      { object: TASK, operation: 'insert', status: 'refused', code: 'DUPLICATE_RECORD' },
    ]);
    expect(await stack.rows(TASK, { code }), 'only the seeded holder').toHaveLength(1);

    // Control: a code no row holds is written.
    const freshName = uniq('order');
    await stack.hooks.run(ORDER, 'insert', { name: freshName, mode: 'task', task_title: 'dup', task_code: uniq('CODE') }, { as: member });
    expect(hookCaught.get(freshName)).toBe('ok');
  });
});

describe('item 6 — the boundary: a write a gate refuses never reaches the observer', () => {
  it("a hook's write the permission check refuses leaves no entry; the same write the gate admits is recorded", async () => {
    const name = uniq('order');
    const writes = await stack.observeWrites(async () => {
      await stack.hooks.run(ORDER, 'insert', { name, mode: 'vault' }, { as: member });
    });
    // The refusal reached the hook that made the write...
    expect(hookCaught.get(name)).toBe('PERMISSION_DENIED');
    expect(await stack.rows(VAULT, { name })).toEqual([]);
    // ...and never reached the observer, which sits after that gate.
    expect(fixtureWrites(writes).map(summary)).toEqual([{ object: ORDER, operation: 'insert', status: 'resolved' }]);

    // Control: the admin is granted the vault, so the same hook's write passes
    // the gate and is recorded.
    const adminName = uniq('order');
    const adminWrites = await stack.observeWrites(async () => {
      await stack.hooks.run(ORDER, 'insert', { name: adminName, mode: 'vault' }, { as: admin });
    });
    expect(hookCaught.get(adminName)).toBe('ok');
    expect(fixtureWrites(adminWrites).map(summary)).toEqual([
      { object: ORDER, operation: 'insert', status: 'resolved' },
      { object: VAULT, operation: 'insert', status: 'resolved' },
    ]);
  });
});

describe('item 6 — what an entry carries, and the window', () => {
  it('every door is observed: a seed, a predicate update and a delete, each with its own selection and caller', async () => {
    const name = uniq('task');
    let seededId = '';
    const writes = await stack.observeWrites(async () => {
      const [seeded] = await stack.seed(TASK, [{ name, title: 'one' }]);
      seededId = String(seeded.id);
      await stack.hooks.updateWhere(TASK, { name }, { title: 'two' }, { as: member });
      await stack.hooks.run(TASK, 'delete', { id: seededId }, { system: true });
    });
    const seen = fixtureWrites(writes);
    expect(seen.map(summary)).toEqual([
      { object: TASK, operation: 'insert', status: 'resolved' },
      { object: TASK, operation: 'update', status: 'resolved' },
      { object: TASK, operation: 'delete', status: 'resolved' },
    ]);
    const [insert, update, del] = seen;
    expect(insert.context?.isSystem, 'seed writes as the system').toBe(true);
    expect(insert.where).toBeUndefined();
    expect(update).toMatchObject({ where: { name }, multi: true, data: { title: 'two' } });
    expect(update.context?.userId).toBe(memberId);
    expect(update.outcome.status === 'resolved' && update.outcome.result, "the engine's affected-row count").toBe(1);
    expect(del).toMatchObject({ where: { id: seededId }, multi: false, data: undefined });
    expect(del.context?.isSystem).toBe(true);
  });

  it('the window closes with fn: a later write is not recorded, and settled() after the close rejects', async () => {
    let live: readonly ObservedWrite[] = [];
    let late: WriteObservation | undefined;
    const writes = await stack.observeWrites(async (observation) => {
      live = observation.writes;
      late = observation;
      await stack.hooks.run(TASK, 'insert', { name: uniq('task'), title: 'inside' }, { as: member });
    });
    const countAtClose = live.length;
    expect(fixtureWrites(writes)).toHaveLength(1);

    await stack.hooks.run(TASK, 'insert', { name: uniq('task'), title: 'outside' }, { as: member });
    expect(live, 'nothing is added once the observation closed').toHaveLength(countAtClose);
    expect(fixtureWrites(writes)).toHaveLength(1);
    if (!late) throw new Error('fn was never handed its observation');
    await expect(late.settled(() => true)).rejects.toBeInstanceOf(Error);
  });

  it('settled() rejects on its timeout, naming the writes it saw, and fn is free to end', async () => {
    const name = uniq('task');
    await stack.observeWrites(async (observation) => {
      await stack.hooks.run(TASK, 'insert', { name, title: 'only' }, { as: member });
      const waited = await refusalOf(observation.settled((w) => w.object === 'ow_nothing', { timeoutMs: 50 }));
      expect(waited).toBeInstanceOf(Error);
      expect((waited as Error).message).toContain(`insert ${TASK}`);
    });
  });

  it('the observer is global: it keys no middleware to an object', async () => {
    await stack.observeWrites(() => undefined);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as { hasObjectMiddleware(name: string): boolean };
    expect(ql.hasObjectMiddleware(TASK)).toBe(false);
  });
});

describe('item 6 — a malformed call is refused before anything is observed', () => {
  it('observeWrites without a function, and settled without a match or with a bad timeout', async () => {
    expect(envelope(await refusalOf(stack.observeWrites(undefined as never)))).toEqual({ code: 'INVALID_REQUEST', status: 400 });
    await stack.observeWrites(async (observation) => {
      expect(envelope(await refusalOf(observation.settled(undefined as never)))).toEqual({ code: 'INVALID_REQUEST', status: 400 });
      expect(envelope(await refusalOf(observation.settled(() => true, { timeoutMs: 0 })))).toEqual({
        code: 'INVALID_REQUEST',
        status: 400,
      });
    });
  });
});
