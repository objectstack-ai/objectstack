// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24164 ruling E′, items 2 and 6] An object's declared default row scope
 * (`ObjectSchema.defaultRowScope`) applies at the one collection point,
 * `collectRLSPolicies`, when no held permission set carries a row policy for
 * the object and operation.
 *
 * Driven on the real `SecurityPlugin` + `ObjectQL` over a real `SqlDriver`.
 * The identity objects are the platform's own declarations, each given in the
 * fixture the default its shipped sets copy today (`sys_user`'s two literals
 * joined into the one `||` policy the key allows); `qa_note` is a test object
 * that declares a default with no shipped copy anywhere. Rows are written
 * straight into the tables, past every scope.
 *
 * The pins, in the ruling's order:
 *  1. A principal with no baseline, holding only an authored `'*'` read set,
 *     reads only its own `sys_user`, `sys_session` and `sys_scim_user` rows
 *     plus its organisation's members on `sys_user` (CONTROL: without the
 *     declarations it reads every row).
 *  2. An authored policy on such an object is applied as authored, and the
 *     default is not added to it. What "carries a policy" means is the
 *     collection's own reading: a held `'*'` policy counts, a held policy for
 *     another operation or outside the caller's positions does not.
 *  3. The platform administrator is unchanged.
 *  4. Explain names the object default.
 *  5. A deployment with the baseline is byte-for-byte unchanged.
 *  6. A default whose `using` does not lower is refused the way an authored
 *     policy's is: dropped with the compiler's WARN, failing closed to zero
 *     rows, on the same object with the same predicate.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SysMember, SysScimUser, SysSession, SysUser } from '@objectstack/platform-objects/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const SYS = { context: { isSystem: true } } as never;

/** The defaults the identity objects are to declare: the literals the shipped sets copy. */
const IDENTITY_DEFAULTS: Record<string, Record<string, unknown>> = {
  sys_user: {
    name: 'sys_user_default_scope',
    operation: 'select',
    using: 'id == current_user.id || id in current_user.org_user_ids',
  },
  sys_session: { name: 'sys_session_default_scope', operation: 'all', using: 'user_id == current_user.id' },
  sys_scim_user: { name: 'sys_scim_user_default_scope', operation: 'select', using: 'user_id == current_user.id' },
};

const NOTE_DEFAULT = {
  name: 'qa_note_owner',
  label: 'Own notes',
  description: 'A note is readable and writable by its author only.',
  operation: 'all',
  using: 'owner_ref == current_user.id',
};

/** Outside the pushdown subset: a function call never lowers to a row filter. */
const UNLOWERABLE = 'size(owner_ref) > 3';

const noteObject = (name: string, defaultRowScope?: Record<string, unknown>) => ({
  name,
  label: name,
  systemFields: { tenant: false },
  fields: {
    name: { name: 'name', type: 'text' },
    owner_ref: { name: 'owner_ref', type: 'text' },
    region: { name: 'region', type: 'text' },
  },
  ...(defaultRowScope ? { defaultRowScope } : {}),
});

/** Organisation X: `u_x` and `u_x2`. Organisation Y: `u_y`. */
const ORG_X_USERS = ['u_x', 'u_x2'];
const USERS = [...ORG_X_USERS, 'u_y'];

const authored = (set: Record<string, unknown>): PermissionSet => PermissionSetSchema.parse(set) as PermissionSet;

