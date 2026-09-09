// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17042] An RLS predicate naming an UNDECLARED column must deny — in every
 * position, in every polarity, on BOTH faces.
 *
 * ## What was measured on `origin/main` @ `91f65c4ea`, before the fix
 *
 * A predicate naming a column the object does not declare cannot narrow. In a
 * NEGATION-carrying position it did not deny either: it WIDENED. Two
 * independent sites, each with its own reason, each measured against the same
 * two controls — a real column must still narrow, and the SAME phantom column
 * in a POSITIVE position must still refuse. A cell whose controls do not
 * discriminate is not a reading: the first run of this measurement "refused"
 * every write because the driver had failed to boot, and only the controls
 * said so.
 *
 * READ face — `extractTargetField` is a LEADING `==` / `=` / `in` shape match,
 * so a negated predicate returned `null`, `if (!targetField) return true` KEPT
 * the policy, `dropped` never incremented and the deny sentinel never armed.
 * The kept filter then met the settled include-direction ruling
 * (`noValueSatisfiesNegation`, driver-memory / driver-mongodb, #13166): a row
 * that HAS no such column satisfies "column != x".
 *
 *   `nope != "x"`                        → `{nope:{$ne:'x'}}`            3 / 3
 *   `!(nope == 1)`                       → `{$not:{nope:1}}`             3 / 3
 *   `!(nope in ['a'])`                   → `{$not:{nope:{$in:['a']}}}`   3 / 3
 *   `is_private == false || nope != "x"` → `{$or:[…]}`                   3 / 3
 *   control `is_private == false`                                        1 / 3
 *   control `nope == false` (positive phantom)                           0 / 3
 *
 * WRITE face — `computeWriteCheckFilter` compiled `check` clauses with NO
 * field-existence net at all, and step 3.6 (ADR-0058 D4) evaluates that filter
 * against the post-image. Every negated phantom PERMITTED the write the policy
 * was authored to refuse, on both drivers, in both post-image polarities; the
 * positive phantom refused, by accident of `looseEq(undefined, value)` being
 * false — which is why a suite that only ever tested the positive shape stayed
 * green over the hole.
 *
 * ⚠️ driver-sql and driver-sqlite-wasm were NOT MEASURED when the card was
 * filed. They are now: on the READ face they do NOT widen — they fail closed by
 * RAISING `INVALID_FILTER` / 400 — so the read face is driver-DEPENDENT. On the
 * WRITE face they fail open exactly like every other driver, because the
 * `check` is evaluated in-process and never reaches SQL. The write face is the
 * worse one and no driver choice mitigates it.
 *
 * ## What this file pins
 *
 * The repair is ONE seam: `RLSCompiler.compileFilter` — the single choke point
 * both faces already pass through — judges every column the policy names on the
 * COMPILED FilterCondition tree. That is positional-agnostic by construction:
 * the pushdown compiler lowers `!` to `$not`, `||` to `$or` and `&&` to `$and`,
 * so a column lands as a plain object key whatever position it was authored in,
 * and there is no spelling of negation left for a shape match to miss.
 *
 * ⛔ `noValueSatisfiesNegation` is NOT touched and must not be: it is correct
 * for an ordinary user query, and re-semanticing every filter in the repo to
 * fix one caller is the blast radius this card must not take. The first
 * describe below pins that directly — the raw matcher STILL admits 3 of 3 rows
 * for the same filter — so a future reader can see that what changed is that
 * the policy compiler stopped PRODUCING the filter, not what the matcher does
 * with one.
 *
 * ⭐ The load-bearing control is "a real column still narrows". A fix that made
 * every policy deny would pass a naive red→green and break every install, so it
 * is asserted on both faces and in both directions on the write face.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { matchesFilterCondition } from '@objectstack/formula';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── the fixture, transcribed from the card: three rows, one of them public ──

const ROWS: Array<Record<string, unknown>> = [
  { id: 'r1', title: 'one', is_private: false, owner: 'a@e.example' },
  { id: 'r2', title: 'two', is_private: true, owner: 'b@e.example' },
  { id: 'r3', title: 'three', is_private: true, owner: 'c@e.example' },
];

/** Exactly the columns `qa_doc` declares. `nope` is deliberately absent. */
const DECLARED: ReadonlySet<string> = new Set(['id', 'title', 'is_private', 'owner']);

const OBJECTS = [
  {
    name: 'qa_doc',
    label: 'Doc',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      is_private: { name: 'is_private', type: 'boolean' },
      owner: { name: 'owner', type: 'text' },
    },
  },
];

/**
 * The four shapes the card measured. Each names `nope`, which `qa_doc` does not
 * declare, in a position `extractTargetField` does not recognise.
 */
const PHANTOM_NEGATIONS: Array<[label: string, cel: string]> = [
  ['a bare `!=`', 'nope != "x"'],
  ['`!` over an equality', '!(nope == 1)'],
  ['`!` over a membership', '!(nope in ["a"])'],
  ['a trailing `||` arm, past the leading shape match', 'is_private == false || nope != "x"'],
];

