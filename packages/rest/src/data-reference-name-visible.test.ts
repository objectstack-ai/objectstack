// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29460] `FieldSchema.referenceNameVisible` is served (director ruling
 * 6574398310, letter B): a reader of the record carrying a `lookup` / `user`
 * field that declares the key, refused the record it points at, gets that
 * record's NAME and ID on `$expand`, and nothing else of it. Measured with the
 * REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`), through the REST record and list reads.
 *
 * The served value is `{ id, name, readRefused: true }`, per element on a
 * `multiple: true` field. Each ruling condition carries its control:
 *
 * - the key and a target the reader is refused (its row scope, or the object
 *   gate) → name and id only, and the same field WITHOUT the key keeps the
 *   bare id it answers today;
 * - a target the reader CAN read → exactly what the same expansion answers
 *   without the key;
 * - an `$expand` asking for other columns of a refused target, nesting a
 *   further expand under it, or filtering it → still name and id only;
 * - the field's `displayField` naming another column → still the target's own
 *   name (ADR-0079 D4), never that column;
 * - a `user` field and a `lookup` to `sys_user` → the same, with no separate
 *   carve-out;
 * - an UNEXPANDED read → the stored bare id, for every reader (ADR-0104 D1).
 *
 * What the key does NOT lift is a field-level rule on the name field: when
 * field-level security keeps the name field from the reader, the field masks
 * it, or it is a formula reading through another reference, the name is the
 * ADR-0079 floor `Record #<id>`. An id no record has stays the bare id, and a
 * record of another organization is never named.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysUser } from '@objectstack/platform-objects/identity';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    // The object gate refuses the reader every target object below but the account.
    rnv_vault: { allowRead: false },
    rnv_contact: { allowRead: false },
    rnv_ledger: { allowRead: false },
    rnv_badge: { allowRead: false },
    rnv_branch: { allowRead: false },
  },
  // Field-level security keeps the ledger's name field from the reader.
  fields: { 'rnv_ledger.label': { readable: false, editable: false } },
  // The account's row scope hides region HIDDEN from the reader.
  rowLevelSecurity: [{ name: 'rnv_account_scope', object: 'rnv_account', operation: 'all', using: "record.region != 'HIDDEN'" }],
});

/** The reader. `org_user_ids` resolves `sys_user`'s default row scope: itself and its peer. */
const MEMBER_CTX = {
  userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER',
  tenantId: DEFAULT_ORGANIZATION_ID, org_user_ids: ['usr_member', 'usr_peer'],
};

