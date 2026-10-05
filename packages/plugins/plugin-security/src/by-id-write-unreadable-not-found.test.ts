// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On the write doors, a row the caller cannot READ is a row that does not
 * exist — measured through a real `ObjectQL` over a real SQL driver, with the
 * real `SecurityPlugin` middleware in front of it.
 *
 * ## What is pinned
 *
 *  1. The ADDRESSED by-id update and delete of a row the caller cannot read
 *     answer exactly what the same verbs answer for an id that exists nowhere:
 *     the read door's not-found, the same code, status and sentence (the one
 *     difference is the id the caller supplied).
 *  2. A caller who can read the row but may not write it keeps `403
 *     PERMISSION_DENIED` with the record-level sentence: they already see it.
 *  3. A writable row the caller can read is still written.
 *  4. By-id writes the platform issues UNDER the caller's context — the
 *     engine's cascade delete of a dependent row, and a hook's `ctx.api`
 *     write — are not addressed by the caller, so they keep the answer they
 *     had before: the record-level 403, which names nothing. A not-found there
 *     would carry an id the caller never supplied.
 *
 * The rig is one permission set over two objects: a public parent, and a
 * child whose rows a caller reads when it owns them or they are flagged
 * shared, and writes only when it owns them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { recordNotFoundError } from '@objectstack/core';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const RECORD_SENTENCE = BUILTIN_OPERATION_MESSAGES.en.record_access_denied!;

const PARENT = 'qa_nf_parent';
const CHILD = 'qa_nf_child';
const ME = 'usr_nf_member';
const OTHER = 'usr_nf_other';
const CALLER = { userId: ME, positions: ['qa_pos'], permissions: ['qa_nf_guard'], posture: 'MEMBER' };

interface Refusal { code?: string; status?: number; message: string; name?: string }
type Outcome = { kind: 'landed' } | ({ kind: 'refused' } & Refusal);

interface Rig {
  engine: ObjectQL;
  update: (object: string, id: string, data?: Record<string, unknown>) => Promise<Outcome>;
  remove: (object: string, id: string) => Promise<Outcome>;
  stored: (object: string, id: string) => Promise<Record<string, unknown> | null>;
  teardown: () => Promise<void>;
}
const rigs: Rig[] = [];
afterEach(async () => {
  for (const rig of rigs.splice(0)) await rig.teardown();
});

