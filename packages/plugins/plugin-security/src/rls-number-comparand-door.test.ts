// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21242] A row-level policy comparing a NUMERIC column with a comparand that
 * is not a number is refused at the RLS compile seam, as the engine's `where`
 * door refuses the same comparison, so the read and the write give one answer.
 *
 * Driven through the real engine, the real plugin and `SqlDriver` over
 * better-sqlite3, as a member resolving a permission set whose `using` and
 * `check` are the same predicate. Measured before the seam ran the spec's
 * number-comparand verdict (`numberComparandDoorVerdict`, the one the engine's
 * `where` door consults), with `@objectstack/formula`'s whole-day copy deleted:
 *
 * | predicate | written | write | read (same predicate) | `where` twin |
 * |---|---|---|---|---|
 * | `record.amount <= '9999-12-31'` | `amount: 5` | 403 | shown | `INVALID_FILTER` / 400 |
 *
 * With the whole-day copy still in place the write was admitted too (an epoch
 * number read as an instant on the last supported day). The policy is now
 * dropped through the `refused-comparand` path for both clauses: the read is
 * filtered by the deny sentinel and the write is refused 403. A numeric string
 * is narrowed to its number, as the `where` door narrows it, and a numeric
 * literal is the control. The WARN detail names the clause it refused, and
 * names PostgreSQL's server error only for `using`, the clause a driver binds.
 *
 * The last block is the end-to-end twin of `@objectstack/formula`'s
 * evaluator-level pin for the same card: a bare-day `$lte` on a TEXT column
 * is compared as written by the write check, so the write the read hides is
 * refused.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const booted: ObjectQL[] = [];
afterEach(async () => {
  while (booted.length) {
    try { await booted.pop()!.destroy(); } catch { /* noop */ }
  }
});

