// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { createTenancyService, resolveDefaultOrgId } from './tenancy-service.js';

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
      await t.defaultOrgId(); // memoized — no new query
      expect(engine.find.mock.calls.length).toBe(callsAfterResolve);
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
