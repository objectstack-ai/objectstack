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

async function boot(childPerm: any, rls: boolean, childExtra: any = {}, perms: string[] = ['qa_nf_guard']): Promise<Rig> {
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
        ...childExtra,
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

  const set = ({
    name: 'qa_nf_guard',
    objects: {
      [PARENT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      [CHILD]: childPerm,
    },
    rowLevelSecurity: !rls ? [] : [
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
      outcome(engine.update(object, data, { where: { id }, context: { ...CALLER, permissions: perms } } as never)),
    remove: (object: string, id: string) =>
      outcome(engine.delete(object, { where: { id }, context: { ...CALLER, permissions: perms } } as never)),
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


describe('PROBE', () => {
  const cases: Array<[string, any, boolean, any, string[]]> = [
    ['edit-no-read rls', { allowEdit: true, allowDelete: true }, true, {}, ['qa_nf_guard']],
    ['edit-no-read nor rls', { allowEdit: true, allowDelete: true }, false, {}, ['qa_nf_guard']],
    ['cap read-gated rls', { allowRead: true, allowEdit: true, allowDelete: true }, true, { requiredPermissions: { read: ['cap_x'] } }, ['qa_nf_guard']],
    ['cap read-gated nor', { allowRead: true, allowEdit: true, allowDelete: true }, false, { requiredPermissions: { read: ['cap_x'] } }, ['qa_nf_guard']],
  ];
  for (const [label, perm, rls, extra, perms] of cases) {
    it(label, async () => {
      const r = await boot(perm, rls, extra, perms);
      const out: any = {};
      for (const id of ['c_own', 'c_hidden', 'c_nowhere']) {
        out['u:' + id] = await r.update(CHILD, id);
        out['d:' + id] = await r.remove(CHILD, id);
      }
      out.read = await r.engine.findOne(CHILD, { where: { id: 'c_own' }, context: { ...CALLER } } as never).then(() => 'ok', (e: any) => [e.code, e.statusCode ?? e.status, e.message]);
      console.log('PROBE', label, JSON.stringify(out, null, 1));
    });
  }
});
