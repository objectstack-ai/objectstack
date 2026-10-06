// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On the write doors, a row the caller cannot READ is a row that does not
 * exist — on the PREDICATE door too. Measured through a real `ObjectQL` over a
 * real SQL driver, with the real `SecurityPlugin` middleware in front of it.
 *
 * ## What is pinned
 *
 *  1. A predicate update or delete the caller addressed matches only rows the
 *     caller can read. A predicate that matches only rows the caller cannot
 *     read answers exactly what a predicate that matches nothing answers:
 *     success, zero rows, nothing written.
 *  2. A predicate matching hidden and visible rows changes only the visible
 *     rows, and the affected count is the visible count.
 *  3. A caller who can read a matched row but may not write it keeps the 403 a
 *     per-row gate answers, as before.
 *  4. A visible, writable match is still written (control).
 *  5. The read question's three outcomes: a read the read door REFUSES keeps
 *     the write's previous answer; a store fault propagates; a readable set
 *     larger than one write may name is refused, nothing written.
 *  6. A predicate write the platform issues under the caller's context (a
 *     hook's own write) is not addressed by the caller and keeps the answer it
 *     had before.
 *  7. The by-id doors keep their answers (regression).
 *
 * ## The rig
 *
 * One object whose rows a caller reads when it owns them or they are flagged
 * shared, and whose write-class policies admit rows the caller owns OR rows of
 * one team — so the write scope reaches rows the read scope hides, the shape a
 * parent-derived read gate also produces. A per-row `before*` gate refuses a
 * locked row with the platform's 403, as the parent-derived gates do for a
 * row they will not let the caller write.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { MAX_BULK_PER_ROW_HOOK_ROWS } from '@objectstack/spec/data';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PACKAGE = 'com.objectstack.qa.predicate-write-unreadable-not-matched';

const PARENT = 'qa_pw_parent';
const CHILD = 'qa_pw_child';
const BULK = 'qa_pw_bulk';
const ME = 'usr_pw_member';
const OTHER = 'usr_pw_other';
const CALLER = { userId: ME, positions: ['qa_pos'], permissions: ['qa_pw_guard'], posture: 'MEMBER' };
const WRITE_ONLY_CALLER = { userId: ME, positions: ['qa_pos'], permissions: ['qa_pw_write_only'], posture: 'MEMBER' };
const GATE_SENTENCE = 'You do not have access to this record.';

type Outcome =
  | { kind: 'landed'; result: unknown }
  | { kind: 'refused'; code?: string; status?: number; message: string };

interface Rig {
  engine: ObjectQL;
  update: (where: Record<string, unknown>, context?: Record<string, unknown>) => Promise<Outcome>;
  remove: (where: Record<string, unknown>, context?: Record<string, unknown>) => Promise<Outcome>;
  stored: (object: string, id: string) => Promise<Record<string, unknown> | null>;
  failReads: { on: boolean };
  teardown: () => Promise<void>;
}
const rigs: Rig[] = [];
afterEach(async () => {
  for (const rig of rigs.splice(0)) await rig.teardown();
});

function outcome(p: Promise<unknown>): Promise<Outcome> {
  return p.then(
    (result) => ({ kind: 'landed' as const, result }),
    (e: any) => ({
      kind: 'refused' as const,
      code: e?.code,
      status: e?.statusCode ?? e?.status,
      message: String(e?.message),
    }),
  );
}

