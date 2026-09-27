// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] A row-level `check` that compares a field against a LIST with `!=`
 * (or negates `==` against one) no longer admits the write it was written to
 * refuse.
 *
 * It compared strictly, so both matched EVERY post-image and the forbidden
 * insert was admitted and stored — measured through this plugin on driver-sql,
 * driver-sqlite-wasm and driver-memory. The evaluator now refuses both shapes
 * before any row is judged. The correct spelling (`!(record.status in [...])`)
 * is what the refusal's remedy points at.
 *
 * One pin per spelling, through the real plugin and the real engine, asserting
 * the envelope (never a bare `toThrow()`) and the ground truth off the table.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJ = 'qa_ticket';
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function bootWithCheck(check: string) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-check-array-comparand-19886',
    name: 'RLS check array comparand',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [{
      name: OBJ,
      label: 'Ticket',
      sharingModel: 'public_read_write',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        status: { name: 'status', type: 'text' },
      },
    }],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The package-metadata door: the published schema admits the predicate.
  const set = PermissionSetSchema.parse({
    name: 'qa_ticket_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true } },
    rowLevelSecurity: [{ name: 'no_closed_tickets', object: OBJ, operation: 'all', check }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  const stored = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>).map((r) => r.id);
  return { engine, caller, stored };
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ code?: string; status?: number; statusCode?: number }> {
  try {
    await run();
  } catch (e) {
    return e as { code?: string; status?: number; statusCode?: number };
  }
  throw new Error('expected the insert to be refused, but it was admitted');
}

describe('[#19886] a row-level check comparing against a list refuses the forbidden insert', () => {
  for (const [spelling, check] of [
    ['`!=` against a list', "record.status != ['closed', 'archived']"],
    ['a negated `==` against a list', "!(record.status == ['closed', 'archived'])"],
  ] as const) {
    it(`${spelling}: nothing is stored`, async () => {
      const { engine, caller, stored } = await bootWithCheck(check);

      const err = await refusalOf(() =>
        engine.insert(OBJ, { id: 'ins_bad', status: 'closed' }, { context: caller } as never));

      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.statusCode ?? err.status).toBe(403);
      expect(await stored()).toEqual([]);
    });
  }
});
