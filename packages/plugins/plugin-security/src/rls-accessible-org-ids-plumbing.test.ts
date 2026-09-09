// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16518] `current_user.accessible_org_ids` must RESOLVE — the plumbing, pinned
 * end to end.
 *
 * ## The contradiction this file closes
 *
 * `packages/spec/src/contracts/rls-membership-resolver.ts` does not merely
 * reserve the name: `:35` states the key is CORE-resolved and not an app
 * resolver, `:53` declares its SHAPE (`accessible_org_ids?: string[]`), and
 * `:70` lists it among `RESERVED_RLS_MEMBERSHIP_KEYS`. `RLSUserContext`
 * declared `id`, `organization_id`, `positions`, `org_user_ids` and `email` —
 * and nothing copied `accessible_org_ids` out of `ExecutionContext`. So the key
 * was reserved ON THE GROUNDS that core resolves it, and core did not resolve
 * it: an app was blocked from supplying the one thing nobody supplied.
 *
 * The cost is the invisible one. Every applicable policy dropped out,
 * `RLS_DENY_FILTER` returned zero rows, and no error was raised — an empty list
 * is indistinguishable from "this user really has no data".
 *
 * ## Why the assertions here are END TO END and not variable-existence checks
 *
 * The compiler half was never in doubt — with the variable present it already
 * compiled to `{$in: [...]}`. What was missing was the PLUMBING, and plumbing
 * can only be pinned by driving a request through it: a rig where a user can
 * see TWO organizations must come back with the rows of BOTH — not zero (the
 * defect), and not all (the over-fix). An assertion that the field exists on an
 * interface would have passed on a tree where nothing ever filled it.
 *
 * ## Measured on `origin/main` @ `c3756ff09`, BEFORE the fix
 *
 *   employer_org IN (current_user.accessible_org_ids), ctx set to 2 of 3 orgs
 *     driver-sql            0 of 6 rows   ⛔ (expected 4)
 *     driver-sqlite-wasm    0 of 6 rows   ⛔ (expected 4)
 *     compiled filter       RLS_DENY_FILTER, WARN names the undefined variable
 *   control, same rig, same context, a RENAMED key via `rlsMembership`
 *     employer_org IN (current_user.my_org_ids)        4 of 6 rows  ✅
 *
 * That control is also the card's blocking question — see the first describe.
 *
 * ⛔ This file does NOT touch #16119's face: a predicate naming a variable that
 * nobody resolves must still fail closed, and the last describe pins exactly
 * that, unchanged.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── the fixture: six rows across THREE organizations ───────────────────────
//
// Three, not two, on purpose. With only the caller's own two orgs present,
// "returned both orgs" and "returned everything" are the same number and the
// over-fix control cannot fire. `org_initech` is the row set the caller must
// never see.

const ROWS: Array<Record<string, unknown>> = [
  { id: 'e1', name: 'Acme A', employer_org: 'org_acme', owner_email: 'a@e.example' },
  { id: 'e2', name: 'Acme B', employer_org: 'org_acme', owner_email: 'b@e.example' },
  { id: 'e3', name: 'Globex A', employer_org: 'org_globex', owner_email: 'c@e.example' },
  { id: 'e4', name: 'Globex B', employer_org: 'org_globex', owner_email: 'd@e.example' },
  { id: 'e5', name: 'Initech A', employer_org: 'org_initech', owner_email: 'e@e.example' },
  { id: 'e6', name: 'Initech B', employer_org: 'org_initech', owner_email: 'f@e.example' },
];

/**
 * ⚠️ `qa_ats_employer` deliberately declares NO `organization_id`, so it is not
 * a tenant object and the Layer 0 wall does not participate. This file is about
 * Layer 1 predicate plumbing; a tenant object would let a Layer 0 verdict stand
 * in for the reading and every cell below would be ambiguous.
 */
const OBJECTS = [
  {
    name: 'qa_ats_employer',
    label: 'Employer',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      employer_org: { name: 'employer_org', type: 'text' },
      owner_email: { name: 'owner_email', type: 'text' },
    },
  },
];

const DECLARED: ReadonlySet<string> = new Set(['id', 'name', 'employer_org', 'owner_email']);

