// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A, PR 2] Declared membership keys (`ObjectSchema.membershipKeys`)
 * staged by `stageRlsMembership` beside the registered resolver.
 *
 * Driven on the real `SecurityPlugin` + `ObjectQL` over a real `SqlDriver`,
 * under the `isolated` posture. `qa_supplier_contact` is the roster: it
 * declares `portal_supplier_ids` (the `supplier` of each ACTIVE row whose
 * `user` is the caller). `qa_po` and `qa_asn` are read through a permission
 * set whose only row policy is `supplier in current_user.portal_supplier_ids`,
 * and that set grants NO read on the roster. Rows are written straight into
 * the tables, past every scope.
 *
 * `u_x` (organisation X) has three roster rows: S-1 active, S-3 inactive, and
 * S-2 active but stored in organisation Y. So the key is `[S-1]`: the filter
 * drops S-3 and the caller's Layer 0 wall drops S-2.
 *
 * The pins:
 *  1. The read door and the write `check` both read the key; CONTROL: without
 *     the declaration the same policy matches no rows (the key fails closed).
 *  2. Rider 1: the caller holds no read on the roster and still resolves the
 *     key; the read is the platform's system read, with the same arguments
 *     whatever the caller's posture or audience. Rider 2: an internal member
 *     resolves it exactly as a portal contact does.
 *  3. One read per key per request, however many objects read it; none when
 *     no policy reads it.
 *  4. Fail closed: no roster row (`[]`), more than the bound, a key two
 *     objects declare, a filter that does not compile, and a key the
 *     registered resolver also owns (resolved from neither, with an error at
 *     boot naming both owners).
 *  5. Explain names the key, the roster object, its fields, filter and size,
 *     and who can grant it (rider 3); a record-grained rule reads
 *     `via: 'membership:portal_supplier_ids'` and names the roster row.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema, MEMBERSHIP_KEY_MAX_VALUES, type PermissionSet } from '@objectstack/spec/security';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { RLSCompiler } from './rls-compiler.js';
import { membershipKeyReadsOf, stageDeclaredMembershipKeys, type MembershipKeyStagingHost } from './object-membership-keys.js';

const SYS = { context: { isSystem: true } } as never;
const KEY = 'portal_supplier_ids';
const DECLARATION = { userField: 'user', valueField: 'supplier', filter: 'active == true', label: 'Portal suppliers' };

const authored = (set: Record<string, unknown>): PermissionSet => PermissionSetSchema.parse(set) as PermissionSet;

/** The portal set: POs and ASNs of the caller's suppliers, and NO read on the roster. */
const PORTAL = authored({
  name: 'qa_portal',
  label: 'Portal',
  objects: { qa_po: { allowRead: true, allowCreate: true }, qa_asn: { allowRead: true } },
  rowLevelSecurity: [
    { name: 'qa_po_my_suppliers', object: 'qa_po', operation: 'all', using: `supplier in current_user.${KEY}` },
    { name: 'qa_asn_my_suppliers', object: 'qa_asn', operation: 'select', using: `supplier in current_user.${KEY}` },
  ],
});
/** Reads POs with a policy that reads no key: the lazy control. */
const PLAIN_READER = authored({
  name: 'qa_plain_reader',
  label: 'Plain reader',
  objects: { qa_po: { allowRead: true } },
  rowLevelSecurity: [{ name: 'qa_po_north', object: 'qa_po', operation: 'select', using: "region == 'north'" }],
});
/** Writes the roster: whoever holds it can grant the key (rider 3). */
const ROSTER_ADMIN = authored({
  name: 'qa_roster_admin',
  label: 'Roster admin',
  objects: { qa_supplier_contact: { allowRead: true, allowCreate: true, allowEdit: true } },
});
const AUTHORED_SETS = [PORTAL, PLAIN_READER, ROSTER_ADMIN];

const principal = (permissions: string[], extra: Record<string, unknown> = {}) => ({
  userId: 'u_x',
  tenantId: 'org_x',
  positions: [] as string[],
  permissions,
  posture: 'MEMBER',
  org_user_ids: ['u_x'],
  email: 'u_x@example.test',
  ...extra,
});

