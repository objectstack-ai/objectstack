// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7809] The engine's MIDDLEWARE DISPATCH VOCABULARY is fixed. Of the
// destructive lifecycle verbs (`purge` / `transfer` / `restore`) it contains
// `purge` and `restore` (#30237, the recycle bin), and neither ever carries an
// AST.
//
// ── Why a pin here, in objectql, for a finding filed against plugin-security ──
//
// #7809 observed a real asymmetry in `plugin-security/src/security-plugin.ts`:
// the by-id write pre-image gate (step 2.7) NORMALISES the destructive verbs
// before deriving row scope —
//
//     purge -> delete;  transfer | restore -> update
//
// — while the bulk AST injection path (step 3) and its ADR-0090 D10 delegator
// half pass `opCtx.operation` RAW to `computeRlsFilter`. Read alone, that says a
// bulk `purge` collects no policy for the literal operation name, derives no row
// scope, and has nothing AND-ed into its AST, while a bulk `update`/`delete` on
// the same select-only object is scoped (#7665).
//
// The finding's own first question was whether those verbs can reach that path
// at all. They cannot reach the AST path. `transfer` reaches no path; `purge`
// reaches the by-id and object-level ones only, and `restore` the object-level
// one only:
//
//   1. `OperationContext['operation']` is the 9-member union pinned below.
//      Of the destructive lifecycle verbs, `purge` and `restore` are members
//      (#30237), and every dispatch of either is built without an `ast`: the
//      permanent by-id delete (`permanent: true`, refused on any delete that is
//      not by id), `purge(entryId)`, `empty(object)` and `restore(entryId)`.
//   2. Middleware is invoked from exactly one place — the PRIVATE
//      `executeWithMiddleware(ctx: OperationContext, …)`. There is no other
//      caller, and no public seam that hands a middleware a context the engine
//      did not build.
//   3. Therefore every dispatch must construct an `OperationContext`, so its
//      `operation` is a member of that union by construction.
//
// So step 3 passing `opCtx.operation` raw is SAFE TODAY — not by accident, but
// because the vocabulary cannot deliver a verb it fails to handle ON THAT PATH.
// This file exists so that stays true by assertion rather than by luck. The
// recycle bin (ADR-0148, #30237) made `purge` and `restore` dispatchable, and
// kept both off the AST path, which the AST-set lock below proves; the by-id permanent delete is
// judged by step 2.7, which normalises `purge -> delete`. The day a destructive
// verb reaches the AST path, this pin goes red and names the two sites that
// must normalise first.
//
// ⚠️ Note the vocabularies are deliberately DIFFERENT and must not be conflated:
// `ExplainOperationSchema` (spec/security/explain.zod.ts) is a 7-verb
// read/create/update/delete/transfer/restore/purge vocabulary for the explain
// wire contract. That one DOES carry the destructive verbs. It describes what an
// access decision can be ASKED about, not what the engine DISPATCHES.
//
// ── The two halves, and why neither alone is the pin ────────────────────────
//
// A. THE WELD (`readDispatchedUnionFromEngineSource`) — reads the union out of
//    `engine.ts` and covers the case the probe structurally cannot: a NEW engine
//    method (`engine.purge()`) added tomorrow. Such a method still has to reach
//    `executeWithMiddleware`, so it still has to build an `OperationContext`, so
//    the union has to widen — and widening it breaks the weld.
//
//    ⚠️ Measured, and the first measurement was WRONG in a way worth writing
//    down. The weld began as type-level assignability consts. The ablation that
//    widened the union passed both vitest and `pnpm typecheck`, and the
//    conclusion drawn was "a type pin here is enforced by nothing". That is
//    FALSE, and the second measurement is the real picture:
//
//      • `pnpm typecheck` is `tsc --noEmit` against this package's tsconfig,
//        which excludes the test layer. It genuinely never reads this file.
//      • But `pnpm check:type-check-coverage` DOES compile it — it lifts the
//        exclusion and ratchets the package's raw error count through its
//        TEST_DEBT ledger (`@objectstack/objectql`, currently 355). Verified
//        from both sides: three type errors in this file made that gate report
//        358 and go red; fixing them returned it to exactly 355.
//
//    So a type-level weld WOULD have been caught — in CI, as "TEST_DEBT +1".
//    The runtime weld is kept anyway, for reasons that are about diagnosis
//    rather than enforcement: it names what broke instead of moving a count by
//    one, it fails in `pnpm test` where the person changing the union is
//    already looking, and replacing an unevaluated pin with a runtime assertion
//    is one of the routes `check-type-check-coverage` itself prescribes.
//
//    The moral is not "types don't work here" — it is that a pin's enforcing
//    runner has to be identified before the pin is trusted, and `pnpm
//    typecheck` is not the only tsc in this repo.
//
// B. THE BEHAVIOURAL PROBE — a REAL `ObjectQL` engine driven through every
//    public data method, recording what middleware actually receives. This is
//    the empirical half: the reachability claim is a statement about what the
//    engine does, and a static read of the union cannot establish it (a dispatch
//    site could always cast). Its structural limit is the mirror of the weld's:
//    it can only observe methods that exist today.
//
// Half A catches a widened vocabulary; half B catches a dispatch site that lies
// about its own. The runtime `DISPATCHED_OPERATIONS` list is welded to the
// engine's union by A, which is what keeps B's assertions from being a claim
// about this file's own array — without the weld, that list would be a copy
// checked against itself, which is not evidence of anything.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts` for the
  // member set, the #9002 / #9154 lessons it carries, and why the async factory
  // form is what makes this import legal under `vi.mock` hoisting.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