/** The card's own predicate, in both spellings it reported reproducing on. */
const SQL_BRIDGE = 'employer_org IN (current_user.accessible_org_ids)';
const CANONICAL_CEL = 'record.employer_org in current_user.accessible_org_ids';

/** The two organizations the caller holds a membership in. `org_initech` is not one. */
const TWO_ORGS = ['org_acme', 'org_globex'];
const ROWS_OF_BOTH = ['e1', 'e2', 'e3', 'e4'];

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** A caller whose context carries `accessible_org_ids`, exactly as ADR-0105 D2 puts it there. */
const caller = (accessible_org_ids?: string[], extra: Record<string, unknown> = {}) => ({
  userId: 'usr_a',
  email: 'a@e.example',
  positions: ['reader'],
  permissions: ['qa_reader'],
  posture: 'MEMBER',
  ...(accessible_org_ids === undefined ? {} : { accessible_org_ids }),
  ...extra,
});

const ids = (rows: unknown): string[] =>
  (rows as Array<Record<string, unknown>>).map((r) => r.id as string).sort();

// ── engine rig ─────────────────────────────────────────────────────────────

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function permissionSet(using: string): PermissionSet {
  return PermissionSetSchema.parse({
    name: 'qa_reader',
    objects: { qa_ats_employer: { allowRead: true } },
    rowLevelSecurity: [
      { name: 'employer_org_scope', object: 'qa_ats_employer', operation: 'select', using },
    ],
  });
}

async function boot(
  makeDriver: () => unknown,
  ps: PermissionSet,
  resolver?: unknown,
): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.rls-accessible-org-ids-16518',
    name: 'RLS accessible_org_ids plumbing',
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
  if (resolver) services['rls-membership-resolver'] = resolver;
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
  // The expected fail-closed refusals log at WARN through the engine's logger.
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert('qa_ats_employer', ROWS as never, { context: SYS_CTX } as never);
  return engine;
}

const DRIVERS: Array<[string, () => unknown]> = [
  ['driver-sql (better-sqlite3 :memory:)',
    () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never)],
  ['driver-sqlite-wasm (:memory:)', () => new SqliteWasmDriver({ filename: ':memory:' } as never)],
];

// ── 1. the card's BLOCKING question: can an app rename around it? ───────────

describe('[#16518] ⭐ can an app rename around it? — the reading, with its positive control', () => {
  /**
   * The workaround under test: the app supplies the SAME set under its own,
   * unreserved key through `rlsMembership`, and rewrites its predicates to
   * `current_user.my_org_ids`. The resolver can compute the set because
   * `RlsMembershipContext` already hands it `accessible_org_ids` (spec `:53`).
   *
   * ⚠️ Whichever way this reads, it is a MEASUREMENT and not a verdict on the
   * card's priority — that is triage's to re-grade.
   */
  const renameResolver = () => ({
    keys: ['my_org_ids'],
    resolve: vi.fn(async (c: { accessible_org_ids?: string[] }) => ({
      my_org_ids: c.accessible_org_ids ?? [],
    })),
  });

  for (const [driverName, makeDriver] of DRIVERS) {
    it(`${driverName}: the RENAMED key resolves and narrows to both orgs`, async () => {
      const resolver = renameResolver();
      const engine = await boot(
        makeDriver,
        permissionSet('employer_org IN (current_user.my_org_ids)'),
        resolver,
      );
      const rows = await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never);
      expect(ids(rows)).toEqual(ROWS_OF_BOTH);
      // …and it got the set from the kernel, not from thin air.
      expect(resolver.resolve).toHaveBeenCalledWith(
        expect.objectContaining({ accessible_org_ids: TWO_ORGS }),
      );
    });

    it(`${driverName}: ⭐ THE DISCRIMINATOR — the same rig, the RESERVED key`, async () => {
      // ⭐ This cell is the instrument's positive control, and it is the one
      // cell whose reading MOVED. On `c3756ff09` before the fix it returned
      // `[]` while the cell above returned all four rows — same rig, same
      // context, same driver, differing only in which key the predicate names.
      // That contrast IS the measurement: the workaround worked, the documented
      // spelling did not. After the fix both read the same, which is the point.
      // ⛔ Were this cell to go back to `[]`, the card has regressed.
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE), renameResolver());
      const rows = await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never);
      expect(ids(rows)).toEqual(ROWS_OF_BOTH);
    });
  }

  it('⛔ an app still may NOT supply the reserved key itself — the kernel\'s value is what resolves', async () => {
    // The producer screens reserved keys out of a resolver's answer (ADR-0105
    // D11), which is why the workaround needed a RENAME rather than a plain
    // supply — and that screening is UNCHANGED here. What resolves the
    // predicate is the kernel's own `ExecutionContext.accessible_org_ids`, so
    // the resolver's rejected `org_initech` never reaches the filter.
    const resolver = {
      keys: ['accessible_org_ids'],
      resolve: async () => ({ accessible_org_ids: ['org_initech'] }),
    };
    const engine = await boot(DRIVERS[0]![1], permissionSet(SQL_BRIDGE), resolver);
    const rows = await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never);
    expect(ids(rows)).toEqual(ROWS_OF_BOTH);
  });
});

