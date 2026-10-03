// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19959] A row-level policy that compares a field with `==` / `!=` against the
 * bare `current_user` ROOT fails closed on every leg, through the real plugin
 * and engine on driver-sql.
 *
 * It used to lower to `{ reviewer_id: { $ne: <the whole caller context> } }` (or
 * `==` / `$not` around the bare object). A strict compare never equals an
 * object, so a `check` written `!= current_user` or `!(== current_user)` ADMITTED
 * and stored every forbidden insert and by-id update, a USING-only such policy
 * admitted every insert on the write pass, and explain reported `narrows` /
 * `visible: true` with the caller's membership sets echoed in its `readFilter`.
 *
 * `compileCelToFilter` now refuses the root (`unsupported`) in both modes, so
 * `RLSCompiler.compileFilter` drops the policy on its "uncompilable predicate"
 * branch and, with nothing else applicable, answers `RLS_DENY_FILTER`: reads
 * return ZERO rows, writes are refused with the row-level CHECK envelope
 * (`PERMISSION_DENIED` / 403) and nothing is stored. An OR-sibling alone decides.
 *
 * Each leg has a control spelled the way the refusal points (`current_user.id`),
 * which proves the leg discriminates. The ground truth is read past every scope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'qa_ticket';
const GUARD_SET = 'qa_ticket_guard';
const AGENT_SET = 'qa_ticket_agent';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const DELEGATOR = 'usr_delegator';

type Policy = { name: string; using?: string; check?: string };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * One harness for every leg. The guard set is the deployment's fallback, so a
 * human principal — the caller, and the agent's delegator — resolves it; the
 * agent's own set carries CRUD and no row-level policy.
 */
async function boot(policies: Policy[]) {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-variable-root-19959',
    name: 'RLS variable root',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysUser,
      SysMember,
      {
        name: OBJ,
        label: 'Ticket',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          status: { name: 'status', type: 'text' },
          reviewer_id: { name: 'reviewer_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // [#21516] The authz resolver reads these on every grant resolution; in a
  // deployment the auth and security plugins register them. This harness
  // composes neither, so the ones its app does not declare are registered
  // here, AFTER the DDL above, and stay unprovisioned: the resolver reads a
  // missing table and answers "no grants", exactly as it did when the engine
  // still handed an unregistered name to the driver (which it now refuses).
  for (const o of [SysUser, SysMember, SysPosition, SysUserPosition, SysPermissionSet, SysUserPermissionSet, SysPositionPermissionSet]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }
  engines.push(engine);

  const crud = { allowRead: true, allowCreate: true, allowEdit: true };
  const guard = PermissionSetSchema.parse({
    name: GUARD_SET,
    objects: { [OBJ]: crud },
    rowLevelSecurity: policies.map((p) => ({ object: OBJ, operation: 'all', ...p })),
  });
  const agent = PermissionSetSchema.parse({ name: AGENT_SET, objects: { [OBJ]: crud } });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, guard, agent],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: GUARD_SET });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  // Every principal is a real `sys_user`, written past every scope: the
  // delegator must exist for the agent leg to resolve, and the engine stamps
  // and validates the writer as the new row's owner.
  const table = (driver as unknown as { knex: (t: string) => { insert(r: unknown): Promise<unknown> } }).knex;
  await table('sys_user').insert(
    ['usr_member', 'agent_1', DELEGATOR].map((id) => ({ id, name: id, email: `${id}@example.test` })),
  );

  const caller = {
    userId: 'usr_member',
    positions: ['qa_pos'],
    permissions: [GUARD_SET],
    posture: 'MEMBER',
    email: 'usr_member@example.test',
    org_user_ids: ['usr_member', 'usr_peer'],
  };
  const agentCaller = {
    userId: 'agent_1',
    principalKind: 'agent',
    positions: [],
    permissions: [AGENT_SET],
    onBehalfOf: { userId: DELEGATOR },
    org_user_ids: ['usr_member', 'usr_peer'],
  };
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<{ id: string; status: string }>)
      .map((r) => `${r.id}:${r.status}`)
      .sort();
  const seed = () => engine.insert(OBJ, ROWS, { context: SYS_CTX } as never);
  return { engine, plugin, caller, agentCaller, stored, seed };
}

const ROWS = [
  { id: 'r_mine', status: 'open', reviewer_id: 'usr_member' },
  { id: 'r_other', status: 'open', reviewer_id: 'usr_other' },
];

/** The spellings that compared against the whole caller context. */
const ROOT = [
  ['`!=` against the root', 'record.reviewer_id != current_user'],
  ['`==` against the root', 'record.reviewer_id == current_user'],
  ['a negated `==` against the root', '!(record.reviewer_id == current_user)'],
] as const;

type Refusal = { code?: string; status?: number; statusCode?: number } | null;
const attempt = (op: () => Promise<unknown>): Promise<Refusal> =>
  op().then(() => null, (e: { code?: string; status?: number; statusCode?: number }) => e);

function expectCheckDenial(err: Refusal) {
  expect(err, 'the write was admitted').not.toBeNull();
  expect(err?.code).toBe('PERMISSION_DENIED');
  expect(err?.statusCode ?? err?.status).toBe(403);
}