let seq = 0;
/** One engine and plugin over SqlDriver, with ONE policy whose `using` and `check` are the same predicate. */
async function boot(predicate: string) {
  const OBJ = `qa_rls_number_${process.pid}_${++seq}`;
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-number-comparand-${seq}`,
    name: 'RLS number comparand',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Ledger line',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          title: { name: 'title', type: 'text' },
          amount: { name: 'amount', type: 'number' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  booted.push(engine);

  const set = PermissionSetSchema.parse({
    name: 'qa_number_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'number_guard', object: OBJ, operation: 'all', using: predicate, check: predicate }],
  });
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, set],
    },
  };
  const warn = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
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
  const storedRow = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: SYS_CTX } as never)) as Array<Record<string, unknown>>)[0];
  const shownTo = async (id: string) =>
    ((await engine.find(OBJ, { where: { id }, context: caller } as never)) as unknown[]).length > 0;
  /** The structured `reason` of every fail-closed policy drop the compile seam logged, by clause. */
  const drops = () =>
    warn.mock.calls
      .map((call) => call[1] as { reason?: string; clause?: string; policy?: string } | undefined)
      .filter((meta) => meta?.policy === 'number_guard')
      .map((meta) => `${meta!.clause}:${meta!.reason}`);
  /** The `detail` of each fail-closed drop of this policy, by clause. */
  const details = () =>
    Object.fromEntries(
      warn.mock.calls
        .map((call) => call[1] as { clause?: string; policy?: string; detail?: string } | undefined)
        .filter((meta) => meta?.policy === 'number_guard')
        .map((meta) => [meta!.clause!, meta!.detail!]),
    ) as Record<string, string>;
  return { OBJ, engine, caller, storedRow, shownTo, drops, details };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));

describe('[#21242] a policy comparing a numeric column with a non-number is refused at the RLS seam, read and write alike', () => {
  const REFUSED: ReadonlyArray<readonly [predicate: string, where: Record<string, unknown>]> = [
    ["record.amount <= '9999-12-31'", { amount: { $lte: '9999-12-31' } }],
    ["record.amount > 'abc'", { amount: { $gt: 'abc' } }],
    ["record.amount == 'abc'", { amount: 'abc' }],
  ];

  for (const [predicate, where] of REFUSED) {
    it(`${predicate}: the write is 403, the read hides the row, and the where twin is INVALID_FILTER / 400`, async () => {
      const r = await boot(predicate);
      expect(await outcome(r.engine.insert(r.OBJ, { id: 'w', amount: 5 }, { context: r.caller } as never))).toEqual(DENIED);
      expect(await r.storedRow('w')).toBeUndefined();

      await r.engine.insert(r.OBJ, { id: 'r', amount: 5 }, { context: SYS_CTX } as never);
      expect((await r.storedRow('r'))?.amount).toBe(5);
      expect(await r.shownTo('r')).toBe(false);

      // Both clauses dropped the policy through the shared-face route.
      expect(r.drops()).toEqual(expect.arrayContaining(['check:refused-comparand', 'using:refused-comparand']));

      // The same comparison as a caller's `where`: the engine's door.
      const twin = await outcome(r.engine.find(r.OBJ, { where, context: SYS_CTX } as never));
      expect(twin).toEqual({ code: 'INVALID_FILTER', status: 400 });
    });
  }
});

describe('[#21242] the refusal names the clause it refused, and the server bind only for using', () => {
  it("record.amount <= '9999-12-31': the check detail is the write check's, the using detail the read's", async () => {
    const r = await boot("record.amount <= '9999-12-31'");
    expect(await outcome(r.engine.insert(r.OBJ, { id: 'w', amount: 5 }, { context: r.caller } as never))).toEqual(DENIED);
    await r.engine.insert(r.OBJ, { id: 'r', amount: 5 }, { context: SYS_CTX } as never);
    expect(await r.shownTo('r')).toBe(false);
    const { check, using } = r.details();

    expect(check).toBe(
      'the compiled `check` predicate compares a numeric column with a comparand that is not a number (INVALID_FILTER), '
        + 'so the policy was not handed to the write check, which evaluates it in-process. In the platform\'s '
        + 'number-comparand words: filter on \'amount\' compares a declared number field against "9999-12-31" at '
        + 'check.amount.$lte, which is not a number: it has no numeric reading. The filter was NOT applied. Write a '
        + 'number (12, -3.5, 1e3) or a string of exactly that JSON spelling ("12")',
    );
    expect(check).not.toContain('PostgreSQL');

    expect(using).toBe(
      'the compiled `using` predicate compares a numeric column with a comparand that is not a number (INVALID_FILTER), '
        + 'so the policy was not handed to the read, where a driver binds it. In the platform\'s number-comparand '
        + 'words: filter on \'amount\' compares a declared number field against "9999-12-31" at using.amount.$lte, '
        + 'which is not a number: it has no numeric reading, and backends answer it differently (PostgreSQL with a '
        + 'server error). The filter was NOT applied. Write a number (12, -3.5, 1e3) or a string of exactly that '
        + 'JSON spelling ("12")',
    );
  });
});

describe('[#21242] a numeric string is narrowed to its number, as the where door narrows it', () => {
  const CELLS: ReadonlyArray<readonly [predicate: string, amount: number, admitted: boolean]> = [
    ["record.amount <= '10'", 5, true],
    ["record.amount <= '10'", 50, false],
    // Strict equality against the narrowed number: the stored 10 matches.
    ["record.amount == '10'", 10, true],
    ["record.amount == '10'", 11, false],
  ];

  for (const [predicate, amount, admitted] of CELLS) {
    it(`${predicate}, amount ${amount}: ${admitted ? 'admitted and shown' : 'refused 403 and hidden'}`, async () => {
      const r = await boot(predicate);
      expect(await outcome(r.engine.insert(r.OBJ, { id: 'w', amount }, { context: r.caller } as never)))
        .toEqual(admitted ? 'admitted' : DENIED);
      await r.engine.insert(r.OBJ, { id: 'r', amount }, { context: SYS_CTX } as never);
      expect(await r.shownTo('r')).toBe(admitted);
      expect(r.drops()).toEqual([]);
    });
  }
});

describe('[#21242] the control: a numeric literal, and a text column, are unchanged', () => {
  const CELLS: ReadonlyArray<readonly [predicate: string, row: Record<string, unknown>, admitted: boolean]> = [
    ['record.amount <= 10', { amount: 5 }, true],
    ['record.amount <= 10', { amount: 50 }, false],
    // A text column is not the number door's subject: compared as written.
    ["record.title <= 'abc'", { title: 'abb' }, true],
    ["record.title <= 'abc'", { title: 'abd' }, false],
  ];

  for (const [predicate, row, admitted] of CELLS) {
    it(`${predicate}, ${JSON.stringify(row)}: ${admitted ? 'admitted and shown' : 'refused 403 and hidden'}`, async () => {
      const r = await boot(predicate);
      expect(await outcome(r.engine.insert(r.OBJ, { id: 'w', ...row }, { context: r.caller } as never)))
        .toEqual(admitted ? 'admitted' : DENIED);
      await r.engine.insert(r.OBJ, { id: 'r', ...row }, { context: SYS_CTX } as never);
      expect(await r.shownTo('r')).toBe(admitted);
      expect(r.drops()).toEqual([]);
    });
  }
});

describe('[#21242] a bare-day $lte on a TEXT column is compared as written by the write check, end to end', () => {
  // `@objectstack/formula`'s matcher no longer reads a bare `YYYY-MM-DD`
  // bound as "through that day". The RLS compile seam lowers it only on a
  // declared `datetime` column, so on a `text` column the write check now
  // compares the value as written, as `driver-sql` compares it on the read:
  // before, the write was admitted while the read hid the stored row.
  const CELLS: ReadonlyArray<readonly [title: string, admitted: boolean]> = [
    ['2026-01-05T15:00:00Z', false],
    ['2026-01-05 noon', false],
    // The controls: the bound itself, and a day before it.
    ['2026-01-05', true],
    ['2026-01-04T15:00:00Z', true],
  ];

  for (const [title, admitted] of CELLS) {
    it(`record.title <= '2026-01-05', title ${JSON.stringify(title)}: ${admitted ? 'admitted and shown' : 'refused 403 and hidden'}`, async () => {
      const r = await boot("record.title <= '2026-01-05'");
      expect(await outcome(r.engine.insert(r.OBJ, { id: 'w', title }, { context: r.caller } as never)))
        .toEqual(admitted ? 'admitted' : DENIED);
      await r.engine.insert(r.OBJ, { id: 'r', title }, { context: SYS_CTX } as never);
      expect((await r.storedRow('r'))?.title).toBe(title);
      expect(await r.shownTo('r')).toBe(admitted);
      expect(r.drops()).toEqual([]);
    });
  }
});