async function boot(): Promise<Rig> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.by-id-write-unreadable-not-found',
    name: 'By-id write: an unreadable row is a missing row',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: PARENT,
        label: 'Parent',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
      {
        name: CHILD,
        label: 'Child',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner: { name: 'owner', type: 'text' },
          shared: { name: 'shared', type: 'boolean' },
          parent: { name: 'parent', type: 'lookup', reference: PARENT, deleteBehavior: 'cascade' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert(PARENT, [
    { id: 'p_plain', name: 'plain' },
    { id: 'p_cascade', name: 'has a hidden child' },
    { id: 'p_hook', name: 'hooked' },
  ], SYS);
  await engine.insert(CHILD, [
    { id: 'c_own', name: 'mine', owner: ME, shared: false },
    { id: 'c_hidden', name: 'theirs, private', owner: OTHER, shared: false },
    { id: 'c_shared', name: 'theirs, shared', owner: OTHER, shared: true },
    { id: 'c_kid', name: 'theirs, under the cascade parent', owner: OTHER, shared: false, parent: 'p_cascade' },
  ], SYS);

  const set = PermissionSetSchema.parse({
    name: 'qa_nf_guard',
    objects: {
      [PARENT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      [CHILD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    },
    rowLevelSecurity: [
      { name: 'child_read', object: CHILD, operation: 'select', using: 'record.owner == current_user.id || record.shared == true' },
      { name: 'child_update', object: CHILD, operation: 'update', using: 'record.owner == current_user.id' },
      { name: 'child_delete', object: CHILD, operation: 'delete', using: 'record.owner == current_user.id' },
    ],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  const rig: Rig = {
    engine,
    update: (object: string, id: string, data: Record<string, unknown> = { name: 'renamed' }) =>
      outcome(engine.update(object, data, { where: { id }, context: { ...CALLER } } as never)),
    remove: (object: string, id: string) =>
      outcome(engine.delete(object, { where: { id }, context: { ...CALLER } } as never)),
    stored: async (object: string, id: string) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
  rigs.push(rig);
  return rig;
}

function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    () => ({ kind: 'landed' as const }),
    (e: any) => ({
      kind: 'refused' as const,
      code: e?.code,
      status: e?.statusCode ?? e?.status,
      message: String(e?.message),
      name: e?.name,
    }),
  );
}

/** The whole refusal with the caller-supplied id written out of the sentence. */
function withoutId(o: Outcome, id: string): Outcome {
  return o.kind === 'refused' ? { ...o, message: o.message.split(id).join('ID') } : o;
}

describe('a by-id write to a row the caller cannot read answers what a nonexistent id answers', () => {
  for (const verb of ['update', 'delete'] as const) {
    it(`${verb}: the hidden row and the missing id get one answer, the read door's not-found`, async () => {
      const r = await boot();
      // The precondition, read off the read door: the caller does not see it.
      expect(await r.engine.findOne(CHILD, { where: { id: 'c_hidden' }, context: { ...CALLER } } as never)).toBeNull();

      const hidden = verb === 'update' ? await r.update(CHILD, 'c_hidden') : await r.remove(CHILD, 'c_hidden');
      const missing = verb === 'update' ? await r.update(CHILD, 'c_nowhere') : await r.remove(CHILD, 'c_nowhere');

      expect(hidden).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      expect(hidden).toMatchObject({ message: (recordNotFoundError(CHILD, 'c_hidden') as Error).message });
      expect(withoutId(hidden, 'c_hidden')).toEqual(withoutId(missing, 'c_nowhere'));
      // Refused means untouched.
      expect((await r.stored(CHILD, 'c_hidden'))?.name).toBe('theirs, private');
    });

    it(`${verb}: a caller who can read the row but may not write it keeps 403 PERMISSION_DENIED`, async () => {
      const r = await boot();
      expect(await r.engine.findOne(CHILD, { where: { id: 'c_shared' }, context: { ...CALLER } } as never)).toBeTruthy();

      const got = verb === 'update' ? await r.update(CHILD, 'c_shared') : await r.remove(CHILD, 'c_shared');

      expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: RECORD_SENTENCE });
      expect((await r.stored(CHILD, 'c_shared'))?.name).toBe('theirs, shared');
    });

    it(`${verb}: a row the caller reads and may write is still written`, async () => {
      const r = await boot();
      const got = verb === 'update' ? await r.update(CHILD, 'c_own') : await r.remove(CHILD, 'c_own');
      expect(got).toEqual({ kind: 'landed' });
      const after = await r.stored(CHILD, 'c_own');
      if (verb === 'update') expect(after?.name).toBe('renamed');
      else expect(after).toBeNull();
    });
  }
});

describe('a by-id write the platform issues under the caller\'s context keeps the answer it had', () => {
  it('the cascade delete of a dependent row the caller cannot read refuses with the record-level 403, naming nothing', async () => {
    const r = await boot();
    const got = await r.remove(PARENT, 'p_cascade');

    expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: RECORD_SENTENCE });
    expect(got.kind === 'refused' && got.message).not.toContain('c_kid');
    // One unit of work: neither the dependent nor the parent went.
    expect(await r.stored(CHILD, 'c_kid')).toBeTruthy();
    expect(await r.stored(PARENT, 'p_cascade')).toBeTruthy();
  });

  it('a hook\'s by-id write to a row the caller cannot read refuses with the record-level 403, not the not-found', async () => {
    const r = await boot();
    r.engine.registerHook(
      'beforeUpdate',
      async (hookCtx: any) => {
        await hookCtx.api.object(CHILD).updateById('c_hidden', { name: 'written by the hook' });
      },
      { object: PARENT, packageId: 'com.objectstack.qa.by-id-write-unreadable-not-found' },
    );

    const got = await r.update(PARENT, 'p_hook');

    expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: RECORD_SENTENCE });
    expect(got.kind === 'refused' && got.message).not.toContain('c_hidden');
    expect((await r.stored(CHILD, 'c_hidden'))?.name).toBe('theirs, private');
    expect((await r.stored(PARENT, 'p_hook'))?.name).toBe('hooked');
  });

  it('the same caller addressing that row itself gets the not-found — the line is who addressed it', async () => {
    const r = await boot();
    expect(await r.update(CHILD, 'c_hidden')).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect(await r.remove(CHILD, 'c_kid')).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
  });
});
