// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13802 — an `address` / `location` value carrying an UNDECLARED key, at the
 * REST write door (`POST /api/v1/data/:object`), through a REAL engine
 * (`ObjectQL` + sqlite `SqlDriver`) and the real `RestServer` route — the same
 * harness `import-integration.test.ts` boots.
 *
 * Both value contracts were all-optional `.strip` objects, so the showcase
 * seed's `postal_code` (#13388) parsed green with the key silently gone. The
 * spec is strict now. What this file pins is the ADR-0112 envelope the door
 * answers with — `400` + `VALIDATION_FAILED` + the field code — AND the half
 * the ruling protected: the write path's ADR-0104 posture did not move. On a
 * deployment that has not attested `adr-0104-value-shapes` the write is still
 * ADMITTED warn-first, and the stored value reads back exactly as written —
 * no read path parses these shapes, so nothing is narrowed on the way out.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

function makeSqliteDriver() {
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED;
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const SITE = {
  name: 'site', label: 'Site', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    site_name: { name: 'site_name', type: 'text' as const, label: 'Name' },
    billing_address: { name: 'billing_address', type: 'address' as const, label: 'Billing Address' },
    hq: { name: 'hq', type: 'location' as const, label: 'HQ' },
  },
};

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

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(makeSqliteDriver(), true);
  await engine.init();
  engine.registry.registerObject(SITE as any);
  await engine.syncSchemas();

  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const create = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object',
  );
  expect(create).toBeDefined();
  return { engine, create };
}

// The showcase seed's own spelling (#13388), and a device extra on a location.
const SEED_TYPO = { street: '1 Main St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US' };
const DEVICE_EXTRA = { lat: 37.77, lng: -122.42, heading: 90 };
const DECLARED_ADDRESS = { street: '1 Main St', city: 'Seattle', state: 'WA', postalCode: '98101', country: 'US' };
const DECLARED_LOCATION = { lat: 37.77, lng: -122.42, accuracy: 5 };

describe('POST /api/v1/data/:object — undeclared keys on address/location values (#13802)', () => {
  let engine: any;
  let create: any;
  beforeEach(async () => { ({ engine, create } = await boot()); });

  const post = (body: Record<string, unknown>) => {
    const res = makeRes();
    return create.handler({ params: { object: 'site' }, body } as any, res).then(() => res);
  };

  it('strict deployment: answers 400 VALIDATION_FAILED + invalid_type, naming the key (code AND status)', async () => {
    process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED = '1';

    const res = await post({ id: 's1', site_name: 'HQ', billing_address: SEED_TYPO });
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ code: 'VALIDATION_FAILED', object: 'site' });
    expect(res._json.fields[0]).toMatchObject({ field: 'billing_address', code: 'invalid_type' });
    // The message carries the prescription — the key AND the spelling the contract lands on.
    expect(res._json.fields[0].message).toContain('`postal_code`');
    expect(res._json.fields[0].message).toContain('`postal_code` → `postalCode`');
    // The refused row left NOTHING behind.
    expect(await engine.findOne('site', { where: { id: 's1' } })).toBeNull();

    const geo = await post({ id: 's2', site_name: 'Depot', hq: DEVICE_EXTRA });
    expect(geo._status).toBe(400);
    expect(geo._json).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(geo._json.fields[0]).toMatchObject({ field: 'hq', code: 'invalid_type' });
    expect(geo._json.fields[0].message).toContain('`heading`');

    // …and the declared shapes still write on the same strict deployment.
    const ok = await post({ id: 's3', site_name: 'Lab', billing_address: DECLARED_ADDRESS, hq: DECLARED_LOCATION });
    expect(ok._status ?? 200).toBeLessThan(400);
    const stored = await engine.findOne('site', { where: { id: 's3' } });
    expect(stored?.billing_address).toEqual(DECLARED_ADDRESS);
    expect(stored?.hq).toEqual(DECLARED_LOCATION);
  });

  it('unattested deployment (the default): the write is ADMITTED warn-first and reads back verbatim — no read path is narrowed', async () => {
    // ADR-0104's evidence gate, not the schema, decides where the refusal
    // bites. This deployment has not attested `adr-0104-value-shapes`, so the
    // same body that the strict deployment refused above is admitted here…
    const res = await post({ id: 's4', site_name: 'Legacy', billing_address: SEED_TYPO, hq: DEVICE_EXTRA });
    expect(res._status ?? 200).toBeLessThan(400);

    // …and comes back exactly as written — the undeclared keys included.
    // Nothing on the read side parses these shapes; a stored value is the
    // stored value. `os migrate value-shapes` is the instrument that finds it.
    const stored = await engine.findOne('site', { where: { id: 's4' } });
    expect(stored?.billing_address).toEqual(SEED_TYPO);
    expect(stored?.hq).toEqual(DEVICE_EXTRA);
  });
});