// ── 2. the seam: the variable reaches the compiler ─────────────────────────

describe('[#16518] RLSCompiler.compileFilter resolves `current_user.accessible_org_ids`', () => {
  const compiler = new RLSCompiler();
  const guard = { declared: DECLARED };
  const policy = (using: string): never =>
    ({ name: 'employer_org_scope', object: 'qa_ats_employer', operation: 'select', using }) as never;

  for (const [label, cel] of [['SQL bridge', SQL_BRIDGE], ['canonical CEL', CANONICAL_CEL]] as const) {
    it(`${label}: compiles to the caller's own membership set`, () => {
      const filter = compiler.compileFilter(
        [policy(cel)],
        { userId: 'usr_a', accessible_org_ids: TWO_ORGS } as never,
        'using',
        guard,
      );
      expect(filter).toEqual({ employer_org: { $in: TWO_ORGS } });
    });
  }

  it('the `check` clause resolves it too — a variable must not depend on which face reads it', () => {
    const filter = compiler.compileFilter(
      [{ name: 'p', object: 'qa_ats_employer', operation: 'all', check: SQL_BRIDGE } as never],
      { userId: 'usr_a', accessible_org_ids: TWO_ORGS } as never,
      'check',
      guard,
    );
    expect(filter).toEqual({ employer_org: { $in: TWO_ORGS } });
  });

  it('⛔ an ABSENT set still fails closed — the deny sentinel, not an open filter', () => {
    expect(
      compiler.compileFilter([policy(SQL_BRIDGE)], { userId: 'usr_a' } as never, 'using', guard),
    ).toEqual(RLS_DENY_FILTER);
  });

  it('⛔ an EMPTY set still fails closed', () => {
    expect(
      compiler.compileFilter(
        [policy(SQL_BRIDGE)],
        { userId: 'usr_a', accessible_org_ids: [] } as never,
        'using',
        guard,
      ),
    ).toEqual(RLS_DENY_FILTER);
  });

  it('⭐ RESERVED means reserved at the COMPILER too — a membership bag cannot clobber it', () => {
    // `stageRlsMembership` screens a RESOLVER's answer, but a bag already on the
    // context is spread through unscreened. Now that the kernel names the field,
    // the compiler's own "never let a membership key clobber a named field" rule
    // covers it: the kernel's value wins.
    const filter = compiler.compileFilter(
      [policy(SQL_BRIDGE)],
      {
        userId: 'usr_a',
        accessible_org_ids: TWO_ORGS,
        rlsMembership: { accessible_org_ids: ['org_initech'] },
      } as never,
      'using',
      guard,
    );
    expect(filter).toEqual({ employer_org: { $in: TWO_ORGS } });
  });
});

// ── 3. END TO END — the plumbing, which is the whole point ─────────────────