const OBJECTS = [
  SysUser,
  {
    name: 'rnv_account', label: 'Account', sharingModel: 'public_read_write', nameField: 'name',
    fields: {
      name: { name: 'name', type: 'text' },
      region: { name: 'region', type: 'text' },
      secret: { name: 'secret', type: 'text' },
    },
  },
  {
    // No `nameField`: the registry designates the derived title (`title`).
    name: 'rnv_vault', label: 'Vault', sharingModel: 'public_read_write',
    fields: {
      title: { name: 'title', type: 'text' },
      secret: { name: 'secret', type: 'text' },
    },
  },
  {
    // A formula title over the record's own columns (no reference hop).
    name: 'rnv_contact', label: 'Contact', sharingModel: 'public_read_write', nameField: 'full_name',
    fields: {
      first_name: { name: 'first_name', type: 'text' },
      last_name: { name: 'last_name', type: 'text' },
      phone: { name: 'phone', type: 'text' },
      full_name: {
        name: 'full_name', type: 'formula', returnType: 'text',
        expression: { dialect: 'cel', source: 'record.first_name + " " + record.last_name' },
      },
    },
  },
  {
    name: 'rnv_ledger', label: 'Ledger', sharingModel: 'public_read_write', nameField: 'label',
    fields: {
      label: { name: 'label', type: 'text' },
      secret: { name: 'secret', type: 'text' },
    },
  },
  {
    name: 'rnv_badge', label: 'Badge', sharingModel: 'public_read_write', nameField: 'holder',
    fields: {
      holder: { name: 'holder', type: 'text', maskingRule: 'name' },
    },
  },
  {
    // A formula title that reads ONE hop through a reference.
    name: 'rnv_branch', label: 'Branch', sharingModel: 'public_read_write', nameField: 'heading',
    fields: {
      city: { name: 'city', type: 'text' },
      account: { name: 'account', type: 'lookup', reference: 'rnv_account' },
      heading: {
        name: 'heading', type: 'formula', returnType: 'text',
        expression: { dialect: 'cel', source: 'record.account.secret + " / " + record.city' },
      },
    },
  },
  {
    name: 'rnv_case', label: 'Case', sharingModel: 'public_read_write',
    fields: {
      subject: { name: 'subject', type: 'text' },
      // The key, with a `displayField` naming a column the reader may not see on a refused target.
      account: { name: 'account', type: 'lookup', reference: 'rnv_account', referenceNameVisible: true, displayField: 'secret' },
      account_plain: { name: 'account_plain', type: 'lookup', reference: 'rnv_account' },
      accounts: { name: 'accounts', type: 'lookup', reference: 'rnv_account', multiple: true, referenceNameVisible: true },
      vault: { name: 'vault', type: 'lookup', reference: 'rnv_vault', referenceNameVisible: true },
      vault_plain: { name: 'vault_plain', type: 'lookup', reference: 'rnv_vault' },
      contact: { name: 'contact', type: 'lookup', reference: 'rnv_contact', referenceNameVisible: true },
      ledger: { name: 'ledger', type: 'lookup', reference: 'rnv_ledger', referenceNameVisible: true },
      badge: { name: 'badge', type: 'lookup', reference: 'rnv_badge', referenceNameVisible: true },
      branch: { name: 'branch', type: 'lookup', reference: 'rnv_branch', referenceNameVisible: true },
      assignee: { name: 'assignee', type: 'user', referenceNameVisible: true },
      assignee_plain: { name: 'assignee_plain', type: 'user' },
      approver: { name: 'approver', type: 'lookup', reference: 'sys_user', referenceNameVisible: true },
    },
  },
];

const ALL_REFERENCES = 'account,account_plain,accounts,vault,vault_plain,contact,ledger,badge,branch,assignee,assignee_plain,approver';

/** The value a refused target is served as. */
const refused = (id: string, name: string) => ({ id, name, readRefused: true });

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

type Door = (method: 'GET' | 'POST', path: string, req: Record<string, unknown>) => Promise<{ status: number; body: any }>;

/**
 * A real engine, the real security layer, the real protocol and REST server.
 * The security service is handed to the engine through the slot the kernel's
 * ObjectQL plugin fills, so the engine asks it what the composed stack asks.
 */