/** The narrowing an author actually meant — the over-fix control. */
const REAL_COLUMN = 'is_private == false';
/** The same phantom column in a POSITIVE position: refused before and after. */
const PHANTOM_POSITIVE = 'nope == false';

const policy = (clause: 'using' | 'check', cel: string): never =>
  ({ object: 'qa_doc', operation: 'select', [clause]: cel }) as never;

const CTX = { userId: 'usr_a', tenantId: 'org1', positions: ['reader'] } as never;

// ── 1. the matcher ruling, pinned as UNCHANGED ─────────────────────────────

describe('[#17042] the include-direction ruling is untouched — the compiler stopped producing the filter', () => {
  it('a row with no such column STILL satisfies a negation at the matcher (3 of 3)', () => {
    // ⛔ This is `noValueSatisfiesNegation`'s reading (#13166), shared with
    // driver-mongodb, and it is deliberately preserved: it is correct for an
    // ordinary user query. If this cell ever goes to 0 the fix was applied in
    // the wrong place and every filter in the repo has been re-semanticed.
    for (const filter of [
      { nope: { $ne: 'x' } },
      { $not: { nope: 1 } },
      { $not: { nope: { $in: ['a'] } } },
      { $or: [{ is_private: false }, { nope: { $ne: 'x' } }] },
    ]) {
      expect(ROWS.filter((r) => matchesFilterCondition(r as never, filter as never)).length).toBe(3);
    }
    // …and the two controls the 3/3 depends on to be a reading.
    expect(ROWS.filter((r) => matchesFilterCondition(r as never, { is_private: false } as never)).length).toBe(1);
    expect(ROWS.filter((r) => matchesFilterCondition(r as never, { nope: false } as never)).length).toBe(0);
  });
});

// ── 2. the seam itself ─────────────────────────────────────────────────────

describe('[#17042] RLSCompiler.compileFilter — a phantom column denies in every position', () => {
  const compiler = new RLSCompiler();
  const guard = { declared: DECLARED };

  for (const clause of ['using', 'check'] as const) {
    for (const [label, cel] of PHANTOM_NEGATIONS) {
      it(`${clause}: ${label} → RLS_DENY_FILTER`, () => {
        const filter = compiler.compileFilter([policy(clause, cel)], CTX, clause, guard);
        expect(filter).toEqual(RLS_DENY_FILTER);
        // The sentinel is a REFUSAL, and a refusal admits nothing.
        expect(ROWS.filter((r) => matchesFilterCondition(r as never, filter as never)).length).toBe(0);
      });
    }

    it(`${clause}: the SAME phantom in a positive position also denies`, () => {
      expect(compiler.compileFilter([policy(clause, PHANTOM_POSITIVE)], CTX, clause, guard)).toEqual(RLS_DENY_FILTER);
    });

    it(`${clause}: ⭐ a REAL column still narrows — the over-fix control`, () => {
      const filter = compiler.compileFilter([policy(clause, REAL_COLUMN)], CTX, clause, guard);
      expect(filter).toEqual({ is_private: false });
      expect(ROWS.filter((r) => matchesFilterCondition(r as never, filter as never)).length).toBe(1);
    });
  }

  it('a phantom named on the RIGHT of a field-to-field comparison denies too', () => {
    // `cel-to-filter` emits `{ title: { $eq: { $field: 'nope' } } }` here, so
    // the column is not a key at all — the walker has to find it inside the
    // operator bag. A guard that only read node keys would miss this.
    expect(compiler.compileFilter([policy('using', 'title == nope')], CTX, 'using', guard)).toEqual(RLS_DENY_FILTER);
    // control: the same shape between two REAL columns compiles.
    expect(compiler.compileFilter([policy('using', 'title == owner')], CTX, 'using', guard)).not.toEqual(RLS_DENY_FILTER);
  });

  it('a policy naming a phantom does not survive by riding alongside a valid sibling', () => {
    // The valid sibling still grants, so this is NOT a deny — but the phantom
    // arm must contribute nothing rather than OR-ing in an allow-all.
    const filter = compiler.compileFilter(
      [policy('using', REAL_COLUMN), policy('using', 'nope != "x"')],
      CTX,
      'using',
      guard,
    );
    expect(filter).toEqual({ is_private: false });
    expect(ROWS.filter((r) => matchesFilterCondition(r as never, filter as never)).length).toBe(1);
  });

  it('⛔ WITHOUT a guard the compile is byte-identical to before — a schema that will not load makes no denials', () => {
    // `getObjectFieldNames` answers `null` at boot before the registry is
    // populated. That must keep every policy, exactly as it did, rather than
    // manufacturing a deny for an object whose columns are simply not known yet.
    for (const [, cel] of PHANTOM_NEGATIONS) {
      expect(compiler.compileFilter([policy('using', cel)], CTX)).not.toEqual(RLS_DENY_FILTER);
    }
  });
});

