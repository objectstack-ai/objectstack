// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35308] Global search (the ⌘K palette) titles a hit whose object's primary
 * title pointer (`nameField`) is a reference field declaring
 * `referenceNameVisible`, and whose target the SEARCHER is refused, by the
 * target's name: the name the engine's `$expand` serves such a reader (ruling
 * 7077827375, letter B; the key's own ruling 6574398310). Measured with the
 * REAL security layer (`SecurityPlugin` on a real `ObjectQL` over a real
 * `SqlDriver`), through the protocol's `searchAll`, the method the search route
 * calls.
 *
 * The four pins the ruling names, each with its control:
 *
 * 1. the switch and a refusal (the row scope, or the object gate) → the hit is
 *    titled by the target's name;
 * 2. the same pointer WITHOUT the switch → the bare id, today's answer;
 * 3. a name column field-level security keeps from the searcher, or one that
 *    declares a `maskingRule` → the ADR-0079 floor `Record #<id>` the engine
 *    serves, never the name;
 * 4. a search by the target's name → no hit: the name is display only.
 *
 * Controls: a target the searcher may read is titled by the searcher's own
 * read and never asked by name; a target whose declared exposure does not
 * serve `get` keeps the bare id.
 *
 * The name is the engine's answer to an `$expand` read made AS THE SEARCHER;
 * the protocol makes no system-context read of its own. The wire shape of the
 * hit does not move: `record` still carries the stored id.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysUser } from '@objectstack/platform-objects/identity';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: DEFAULT_ORGANIZATION_ID };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    // The object gate refuses the searcher every target below but the account.
    sst_vault: { allowRead: false },
    sst_ledger: { allowRead: false },
    sst_badge: { allowRead: false },
    sst_listonly: { allowRead: false },
  },
  // Field-level security keeps the ledger's name field from the searcher.
  fields: { 'sst_ledger.label': { readable: false, editable: false } },
  // The account's row scope hides region HIDDEN from the searcher.
  rowLevelSecurity: [{ name: 'sst_account_scope', object: 'sst_account', operation: 'all', using: "record.region != 'HIDDEN'" }],
});

const MEMBER_CTX = {
  userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER',
  tenantId: DEFAULT_ORGANIZATION_ID, org_user_ids: ['usr_member'],
};

const text = (name: string) => ({ name, type: 'text' });

/** A searched object titled by a lookup to `target`, scanned through `subject` only. */
const source = (name: string, target: string, nameVisible: boolean) => ({
  name, label: name, sharingModel: 'public_read_write', nameField: 'ref', searchableFields: ['subject'],
  fields: {
    subject: text('subject'),
    ref: { name: 'ref', type: 'lookup', reference: target, ...(nameVisible ? { referenceNameVisible: true } : {}) },
  },
});

const OBJECTS = [
  SysUser,
  {
    name: 'sst_account', label: 'Account', sharingModel: 'public_read_write', nameField: 'name',
    fields: { name: text('name'), region: text('region') },
  },
  { name: 'sst_vault', label: 'Vault', sharingModel: 'public_read_write', nameField: 'title', fields: { title: text('title') } },
  { name: 'sst_ledger', label: 'Ledger', sharingModel: 'public_read_write', nameField: 'label', fields: { label: text('label') } },
  {
    name: 'sst_badge', label: 'Badge', sharingModel: 'public_read_write', nameField: 'holder',
    fields: { holder: { name: 'holder', type: 'text', maskingRule: 'name' } },
  },
  {
    // Serves `list` only: no door reads one of its records by id.
    name: 'sst_listonly', label: 'List only', sharingModel: 'public_read_write', nameField: 'title',
    enable: { apiMethods: ['list'] }, fields: { title: text('title') },
  },
  source('sst_pin_account', 'sst_account', true),
  source('sst_pin_plain', 'sst_account', false),
  source('sst_pin_vault', 'sst_vault', true),
  source('sst_pin_ledger', 'sst_ledger', true),
  source('sst_pin_badge', 'sst_badge', true),
  source('sst_pin_listonly', 'sst_listonly', true),
];

const PIN_OBJECTS = ['sst_pin_account', 'sst_pin_plain', 'sst_pin_vault', 'sst_pin_ledger', 'sst_pin_badge', 'sst_pin_listonly'];

