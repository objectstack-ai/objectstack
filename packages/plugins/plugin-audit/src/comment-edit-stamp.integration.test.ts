// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform marks a comment edited (#23124, maintainer ruling A).
 *
 * `sys_comment.is_edited` / `edited_at` were declared with no platform writer:
 * an author's edit left both untouched unless the client that made it wrote
 * them, and any client could write them on any update or create. Under the
 * ruling the comment's `beforeUpdate` stamps both when the BODY changes, and
 * both are read-only at the data door.
 *
 * Measured on this change's base (`1ca7a805c`), same rig as this file (real
 * kernel, real ObjectQL, real AuditPlugin, real SQLite driver), as the author:
 * a body edit stored `is_edited: false` / `edited_at: null`; an update carrying
 * `{ is_edited: true, edited_at: <forged> }` stored both; a create carrying them
 * stored both. Every pin below was red there for the reason it names.
 *
 * Which shape "read-only" takes was measured too, on the `created_at` precedent:
 * on update the engine hides a non-system caller's `readonly` value from the
 * hooks and strips it afterwards, reporting it through `onFieldsDropped` (the
 * REST door's `droppedFields`); it refuses only for an in-process caller that
 * opts into `strictReadonlyWrites`, which no transport passes. On create a
 * `sys_` object is left to its own guards. So a client's value never lands —
 * overwritten by the stamp on an edit, stripped and reported without one, and
 * replaced by the create hook on a create — and the write is never refused: the
 * console released before this change sends both fields on every edit.
 *
 * Assertions are on the stored row, the dropped-fields report and, for the one
 * refusal, the wire envelope — never on a bare throw.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { mapDataError } from '@objectstack/types';

import { AuditPlugin } from './audit-plugin.js';

const COMMENT = 'sys_comment';
/** A parent object every caller reads. */
const BOARD = 'es_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-edit-stamp';

const SYS = { isSystem: true } as const;
const AUTHOR = { userId: 'u_author', positions: ['org_member'] };
/** A value no server clock in this run can produce. */
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

describe('sys_comment — the platform stamps an edit of the body (#23124)', () => {
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
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  /** A fresh thread per test, so a predicate write reaches only its own rows. */
  const newThread = async (): Promise<string> => {
    const board = await engine.insert(BOARD, { name: 'board' }, { context: SYS });
    return `${BOARD}:${board.id}`;
  };
  const post = async (threadId: string, body: string, extra: Row = {}): Promise<string> => {
    const created = await engine.insert(
      COMMENT,
      { thread_id: threadId, author_id: AUTHOR.userId, body, ...extra },
      { context: AUTHOR },
    );
    return String(created.id);
  };
  const read = async (id: string): Promise<Row> =>
    (await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row;
  /** The stored mark, and nothing else, so a failure prints exactly it. */
  const mark = async (id: string) => {
    const row = await read(id);
    return { is_edited: row.is_edited, edited_at: row.edited_at ?? null };
  };
  /** `edited_at` was taken from the server clock inside [from, to]. */
  const expectServerClock = (value: unknown, from: number, to: number) => {
    expect(typeof value, `edited_at ${JSON.stringify(value)} is not a timestamp`).toBe('string');
    const at = Date.parse(value as string);
    expect(at, `edited_at ${String(value)} is not the server clock of this write`).toBeGreaterThanOrEqual(from);
    expect(at, `edited_at ${String(value)} is not the server clock of this write`).toBeLessThanOrEqual(to);
  };

  it('an author edit of the body stamps is_edited and edited_at from the server clock', async () => {
    const id = await post(await newThread(), 'original');
    const from = Date.now();
    await engine.update(COMMENT, { body: 'edited' }, { where: { id }, context: AUTHOR });
    const to = Date.now();

    const row = await read(id);
    expect(row.body).toBe('edited');
    expect(row.is_edited).toBe(true);
    expectServerClock(row.edited_at, from, to);
  });

  it('a mentions-only edit is not an edit — with or without the unchanged body beside it', async () => {
    const id = await post(await newThread(), 'hello @ada');

    await engine.update(COMMENT, { mentions: '["u_ada"]' }, { where: { id }, context: AUTHOR });
    expect(await mark(id), 'an update that does not name `body` stamped the comment').toEqual({
      is_edited: false,
      edited_at: null,
    });

    // The console's shape: the stored text sent again, `mentions` rewritten.
    await engine.update(COMMENT, { body: 'hello @ada', mentions: '[]' }, { where: { id }, context: AUTHOR });
    expect(await mark(id), 'an update re-sending the stored body stamped the comment').toEqual({
      is_edited: false,
      edited_at: null,
    });
    expect((await read(id)).mentions).toBe('[]');
  });

  it('a create does not stamp — and a create cannot arrive already marked edited', async () => {
    const thread = await newThread();
    const plain = await post(thread, 'new');
    expect(await mark(plain)).toEqual({ is_edited: false, edited_at: null });

    const forged = await post(thread, 'new, claiming an edit', { is_edited: true, edited_at: FORGED });
    expect(await mark(forged), 'a client-supplied mark landed on create').toEqual({
      is_edited: false,
      edited_at: null,
    });
  });

  it('on an edit a client cannot clear or forge the mark: the stamp overwrites what it sent', async () => {
    const id = await post(await newThread(), 'original');
    const from = Date.now();
    await engine.update(
      COMMENT,
      { body: 'edited', is_edited: false, edited_at: FORGED },
      { where: { id }, context: AUTHOR },
    );
    const to = Date.now();

    const row = await read(id);
    expect(row.is_edited, 'the client cleared the mark on its own edit').toBe(true);
    expectServerClock(row.edited_at, from, to);
  });

  it('without an edit a client can neither set nor clear the mark: the value is stripped and reported', async () => {
    const id = await post(await newThread(), 'original');

    const forgeDrops: Row[] = [];
    await engine.update(
      COMMENT,
      { is_edited: true, edited_at: FORGED },
      { where: { id }, context: AUTHOR, onFieldsDropped: (e: Row) => forgeDrops.push(e) } as any,
    );
    expect(await mark(id), 'a client marked an unedited comment edited').toEqual({
      is_edited: false,
      edited_at: null,
    });
    expect(forgeDrops).toEqual([
      expect.objectContaining({ object: COMMENT, reason: 'readonly', fields: expect.arrayContaining(['is_edited', 'edited_at']) }),
    ]);

    await engine.update(COMMENT, { body: 'edited' }, { where: { id }, context: AUTHOR });
    const stamped = await mark(id);
    expect(stamped.is_edited).toBe(true);

    const clearDrops: Row[] = [];
    await engine.update(
      COMMENT,
      { is_edited: false, edited_at: null },
      { where: { id }, context: AUTHOR, onFieldsDropped: (e: Row) => clearDrops.push(e) } as any,
    );
    expect(await mark(id), 'a client cleared the mark of an edited comment').toEqual(stamped);
    expect(clearDrops).toEqual([
      expect.objectContaining({ object: COMMENT, reason: 'readonly', fields: expect.arrayContaining(['is_edited', 'edited_at']) }),
    ]);
  });

  it('a predicate update runs the stamp per matched row: every row whose body changes is stamped', async () => {
    const thread = await newThread();
    const a = await post(thread, 'first');
    const b = await post(thread, 'second');
    const from = Date.now();
    await engine.update(COMMENT, { body: 'rewritten' }, { where: { thread_id: thread }, multi: true, context: AUTHOR } as any);
    const to = Date.now();

    for (const id of [a, b]) {
      const row = await read(id);
      expect(row.body).toBe('rewritten');
      expect(row.is_edited, `matched row ${id} was not stamped`).toBe(true);
      expectServerClock(row.edited_at, from, to);
    }
  });

  it('a predicate update that changes no body stamps no row', async () => {
    const thread = await newThread();
    const a = await post(thread, 'same');
    const b = await post(thread, 'same');
    await engine.update(COMMENT, { body: 'same' }, { where: { thread_id: thread }, multi: true, context: AUTHOR } as any);

    for (const id of [a, b]) {
      expect(await mark(id), `unchanged row ${id} was stamped`).toEqual({ is_edited: false, edited_at: null });
    }
  });

  it('a predicate update whose rows disagree is refused whole — nothing is written', async () => {
    const thread = await newThread();
    const already = await post(thread, 'target');
    const changing = await post(thread, 'other');

    const error = await refusal(() =>
      engine.update(COMMENT, { body: 'target' }, { where: { thread_id: thread }, multi: true, context: AUTHOR } as any),
    );
    expect(error, 'a mixed predicate update was accepted').toBeDefined();
    const wire = mapDataError(error, COMMENT);
    expect(wire.status).toBe(400);
    expect(wire.body.code).toBe('MULTI_UPDATE_HOOK_KEY_DIVERGENCE');
    expect((error as { keys?: unknown }).keys).toEqual(['edited_at', 'is_edited']);

    expect((await read(changing)).body).toBe('other');
    for (const id of [already, changing]) {
      expect(await mark(id)).toEqual({ is_edited: false, edited_at: null });
    }
  });

  it('every caller is stamped: a system-context edit of the body marks the comment too', async () => {
    const id = await post(await newThread(), 'original');
    const from = Date.now();
    await engine.update(COMMENT, { body: 'moderated' }, { where: { id }, context: SYS });
    const to = Date.now();

    const row = await read(id);
    expect(row.is_edited).toBe(true);
    expectServerClock(row.edited_at, from, to);
  });

  it('a historical import (preserveAudit) keeps the mark it supplies, as it keeps updated_at', async () => {
    const id = await post(await newThread(), 'original');
    await engine.update(
      COMMENT,
      { body: 'imported text', is_edited: true, edited_at: FORGED },
      { where: { id }, context: { ...AUTHOR, preserveAudit: true } } as any,
    );
    const row = await read(id);
    expect(row.is_edited).toBe(true);
    expect(row.edited_at).toBe(FORGED);
  });
});
