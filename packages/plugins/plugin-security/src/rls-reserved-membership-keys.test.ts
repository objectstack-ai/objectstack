// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A caller-supplied `rlsMembership` entry can never change the authorization
 * result a `RESERVED_RLS_MEMBERSHIP_KEYS` key decides — whether or not the
 * kernel resolved a value for that key on this request.
 *
 * ## What was measured before the repair
 *
 * The compiler's merge admitted a membership key on the test
 * `userCtx[key] === undefined` — "did the KERNEL happen to resolve a value
 * here", not "is this key reserved". So on any request where the kernel had no
 * value (an anonymous caller, a principal with no active organization, a
 * deployment resolving no `org_user_ids`) the bag won the name and supplied the
 * authorization vocabulary itself. Measured on `origin/main` @ `0780e8848`,
 * with the kernel value absent, ALL SIX reserved keys let the bag through:
 *
 * ```
 * key                 bag present                              bag absent
 * id                  {"owner_id":["usr_victim"]}              DENY sentinel
 * organization_id     {"org_col":["org_victim"]}               DENY sentinel
 * positions           {"role_col":{"$in":["admin"]}}           DENY sentinel
 * org_user_ids        {"id":{"$in":["usr_victim"]}}            DENY sentinel
 * accessible_org_ids  {"employer_org":{"$in":["org_victim"]}}  DENY sentinel
 * email               {"owner_email":["victim@e.example"]}     DENY sentinel
 * ```
 *
 * The right-hand column is why the direction is WIDENING and not merely wrong:
 * without the bag every one of these predicates fails CLOSED to
 * {@link RLS_DENY_FILTER} (zero rows). The bag converted a denial into a
 * satisfiable filter over attacker-chosen values.
 *
 * ## Why the pin lives at the COMPILER and not at `stageRlsMembership`
 *
 * `stageRlsMembership` screens a RESOLVER's answer against the same list, but
 * that screen covers one producer and only when it runs: it returns at its
 * first line when no `rls-membership-resolver` is registered — every deployment
 * that has not opted into the ADR-0105 D11 seam — and it never screens the bag
 * it SEEDS from an already-present `context.rlsMembership`. Both halves are
 * pinned below, the second through the whole plugin with NO resolver
 * registered, because that is the case a `stageRlsMembership`-only repair would
 * have left wide open.
 */

import { describe, it, expect } from 'vitest';
import { RESERVED_RLS_MEMBERSHIP_KEYS } from '@objectstack/spec/contracts';
import type { PermissionSet } from '@objectstack/spec/security';

import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';

const policy = (using: string): never =>
  ({ name: 'p', object: 'o', operation: 'select', using }) as never;

/** Byte-level comparison — `toEqual` would accept a differently-shaped equal. */
const bytes = (v: unknown): string => JSON.stringify(v);

/**
 * One cell per reserved key: the predicate that reads it, the value a hostile
 * bag supplies, the context in which the KERNEL resolved nothing for that key,
 * and the kernel facts that make it resolve for real.
 *
 * Two spellings here are load-bearing and both were found by a red test rather
 * than by reading:
 *
 *  - `organization_id` reads `ExecutionContext.tenantId`, not a same-named
 *    field — the compiler renames it at the seam, so a cell setting
 *    `organization_id` directly would pin nothing.
 *  - `id` reads `ExecutionContext.userId`, which means the absent-kernel
 *    context for THAT key is the one with no `userId` at all. A shared
 *    `{ userId: 'usr_a' }` base made the `id` cell a kernel-PRESENT cell
 *    wearing an absent cell's name — it passed the byte-identity assertion for
 *    the wrong reason and only the fail-closed assertion caught it. Hence one
 *    explicit `absentCtx` per key rather than a shared base.
 */
const CELLS: Record<
  string,
  {
    using: string;
    bagValue: string[];
    absentCtx: Record<string, unknown>;
    kernelCtx: Record<string, unknown>;
    kernelWins: unknown;
  }
