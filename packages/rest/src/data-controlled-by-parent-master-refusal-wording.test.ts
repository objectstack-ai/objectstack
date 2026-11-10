// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3] The REST door's answer to a refused write of a
 * `controlled_by_parent` detail, for a writer who cannot read the detail's
 * master reference (`readable: false, editable: true`) and for one who can.
 *
 * The decision follows the master the STORED reference names, for both; only
 * the wording differs. The writer who cannot read the reference gets the same
 * `403 PERMISSION_DENIED` with a sentence that names no master object, no
 * master record and no leg of the check, and the body carries no master id;
 * the writer who can read it keeps the specific refusal. Measured through the
 * real `RestServer` routes over the real protocol, `ObjectQL`, `SqlDriver` and
 * `SecurityPlugin`, on each leg a by-id update and a create reach. The two
 * writers' sets differ ONLY in `readable` on the references.
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

const GRANTS = {
  '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  // The master object leg: the vault is read, never edited.
  cbw_vault: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
};
// The master row-level security leg: an account in region LOCKED is not editable.
// (The record sharing leg is asked of a master with no authored update policy,
// the ledger: an authored policy that admits the row retracts that refusal.)
const RLS = [{ name: 'cbw_account_update', object: 'cbw_account', operation: 'update', using: "record.region != 'LOCKED'" }];
const HIDDEN_SET = PermissionSetSchema.parse({
  name: 'cbw_hidden', label: 'Reference hidden', objects: GRANTS, rowLevelSecurity: RLS,
  fields: {
    'cbw_line.account': { readable: false, editable: true },
    'cbw_note.vault': { readable: false, editable: true },
    'cbw_entry.ledger': { readable: false, editable: true },
  },
});
const READABLE_SET = PermissionSetSchema.parse({ name: 'cbw_readable', label: 'Reference readable', objects: GRANTS, rowLevelSecurity: RLS });
const SETS = [HIDDEN_SET, READABLE_SET];

const writerWith = (set: string) => ({
  userId: 'usr_writer', positions: [], permissions: [set], posture: 'MEMBER',
  tenantId: DEFAULT_ORGANIZATION_ID, org_user_ids: ['usr_writer'],
});

const OBJECTS = [
  SysUser,
  {
    name: 'cbw_account', label: 'Account', sharingModel: 'public_read_write',
    fields: { name: { name: 'name', type: 'text' }, region: { name: 'region', type: 'text' } },
  },
  { name: 'cbw_vault', label: 'Vault', sharingModel: 'public_read_write', fields: { name: { name: 'name', type: 'text' } } },
  { name: 'cbw_ledger', label: 'Ledger', sharingModel: 'public_read_write', fields: { name: { name: 'name', type: 'text' } } },
  {
    name: 'cbw_line', label: 'Line', sharingModel: 'controlled_by_parent',
    fields: {
      qty: { name: 'qty', type: 'number' },
      account: { name: 'account', type: 'master_detail', reference: 'cbw_account', required: true },
    },
  },
  {
    name: 'cbw_entry', label: 'Entry', sharingModel: 'controlled_by_parent',
    fields: {
      amount: { name: 'amount', type: 'number' },
      ledger: { name: 'ledger', type: 'master_detail', reference: 'cbw_ledger', required: true },
    },
  },
  {
    name: 'cbw_note', label: 'Note', sharingModel: 'controlled_by_parent',
    fields: {
      body: { name: 'body', type: 'text' },
      vault: { name: 'vault', type: 'master_detail', reference: 'cbw_vault', required: true },
    },
  },
];

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

type Door = (method: 'GET' | 'POST' | 'PATCH', path: string, set: string, req: Record<string, unknown>) => Promise<{ status: number; body: any }>;

const UPDATE = '/api/v1/data/:object/:id';
const CREATE = '/api/v1/data/:object';

