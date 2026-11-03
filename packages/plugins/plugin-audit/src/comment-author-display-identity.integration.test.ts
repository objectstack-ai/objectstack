// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A comment's display name and avatar are the server's, like its author id.
 *
 * `sys_comment.author_name` / `author_avatar_url` are what a reader is shown
 * beside a comment (the console's Discussion panel, the @mention notification
 * title). The create hook stamps both from the session user's own `sys_user`
 * profile — its display name and `image`, the resolution the record history's
 * actor columns use — over any value the client sent, and when it sent none.
 * On update both are `readonly`: the engine strips a non-system caller's value
 * and reports it (`droppedFields`), so an edit never changes whose name a
 * comment shows. A system write keeps what it supplies, as for `author_id`.
 *
 * `author_id` is held the same way (the second describe): a row's author is
 * read-only after creation, like its display name. The engine strips a
 * non-system caller's value on update and reports it, the author's edit and a
 * parent editor's alike; a system write and a historical import's update
 * (`preserveAudit`) keep the value they supply; and a create whose session
 * names no user is refused, since there is nobody to record.
 *
 * Same rig as `comment-edit-stamp.integration.test.ts` (real kernel, real
 * ObjectQL, real AuditPlugin, real SQLite driver), plus the platform's
 * `sys_user` object so the profile is a real row. Assertions are on the
 * stored row and the dropped-fields report.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysUser } from '@objectstack/platform-objects/identity';

import { AuditPlugin } from './audit-plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const COMMENT = 'sys_comment';
/** A parent object every caller reads. */
const BOARD = 'cad_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.comment-author-display-identity';

const SYS = { isSystem: true } as const;
const ADA = { id: 'u_ada', name: 'Ada Lovelace', email: 'ada@cad.test', image: 'https://cdn.cad.test/ada.png' };
const GRACE = { id: 'u_grace', name: 'Grace Hopper', email: 'grace@cad.test', image: 'https://cdn.cad.test/grace.png' };
/** A signed-in user with no `sys_user` row to read a profile from. */
const NO_PROFILE = 'u_no_profile';
const as = (userId: string) => ({ userId, positions: ['org_member'] });

const boardObject = {
  name: BOARD,
  label: 'Board',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

type Row = Record<string, any>;

// One rig for both describes below: the display identity and the author id it
// sits beside are one component.
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
  engine.registry.registerObject(SysUser as any, HARNESS_PACKAGE);
  engine.registry.registerObject(boardObject as any, HARNESS_PACKAGE);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  for (const user of [ADA, GRACE]) await engine.insert('sys_user', { ...user }, { context: SYS });
}, 120_000);

afterAll(async () => {
  if (kernel) {
    await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }
}, 30_000);

