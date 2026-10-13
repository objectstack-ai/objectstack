// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3 / D9] The reduced kernel — ObjectQL, an app, plugin-auth's
 * identity objects (`createIdentityObjectsPlugin()`) and `SecurityPlugin`, no
 * `AuthPlugin` — holds its Default Organization before the app's inline seed
 * loads, so every seed row of a tenant-scoped object is stamped with it.
 *
 * Registering `sys_organization` is what moves the engine's and the seed
 * loader's zero-organization branch from "no organization object, unstamped"
 * to "refused" (D9). `IdentityObjectsPlugin` registers it, so its `start()`
 * keeps the invariant, as `AuthPlugin.start()` does in the full kernel
 * (`default-organization-boot-invariant.pin.test.ts` is that kernel's pin).
 *
 * The seed is `AppPlugin`'s own, the producer of the refusal this pin guards
 * against: "the install holds no organization at all". `AppPlugin` is
 * registered BEFORE the identity objects on purpose, so the kernel has to start
 * them first from `AppPlugin`'s declared order-if-present dependency, not from
 * where a host happened to list it.
 *
 * Controls: an object declaring `tenancy: { enabled: false }` takes no
 * organization, seeded or inserted; under a walled posture this plugin creates
 * no organization and `AppPlugin` replays its seed per organization instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';

const BOOT_TIMEOUT = 120_000;
const SYS = { isSystem: true };

const PIN_APP: any = {
  manifest: { id: 'com.pin.identityobjectsdefaultorg', name: 'Identity objects default organization pins', version: '1.0.0' },
  objects: [
    { name: 'pin_kit_ledger', label: 'Pin kit ledger', fields: { title: { type: 'text', label: 'Title' } } },
    {
      // ADR-0066: the declared way to hold rows that belong to no organization.
      name: 'pin_kit_licence',
      label: 'Pin kit licence',
      tenancy: { enabled: false },
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
  data: [
    { object: 'pin_kit_ledger', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded one' }, { title: 'seeded two' }] },
    { object: 'pin_kit_licence', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded licence' }] },
  ],
};

const rowsOf = (r: unknown): Array<Record<string, any>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, any>> })?.records ?? []);

interface Booted {
  kernel: ObjectKernel;
  engine: ObjectQL;
  find: (object: string, where?: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  /** Every insert's object, in order, as the engine saw it. */
  inserts: string[];
}

async function boot(): Promise<Booted> {
  const inserts: string[] = [];
  const probe: Plugin = {
    name: 'pin.identity-objects-default-org.probe',
    version: '0.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      ctx.getService<ObjectQL>('objectql').registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.operation === 'insert') inserts.push(String(opCtx.object));
        await next();
      });
    },
  };
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(probe);
  // Before the identity objects, on purpose: see the header.
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  return {
    kernel,
    engine,
    inserts,
    find: async (object, where = {}) => rowsOf(await engine.find(object, { where, limit: 50, context: SYS })),
  };
}

describe('[ADR-0131 D3] the reduced kernel under `single` (no AuthPlugin)', () => {
  let K: Booted;
  beforeAll(async () => { K = await boot(); }, BOOT_TIMEOUT);
  afterAll(async () => { try { await K?.kernel.shutdown(); } catch { /* best-effort */ } }, 60_000);

  it('holds exactly the Default Organization, written before the first seed row', async () => {
    expect((await K.find('sys_organization')).map((o) => o.slug)).toEqual(['default']);
    const organization = K.inserts.indexOf('sys_organization');
    const firstSeed = K.inserts.indexOf('pin_kit_ledger');
    // Both were observed — the order below compares two real writes.
    expect(organization).toBeGreaterThanOrEqual(0);
    expect(firstSeed).toBeGreaterThanOrEqual(0);
    expect(organization).toBeLessThan(firstSeed);
  });

  it('every seed row of the tenant-scoped object carries it; the tenancy-off control carries none', async () => {
    const [org] = await K.find('sys_organization');
    const ledger = await K.find('pin_kit_ledger', { title: { $in: ['seeded one', 'seeded two'] } });
    expect(ledger.map((r) => r.organization_id)).toEqual([org.id, org.id]);
    // CONTROL — the seed WAS written, and with no organization, where the
    // object declares none: the stamp is a per-object derivation.
    const licences = await K.find('pin_kit_licence', { title: 'seeded licence' });
    expect(licences.map((r) => r.organization_id ?? null)).toEqual([null]);
  });

  it('an isSystem insert on the tenant-scoped object, naming no organization, lands stamped with it', async () => {
    const [org] = await K.find('sys_organization');
    const row = await K.engine.insert('pin_kit_ledger', { title: 'system write, no organization' }, { context: SYS });
    expect((await K.find('pin_kit_ledger', { id: row.id }))[0]?.organization_id).toBe(org.id);
  });
});

describe('the reduced kernel under a walled posture: unchanged', () => {
  let K: Booted;
  let prev: string | undefined;
  beforeAll(async () => {
    prev = process.env.OS_TENANCY_POSTURE;
    process.env.OS_TENANCY_POSTURE = 'isolated';
    K = await boot();
  }, BOOT_TIMEOUT);
  afterAll(async () => {
    try { await K?.kernel.shutdown(); } catch { /* best-effort */ }
    if (prev === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = prev;
  }, 60_000);

  it('creates no organization, and AppPlugin leaves its seed to the per-organization replay', async () => {
    expect(await K.find('sys_organization')).toEqual([]);
    expect(K.inserts).not.toContain('sys_organization');
    expect(await K.find('pin_kit_ledger')).toEqual([]);
  });
});