/** The ruling's principal: an authored `'*'` read set, no row policy of its own. */
const STAR_READER = authored({ name: 'qa_star_reader', label: 'Star reader', objects: { '*': { allowRead: true } } });
const STAR_WRITER = authored({
  name: 'qa_star_writer',
  label: 'Star writer',
  objects: { '*': { allowRead: true, allowEdit: true } },
});
/** An authored policy on the object: used as authored. */
const NORTH_READER = authored({
  name: 'qa_north_reader',
  label: 'North reader',
  objects: { '*': { allowRead: true } },
  rowLevelSecurity: [{ name: 'qa_note_north', object: 'qa_note', operation: 'select', using: "region == 'north'" }],
});
/** A held `'*'` policy is a held policy for every object it reaches. */
const WILDCARD_READER = authored({
  name: 'qa_wildcard_reader',
  label: 'Wildcard reader',
  objects: { '*': { allowRead: true } },
  rowLevelSecurity: [{ name: 'qa_named_rows', object: '*', operation: 'select', using: "name != 'zzz'" }],
});
/** A held policy for another operation, and one outside the caller's positions. */
const UPDATE_SCOPED = authored({
  name: 'qa_update_scoped',
  label: 'Update scoped',
  objects: { '*': { allowRead: true, allowEdit: true } },
  rowLevelSecurity: [{ name: 'qa_note_north_writes', object: 'qa_note', operation: 'update', using: "region == 'north'" }],
});
const MANAGER_SCOPED = authored({
  name: 'qa_manager_scoped',
  label: 'Manager scoped',
  objects: { '*': { allowRead: true } },
  rowLevelSecurity: [
    { name: 'qa_note_managers', object: 'qa_note', operation: 'select', using: "region == 'north'", positions: ['qa_manager'] },
  ],
});
/** The same un-lowerable predicate, authored in a set, on a sibling object that declares no default. */
const UNLOWERABLE_AUTHORED = authored({
  name: 'qa_unlowerable_authored',
  label: 'Unlowerable authored',
  objects: { '*': { allowRead: true } },
  rowLevelSecurity: [{ name: 'qa_note_bare_size', object: 'qa_note_bare', operation: 'select', using: UNLOWERABLE }],
});

const AUTHORED_SETS = [STAR_READER, STAR_WRITER, NORTH_READER, WILDCARD_READER, UPDATE_SCOPED, MANAGER_SCOPED, UNLOWERABLE_AUTHORED];

const principal = (permissions: string[], extra: Record<string, unknown> = {}) => ({
  userId: 'u_x',
  tenantId: 'org_x',
  positions: [] as string[],
  permissions,
  posture: 'MEMBER',
  org_user_ids: ORG_X_USERS,
  email: 'u_x@example.test',
  ...extra,
});
const PLATFORM_ADMIN = {
  userId: 'p_admin', tenantId: 'org_x', positions: [], permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
};

/** A plausible value for a required column the fixture does not care about. */
function filler(type: string, key: string): unknown {
  if (type === 'boolean') return true;
  if (type === 'number') return 0;
  if (type === 'datetime') return '2026-01-01T00:00:00.000Z';
  return key;
}

/** One row of `schema`: every required column filled, then those of `values` it declares. */
function row(schema: { fields: unknown }, values: Record<string, unknown>): Record<string, unknown> {
  const fields = schema.fields as Record<string, { type: string; required?: boolean }>;
  const out: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) if (def.required) out[name] = filler(def.type, `${name}-${String(values.id)}`);
  for (const [name, value] of Object.entries(values)) if (name in fields) out[name] = value;
  return out;
}

