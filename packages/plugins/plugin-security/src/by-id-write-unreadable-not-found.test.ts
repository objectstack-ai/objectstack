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
 *  5. The ADR-0090 D12 administration gate, which refuses a write to the
 *     permission-assignment objects before any grant is read, answers the
 *     addressed by-id update and delete of a caller whose read of the object
 *     is refused with that read refusal, for a row and for an id naming none
 *     alike. A caller who reads the object, and an insert, keep the gate's own
 *     sentence; an administrator still writes. (Its own rig, at the foot of
 *     the file: the two assignment objects and three more permission sets.)
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
import { installDefaultOrganization } from './default-organization.testkit.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUser } from '@objectstack/platform-objects/identity';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';

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

/**
 * The rig's knobs, for the read-refused caller's suite below: a read the
 * object gates on a capability (and the write does not), and no row-level
 * policies at all. Defaults are the rig the first suites run on.
 */
interface BootOptions {
  /** `requiredPermissions` on the child object (ADR-0066 D3/⑤). */
  childRequiredPermissions?: Record<string, string[]>;
  /** Keep the child's row-level policies (the default) or run with none. */
  rls?: boolean;
  /** Capabilities the caller's permission set grants. */
  capabilities?: string[];
}

async function boot(opts: BootOptions = {}): Promise<Rig> {
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
        ...(opts.childRequiredPermissions ? { requiredPermissions: opts.childRequiredPermissions } : {}),
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
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
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
    ...(opts.capabilities ? { systemPermissions: opts.capabilities } : {}),
    objects: {
      [PARENT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      [CHILD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    },
    rowLevelSecurity: opts.rls === false ? [] : [
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

describe('a caller the read door refuses gets that refusal from every by-id write it addresses, a row or none', () => {
  // The read is gated on a capability the caller lacks, and the write is not
  // (ADR-0066 ⑤ lets an object be read-gated and write-open), so the write
  // door admits a caller the read door refuses: the one shape outside the
  // permission model that still does, now that an object permission which
  // edits or deletes a record also reads it.
  const READ_GATED = { childRequiredPermissions: { read: ['qa_nf_read_cap'] } };

  for (const verb of ['update', 'delete'] as const) {
    it(`${verb}, no row-level policy: the row, a row the caller would not see, and a missing id all get the read door's refusal`, async () => {
      const r = await boot({ ...READ_GATED, rls: false });
      const read = await outcome(r.engine.findOne(CHILD, { where: { id: 'c_own' }, context: { ...CALLER } } as never));
      expect(read).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });

      const answers = [];
      for (const id of ['c_own', 'c_hidden', 'c_nowhere']) {
        answers.push(verb === 'update' ? await r.update(CHILD, id) : await r.remove(CHILD, id));
      }
      for (const got of answers) expect(got).toEqual(read);
      // Refused means untouched.
      expect((await r.stored(CHILD, 'c_own'))?.name).toBe('mine');
      expect((await r.stored(CHILD, 'c_hidden'))?.name).toBe('theirs, private');
    });

    it(`${verb}, under row-level policies: the row and a missing id get one refusal`, async () => {
      const r = await boot(READ_GATED);
      const own = verb === 'update' ? await r.update(CHILD, 'c_own') : await r.remove(CHILD, 'c_own');
      const missing = verb === 'update' ? await r.update(CHILD, 'c_nowhere') : await r.remove(CHILD, 'c_nowhere');
      expect(own).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect(missing).toEqual(own);
      expect((await r.stored(CHILD, 'c_own'))?.name).toBe('mine');
    });

    it(`${verb}: a caller holding the capability the read asks for keeps the ordinary answers`, async () => {
      const r = await boot({ ...READ_GATED, rls: false, capabilities: ['qa_nf_read_cap'] });
      expect(await outcome(r.engine.findOne(CHILD, { where: { id: 'c_own' }, context: { ...CALLER } } as never)))
        .toEqual({ kind: 'landed' });
      const own = verb === 'update' ? await r.update(CHILD, 'c_own') : await r.remove(CHILD, 'c_own');
      const missing = verb === 'update' ? await r.update(CHILD, 'c_nowhere') : await r.remove(CHILD, 'c_nowhere');
      expect(own).toEqual({ kind: 'landed' });
      expect(missing).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
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


// ── The delegated-administration gate (ADR-0090 D12) ─────────────────────────
//
// The gate refuses a write to the permission-assignment objects on the caller
// and the object alone, before any grant is read, in its own words. For a
// by-id update or delete the caller addressed, a caller whose read of the
// object is refused gets the read door's refusal from it instead: the answer
// that caller's by-id read gives for every id, so a row and an id naming none
// answer alike. A caller who reads the object keeps the gate's own sentence,
// an insert (which names no row) keeps it too, and an administrator still
// writes.

const ASSIGNMENT_OBJECTS = ['sys_user_permission_set', 'sys_user_position'] as const;
type AssignmentObject = (typeof ASSIGNMENT_OBJECTS)[number];
const SEEDED_ROW: Record<AssignmentObject, string> = { sys_user_permission_set: 'ups_seeded', sys_user_position: 'upos_seeded' };
const NOWHERE = 'zz_nowhere_0001';
const GATE_SENTENCE = 'requires tenant-level administration or a delegated adminScope';
const ADMIN_SET = defaultPermissionSets.find((p) => p.name === ADMIN_FULL_ACCESS)!;

/** Holds no grant on either object (its one set names the two business objects above). */
const NO_GRANT = { userId: 'usr_nf_nogrant', positions: [], permissions: ['qa_nf_guard'], posture: 'MEMBER' };
/** May create, update and delete both objects, and read neither. */
const WRITE_NO_READ = { userId: 'usr_nf_writer', positions: [], permissions: ['qa_nf_blind_writer'], posture: 'MEMBER' };
/** Reads both objects, and holds nothing else on them. */
const READER = { userId: 'usr_nf_reader', positions: [], permissions: ['qa_nf_reader'], posture: 'MEMBER' };
const ADMIN = { userId: 'usr_nf_admin', positions: [], permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' };

const gateEngines: ObjectQL[] = [];
afterEach(async () => {
  for (const engine of gateEngines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

type Read = { kind: 'read'; row: unknown } | ({ kind: 'refused' } & Refusal);

interface GateRig {
  read: (caller: object, object: string, id: string) => Promise<Read>;
  write: (caller: object, verb: 'update' | 'delete', object: string, id: string) => Promise<Outcome>;
  insert: (caller: object, object: string, row: Record<string, unknown>) => Promise<Outcome>;
  stored: (object: string, id: string) => Promise<Record<string, unknown> | null>;
}

async function bootGateRig(): Promise<GateRig> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.by-id-write-administration-gate',
    name: 'By-id write: the administration gate answers a caller who cannot read',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPermissionSet, SysUserPosition],
  } as never);
  await engine.syncSchemas();
  // `sys_user` registered and unprovisioned, as in the sibling suites: the
  // assignment rows' title formula reads through it.
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.by-id-write-administration-gate');
  await installDefaultOrganization(engine);
  await engine.insert('sys_user_permission_set', { id: SEEDED_ROW.sys_user_permission_set, user_id: OTHER, permission_set: 'qa_nf_guard' }, SYS);
  await engine.insert('sys_user_position', { id: SEEDED_ROW.sys_user_position, user_id: OTHER, position: 'qa_pos' }, SYS);
  gateEngines.push(engine);

  const grant = (allowRead: boolean, write: boolean) =>
    Object.fromEntries(ASSIGNMENT_OBJECTS.map((o) => [o, { allowRead, allowCreate: write, allowEdit: write, allowDelete: write }]));
  const sets = [
    MEMBER_DEFAULT,
    ADMIN_SET,
    PermissionSetSchema.parse({
      name: 'qa_nf_guard',
      objects: {
        [PARENT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
        [CHILD]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      },
    }),
    // A write grant without a read grant: the authoring schema refuses this
    // shape (an object permission that edits or deletes a record also reads
    // it), so it is built raw — the shape a row stored before that refusal
    // existed still carries.
    { name: 'qa_nf_blind_writer', objects: grant(false, true) } as unknown as ReturnType<typeof PermissionSetSchema.parse>,
    PermissionSetSchema.parse({ name: 'qa_nf_reader', objects: grant(true, false) }),
  ];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? sets.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => sets,
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

  return {
    read: (caller, object, id) =>
      engine.findOne(object, { where: { id }, context: { ...caller } } as never).then(
        (row): Read => ({ kind: 'read', row }),
        (e: any): Read => ({ kind: 'refused', code: e?.code, status: e?.statusCode ?? e?.status, message: String(e?.message), name: e?.name }),
      ),
    write: (caller, verb, object, id) =>
      outcome(
        verb === 'update'
          ? engine.update(object, { reason: 'renamed' }, { where: { id }, context: { ...caller } } as never)
          : engine.delete(object, { where: { id }, context: { ...caller } } as never),
      ),
    insert: (caller, object, row) => outcome(engine.insert(object, row, { context: { ...caller } } as never)),
    stored: async (object, id) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
  };
}

describe('the administration gate answers a by-id write from a caller who cannot read the object with that read\'s refusal', () => {
  for (const object of ASSIGNMENT_OBJECTS) {
    for (const verb of ['update', 'delete'] as const) {
      for (const [label, caller] of [['no grant on the object', NO_GRANT], ['a write grant without a read grant', WRITE_NO_READ]] as const) {
        it(`${object} ${verb}, ${label}: the row and an id naming none get the read door's refusal`, async () => {
          const r = await bootGateRig();
          const id = SEEDED_ROW[object];
          const before = await r.stored(object, id);
          // The precondition, read off the read door: it refuses this caller.
          const read = await r.read(caller, object, id);
          expect(read).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });

          const row = await r.write(caller, verb, object, id);
          const none = await r.write(caller, verb, object, NOWHERE);

          expect(row, 'the row').toEqual(read);
          expect(none, 'an id naming none').toEqual(read);
          expect(await r.stored(object, id), 'refused means untouched').toEqual(before);
        });
      }

      it(`${object} ${verb}, a caller who reads the object: the row and an id naming none keep the gate's own refusal`, async () => {
        const r = await bootGateRig();
        const id = SEEDED_ROW[object];
        expect(await r.read(READER, object, id)).toMatchObject({ kind: 'read', row: { id } });

        const row = await r.write(READER, verb, object, id);
        const none = await r.write(READER, verb, object, NOWHERE);

        expect(row).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
        expect(row.kind === 'refused' && row.message).toContain(GATE_SENTENCE);
        expect(withoutId(none, NOWHERE)).toEqual(withoutId(row, id));
      });
    }
  }

  it('an administrator still updates an assignment row, and gets not-found for an id naming none', async () => {
    const r = await bootGateRig();
    expect(await r.write(ADMIN, 'update', 'sys_user_permission_set', SEEDED_ROW.sys_user_permission_set)).toEqual({ kind: 'landed' });
    expect((await r.stored('sys_user_permission_set', SEEDED_ROW.sys_user_permission_set))?.reason).toBe('renamed');
    expect(await r.write(ADMIN, 'update', 'sys_user_permission_set', NOWHERE)).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('an insert names no row, so a caller who cannot read the object keeps the gate\'s own refusal', async () => {
    const r = await bootGateRig();
    const got = await r.insert(NO_GRANT, 'sys_user_permission_set', { user_id: OTHER, permission_set: 'qa_nf_guard' });
    expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
    expect(got.kind === 'refused' && got.message).toContain(GATE_SENTENCE);
  });
});
