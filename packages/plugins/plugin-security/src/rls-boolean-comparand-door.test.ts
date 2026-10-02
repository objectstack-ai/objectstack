// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21376] A row-level policy comparing a BOOLEAN column with a comparand that
 * is not a boolean is refused at the RLS compile seam, and an accepted
 * spelling is narrowed to the boolean it names — as the engine's `where` door
 * answers the same comparison — so the read, the write and a caller's `where`
 * give one answer.
 *
 * Driven through the real engine, the real plugin and `SqlDriver`, as a member
 * resolving a permission set whose `using` and `check` are the same predicate,
 * over two rows (`t` stores `true`, `f` stores `false`). Measured before the
 * seam ran the spec's boolean-comparand verdict (`booleanComparandDoorVerdict`,
 * the one the engine's `where` door consults beside the number one):
 *
 * | predicate | read, SQLite | read, PostgreSQL 16 | write `true` / `false` | `where` twin |
 * |---|---|---|---|---|
 * | `record.flag == true` | `t` | `t` | admitted / 403 | `t` |
 * | `record.flag == 'true'` | none | `t` | 403 / 403 | `t` |
 * | `record.flag != 'true'` | **`f`, `t`** | `f` | **admitted** / admitted | `f` |
 * | `record.flag == 'yes'` | none | **`t`** | 403 / 403 | `INVALID_FILTER` / 400 |
 * | `record.flag == 1` | `t` | `t` | 403 / 403 | `t` |
 * | `record.flag == '1'` | `t` | `t` | 403 / 403 | `t` |
 *
 * The negation was fail-open on both faces: the read kept the row the author
 * excluded, and the write check admitted it. The policy's comparand is now
 * judged by the spec's verdict in the same walk as the number arm: `'true'` /
 * `'false'`, `'1'` / `'0'` and `1` / `0` narrow to the boolean each names, so
 * every cell answers the `where` twin's rows and the write check admits
 * exactly what the read shows; anything else the verdict refuses drops the
 * policy through the `refused-comparand` route for both clauses (the read gets
 * the deny sentinel, the write a 403). `record.flag == true` is the control
 * and does not move.
 *
 * The compiled policy filter is deep-frozen as `compileCelToFilter` returns it
 * (the mock below), so every cell also holds the narrowing to copy-on-write:
 * an edit in place would throw. The last block reads the frozen filter back.
 *
 * The PostgreSQL cell runs where `OS_TEST_POSTGRES_URL` is set and is a named
 * skip otherwise; no CI step provisions that variable for this package. Each
 * live table is dropped after its case.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** Every compiled policy filter `compileCelToFilter` handed the seam, deep-frozen, by predicate. */
const compiled = new Map<string, unknown[]>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

vi.mock('@objectstack/formula', async (importOriginal) => {
  const real = await importOriginal<typeof import('@objectstack/formula')>();
  return {
    ...real,
    compileCelToFilter: ((expression, options) => {
      const result = real.compileCelToFilter(expression, options);
      if (result.ok) {
        deepFreeze(result.filter);
        const key = typeof expression === 'string' ? expression : (expression.source ?? '');
        compiled.set(key, [...(compiled.get(key) ?? []), result.filter]);
      }
      return result;
    }) as typeof real.compileCelToFilter,
  };
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  config: () => Record<string, unknown> | null;
}

const DRIVER_CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'SqlDriver, SQLite', config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'SqlDriver, live PostgreSQL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) {
    try { await cleanups.pop()!(); } catch { /* noop */ }
  }
});

