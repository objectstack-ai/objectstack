// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller that names no organization reads and writes the `sys_setting` rows
 * of the organization the COMPOSITION names for it — never a row written with
 * no organization as a fallback (ADR-0131 D8), and never a guess.
 *
 * `settings-organization-isolation.pin.test.ts` pins the service's reach over
 * each answer ADR-0131 D9 can give, handed in directly. This file pins where
 * the answer comes from in a deployment: the REAL `SettingsServicePlugin`
 * production sequence (`init` → `start` → the `kernel:ready` hook) on a REAL
 * `ObjectKernel`, binding a REAL `ObjectQL` engine with its `tenancy` service,
 * so the organization source is the one the plugin wires — the engine's own D9
 * predicate over the composition's facts. Only the driver is a Map; it stamps
 * the organization the engine threads to it, as the SQL driver's
 * `injectTenantOnInsert` does.
 *
 * The callers this stands for read with an empty context: plugin-auth's email
 * brand name and boot-time locale, the anonymous runtime-config door's
 * branding read, and a signed-in caller with no active organization.
 */

import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SysPlatformSetting, SysSetting } from '@objectstack/platform-objects/system';
import { SettingsServicePlugin } from './settings-service-plugin.js';
import type { SettingsService } from './settings-service.js';

const SYS = { context: { isSystem: true } } as const;
const NS = 'org_reach_fixture';
const ORG = 'org_default';

const MANIFEST = {
  namespace: NS,
  label: 'Organization reach fixture',
  scope: 'tenant',
  specifiers: [
    { key: 'brand', type: 'text', label: 'Brand', scope: 'tenant', default: 'none' },
    { key: 'legacy', type: 'text', label: 'Legacy', scope: 'tenant', default: 'none' },
  ],
} as any;

/** A driver over plain Maps that stamps the threaded organization on insert. */
function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$or') return (v as any[]).some((b) => matches(row, b));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`fake driver: unsupported condition on '${k}'`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const hits = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options?: any) {
      nextId += 1;
      // `injectTenantOnInsert`'s rule: fill an absent tenant column from the
      // call's organization; never overwrite one the row carries.
      const stamped = object === 'sys_setting' && options?.tenantId && (data.organization_id ?? null) === null
        ? { ...data, organization_id: String(options.tenantId) }
        : data;
      const row = { ...stamped, id: (stamped.id as string) ?? `row_${nextId}` };
      rowsOf(object).set(row.id as string, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return { ...next };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const hits = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of hits) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return hits.length;
    },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/**
 * Boot the plugin over a real engine. `organizations` is the composition's
 * organization fact: `null` registers no organization object (the lean
 * embedding); an array registers it and holds those organizations.
 */
async function boot(posture: 'single' | 'group' | 'isolated', organizations: string[] | null) {
  const engine = new ObjectQL();
  engine.registry.logLevel = 'silent';
  const memory = makeMemoryDriver();
  engine.registerDriver(memory.driver, true);
  await engine.init();
  const objects: any[] = [SysUser, SysSetting, SysPlatformSetting];
  if (organizations !== null) objects.push(SysOrganization);
  for (const o of objects) engine.registry.registerObject(o, '@objectstack/platform-objects');
  for (const id of organizations ?? []) {
    await engine.insert('sys_organization', { id, name: id, slug: id }, SYS);
  }

  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  kernel.registerService('tenancy', { posture });
  kernel.registerService('objectql', engine);
  const getService = kernel.getService.bind(kernel);
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService: kernel.registerService.bind(kernel),
    getService,
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    getKernel: () => kernel,
  };
  const plugin = new SettingsServicePlugin({ env: {}, registerRoutes: false, manifests: [MANIFEST], actionHandlers: {} } as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();

  const service = getService('settings') as SettingsService;
  /**
   * A row as an earlier writer left it, put straight into the store: through
   * the engine, a row with no organization would be stamped with the derived
   * one, which is the very write this file is not about.
   */
  let seeded = 0;
  const seed = async (row: Record<string, unknown>) => {
    seeded += 1;
    const id = `seed_${seeded}`;
    memory.rowsOf('sys_setting').set(id, {
      id, namespace: NS, scope: 'tenant', user_id: null, value_enc: null, encrypted: false,
      locked: false, locked_reason: null, ...row,
    });
  };
  const rows = () => [...memory.rowsOf('sys_setting').values()]
    .map((r) => [r.key, r.organization_id ?? null, r.value])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { service, seed, rows };
}