// ── the pinned vocabulary ──────────────────────────────────────────────────

/**
 * Every operation the engine can hand a middleware. Welded to
 * `OperationContext['operation']` by `readDispatchedUnionFromEngineSource`
 * below — edit one without the other and this suite fails.
 */
const DISPATCHED_OPERATIONS = [
  'find',
  'findOne',
  'insert',
  'update',
  'delete',
  'count',
  'aggregate',
  // [#30237] The recycle bin's removal verb: the permanent delete, purge, empty.
  'purge',
  // [#30237] The recycle bin's restore: one entry written back, object-level.
  'restore',
] as const;

type Declared = (typeof DISPATCHED_OPERATIONS)[number];

/**
 * ── THE WELD ──────────────────────────────────────────────────────────────
 * Reads the union members straight out of `engine.ts`, so the list above is a
 * claim about the ENGINE rather than about itself.
 *
 * ⚠️ This began as a pair of type-level assignability consts, which was DEAD:
 * `packages/objectql/tsconfig.json` excludes every `.test.ts`, so `tsc --noEmit`
 * never saw them and the ablation that widened the union passed both vitest and
 * typecheck. The enforcing runner for anything in a test file is vitest, so the
 * weld has to hold at RUNTIME. Hence source text.
 *
 * Every failure to parse THROWS rather than returning a partial list: a regex
 * that silently matches nothing would restore exactly the can't-fail property
 * this replaced.
 */
