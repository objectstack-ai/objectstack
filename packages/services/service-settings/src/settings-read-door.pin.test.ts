// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic read door of the settings stores applies each namespace's
 * `readPermission` — the rule the settings door has always applied, now at the
 * data API's read of the same rows (`settings-read-door.ts`).
 *
 * Driven over a REAL `ObjectQL` engine with the middleware installed the way
 * the plugin installs it (`registerSettingsReadDoor`), reading as a principal
 * context the way the data API hands one to the engine. Only the driver is a
 * Map; its matcher implements exactly the shapes the door composes (`$and`,
 * `$or`, `$in`, `$nin`, equality) and refuses everything else.
 *
 * Every refusal below is paired with its positive control: the same read, by a
 * principal holding the namespace's capability, returns the row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysPlatformSetting, SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';
import { SettingsService } from './settings-service.js';
import { SETTINGS_READ_DOOR_OBJECTS, registerSettingsReadDoor, settingsReadDoorMiddleware } from './settings-read-door.js';

const SYS = { context: { isSystem: true } } as const;

function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const condition = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1) throw new Error(`fake driver: unsupported condition ${JSON.stringify(cond)}`);
      const [op] = ops;
      const list = (cond as Record<string, unknown>)[op];
      if (!Array.isArray(list)) throw new Error(`fake driver: ${op} needs an array`);
      if (op === '$in') return list.includes(value);
      if (op === '$nin') return !list.includes(value);
      throw new Error(`fake driver: unsupported operator ${op}`);
    }
    return (value ?? null) === (cond ?? null);
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and') return (v as any[]).every((b) => matches(row, b));
      if (k === '$or') return (v as any[]).some((b) => matches(row, b));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported combinator ${k}`);
      return condition(row[k], v);
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
    async count(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** Two namespaces with different read capabilities, and one with no manifest at all. */
const OPEN = 'door_open_ns';
const RESTRICTED = 'door_restricted_ns';
const UNREGISTERED = 'door_unregistered_ns';

function manifest(namespace: string, readPermission: string) {
  return {
    namespace, label: namespace, scope: 'tenant', readPermission, writePermission: readPermission,
    specifiers: [{ key: 'k', type: 'text', label: 'K' }],
  } as any;
}

let engine: ObjectQL;
let ids: Record<string, Record<string, string>>;

beforeEach(async () => {
  engine = new ObjectQL();
  const memory = makeMemoryDriver();
  engine.registerDriver(memory.driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSettingAudit, SysPlatformSetting]) {
    engine.registry.registerObject(o as any, '@objectstack/platform-objects');
  }
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(manifest(OPEN, 'setup.access'));
  svc.registerManifest(manifest(RESTRICTED, 'manage_platform_settings'));
  expect(registerSettingsReadDoor(engine, svc)).toBe(true);

  ids = {};
  for (const namespace of [OPEN, RESTRICTED, UNREGISTERED]) {
    ids[namespace] = {};
    const setting = await engine.insert('sys_setting', {
      namespace, key: 'k', scope: 'tenant', user_id: null, value: 'v', value_enc: null,
      encrypted: false, locked: false, locked_reason: null,
    }, SYS);
    ids[namespace].sys_setting = String((setting as any).id);
    const audit = await engine.insert('sys_setting_audit', {
      namespace, key: 'k', scope: 'tenant', action: 'set', source: 'api', actor_id: null,
      old_hash: null, new_hash: 'h', encrypted: false, request_id: null, reason: null,
      created_at: new Date().toISOString(),
    }, SYS);
    ids[namespace].sys_setting_audit = String((audit as any).id);
    const platform = await engine.insert('sys_platform_setting', {
      namespace, key: 'k', value: 'v', value_enc: null, encrypted: false, locked: false, locked_reason: null,
    }, SYS);
    ids[namespace].sys_platform_setting = String((platform as any).id);
  }
});

/** A principal context as the data API hands one to the engine. */
function principal(systemPermissions: string[]) {
  return { context: { userId: 'usr_reader', tenantId: 'org_a', positions: ['member'], permissions: [], systemPermissions } };
}

const SETUP_ONLY = principal(['setup.access']);
const BOTH = principal(['setup.access', 'manage_platform_settings']);
const PLATFORM_ONLY = principal(['manage_platform_settings']);
const NONE = principal([]);

async function namespacesRead(object: string, as: any): Promise<string[]> {
  const rows = await engine.find(object, {}, as);
  return (rows as any[]).map((r) => r.namespace).sort();
}

describe('the generic read door applies each namespace\'s readPermission', () => {
  for (const object of SETTINGS_READ_DOOR_OBJECTS) {
    describe(object, () => {
      it('a principal lacking a namespace\'s readPermission does not read its rows; a holder does (positive control)', async () => {
        expect(await namespacesRead(object, SETUP_ONLY)).toEqual([OPEN, UNREGISTERED].sort());
        expect(await namespacesRead(object, BOTH)).toEqual([OPEN, RESTRICTED, UNREGISTERED].sort());
      });

      it('a by-id read of a withheld row answers nothing; the holder reads it', async () => {
        const id = ids[RESTRICTED][object];
        expect(await engine.findOne(object, { where: { id } }, SETUP_ONLY)).toBeNull();
        expect(((await engine.findOne(object, { where: { id } }, BOTH)) as any)?.namespace).toBe(RESTRICTED);
      });

      it('a count sees exactly the rows a list returns', async () => {
        expect(await engine.count(object, {}, SETUP_ONLY)).toBe(2);
        expect(await engine.count(object, {}, BOTH)).toBe(3);
      });

      it('the caller\'s own filter is kept, AND-ed with the door', async () => {
        const narrowed = await engine.find(object, { where: { namespace: RESTRICTED } }, SETUP_ONLY);
        expect(narrowed).toEqual([]);
        const own = await engine.find(object, { where: { namespace: OPEN } }, SETUP_ONLY);
        expect((own as any[]).map((r) => r.namespace)).toEqual([OPEN]);
      });

      it('a principal holding no capability reads no namespace; one holding only a namespace\'s own capability reads only it', async () => {
        expect(await namespacesRead(object, NONE)).toEqual([]);
        expect(await namespacesRead(object, PLATFORM_ONLY)).toEqual([RESTRICTED]);
      });

      it('a system context is not scoped', async () => {
        expect(await namespacesRead(object, SYS)).toEqual([OPEN, RESTRICTED, UNREGISTERED].sort());
      });
    });
  }

  it('the door is registered BY NAME for each settings store', () => {
    for (const object of SETTINGS_READ_DOOR_OBJECTS) expect(engine.hasObjectMiddleware(object)).toBe(true);
  });
});

describe('settingsReadDoorMiddleware — the operations it scopes', () => {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(manifest(RESTRICTED, 'manage_platform_settings'));
  const door = settingsReadDoorMiddleware(svc);

  for (const operation of ['find', 'findOne', 'count', 'aggregate']) {
    it(`ANDs the namespace predicate into a '${operation}'`, async () => {
      const opCtx: any = { object: 'sys_setting', operation, ast: { where: { key: 'k' } }, context: SETUP_ONLY.context };
      await door(opCtx, async () => {});
      expect(opCtx.ast.where).toEqual({ $and: [{ key: 'k' }, { namespace: { $nin: [RESTRICTED] } }] });
    });
  }

  for (const operation of ['insert', 'update', 'delete']) {
    it(`leaves a '${operation}' untouched`, async () => {
      const opCtx: any = { object: 'sys_setting', operation, ast: { where: { key: 'k' } }, context: SETUP_ONLY.context };
      await door(opCtx, async () => {});
      expect(opCtx.ast.where).toEqual({ key: 'k' });
    });
  }

  it('refuses a read that carries no query to scope', async () => {
    let ran = false;
    const opCtx: any = { object: 'sys_setting', operation: 'find', context: SETUP_ONLY.context };
    await expect(door(opCtx, async () => { ran = true; })).rejects.toThrow(/carries no query to scope/);
    expect(ran).toBe(false);
  });
});