describe("posture 'single', one organization: a process-wide reader is that organization", () => {
  it('reads the organization\'s row, and not a row written with no organization', async () => {
    const b = await boot('single', [ORG]);
    await b.seed({ key: 'brand', value: 'Acme', organization_id: ORG });
    // A row with no organization, as a pre-attribution writer left it — the
    // shape the ceremony reports rather than guesses an owner for.
    await b.seed({ key: 'legacy', value: 'Unowned', organization_id: null });

    expect((await b.service.get(NS, 'brand', {})).value).toBe('Acme');
    expect((await b.service.getMany(NS, ['brand', 'legacy'], {})).legacy).toMatchObject({ value: 'none', source: 'default' });
    expect((await b.service.get(NS, 'legacy', { tenantId: ORG })).source).toBe('default');
  });

  it('writes the organization\'s row, and its second write replaces the first', async () => {
    const b = await boot('single', [ORG]);
    await b.service.set(NS, 'brand', 'one', {});
    await b.service.set(NS, 'brand', 'two', {});

    expect((await b.service.get(NS, 'brand', {})).value).toBe('two');
    expect((await b.service.get(NS, 'brand', { tenantId: ORG })).value).toBe('two');
    expect(b.rows()).toEqual([['brand', ORG, 'two']]);
  });
});

describe("posture 'single' where no organization can be derived", () => {
  for (const [label, organizations] of [['no organization yet', []], ['several organizations', ['org_a', 'org_b']]] as const) {
    it(`${label}: no tenant rung, and the tenant write is refused`, async () => {
      const b = await boot('single', [...organizations]);
      for (const org of organizations) await b.seed({ key: 'brand', value: `brand-${org}`, organization_id: org });
      await b.seed({ key: 'legacy', value: 'Unowned', organization_id: null });

      expect((await b.service.get(NS, 'brand', {})).source).toBe('default');
      expect((await b.service.get(NS, 'legacy', {})).source).toBe('default');
      const refusal = await b.service.set(NS, 'brand', 'Nobody', {}).then(() => null, (e) => e);
      expect(refusal?.code).toBe('SETTINGS_VALIDATION');
    });
  }
});

describe('a walled posture', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`'${posture}': a reader that names no organization reads no tenant row`, async () => {
      const b = await boot(posture, [ORG]);
      await b.seed({ key: 'brand', value: 'Acme', organization_id: ORG });
      await b.seed({ key: 'legacy', value: 'Unowned', organization_id: null });

      expect((await b.service.get(NS, 'brand', {})).source).toBe('default');
      expect((await b.service.get(NS, 'legacy', {})).source).toBe('default');
      // Control: the organization reads its own row, and still not the unowned one.
      expect((await b.service.get(NS, 'brand', { tenantId: ORG })).value).toBe('Acme');
      expect((await b.service.get(NS, 'legacy', { tenantId: ORG })).source).toBe('default');
    });
  }
});

describe('a composition with no organization object (the lean embedding, ADR-0131 D9 note)', () => {
  it('stores its rows with no organization and reads them back', async () => {
    const b = await boot('single', null);
    await b.service.set(NS, 'brand', 'Lean', {});
    await b.service.set(NS, 'brand', 'Lean again', {});

    expect((await b.service.get(NS, 'brand', {})).value).toBe('Lean again');
    expect(b.rows()).toEqual([['brand', null, 'Lean again']]);
  });
});
