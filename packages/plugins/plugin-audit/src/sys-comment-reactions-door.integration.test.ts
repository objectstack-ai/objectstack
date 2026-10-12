// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A write that still names the retired `sys_comment.reactions` column is
 * refused loudly (#22573, ruling A on #22505 as amended).
 *
 * The column retired with nothing in its place and no data migration, so the
 * one question left for a client that still writes it — the console before
 * its pin moved, or any other — is what the data door answers. Measured on a
 * booted showcase over the REST door (`POST` and `PATCH
 * /api/v1/data/sys_comment` carrying `reactions`): before the retirement both
 * stored the map (201 / 200); after it both answer `400 INVALID_FIELD` naming
 * the field, and nothing is written. This file pins that answer on the real
 * engine, the real plugin and a real driver: the refusal is the engine's
 * undeclared-field preflight, decided from `sys_comment`'s declared field map
 * before any hook or driver runs, and `mapDataError` is the step the REST door
 * takes from the thrown error to the wire.
 *
 * A silent drop would be the failure: a client would believe its reaction was
 * saved. The assertions are on the envelope (`code`, `status`, the named
 * field) and on the stored rows, never on a bare throw.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { mapDataError } from '@objectstack/types';

import { AuditPlugin } from './audit-plugin.js';

const COMMENT = 'sys_comment';
/** A parent object every caller reads. */
const OPEN = 'rr_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-reactions-door';

const SYS = { isSystem: true } as const;
const AUTHOR = { userId: 'u_author', positions: ['org_member'] };

const openObject = {
  name: OPEN,
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

describe('sys_comment — a write naming the retired reactions column is refused, not dropped (#22573)', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let threadId: string;
  let commentId: string;

  const REACTIONS = JSON.stringify({ '👍': [AUTHOR.userId] });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(openObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    const board = await engine.insert(OPEN, { name: 'board' }, { context: SYS });
    threadId = `${OPEN}:${board.id}`;
    // The control: the same create without `reactions` goes through the door,
    // so the refusals below are about the key and nothing else.
    const created = await engine.insert(
      COMMENT,
      { thread_id: threadId, author_id: AUTHOR.userId, body: 'original' },
      { context: AUTHOR },
    );
    commentId = String(created.id);
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('create: 400 INVALID_FIELD naming `reactions`, and no comment row is written', async () => {
    const error = await refusal(() =>
      engine.insert(
        COMMENT,
        { thread_id: threadId, author_id: AUTHOR.userId, body: 'with reactions', reactions: REACTIONS },
        { context: AUTHOR },
      ),
    );
    expect(error, 'a create carrying `reactions` was accepted').toBeDefined();
    const wire = mapDataError(error, COMMENT);
    expect(wire.status).toBe(400);
    expect(wire.body.code).toBe('INVALID_FIELD');
    expect(wire.body.field).toBe('reactions');

    const rows = (await engine.find(COMMENT, { context: SYS })) as Row[];
    expect(rows.filter((r) => r.body === 'with reactions')).toHaveLength(0);
  });

  it('update: 400 INVALID_FIELD naming `reactions`, and the comment row is unchanged', async () => {
    const error = await refusal(() =>
      engine.update(
        COMMENT,
        { body: 'edited', reactions: REACTIONS },
        { where: { id: commentId }, context: AUTHOR },
      ),
    );
    expect(error, 'an update carrying `reactions` was accepted').toBeDefined();
    const wire = mapDataError(error, COMMENT);
    expect(wire.status).toBe(400);
    expect(wire.body.code).toBe('INVALID_FIELD');
    expect(wire.body.field).toBe('reactions');

    const row = (await engine.findOne(COMMENT, { where: { id: commentId }, context: SYS })) as Row;
    expect(row.body).toBe('original');
    expect(Object.keys(row)).not.toContain('reactions');
  });
});
