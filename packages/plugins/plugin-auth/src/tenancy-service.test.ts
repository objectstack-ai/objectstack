// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { createTenancyService, resolveDefaultOrgId } from './tenancy-service.js';
import { backfillMemberships, reconcileMembership } from './reconcile-membership.js';

function makeEngine(orgs: Array<{ id: string; slug?: string }>) {
  return {
    find: vi.fn(async (object: string, query: any) => {
      if (object !== 'sys_organization') return [];
      const where = query?.where ?? {};
      let rows = orgs;
      if (where.slug !== undefined) rows = rows.filter((o) => o.slug === where.slug);
      return rows.slice(0, query?.limit ?? rows.length);
    }),
  };
}

describe('createTenancyService', () => {
  it('single posture: no wall requested, isolation off', () => {
    const t = createTenancyService({ requested: 'single', probeIsolation: () => false });
    expect(t.posture).toBe('single');
    expect(t.requestedPosture).toBe('single');
    expect(t.isolationActive).toBe(false);
    expect(t.requested).toBe(false);
    expect(t.degraded).toBe(false);
  });

  it('isolated posture: requested and isolation active', () => {
    const t = createTenancyService({ requested: 'isolated', probeIsolation: () => true });
    expect(t.posture).toBe('isolated');
    expect(t.isolationActive).toBe(true);
    expect(t.degraded).toBe(false);
  });

  it('degraded: isolated requested but isolation NOT active', () => {
    const t = createTenancyService({ requested: 'isolated', probeIsolation: () => false });
    expect(t.posture).toBe('single'); // behaves single-org-like — nothing isolates
    expect(t.requestedPosture).toBe('isolated');
    expect(t.isolationActive).toBe(false);
    expect(t.requested).toBe(true);
    expect(t.degraded).toBe(true);
  });

  it('a throwing probe is treated as isolation off (fail-closed to single)', () => {
    const t = createTenancyService({
      requested: 'isolated',
      probeIsolation: () => {
        throw new Error('registry exploded');
      },
    });
    expect(t.isolationActive).toBe(false);
    expect(t.degraded).toBe(true);
  });

  it('re-reads the probe each access (org-scoping may register after construction)', () => {
    let active = false;
    const t = createTenancyService({ requested: 'isolated', probeIsolation: () => active });
    expect(t.posture).toBe('single');
    active = true; // org-scoping registers later
    expect(t.posture).toBe('isolated');
    expect(t.degraded).toBe(false);
  });

  // [ADR-0105 D1 / ADR-0105 D12] Multi-organization operation is an ENTITLEMENT.
  // The wall's code is open, but activating either walled posture requires the
  // enterprise org-scoping runtime — otherwise `group` would be a free multi-org
  // back door around the `isolated` gate. The iron rule (cloud ADR-0016) is
  // satisfied by refusing to run an unwalled multi-org deployment, not by giving
  // the posture away: an unenforceable request resolves to `single` + degraded,
  // and the CLI fails fast on that (ADR-0093 D5).
  describe('group posture (entitled, like isolated)', () => {
    it('is ACTIVE when the enterprise org-scoping service is present', () => {
      const t = createTenancyService({ requested: 'group', probeIsolation: () => true });
      expect(t.posture).toBe('group');
      expect(t.isolationActive).toBe(true);
      expect(t.degraded).toBe(false);
    });

    it('DEGRADES without the enterprise package — never a silent free multi-org', () => {
      const probe = vi.fn(() => false);
      const t = createTenancyService({ requested: 'group', probeIsolation: probe });
      expect(t.requestedPosture).toBe('group');
      expect(t.posture).toBe('single'); // behaves single-org — nothing walls it
      // The probe is lazy — org-scoping registers after plugin-auth — so it
      // fires on the first read of a derived fact, not at construction.
      expect(probe).toHaveBeenCalled();
      expect(t.isolationActive).toBe(false);
      expect(t.requested).toBe(true);
      expect(t.degraded).toBe(true);
    });

    it('never guesses a default org while active — membership is explicit', async () => {
      const engine = makeEngine([{ id: 'org_default', slug: 'default' }]);
      const t = createTenancyService({
        requested: 'group',
        probeIsolation: () => true,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBeNull();
    });
  });

  // The legacy boolean shape stays accepted so an embedding that passes
  // `resolveMultiOrgEnabled()` keeps working: true ⇒ isolated, false ⇒ single.
  describe('legacy boolean `requested`', () => {
    it('true maps to the isolated posture', () => {
      const t = createTenancyService({ requested: true, probeIsolation: () => true });
      expect(t.requestedPosture).toBe('isolated');
      expect(t.posture).toBe('isolated');
    });

    it('false maps to the single posture', () => {
      const t = createTenancyService({ requested: false, probeIsolation: () => true });
      expect(t.requestedPosture).toBe('single');
      expect(t.posture).toBe('single');
      expect(t.isolationActive).toBe(false);
    });
  });

  describe('defaultOrgId', () => {
    it('isolated posture never guesses — returns null', async () => {
      const engine = makeEngine([{ id: 'org_a' }, { id: 'org_b' }]);
      const t = createTenancyService({
        requested: true,
        probeIsolation: () => true,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBeNull();
      expect(engine.find).not.toHaveBeenCalled(); // short-circuits before any query
    });

    // cloud#957 — the case that reached production. A deployment that ASKED for
    // a wall and did not get one must not fall back to "the only org I can
    // see": the cloud control plane runs `isolated` while mounting its own
    // scoping plugin instead of the enterprise package, so this resolver was
    // handing the reconciler a target org and every fresh self-serve signup
    // landed as a `member` of a stranger's organization.
    it('degraded (walled requested, isolation inactive) still never guesses', async () => {
      const engine = makeEngine([{ id: 'org_only' }]);
      const t = createTenancyService({
        requested: 'isolated',
        probeIsolation: () => false, // enterprise package absent → degraded
        getEngine: () => engine,
      });
      expect(t.degraded).toBe(true);
      expect(t.posture).toBe('single'); // behaves single-org-like…
      expect(await t.defaultOrgId()).toBeNull(); // …but still refuses to guess
      expect(engine.find).not.toHaveBeenCalled();
    });

    it('degraded does not guess the slug=default org either', async () => {
      const engine = makeEngine([{ id: 'org_default', slug: 'default' }, { id: 'org_b' }]);
      const t = createTenancyService({
        requested: 'group',
        probeIsolation: () => false,
        getEngine: () => engine,
      });
      expect(t.degraded).toBe(true);
      expect(await t.defaultOrgId()).toBeNull();
    });

    it('single mode prefers the slug=default bootstrap org', async () => {
      const engine = makeEngine([{ id: 'org_x' }, { id: 'org_default', slug: 'default' }]);
      const t = createTenancyService({
        requested: false,
        probeIsolation: () => false,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBe('org_default');
    });

    it('single mode falls back to the sole org when no default slug', async () => {
      const engine = makeEngine([{ id: 'org_only' }]);
      const t = createTenancyService({
        requested: false,
        probeIsolation: () => false,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBe('org_only');
    });

    it('single mode returns null when the org is ambiguous (≥2, no default)', async () => {
      const engine = makeEngine([{ id: 'org_a' }, { id: 'org_b' }]);
      const t = createTenancyService({
        requested: false,
        probeIsolation: () => false,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBeNull();
    });

    it('memoizes a positive resolution but re-resolves a null', async () => {
      const orgs: Array<{ id: string; slug?: string }> = [];
      const engine = makeEngine(orgs);
      const t = createTenancyService({
        requested: false,
        probeIsolation: () => false,
        getEngine: () => engine,
      });
      expect(await t.defaultOrgId()).toBeNull(); // not bootstrapped yet
      orgs.push({ id: 'org_default', slug: 'default' }); // bootstrap runs
      expect(await t.defaultOrgId()).toBe('org_default'); // re-resolved
      const callsAfterResolve = engine.find.mock.calls.length;
      // Memoized: the next call checks the memo with ONE read by primary key
      // and does not re-run the resolution.
      expect(await t.defaultOrgId()).toBe('org_default');
      expect(engine.find.mock.calls.length).toBe(callsAfterResolve + 1);
      expect(engine.find.mock.calls.at(-1)).toEqual([
        'sys_organization',
        { where: { id: 'org_default' }, limit: 1 },
        { context: { isSystem: true } },
      ]);
    });
  });
});

describe('resolveDefaultOrgId', () => {
  it('returns null for a missing/invalid engine', async () => {
    expect(await resolveDefaultOrgId(undefined)).toBeNull();
    expect(await resolveDefaultOrgId({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// [ADR-0105 D12] Posture ENTITLEMENT is declared by the commercial runtime.
//
// Presence-of-package answers "may this deployment run multi-org at all", not
// "which shapes of it". Whether `group` and `isolated` are one tier or two is a
// packaging decision the enterprise runtime owns, so the open core asks instead
// of assuming — and fails closed on anything not entitled.
// ---------------------------------------------------------------------------
describe('posture entitlement declared by the org-scoping runtime', () => {
  const installed = () => true;

  it('entitles every walled posture when the runtime declares nothing (back-compat)', () => {
    for (const posture of ['group', 'isolated'] as const) {
      const t = createTenancyService({
        requested: posture,
        probeIsolation: installed,
        probeEntitledPostures: () => undefined,
      });
      expect(t.posture, posture).toBe(posture);
      expect(t.degraded).toBe(false);
    }
  });

  it('activates a posture the runtime DOES entitle', () => {
    const t = createTenancyService({
      requested: 'group',
      probeIsolation: installed,
      probeEntitledPostures: () => ['group'],
    });
    expect(t.posture).toBe('group');
    expect(t.isolationActive).toBe(true);
    expect(t.degraded).toBe(false);
  });

  it('DEGRADES a posture the runtime does not entitle, even though it is installed', () => {
    // e.g. a licence covering legal-entity isolation but not the group shape.
    const t = createTenancyService({
      requested: 'group',
      probeIsolation: installed,
      probeEntitledPostures: () => ['isolated'],
    });
    expect(t.requestedPosture).toBe('group');
    expect(t.posture).toBe('single');
    expect(t.isolationActive).toBe(false);
    expect(t.degraded).toBe(true); // → the CLI refuses to boot (ADR-0093 D5)
  });

  it('fails closed on an EMPTY entitlement set', () => {
    const t = createTenancyService({
      requested: 'isolated',
      probeIsolation: installed,
      probeEntitledPostures: () => [],
    });
    expect(t.isolationActive).toBe(false);
    expect(t.degraded).toBe(true);
  });

  it('fails closed when the entitlement probe throws', () => {
    const t = createTenancyService({
      requested: 'group',
      probeIsolation: installed,
      probeEntitledPostures: () => {
        throw new Error('licence service unreachable');
      },
    });
    expect(t.isolationActive).toBe(false);
    expect(t.degraded).toBe(true);
  });

  it('never consults entitlement when the runtime is absent (already degraded)', () => {
    const entitle = vi.fn(() => ['group'] as const);
    const t = createTenancyService({
      requested: 'group',
      probeIsolation: () => false,
      probeEntitledPostures: entitle,
    });
    expect(t.degraded).toBe(true);
    expect(entitle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// [#17010] The organization census — a `single`-posture deployment that HOLDS
// more than one organization stops booting silently.
//
// ADR-0131 §1.2(3) calls that precondition 「a refused boot」 and it is not.
// ⛔ Boot still PROCEEDS here (ruled 2026-09-10): this suite pins the REPORT,
// its level, the subjects it must name — and, just as load-bearing, the
// NEGATIVE CONTROL, because a check that fires on a healthy install is worse
// than no check at all.
// ---------------------------------------------------------------------------
describe('single-posture organization census (#17010)', () => {
  /** An engine that answers the census — `count` is what makes the reading exact. */
  function makeCensusEngine(orgs: Array<{ id: string; slug?: string }>) {
    return {
      find: vi.fn(async (object: string, query: any) => {
        if (object !== 'sys_organization') return [];
        const where = query?.where ?? {};
        let rows = orgs;
        if (where.slug !== undefined) rows = rows.filter((o) => o.slug === where.slug);
        return rows.slice(0, query?.limit ?? rows.length);
      }),
      count: vi.fn(async (object: string) => (object === 'sys_organization' ? orgs.length : 0)),
      insert: vi.fn(async () => ({ id: 'ignored' })),
    };
  }

  const makeSink = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  // Spelled here rather than imported: the census is module-private (it has one
  // in-file caller), so this literal is the pin — rename the token and this
  // suite says so, which is the whole point of a grep token an operator keys on.
  const SINGLE_POSTURE_MANY_ORGANIZATIONS = 'single_posture_holds_many_organizations';

  const orgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `org_${i + 1}` }));

  it('reports at ERROR, naming the posture, the COUNT and both remedies', async () => {
    const engine = makeCensusEngine(orgs(3));
    const logger = makeSink();
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    expect(await t.defaultOrgId()).toBeNull();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    const [message, meta] = logger.error.mock.calls[0]!;
    // The grep token an operator keys on.
    expect(message).toContain(SINGLE_POSTURE_MANY_ORGANIZATIONS);
    // ① the posture it DECLARED, ② the count it HOLDS — the two facts the card asks for.
    expect(message).toContain("'single'");
    expect(message).toContain('3');
    expect(meta).toEqual({ posture: 'single', organizationCount: 3 });
    // ③ both remedies, named: declare a walled posture, or hold one organization.
    expect(message).toContain('OS_TENANCY_POSTURE=group');
    expect(message).toContain('OS_TENANCY_POSTURE=isolated');
    expect(message).toContain('HOLD ONE ORGANIZATION');
    // ④ the consequence, including that the deployment keeps looking healthy
    //    (AGENTS.md → "Degradation log levels": what an `error` owes its reader).
    expect(message).toContain('KEEP LOOKING HEALTHY');
  });

  it('NEGATIVE CONTROL: exactly one organization under `single` stays SILENT', async () => {
    const engine = makeCensusEngine([{ id: 'org_1', slug: 'default' }]);
    const logger = makeSink();
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    expect(await t.defaultOrgId()).toBe('org_1');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: a store with NO organization yet stays SILENT', async () => {
    const engine = makeCensusEngine([]);
    const logger = makeSink();
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    expect(await t.defaultOrgId()).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a WALLED posture pays nothing and says nothing — the organizations are declared', async () => {
    for (const requested of ['group', 'isolated'] as const) {
      const engine = makeCensusEngine(orgs(3));
      const logger = makeSink();
      const t = createTenancyService({
        requested,
        probeIsolation: () => true,
        getEngine: () => engine,
        logger,
      });

      expect(await t.defaultOrgId(), requested).toBeNull();
      expect(engine.count, requested).not.toHaveBeenCalled();
      expect(logger.error, requested).not.toHaveBeenCalled();
      expect(logger.warn, requested).not.toHaveBeenCalled();
    }
  });

  it('COST: the census costs ONE count() per process, however often it is asked', async () => {
    const engine = makeCensusEngine(orgs(4));
    const logger = makeSink();
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    await t.defaultOrgId();
    await t.defaultOrgId();
    await t.defaultOrgId();

    expect(engine.count).toHaveBeenCalledTimes(1);
    expect(engine.count).toHaveBeenCalledWith('sys_organization', {}, { context: { isSystem: true } });
    // Said ONCE, at the first degradation — not once per failed resolution.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('falls back to warn on a sink that declares no error, and never emits both', async () => {
    const engine = makeCensusEngine(orgs(2));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    await t.defaultOrgId();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![0]).toContain(SINGLE_POSTURE_MANY_ORGANIZATIONS);
  });

  it('an engine that cannot answer stays silent AND does not latch the census', async () => {
    // No `count`: every reduced mock embedding. An absence of measurement is
    // not evidence of a defect — and it must not disable the census either.
    const countless: any = makeCensusEngine(orgs(3));
    delete countless.count;
    const logger = makeSink();
    let engine: any = countless;
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    await t.defaultOrgId();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    // The engine becomes answerable later (the store came up after this seam
    // was first reached): the census must still be takeable.
    engine = makeCensusEngine(orgs(3));
    await t.defaultOrgId();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('a throwing count, and a throwing logger, never break the resolution', async () => {
    const engine: any = makeCensusEngine([{ id: 'org_1', slug: 'default' }]);
    engine.count = vi.fn(async () => {
      throw new Error('store unreachable');
    });
    expect(await createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger: makeSink(),
    }).defaultOrgId()).toBe('org_1');

    const loud = makeCensusEngine(orgs(3));
    const thrower = {
      warn: vi.fn(),
      error: vi.fn(() => {
        throw new Error('sink exploded');
      }),
    };
    expect(await createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => loud,
      logger: thrower,
    }).defaultOrgId()).toBeNull();
    expect(thrower.error).toHaveBeenCalledTimes(1);
  });

  it('a sink with no warn channel at all drops the report instead of throwing', async () => {
    // The declared sink types both members as optional, so a host CAN inject
    // `{ info }` alone. The narrowing proves `warn` before it claims the sink,
    // so such a host gets nothing — quietly, from inside a diagnostic.
    const engine = makeCensusEngine(orgs(3));
    const infoOnly = { info: vi.fn() };
    const t = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger: infoOnly,
    });

    expect(await t.defaultOrgId()).toBeNull();
    expect(infoOnly.info).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // The claim that makes this a BOOT-time reading rather than a lazy one:
  // `AuthPlugin` runs `backfillMemberships` from its `kernel:ready` hook with
  // `resolveTargetOrg: () => tenancy.defaultOrgId()`, under a membership policy
  // that defaults to `auto`. Pinned against the real pass, so the day that
  // wiring stops reaching this seam, this test says so.
  // -------------------------------------------------------------------------
  it('is taken AT BOOT: the kernel:ready membership backfill reaches this seam', async () => {
    const engine = makeCensusEngine(orgs(3));
    const logger = makeSink();
    const tenancy = createTenancyService({
      requested: 'single',
      probeIsolation: () => false,
      getEngine: () => engine,
      logger,
    });

    const res = await backfillMemberships(engine, {
      policy: 'auto',
      resolveTargetOrg: () => tenancy.defaultOrgId(),
      logger,
    });

    // The backfill itself correctly declines to guess (ADR-0093 D6) …
    expect(res.reason).toBe('no-target-org');
    // … and THAT is the boot moment the census is taken in.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toContain(SINGLE_POSTURE_MANY_ORGANIZATIONS);
  });
});

// ---------------------------------------------------------------------------
// The default organization id is checked when a user is BOUND, not trusted from
// a process-long cache. Under the `auto` membership policy membership is decided
// once, at creation (ADR-0093 D7), so a user bound to an organization that no
// longer exists is never repaired. The default organization can be deleted and
// recreated under a new id inside one process: the single-org bootstrap
// recreates a missing `slug='default'` organization on the next `sys_user`
// write, which is the very sign-up that then binds.
// ---------------------------------------------------------------------------
describe('defaultOrgId is revalidated when a user is bound', () => {
  /**
   * `sys_organization` + `sys_member` over arrays. `find` honours every `where`
   * key as an equality, so an existence read by `id` answers for that id and
   * nothing else, and refuses a combinator it does not implement.
   */
  function makeStore(orgs: Array<{ id: string; slug?: string }>) {
    const members: Array<{ id: string; organization_id: string; user_id: string }> = [];
    const tables: Record<string, Array<Record<string, unknown>>> = {
      sys_organization: orgs,
      sys_member: members,
    };
    const engine = {
      find: vi.fn(async (object: string, query: any) => {
        const where: Record<string, unknown> = query?.where ?? {};
        const rows = (tables[object] ?? []).filter((row) =>
          Object.entries(where).every(([k, v]) => {
            // Plain equality only: a combinator is refused, never read as a field name.
            if (k.startsWith('$')) throw new Error(`WHERE combinator ${k} is not implemented by this double`);
            return row[k] === v;
          }),
        );
        return rows.slice(0, query?.limit ?? rows.length);
      }),
      insert: vi.fn(async (object: string, row: any) => {
        (tables[object] ??= []).push(row);
        return row;
      }),
    };
    return { engine, orgs, members };
  }

  const singleOrg = (engine: unknown) =>
    createTenancyService({ requested: 'single', probeIsolation: () => false, getEngine: () => engine });

  it('a user created after the default organization is deleted and recreated binds to the NEW id', async () => {
    const store = makeStore([{ id: 'org_old', slug: 'default' }]);
    const tenancy = singleOrg(store.engine);
    const bind = (userId: string) =>
      reconcileMembership(store.engine, userId, {
        policy: 'auto',
        resolveTargetOrg: () => tenancy.defaultOrgId(),
      });

    // The first user resolves (and memoizes) the default organization.
    expect(await bind('usr_first')).toEqual({ outcome: 'bound', organizationId: 'org_old' });

    // Same process: the default organization is deleted, then recreated by the
    // bootstrap under a new id.
    store.orgs.splice(0, store.orgs.length);
    store.orgs.push({ id: 'org_new', slug: 'default' });

    expect(await bind('usr_second')).toEqual({ outcome: 'bound', organizationId: 'org_new' });
    expect(store.members.find((m) => m.user_id === 'usr_second')?.organization_id).toBe('org_new');
    // The memo now names the organization that exists.
    expect(await tenancy.defaultOrgId()).toBe('org_new');
  });

  it('COST: a memoized id that still exists costs ONE read per call and is not re-resolved', async () => {
    const store = makeStore([{ id: 'org_default', slug: 'default' }]);
    const tenancy = singleOrg(store.engine);
    expect(await tenancy.defaultOrgId()).toBe('org_default'); // resolves and memoizes

    for (let i = 0; i < 3; i++) {
      store.engine.find.mockClear();
      expect(await tenancy.defaultOrgId()).toBe('org_default');
      expect(store.engine.find).toHaveBeenCalledTimes(1);
      expect(store.engine.find).toHaveBeenCalledWith(
        'sys_organization',
        { where: { id: 'org_default' }, limit: 1 },
        { context: { isSystem: true } },
      );
    }
  });

  it('a deleted default organization not yet recreated resolves to null, then to its replacement', async () => {
    const store = makeStore([{ id: 'org_old', slug: 'default' }]);
    const tenancy = singleOrg(store.engine);
    expect(await tenancy.defaultOrgId()).toBe('org_old');

    store.orgs.splice(0, store.orgs.length);
    // Nothing to bind to: the deleted id is not handed out.
    expect(await tenancy.defaultOrgId()).toBeNull();

    store.orgs.push({ id: 'org_new', slug: 'default' });
    expect(await tenancy.defaultOrgId()).toBe('org_new');
  });

  it('the replacement is picked by the same rule as the first resolution (slug default first)', async () => {
    const store = makeStore([{ id: 'org_old', slug: 'default' }]);
    const tenancy = singleOrg(store.engine);
    expect(await tenancy.defaultOrgId()).toBe('org_old');

    // Deleted, then two organizations exist, one of them the recreated
    // `slug='default'` bootstrap organization: that one wins, as it would at boot.
    store.orgs.splice(0, store.orgs.length);
    store.orgs.push({ id: 'org_other' }, { id: 'org_new', slug: 'default' });
    expect(await tenancy.defaultOrgId()).toBe('org_new');
  });

  it('an existence read that the store cannot answer keeps the memoized id', async () => {
    const store = makeStore([{ id: 'org_default', slug: 'default' }]);
    const tenancy = singleOrg(store.engine);
    expect(await tenancy.defaultOrgId()).toBe('org_default');

    // A failed read is not evidence that the organization is gone; dropping
    // the memo on it would bind the next user to no organization at all.
    store.engine.find.mockRejectedValueOnce(new Error('store unreachable'));
    expect(await tenancy.defaultOrgId()).toBe('org_default');

    // A reply that is not a row list is not an answer either.
    store.engine.find.mockResolvedValueOnce({ records: [] } as any);
    expect(await tenancy.defaultOrgId()).toBe('org_default');

    // The next ANSWERED read still revalidates.
    store.orgs.splice(0, store.orgs.length);
    expect(await tenancy.defaultOrgId()).toBeNull();
  });
});
