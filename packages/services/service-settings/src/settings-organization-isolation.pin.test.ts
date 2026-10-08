// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_setting` rows belong to ONE organization — the identity the object
 * declares, `(organization_id, namespace, key, scope, user_id)`, carried by the
 * service that writes and reads them.
 *
 * ## Why the service has to carry it
 *
 * `SettingsService` reads and writes its store under its own system context,
 * which names no organization. Nothing downstream scopes such a call: the
 * driver's tenant scope needs a `tenantId` on the context, and the security
 * layer's organization wall stands aside for a system caller. So the
 * organization is in the service's own `where` and in every row it writes, or
 * it is nowhere.
 *
 * ## What is pinned
 *
 *  - identity: a tenant-scope or user-scope row carries the writing caller's
 *    organization, and a write by one organization neither reads, nor
 *    replaces, nor resets another's;
 *  - the cascade: a caller's own organization row is preferred over a row
 *    written with no organization, which stays every organization's fallback,
 *    and the global rung is read by every organization;
 *  - the lock pre-flight reads the same row the cascade does;
 *  - the refusal: under a walled posture a tenant-scope write that names no
 *    organization is refused whole, and writes nothing; under `single` it is
 *    not;
 *  - `single`: the default organization keeps its answers, including for a
 *    process-wide reader that names no organization;
 *  - the posture is asked only for a caller that names no organization, on a
 *    key below the global rung — and when it cannot be read, that read or
 *    write fails rather than guessing.
 *
 * Driven over a REAL `ObjectQL` engine through the plugin's own adapter
 * (`wrapEngineAsSettingsEngine`); only the driver is a Map. Its matcher is
 * deliberately strict — equality and `$or` only, anything else refuses — so a
 * query shape it cannot express fails here instead of reading as "no row".
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SysPlatformSetting, SysSetting } from '@objectstack/platform-objects/system';
import type { TenancyPosture } from '@objectstack/spec/security';
import { SettingsService } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { SettingsLockedError, type SettingsContext } from './settings-service.types.js';

const SYS = { context: { isSystem: true } } as const;
const NS = 'org_isolation_fixture';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** A driver over plain Maps. Equality and `$or` only; any other operator refuses. */
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
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const row = { ...data, id: (data.id as string) ?? `row_${nextId}` };
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

const MANIFEST = {
  namespace: NS,
  label: 'Organization isolation fixture',
  scope: 'tenant',
  specifiers: [
    { key: 'motto', type: 'text', label: 'Motto', scope: 'tenant', default: 'none' },
    { key: 'banner', type: 'text', label: 'Banner', scope: 'global', default: 'none' },
    { key: 'theme', type: 'text', label: 'Theme', scope: 'user', default: 'light' },
  ],
} as any;

let engine: ObjectQL;
let rowsOf: (object: string) => Map<string, Record<string, unknown>>;
let userId: string;

beforeEach(async () => {
  engine = new ObjectQL();
  const memory = makeMemoryDriver();
  rowsOf = memory.rowsOf;
  engine.registerDriver(memory.driver, true);
  await engine.init();
  for (const o of [SysUser, SysSetting, SysPlatformSetting]) {
    engine.registry.registerObject(o as any, '@objectstack/platform-objects');
  }
  const user = await engine.insert('sys_user', { name: 'Ada', email: 'ada@example.test' }, SYS);
  userId = String((user as any).id);
});

/** A service bound to the real engine, under the given posture. */
function settings(posture: TenancyPosture | undefined): SettingsService {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(MANIFEST);
  svc.bindEngine(wrapEngineAsSettingsEngine(engine as any), undefined, {
    tenancyPosture: () => posture,
  });
  return svc;
}

/** A row put straight into the store, as an earlier writer left it. */
async function seed(row: Record<string, unknown>): Promise<void> {
  await engine.insert('sys_setting', {
    namespace: NS, value_enc: null, encrypted: false, locked: false, locked_reason: null,
    user_id: null, ...row,
  }, SYS);
}

const settingRows = () => [...rowsOf('sys_setting').values()];
const inOrg = (organization: string, extra: SettingsContext = {}): SettingsContext => ({
  tenantId: organization, ...extra,
});

