// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cascade's batched child delete admits only the children the by-id child
 * delete admits: the READ scope included (ruling 6893104201 point 2, kept by
 * 6893661036: a refused child rolls the whole cascade back).
 *
 * Measured through a real `ObjectQL` over a real SQL driver, with the real
 * `SecurityPlugin` middleware in front of it. Each case runs on two legs of
 * one fixture:
 *
 *   - `batch`: the walk deletes a relation's children as one predicate delete
 *     per chunk (option F1);
 *   - `by-id`: the driver's `deleteMany` hidden, so the walk deletes each child
 *     by id, the path every cascade took before F1.
 *
 * ## The rig
 *
 * A child object where record sharing abstains (a `public_read_write` model,
 * no `owner_id`), cascading from its parent. Its row-level policies: a
 * select-class `using` that shows a caller only the rows it owns, and a
 * delete-class `using` that admits every row of team `ops`. So a child owned by
 * someone else on team `ops` satisfies the delete policy and is hidden by the
 * select policy.
 *
 * By id (step 2.7), that child is re-read through the read door with the
 * delete predicate ANDed on, comes back empty, and the delete answers 403: the
 * parent's delete is refused and nothing is deleted. A predicate delete issued
 * by the cascade is a nested write, so the read door's scope is not composed
 * onto it (`addressedPredicateWrite` answers false); with a delete-class
 * policy present, its write scope is that policy alone. The batch therefore
 * asks the caller's read door for the chunk's ids first, and deletes the
 * chunk by id when any is missing: today's answer, on both legs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PACKAGE = 'com.objectstack.qa.cascade-batch-read-scope';

const PARENT = 'qa_cbr_parent';
const CHILD = 'qa_cbr_child';
const ME = 'usr_cbr_member';
const OTHER = 'usr_cbr_other';
const CALLER = { userId: ME, positions: ['qa_pos'], permissions: ['qa_cbr_guard'], posture: 'MEMBER' };

type Leg = 'batch' | 'by-id';
type Outcome =
  | { kind: 'landed' }
  | { kind: 'refused'; code?: string; status?: number };

interface Rig {
  engine: ObjectQL;
  modes: unknown[];
  stored: (object: string, id: string) => Promise<Record<string, unknown> | null>;
  teardown: () => Promise<void>;
}
const rigs: Rig[] = [];
afterEach(async () => {
  for (const rig of rigs.splice(0)) await rig.teardown();
});

async function boot(leg: Leg): Promise<Rig> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  // The control leg: no `deleteMany`, so the walk deletes each child by id.
  if (leg === 'by-id') (driver as unknown as { deleteMany?: unknown }).deleteMany = undefined;
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: PACKAGE,
    name: 'Cascade batch: the read scope of the by-id child delete',
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
      {
        name: CHILD,
        label: 'Child',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          owner: { name: 'owner', type: 'text' },
          team: { name: 'team', type: 'text' },
          parent: { name: 'parent', type: 'lookup', reference: PARENT, deleteBehavior: 'cascade' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(PARENT, [
    { id: 'p_hidden', name: 'has a hidden deletable child' },
    { id: 'p_visible', name: 'has only visible deletable children' },
  ], SYS);
  await engine.insert(CHILD, [
    // readable (own) and deletable (team ops)
    { id: 'c_own', name: 'mine', owner: ME, team: 'ops', parent: 'p_hidden' },
    // hidden by the select policy, admitted by the delete policy
    { id: 'c_hidden', name: 'theirs, hidden, deletable', owner: OTHER, team: 'ops', parent: 'p_hidden' },
    // the control parent's children: readable and deletable
    { id: 'c_v1', name: 'mine 1', owner: ME, team: 'ops', parent: 'p_visible' },
    { id: 'c_v2', name: 'mine 2', owner: ME, team: 'ops', parent: 'p_visible' },
  ], SYS);

  const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  const guard = PermissionSetSchema.parse({
    name: 'qa_cbr_guard',
    objects: { [PARENT]: crud, [CHILD]: crud },
    rowLevelSecurity: [
      { name: `${CHILD}_read`, object: CHILD, operation: 'select', using: 'record.owner == current_user.id' },
      { name: `${CHILD}_delete`, object: CHILD, operation: 'delete', using: "record.team == 'ops'" },
    ],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? [MEMBER_DEFAULT, guard].find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
      list: async () => [MEMBER_DEFAULT, guard],
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

  // Which shape each child delete really ran on this leg.
  const modes: unknown[] = [];
  engine.registerHook('beforeDelete', (hookCtx: any) => { modes.push(hookCtx?.dispatch?.mode); }, {
    object: CHILD, packageId: PACKAGE,
  });

  const rig: Rig = {
    engine,
    modes,
    stored: async (object, id) =>
      ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) ?? null) as Record<string, unknown> | null,
    teardown: async () => { try { await engine.destroy(); } catch { /* noop */ } },
  };
  rigs.push(rig);
  return rig;
}

function deleteParent(r: Rig, id: string): Promise<Outcome> {
  return r.engine.delete(PARENT, { where: { id }, context: { ...CALLER } } as never).then(
    () => ({ kind: 'landed' as const }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code, status: e?.statusCode ?? e?.status }),
  );
}

describe('a cascade batch keeps the read scope the by-id child delete enforces', () => {
  for (const leg of ['batch', 'by-id'] as const) {
    it(`[${leg}] a child hidden by a select policy and admitted by a delete policy refuses the parent's delete 403, and nothing is deleted`, async () => {
      const r = await boot(leg);
      // The preconditions, read off the doors: the caller cannot read the
      // child, and the delete policy admits it.
      expect(await r.engine.findOne(CHILD, { where: { id: 'c_hidden' }, context: { ...CALLER } } as never)).toBeFalsy();
      expect((await r.stored(CHILD, 'c_hidden'))?.team).toBe('ops');

      const got = await deleteParent(r, 'p_hidden');

      expect(got).toMatchObject({ kind: 'refused', code: 'PERMISSION_DENIED', status: 403 });
      expect(await r.stored(CHILD, 'c_hidden')).not.toBeNull();
      expect(await r.stored(CHILD, 'c_own')).not.toBeNull();
      expect(await r.stored(PARENT, 'p_hidden')).not.toBeNull();
      // Both legs refused on the by-id shape: no batch hook ran first.
      expect(r.modes.every((m) => m === 'record')).toBe(true);
    });

    it(`[${leg}] children the caller can read and delete are deleted with the parent (control)`, async () => {
      const r = await boot(leg);

      const got = await deleteParent(r, 'p_visible');

      expect(got).toEqual({ kind: 'landed' });
      expect(await r.stored(CHILD, 'c_v1')).toBeNull();
      expect(await r.stored(CHILD, 'c_v2')).toBeNull();
      expect(await r.stored(PARENT, 'p_visible')).toBeNull();
      expect(r.modes).toEqual(leg === 'batch' ? ['per-row', 'per-row'] : ['record', 'record']);
    });
  }
});