const newThread = async (): Promise<string> => {
  const board = await engine.insert(BOARD, { name: 'board' }, { context: SYS });
  return `${BOARD}:${board.id}`;
};
const post = async (userId: string, payload: Row): Promise<string> => {
  const created = await engine.insert(COMMENT, { thread_id: await newThread(), body: 'hello', ...payload }, { context: as(userId) });
  return String(created.id);
};
/** The stored identity columns, and nothing else, so a failure prints exactly them. */
const identity = async (id: string) => {
  const row = (await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row;
  return { author_id: row.author_id, author_name: row.author_name ?? null, author_avatar_url: row.author_avatar_url ?? null };
};

describe('sys_comment — the display name and avatar are stamped from the caller\'s session, like the author id', () => {
  it('a comment shows the caller\'s own name and avatar whatever the client sent, as its author id does', async () => {
    const id = await post(ADA.id, { author_id: GRACE.id, author_name: GRACE.name, author_avatar_url: GRACE.image });
    expect(await identity(id)).toEqual({ author_id: ADA.id, author_name: ADA.name, author_avatar_url: ADA.image });
  });

  it('a comment written without a display identity is stamped with the caller\'s own (the control)', async () => {
    const id = await post(GRACE.id, {});
    expect(await identity(id)).toEqual({ author_id: GRACE.id, author_name: GRACE.name, author_avatar_url: GRACE.image });
  });

  it('a caller whose profile cannot be read is stored with no display identity, never the client\'s', async () => {
    const id = await post(NO_PROFILE, { author_name: ADA.name, author_avatar_url: ADA.image });
    expect(await identity(id)).toEqual({ author_id: NO_PROFILE, author_name: null, author_avatar_url: null });
  });

  it('an update never changes the display identity: the client\'s value is stripped and reported', async () => {
    const id = await post(ADA.id, {});
    const drops: Row[] = [];
    await engine.update(
      COMMENT,
      { body: 'edited', author_name: GRACE.name, author_avatar_url: GRACE.image },
      { where: { id }, context: as(ADA.id), onFieldsDropped: (e: Row) => drops.push(e) } as any,
    );
    const row = (await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row;
    expect(row.body).toBe('edited');
    expect(await identity(id)).toEqual({ author_id: ADA.id, author_name: ADA.name, author_avatar_url: ADA.image });
    expect(drops).toEqual([
      expect.objectContaining({
        object: COMMENT,
        reason: 'readonly',
        fields: expect.arrayContaining(['author_name', 'author_avatar_url']),
      }),
    ]);
  });

  it('an edit by another user who may edit the parent keeps the author\'s display identity', async () => {
    const id = await post(ADA.id, {});
    await engine.update(COMMENT, { body: 'moderated', author_name: GRACE.name }, { where: { id }, context: as(GRACE.id) });
    expect(await identity(id)).toEqual({ author_id: ADA.id, author_name: ADA.name, author_avatar_url: ADA.image });
  });

  it('a system write keeps the display identity it supplies', async () => {
    const created = await engine.insert(
      COMMENT,
      { thread_id: await newThread(), body: 'imported', author_id: GRACE.id, author_name: 'Imported Name', author_avatar_url: null },
      { context: SYS },
    );
    const id = String(created.id);
    expect(await identity(id)).toEqual({ author_id: GRACE.id, author_name: 'Imported Name', author_avatar_url: null });

    await engine.update(COMMENT, { author_name: 'Re-imported Name' }, { where: { id }, context: SYS });
    expect((await identity(id)).author_name).toBe('Re-imported Name');
  });
});

describe('sys_comment — a row\'s author is read-only after creation, like its display name', () => {
  /** Run one update and collect what the engine reports it dropped. */
  const updateCollectingDrops = async (id: string, data: Row, context: Row): Promise<Row[]> => {
    const drops: Row[] = [];
    await engine.update(COMMENT, data, { where: { id }, context, onFieldsDropped: (e: Row) => drops.push(e) } as any);
    return drops;
  };
  const authorOf = async (id: string): Promise<unknown> =>
    ((await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row).author_id;

  it('the author\'s own edit never changes the author: the value is stripped and reported, and the body lands', async () => {
    const id = await post(ADA.id, {});
    const drops = await updateCollectingDrops(id, { body: 'edited by the author', author_id: GRACE.id }, as(ADA.id));
    expect(await authorOf(id)).toBe(ADA.id);
    expect(((await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row).body).toBe('edited by the author');
    expect(drops).toEqual([
      expect.objectContaining({ object: COMMENT, reason: 'readonly', fields: expect.arrayContaining(['author_id']) }),
    ]);
  });

  it('a parent editor\'s edit never changes the author either', async () => {
    const id = await post(ADA.id, {});
    const drops = await updateCollectingDrops(id, { body: 'moderated', author_id: GRACE.id }, as(GRACE.id));
    expect(await authorOf(id)).toBe(ADA.id);
    expect(drops).toEqual([
      expect.objectContaining({ object: COMMENT, reason: 'readonly', fields: expect.arrayContaining(['author_id']) }),
    ]);
  });

  it('control: an ordinary edit that does not name the author lands and drops nothing', async () => {
    const id = await post(ADA.id, {});
    const drops = await updateCollectingDrops(id, { body: 'a plain edit' }, as(ADA.id));
    expect(((await engine.findOne(COMMENT, { where: { id }, context: SYS })) as Row).body).toBe('a plain edit');
    expect(await authorOf(id)).toBe(ADA.id);
    expect(drops).toEqual([]);
  });

  it('control: a system write keeps the author it supplies', async () => {
    const id = await post(ADA.id, {});
    await engine.update(COMMENT, { author_id: GRACE.id }, { where: { id }, context: SYS });
    expect(await authorOf(id)).toBe(GRACE.id);
  });

  it('control: a historical import\'s update (preserveAudit) keeps the author it supplies', async () => {
    const id = await post(ADA.id, {});
    await engine.update(COMMENT, { author_id: GRACE.id }, { where: { id }, context: { ...as(ADA.id), preserveAudit: true } });
    expect(await authorOf(id)).toBe(GRACE.id);
  });

  it('a create whose session names no user is refused: there is nobody to record as the author', async () => {
    const thread = await newThread();
    await expect(
      engine.insert(COMMENT, { thread_id: thread, body: 'nobody wrote this', author_id: GRACE.id }, { context: { positions: ['org_member'] } }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_ACCESSIBLE', status: 403 });
    expect(await engine.find(COMMENT, { where: { thread_id: thread }, context: SYS })).toEqual([]);
  });
});