describe('a tenant-scope value belongs to the organization that wrote it (walled posture)', () => {
  it('a tenant-scope value written by one organization is not read by another', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    const other = await svc.get(NS, 'motto', inOrg(ORG_B));
    expect(other.value).toBe('none');
    expect(other.source).toBe('default');
  });

  it('each organization reads its own value, and one organization\'s write leaves the other\'s unchanged', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Beta');
    // Two rows, each carrying the organization that wrote it — the second write
    // did not find, and rewrite, the first organization's row.
    expect(
      settingRows().map((r) => [r.organization_id, r.value]).sort(),
    ).toEqual([[ORG_A, 'Alpha'], [ORG_B, 'Beta']]);
  });

  it('one organization\'s reset leaves the other\'s value unchanged', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    await svc.runAction(NS, 'reset', null, inOrg(ORG_A));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).source).toBe('default');
    const other = await svc.get(NS, 'motto', inOrg(ORG_B));
    expect(other.value).toBe('Beta');
    expect(other.source).toBe('tenant');
  });

  it('getMany and getNamespace answer per organization exactly as get does', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.getMany(NS, ['motto'], inOrg(ORG_A))).motto.value).toBe('Alpha');
    expect((await svc.getNamespace(NS, inOrg(ORG_B))).values.motto.value).toBe('Beta');
  });

  it('a global row is read by both organizations', async () => {
    const svc = settings('isolated');
    // A global key names no organization and is not refused under the wall.
    await svc.set(NS, 'banner', 'Everyone', {});

    for (const org of [ORG_A, ORG_B]) {
      const got = await svc.get(NS, 'banner', inOrg(org));
      expect(got.value).toBe('Everyone');
      expect(got.source).toBe('global');
    }
  });

  it('a row written with no organization is every organization\'s fallback, and an organization\'s own row is preferred over it', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Legacy', organization_id: null });
    const svc = settings('isolated');

    for (const org of [ORG_A, ORG_B]) {
      const got = await svc.get(NS, 'motto', inOrg(org));
      expect(got.value).toBe('Legacy');
      expect(got.source).toBe('tenant');
    }

    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    const own = await svc.get(NS, 'motto', inOrg(ORG_A));
    expect(own.value).toBe('Alpha');
    // ONE tenant entry in the chain — the preferred row, not both.
    expect(own.cascadeChain?.filter((e) => e.scope === 'tenant')).toHaveLength(1);
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Legacy');
    // The organization-less row was not rewritten by the organization's write.
    expect(settingRows().find((r) => r.organization_id == null)?.value).toBe('Legacy');
  });

  it('a user-scope value carries the organization too: the same user reads it only in the organization it was set in', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'theme', 'dark', inOrg(ORG_A, { userId }));

    expect((await svc.get(NS, 'theme', inOrg(ORG_A, { userId }))).value).toBe('dark');
    expect((await svc.get(NS, 'theme', inOrg(ORG_B, { userId }))).value).toBe('light');
    expect(settingRows().map((r) => [r.scope, r.user_id, r.organization_id])).toEqual([['user', userId, ORG_A]]);
  });

  it('a lock on one organization\'s tenant row does not lock another organization\'s write', async () => {
    await seed({ key: 'theme', scope: 'tenant', value: 'dark', organization_id: ORG_A, locked: true });
    const svc = settings('isolated');

    await expect(svc.set(NS, 'theme', 'blue', inOrg(ORG_A, { userId }))).rejects.toBeInstanceOf(SettingsLockedError);
    await expect(svc.set(NS, 'theme', 'blue', inOrg(ORG_B, { userId }))).resolves.toBeDefined();
  });
});