function readDispatchedUnionFromEngineSource(): string[] {
  // Located from THIS test file's own path, via vitest's runner state, rather
  // than `import.meta.url`: the package's build config targets CommonJS, so
  // `import.meta` is a TS1470 there and would bill the TEST_DEBT ledger for a
  // config-tier error that says nothing about this test. `testPath` is absolute
  // and independent of the cwd the suite was launched from.
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('vitest did not report a testPath — the #7809 weld cannot locate engine.ts.');
  }
  // [#29986] The codemod split moved engine.ts's top-level declarations, this
  // interface among them, into `engine-top-level.ts`; engine.ts re-exports it
  // by name. Both files are read so the weld follows the declaration wherever
  // the split put it (ruling 6597555122 A: a by-path reader gains the new
  // modules in its reading list).
  const src = ['engine.ts', 'engine-top-level.ts']
    .map((file) => readFileSync(join(dirname(testPath), file), 'utf8'))
    .join('\n');

  const iface = src.match(/export interface OperationContext\s*\{([\s\S]*?)\n\}/);
  if (!iface) {
    throw new Error(
      'Could not locate `export interface OperationContext` in engine.ts or engine-top-level.ts. ' +
        'The #7809 vocabulary weld cannot verify itself — fix this parse rather than deleting it.',
    );
  }
  const member = iface[1].match(/\n\s*operation:\s*([^;]+);/);
  if (!member) {
    throw new Error(
      'Located OperationContext but not its `operation` member. See #7809 — fix the parse.',
    );
  }
  const members = [...member[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`Parsed no union members from: ${member[1]}. See #7809 — fix the parse.`);
  }
  return members;
}

/**
 * The verbs #7809 is about. `plugin-security`'s step-2.7 gate normalises these
 * onto `update`/`delete` before deriving row scope; its step-3 AST path and the
 * ADR-0090 D10 delegator half do NOT. Keeping them off the AST path is what
 * makes that difference unobservable.
 */
const DESTRUCTIVE_LIFECYCLE_VERBS = ['purge', 'transfer', 'restore'] as const;

/** [#30237] The destructive lifecycle verbs the engine dispatches, never with an AST. */
const DISPATCHED_DESTRUCTIVE_VERBS = ['purge', 'restore'] as const;

const NOTE_SCHEMA = {
  name: 'note',
  fields: {
    id: { type: 'text' },
    title: { type: 'text' },
    owner: { type: 'text' },
  },
};

/**
 * A row the driver always has. The by-id update/delete branches re-read a prior
 * image through the driver and refuse a missing record, so an empty store would
 * abort the probe before it reached the BULK branches — the ones that carry the
 * AST this finding is about.
 */
const ROW = { id: 'n1', title: 'x', owner: 'me' };

/**
 * [#30237] The recycle bin, registered so the probe reaches its three `purge`
 * dispatches and its `restore`: an entry the driver always has, of a `note`
 * whose row is not live ({@link RESTORED_ID}), so the restore writes it back.
 */
const BIN_SCHEMA = {
  name: 'sys_recycle_bin',
  fields: {
    id: { type: 'text' },
    object_name: { type: 'text' },
    record_id: { type: 'text' },
  },
};
const RESTORED_ID = 'n_binned';
const ENTRY = {
  id: 'e1',
  object_name: 'note',
  record_id: RESTORED_ID,
  snapshot: { rows: [{ object: 'note', id: RESTORED_ID, values: { title: 'x', owner: 'me' } }], clearedReferences: [] },
};

// `any` on the double itself, matching the sibling read-filter test: this is a
// deliberately PARTIAL driver (the engine only reaches the members listed), and
// annotating it `IDataDriver` would demand the whole surface for no assertion.
// Note this is not the erasure `query-options/no-any-erasure` bans — that rule
// is about the OPTIONS BAG passed to the four read methods, which is typed
// above.
function makeDriver(): any {
  return {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async (object: string, ast?: any) =>
      object === 'sys_recycle_bin' ? [{ ...ENTRY }] : ast?.where?.id === RESTORED_ID ? [] : [{ ...ROW }]),
    findOne: vi.fn(async () => ({ ...ROW })),
    count: vi.fn(async () => 1),
    aggregate: vi.fn(async () => []),
    create: vi.fn(async (_o: string, data: any) => ({ id: 'n1', ...data })),
    update: vi.fn(async () => ({ id: 'n1' })),
    updateMany: vi.fn(async () => 0),
    delete: vi.fn(async () => true),
    deleteMany: vi.fn(async () => 0),
  };
}

interface Seen {
  operation: string;
  hasAst: boolean;
  /** A scalar `options.where.id`: the live row a by-id write names. */
  hasId: boolean;
}

