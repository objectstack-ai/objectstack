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

  // [ADR-0105 D1/D12] `group` is enforced by the OPEN engine — the union wall,
  // `accessible_org_ids`, and write stamping are all open code — so it never
  // probes for the enterprise package and can never resolve degraded.
  describe('group posture (open-enforced)', () => {
    it('is active without the enterprise org-scoping service', () => {
      const probe = vi.fn(() => false);
      const t = createTenancyService({ requested: 'group', probeIsolation: probe });
      expect(t.posture).toBe('group');
      expect(t.isolationActive).toBe(true);
      expect(t.requested).toBe(true);
      expect(t.degraded).toBe(false);
      expect(probe).not.toHaveBeenCalled();
    });

    it('never guesses a default org — membership is explicit', async () => {
      const engine = makeEngine([{ id: 'org_default', slug: 'default' }]);
      const t = createTenancyService({
        requested: 'group',
        probeIsolation: () => false,
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
