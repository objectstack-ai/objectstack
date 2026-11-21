// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comment thread can be marked resolved and reopened (#36071).
 *
 * Same rig as `comment-edit-stamp.integration.test.ts`: real kernel, real
 * ObjectQL, real AuditPlugin, real SQLite driver. What is pinned here is what
 * only the real engine decides — the stamp landing over the `readonly` strip,
 * the reopen write a reply triggers, the reply refusal's wire envelope, and
 * the two read shapes the comment panel uses (the resolved filter and the
 * unresolved-thread count, each one statement). WHO may resolve is pinned
 * against a sharing double in `comment-access-hooks.test.ts`: this rig
 * composes no sharing service, so every reader of a parent is also its
 * editor here.
 *
 * Assertions are on the stored row, the dropped-fields report and the wire
 * envelope — never on a bare throw.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { mapDataError } from '@objectstack/types';

import { AuditPlugin } from './audit-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const COMMENT = 'sys_comment';
const BOARD = 'rs_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-resolution';

const SYS = { isSystem: true } as const;
const AUTHOR = { userId: 'u_author', positions: ['org_member'] };
const RESOLVER = { userId: 'u_resolver', positions: ['org_member'] };
const REPLIER = { userId: 'u_replier', positions: ['org_member'] };
const FORGED = '2000-01-01T00:00:00.000Z';