async function makeEngine() {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'note' ? NOTE_SCHEMA : name === 'sys_recycle_bin' ? BIN_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(makeDriver(), true);
  await ql.init();

  const seen: Seen[] = [];
  // Shaped like plugin-security's own registration — `opCtx: any`, which is
  // precisely why that plugin can compare against verbs the union does not
  // contain without TypeScript ever objecting.
  ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    const id = opCtx.options?.where?.id;
    seen.push({ operation: opCtx.operation, hasAst: !!opCtx.ast, hasId: typeof id === 'string' || typeof id === 'number' });
    await next();
  });
  return { ql, seen };
}

/**
 * Drive every public data method. `update`/`delete` are driven on BOTH dispatch
 * branches — by-id and predicate — because the AST path #7809 is about is the
 * bulk one, and a probe that only exercised by-id writes would never observe it.
 */
async function driveEveryPublicMethod(ql: ObjectQL): Promise<void> {
  const ctx: ExecutionContext = { userId: 'u1', isSystem: true };
  // The four READ calls carry no `as any`: these signatures already declare
  // `EngineQueryOptions` / `EngineCountOptions` / `EngineAggregateOptions`, and
  // erasing them is what `query-options/no-any-erasure` bans (#4674, #4918).
  // Nothing here is deliberately off-contract, so the remedy is the typed form,
  // not `as unknown as EngineQueryOptions`. Execution context goes in the
  // TRAILING options argument — the one rule across reads and writes.
  await ql.find('note', { where: { title: 'x' } }, { context: ctx });
  await ql.findOne('note', { where: { id: 'n1' } }, { context: ctx });
  await ql.count('note', { where: { title: 'x' } }, { context: ctx });
  await ql.aggregate(
    'note',
    {
      where: { title: 'x' },
      groupBy: ['owner'],
      // `function`, NOT `func`. The neighbouring read-filter test spells this
      // `func` behind an `as any`, so nothing ever checked it; typing the bag
      // here is what surfaced it. That is #4674's exact shape — an unknown key
      // is silently DROPPED, never rejected — so the erasure was the only
      // reason the wrong spelling compiled.
      aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
    },
    { context: ctx },
  );
  await ql.insert('note', { title: 'fresh' }, { context: ctx } as any);
  await ql.update('note', { id: 'n1', title: 'by-id' }, { context: ctx } as any);
  await ql.update('note', { title: 'bulk' }, { multi: true, where: { owner: 'me' }, context: ctx } as any);
  await ql.delete('note', { where: { id: 'n1' }, context: ctx } as any);
  await ql.delete('note', { multi: true, where: { owner: 'me' }, context: ctx } as any);
  // [#30237] The recycle bin's three `purge` dispatches, in this order.
  await ql.delete('note', { where: { id: 'n1' }, permanent: true, context: ctx });
  await ql.purge('e1', { context: ctx });
  await ql.empty('note', { context: ctx });
  // [#30237] The recycle bin's `restore` dispatch.
  await ql.restore('e1', { context: ctx });
}