async function boot(opts: { bulkRows?: number } = {}): Promise<Rig> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  const childFields = {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    owner: { name: 'owner', type: 'text' },
    team: { name: 'team', type: 'text' },
    shared: { name: 'shared', type: 'boolean' },
    locked: { name: 'locked', type: 'boolean' },
  };
  engine.registerApp({
    id: PACKAGE,
    name: 'Predicate write: an unreadable row is not matched',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: PARENT,
        label: 'Parent',
        sharingModel: 'public_read_write',
        fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
      },
      { name: CHILD, label: 'Child', sharingModel: 'public_read_write', fields: childFields },
      { name: BULK, label: 'Bulk', sharingModel: 'public_read_write', fields: childFields },
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert(PARENT, [{ id: 'p_hook', name: 'hooked' }], SYS);
  await engine.insert(CHILD, [
    // readable (own) and writable
    { id: 'c_own', name: 'mine', owner: ME, team: 'x', shared: false, locked: false },
    // hidden from the read door; the write scope reaches it (the team clause);
    // the per-row gate refuses it
    { id: 'c_hidden_locked', name: 'theirs, hidden, locked', owner: OTHER, team: 'ops', shared: false, locked: true },
    // hidden; the write scope reaches it; the gate passes it
    { id: 'c_hidden_open', name: 'theirs, hidden, open', owner: OTHER, team: 'ops', shared: false, locked: false },
    // readable (shared); the write scope reaches it; the gate refuses it
    { id: 'c_shared_locked', name: 'theirs, shared, locked', owner: OTHER, team: 'ops', shared: true, locked: true },
    // readable (shared); the write scope does not reach it
    { id: 'c_shared', name: 'theirs, shared', owner: OTHER, team: 'x', shared: true, locked: false },
  ], SYS);
  if (opts.bulkRows) {
    const rows = Array.from({ length: opts.bulkRows }, (_, i) => ({
      id: `b_${i}`, name: 'bulk', owner: ME, team: 'x', shared: false, locked: false,
    }));
    for (let i = 0; i < rows.length; i += 500) await engine.insert(BULK, rows.slice(i, i + 500), SYS);
  }

  const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  const rls = (object: string) => [
    { name: `${object}_read`, object, operation: 'select', using: 'record.owner == current_user.id || record.shared == true' },
    { name: `${object}_update`, object, operation: 'update', using: "record.owner == current_user.id || record.team == 'ops'" },
    { name: `${object}_delete`, object, operation: 'delete', using: "record.owner == current_user.id || record.team == 'ops'" },
  ];
  const guard = PermissionSetSchema.parse({
    name: 'qa_pw_guard',
    objects: { [PARENT]: crud, [CHILD]: crud, [BULK]: crud },
    rowLevelSecurity: [...rls(CHILD), ...rls(BULK)],
  });
  // Edit and delete on the child, and no read: the read door refuses this
  // caller outright, which is not a hidden row.
  const writeOnly = PermissionSetSchema.parse({
    name: 'qa_pw_write_only',
    objects: { [CHILD]: { allowRead: false, allowCreate: false, allowEdit: true, allowDelete: true } },
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, guard, writeOnly],
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

  // A store that faults on the child's READS while armed — registered after
  // the security middleware, so it sits where the driver does.
  const failReads = { on: false };
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (failReads.on && opCtx.operation === 'find' && !opCtx.context?.isSystem) {
      throw new Error('store unavailable');
    }
    await next();
  }, { object: CHILD });

  // The per-row gate: a locked row is refused with the platform's 403.
  for (const event of ['beforeUpdate', 'beforeDelete'] as const) {
    engine.registerHook(
      event,
      async (hookCtx: any) => {
        if (hookCtx?.session?.isSystem) return;
        const id = hookCtx?.input?.id;
        if (id == null) return;
        const row = await engine.findOne(CHILD, { where: { id }, context: { isSystem: true } } as never);
        if (row?.locked) {
          const err: any = new Error(GATE_SENTENCE);
          err.code = 'PERMISSION_DENIED';
          err.status = 403;
          throw err;
        }
      },
      { object: CHILD, packageId: PACKAGE },
    );
  }

  const rig: Rig = {
    engine,
    update: (where, context = CALLER) =>
      outcome(engine.update(CHILD, { name: 'swept' }, { where, multi: true, context: { ...context } } as never)),
    remove: (where, context = CALLER) =>
      outcome(engine.delete(CHILD, { where, multi: true, context: { ...context } } as never)),
    stored: async (object, id) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    failReads,
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
  rigs.push(rig);
  return rig;
}

const ids = (...list: string[]) => ({ id: { $in: list } });

/** Every child row's name, by id — what a write left behind. */
async function names(r: Rig): Promise<Record<string, unknown>> {
  const rows = (await r.engine.find(CHILD, { context: { isSystem: true } } as never)) as Array<Record<string, unknown>>;
  return Object.fromEntries(rows.map((row) => [String(row.id), row.name]));
}