async function boot(): Promise<{ engine: ObjectQL; protocol: ObjectStackProtocolImplementation }> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.search-title-reference-name-visible-35308',
    name: 'Search title reference name visible',
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
        (type === 'permission' ? [MEMBER_SET].find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
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
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const insert = (object: string, rows: Array<Record<string, unknown>>) =>
    engine.insert(object, rows, { context: SYS_CTX } as never);
  await insert('sst_account', [
    { id: 'a1', name: 'Acme', region: 'NA' },
    { id: 'a2', name: 'Hidden Co', region: 'HIDDEN' },
  ]);
  await insert('sst_vault', [{ id: 'v1', title: 'Vault One' }]);
  await insert('sst_ledger', [{ id: 'l1', label: 'Payroll' }]);
  await insert('sst_badge', [{ id: 'b1', holder: 'Grace Hopper' }]);
  await insert('sst_listonly', [{ id: 'x1', title: 'Listed Only' }]);
  await insert('sst_pin_account', [
    { id: 'pa1', subject: 'alpha readable', ref: 'a1' },
    { id: 'pa2', subject: 'alpha refused', ref: 'a2' },
  ]);
  await insert('sst_pin_plain', [{ id: 'pp2', subject: 'alpha refused', ref: 'a2' }]);
  await insert('sst_pin_vault', [{ id: 'pv1', subject: 'alpha refused', ref: 'v1' }]);
  await insert('sst_pin_ledger', [{ id: 'pl1', subject: 'alpha refused', ref: 'l1' }]);
  await insert('sst_pin_badge', [{ id: 'pb1', subject: 'alpha refused', ref: 'b1' }]);
  await insert('sst_pin_listonly', [{ id: 'px1', subject: 'alpha refused', ref: 'x1' }]);

  const registry = () => new Map(Object.entries(services));
  const protocol = new ObjectStackProtocolImplementation(engine as any, registry);
  return { engine, protocol };
}

const titles = (hits: Array<{ id: string; title: string }>) => Object.fromEntries(hits.map((h) => [h.id, h.title]));

describe('[#35308] search titles a refused target by the name referenceNameVisible serves', () => {
  let engine: ObjectQL;
  let protocol: ObjectStackProtocolImplementation;

  beforeAll(async () => {
    ({ engine, protocol } = await boot());
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const search = (q: string, objects: string[] = PIN_OBJECTS) =>
    protocol.searchAll({ q, objects, perObject: 10, limit: 50, context: MEMBER_CTX });

  it('the readings these pins start from: a1 readable, a2 outside the row scope, the vault refused at the object gate', async () => {
    const accounts = await engine.find('sst_account', { context: MEMBER_CTX } as never);
    expect(accounts.map((r: any) => r.id)).toEqual(['a1']);
    const vault = await engine.find('sst_vault', { context: MEMBER_CTX } as never).then(() => null, (e: any) => e);
    expect({ code: vault?.code, status: vault?.statusCode }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('PIN 1 — the switch and a refusal (row scope, object gate): the hit is titled by the target name', async () => {
    const { hits } = await search('alpha', ['sst_pin_account', 'sst_pin_vault']);

    expect(titles(hits)).toEqual({ pa1: 'Acme', pa2: 'Hidden Co', pv1: 'Vault One' });
  });

  it('PIN 2 — the same pointer without the switch keeps the bare id', async () => {
    const { hits } = await search('alpha', ['sst_pin_plain']);

    expect(titles(hits)).toEqual({ pp2: 'a2' });
  });

  it('PIN 3 — a name column field-level security keeps from the searcher, or a masked one, is the engine floor', async () => {
    const { hits } = await search('alpha', ['sst_pin_ledger', 'sst_pin_badge']);

    expect(titles(hits)).toEqual({ pl1: 'Record #l1', pb1: 'Record #b1' });
    expect(JSON.stringify(hits)).not.toContain('Payroll');
    expect(JSON.stringify(hits)).not.toContain('Grace Hopper');
  });

  it('PIN 4 — a search by a served target name finds nothing: the name is display only', async () => {
    for (const q of ['Hidden', 'Vault One', 'Acme']) {
      const { hits, totalHits } = await search(q);
      expect({ q, hits, totalHits }).toEqual({ q, hits: [], totalHits: 0 });
    }
  });

  it('the hit wire shape does not move: record keeps the stored id', async () => {
    const { hits } = await search('alpha', ['sst_pin_account']);

    const hit = hits.find((h) => h.id === 'pa2')!;
    expect(Object.keys(hit).sort()).toEqual(['id', 'object', 'record', 'snippet', 'title']);
    expect(hit.record.ref).toBe('a2');
  });

  it('CONTROL — a readable target is titled by the searcher read and is never asked by name', async () => {
    const find = vi.spyOn(engine, 'find');
    try {
      const { hits } = await search('readable', ['sst_pin_account']);

      expect(titles(hits)).toEqual({ pa1: 'Acme' });
      const asks = find.mock.calls.filter(([object, query]) =>
        object === 'sst_pin_account' && (query as { expand?: unknown } | undefined)?.expand !== undefined);
      expect(asks).toEqual([]);
    } finally {
      find.mockRestore();
    }
  });

  it('CONTROL — a target whose declared exposure does not serve get keeps the bare id', async () => {
    const { hits } = await search('alpha', ['sst_pin_listonly']);

    expect(titles(hits)).toEqual({ px1: 'x1' });
  });
});
