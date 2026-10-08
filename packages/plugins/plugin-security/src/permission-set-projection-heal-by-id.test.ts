// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22169] The boot heal converges on a table holding DUPLICATE rows of a name.
 *
 * `reconcilePermissionSetProjection` pages `sys_permission_set` and heals every
 * overlay-less, env-authored row that drifted from its declared body. It used
 * to hand each drifted row to a by-NAME upsert, which re-read "the" row as the
 * first one of that name (lowest id) — so with two or more rows per name only
 * that one was ever written, and every later row was warned about as
 * "re-projected" and left drifted, on every boot. Measured on a real engine
 * (8 names × 3 rows): 16 of 24 rows still drifted and 16 drift warns on boot 2,
 * 3, … . The same by-name read had an INSERT branch that a refused read reached
 * (`tryFind` answers `[]` for a throw), minting a duplicate of a row the loop
 * was holding. And a layered metadata read (four serial statements on the real
 * protocol) was awaited for every candidate row although a readable
 * SchemaRegistry makes the trust rule ignore it.
 *
 * ## The harness, and why each piece is real
 *
 * A REAL `ObjectQL` over a REAL `SqlDriver` (better-sqlite3 `:memory:`), both
 * aliased to source by this package's `vitest.config.ts`. The by-name read the
 * defect lives in is the engine's own `ORDER BY id LIMIT 1`, and the heal's
 * write is the engine's own update by id — a fake table would answer for its
 * author instead. The per-organization unique index is DROPPED after schema
 * sync: that is the shape of a remote table built before the index retrofit,
 * the only shape that can hold duplicates, and a table that already holds them
 * can never build the index again.
 *
 * The engine is SPIED, never replaced: each spied verb counts and then runs
 * the real method, so no double stands between the heal and the engine's own
 * dispatch contract. The protocol is a counting stub — what is pinned about it
 * is whether it is CALLED, which a stub answers exactly.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import {
  permissionSetRowFields,
  reconcilePermissionSetProjection,
  recordDiffersFromBody,
} from './permission-set-projection.js';

const SYS = { context: { isSystem: true } } as any;

/** Just enough `sys_metadata` for the overlay pass to read an empty table. */
const SYS_METADATA_OBJECT: any = {
  name: 'sys_metadata',
  label: 'System Metadata',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    type: { name: 'type', label: 'Type', type: 'text', required: true },
    name: { name: 'name', label: 'Name', type: 'text', required: true },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' },
    package_id: { name: 'package_id', label: 'Package', type: 'text' },
    metadata: { name: 'metadata', label: 'Body', type: 'textarea' },
    state: { name: 'state', label: 'State', type: 'text' },
  },
};

const declaredBody = (name: string) => ({
  name,
  label: `Declared ${name}`,
  objects: { crm_lead: { allowRead: true } },
  systemPermissions: ['declared.baseline'],
});

/** A row of `name` whose facets drifted from the declaration. */
const driftedRow = (id: string, name: string) => ({
  id,
  name,
  managed_by: 'admin',
  active: true,
  ...permissionSetRowFields(declaredBody(name)),
  system_permissions: '["drifted.edit"]',
});

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(declaredNames: string[], rows: Array<Record<string, any>>): Promise<ObjectQL> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.heal-by-id-22169',
    name: 'Heal by id',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPermissionSet, SYS_METADATA_OBJECT],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);
  await (driver as any).getKnex().raw('DROP INDEX IF EXISTS uniq_sys_permission_set_organization_id_name');
  for (const name of declaredNames) {
    engine.registry.registerItem('permission', declaredBody(name), 'name', 'com.example.pkg');
  }
  for (const row of rows) await (engine as any).insert('sys_permission_set', row, SYS);
  return engine;
}

/**
 * The real engine with its verbs SPIED — every call still runs the real method,
 * so the engine's own dispatch contract answers it; the spies only count and,
 * when `refuseNameReads` is set, make a by-name read of the table throw.
 *
 * `withRegistry: false` hands the heal the same engine with `registry` hidden,
 * the shape of a kernel whose SchemaRegistry is not readable — the one shape
 * whose trust rule still reads the layered item.
 */