const boardObject = {
  name: BOARD,
  label: 'Board',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

type Row = Record<string, any>;

const refusal = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('sys_comment — a thread can be resolved and reopened (#36071)', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(boardObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  const newBoard = async (): Promise<{ id: string; thread: string }> => {
    const board = await engine.insert(BOARD, { name: 'board' }, { context: SYS });
    return { id: String(board.id), thread: `${BOARD}:${board.id}` };
  };
  const post = async (thread: string, body: string, as: Row = AUTHOR, extra: Row = {}): Promise<string> => {
    const created = await engine.insert(COMMENT, { thread_id: thread, body, ...extra }, { context: as });
    return String(created.id);
  };
  const read = async (id: string): Promise<Row> =>
    (await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row;
  const resolution = async (id: string) => {
    const row = await read(id);
    return { is_resolved: row.is_resolved, resolved_by: row.resolved_by ?? null, resolved_at: row.resolved_at ?? null };
  };
  const expectServerClock = (value: unknown, from: number, to: number) => {
    expect(typeof value, `resolved_at ${JSON.stringify(value)} is not a timestamp`).toBe('string');
    const at = Date.parse(value as string);
    expect(at).toBeGreaterThanOrEqual(from);
    expect(at).toBeLessThanOrEqual(to);
  };

  it('resolving stamps the resolver and the server clock; reopening clears both', async () => {
    const { thread } = await newBoard();
    const id = await post(thread, 'question');
    expect(await resolution(id)).toEqual({ is_resolved: false, resolved_by: null, resolved_at: null });

    const from = Date.now();
    await engine.update(COMMENT, { is_resolved: true }, { where: { id }, context: RESOLVER });
    const to = Date.now();
    const resolved = await resolution(id);
    expect(resolved.is_resolved).toBe(true);
    expect(resolved.resolved_by).toBe(RESOLVER.userId);
    expectServerClock(resolved.resolved_at, from, to);

    await engine.update(COMMENT, { is_resolved: false }, { where: { id }, context: AUTHOR });
    expect(await resolution(id)).toEqual({ is_resolved: false, resolved_by: null, resolved_at: null });
  });

  it('a client-supplied resolver or time never lands: stripped and reported, the session user stored', async () => {
    const { thread } = await newBoard();
    const id = await post(thread, 'question');
    const drops: Row[] = [];
    await engine.update(
      COMMENT,
      { is_resolved: true, resolved_by: 'u_forged', resolved_at: FORGED },
      { where: { id }, context: RESOLVER, onFieldsDropped: (e: Row) => drops.push(e) } as any,
    );
    const row = await resolution(id);
    expect(row.resolved_by).toBe(RESOLVER.userId);
    expect(row.resolved_at).not.toBe(FORGED);
    expect(drops).toEqual([
      expect.objectContaining({ object: COMMENT, reason: 'readonly', fields: expect.arrayContaining(['resolved_by', 'resolved_at']) }),
    ]);

    // Without a change of is_resolved, a client cannot move or clear them either.
    await engine.update(COMMENT, { resolved_by: null, resolved_at: null }, { where: { id }, context: AUTHOR });
    expect((await resolution(id)).resolved_by).toBe(RESOLVER.userId);
  });

  it('resolving an already-resolved thread keeps its first resolver', async () => {
    const { thread } = await newBoard();
    const id = await post(thread, 'question');
    await engine.update(COMMENT, { is_resolved: true }, { where: { id }, context: RESOLVER });
    const first = await resolution(id);
    await engine.update(COMMENT, { is_resolved: true }, { where: { id }, context: AUTHOR });
    expect(await resolution(id)).toEqual(first);
  });

  it('a new comment is unresolved whatever the client sent', async () => {
    const { thread } = await newBoard();
    const id = await post(thread, 'question', AUTHOR, { is_resolved: true, resolved_by: 'u_forged', resolved_at: FORGED });
    expect(await resolution(id)).toEqual({ is_resolved: false, resolved_by: null, resolved_at: null });
  });

  it('a reply cannot be marked resolved: VALIDATION_ERROR / 400 on the wire, nothing written', async () => {
    const { thread } = await newBoard();
    const root = await post(thread, 'question');
    const reply = await post(thread, 'answer', REPLIER, { parent_id: root });
    const error = await refusal(() => engine.update(COMMENT, { is_resolved: true }, { where: { id: reply }, context: REPLIER }));
    expect(error, 'a reply was marked resolved').toBeDefined();
    const wire = mapDataError(error, COMMENT);
    expect(wire.status).toBe(400);
    expect(wire.body.code).toBe('VALIDATION_ERROR');
    expect((await resolution(reply)).is_resolved).toBe(false);
    expect((await resolution(root)).is_resolved).toBe(false);
  });

  it('a reply posted into a resolved thread reopens it', async () => {
    const { thread } = await newBoard();
    const root = await post(thread, 'question');
    await post(thread, 'first answer', REPLIER, { parent_id: root });
    await engine.update(COMMENT, { is_resolved: true }, { where: { id: root }, context: RESOLVER });
    expect((await resolution(root)).is_resolved).toBe(true);

    await post(thread, 'actually, one more thing', AUTHOR, { parent_id: root });
    expect(await resolution(root)).toEqual({ is_resolved: false, resolved_by: null, resolved_at: null });
  });

  it('a reply into an unresolved thread, and a new top-level comment, change no resolution', async () => {
    const { thread } = await newBoard();
    const open = await post(thread, 'open question');
    const done = await post(thread, 'settled question');
    await engine.update(COMMENT, { is_resolved: true }, { where: { id: done }, context: RESOLVER });
    const settled = await resolution(done);

    await post(thread, 'reply', REPLIER, { parent_id: open });
    await post(thread, 'another top-level comment');
    expect((await resolution(open)).is_resolved).toBe(false);
    expect(await resolution(done)).toEqual(settled);
  });

  it('the resolved filter and the unresolved-thread count: 3 threads, 1 resolved → 2', async () => {
    const { id: recordId, thread } = await newBoard();
    const a = await post(thread, 'a');
    const b = await post(thread, 'b');
    const c = await post(thread, 'c');
    await post(thread, 'reply under a', REPLIER, { parent_id: a });
    await post(thread, 'reply under b', REPLIER, { parent_id: b });
    await engine.update(COMMENT, { is_resolved: true }, { where: { id: b }, context: RESOLVER });

    const topLevel = { object_name: BOARD, record_id: recordId, parent_id: null };
    const unresolved = { ...topLevel, is_resolved: { $ne: true } };
    expect(await engine.count(COMMENT, { where: unresolved, context: AUTHOR } as any)).toBe(2);

    const open = await engine.find(COMMENT, { where: unresolved, orderBy: [{ field: 'created_at', order: 'asc' }], context: AUTHOR } as any);
    expect(open.map((r: Row) => String(r.id)).sort()).toEqual([a, c].sort());

    const resolved = await engine.find(COMMENT, { where: { ...topLevel, is_resolved: true }, context: AUTHOR } as any);
    expect(resolved.map((r: Row) => String(r.id))).toEqual([b]);
    expect(resolved[0].resolved_by).toBe(RESOLVER.userId);
  });

  it('a row that carries no value (written before the column existed) reads unresolved to the filter', async () => {
    const { id: recordId, thread } = await newBoard();
    const id = await post(thread, 'old');
    // Stand-in for a pre-column row on a driver that fills no default: the
    // column holds NULL.
    await engine.update(COMMENT, { is_resolved: null }, { where: { id }, context: SYS });
    expect((await read(id)).is_resolved ?? null).toBeNull();
    expect(
      await engine.count(COMMENT, { where: { object_name: BOARD, record_id: recordId, parent_id: null, is_resolved: { $ne: true } }, context: AUTHOR } as any),
    ).toBe(1);
  });

  it('resolving writes no entry on the record\'s own activity stream', async () => {
    const { id: recordId, thread } = await newBoard();
    const id = await post(thread, 'question');
    const before = await engine.count('sys_activity', { where: { object_name: BOARD, record_id: recordId }, context: SYS } as any);
    await engine.update(COMMENT, { is_resolved: true }, { where: { id }, context: RESOLVER });
    await engine.update(COMMENT, { is_resolved: false }, { where: { id }, context: RESOLVER });
    expect(await engine.count('sys_activity', { where: { object_name: BOARD, record_id: recordId }, context: SYS } as any)).toBe(before);
  });
});