async function boot(opts: { posture?: string } = {}): Promise<{ engine: ObjectQL; door: Door }> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.reference-name-visible-29460',
    name: 'Reference name visible',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_SET],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => services.security;
  if (opts.posture) engine.setTenancyPostureProvider(() => opts.posture);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert('sys_user', [
    { id: 'usr_member', name: 'Me', email: 'me@example.test' },
    { id: 'usr_peer', name: 'Pat Peer', email: 'peer@example.test' },
    { id: 'usr_stranger', name: 'Sam Stranger', email: 'stranger@example.test' },
  ], { context: SYS_CTX } as never);
  await engine.insert('rnv_account', [
    { id: 'a1', name: 'Acme', region: 'NA', secret: 'acme-secret' },
    { id: 'a2', name: 'Hidden Co', region: 'HIDDEN', secret: 'hidden-secret' },
  ], { context: SYS_CTX } as never);
  await engine.insert('rnv_vault', [{ id: 'v1', title: 'Vault One', secret: 'vault-secret' }], { context: SYS_CTX } as never);
  await engine.insert('rnv_contact', [{ id: 'k1', first_name: 'Ada', last_name: 'Lovelace', phone: '555-0100' }], { context: SYS_CTX } as never);
  await engine.insert('rnv_ledger', [{ id: 'l1', label: 'Payroll', secret: 'ledger-secret' }], { context: SYS_CTX } as never);
  await engine.insert('rnv_badge', [{ id: 'b1', holder: 'Grace Hopper' }], { context: SYS_CTX } as never);
  await engine.insert('rnv_branch', [{ id: 'br1', city: 'Oslo', account: 'a2' }], { context: SYS_CTX } as never);
  await engine.insert('rnv_case', [
    {
      id: 'c1', subject: 'readable targets', account: 'a1', account_plain: 'a1', accounts: ['a1', 'a2', 'a_none'],
      vault: 'v1', vault_plain: 'v1', contact: 'k1', ledger: 'l1', badge: 'b1', branch: 'br1',
      assignee: 'usr_peer', assignee_plain: 'usr_peer', approver: 'usr_stranger',
    },
    {
      id: 'c2', subject: 'refused targets', account: 'a2', account_plain: 'a2',
      vault: 'v1', vault_plain: 'v1', assignee: 'usr_stranger', assignee_plain: 'usr_stranger', approver: 'usr_peer',
    },
    { id: 'c3', subject: 'dangling', account: 'a_none', vault: 'v_none', assignee: 'usr_none' },
  ], { context: SYS_CTX } as never);

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => MEMBER_CTX;
  rest.registerRoutes();
  const door: Door = async (method, path, req) => {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(route, `${method} ${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ params: {}, query: {}, headers: {}, ...JSON.parse(JSON.stringify(req)) } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  return { engine, door };
}

const GET_ONE = '/api/v1/data/:object/:id';
const LIST = '/api/v1/data/:object';
const QUERY = '/api/v1/data/:object/query';

describe('[#29460] referenceNameVisible — a refused target is served by name and id on $expand', () => {
  let engine: ObjectQL;
  let door: Door;
  let c1: any;
  let c2: any;
  let c3: any;

  beforeAll(async () => {
    ({ engine, door } = await boot());
    const [one, two, three] = await Promise.all(['c1', 'c2', 'c3'].map((id) =>
      door('GET', GET_ONE, { params: { object: 'rnv_case', id }, query: { expand: ALL_REFERENCES } })));
    for (const res of [one, two, three]) expect(res.status, JSON.stringify(res.body)).toBe(200);
    [c1, c2, c3] = [one.body.record, two.body.record, three.body.record];
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the readings this card starts from: the reader may read the account row a1 and the peer, and is refused a2, the vault and the stranger', async () => {
    const accounts = await engine.find('rnv_account', { context: MEMBER_CTX } as never);
    expect(accounts.map((r: any) => r.id)).toEqual(['a1']);
    const vault = await engine.find('rnv_vault', { context: MEMBER_CTX } as never).then(() => null, (e: any) => e);
    expect({ code: vault?.code, status: vault?.statusCode }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    const users = await engine.find('sys_user', { fields: ['id'], context: MEMBER_CTX } as never);
    expect(users.map((r: any) => r.id).sort()).toEqual(['usr_member', 'usr_peer']);
  });

  it('the engine read itself serves the values the REST reads below carry (ObjectQL over the real driver)', async () => {
    const rows = await engine.find('rnv_case', {
      where: { id: { $in: ['c1', 'c2'] } },
      expand: { account: { object: 'rnv_account' }, vault: { object: 'rnv_vault' }, assignee: { object: 'sys_user' } },
      context: MEMBER_CTX,
    } as never);
    const byId = new Map((rows as any[]).map((r) => [r.id, r]));
    expect(byId.get('c2').account).toEqual(refused('a2', 'Hidden Co'));
    expect(byId.get('c1').vault).toEqual(refused('v1', 'Vault One'));
    expect(byId.get('c2').assignee).toEqual(refused('usr_stranger', 'Sam Stranger'));
    expect(byId.get('c1').account).toMatchObject({ id: 'a1', secret: 'acme-secret' });
  });

  describe('the key and a target the reader is refused', () => {
    it('a target its row scope hides is served by name and id only', () => {
      expect(c2.account).toEqual(refused('a2', 'Hidden Co'));
    });

    it('a target the object gate refuses is served by name and id only (the derived title)', () => {
      expect(c1.vault).toEqual(refused('v1', 'Vault One'));
      expect(c2.vault).toEqual(refused('v1', 'Vault One'));
    });

    it('a formula title over the target\'s own columns is its name', () => {
      expect(c1.contact).toEqual(refused('k1', 'Ada Lovelace'));
    });

    it('CONTROL the same field without the key keeps the bare id it answers today', () => {
      expect(c2.account_plain).toBe('a2');
      expect(c1.vault_plain).toBe('v1');
      expect(c2.vault_plain).toBe('v1');
    });
  });

  it('CONTROL a target the reader can read is expanded exactly as the field without the key expands it', () => {
    expect(c1.account).toEqual(c1.account_plain);
    expect(c1.account).toMatchObject({ id: 'a1', name: 'Acme', region: 'NA', secret: 'acme-secret' });
    expect(c1.account).not.toHaveProperty('readRefused');
  });

  it('the field\'s displayField naming another column does not widen it: the target\'s own name, and no other column', () => {
    expect(c2.account).toEqual(refused('a2', 'Hidden Co'));
    expect(JSON.stringify(c2)).not.toContain('hidden-secret');
  });

  it('a multiple: true field is judged per element: readable, refused and dangling each keep their own answer', () => {
    expect(c1.accounts).toHaveLength(3);
    expect(c1.accounts[0]).toMatchObject({ id: 'a1', name: 'Acme', secret: 'acme-secret' });
    expect(c1.accounts[0]).not.toHaveProperty('readRefused');
    expect(c1.accounts[1]).toEqual(refused('a2', 'Hidden Co'));
    expect(c1.accounts[2]).toBe('a_none');
  });

  it('an id no record has stays the bare id: no name and no refusal is invented for it', () => {
    expect(c3.account).toBe('a_none');
    expect(c3.vault).toBe('v_none');
    expect(c3.assignee).toBe('usr_none');
  });

  describe('sys_user names, with no separate carve-out', () => {
    it('a user field: a user outside the reader\'s row scope is served by name and id only', () => {
      expect(c2.assignee).toEqual(refused('usr_stranger', 'Sam Stranger'));
      expect(c2.assignee_plain).toBe('usr_stranger');
    });

    it('a lookup to sys_user: the same', () => {
      expect(c1.approver).toEqual(refused('usr_stranger', 'Sam Stranger'));
    });

    it('CONTROL a user the reader can read is expanded exactly as without the key', () => {
      expect(c1.assignee).toEqual(c1.assignee_plain);
      expect(c1.assignee).toMatchObject({ id: 'usr_peer', name: 'Pat Peer', email: 'peer@example.test' });
      expect(c2.approver).toMatchObject({ id: 'usr_peer', name: 'Pat Peer' });
      expect(c2.approver).not.toHaveProperty('readRefused');
    });
  });

  describe('a field-level rule on the name field is not lifted: the name is the floor', () => {
    it('field-level security keeps the name field from the reader', () => {
      expect(c1.ledger).toEqual(refused('l1', 'Record #l1'));
      expect(JSON.stringify(c1)).not.toContain('Payroll');
    });

    it('the name field declares a masking rule', () => {
      expect(c1.badge).toEqual(refused('b1', 'Record #b1'));
      expect(JSON.stringify(c1)).not.toContain('Grace');
    });

    it('the name field is a formula that reads through another reference', () => {
      expect(c1.branch).toEqual(refused('br1', 'Record #br1'));
      expect(JSON.stringify(c1)).not.toContain('Oslo');
    });
  });

  describe('an $expand asking for more of a refused target gets name and id only', () => {
    it('a nested projection naming other columns', async () => {
      const res = await door('POST', QUERY, {
        params: { object: 'rnv_case' },
        body: {
          where: { id: { $in: ['c1', 'c2'] } },
          expand: {
            account: { object: 'rnv_account', fields: ['secret', 'region'] },
            vault: { object: 'rnv_vault', fields: ['secret'] },
            contact: { object: 'rnv_contact', fields: ['phone', 'first_name'] },
          },
        },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const byId = new Map((res.body.records as any[]).map((r) => [r.id, r]));
      expect(byId.get('c2').account).toEqual(refused('a2', 'Hidden Co'));
      expect(byId.get('c2').vault).toEqual(refused('v1', 'Vault One'));
      expect(byId.get('c1').contact).toEqual(refused('k1', 'Ada Lovelace'));
      // CONTROL the readable target honours the same projection.
      expect(byId.get('c1').account).toEqual({ secret: 'acme-secret', region: 'NA' });
      const body = JSON.stringify(res.body);
      for (const withheld of ['hidden-secret', 'vault-secret', '555-0100']) expect(body).not.toContain(withheld);
    });

    it('a nested expand under the refused target, and a nested filter on it', async () => {
      const res = await door('POST', QUERY, {
        params: { object: 'rnv_case' },
        body: {
          where: { id: 'c1' },
          expand: {
            branch: { object: 'rnv_branch', fields: ['city', 'account'], expand: { account: { object: 'rnv_account' } } },
            vault: { object: 'rnv_vault', where: { secret: 'vault-secret' } },
          },
        },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const [row] = res.body.records as any[];
      expect(row.branch).toEqual(refused('br1', 'Record #br1'));
      expect(row.vault).toEqual(refused('v1', 'Vault One'));
      const body = JSON.stringify(res.body);
      for (const withheld of ['Oslo', 'hidden-secret', 'vault-secret']) expect(body).not.toContain(withheld);
    });

    it('CONTROL a readable target the reader\'s own nested filter excludes keeps the bare id it answers today', async () => {
      const res = await door('POST', QUERY, {
        params: { object: 'rnv_case' },
        body: { where: { id: 'c1' }, expand: { account: { object: 'rnv_account', where: { region: 'EU' } } } },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.records[0].account).toBe('a1');
    });
  });

  it('the list read serves the same values', async () => {
    const res = await door('GET', LIST, { params: { object: 'rnv_case' }, query: { expand: 'account,vault,assignee' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byId = new Map((res.body.records as any[]).map((r) => [r.id, r]));
    expect(byId.get('c2').account).toEqual(refused('a2', 'Hidden Co'));
    expect(byId.get('c2').vault).toEqual(refused('v1', 'Vault One'));
    expect(byId.get('c2').assignee).toEqual(refused('usr_stranger', 'Sam Stranger'));
    expect(byId.get('c1').account).toMatchObject({ id: 'a1', secret: 'acme-secret' });
    expect(byId.get('c3').account).toBe('a_none');
  });

  it('an unexpanded read answers the stored bare id for every reader, on the record and the list read', async () => {
    const one = await door('GET', GET_ONE, { params: { object: 'rnv_case', id: 'c2' } });
    expect(one.status).toBe(200);
    expect(one.body.record).toMatchObject({ account: 'a2', vault: 'v1', assignee: 'usr_stranger', approver: 'usr_peer' });
    const list = await door('GET', LIST, { params: { object: 'rnv_case' } });
    expect(list.status).toBe(200);
    const byId = new Map((list.body.records as any[]).map((r) => [r.id, r]));
    expect(byId.get('c1')).toMatchObject({ account: 'a1', accounts: ['a1', 'a2', 'a_none'], vault: 'v1', approver: 'usr_stranger' });
  });

  it('CONTROL a system read expands every existing target in full', async () => {
    const [row] = await engine.find('rnv_case', {
      where: { id: 'c2' }, expand: { account: { object: 'rnv_account' }, vault: { object: 'rnv_vault' } }, context: SYS_CTX,
    } as never);
    expect(row.account).toMatchObject({ id: 'a2', secret: 'hidden-secret' });
    expect(row.vault).toMatchObject({ id: 'v1', secret: 'vault-secret' });
  });
});

describe('[#29460] referenceNameVisible — a record of another organization is never named', () => {
  let engine: ObjectQL;
  let door: Door;

  beforeAll(async () => {
    ({ engine, door } = await boot({ posture: 'isolated' }));
    // A row of another organization, written below the engine (data at rest),
    // and a case of the reader's organization pointing at it.
    await engine.getDriverForObject('rnv_vault')!.create('rnv_vault', { id: 'v_other', title: 'Other Vault', secret: 'other-secret', organization_id: 'org_other' });
    await engine.insert('rnv_case', [{ id: 'c_cross', subject: 'cross-organization', vault: 'v_other', account: 'a2' }], { context: SYS_CTX } as never);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the reference keeps the bare id, while a target of the reader\'s own organization is named', async () => {
    const res = await door('GET', GET_ONE, { params: { object: 'rnv_case', id: 'c_cross' }, query: { expand: 'vault,account' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.record.vault).toBe('v_other');
    expect(JSON.stringify(res.body)).not.toContain('Other Vault');
    // CONTROL the same read names a refused target of the reader's organization.
    expect(res.body.record.account).toEqual(refused('a2', 'Hidden Co'));
  });
});
