// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] `SettingsService.upsertRow`'s insert (`sys_setting.user_id`) and the
 * setting-audit writer (`sys_setting_audit.actor_id`) carry the explicit system
 * opt-in, and the engine skips its referential-integrity check for an
 * `isSystem` write. So the producers keep the refusal a user reference naming
 * no user met before the opt-in (`assertUserReferenceResolves`).
 *
 * The pin is DIFFERENTIAL, over a real engine: each producer's answer for an
 * unknown user is held equal — name, `code`, `status`, message and findings —
 * to the refusal the engine itself gives the context-less insert the producer
 * made before the opt-in. A known user is written, and a write that names no
 * user is unchanged.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SysPlatformSetting, SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';
import { SettingsService } from './settings-service.js';
import { buildSettingAuditWriter, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';

const SYS = { context: { isSystem: true } } as const;
const GHOST = 'usr_ghost_21913';

/** A driver over plain Maps — enough of `IDataDriver` for these inserts and reads. */
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
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** The refusal's observable envelope — everything but the stack. */
function envelope(e: any) {
  return { name: e?.name, code: e?.code, status: e?.status, message: e?.message, fields: e?.fields };
}

let engine: ObjectQL;
let rowsOf: (object: string) => Map<string, Record<string, unknown>>;
let userId: string;

beforeEach(async () => {
  engine = new ObjectQL();
  const memory = makeMemoryDriver();
  rowsOf = memory.rowsOf;
  engine.registerDriver(memory.driver, true);
  await engine.init();
  for (const o of [SysUser, SysSetting, SysPlatformSetting, SysSettingAudit]) engine.registry.registerObject(o as any, '@objectstack/platform-objects');
  const user = await engine.insert('sys_user', { name: 'Ada', email: 'ada@example.test' }, SYS);
  userId = String((user as any).id);
});

const MANIFEST = {
  namespace: 'localization',
  label: 'Localization',
  specifiers: [{ key: 'timezone', type: 'string', scope: 'user', default: 'UTC' }],
} as any;

function settings(): SettingsService {
  const svc = new SettingsService();
  svc.registerManifest(MANIFEST);
  svc.bindEngine(wrapEngineAsSettingsEngine(engine as any));
  return svc;
}

describe('[#21913] upsertRow keeps the dangling user_id refusal', () => {
  it('a user-scope write for an unknown user is refused exactly as the engine refused the context-less insert; nothing is written', async () => {
    const before = await engine.insert('sys_setting', {
      namespace: 'localization', key: 'timezone', scope: 'user', user_id: GHOST,
      value: 'Asia/Tokyo', value_enc: null, encrypted: false, locked: false, locked_reason: null,
    }).then(() => null, (e) => e);
    expect(before?.code).toBe('VALIDATION_FAILED');
    expect(rowsOf('sys_setting').size).toBe(0);

    const refusal = await settings().set('localization', 'timezone', 'Asia/Tokyo', { userId: GHOST }).then(() => null, (e) => e);
    expect(refusal, 'the write must refuse').not.toBeNull();
    expect(refusal.code).toBe('VALIDATION_FAILED');
    expect(refusal.status).toBe(before.status);
    expect(refusal.fields?.[0]).toMatchObject({ field: 'user_id', code: 'reference_not_found', constraint: { target: 'sys_user' } });
    expect(envelope(refusal)).toEqual(envelope(before));
    expect(rowsOf('sys_setting').size).toBe(0);
  });

  it('a known user is written', async () => {
    await settings().set('localization', 'timezone', 'Asia/Tokyo', { userId });
    expect([...rowsOf('sys_setting').values()].map((r) => r.user_id)).toEqual([userId]);
  });
});

describe('[#21913] the setting-audit writer keeps the dangling actor_id refusal', () => {
  const entry = (actorId?: string) => ({
    namespace: 'localization', key: 'timezone', scope: 'user', action: 'set',
    ...(actorId !== undefined ? { actorId } : {}), oldHash: null, newHash: 'hmac-sha256:x', encrypted: false,
  });

  it('an unknown actor_id is reported exactly as the engine refusal was, and nothing is written', async () => {
    const before = await engine.insert('sys_setting_audit', {
      namespace: 'localization', key: 'timezone', scope: 'user', action: 'set', source: 'api', actor_id: GHOST,
      old_hash: null, new_hash: 'hmac-sha256:x', encrypted: false, request_id: null, reason: null,
      created_at: new Date().toISOString(),
    }).then(() => null, (e) => e);
    expect(before?.code).toBe('VALIDATION_FAILED');

    const warned: string[] = [];
    await buildSettingAuditWriter(engine as any, { warn: (m) => warned.push(m) }).write(entry(GHOST) as any);
    expect(warned).toEqual([`SettingsServicePlugin: setting-audit write failed: ${before.message}`]);
    expect(rowsOf('sys_setting_audit').size).toBe(0);
  });

  it('a known actor is written, and an entry naming no actor is unchanged', async () => {
    const warned: string[] = [];
    const writer = buildSettingAuditWriter(engine as any, { warn: (m) => warned.push(m) });
    await writer.write(entry(userId) as any);
    await writer.write(entry() as any);
    expect(warned).toEqual([]);
    expect([...rowsOf('sys_setting_audit').values()].map((r) => r.actor_id ?? null).sort()).toEqual([null, userId].sort());
  });
});
