// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D3 — positions are FLAT: expansion resolves holders from the
// platform assignment table ∪ the better-auth membership transition source.
// The former hierarchy walk (descendant positions) was retired with the tree.

import { describe, it, expect } from 'vitest';
import { PositionGraphService } from './position-graph.js';

// Minimal engine: resolves find('sys_user_position') and find('sys_member').
function makeEngine(
  assignments: Array<{ position: string; user_id: string; organization_id?: string | null }>,
  members: Array<{ role: string; user_id: string }>,
) {
  return {
    async find(object: string, options: any) {
      const f = options?.filter ?? options?.where ?? {};
      if (object === 'sys_user_position') {
        return assignments.filter(
          (a) =>
            (f.position === undefined || a.position === f.position) &&
            (f.organization_id === undefined || a.organization_id === f.organization_id),
        );
      }
      if (object === 'sys_member') return members.filter((m) => f.role === undefined || m.role === f.role);
      return [];
    },
  } as any;
}

const ASSIGNMENTS = [
  { position: 'sales_manager', user_id: 'u_mgr' },
  { position: 'sales_rep', user_id: 'u_rep1' },
  { position: 'sales_rep', user_id: 'u_rep2' },
];
const MEMBERS = [
  { role: 'sales_rep', user_id: 'u_legacy_rep' }, // better-auth transition source
  { role: 'exec', user_id: 'u_exec' },
];

describe('PositionGraphService (ADR-0090 D3 — flat expansion)', () => {
  it('expands holders from the platform assignment table', async () => {
    const g = new PositionGraphService({ engine: makeEngine(ASSIGNMENTS, []) });
    expect((await g.expandPositionUsers('sales_rep')).sort()).toEqual(['u_rep1', 'u_rep2']);
    expect(await g.expandPositionUsers('sales_manager')).toEqual(['u_mgr']);
  });

  it('unions the better-auth membership transition source (no duplicates)', async () => {
    const g = new PositionGraphService({
      engine: makeEngine([...ASSIGNMENTS, { position: 'sales_rep', user_id: 'u_legacy_rep' }], MEMBERS),
    });
    const users = (await g.expandPositionUsers('sales_rep')).sort();
    expect(users).toEqual(['u_legacy_rep', 'u_rep1', 'u_rep2']);
  });

  it('membership-only holders still resolve (transition window)', async () => {
    const g = new PositionGraphService({ engine: makeEngine([], MEMBERS) });
    expect(await g.expandPositionUsers('exec')).toEqual(['u_exec']);
  });

  it('unknown position / empty name → empty', async () => {
    const g = new PositionGraphService({ engine: makeEngine(ASSIGNMENTS, MEMBERS) });
    expect(await g.expandPositionUsers('nope')).toEqual([]);
    expect(await g.expandPositionUsers('')).toEqual([]);
  });

  it('filters holders outside their validity window (ADR-0091 D2) — expired holders stop receiving shares', async () => {
    const past = '2000-01-01T00:00:00Z';
    const future = '2999-01-01T00:00:00Z';
    const g = new PositionGraphService({
      engine: makeEngine(
        [
          { position: 'sales_rep', user_id: 'u_active' },
          { position: 'sales_rep', user_id: 'u_expired', valid_until: past } as any,
          { position: 'sales_rep', user_id: 'u_pending', valid_from: future } as any,
          { position: 'sales_rep', user_id: 'u_windowed', valid_from: past, valid_until: future } as any,
        ],
        [],
      ),
    });
    expect((await g.expandPositionUsers('sales_rep')).sort()).toEqual(['u_active', 'u_windowed']);
  });

  it('caches per (org, position) within a pass', async () => {
    let calls = 0;
    const engine = {
      async find(object: string, options: any) {
        calls++;
        if (object === 'sys_user_position') return [{ position: 'p', user_id: 'u1' }];
        return [];
      },
    } as any;
    const g = new PositionGraphService({ engine });
    await g.expandPositionUsers('p');
    const before = calls;
    await g.expandPositionUsers('p');
    expect(calls).toBe(before); // second hit served from cache
  });
});

describe('PositionGraphService.holdsPosition — the user-scoped twin of the expansion', () => {
  const past = '2000-01-01T00:00:00Z';
  const future = '2999-01-01T00:00:00Z';
  const ASSIGN = [
    { position: 'rep', user_id: 'u_a', organization_id: 'org_a' },
    { position: 'rep', user_id: 'u_b', organization_id: 'org_b' },
    { position: 'rep', user_id: 'u_global', organization_id: null },
    { position: 'rep', user_id: 'u_expired', organization_id: 'org_a', valid_until: past },
    { position: 'rep', user_id: 'u_pending', organization_id: 'org_a', valid_from: future },
    { position: 'rep', user_id: 'u_mixed', organization_id: 'org_a', valid_until: past },
    { position: 'rep', user_id: 'u_mixed', organization_id: 'org_a', valid_from: past, valid_until: future },
    { position: 'mgr', user_id: 'u_a', organization_id: 'org_a' },
  ];
  const MEMBER = [
    { role: 'rep', user_id: 'u_role_a', organization_id: 'org_a' },
    { role: 'rep', user_id: 'u_role_b', organization_id: 'org_b' },
  ];
  /** Honours every predicate key both reads send: position / role, organization_id, user_id. */
  const engine = {
    async find(object: string, options: any) {
      const f = options?.filter ?? options?.where ?? {};
      const rows: any[] = object === 'sys_user_position' ? ASSIGN : object === 'sys_member' ? MEMBER : [];
      return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
    },
  } as any;
  const USERS = ['u_a', 'u_b', 'u_global', 'u_expired', 'u_pending', 'u_mixed', 'u_role_a', 'u_role_b', 'u_none'];

  it('answers exactly expandPositionUsers(...).includes(user) for every user, position and organization scope', async () => {
    const verdicts = { holds: 0, not: 0 };
    for (const org of [undefined, 'org_a', 'org_b']) {
      for (const position of ['rep', 'mgr', 'nope']) {
        const expanded = await new PositionGraphService({ engine, organizationId: org ?? null }).expandPositionUsers(position, org);
        for (const user of USERS) {
          const g = new PositionGraphService({ engine, organizationId: org ?? null });
          const holds = await g.holdsPosition(user, position, org);
          expect({ org, position, user, holds }).toEqual({ org, position, user, holds: expanded.includes(user) });
          verdicts[holds ? 'holds' : 'not'] += 1;
        }
      }
    }
    // Both answers occur, so the matrix cannot pass by answering one of them.
    expect(verdicts.holds).toBeGreaterThan(5);
    expect(verdicts.not).toBeGreaterThan(5);
  });

  it('reads one user, never the position\'s whole holder list', async () => {
    const seen: any[] = [];
    const spy = { async find(object: string, options: any) { seen.push({ object, f: options?.filter ?? options?.where }); return engine.find(object, options); } } as any;
    await new PositionGraphService({ engine: spy, organizationId: 'org_a' }).holdsPosition('u_role_a', 'rep', 'org_a');
    expect(seen.map((s) => s.object)).toEqual(['sys_user_position', 'sys_member']);
    expect(seen.every((s) => s.f.user_id === 'u_role_a')).toBe(true);
  });
});