> = {
  id: {
    using: 'owner_id == current_user.id',
    bagValue: ['usr_victim'],
    absentCtx: {},
    kernelCtx: { userId: 'usr_real' },
    kernelWins: { owner_id: 'usr_real' },
  },
  organization_id: {
    using: 'org_col == current_user.organization_id',
    bagValue: ['org_victim'],
    absentCtx: { userId: 'usr_a' },
    kernelCtx: { userId: 'usr_a', tenantId: 'org_real' },
    kernelWins: { org_col: 'org_real' },
  },
  positions: {
    using: 'role_col IN (current_user.positions)',
    bagValue: ['admin'],
    absentCtx: { userId: 'usr_a' },
    kernelCtx: { userId: 'usr_a', positions: ['reader'] },
    kernelWins: { role_col: { $in: ['reader'] } },
  },
  org_user_ids: {
    using: 'assigned_to_id IN (current_user.org_user_ids)',
    bagValue: ['usr_evil'],
    absentCtx: { userId: 'usr_a' },
    kernelCtx: { userId: 'usr_a', org_user_ids: ['usr_a', 'usr_b'] },
    kernelWins: { assigned_to_id: { $in: ['usr_a', 'usr_b'] } },
  },
  accessible_org_ids: {
    using: 'employer_org IN (current_user.accessible_org_ids)',
    bagValue: ['org_victim'],
    absentCtx: { userId: 'usr_a' },
    kernelCtx: { userId: 'usr_a', accessible_org_ids: ['org_real'] },
    kernelWins: { employer_org: { $in: ['org_real'] } },
  },
  email: {
    using: 'owner_email == current_user.email',
    bagValue: ['victim@e.example'],
    absentCtx: { userId: 'usr_a' },
    kernelCtx: { userId: 'usr_a', email: 'real@e.example' },
    kernelWins: { owner_email: 'real@e.example' },
  },
};

describe('RESERVED_RLS_MEMBERSHIP_KEYS — refused BY NAME at the compiler merge', () => {
  const compiler = new RLSCompiler();

  /**
   * The cell table is the acceptance criterion "one cell per reserved key", and
   * this is what keeps it true. A seventh reserved key added to the contract
   * with no cell written here reds THIS test rather than silently shipping an
   * unpinned key.
   */
  it('⭐ every reserved key has a cell — and no cell names a key that is not reserved', () => {
    expect(Object.keys(CELLS).sort()).toEqual([...RESERVED_RLS_MEMBERSHIP_KEYS].sort());
  });

  for (const key of RESERVED_RLS_MEMBERSHIP_KEYS) {
    const cell = CELLS[key]!;

    it(`⭐ ${key}: kernel value ABSENT — bag present compiles BYTE-IDENTICALLY to bag absent`, () => {
      const withBag = compiler.compileFilter([policy(cell.using)], {
        ...cell.absentCtx,
        rlsMembership: { [key]: cell.bagValue },
      } as never);
      const withoutBag = compiler.compileFilter([policy(cell.using)], { ...cell.absentCtx } as never);

      // The acceptance criterion is byte equality, not "no longer wins".
      expect(bytes(withBag)).toBe(bytes(withoutBag));
      // And the shared value is the FAIL-CLOSED one: the deny sentinel, which
      // the caller AND's on to yield zero rows. ⛔ Not a permissive filter
      // (`null` = "apply no RLS filter", `{}` = "match every row") and ⛔ not a
      // thrown exception — a throw would turn a scoped read into a 500 and take
      // the failure OUT of the authorization path.
      expect(withBag).toEqual(RLS_DENY_FILTER);
      expect(withBag).not.toBeNull();
      expect(withBag).not.toEqual({});
    });

    it(`⛔ ${key}: the refusal is a DROPPED POLICY, never a throw`, () => {
      expect(() =>
        compiler.compileFilter([policy(cell.using)], {
          ...cell.absentCtx,
          rlsMembership: { [key]: cell.bagValue },
        } as never),
      ).not.toThrow();
    });

    it(`⛔ ${key}: NEGATIVE CONTROL (a) — with the kernel value present the KERNEL still wins`, () => {
      const filter = compiler.compileFilter([policy(cell.using)], {
        ...cell.kernelCtx,
        rlsMembership: { [key]: cell.bagValue },
      } as never);
      expect(filter).toEqual(cell.kernelWins);
    });

    it(`⭐ ${key}: the WRITE face (\`check\`) is refused on the same terms`, () => {
      // `compileFilter` is the ONE seam both faces pass through — the read layer
      // compiles `using`, the ADR-0058 D4 write gate compiles `check` — so a
      // repair that held on only one of them would be half a repair.
      const checkPolicy = {
        name: 'p',
        object: 'o',
        operation: 'select',
        check: cell.using,
      } as never;
      const withBag = compiler.compileFilter([checkPolicy], {
        ...cell.absentCtx,
        rlsMembership: { [key]: cell.bagValue },
      } as never, 'check');
      const withoutBag = compiler.compileFilter([checkPolicy], { ...cell.absentCtx } as never, 'check');
      expect(bytes(withBag)).toBe(bytes(withoutBag));
      expect(withBag).toEqual(RLS_DENY_FILTER);
    });
  }

  describe('⛔ NEGATIVE CONTROL (b) — a NON-reserved key is BYTE-UNCHANGED', () => {
    /**
     * The §7.3.1 seam is the whole point of the bag; refusing reserved names
     * must not cost the app-shaped sets a single byte. Each expectation below
     * was captured on `origin/main` @ `0780e8848` before the repair.
     */
    const UNRESERVED: Array<[string, string, string[], unknown]> = [
      ['territory_user_ids', 'assigned_to_id IN (current_user.territory_user_ids)', ['usr_c', 'usr_d'],
        { assigned_to_id: { $in: ['usr_c', 'usr_d'] } }],
      ['team_member_ids', 'owner_id IN (current_user.team_member_ids)', ['u2', 'u3'],
        { owner_id: { $in: ['u2', 'u3'] } }],
      ['cost_centre_ids', 'cost_centre IN (current_user.cost_centre_ids)', ['cc_1'],
        { cost_centre: { $in: ['cc_1'] } }],
    ];

    for (const [key, using, value, expected] of UNRESERVED) {
      it(`unchanged: ${key}`, () => {
        expect(RESERVED_RLS_MEMBERSHIP_KEYS).not.toContain(key);
        const filter = compiler.compileFilter([policy(using)], {
          userId: 'usr_a',
          rlsMembership: { [key]: value },
        } as never);
        expect(filter).toEqual(expected);
      });
    }

    it('unchanged: an unreserved key still resolves when a reserved one is refused in the SAME bag', () => {
      // The refusal is per-key, not per-bag: one poisoned entry must not
      // disarm the legitimate sets travelling beside it.
      const filter = compiler.compileFilter(
        [policy('assigned_to_id IN (current_user.territory_user_ids)')],
        {
          userId: 'usr_a',
          rlsMembership: { email: ['victim@e.example'], territory_user_ids: ['usr_c'] },
        } as never,
      );
      expect(filter).toEqual({ assigned_to_id: { $in: ['usr_c'] } });
    });
  });
});