describe('[#19959] a sole `using` comparing against the root reads ZERO rows', () => {
  for (const [spelling, using] of ROOT) {
    it(spelling, async () => {
      const { engine, caller, stored, seed } = await boot([{ name: 'root', using }]);
      await seed();

      const rows = (await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>;

      expect(rows).toEqual([]);
      expect(await stored()).toEqual(['r_mine:open', 'r_other:open']);
    });
  }

  it('CONTROL — `record.reviewer_id != current_user.id` reads exactly the rows it admits', async () => {
    const { engine, caller, seed } = await boot([{ name: 'key', using: 'record.reviewer_id != current_user.id' }]);
    await seed();

    const rows = (await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>;

    expect(rows.map((r) => r.id)).toEqual(['r_other']);
  });
});

describe('[#19959] a sole `check` comparing against the root refuses every write', () => {
  for (const [spelling, check] of ROOT) {
    it(`${spelling}: insert and by-id update are PERMISSION_DENIED / 403, nothing lands`, async () => {
      const { engine, caller, stored, seed } = await boot([{ name: 'root', check }]);
      await seed();

      expectCheckDenial(await attempt(() =>
        engine.insert(OBJ, { id: 'ins_bad', status: 'open', reviewer_id: 'usr_other' }, { context: caller } as never)));
      expectCheckDenial(await attempt(() =>
        engine.update(OBJ, { id: 'r_other', status: 'closed' }, { context: caller } as never)));

      expect(await stored()).toEqual(['r_mine:open', 'r_other:open']);
    });
  }

  it('CONTROL — `record.reviewer_id != current_user.id` admits the other owner and refuses the caller', async () => {
    const { engine, caller, stored } = await boot([{ name: 'key', check: 'record.reviewer_id != current_user.id' }]);

    expect(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_ok', status: 'open', reviewer_id: 'usr_other' }, { context: caller } as never))).toBeNull();
    expectCheckDenial(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_bad', status: 'open', reviewer_id: 'usr_member' }, { context: caller } as never)));

    expect(await stored()).toEqual(['ins_ok:open']);
  });
});

describe('[#19959] a USING-only root policy is the insert check on the write pass, and refuses', () => {
  it('`!=` against the root in `using`, no `check`: PERMISSION_DENIED / 403, nothing stored', async () => {
    const { engine, caller, stored } = await boot([{ name: 'root', using: 'record.reviewer_id != current_user' }]);

    expectCheckDenial(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_bad', status: 'open', reviewer_id: 'usr_other' }, { context: caller } as never)));

    expect(await stored()).toEqual([]);
  });
});

describe('[#19959] beside a compiling OR-sibling, the sibling alone decides', () => {
  it('read: the sibling’s rows only', async () => {
    const { engine, caller, seed } = await boot([
      { name: 'root', using: 'record.reviewer_id != current_user' },
      { name: 'mine', using: 'record.reviewer_id == current_user.id' },
    ]);
    await seed();

    const rows = (await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>;

    expect(rows.map((r) => r.id)).toEqual(['r_mine']);
  });

  it('write: the sibling’s check admits `open` and refuses `archived`', async () => {
    const { engine, caller, stored } = await boot([
      { name: 'root', check: 'record.reviewer_id != current_user' },
      { name: 'not_archived', check: "record.status != 'archived'" },
    ]);

    expect(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_open', status: 'open', reviewer_id: 'usr_other' }, { context: caller } as never))).toBeNull();
    expectCheckDenial(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_archived', status: 'archived', reviewer_id: 'usr_other' }, { context: caller } as never)));

    expect(await stored()).toEqual(['ins_open:open']);
  });
});

describe('[#19959] explain agrees with the enforcement', () => {
  it('a root `using` explains as `denies` / not visible, and echoes no membership set', async () => {
    const { plugin, caller, seed } = await boot([{ name: 'root', using: 'record.reviewer_id != current_user' }]);
    await seed();

    const decision = await plugin.explainAccessForCaller({ object: OBJ, operation: 'read', recordId: 'r_other' }, caller);

    expect(decision.layers.find((l) => l.layer === 'rls')?.verdict).toBe('denies');
    expect(decision.allowed).toBe(false);
    expect(decision.record?.visible).toBe(false);
    expect(decision.readFilter).toEqual(RLS_DENY_FILTER);
    expect(JSON.stringify(decision)).not.toContain('usr_peer');
  });

  it('CONTROL — the `current_user.id` spelling explains as `narrows` and the row as visible', async () => {
    const { plugin, caller, seed } = await boot([{ name: 'key', using: 'record.reviewer_id != current_user.id' }]);
    await seed();

    const decision = await plugin.explainAccessForCaller({ object: OBJ, operation: 'read', recordId: 'r_other' }, caller);

    expect(decision.layers.find((l) => l.layer === 'rls')?.verdict).toBe('narrows');
    expect(decision.record?.visible).toBe(true);
  });
});

describe('[#19959] the delegator leg: an agent acting for a user whose set carries the root `check`', () => {
  it('insert is PERMISSION_DENIED / 403 and nothing is stored', async () => {
    const { engine, agentCaller, stored } = await boot([{ name: 'root', check: 'record.reviewer_id != current_user' }]);

    expectCheckDenial(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_bad', status: 'open', reviewer_id: 'usr_other' }, { context: agentCaller } as never)));

    expect(await stored()).toEqual([]);
  });

  it('CONTROL — a scalar `check` on the delegator’s set admits `open` and refuses `closed`', async () => {
    const { engine, agentCaller, stored } = await boot([{ name: 'not_closed', check: "record.status != 'closed'" }]);

    expect(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_open', status: 'open', reviewer_id: 'usr_other' }, { context: agentCaller } as never))).toBeNull();
    expectCheckDenial(await attempt(() =>
      engine.insert(OBJ, { id: 'ins_closed', status: 'closed', reviewer_id: 'usr_other' }, { context: agentCaller } as never)));

    expect(await stored()).toEqual(['ins_open:open']);
  });
});
