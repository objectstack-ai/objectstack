// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7809] The engine's MIDDLEWARE DISPATCH VOCABULARY is fixed, and it contains
// no destructive lifecycle verb (`purge` / `transfer` / `restore`).
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
// at all. They cannot — not on the AST path, and not on ANY path:
//
//   1. `OperationContext['operation']` is the 7-member union pinned below.
//      No destructive lifecycle verb is a member.
//   2. Middleware is invoked from exactly one place — the PRIVATE
//      `executeWithMiddleware(ctx: OperationContext, …)`. There is no other
//      caller, and no public seam that hands a middleware a context the engine
//      did not build.
//   3. Therefore every dispatch must construct an `OperationContext`, so its
//      `operation` is a member of that union by construction.
//
// So step 3 passing `opCtx.operation` raw is SAFE TODAY — not by accident, but
// because the vocabulary cannot deliver a verb it fails to handle. This file
// exists so that stays true by assertion rather than by luck: the day a recycle
// bin (#3146, parked — `enable.trash` was retired in #2377/ADR-0049, which is
// why `API_METHOD_DERIVATION` gives `restore`/`purge` a permanent
// `flag: () => false`) makes one of these verbs dispatchable, this pin goes red
// and names the two sites that must normalise first.
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
//    ⚠️ Measured the hard way: the weld was FIRST written as type-level
//    assignability consts, and the ablation that widened the union passed
//    BOTH vitest and `tsc --noEmit`. Cause: this package's tsconfig excludes
//    `**/*.test.ts`, so no type assertion in any test file here is enforced by
//    anything. A type-level pin in a test file is decoration. Do not
//    reintroduce one.
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
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

vi.mock('./registry', () => {
  const instance: any = {
    getObject: vi.fn(),
    resolveObject: vi.fn((n: string) => instance.getObject(n)),
    registerObject: vi.fn(),
    getObjectOwner: vi.fn(),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn(),
    reset: vi.fn(),
    metadata: { get: vi.fn(() => new Map()) },
  };
  function SchemaRegistry() {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);
  return {
    SchemaRegistry,
    computeFQN: (_ns: string | undefined, name: string) => name,
    parseFQN: (fqn: string) => ({ namespace: undefined, shortName: fqn }),
    RESERVED_NAMESPACES: new Set(['base', 'system']),
  };
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
  const enginePath = fileURLToPath(new URL('./engine.ts', import.meta.url));
  const src = readFileSync(enginePath, 'utf8');

  const iface = src.match(/export interface OperationContext\s*\{([\s\S]*?)\n\}/);
  if (!iface) {
    throw new Error(
      'Could not locate `export interface OperationContext` in engine.ts. ' +
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
 * ADR-0090 D10 delegator half do NOT. Keeping them out of the dispatch
 * vocabulary is what makes that difference unobservable.
 */
const DESTRUCTIVE_LIFECYCLE_VERBS = ['purge', 'transfer', 'restore'] as const;

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

function makeDriver() {
  return {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async () => [{ ...ROW }]),
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
}

async function makeEngine() {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'note' ? NOTE_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(makeDriver(), true);
  await ql.init();

  const seen: Seen[] = [];
  // Shaped like plugin-security's own registration — `opCtx: any`, which is
  // precisely why that plugin can compare against verbs the union does not
  // contain without TypeScript ever objecting.
  ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    seen.push({ operation: opCtx.operation, hasAst: !!opCtx.ast });
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
  const ctx = { userId: 'u1', isSystem: true };
  await ql.find('note', { where: { title: 'x' }, context: ctx } as any);
  await ql.findOne('note', { where: { id: 'n1' }, context: ctx } as any);
  await ql.count('note', { where: { title: 'x' }, context: ctx } as any);
  await ql.aggregate('note', {
    where: { title: 'x' },
    groupBy: ['owner'],
    aggregations: [{ func: 'count', field: 'id', alias: 'n' }],
    context: ctx,
  } as any);
  await ql.insert('note', { title: 'fresh' }, { context: ctx } as any);
  await ql.update('note', { id: 'n1', title: 'by-id' }, { context: ctx } as any);
  await ql.update('note', { title: 'bulk' }, { multi: true, where: { owner: 'me' }, context: ctx } as any);
  await ql.delete('note', { where: { id: 'n1' }, context: ctx } as any);
  await ql.delete('note', { multi: true, where: { owner: 'me' }, context: ctx } as any);
}

describe('[#7809] engine middleware dispatch vocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the weld holds: the list above IS the engine union, read from engine.ts', () => {
    const fromSource = readDispatchedUnionFromEngineSource();
    expect(fromSource.slice().sort()).toEqual([...DISPATCHED_OPERATIONS].sort());
  });

  it('the engine union declares no destructive lifecycle verb', () => {
    const fromSource = readDispatchedUnionFromEngineSource();
    const destructive = fromSource.filter((op) =>
      (DESTRUCTIVE_LIFECYCLE_VERBS as readonly string[]).includes(op),
    );
    // Asserted against the SOURCE list, not against `DISPATCHED_OPERATIONS` —
    // checking this file's own array against this file's own array would prove
    // nothing.
    expect(destructive).toEqual([]);
  });

  it('a real engine driven through every public method dispatches exactly the 7', async () => {
    const { ql, seen } = await makeEngine();
    await driveEveryPublicMethod(ql);

    const observed = [...new Set(seen.map((s) => s.operation))].sort();
    expect(observed).toEqual([...DISPATCHED_OPERATIONS].sort());
  });

  it('no destructive lifecycle verb reaches a middleware, on any path', async () => {
    const { ql, seen } = await makeEngine();
    await driveEveryPublicMethod(ql);

    expect(seen.length).toBeGreaterThan(0);
    const destructive = seen.filter((s) =>
      (DESTRUCTIVE_LIFECYCLE_VERBS as readonly string[]).includes(s.operation),
    );
    expect(destructive).toEqual([]);
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

    // The by-id write branches, conversely, must NOT carry an ast.
    expect(seen.filter((s) => !s.hasAst).map((s) => s.operation).sort()).toEqual([
      'delete',
      'insert',
      'update',
    ]);
  });
});