type Table = (name: string) => { insert(rows: Array<Record<string, unknown>>): Promise<unknown> };
const engines: ObjectQL[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

interface Shape {
  /** Compose the platform baseline (`member_default`) beside every principal's own sets. */
  baseline: boolean;
  /** The identity objects and `qa_note` declare their defaults. */
  declared: boolean;
}

async function boot(shape: Shape) {
  const identity = [SysUser, SysSession, SysScimUser].map((schema) =>
    shape.declared ? { ...schema, defaultRowScope: IDENTITY_DEFAULTS[schema.name] } : schema,
  );
  const notes = [
    noteObject('qa_note', shape.declared ? NOTE_DEFAULT : undefined),
    noteObject('qa_note_unlowerable', shape.declared ? { name: 'qa_note_unlowerable_scope', operation: 'select', using: UNLOWERABLE } : undefined),
    noteObject('qa_note_bare'),
  ];
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.object-default-row-scope',
    name: 'Object default row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [...identity, SysMember, ...notes],
  } as never);
  await engine.syncSchemas();
  // The authz resolver reads these on every grant resolution; registered after
  // the DDL and left unprovisioned, as the SCIM row-scope pin does.
  for (const o of [SysPosition, SysUserPosition, SysPermissionSet, SysUserPermissionSet, SysPositionPermissionSet]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }

  const sets = [...defaultPermissionSets, ...AUTHORED_SETS];
  const services: Record<string, unknown> = {
    'org-scoping': { name: 'com.objectstack.org-scoping' },
    tenancy: { posture: 'isolated' },
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => sets },
  };
  let security: any;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
    registerService: (name: string, impl: unknown) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, ...(shape.baseline ? {} : { fallbackPermissionSet: null }) });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const table = (driver as unknown as { knex: Table }).knex;
  const sysUser = identity[0];
  await table('sys_user').insert(USERS.map((id) => row(sysUser, { id, name: id, email: `${id}@example.test` })));
  await table('sys_session').insert(USERS.map((id) => row(identity[1], { id: `sess:${id}`, user_id: id })));
  await table('sys_scim_user').insert(USERS.map((id) => row(identity[2], { id: `scim:${id}`, user_id: id })));
  for (const object of ['qa_note', 'qa_note_unlowerable', 'qa_note_bare']) {
    await table(object).insert([
      { id: `${object}:mine_north`, name: 'mine north', owner_ref: 'u_x', region: 'north' },
      { id: `${object}:mine_south`, name: 'mine south', owner_ref: 'u_x', region: 'south' },
      { id: `${object}:theirs_north`, name: 'theirs north', owner_ref: 'u_y', region: 'north' },
      { id: `${object}:theirs_south`, name: 'theirs south', owner_ref: 'u_y', region: 'south' },
    ]);
  }

  const ids = async (object: string, context: object): Promise<string[]> => {
    const rows = (await engine.find(object, { context: { ...context } } as never)) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  };
  return { engine, security, logger, ids };
}

const notes = (...keys: string[]) => keys.map((k) => `qa_note:${k}`).sort();

describe('[#24164 E′] no baseline, an authored `*` read set: the identity objects read under their declared defaults', () => {
  it('reads only its own sys_user, sys_session and sys_scim_user rows, plus its organisation members on sys_user', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    const reader = principal([STAR_READER.name]);
    expect(await ids('sys_user', reader)).toEqual(['u_x', 'u_x2']);
    expect(await ids('sys_session', reader)).toEqual(['sess:u_x']);
    expect(await ids('sys_scim_user', reader)).toEqual(['scim:u_x']);
  });

  it('CONTROL: without the declarations the same principal reads every row of all three tables', async () => {
    const { ids } = await boot({ baseline: false, declared: false });
    const reader = principal([STAR_READER.name]);
    expect(await ids('sys_user', reader)).toEqual([...USERS].sort());
    expect(await ids('sys_session', reader)).toEqual(USERS.map((u) => `sess:${u}`).sort());
    expect(await ids('sys_scim_user', reader)).toEqual(USERS.map((u) => `scim:${u}`).sort());
  });

  it('a test object reads under its default too, and the CONTROL object without one reads every row', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    const reader = principal([STAR_READER.name]);
    expect(await ids('qa_note', reader)).toEqual(notes('mine_north', 'mine_south'));
    expect(await ids('qa_note_bare', reader)).toHaveLength(4);
  });
});