describe('a predicate write matches only the rows the caller can read', () => {
  for (const verb of ['update', 'delete'] as const) {
    const write = (r: Rig, where: Record<string, unknown>, context?: Record<string, unknown>) =>
      verb === 'update' ? r.update(where, context) : r.remove(where, context);

    it(`${verb}: a predicate matching only hidden rows answers what a predicate matching nothing answers`, async () => {
      const r = await boot();
      // The precondition, read off the read door: the caller sees none of them.
      expect(await r.engine.find(CHILD, { where: ids('c_hidden_locked', 'c_hidden_open'), context: { ...CALLER } } as never)).toEqual([]);
      const before = await names(r);

      const hidden = await write(r, ids('c_hidden_locked', 'c_hidden_open'));
      const nothing = await write(r, ids('c_nowhere'));

      expect(nothing).toEqual({ kind: 'landed', result: 0 });
      expect(hidden).toEqual(nothing);
      // Not written, not removed.
      expect(await names(r)).toEqual(before);
    });

    it(`${verb}: a predicate matching hidden and visible rows changes only the visible rows, and counts them`, async () => {
      const r = await boot();
      const got = await write(r, ids('c_own', 'c_hidden_locked', 'c_hidden_open'));

      expect(got).toEqual({ kind: 'landed', result: 1 });
      const after = await names(r);
      if (verb === 'update') expect(after.c_own).toBe('swept');
      else expect(after).not.toHaveProperty('c_own');
      expect(after.c_hidden_locked).toBe('theirs, hidden, locked');
      expect(after.c_hidden_open).toBe('theirs, hidden, open');
    });

    it(`${verb}: a caller who can read a matched row but may not write it keeps the 403`, async () => {
      const r = await boot();
      expect(await r.engine.findOne(CHILD, { where: { id: 'c_shared_locked' }, context: { ...CALLER } } as never)).toBeTruthy();
      const before = await names(r);

      const got = await write(r, ids('c_own', 'c_shared_locked'));

      expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: GATE_SENTENCE });
      expect(await names(r)).toEqual(before);
    });

    it(`${verb}: a visible, writable match is still written (control)`, async () => {
      const r = await boot();
      expect(await write(r, ids('c_own'))).toEqual({ kind: 'landed', result: 1 });
      const after = await r.stored(CHILD, 'c_own');
      if (verb === 'update') expect(after?.name).toBe('swept');
      else expect(after).toBeNull();
    });

    it(`${verb}: a caller the read door REFUSES keeps the answer the write had — a refusal is not a hidden row`, async () => {
      const r = await boot();
      await expect(r.engine.find(CHILD, { context: { ...WRITE_ONLY_CALLER } } as never)).rejects.toMatchObject({ status: 403 });

      const got = await write(r, ids('c_hidden_open', 'c_shared'), WRITE_ONLY_CALLER);

      // No read question narrowed it: both rows are matched and changed.
      expect(got).toEqual({ kind: 'landed', result: 2 });
    });

    it(`${verb}: a store fault on the read question propagates, and nothing is written`, async () => {
      const r = await boot();
      const before = await names(r);
      r.failReads.on = true;

      const got = await write(r, ids('c_own'));

      r.failReads.on = false;
      expect(got).toMatchObject({ kind: 'refused', message: 'store unavailable' });
      expect(await names(r)).toEqual(before);
    });
  }

  it('a readable set larger than one predicate write may name is refused, and nothing is written', async () => {
    const r = await boot({ bulkRows: MAX_BULK_PER_ROW_HOOK_ROWS + 1 });
    const got = await outcome(
      r.engine.update(BULK, { name: 'swept' }, { where: { team: 'x' }, multi: true, context: { ...CALLER } } as never),
    );
    expect(got).toMatchObject({ kind: 'refused', code: 'INVALID_FILTER', status: 400 });
    const swept = await r.engine.count(BULK, { where: { name: 'swept' }, context: { isSystem: true } } as never);
    expect(swept).toBe(0);
  }, 60_000);
});

describe('a predicate write the platform issues under the caller\'s context keeps the answer it had', () => {
  it('a hook\'s own predicate write reaching a hidden row the gate refuses still answers the gate\'s 403', async () => {
    const r = await boot();
    r.engine.registerHook(
      'beforeUpdate',
      async (hookCtx: any) => {
        await hookCtx.api.object(CHILD).update({ name: 'written by the hook' }, { where: ids('c_hidden_locked'), multi: true });
      },
      { object: PARENT, packageId: PACKAGE },
    );

    const got = await outcome(
      r.engine.update(PARENT, { name: 'renamed' }, { where: { id: 'p_hook' }, context: { ...CALLER } } as never),
    );

    expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: GATE_SENTENCE });
    expect((await r.stored(CHILD, 'c_hidden_locked'))?.name).toBe('theirs, hidden, locked');
    expect((await r.stored(PARENT, 'p_hook'))?.name).toBe('hooked');
  });

  it('the same caller addressing that predicate itself matches nothing — the line is who addressed it', async () => {
    const r = await boot();
    expect(await r.update(ids('c_hidden_locked'))).toEqual({ kind: 'landed', result: 0 });
  });
});

describe('the by-id doors keep their answers', () => {
  it('a by-id update or delete of a hidden row still answers the read door\'s not-found', async () => {
    const r = await boot();
    const upd = await outcome(r.engine.update(CHILD, { name: 'x' }, { where: { id: 'c_hidden_open' }, context: { ...CALLER } } as never));
    const del = await outcome(r.engine.delete(CHILD, { where: { id: 'c_hidden_open' }, context: { ...CALLER } } as never));
    expect(upd).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect(del).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
    expect((await r.stored(CHILD, 'c_hidden_open'))?.name).toBe('theirs, hidden, open');
  });

  it('a by-id update of a readable row the gate refuses still answers the gate\'s 403', async () => {
    const r = await boot();
    const got = await outcome(r.engine.update(CHILD, { name: 'x' }, { where: { id: 'c_shared_locked' }, context: { ...CALLER } } as never));
    expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403, message: GATE_SENTENCE });
  });
});
