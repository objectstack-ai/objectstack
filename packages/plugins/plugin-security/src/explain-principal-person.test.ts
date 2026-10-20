// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#23157] The explain panel's Principal resolution names the principal as a
// person: name and email first, the id secondary. And it names them only as
// far as the ASKER can read that person through the read door.
//
// ## The rule
//
// The principal layer's prose used to open `Principal <raw id> holds
// position(s) …`, while the panel's own Principal line above it already named
// the person. The engine now reads the principal's `sys_user` row with the
// asker's own context, every data middleware included, and names what that
// read returns: `Principal Ada Lovelace (ada@example.test; id usr_pp_ada)`. An
// asker the read returns no row to gets the bare id the prose always carried,
// and a field the read masks stays out. An on-behalf-of delegator is named the
// same way.
//
// ## The rig
//
// The real `SecurityPlugin` over a real `ObjectQL` and SQL driver
// (better-sqlite3, in memory) with the platform's identity and grant tables.
// Every asker below is armed first: what its own read of the principal's user
// row returns is measured on the read door, and each cell's expectation is
// that read's answer, never a fixture assumption.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision } from '@objectstack/spec/security';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';

import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { relaxEveryRegisteredTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const BOARD = 'qa_pp_board';

/** Reads every user, whole: the directory an administrator browses. */
const DIRECTORY_SET = PermissionSetSchema.parse({
  name: 'qa_pp_directory',
  objects: { sys_user: { allowRead: true, viewAllRecords: true }, [BOARD]: { allowRead: true } },
  systemPermissions: ['manage_users'],
});
/** The same directory with the email column withheld by field-level security. */
const MASKED_DIRECTORY_SET = PermissionSetSchema.parse({
  name: 'qa_pp_directory_masked',
  objects: { sys_user: { allowRead: true, viewAllRecords: true }, [BOARD]: { allowRead: true } },
  fields: { 'sys_user.email': { readable: false, editable: false } },
  systemPermissions: ['manage_users'],
});
/** `manage_users` and nothing else: it may explain a user, and its read door returns it no user row. */
const USERS_ONLY_SET = PermissionSetSchema.parse({ name: 'qa_pp_users_only', objects: {}, systemPermissions: ['manage_users'] });

const ADA = 'usr_pp_ada';
const GRACE = 'usr_pp_grace';
const PLAIN = 'usr_pp_plain';
const AGENT = 'usr_pp_agent';
const GONE = 'usr_pp_gone';
/** Holds a position Grace delegated to her (ADR-0091 D3). */
const LIN = 'usr_pp_lin';
const DELEGATED_POSITION = 'qa_pp_approver';
const DELEGATED_UNTIL = '2099-01-01T00:00:00.000Z';

const DIRECTORY_ADMIN = { userId: 'usr_pp_directory_admin', positions: [] as string[], permissions: [DIRECTORY_SET.name] };
const MASKED_ADMIN = { userId: 'usr_pp_masked_admin', positions: [] as string[], permissions: [MASKED_DIRECTORY_SET.name] };
const BLIND_ADMIN = { userId: 'usr_pp_blind_admin', positions: [] as string[], permissions: [USERS_ONLY_SET.name] };
const SYSTEM = { isSystem: true };
/** Ada explaining herself, holding the directory. */
const ADA_SELF = { userId: ADA, positions: [] as string[], permissions: [DIRECTORY_SET.name] };
/** An agent holding the directory, acting on behalf of `delegator` (ADR-0090 D10). */
const agentFor = (delegator: string) => ({
  userId: AGENT, positions: [] as string[], permissions: [DIRECTORY_SET.name],
  principalKind: 'agent', onBehalfOf: { userId: delegator },
});
/** The same agent without the directory: its own leg holds the baseline alone. */
const baselineAgentFor = (delegator: string) => ({ ...agentFor(delegator), permissions: [] as string[] });

let engine: ObjectQL;
let plugin: SecurityPlugin;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-principal-person',
    name: 'Explain: the principal is named as a person, as far as the asker reads them',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      {
        name: BOARD,
        label: 'Board',
        sharingModel: 'public_read_write',
        tenancy: { enabled: false },
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less rows below (global sets, positions, grants) exist only
  // on a store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): this is that store.
  await relaxEveryRegisteredTenantColumn(engine);

  const e = engine as unknown as { insert: (o: string, row: unknown, opts: never) => Promise<unknown> };
  await e.insert('sys_user', [
    { id: ADA, name: 'Ada Lovelace', email: 'ada@example.test' },
    { id: GRACE, name: 'Grace Hopper', email: 'grace@example.test' },
    { id: PLAIN, name: 'Plain Person', email: 'plain@example.test' },
    { id: LIN, name: 'Lin Delegate', email: 'lin@example.test' },
    { id: AGENT, name: 'Release Bot', email: 'bot@example.test' },
    { id: DIRECTORY_ADMIN.userId, name: 'Directory Admin', email: 'dir@example.test' },
    { id: MASKED_ADMIN.userId, name: 'Masked Admin', email: 'masked@example.test' },
    { id: BLIND_ADMIN.userId, name: 'Blind Admin', email: 'blind@example.test' },
  ], SYS);
  // Grace holds the directory too, so an agent acting for her keeps it under
  // the D10 intersection; the plain user holds nothing beyond the baseline.
  // [C8 stage 8b] The three grant-side rows below carry no organization: under
  // `single` the engine stamps or refuses such a platform insert (ADR-0131 D9),
  // and this rig holds no organization, so they are landed straight through the
  // driver, as the residue an older release left. The explainer reads them as before.
  const residue = (o: string, row: Record<string, unknown>) => (engine as any).getDriver(o).create(o, row);
  await residue('sys_permission_set', {
    id: 'ps_pp_directory', name: DIRECTORY_SET.name, label: DIRECTORY_SET.name, organization_id: null, managed_by: 'admin',
    active: true, object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  await residue('sys_user_permission_set', {
    id: 'ups_pp_grace', user_id: GRACE, permission_set: DIRECTORY_SET.name,
  });
  // A position Lin holds because Grace delegated it, until a date far ahead.
  await residue('sys_user_position', {
    id: 'up_pp_lin_delegated', user_id: LIN, position: DELEGATED_POSITION,
    delegated_from: GRACE, valid_until: DELEGATED_UNTIL,
  });
  await e.insert(BOARD, [{ id: 'b_pp_1', name: 'one' }], SYS);

  const sets = [MEMBER_DEFAULT, DIRECTORY_SET, MASKED_DIRECTORY_SET, USERS_ONLY_SET];
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
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** The read door's answer for `userId`'s user row, asked with `asker`'s context: the row, or null for no row or a refusal. */
const door = (asker: Record<string, unknown>, userId: string): Promise<Record<string, unknown> | null> =>
  (engine.findOne('sys_user', { where: { id: userId }, context: { ...asker } } as never) as Promise<any>).then(
    (row) => row ?? null,
    () => null,
  );

/** `asker` explains `userId`, or itself when `userId` is omitted. */
const explain = (asker: Record<string, unknown>, userId?: string): Promise<ExplainDecision> =>
  plugin.explainAccessForCaller({ object: BOARD, operation: 'read', ...(userId ? { userId } : {}) }, { ...asker });

const principalDetail = (d: ExplainDecision): string => d.layers.find((l) => l.layer === 'principal')?.detail ?? '';

describe('armed: what each asker\'s read door returns of the user rows', () => {
  it('the directory holders read Ada whole, the masked one without her email, the blind one not at all', async () => {
    expect(await door(SYSTEM, ADA)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.test' });
    expect(await door(DIRECTORY_ADMIN, ADA)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.test' });
    expect(await door(ADA_SELF, ADA)).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.test' });
    const masked = await door(MASKED_ADMIN, ADA);
    expect(masked).toMatchObject({ name: 'Ada Lovelace' });
    expect(masked?.email ?? null).toBeNull();
    expect(await door(BLIND_ADMIN, ADA)).toBeNull();
  });

  it('under the D10 intersection: the agent acting for Grace reads both rows; for the plain user, only the delegator\'s; without the directory, neither', async () => {
    expect(await door(agentFor(GRACE), GRACE)).toMatchObject({ name: 'Grace Hopper', email: 'grace@example.test' });
    expect(await door(agentFor(GRACE), AGENT)).toMatchObject({ name: 'Release Bot', email: 'bot@example.test' });
    expect(await door(agentFor(PLAIN), PLAIN)).toMatchObject({ name: 'Plain Person', email: 'plain@example.test' });
    expect(await door(agentFor(PLAIN), AGENT)).toBeNull();
    expect(await door(baselineAgentFor(GRACE), GRACE)).toBeNull();
    expect(await door(baselineAgentFor(GRACE), AGENT)).toBeNull();
  });
});

describe('the principal is named as a person, as far as the asker reads them', () => {
  it('an administrator who reads the directory: name and email first, the id secondary', async () => {
    const d = await explain(DIRECTORY_ADMIN, ADA);
    expect(d.principal.userId).toBe(ADA);
    expect(principalDetail(d)).toMatch(/^Principal Ada Lovelace \(ada@example\.test; id usr_pp_ada\) holds position\(s\) \[/);
  });

  it('a principal explaining itself is named the same way', async () => {
    expect(principalDetail(await explain(ADA_SELF))).toMatch(
      /^Principal Ada Lovelace \(ada@example\.test; id usr_pp_ada\) holds position\(s\) \[/,
    );
  });

  it('the system asker reads every row, and is told the same', async () => {
    expect(principalDetail(await explain(SYSTEM, ADA))).toMatch(
      /^Principal Ada Lovelace \(ada@example\.test; id usr_pp_ada\) holds position\(s\) \[/,
    );
  });

  it('a field the asker\'s read masks stays out: the masked administrator is told the name, never the email', async () => {
    const d = await explain(MASKED_ADMIN, ADA);
    expect(principalDetail(d)).toMatch(/^Principal Ada Lovelace \(id usr_pp_ada\) holds position\(s\) \[/);
    expect(JSON.stringify(d)).not.toContain('ada@example.test');
  });

  it('control: an asker whose read returns no user row is told the bare id, and nothing more', async () => {
    const d = await explain(BLIND_ADMIN, ADA);
    expect(d.principal.userId).toBe(ADA);
    expect(principalDetail(d)).toMatch(/^Principal usr_pp_ada holds position\(s\) \[/);
    const whole = JSON.stringify(d);
    expect(whole).not.toContain('Ada Lovelace');
    expect(whole).not.toContain('ada@example.test');
  });

  it('control: the blind and the directory explanations differ in the principal\'s name alone', async () => {
    const strip = (d: ExplainDecision) => JSON.stringify(d).replace(/Principal [^[]*? holds position/g, 'Principal PERSON holds position');
    expect(strip(await explain(BLIND_ADMIN, ADA))).toBe(strip(await explain(DIRECTORY_ADMIN, ADA)));
  });
});

describe('an on-behalf-of delegator is named the same way (ADR-0090 D10)', () => {
  it('an agent acting for a delegator its read returns: both named as people', async () => {
    const detail = principalDetail(await explain(agentFor(GRACE)));
    expect(detail).toMatch(/^Principal Release Bot \(bot@example\.test; id usr_pp_agent\) holds position\(s\) \[/);
    expect(detail).toContain(
      'Acting on behalf of Grace Hopper (grace@example.test; id usr_pp_grace) — effective access is the D10 INTERSECTION',
    );
  });

  it('control: an agent whose intersected read does not return its own row is named by id, and nothing more', async () => {
    const d = await explain(agentFor(PLAIN));
    const detail = principalDetail(d);
    expect(detail).toMatch(/^Principal usr_pp_agent holds position\(s\) \[/);
    expect(detail).toContain('Acting on behalf of Plain Person (plain@example.test; id usr_pp_plain) — effective access');
    const whole = JSON.stringify(d);
    expect(whole).not.toContain('Release Bot');
    expect(whole).not.toContain('bot@example.test');
  });

  it('control: an agent whose intersected read returns neither row names the delegator by id too, and nothing more', async () => {
    const d = await explain(baselineAgentFor(GRACE));
    const detail = principalDetail(d);
    expect(detail).toMatch(/^Principal usr_pp_agent holds position\(s\) \[/);
    expect(detail).toContain('Acting on behalf of usr_pp_grace — effective access is the D10 INTERSECTION');
    const whole = JSON.stringify(d);
    for (const disclosed of ['Grace Hopper', 'grace@example.test', 'Release Bot', 'bot@example.test']) {
      expect(whole).not.toContain(disclosed);
    }
  });

  it('a delegator that no longer exists is named by the id the link carries', async () => {
    expect(principalDetail(await explain(agentFor(GONE)))).toContain(
      'Acting on behalf of usr_pp_gone, who no longer exists — D10 fails CLOSED (access denied).',
    );
  });
});

describe('the user an ADR-0091 D3 delegated position came from is named the same way', () => {
  const contributorVia = (d: ExplainDecision): string | undefined =>
    d.layers.find((l) => l.layer === 'principal')?.contributors?.find((c) => c.kind === 'position' && c.name === DELEGATED_POSITION)?.via;

  it('armed: Lin holds the delegated position, and the askers read Grace as they read Ada', async () => {
    expect((await explain(SYSTEM, LIN)).principal.positions).toContain(DELEGATED_POSITION);
    expect(await door(DIRECTORY_ADMIN, GRACE)).toMatchObject({ name: 'Grace Hopper', email: 'grace@example.test' });
    const masked = await door(MASKED_ADMIN, GRACE);
    expect(masked).toMatchObject({ name: 'Grace Hopper' });
    expect(masked?.email ?? null).toBeNull();
    expect(await door(BLIND_ADMIN, GRACE)).toBeNull();
  });

  it('an administrator who reads the directory: the clause and the attribution name Grace, the id secondary', async () => {
    const d = await explain(DIRECTORY_ADMIN, LIN);
    const grace = 'Grace Hopper (grace@example.test; id usr_pp_grace)';
    expect(principalDetail(d)).toContain(`1 position(s) held via delegation (ADR-0091 D3): [${DELEGATED_POSITION} from ${grace} until `);
    expect(contributorVia(d)).toMatch(/^delegation from Grace Hopper \(grace@example\.test; id usr_pp_grace\) until /);
  });

  it('a field the asker\'s read masks stays out: the masked administrator is told Grace\'s name, never her email', async () => {
    const d = await explain(MASKED_ADMIN, LIN);
    expect(principalDetail(d)).toContain(`${DELEGATED_POSITION} from Grace Hopper (id usr_pp_grace) until `);
    expect(contributorVia(d)).toMatch(/^delegation from Grace Hopper \(id usr_pp_grace\) until /);
    expect(JSON.stringify(d)).not.toContain('grace@example.test');
  });

  it('control: an asker whose read returns no row for Grace is told her bare id, and nothing more', async () => {
    const d = await explain(BLIND_ADMIN, LIN);
    expect(principalDetail(d)).toContain(`${DELEGATED_POSITION} from usr_pp_grace until `);
    expect(contributorVia(d)).toMatch(/^delegation from usr_pp_grace until /);
    const whole = JSON.stringify(d);
    expect(whole).not.toContain('Grace Hopper');
    expect(whole).not.toContain('grace@example.test');
  });
});
