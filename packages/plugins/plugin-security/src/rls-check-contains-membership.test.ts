// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A row-level policy written with `contains` over a multi-valued field gets ONE
 * answer on both sides of a write, through the real plugin, the real engine
 * and the SQL drivers: the read it scopes (`using`) and the write its `check`
 * judges both ask MEMBERSHIP, the question `FILTER_OPERATORS`' `$contains`
 * docblock (`@objectstack/spec`) gives a JSON-stored column.
 *
 * `record.tags.contains('x')` lowers to `{ tags: { $contains: 'x' } }`. The
 * read is compiled by `driver-sql` as a membership test over the JSON column,
 * so it shows the row holding `['x']` and hides the row holding `['xy']`. The
 * write check evaluates the same filter in-process against the post-image
 * (`@objectstack/formula`'s `matchesFilterCondition`, handed the object's
 * declared columns), which answered the substring test alone: a stored array is
 * not a string, so it refused EVERY write, the one the read shows included.
 * It now asks membership too:
 *
 * | post-image `tags` | read under `using` | `check` insert / by-id update, before | after |
 * |---|---|---|---|
 * | `['x']` | shown | 403 | **admitted** |
 * | `['xy']` | hidden | 403 | 403 |
 * | `['a', 'x']` | shown | 403 | **admitted** |
 *
 * The change only widens the check's admit set, and only onto rows the read
 * under the same predicate shows; a member the read hides stays refused.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const PREDICATE = "record.tags.contains('x')";

type Driver = { disconnect?: () => Promise<void> };
const DRIVERS: Array<[name: string, make: () => Driver]> = [
  ['driver-sql (better-sqlite3)', () =>
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['driver-sqlite-wasm', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

const booted: ObjectQL[] = [];
afterEach(async () => {
  while (booted.length) {
    try { await booted.pop()!.destroy(); } catch { /* noop */ }
  }
});

let seq = 0;
async function boot(makeDriver: () => Driver, clause: 'using' | 'check') {
  const OBJ = `qa_ticket_contains_${process.pid}_${++seq}`;
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-contains-membership-${seq}`,
    name: 'RLS contains membership',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Ticket',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          title: { name: 'title', type: 'text' },
          tags: { name: 'tags', type: 'tags' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push(engine);

  const set = PermissionSetSchema.parse({
    name: 'qa_ticket_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'ticket_guard', object: OBJ, operation: 'all', [clause]: PREDICATE }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    logger,
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
  const storedIds = async () =>
    ((await engine.find(OBJ, { context: SYS_CTX } as never)) as Array<Record<string, unknown>>)
      .map((r) => String(r.id))
      .sort();
  return { OBJ, engine, caller, storedIds };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));

const ROWS = [
  { id: 'r1', title: 'member', tags: ['x'] },
  { id: 'r2', title: 'substring only', tags: ['xy'] },
  { id: 'r3', title: 'member among others', tags: ['a', 'x'] },
];

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`${driverName}: a contains policy over a multi-valued field answers membership on read and on write`, () => {
    it("using: the read shows the rows holding the member 'x', and hides ['xy']", async () => {
      const r = await boot(makeDriver, 'using');
      await r.engine.insert(r.OBJ, ROWS, { context: SYS_CTX } as never);
      const shown = (await r.engine.find(r.OBJ, { context: r.caller } as never)) as Array<{ id: string }>;
      expect(shown.map((x) => x.id).sort()).toEqual(['r1', 'r3']);
    });

    it("check: an insert of the rows the read shows is admitted and stored; ['xy'] is refused 403", async () => {
      const w = await boot(makeDriver, 'check');
      for (const row of ROWS) {
        const expected = row.id === 'r2' ? DENIED : 'admitted';
        expect(await outcome(w.engine.insert(w.OBJ, row, { context: w.caller } as never)), row.id).toEqual(expected);
      }
      expect(await w.storedIds()).toEqual(['r1', 'r3']);
    });

    it("check: a by-id update into ['xy'] is refused 403 and changes nothing; back into ['x', 'b'] is admitted", async () => {
      const w = await boot(makeDriver, 'check');
      await w.engine.insert(w.OBJ, [ROWS[0]], { context: SYS_CTX } as never);
      expect(await outcome(w.engine.update(w.OBJ, { tags: ['xy'] }, { where: { id: 'r1' }, context: w.caller } as never)))
        .toEqual(DENIED);
      const after = (await w.engine.find(w.OBJ, { where: { id: 'r1' }, context: SYS_CTX } as never)) as Array<{ tags: unknown }>;
      expect(after[0]?.tags).toEqual(['x']);
      expect(await outcome(w.engine.update(w.OBJ, { tags: ['x', 'b'] }, { where: { id: 'r1' }, context: w.caller } as never)))
        .toBe('admitted');
    });
  });
}