describe('[#7809] engine middleware dispatch vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the weld holds: the list above IS the engine union, read from engine.ts', () => {
    const fromSource = readDispatchedUnionFromEngineSource();
    expect(fromSource.slice().sort()).toEqual([...DISPATCHED_OPERATIONS].sort());
  });

  it('the engine union declares `purge` and `restore` and no other destructive lifecycle verb', () => {
    const fromSource = readDispatchedUnionFromEngineSource();
    const destructive = fromSource.filter((op) =>
      (DESTRUCTIVE_LIFECYCLE_VERBS as readonly string[]).includes(op),
    );
    // Asserted against the SOURCE list, not against `DISPATCHED_OPERATIONS` —
    // checking this file's own array against this file's own array would prove
    // nothing.
    expect(destructive).toEqual([...DISPATCHED_DESTRUCTIVE_VERBS]);
  });

  it('a real engine driven through every public method dispatches exactly the 9', async () => {
    const { ql, seen } = await makeEngine();
    await driveEveryPublicMethod(ql);

    const observed = [...new Set(seen.map((s) => s.operation))].sort();
    expect(observed).toEqual([...DISPATCHED_OPERATIONS].sort());
  });

  it('of the destructive lifecycle verbs, only `purge` and `restore` reach a middleware, and never with an AST', async () => {
    const { ql, seen } = await makeEngine();
    await driveEveryPublicMethod(ql);

    expect(seen.length).toBeGreaterThan(0);
    const destructive = seen.filter((s) =>
      (DESTRUCTIVE_LIFECYCLE_VERBS as readonly string[]).includes(s.operation),
    );
    // [#30237] The permanent delete, `purge`, `empty` and `restore`, in the
    // order driven. Only the permanent delete names a live row: step 2.7
    // judges that row as a delete (`purge -> delete`); `purge`, `empty` and
    // `restore` are object-level.
    expect(destructive).toEqual([
      { operation: 'purge', hasAst: false, hasId: true },
      { operation: 'purge', hasAst: false, hasId: false },
      { operation: 'purge', hasAst: false, hasId: false },
      { operation: 'restore', hasAst: false, hasId: false },
    ]);
  });

  it('[#30237] `permanent: true` off the by-id path is refused before any middleware runs', async () => {
    const { ql, seen } = await makeEngine();
    const ctx: ExecutionContext = { userId: 'u1', isSystem: true };

    // A delete by filter: it would carry its `where` as an AST.
    await expect(
      ql.delete('note', { multi: true, where: { owner: 'me' }, permanent: true, context: ctx }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    // A by-id delete asked as a predicate one: the bin never takes it.
    await expect(
      ql.delete('note', { multi: true, where: { id: 'n1' }, permanent: true, context: ctx }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(seen).toEqual([]);
  });

  it('every AST-carrying dispatch — the #7809 path — carries a handled operation', async () => {
    const { ql, seen } = await makeEngine();
    await driveEveryPublicMethod(ql);

    // The AST path is the one `security-plugin.ts` step 3 injects RLS into.
    // Assert the probe actually OBSERVED that path: an empty set here would
    // make the next assertion vacuously true, which is the shape of a pin that
    // cannot fail.
    const astCarrying = seen.filter((s) => s.hasAst);
    // Assert the probe actually OBSERVED that path: an empty set here would
    // make the rest vacuously true, which is the shape of a pin that cannot
    // fail.
    expect(astCarrying.length).toBeGreaterThan(0);

    for (const s of astCarrying) {
      expect(DISPATCHED_OPERATIONS).toContain(s.operation as Declared);
      expect(DESTRUCTIVE_LIFECYCLE_VERBS as readonly string[]).not.toContain(s.operation);
    }

    // The measured AST-carrying set, pinned exactly. The two WRITE verbs here
    // are the bulk branches — by-id `update`/`delete` build no ast (they are
    // gated by step 2.7's pre-image check instead), which is precisely the
    // split #7665 and this finding turn on. A verb JOINING this set means
    // security's step 3 began injecting RLS into a path it did not before:
    // worth a human read, hence a lock rather than a subset check.
    const astOperations = [...new Set(astCarrying.map((s) => s.operation))].sort();
    expect(astOperations).toEqual(['aggregate', 'count', 'delete', 'find', 'findOne', 'update']);

    // The by-id write branches, conversely, must NOT carry an ast; nor does
    // any `purge` (#30237: the permanent delete, `purge`, `empty`), nor the
    // `restore` (#30237). The restore's re-links and its rows' writes are raw
    // or by-id, so the restore adds no AST-carrying dispatch either.
    expect(seen.filter((s) => !s.hasAst).map((s) => s.operation).sort()).toEqual([
      'delete',
      'insert',
      'purge',
      'purge',
      'purge',
      'restore',
      'update',
    ]);
  });
});
