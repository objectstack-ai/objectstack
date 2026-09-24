// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19886] A row-level policy that compares a field against a LIST LITERAL with
 * `!=` or `==` fails closed on both clauses, through the real plugin and engine.
 *
 * `compileCelToFilter` refuses the comparison (`unsupported`), so
 * `RLSCompiler.compileFilter` drops the policy on its existing
 * "uncompilable predicate" branch and, with nothing else applicable, answers
 * `RLS_DENY_FILTER`:
 *
 *   - a `using` read returns ZERO rows — never the rows the policy was written
 *     to exclude, which is what the lowered `$ne: [...]` returned on
 *     driver-mongodb before the refusal;
 *   - a `check` write is refused with the row-level CHECK envelope
 *     (`PERMISSION_DENIED` / 403) and nothing is stored.
 *
 * The control is the spelling the refusal points at, `!(record.status in [...])`,
 * which keeps its exact meaning. The ground truth is read past every scope.
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

async function boot(clause: 'using' | 'check', predicate: string) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-list-literal-19886',
    name: 'RLS list literal',
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

  const set = PermissionSetSchema.parse({
    name: 'qa_ticket_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true } },
    rowLevelSecurity: [{ name: 'not_closed', object: OBJ, operation: 'all', [clause]: predicate }],
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
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<{ id: string }>).map((r) => r.id).sort();
  return { engine, caller, stored };
}

const EXCLUDING = [
  ['`!=` against a list literal', "record.status != ['closed', 'archived']"],
  ['a negated `==` against a list literal', "!(record.status == ['closed', 'archived'])"],
] as const;

describe('[#19886] a `using` clause comparing against a list literal reads ZERO rows', () => {
  for (const [spelling, predicate] of EXCLUDING) {
    it(spelling, async () => {
      const { engine, caller, stored } = await boot('using', predicate);
      await engine.insert(OBJ, [{ id: 'r_open', status: 'open' }, { id: 'r_closed', status: 'closed' }], { context: SYS_CTX } as never);

      const rows = (await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>;

      expect(rows).toEqual([]);
      expect(await stored()).toEqual(['r_closed', 'r_open']);
    });
  }

  it('CONTROL — `!(record.status in [...])` reads exactly the rows it admits', async () => {
    const { engine, caller } = await boot('using', "!(record.status in ['closed', 'archived'])");
    await engine.insert(OBJ, [{ id: 'r_open', status: 'open' }, { id: 'r_closed', status: 'closed' }], { context: SYS_CTX } as never);

    const rows = (await engine.find(OBJ, { context: caller } as never)) as Array<{ id: string }>;

    expect(rows.map((r) => r.id)).toEqual(['r_open']);
  });
});

describe('[#19886] a `check` clause comparing against a list literal refuses the write', () => {
  for (const [spelling, predicate] of EXCLUDING) {
    it(`${spelling}: PERMISSION_DENIED / 403, and nothing is stored`, async () => {
      const { engine, caller, stored } = await boot('check', predicate);

      const err = await engine.insert(OBJ, { id: 'ins_bad', status: 'closed' }, { context: caller } as never)
        .then(() => null, (e: { code?: string; status?: number; statusCode?: number }) => e);

      expect(err?.code).toBe('PERMISSION_DENIED');
      expect(err?.statusCode ?? err?.status).toBe(403);
      expect(await stored()).toEqual([]);
    });
  }
});