describe('[#24164 E′] an authored set policy is used as authored; "carries" is the collection\'s own reading', () => {
  it('a held policy for the object is applied alone: the default is not added to it', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    // `mine_south` is the author's own row, which the default admits: absent, so nothing was OR-ed in.
    expect(await ids('qa_note', principal([NORTH_READER.name]))).toEqual(notes('mine_north', 'theirs_north'));
  });

  it('a held `*` policy carries a policy for the object, so the default does not apply', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    expect(await ids('qa_note', principal([WILDCARD_READER.name]))).toHaveLength(4);
  });

  it('a held policy for another operation does not count: reads still run under the default', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    expect(await ids('qa_note', principal([UPDATE_SCOPED.name]))).toEqual(notes('mine_north', 'mine_south'));
  });

  it('a held policy outside the caller\'s positions does not count; inside them it is used as authored', async () => {
    const { ids } = await boot({ baseline: false, declared: true });
    expect(await ids('qa_note', principal([MANAGER_SCOPED.name]))).toEqual(notes('mine_north', 'mine_south'));
    expect(await ids('qa_note', principal([MANAGER_SCOPED.name], { positions: ['qa_manager'] }))).toEqual(
      notes('mine_north', 'theirs_north'),
    );
  });

  it('the write doors read the same collection: the default scopes the by-id update and judges its post-image', async () => {
    const { engine } = await boot({ baseline: false, declared: true });
    const writer = { context: principal([STAR_WRITER.name]) } as never;
    await engine.update('qa_note', { id: 'qa_note:mine_north', name: 'renamed' }, writer);
    expect(((await engine.findOne('qa_note', { where: { id: 'qa_note:mine_north' } }, SYS)) as { name: string }).name).toBe('renamed');

    const refusals: Array<[string, () => Promise<unknown>, { code: string; status: number }]> = [
      // Pre-image: a row outside the default's scope is one the caller cannot
      // read, which a by-id write answers as absent.
      [
        'pre-image',
        () => engine.update('qa_note', { id: 'qa_note:theirs_north', name: 'taken' }, writer),
        { code: 'RECORD_NOT_FOUND', status: 404 },
      ],
      // Post-image: the default's `using` stands in as the check, so handing the row away is refused.
      [
        'post-image',
        () => engine.update('qa_note', { id: 'qa_note:mine_south', owner_ref: 'u_y' }, writer),
        { code: 'PERMISSION_DENIED', status: 403 },
      ],
    ];
    for (const [leg, write, envelope] of refusals) {
      const error = await write().then(() => null, (e: { code?: string; status?: number }) => e);
      expect(error, leg).not.toBeNull();
      expect({ code: error?.code, status: error?.status }, leg).toEqual(envelope);
    }
    const untouched = (await engine.find('qa_note', { where: { owner_ref: 'u_y' } }, SYS)) as Array<{ id: string; name: string }>;
    expect(untouched.map((r) => `${r.id}=${r.name}`).sort()).toEqual(['qa_note:theirs_north=theirs north', 'qa_note:theirs_south=theirs south']);
  });

  it('checkAuthoredRowWrite reads the default as the declaration it is, exactly as a held copy of it would be read', async () => {
    const { security } = await boot({ baseline: false, declared: true });
    const writer = principal([STAR_WRITER.name]);
    expect(await security.checkAuthoredRowWrite('qa_note', 'qa_note:mine_south', 'update', writer)).toBe('admit');
    expect(await security.checkAuthoredRowWrite('qa_note', 'qa_note:theirs_south', 'update', writer)).toBe('abstain');
    // CONTROL: no default, no held policy — nothing declares an admission.
    expect(await security.checkAuthoredRowWrite('qa_note_bare', 'qa_note_bare:mine_south', 'update', writer)).toBe('abstain');
  });
});

describe('[#24164 E′] the platform administrator is unchanged', () => {
  it('reads every row of every object, with the defaults declared and without them', async () => {
    for (const declared of [true, false]) {
      const { ids } = await boot({ baseline: false, declared });
      expect(await ids('sys_user', PLATFORM_ADMIN), `declared: ${declared}`).toEqual([...USERS].sort());
      expect(await ids('sys_session', PLATFORM_ADMIN), `declared: ${declared}`).toHaveLength(3);
      expect(await ids('sys_scim_user', PLATFORM_ADMIN), `declared: ${declared}`).toHaveLength(3);
      expect(await ids('qa_note', PLATFORM_ADMIN), `declared: ${declared}`).toHaveLength(4);
    }
  });
});