// ── 3. both faces, end to end, on both drivers ─────────────────────────────

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_a',
  email: 'a@e.example',
  positions: ['reader'],
  permissions: ['qa_reader'],
  posture: 'MEMBER',
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function permissionSet(using: string, check?: string): PermissionSet {
  return PermissionSetSchema.parse({
    name: 'qa_reader',
    objects: { qa_doc: { allowRead: true, allowCreate: true, allowEdit: true } },
    rowLevelSecurity: [
      { name: 'qa_doc_policy', object: 'qa_doc', operation: 'all', using, ...(check ? { check } : {}) },
    ],
  });
}

async function boot(makeDriver: () => unknown, ps: PermissionSet): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-phantom-column-negation-17042',
    name: 'RLS phantom column negation',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, ps],
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
  // The expected refusals log at WARN through the engine's own logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert('qa_doc', ROWS as never, { context: SYS_CTX } as never);
  return engine;
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)',
    () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

interface Outcome { ok: boolean; code?: string; status?: number }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status };
  }
};

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#17042] READ face, end to end — ${driverName}`, () => {
    for (const [label, cel] of PHANTOM_NEGATIONS) {
      it(`${label} → zero rows, and no raise`, async () => {
        const engine = await boot(makeDriver, permissionSet(cel));
        // ⚠️ Before the fix this THREW `INVALID_FILTER` / 400 on both SQL
        // drivers — the phantom column reached the statement builder. A zero
        // here is the deny sentinel doing its job, and the controls below are
        // what separate it from "the harness returns nothing".
        const rows = (await engine.find('qa_doc', { context: CALLER } as never)) as unknown[];
        expect(rows).toHaveLength(0);
      });
    }

    it('⭐ a REAL column still narrows to 1 of 3 — the over-fix control', async () => {
      const engine = await boot(makeDriver, permissionSet(REAL_COLUMN));
      const rows = (await engine.find('qa_doc', { context: CALLER } as never)) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe('r1');
    });

    it('the same phantom in a positive position is still zero rows', async () => {
      const engine = await boot(makeDriver, permissionSet(PHANTOM_POSITIVE));
      expect((await engine.find('qa_doc', { context: CALLER } as never)) as unknown[]).toHaveLength(0);
    });
  });

  describe(`[#17042] WRITE face, end to end — ${driverName}`, () => {
    /**
     * ⚠️ A SINGLE object, never an array. Step 3.6 is guarded by
     * `!Array.isArray(opCtx.data)`, so a bulk payload skips the check gate
     * entirely and every cell below would read "permitted" for a reason that
     * has nothing to do with this card.
     */
    const insert = (engine: ObjectQL, isPrivate: boolean) =>
      engine.insert(
        'qa_doc',
        { id: 'w1', title: 'w', is_private: isPrivate, owner: 'a@e.example' } as never,
        { context: CALLER } as never,
      );

    const stored = async (engine: ObjectQL) =>
      ((await engine.find('qa_doc', { where: { id: 'w1' }, context: SYS_CTX } as never)) as unknown[]).length;

    for (const [label, cel] of PHANTOM_NEGATIONS) {
      for (const isPrivate of [false, true]) {
        it(`check ${label}, post-image is_private=${isPrivate} → refused, nothing stored`, async () => {
          const engine = await boot(makeDriver, permissionSet(REAL_COLUMN, cel));
          const outcome = await attempt(() => insert(engine, isPrivate));
          // Asserted on the ADR-0112 envelope, never on a bare throw: a driver
          // raising a raw `Error` would satisfy `toThrow()` and prove nothing.
          expect(outcome.ok).toBe(false);
          expect(outcome.code).toBe('PERMISSION_DENIED');
          expect(outcome.status).toBe(403);
          // "the gate refused" and "nothing landed" are separate facts.
          expect(await stored(engine)).toBe(0);
        });
      }
    }

    it('⭐ a REAL column check still ADMITS the post-image that satisfies it', async () => {
      const engine = await boot(makeDriver, permissionSet(REAL_COLUMN, REAL_COLUMN));
      const outcome = await attempt(() => insert(engine, false));
      expect(outcome.ok).toBe(true);
      expect(await stored(engine)).toBe(1);
    });

    it('⭐ …and still REFUSES the post-image that violates it', async () => {
      const engine = await boot(makeDriver, permissionSet(REAL_COLUMN, REAL_COLUMN));
      const outcome = await attempt(() => insert(engine, true));
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(await stored(engine)).toBe(0);
    });

    it('the same phantom in a positive position is still refused', async () => {
      const engine = await boot(makeDriver, permissionSet(REAL_COLUMN, PHANTOM_POSITIVE));
      const outcome = await attempt(() => insert(engine, false));
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(await stored(engine)).toBe(0);
    });
  });
}