for (const [driverName, makeDriver] of DRIVERS) {
  describe(`[#16518] END TO END — ${driverName}`, () => {
    it('⭐ a user who can see TWO organizations gets the rows of BOTH — not zero, not all', async () => {
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE));
      const rows = await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never);
      // ⛔ 0 is the defect this card is about; 6 would be the over-fix.
      expect(ids(rows)).toEqual(ROWS_OF_BOTH);
    });

    it('…in the canonical CEL spelling too', async () => {
      const engine = await boot(makeDriver, permissionSet(CANONICAL_CEL));
      expect(ids(await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never)))
        .toEqual(ROWS_OF_BOTH);
    });

    // ── negative control 1: the fix must not turn fail-closed into fail-open ──

    it('⛔ NEGATIVE CONTROL — a user scoped to ONE org sees only that org', async () => {
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE));
      expect(ids(await engine.find('qa_ats_employer', { context: caller(['org_acme']) } as never)))
        .toEqual(['e1', 'e2']);
    });

    it('⛔ NEGATIVE CONTROL — a user with NO membership set still sees ZERO rows', async () => {
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE));
      expect(ids(await engine.find('qa_ats_employer', { context: caller(undefined) } as never)))
        .toEqual([]);
    });

    it('⛔ NEGATIVE CONTROL — an EMPTY membership set still sees ZERO rows', async () => {
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE));
      expect(ids(await engine.find('qa_ats_employer', { context: caller([]) } as never)))
        .toEqual([]);
    });

    it('⛔ NEGATIVE CONTROL — a set naming an org with no rows yields ZERO, not a fallback', async () => {
      const engine = await boot(makeDriver, permissionSet(SQL_BRIDGE));
      expect(ids(await engine.find('qa_ats_employer', { context: caller(['org_nowhere']) } as never)))
        .toEqual([]);
    });

    // ── negative control 3: #16119's face, untouched ──

    it('⛔ NEGATIVE CONTROL — a predicate naming a NON-EXISTENT variable still fails closed', async () => {
      // ⛔ This is #16119's face and this card does not change it: an
      // unresolvable `current_user.*` denies, silently, exactly as before.
      const engine = await boot(
        makeDriver,
        permissionSet('employer_org IN (current_user.no_such_membership_set)'),
      );
      expect(ids(await engine.find('qa_ats_employer', { context: caller(TWO_ORGS) } as never)))
        .toEqual([]);
    });
  });
}

// ── 4. negative control 2: the existing variables are byte-identical ────────

describe('[#16518] ⛔ the pre-existing `current_user.*` variables are BYTE-IDENTICAL', () => {
  /**
   * Every cell below was captured on `origin/main` @ `c3756ff09` BEFORE the fix
   * and must read the same after it. The fix adds one field to `RLSUserContext`;
   * if it perturbs any of these, it did more than it was authorised to do.
   */
  const compiler = new RLSCompiler();
  const guard = { declared: new Set(['id', 'name', 'employer_org', 'owner_email', 'assigned_to_id']) };
  const policy = (using: string): never =>
    ({ name: 'p', object: 'qa_ats_employer', operation: 'select', using }) as never;

  const CTX = {
    userId: 'usr_a',
    tenantId: 'org_acme',
    email: 'a@e.example',
    positions: ['reader'],
    org_user_ids: ['usr_a', 'usr_b'],
    rlsMembership: { territory_user_ids: ['usr_c'] },
  } as never;

  const CASES: Array<[string, unknown]> = [
    ['assigned_to_id IN (current_user.org_user_ids)', { assigned_to_id: { $in: ['usr_a', 'usr_b'] } }],
    ['employer_org == current_user.organization_id', { employer_org: 'org_acme' }],
    ['owner_email == current_user.email', { owner_email: 'a@e.example' }],
    ['id == current_user.id', { id: 'usr_a' }],
    ['assigned_to_id IN (current_user.territory_user_ids)', { assigned_to_id: { $in: ['usr_c'] } }],
  ];

  for (const [cel, expected] of CASES) {
    it(`unchanged: ${cel}`, () => {
      expect(compiler.compileFilter([policy(cel)], CTX, 'using', guard)).toEqual(expected);
    });
  }

  it('unchanged: a membership key still cannot clobber a NAMED field', () => {
    const filter = compiler.compileFilter(
      [policy('assigned_to_id IN (current_user.org_user_ids)')],
      { ...(CTX as object), rlsMembership: { org_user_ids: ['usr_evil'] } } as never,
      'using',
      guard,
    );
    expect(filter).toEqual({ assigned_to_id: { $in: ['usr_a', 'usr_b'] } });
  });
});