let seq = 0;
/** One engine and plugin over `config`, with ONE policy whose `using` and `check` are the same predicate. */
async function boot(config: Record<string, unknown>, predicate: string) {
  const OBJ = `qa_rls_boolean_${process.pid}_${++seq}`;
  const driver = new SqlDriver(config as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: `com.objectstack.qa.rls-boolean-comparand-${seq}`,
    name: 'RLS boolean comparand',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Flagged line',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          flag: { name: 'flag', type: 'boolean' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  cleanups.push(async () => {
    if (config.client === 'pg') await (driver as unknown as { execute(sql: string): Promise<unknown> }).execute(`drop table if exists ${OBJ}`);
    await engine.destroy();
  });

  const set = PermissionSetSchema.parse({
    name: 'qa_boolean_guard',
    objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [{ name: 'boolean_guard', object: OBJ, operation: 'all', using: predicate, check: predicate }],
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

  await engine.insert(OBJ, { id: 't', flag: true }, { context: SYS_CTX } as never);
  await engine.insert(OBJ, { id: 'f', flag: false }, { context: SYS_CTX } as never);

  const caller = { userId: 'usr_member', positions: ['qa_pos'], permissions: [set.name], posture: 'MEMBER' };
  const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id).sort();
  /** The ids the member's read shows. */
  const shown = async () => ids(await engine.find(OBJ, { context: caller } as never));
  /** The engine's `where` door on the same comparison: the rows it serves, or its refusal envelope. */
  const whereTwin = (where: Record<string, unknown>) =>
    engine.find(OBJ, { where, context: SYS_CTX } as never).then(ids, (e: unknown) => envelopeOf(e));
  const write = (id: string, flag: boolean) =>
    outcome(engine.insert(OBJ, { id, flag }, { context: caller } as never));
  /** `clause:reason` of every fail-closed drop of this policy the compile seam logged. */
  const drops = () => [
    ...new Set(
      warn.mock.calls
        .map((call) => call[1] as { reason?: string; clause?: string; policy?: string } | undefined)
        .filter((meta) => meta?.policy === 'boolean_guard')
        .map((meta) => `${meta!.clause}:${meta!.reason}`),
    ),
  ].sort();
  /** The `detail` of each fail-closed drop of this policy, by clause. */
  const details = () =>
    Object.fromEntries(
      warn.mock.calls
        .map((call) => call[1] as { clause?: string; policy?: string; detail?: string } | undefined)
        .filter((meta) => meta?.policy === 'boolean_guard')
        .map((meta) => [meta!.clause!, meta!.detail!]),
    ) as Record<string, string>;
  return { shown, whereTwin, write, drops, details };
}

type Envelope = { code: string; status: number };
const DENIED: Envelope = { code: 'PERMISSION_DENIED', status: 403 };
const REFUSED: Envelope = { code: 'INVALID_FILTER', status: 400 };
const envelopeOf = (e: unknown): Envelope => {
  const x = e as { code?: string; status?: number; statusCode?: number };
  return { code: String(x?.code), status: Number(x?.statusCode ?? x?.status) };
};
const outcome = (p: Promise<unknown>): Promise<'admitted' | Envelope> =>
  p.then(() => 'admitted' as const, (e: unknown) => envelopeOf(e));

interface Row {
  predicate: string;
  /** The same comparison as a caller's `where`. */
  where: Record<string, unknown>;
  /** What the member's read shows — the `where` twin's rows. */
  shown: string[];
  /** The write check on a `true` row and on a `false` row. */
  writes: readonly ['admitted' | Envelope, 'admitted' | Envelope];
}

/** Each cell answers the engine-door column; the write check admits what the read shows. */
const NARROWED: readonly Row[] = [
  // The control: a boolean literal. Unchanged on every face.
  { predicate: 'record.flag == true', where: { flag: true }, shown: ['t'], writes: ['admitted', DENIED] },
  { predicate: "record.flag == 'true'", where: { flag: 'true' }, shown: ['t'], writes: ['admitted', DENIED] },
  // The negation hides the row the author excluded, and the write check refuses it.
  { predicate: "record.flag != 'true'", where: { flag: { $ne: 'true' } }, shown: ['f'], writes: [DENIED, 'admitted'] },
  { predicate: "record.flag == 'false'", where: { flag: 'false' }, shown: ['f'], writes: [DENIED, 'admitted'] },
  // The number spelling: the read was already right on both dialects; the
  // write check compared the stored `true` with `1` and refused it.
  { predicate: 'record.flag == 1', where: { flag: 1 }, shown: ['t'], writes: ['admitted', DENIED] },
  { predicate: "record.flag == '1'", where: { flag: '1' }, shown: ['t'], writes: ['admitted', DENIED] },
  { predicate: "record.flag in ['true']", where: { flag: { $in: ['true'] } }, shown: ['t'], writes: ['admitted', DENIED] },
];