describe('[ADR-0055 §3] REST: a refused controlled_by_parent write names no master to a writer who cannot read the master reference', () => {
  let engine: ObjectQL;
  let door: Door;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.controlled-by-parent-master-refusal-wording',
      name: 'Controlled-by-parent refusal wording',
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
        get: async (type: string, name: string) =>
          (type === 'permission' ? SETS.find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
        list: async () => SETS,
      },
      // The master record sharing leg: ledger `ledger_shared` is editable by nobody.
      sharing: { canEdit: async (object: string, id: string) => !(object === 'cbw_ledger' && id === 'ledger_shared') },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'cbw_readable' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => services.security;
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

    await engine.insert('sys_user', [{ id: 'usr_writer', name: 'Writer', email: 'writer@example.test' }], { context: SYS_CTX } as never);
    await engine.insert('cbw_account', [
      { id: 'acc_open', name: 'Open', region: 'NA' },
      { id: 'acc_locked', name: 'Locked', region: 'LOCKED' },
    ], { context: SYS_CTX } as never);
    await engine.insert('cbw_ledger', [{ id: 'ledger_shared', name: 'Ledger' }], { context: SYS_CTX } as never);
    await engine.insert('cbw_vault', [{ id: 'vault_1', name: 'Vault' }], { context: SYS_CTX } as never);
    await engine.insert('cbw_line', [
      { id: 'line_open', qty: 1, account: 'acc_open' },
      { id: 'line_locked', qty: 1, account: 'acc_locked' },
    ], { context: SYS_CTX } as never);
    await engine.insert('cbw_entry', [{ id: 'entry_shared', amount: 1, ledger: 'ledger_shared' }], { context: SYS_CTX } as never);
    await engine.insert('cbw_note', [{ id: 'note_1', body: 'note', vault: 'vault_1' }], { context: SYS_CTX } as never);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const noop = () => {};
    const rest = new RestServer(
      { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} } as any,
      protocol as any,
      { api: { requireAuth: false } } as any,
    );
    let set = READABLE_SET.name;
    (rest as any).resolveExecCtx = async () => writerWith(set);
    rest.registerRoutes();
    door = async (method, path, asSet, req) => {
      set = asSet;
      const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
      expect(route, `${method} ${path}`).toBeDefined();
      const res = makeRes();
      await route!.handler({ params: {}, query: {}, headers: {}, ...JSON.parse(JSON.stringify(req)) } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** Each leg, the write that reaches it, and the words only the writer who can read the reference may see. */
  const LEGS: Array<{ leg: string; method: 'PATCH' | 'POST'; path: string; req: Record<string, unknown>; specific: string }> = [
    {
      leg: 'object permission on the master, by-id update',
      method: 'PATCH', path: UPDATE, req: { params: { object: 'cbw_note', id: 'note_1' }, body: { body: 'edited' } },
      specific: "no edit permission on master 'cbw_vault'",
    },
    {
      leg: 'row-level security on the master, by-id update',
      method: 'PATCH', path: UPDATE, req: { params: { object: 'cbw_line', id: 'line_locked' }, body: { qty: 2 } },
      specific: "master 'cbw_account' not editable by this user (row-level security)",
    },
    {
      leg: 'record sharing on the master, by-id update',
      method: 'PATCH', path: UPDATE, req: { params: { object: 'cbw_entry', id: 'entry_shared' }, body: { amount: 2 } },
      specific: "master 'cbw_ledger' not editable by this user (record sharing)",
    },
    {
      leg: 'row-level security on the master, create naming it',
      method: 'POST', path: CREATE, req: { params: { object: 'cbw_line' }, body: { qty: 3, account: 'acc_locked' } },
      specific: "master 'cbw_account' not editable by this user (row-level security)",
    },
  ];

  it.each(LEGS)('$leg: 403 PERMISSION_DENIED whose body names no master, no leg and no master id', async ({ method, path, req }) => {
    const res = await door(method, path, HIDDEN_SET.name, req);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const wire = JSON.stringify(res.body);
    expect(wire).toContain('PERMISSION_DENIED');
    expect(wire).toContain('no edit permission on the parent record of this detail');
    expect(wire).not.toMatch(/cbw_account|cbw_vault|cbw_ledger|acc_locked|ledger_shared|vault_1|row-level security|record sharing|recordId/);
  });

  it.each(LEGS)('$leg: CONTROL — a writer who can read the reference gets the specific refusal', async ({ method, path, req, specific }) => {
    const res = await door(method, path, READABLE_SET.name, req);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    const wire = JSON.stringify(res.body);
    expect(wire).toContain('PERMISSION_DENIED');
    expect(wire).toContain(specific);
    expect(wire).not.toContain('no edit permission on the parent record of this detail');
  });

  it('the decision is the same for both writers: each refused write is refused for both, and an editable master admits both', async () => {
    for (const { method, path, req } of LEGS) {
      const [hidden, readable] = [await door(method, path, HIDDEN_SET.name, req), await door(method, path, READABLE_SET.name, req)];
      expect([hidden.status, readable.status]).toEqual([403, 403]);
      expect(hidden.body?.code ?? hidden.body?.error?.code).toEqual(readable.body?.code ?? readable.body?.error?.code);
    }
    for (const set of [HIDDEN_SET.name, READABLE_SET.name]) {
      const updated = await door('PATCH', UPDATE, set, { params: { object: 'cbw_line', id: 'line_open' }, body: { qty: 5 } });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      const created = await door('POST', CREATE, set, { params: { object: 'cbw_line' }, body: { qty: 6, account: 'acc_open' } });
      expect([200, 201], JSON.stringify(created.body)).toContain(created.status);
    }
  });
});