const roster = (membershipKeys?: Record<string, unknown>, name = 'qa_supplier_contact') => ({
  name,
  label: name,
  fields: {
    name: { name: 'name', type: 'text' },
    user: { name: 'user', type: 'text' },
    supplier: { name: 'supplier', type: 'text' },
    active: { name: 'active', type: 'boolean' },
  },
  ...(membershipKeys ? { membershipKeys } : {}),
});
const orders = (name: string) => ({
  name,
  label: name,
  fields: {
    name: { name: 'name', type: 'text' },
    supplier: { name: 'supplier', type: 'text' },
    region: { name: 'region', type: 'text' },
  },
});

type Table = (name: string) => { insert(rows: Array<Record<string, unknown>>): Promise<unknown> };
const engines: ObjectQL[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

interface Shape {
  /** The roster's `membershipKeys`; absent → the roster declares none. */
  keys?: Record<string, unknown>;
  /** A second roster object, declaring these keys too. */
  secondRosterKeys?: Record<string, unknown>;
  /** A registered code resolver. */
  resolver?: { keys: string[]; resolve: () => Promise<Record<string, string[]>> };
  /** Roster rows to add for `u_x` in organisation X, beyond the three. */
  extraRosterRows?: number;
}

async function boot(shape: Shape) {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.object-membership-keys',
    name: 'Object membership keys',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      roster(shape.keys),
      ...(shape.secondRosterKeys ? [roster(shape.secondRosterKeys, 'qa_buyer_contact')] : []),
      orders('qa_po'),
      orders('qa_asn'),
    ],
  } as never);
  await engine.syncSchemas();
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
    ...(shape.resolver ? { [RLS_MEMBERSHIP_RESOLVER_SERVICE]: shape.resolver } : {}),
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
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, fallbackPermissionSet: null });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const table = (driver as unknown as { knex: Table }).knex;
  await table('qa_supplier_contact').insert([
    { id: 'c_17', name: 'C-17', user: 'u_x', supplier: 'S-1', active: true, organization_id: 'org_x' },
    { id: 'c_21', name: 'C-21', user: 'u_x', supplier: 'S-3', active: false, organization_id: 'org_x' },
    { id: 'c_30', name: 'C-30', user: 'u_x', supplier: 'S-2', active: true, organization_id: 'org_y' },
    { id: 'c_40', name: 'C-40', user: 'u_y', supplier: 'S-2', active: true, organization_id: 'org_x' },
  ]);
  const extra = Array.from({ length: shape.extraRosterRows ?? 0 }, (_, i) => ({
    id: `c_extra_${i}`, name: `extra ${i}`, user: 'u_x', supplier: `S-x${i}`, active: true, organization_id: 'org_x',
  }));
  // SQLite caps one compound insert, so the bound's worth of rows goes in slices.
  for (let i = 0; i < extra.length; i += 200) await table('qa_supplier_contact').insert(extra.slice(i, i + 200));
  for (const object of ['qa_po', 'qa_asn']) {
    await table(object).insert(
      ['S-1', 'S-2', 'S-3'].map((supplier) => ({
        id: `${object}:${supplier}`, name: `${object} ${supplier}`, supplier, region: 'north', organization_id: 'org_x',
      })),
    );
  }

  const ids = async (object: string, context: object): Promise<string[]> => {
    const rows = (await engine.find(object, { context: { ...context } } as never)) as Array<{ id: string }>;
    return rows.map((r) => r.id).sort();
  };
  /** The roster reads staging issued: `find` calls on the roster object under a system context. */
  const findSpy = vi.spyOn(engine, 'find');
  const rosterReads = () =>
    findSpy.mock.calls.filter(([object, opts]) => object === 'qa_supplier_contact' && (opts as any)?.context?.isSystem === true);
  return { engine, security, logger, ids, rosterReads, table };
}