/** Each refused: no row shown, both writes 403, both clauses dropped, and the twin is the engine's 400. */
const REFUSED_ROWS: ReadonlyArray<readonly [predicate: string, where: Record<string, unknown>]> = [
  ["record.flag == 'yes'", { flag: 'yes' }],
  ["record.flag != 'yes'", { flag: { $ne: 'yes' } }],
  ["record.flag == 'TRUE'", { flag: 'TRUE' }],
  ["record.flag in [true, 'on']", { flag: { $in: [true, 'on'] } }],
  // A number other than 1 / 0 is the verdict's refusal too: the seam carries no
  // table of its own, so it answers whatever the spec's verdict answers.
  ['record.flag == 2', { flag: 2 }],
];

for (const cell of DRIVER_CELLS) {
  const config = cell.config();
  const suffix = config ? '' : ' (skipped: set OS_TEST_POSTGRES_URL to run this cell)';

  describe.skipIf(!config)(`[#21376] a boolean comparand is narrowed at the RLS seam as the where door narrows it — ${cell.label}${suffix}`, () => {
    for (const row of NARROWED) {
      it(`${row.predicate}: the read shows [${row.shown.join(', ')}], the where twin's rows, and the write check agrees`, async () => {
        const r = await boot(config!, row.predicate);
        expect(await r.whereTwin(row.where)).toEqual(row.shown);
        expect(await r.shown()).toEqual(row.shown);
        expect(await r.write('wt', true)).toEqual(row.writes[0]);
        expect(await r.write('wf', false)).toEqual(row.writes[1]);
        expect(r.drops()).toEqual([]);
      });
    }
  });

  describe.skipIf(!config)(`[#21376] a string that names no boolean is refused at the RLS seam, read and write alike — ${cell.label}${suffix}`, () => {
    for (const [predicate, where] of REFUSED_ROWS) {
      it(`${predicate}: no row is shown, both writes are 403, and the where twin is INVALID_FILTER / 400`, async () => {
        const r = await boot(config!, predicate);
        expect(await r.whereTwin(where)).toEqual(REFUSED);
        expect(await r.shown()).toEqual([]);
        expect(await r.write('wt', true)).toEqual(DENIED);
        expect(await r.write('wf', false)).toEqual(DENIED);
        // Both clauses dropped the policy through the shared-face route.
        expect(r.drops()).toEqual(['check:refused-comparand', 'using:refused-comparand']);
      });
    }
  });
}

describe('[#21376] the refusal names its clause and the comparand\'s position', () => {
  it("record.flag != 'yes': each clause's detail is rooted at that clause", async () => {
    const r = await boot(DRIVER_CELLS[0].config()!, "record.flag != 'yes'");
    expect(await r.shown()).toEqual([]);
    expect(await r.write('wt', true)).toEqual(DENIED);
    const { using, check } = r.details();
    expect(using).toContain('`using` predicate compares a boolean column');
    expect(using).toContain('using.flag.$ne');
    expect(check).toContain('`check` predicate compares a boolean column');
    expect(check).toContain('check.flag.$ne');
  });
});

describe('[#21376] narrowing is copy-on-write: the compiled policy filter is never edited', () => {
  it("record.flag != 'true': the filter the compiler returned still holds the string after the read and the write", async () => {
    const predicate = "record.flag != 'true'";
    compiled.delete(predicate);
    const r = await boot(DRIVER_CELLS[0].config()!, predicate);
    expect(await r.shown()).toEqual(['f']);
    expect(await r.write('wt', true)).toEqual(DENIED);
    const filters = compiled.get(predicate) ?? [];
    // One compile per read and per write check, every one frozen and unedited.
    expect(filters.length).toBeGreaterThanOrEqual(2);
    for (const filter of filters) {
      expect(Object.isFrozen(filter)).toBe(true);
      expect(JSON.stringify(filter)).toContain('"true"');
    }
  });
});