function observe(engine: any, opts: { withRegistry?: boolean } = {}) {
  const log = { updatedIds: [] as string[], inserts: 0 };
  const state = { refuseNameReads: false };
  const realFind = engine.find.bind(engine);
  const realInsert = engine.insert.bind(engine);
  const realUpdate = engine.update.bind(engine);
  vi.spyOn(engine, 'find').mockImplementation(async (o: any, q?: any, opt?: any) => {
    const byName = o === 'sys_permission_set' && q?.where && typeof q.where === 'object' && 'name' in q.where;
    if (byName && state.refuseNameReads) throw new Error('fake outage: the by-name read was refused');
    return realFind(o, q, opt);
  });
  vi.spyOn(engine, 'insert').mockImplementation(async (o: any, d: any, opt?: any) => {
    if (o === 'sys_permission_set') log.inserts += 1;
    return realInsert(o, d, opt);
  });
  vi.spyOn(engine, 'update').mockImplementation(async (o: any, d: any, opt?: any) => {
    if (o === 'sys_permission_set') log.updatedIds.push(String(d?.id));
    return realUpdate(o, d, opt);
  });
  const ql = opts.withRegistry === false
    ? new Proxy(engine, {
      get(target, prop) {
        if (prop === 'registry') return undefined;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })
    : engine;
  return { ql, log, state };
}

/** A protocol that answers the layered read from the declarations and counts every call. */
function countingProtocol(declaredNames: string[]) {
  const layeredReads: string[] = [];
  return {
    layeredReads,
    async getMetaItemLayered(req: { type: string; name: string }) {
      layeredReads.push(req.name);
      const code = declaredNames.includes(req.name) ? declaredBody(req.name) : null;
      return { type: 'permission', name: req.name, code, overlay: null, effective: code };
    },
  };
}

function captureWarns() {
  const warns: Array<{ msg: string; meta?: any }> = [];
  return {
    warns,
    driftWarns: () => warns.filter((w) => w.msg.includes('drifted from its metadata definition')),
    logger: { info: () => {}, warn: (msg: string, meta?: any) => warns.push({ msg, meta }) },
  };
}

async function allRows(engine: ObjectQL): Promise<any[]> {
  return (await (engine as any).find('sys_permission_set', { where: {}, limit: 100 }, SYS)) as any[];
}

describe('#22169 — the boot heal writes the row it read, by id', () => {
  it('a duplicated name: each drifted row is written once, by its own id, and the next boot logs no drift warn', async () => {
    const engine = await boot(['member_default'], [
      driftedRow('ps_a', 'member_default'),
      driftedRow('ps_b', 'member_default'),
    ]);
    const { ql, log } = observe(engine);
    const protocol = countingProtocol(['member_default']);

    const first = captureWarns();
    const out1 = await reconcilePermissionSetProjection(protocol, { ql, logger: first.logger });

    expect([...log.updatedIds].sort(), 'each drifted row written once, by ITS id').toEqual(['ps_a', 'ps_b']);
    expect(log.inserts).toBe(0);
    expect(out1.driftHealed).toBe(2);
    // The warn is said per row healed, AFTER its write, and names the row.
    expect(first.driftWarns().map((w) => w.meta?.id).sort()).toEqual(['ps_a', 'ps_b']);
    for (const row of await allRows(engine)) {
      expect(recordDiffersFromBody(row, declaredBody('member_default')), `${row.id} converged`).toBe(false);
    }

    // Boot 2: nothing drifted, so nothing is written and nothing is warned.
    log.updatedIds.length = 0;
    const second = captureWarns();
    const out2 = await reconcilePermissionSetProjection(protocol, { ql, logger: second.logger });
    expect(second.driftWarns(), 'the next boot logs no drift warn').toEqual([]);
    expect(log.updatedIds).toEqual([]);
    expect(out2.driftHealed).toBe(0);
    expect(await allRows(engine)).toHaveLength(2);   // ⛔ duplicates are healed, never deleted here
  });

  it('control: a single drifted row heals as it always did — one write, one warn, then silence', async () => {
    const engine = await boot(['viewer_readonly'], [driftedRow('ps_v', 'viewer_readonly')]);
    const { ql, log } = observe(engine);
    const protocol = countingProtocol(['viewer_readonly']);

    const first = captureWarns();
    const out1 = await reconcilePermissionSetProjection(protocol, { ql, logger: first.logger });
    expect(log.updatedIds).toEqual(['ps_v']);
    expect(out1.driftHealed).toBe(1);
    expect(first.driftWarns()).toHaveLength(1);
    const [row] = await allRows(engine);
    expect(JSON.parse(row.system_permissions)).toEqual(['declared.baseline']);
    expect(row.managed_by, 'facets only — provenance untouched').toBe('admin');

    const second = captureWarns();
    await reconcilePermissionSetProjection(protocol, { ql, logger: second.logger });
    expect(second.driftWarns()).toEqual([]);
  });

  it('issues NO layered metadata read while a SchemaRegistry answers — on the healing boot or after it', async () => {
    const engine = await boot(['member_default', 'viewer_readonly'], [
      driftedRow('ps_a', 'member_default'),
      driftedRow('ps_b', 'member_default'),
      driftedRow('ps_v', 'viewer_readonly'),
    ]);
    const { ql } = observe(engine);
    const protocol = countingProtocol(['member_default', 'viewer_readonly']);

    await reconcilePermissionSetProjection(protocol, { ql, logger: captureWarns().logger });
    await reconcilePermissionSetProjection(protocol, { ql, logger: captureWarns().logger });
    expect(protocol.layeredReads).toEqual([]);
  });

  it('without a SchemaRegistry the layered read is still the source — asked once per NAME, not per row', async () => {
    const engine = await boot([], [
      driftedRow('ps_a', 'member_default'),
      driftedRow('ps_b', 'member_default'),
    ]);
    const { ql, log } = observe(engine, { withRegistry: false });
    const protocol = countingProtocol(['member_default']);

    const out = await reconcilePermissionSetProjection(protocol, { ql, logger: captureWarns().logger });
    expect(protocol.layeredReads).toEqual(['member_default']);
    expect([...log.updatedIds].sort()).toEqual(['ps_a', 'ps_b']);
    expect(out.driftHealed).toBe(2);
  });

  it('a refused by-name existence read inserts nothing — the heal holds the row and writes it by id', async () => {
    const engine = await boot(['member_default'], [
      driftedRow('ps_a', 'member_default'),
      driftedRow('ps_b', 'member_default'),
    ]);
    const { ql, log, state } = observe(engine);
    state.refuseNameReads = true;
    const protocol = countingProtocol(['member_default']);

    await reconcilePermissionSetProjection(protocol, { ql, logger: captureWarns().logger });
    expect(log.inserts, '⛔ no row minted on a read that did not answer').toBe(0);
    expect(await allRows(engine)).toHaveLength(2);
    expect([...log.updatedIds].sort()).toEqual(['ps_a', 'ps_b']);
  });
});
