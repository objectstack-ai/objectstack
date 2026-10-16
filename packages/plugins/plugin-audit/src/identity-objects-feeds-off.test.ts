// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's four identity objects — `sys_organization`, `sys_team`,
 * `sys_business_unit` and `sys_user` — declare `enable.feeds: false`, so a
 * comment cannot be created on their records (objectui#12614 item 1: the
 * record page drew a Discussion feed with a composer on each of them).
 *
 * The gate itself is generic and pinned elsewhere: `audit-writers.test.ts`
 * (#2707, insert) and `capability-gate-update-verb.test.ts` (#10170, the
 * update verb and the grandfathered body edit). What this file pins is the
 * COMPOSITION — the REAL platform-object definitions, imported rather than
 * restated, registered in a REAL `ObjectQL` with the real `installAuditWriters`
 * hooks — so a `feeds: false` dropped from any one of the four reds its own
 * case below. `@objectstack/platform-objects/identity` resolves to source
 * (this package's vitest alias), so the verdict is about the checkout, not
 * about `platform-objects/dist`.
 *
 * Every refusal asserts the ADR-0112 envelope (`code` AND `status`) plus the
 * object the gate named, and the CONTROL proves the harness does not refuse
 * everything: a business object that never mentions the flag still takes a
 * comment.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import {
  SysBusinessUnit,
  SysOrganization,
  SysTeam,
  SysUser,
} from '@objectstack/platform-objects/identity';
import { installAuditWriters } from './audit-writers.js';

type Row = Record<string, unknown>;

const text = (name: string, primaryKey = false) => ({
  name,
  label: name,
  type: 'text' as const,
  ...(primaryKey ? { primaryKey: true } : {}),
});

const fieldMap = (...names: string[]) =>
  Object.fromEntries(names.map((n) => [n, text(n, n === 'id')]));

/**
 * A stub driver with just enough storage for the write paths under test. Its
 * matcher implements the operators these reads send and REFUSES any other, so
 * it can never answer a query it does not understand silently wrong
 * (`check:where-matcher-conformance`); `find` applies the caller's `limit` by
 * presence, after the filter (`check:objectql-double-limit`).
 */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) {
      s = new Map();
      stores.set(o, s);
    }
    return s;
  };
  let nextId = 0;
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`stub driver: unsupported where operator '${k}'`);
      if (v && typeof v === 'object') {
        const ops = Object.keys(v);
        if (ops.length === 1 && ops[0] === '$eq') {
          if ((row[k] ?? null) !== ((v as { $eq: unknown }).$eq ?? null)) return false;
          continue;
        }
        if (ops.length === 1 && ops[0] === '$in' && Array.isArray((v as { $in: unknown }).$in)) {
          if (!(v as { $in: unknown[] }).$in.includes(row[k])) return false;
          continue;
        }
        throw new Error(`stub driver: unsupported where predicate on '${k}': ${JSON.stringify(v)}`);
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async syncSchema() {},
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const s = storeFor(o);
      const cur = s.get(id);
      if (!cur) return null;
      const u = { ...cur, ...data, id };
      s.set(id, u);
      return u;
    },
    async delete() {
      return true;
    },
    async count(o: string, ast: any) {
      return (await driver.find(o, { where: ast?.where })).length;
    },
    async aggregate() {
      return [];
    },
  };
  return { driver, storeFor };
}

/** The four Setup identity objects, as `platform-objects` declares them. */
const IDENTITY_OBJECTS = [SysOrganization, SysTeam, SysBusinessUnit, SysUser] as const;

/**
 * Boot a real engine carrying the four REAL identity definitions, a business
 * object that never mentions `enable.feeds`, `sys_comment`, and the audit
 * sinks (registered so the `afterInsert` writers have somewhere real to land —
 * their failures are swallowed by design, and a swallowed failure would make
 * this harness lie about which write happened).
 */
async function boot() {
  const engine = new ObjectQL();
  const { driver, storeFor } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();

  const reg = engine.registry;
  for (const def of IDENTITY_OBJECTS) reg.registerObject(def as any, 'test.fixture');
  reg.registerObject({
    name: 'crm_account',
    label: 'Account',
    fields: fieldMap('id', 'name'),
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_comment',
    label: 'Comment',
    fields: fieldMap('id', 'thread_id', 'body'),
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_audit_log',
    label: 'Audit Log',
    fields: fieldMap(
      'id', 'action', 'user_id', 'actor', 'object_name', 'record_id', 'old_value', 'new_value', 'tenant_id',
    ),
  } as any, 'test.fixture');
  reg.registerObject({
    name: 'sys_activity',
    label: 'Activity',
    fields: fieldMap(
      'id', 'type', 'timestamp', 'summary', 'actor_id', 'object_name', 'record_id', 'record_label', 'metadata',
    ),
  } as any, 'test.fixture');

  installAuditWriters(engine as any, 'test.audit');
  return { engine, driver, storeFor };
}

describe('Setup identity objects declare enable.feeds: false — a comment create on their records is refused', () => {
  it.each(IDENTITY_OBJECTS.map((def) => [def.name] as const))(
    '%s: a new comment on one of its records → 403 FEEDS_DISABLED, and no row lands',
    async (objectName) => {
      const { engine, storeFor } = await boot();

      await expect(
        engine.insert('sys_comment', { thread_id: `${objectName}:rec-1`, body: 'hello' } as any),
      ).rejects.toMatchObject({ code: 'FEEDS_DISABLED', status: 403, object: objectName });

      expect(storeFor('sys_comment').size).toBe(0);
    },
  );

  it('a comment row stored before the flag stays readable, and an ordinary body edit on it still saves', async () => {
    // The grandfather rule in `audit-writers.ts` (`enforceFeedsCapability`):
    // on update, an ABSENT `thread_id` is not a re-thread, so the narrowing
    // reaches new comments and re-points only — never a row that already
    // targets the object. The row is written straight through the driver,
    // below every hook, which is what a row stored before this change is.
    const { engine, driver } = await boot();
    const stored = await driver.create('sys_comment', { thread_id: 'sys_user:usr-1', body: 'before the flag' });
    const id = String(stored.id);

    const read: any[] = await engine.find('sys_comment', {
      where: { thread_id: 'sys_user:usr-1' },
    } satisfies EngineQueryOptions);
    expect(read.map((r) => [r.id, r.body])).toEqual([[id, 'before the flag']]);

    await expect(
      engine.update('sys_comment', { body: 'edited after the flag' } as any, {
        where: { id },
      } satisfies EngineUpdateOptions),
    ).resolves.toBeTruthy();

    const after: any = await engine.findOne('sys_comment', { where: { id } } satisfies EngineQueryOptions);
    expect(after).toMatchObject({ id, thread_id: 'sys_user:usr-1', body: 'edited after the flag' });
  });

  it('CONTROL: a business object that never mentions enable.feeds still accepts a comment', async () => {
    const { engine, storeFor } = await boot();

    await expect(
      engine.insert('sys_comment', { thread_id: 'crm_account:acc-1', body: 'hello' } as any),
    ).resolves.toBeTruthy();

    expect(Array.from(storeFor('sys_comment').values()).map((r) => r.thread_id)).toEqual(['crm_account:acc-1']);
  });
});