/**
 * The half a `stageRlsMembership`-only repair would have missed.
 *
 * `stageRlsMembership` returns at its first line when no
 * `rls-membership-resolver` is registered, so on a default deployment the seed
 * bag reaches the compiler having passed through NO screen at all. These cells
 * drive the whole plugin — not the compiler in isolation — to pin that the
 * guarantee holds with and without a registered resolver.
 */
describe('RESERVED_RLS_MEMBERSHIP_KEYS — through the whole plugin, resolver or none', () => {
  const permSet: PermissionSet = {
    name: 'member_default',
    label: 'Member',
    objects: { '*': { allowRead: true } },
    rowLevelSecurity: [
      { name: 'own', object: 'task', operation: 'select', using: 'owner_email == current_user.email' },
    ],
  } as never;

  function makeHost(resolver?: unknown) {
    const schema = { name: 'task', fields: { id: { name: 'id' }, owner_email: { name: 'owner_email' } } };
    const services: Record<string, unknown> = {
      manifest: { register: () => {} },
      objectql: { registerMiddleware: () => {}, getSchema: () => schema, findOne: async () => null },
      metadata: { get: async () => schema, list: async () => [permSet] },
    };
    if (resolver) services['rls-membership-resolver'] = resolver;
    return {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      registerService: () => {},
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    } as never;
  }

  async function readFilter(resolver: unknown, context: Record<string, unknown>) {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const host = makeHost(resolver);
    await plugin.init(host);
    await plugin.start(host);
    return (plugin as unknown as {
      getReadFilter(object: string, ctx: unknown): Promise<unknown>;
    }).getReadFilter('task', context);
  }

  /** Owns an app-shaped key only — exactly what the contract says it may own. */
  const resolver = {
    keys: ['territory_user_ids'],
    resolve: async () => ({ territory_user_ids: ['usr_c'] }),
  };

  const HOSTILE = { userId: 'u1', rlsMembership: { email: ['victim@e.example'] } };
  const CLEAN = { userId: 'u1' };

  it('⭐ NO resolver registered — the seed bag is refused (the case a stage-only repair misses)', async () => {
    const withBag = await readFilter(undefined, { ...HOSTILE });
    const withoutBag = await readFilter(undefined, { ...CLEAN });
    expect(bytes(withBag)).toBe(bytes(withoutBag));
    expect(withBag).toEqual(RLS_DENY_FILTER);
  });

  it('⭐ resolver registered — the seed bag is refused there too', async () => {
    const withBag = await readFilter(resolver, { ...HOSTILE });
    const withoutBag = await readFilter(resolver, { ...CLEAN });
    expect(bytes(withBag)).toBe(bytes(withoutBag));
    expect(withBag).toEqual(RLS_DENY_FILTER);
  });

  it('⛔ NEGATIVE CONTROL — the kernel `email` still decides the filter', async () => {
    const filter = await readFilter(undefined, {
      userId: 'u1',
      email: 'real@e.example',
      rlsMembership: { email: ['victim@e.example'] },
    });
    expect(filter).toEqual({ owner_email: 'real@e.example' });
  });
});