describe('[#24164 E′] explain names the object default, never a permission set', () => {
  const rlsLayer = (decision: { layers: Array<{ layer: string }> }) =>
    decision.layers.find((l) => l.layer === 'rls') as { verdict: string; detail: string; contributors: unknown[]; record?: any };

  it('object-level: the rls layer names the default, its label and description, and the declaring object', async () => {
    const { security } = await boot({ baseline: false, declared: true });
    const layer = rlsLayer(await security.explain({ object: 'qa_note', operation: 'read' }, principal([STAR_READER.name])));
    expect(layer.verdict).toBe('narrows');
    expect(layer.contributors).toEqual([]);
    for (const subject of ["'qa_note_owner'", NOTE_DEFAULT.label, NOTE_DEFAULT.description, "'qa_note'", 'object default row scope']) {
      expect(layer.detail).toContain(subject);
    }
  });

  it('record-grained: the rule is the default by name, reached through the object default', async () => {
    const { security } = await boot({ baseline: false, declared: true });
    const reader = principal([STAR_READER.name]);
    const mine = rlsLayer(await security.explain({ object: 'qa_note', operation: 'read', recordId: 'qa_note:mine_north' }, reader));
    expect(mine.record.rules).toEqual([expect.objectContaining({ kind: 'rls_policy', name: 'qa_note_owner', via: 'object_default', effect: 'admits' })]);
  });

  it('CONTROL: an authored policy is not named as an object default', async () => {
    const { security } = await boot({ baseline: false, declared: true });
    const reader = principal([NORTH_READER.name]);
    const layer = rlsLayer(await security.explain({ object: 'qa_note', operation: 'read' }, reader));
    expect(layer.verdict).toBe('narrows');
    expect(layer.detail).not.toContain('object default');
    const record = rlsLayer(await security.explain({ object: 'qa_note', operation: 'read', recordId: 'qa_note:mine_north' }, reader));
    expect(record.record.rules).toEqual([expect.objectContaining({ kind: 'rls_policy', name: 'business_rls' })]);
    expect(record.record.rules[0].via).toBeUndefined();
  });
});

describe('[#24164 E′] a deployment with the baseline is byte-for-byte unchanged', () => {
  const PERSONAS = {
    member_default: principal(['member_default'], { positions: ['org_member'] }),
    viewer_readonly: principal(['viewer_readonly'], { positions: ['org_member'] }),
    organization_admin: principal(['organization_admin'], { positions: ['org_admin'], posture: 'TENANT_ADMIN' }),
    platform_admin: PLATFORM_ADMIN,
  };

  it('every shipped persona reads and is explained exactly as without the declarations', async () => {
    const now = await boot({ baseline: true, declared: true });
    const before = await boot({ baseline: true, declared: false });
    for (const [persona, context] of Object.entries(PERSONAS)) {
      for (const object of ['sys_user', 'sys_session', 'sys_scim_user']) {
        const label = `${persona} on ${object}`;
        const served = await before.ids(object, context);
        expect(await now.ids(object, context), label).toEqual(served);
        for (const operation of ['read', 'update']) {
          const explained = JSON.stringify(await before.security.explain({ object, operation }, { ...context }));
          expect(JSON.stringify(await now.security.explain({ object, operation }, { ...context })), `${label} (${operation})`).toBe(explained);
        }
      }
    }
    // CONTROL: the comparison has teeth — the baseline really narrows these reads.
    expect(await now.ids('sys_user', PERSONAS.member_default)).toEqual(['u_x', 'u_x2']);
    expect(await now.ids('sys_session', PERSONAS.member_default)).toEqual(['sess:u_x']);
  });
});

describe('[#24164 E′] a default whose `using` does not lower is refused the way an authored policy\'s is', () => {
  it('both read zero rows, and both are dropped with the compiler\'s uncompilable-predicate WARN', async () => {
    const { ids, logger } = await boot({ baseline: false, declared: true });
    expect(await ids('qa_note_unlowerable', principal([STAR_READER.name]))).toEqual([]);
    expect(await ids('qa_note_bare', principal([UNLOWERABLE_AUTHORED.name]))).toEqual([]);
    const warned = logger.warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('uncompilable predicate'));
    for (const policy of ["policy 'qa_note_unlowerable_scope' on 'qa_note_unlowerable'", "policy 'qa_note_bare_size' on 'qa_note_bare'"]) {
      expect(warned.some((line) => line.includes(policy)), policy).toBe(true);
    }
  });

  it('explain reports the same verdict for both: row-level security denies', async () => {
    const { security } = await boot({ baseline: false, declared: true });
    const verdictOf = async (object: string, permissions: string[]) =>
      ((await security.explain({ object, operation: 'read' }, principal(permissions))).layers as Array<{ layer: string; verdict: string }>)
        .find((l) => l.layer === 'rls')?.verdict;
    expect(await verdictOf('qa_note_unlowerable', [STAR_READER.name])).toBe('denies');
    expect(await verdictOf('qa_note_bare', [UNLOWERABLE_AUTHORED.name])).toBe('denies');
  });
});