describe('a tenant-scope write that names no organization', () => {
  for (const posture of ['isolated', 'group'] as const) {
    it(`is refused whole under the '${posture}' posture, and nothing is written — while the same write from an organization lands`, async () => {
      const svc = settings(posture);

      const refusal = await svc.setMany(NS, { motto: 'Nobody' }, { userId }).then(() => null, (e) => e);
      expect(refusal, 'the organization-less write must refuse').not.toBeNull();
      expect(refusal.code).toBe('SETTINGS_VALIDATION');
      expect(refusal.fields).toEqual([
        expect.objectContaining({ field: 'motto', code: 'invalid_value', constraint: { scope: 'tenant' } }),
      ]);
      expect(settingRows()).toHaveLength(0);

      // A reset is a write too: it is refused the same way.
      const reset = await svc.setMany(NS, { motto: null }, { userId }).then(() => null, (e) => e);
      expect(reset?.code).toBe('SETTINGS_VALIDATION');
      expect(settingRows()).toHaveLength(0);

      // Positive control — the identical write, from inside an organization.
      await svc.setMany(NS, { motto: 'Alpha' }, inOrg(ORG_A, { userId }));
      expect(settingRows().map((r) => [r.organization_id, r.value])).toEqual([[ORG_A, 'Alpha']]);
    });
  }

  it("is not refused under the 'single' posture, nor where no posture is reported", async () => {
    for (const posture of ['single', undefined] as const) {
      const svc = settings(posture);
      await svc.set(NS, 'motto', `free-${String(posture)}`, {});
      expect((await svc.get(NS, 'motto', {})).value).toBe(`free-${String(posture)}`);
    }
    expect(settingRows().every((r) => r.organization_id == null)).toBe(true);
  });

  it('under a walled posture, a reader that names no organization reads only the organization-less rows', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    expect((await svc.get(NS, 'motto', {})).source).toBe('default');

    await seed({ key: 'motto', scope: 'tenant', value: 'Legacy', organization_id: null });
    expect((await svc.get(NS, 'motto', {})).value).toBe('Legacy');
  });
});

describe('the posture is read only where it decides something', () => {
  function withFailingPosture(): SettingsService {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(MANIFEST);
    svc.bindEngine(wrapEngineAsSettingsEngine(engine as any), undefined, {
      tenancyPosture: () => { throw new Error('tenancy unreadable'); },
    });
    return svc;
  }

  it('a caller that names an organization, and any read of a global key, never ask it', async () => {
    await settings('isolated').set(NS, 'banner', 'Everyone', {});
    const svc = withFailingPosture();
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'banner', {})).value).toBe('Everyone');
    expect((await svc.getMany(NS, ['banner'], {})).banner.value).toBe('Everyone');
  });

  it('an unreadable posture is not guessed at for a caller that names no organization: the read and the write fail', async () => {
    const svc = withFailingPosture();
    await expect(svc.get(NS, 'motto', {})).rejects.toThrow('tenancy unreadable');
    await expect(svc.set(NS, 'motto', 'Nobody', {})).rejects.toThrow('tenancy unreadable');
    expect(settingRows()).toHaveLength(0);
  });
});

describe("posture 'single': the default organization keeps its answers", () => {
  const DEFAULT_ORG = 'org_default';

  it('a value stored before rows carried an organization is still read by the default organization', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Acme', organization_id: null });
    const svc = settings('single');
    const got = await svc.get(NS, 'motto', inOrg(DEFAULT_ORG));
    expect(got.value).toBe('Acme');
    expect(got.source).toBe('tenant');
  });

  it('the default organization\'s write is read by itself and by a process-wide reader that names no organization', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Acme', organization_id: null });
    const svc = settings('single');
    await svc.set(NS, 'motto', 'Acme Corp', inOrg(DEFAULT_ORG));

    expect((await svc.get(NS, 'motto', inOrg(DEFAULT_ORG))).value).toBe('Acme Corp');
    expect((await svc.get(NS, 'motto', {})).value).toBe('Acme Corp');
  });

  it('the default organization\'s reset reads back the default for both readers', async () => {
    const svc = settings('single');
    await svc.set(NS, 'motto', 'Acme Corp', inOrg(DEFAULT_ORG));
    await svc.runAction(NS, 'reset', null, inOrg(DEFAULT_ORG));

    expect((await svc.get(NS, 'motto', inOrg(DEFAULT_ORG))).source).toBe('default');
    expect((await svc.get(NS, 'motto', {})).source).toBe('default');
  });
});

describe('the in-memory store keeps the same identity', () => {
  it('two organizations each read their own value with no engine bound', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(MANIFEST);
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Beta');
  });
});