describe('[#25234 A] the read door and the write check read a declared key', () => {
  it('a portal contact reads only the POs of its active suppliers inside its organisation', async () => {
    const { ids } = await boot({ keys: { [KEY]: DECLARATION } });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual(['qa_po:S-1']);
  });

  it('CONTROL: without the declaration the same policy matches no rows (the key fails closed)', async () => {
    const { ids } = await boot({});
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
  });

  it('the insert `check` reads the key too: a PO for a roster supplier is written, any other is refused', async () => {
    const { engine } = await boot({ keys: { [KEY]: DECLARATION } });
    const writer = { context: principal([PORTAL.name]) } as never;
    await engine.insert('qa_po', { id: 'po_new_1', name: 'new', supplier: 'S-1', region: 'south' }, writer);
    const refused = await engine
      .insert('qa_po', { id: 'po_new_2', name: 'new', supplier: 'S-2', region: 'south' }, writer)
      .then(() => null, (e: { code?: string; status?: number }) => e);
    expect({ code: refused?.code, status: refused?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    const written = (await engine.find('qa_po', { where: { name: 'new' } }, SYS)) as Array<{ id: string }>;
    expect(written.map((r) => r.id)).toEqual(['po_new_1']);
  });
});

describe('[#25234 A] riders 1 and 2: the platform\'s own system read, audience-neutral', () => {
  it('the caller cannot read the roster, and still resolves the key from it', async () => {
    const { ids, engine } = await boot({ keys: { [KEY]: DECLARATION } });
    const portal = principal([PORTAL.name]);
    const ownRead = await engine
      .find('qa_supplier_contact', { context: { ...portal } } as never)
      .then(() => null, (e: { code?: string }) => e);
    expect(ownRead?.code).toBe('PERMISSION_DENIED');
    expect(await ids('qa_po', portal)).toEqual(['qa_po:S-1']);
  });

  it('an internal member resolves the key exactly as an external contact does', async () => {
    const { ids } = await boot({ keys: { [KEY]: DECLARATION } });
    expect(await ids('qa_po', principal([PORTAL.name], { posture: 'MEMBER' }))).toEqual(['qa_po:S-1']);
    expect(await ids('qa_po', principal([PORTAL.name], { audience: 'external' }))).toEqual(['qa_po:S-1']);
    expect(await ids('qa_po', principal([PORTAL.name], { posture: 'TENANT_ADMIN' }))).toEqual(['qa_po:S-1']);
  });

  it('the roster read is the same system read whatever the caller\'s posture or audience', async () => {
    const reads: unknown[] = [];
    const host = stubHost({ find: async (object, opts) => { reads.push({ object, opts }); return [] as unknown[]; } });
    const policy = { name: 'p', object: 'qa_po', operation: 'select', using: `supplier in current_user.${KEY}` } as never;
    for (const extra of [
      { posture: 'MEMBER' },
      { posture: 'EXTERNAL', audience: 'external' },
      { posture: 'PLATFORM_ADMIN', permissions: ['admin_full_access'] },
      { posture: 'TENANT_ADMIN', audience: 'internal' },
    ]) {
      await stageDeclaredMembershipKeys(host, { userId: 'u_x', tenantId: 'org_x', ...extra }, [policy], 'qa_po');
    }
    expect(reads).toHaveLength(4);
    for (const read of reads) expect(read).toEqual(reads[0]);
    expect(reads[0]).toEqual({
      object: 'qa_supplier_contact',
      opts: {
        where: { $and: [{ user: 'u_x' }, { active: true }, { organization_id: 'org_x' }] },
        fields: ['id', 'supplier'],
        limit: MEMBERSHIP_KEY_MAX_VALUES + 1,
        context: { isSystem: true },
      },
    });
  });
});

describe('[#25234 A] per key, lazily, once per request', () => {
  it('one roster read for a request that reads the key on two objects', async () => {
    const { engine, rosterReads } = await boot({ keys: { [KEY]: DECLARATION } });
    const context = principal([PORTAL.name]);
    const po = (await engine.find('qa_po', { context } as never)) as Array<{ id: string }>;
    const asn = (await engine.find('qa_asn', { context } as never)) as Array<{ id: string }>;
    expect(po.map((r) => r.id)).toEqual(['qa_po:S-1']);
    expect(asn.map((r) => r.id)).toEqual(['qa_asn:S-1']);
    expect(rosterReads()).toHaveLength(1);
  });

  it('no roster read for a request whose policies read no key', async () => {
    const { ids, rosterReads } = await boot({ keys: { [KEY]: DECLARATION } });
    expect(await ids('qa_po', principal([PLAIN_READER.name]))).toHaveLength(3);
    expect(rosterReads()).toHaveLength(0);
  });

  it('reads the key names a predicate reads, through the SQL bridge, and never a kernel name', () => {
    expect(membershipKeyReadsOf(`supplier in current_user.${KEY} || owner == current_user.id`)).toEqual([KEY]);
    expect(membershipKeyReadsOf(`supplier IN (current_user.${KEY})`)).toEqual([KEY]);
    expect(membershipKeyReadsOf(`supplier in current_user["${KEY}"]`)).toEqual([KEY]);
    expect(membershipKeyReadsOf(`name == "current_user.${KEY}"`)).toEqual([]);
    expect(membershipKeyReadsOf('id in current_user.org_user_ids')).toEqual([]);
  });
});

describe('[#25234 A] every miss fails closed', () => {
  it('a caller with no roster row is staged an empty set and reads nothing', async () => {
    const { ids } = await boot({ keys: { [KEY]: DECLARATION } });
    expect(await ids('qa_po', principal([PORTAL.name], { userId: 'u_z' }))).toEqual([]);
  });

  it('more roster rows than the bound leaves the key unresolved', async () => {
    const { ids, logger } = await boot({ keys: { [KEY]: DECLARATION }, extraRosterRows: MEMBERSHIP_KEY_MAX_VALUES });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
    expect(logger.warn.mock.calls.map(([m]) => String(m)).some((m) => m.includes(`'${KEY}'`) && m.includes('bound'))).toBe(true);
  });

  it('CONTROL: exactly the bound resolves', async () => {
    const { ids } = await boot({ keys: { [KEY]: DECLARATION }, extraRosterRows: MEMBERSHIP_KEY_MAX_VALUES - 1 });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual(['qa_po:S-1']);
  });

  it('a filter that reads `current_user.*` does not compile for the roster, so the key is unresolved', async () => {
    const { ids } = await boot({ keys: { [KEY]: { ...DECLARATION, filter: 'user == current_user.id' } } });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
  });

  it('a filter naming a column the roster lacks is refused, never read vacuously', async () => {
    const { ids } = await boot({ keys: { [KEY]: { ...DECLARATION, filter: 'nope != "x"' } } });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
  });

  it('a key two objects declare resolves from neither', async () => {
    const { ids, logger } = await boot({ keys: { [KEY]: DECLARATION }, secondRosterKeys: { [KEY]: DECLARATION } });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
    const errors = logger.error.mock.calls.map(([m]) => String(m));
    expect(errors.some((m) => m.includes(`'${KEY}'`) && m.includes('qa_supplier_contact') && m.includes('qa_buyer_contact'))).toBe(true);
  });

  it('a key the registered resolver also owns resolves from neither, and the boot names both owners', async () => {
    const resolver = { keys: [KEY], resolve: vi.fn(async () => ({ [KEY]: ['S-1', 'S-2', 'S-3'] })) };
    const { ids, logger } = await boot({ keys: { [KEY]: DECLARATION }, resolver });
    const bootErrors = logger.error.mock.calls.map(([m]) => String(m));
    expect(bootErrors.some((m) => m.includes(`'${KEY}'`) && m.includes("'qa_supplier_contact'") && m.includes('rls-membership-resolver'))).toBe(true);
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual([]);
    expect(resolver.resolve).toHaveBeenCalled();
  });

  it('CONTROL: the resolver alone still supplies a key no object declares', async () => {
    const resolver = { keys: [KEY], resolve: vi.fn(async () => ({ [KEY]: ['S-2'] })) };
    const { ids, logger } = await boot({ resolver });
    expect(await ids('qa_po', principal([PORTAL.name]))).toEqual(['qa_po:S-2']);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('[#25234 A] explain names the key, the roster and who can grant it', () => {
  type RlsLayer = { layer: string; verdict: string; detail: string; record?: any };
  const rlsLayer = (decision: { layers: RlsLayer[] }): RlsLayer => {
    const layer = decision.layers.find((l) => l.layer === 'rls');
    if (!layer) throw new Error('explain returned no rls layer');
    return layer;
  };

  it('object-level: the key, X, F, U, the filter, the size and the roster\'s writers', async () => {
    const { security } = await boot({ keys: { [KEY]: DECLARATION } });
    const layer = rlsLayer(await security.explain({ object: 'qa_po', operation: 'read' }, principal([PORTAL.name])));
    expect(layer.verdict).toBe('narrows');
    for (const subject of [`'${KEY}' (Portal suppliers)`, "'qa_supplier_contact'", "'supplier'", "'user'", "'active == true'", 'resolved to 1 value(s)', 'qa_roster_admin']) {
      expect(layer.detail).toContain(subject);
    }
    expect(layer.detail).toContain("Whoever can write 'qa_supplier_contact' can grant this key");
    expect(layer.detail).not.toContain('qa_portal');
  });

  it('object-level: a key that resolved to no value, or did not resolve, says so', async () => {
    const { security } = await boot({ keys: { [KEY]: DECLARATION } });
    const empty = rlsLayer(await security.explain({ object: 'qa_po', operation: 'read' }, principal([PORTAL.name], { userId: 'u_z' })));
    expect(empty.detail).toContain('resolved to 0 value(s) for this principal, so every policy reading it matches no rows');
    const refused = await boot({ keys: { [KEY]: { ...DECLARATION, filter: 'user == current_user.id' } } });
    const layer = rlsLayer(await refused.security.explain({ object: 'qa_po', operation: 'read' }, principal([PORTAL.name])));
    expect(layer.detail).toContain('did not resolve (filter-refused');
  });

  it('record-grained: `via: membership:KEY`, and the roster row that links the record', async () => {
    const { security } = await boot({ keys: { [KEY]: DECLARATION } });
    const layer = rlsLayer(
      await security.explain({ object: 'qa_po', operation: 'read', recordId: 'qa_po:S-1' }, principal([PORTAL.name])),
    );
    expect(layer.record.rules).toEqual([
      expect.objectContaining({ kind: 'rls_policy', name: 'business_rls', via: `membership:${KEY}`, effect: 'admits' }),
    ]);
    expect(layer.record.detail).toContain("'qa_supplier_contact' row 'c_17'");
    expect(layer.record.detail).toContain("'S-1'");
  });

  it('CONTROL: a policy that reads no key is explained as before', async () => {
    const { security } = await boot({ keys: { [KEY]: DECLARATION } });
    const layer = rlsLayer(await security.explain({ object: 'qa_po', operation: 'read' }, principal([PLAIN_READER.name])));
    expect(layer.detail).not.toContain('Membership key');
    const record = rlsLayer(
      await security.explain({ object: 'qa_po', operation: 'read', recordId: 'qa_po:S-1' }, principal([PLAIN_READER.name])),
    );
    expect(record.record.rules[0].via).toBeUndefined();
  });
});

/** A staging host over a stub engine whose registry declares the key on the roster. */
function stubHost(engine: { find: (object: string, opts: unknown) => Promise<unknown[]> }): MembershipKeyStagingHost {
  const rosterFields = new Set(['id', 'name', 'user', 'supplier', 'active', 'organization_id']);
  return {
    logger: { warn: vi.fn(), error: vi.fn() },
    ql: {
      find: engine.find,
      registry: { getAllObjects: () => [{ name: 'qa_supplier_contact', membershipKeys: { [KEY]: DECLARATION } }] },
    },
    metadata: {},
    rlsCompiler: new RLSCompiler(),
    rlsMembershipResolver: null,
    tenancyPosture: 'isolated',
    tenancyDisabledCache: new Map(),
    datetimeFieldNamesCache: new Map(),
    numberComparandFieldsCache: new Map(),
    getObjectFieldNames: async () => rosterFields,
    getObjectSecurityMeta: async () => ({ isPrivate: false, tenancyDisabled: false, isBetterAuthManaged: false, tenantAnchorIsPhantom: false }),
  };
}
