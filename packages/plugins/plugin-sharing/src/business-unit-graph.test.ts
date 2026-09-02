// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BusinessUnitGraphService — org scoping of the unit tree.
 *
 * These pin the ORG-SCOPE behaviour specifically, because it is the exact
 * shape that broke approvals in #3807: `orgScope()` AND-composes a strict
 * `organization_id = <rule org>` equality, so a unit written with no
 * organization at all (a seeded / file-layer / bootstrap row — a seed cannot
 * know the org id the runtime mints at boot) matches nothing, the seed check
 * fails, and the expansion returns zero members. In approvals that produced a
 * dead `department:<id>` approver slot; here it would produce a sharing rule
 * that silently grants nobody.
 *
 * [#14547] IT BECAME REACHABLE, and the divergence is now closed. A rule
 * created through the REST data API by an organization admin IS org-stamped
 * (the engine stamps it, and an explicit `organization_id: null` in the payload
 * is overridden), so `expandRecipient` passes a real organization and the
 * strict screen fired on exactly the seeded units the reproduction used. The
 * predicate this file's earlier note nominated is the one that landed:
 * `orgScope` now composes `$or: [{ organization_id }, { organization_id: null }]`
 * — the platform's own null-inclusive tenant screen, the same one
 * `SqlDriver.applyTenantScope` emits and the same reading `plugin-approvals`
 * already had.
 *
 * ⚠️ Widening that screen alone would have been a LEAK, which is why this file
 * now pins a PAIR of asymmetric screens rather than one:
 *
 *   - the UNIT screen is null-inclusive (a seeded unit is usable), while
 *   - the MEMBER screen is STRICT (`memberScope`) — the member reads used to
 *     carry no organization predicate at all, and the old strict unit screen
 *     was the only thing keeping an org-stamped rule away from that unscoped
 *     query. A seeded unit id exists identically in every tenant, so widening
 *     the unit screen without screening the members turns a silent under-grant
 *     into a silent CROSS-TENANT over-grant.
 *
 * A NULL organization means different things on the two rows, which is what
 * makes the asymmetry principled rather than convenient: on the unit it is the
 * documented platform/seeded class, and on a member row it is UNKNOWN TENANCY
 * (measured: seed replay and elevated system writes both leave
 * `sys_business_unit_member.organization_id` NULL). A grant fails closed on
 * unknown tenancy.
 */

import { describe, it, expect } from 'vitest';
import { BusinessUnitGraphService } from './business-unit-graph.js';

interface UnitRow {
  id: string;
  parent_business_unit_id?: string | null;
  organization_id?: string | null;
  active?: boolean;
}
interface MemberRow {
  business_unit_id: string;
  user_id: string;
  /** [#14547] Absent = the org-less row seed replay and system writes produce. */
  organization_id?: string | null;
}

/**
 * Minimal engine over `sys_business_unit` + `sys_business_unit_member`.
 * Mirrors the real filter surface the service uses: plain equality, `$ne`,
 * `$in`, and `$or` (so a widened predicate would actually be exercised here
 * rather than silently ignored by the stub).
 */
function makeEngine(units: UnitRow[], members: MemberRow[]) {
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or') {
        if (!(v as any[]).some((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const rv = row[k];
      if (v && typeof v === 'object' && '$ne' in (v as any)) {
        if (rv === (v as any).$ne) return false;
        continue;
      }
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      // `organization_id: null` must also match a row that simply omits the
      // column — that is what a NULL column reads back as.
      if (v === null) {
        if (rv != null) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  };

  return {
    async find(object: string, options: any) {
      const filter = options?.where ?? options?.filter ?? {};
      if (object === 'sys_business_unit') return units.filter((u) => matches(u, filter));
      if (object === 'sys_business_unit_member') return members.filter((m) => matches(m, filter));
      return [];
    },
  } as any;
}

/** A seeded org tree: rows written before any organization existed. */
const SEEDED_UNITS: UnitRow[] = [
  { id: 'bu_root', organization_id: null, active: true },
  { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: null, active: true },
];
const SEEDED_MEMBERS: MemberRow[] = [
  { business_unit_id: 'bu_root', user_id: 'u_root' },
  { business_unit_id: 'bu_child', user_id: 'u_child' },
];

describe('BusinessUnitGraphService — subtree expansion', () => {
  it('expands the unit and every descendant', async () => {
    const g = new BusinessUnitGraphService({ engine: makeEngine(SEEDED_UNITS, SEEDED_MEMBERS) });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
  });

  it('an inactive unit contributes nobody and stops the descent', async () => {
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: null, active: false },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: null, active: true },
    ];
    const g = new BusinessUnitGraphService({ engine: makeEngine(units, SEEDED_MEMBERS) });
    expect(await g.expandUsers('bu_root')).toEqual([]);
  });
});

/**
 * [#7807] The two widths, pinned as a PAIR on one three-level tree.
 *
 * A division ⊃ department ⊃ office tree is the floor for this: on a two-level
 * fixture "exactly one unit" and "unit plus its children" can agree by
 * accident, so a two-level pin cannot tell the fixed behaviour from the
 * defect. Each assertion below names the width it guards, because a change
 * that narrowed BOTH kinds would satisfy the `business_unit` half while
 * destroying the distinction the spec draws between them.
 */
const DIV_UNITS: UnitRow[] = [
  { id: 'bu_div', organization_id: null, active: true },
  { id: 'bu_dept', parent_business_unit_id: 'bu_div', organization_id: null, active: true },
  { id: 'bu_office', parent_business_unit_id: 'bu_dept', organization_id: null, active: true },
];
const DIV_MEMBERS: MemberRow[] = [
  { business_unit_id: 'bu_div', user_id: 'u_div' },
  { business_unit_id: 'bu_dept', user_id: 'u_dept' },
  { business_unit_id: 'bu_office', user_id: 'u_office' },
];

describe('BusinessUnitGraphService — the two widths are actually two widths (#7807)', () => {
  const graph = () => new BusinessUnitGraphService({ engine: makeEngine(DIV_UNITS, DIV_MEMBERS) });

  it('NARROW — expandUnitMembers returns only the named unit, three levels notwithstanding', async () => {
    expect(await graph().expandUnitMembers('bu_div')).toEqual(['u_div']);
  });

  it('WIDE — expandUsers still returns the whole subtree (the control)', async () => {
    expect((await graph().expandUsers('bu_div')).sort()).toEqual(['u_dept', 'u_div', 'u_office']);
  });

  it('the narrow width skips even a DIRECT child, not merely the grandchild', async () => {
    const users = await graph().expandUnitMembers('bu_div');
    expect(users).not.toContain('u_dept');
    expect(users).not.toContain('u_office');
  });

  it('a mid-tree unit expands to its own members only', async () => {
    expect(await graph().expandUnitMembers('bu_dept')).toEqual(['u_dept']);
  });

  it('an inactive unit contributes nobody to the narrow width either', async () => {
    const units = DIV_UNITS.map((u) => (u.id === 'bu_div' ? { ...u, active: false } : u));
    const g = new BusinessUnitGraphService({ engine: makeEngine(units, DIV_MEMBERS) });
    expect(await g.expandUnitMembers('bu_div')).toEqual([]);
  });

  it('an unknown unit expands to nobody rather than to everybody', async () => {
    expect(await graph().expandUnitMembers('bu_nope')).toEqual([]);
    expect(await graph().expandUnitMembers('')).toEqual([]);
  });

  it('[#14547] the narrow width is org-predicated exactly like the wide one', async () => {
    const g = new BusinessUnitGraphService({
      engine: makeEngine(DIV_UNITS, DIV_MEMBERS),
      organizationId: 'org_a',
    });
    // The seeded (null-org) UNIT is now usable — but these members carry no
    // organization either, and an org-stamped rule does not grant to rows of
    // unknown tenancy. Empty, for the member reason rather than the unit one;
    // the org-stamped-member control is in the `#14547` block below.
    expect(await g.expandUnitMembers('bu_div')).toEqual([]);
  });

  it('the two widths do NOT share a cache entry for the same unit id', async () => {
    // Both maps are keyed by BU id. One shared map would let whichever width
    // ran first answer for the other — the over-grant returning through the
    // cache door.
    const g = graph();
    expect(await g.expandUnitMembers('bu_div')).toEqual(['u_div']);
    expect((await g.expandUsers('bu_div')).sort()).toEqual(['u_dept', 'u_div', 'u_office']);
    // …and in the opposite order, on a fresh instance.
    const g2 = graph();
    expect((await g2.expandUsers('bu_div')).sort()).toEqual(['u_dept', 'u_div', 'u_office']);
    expect(await g2.expandUnitMembers('bu_div')).toEqual(['u_div']);
  });
});

describe('BusinessUnitGraphService — org scoping (#3807)', () => {
  it('an org-less rule (today’s materialized shape) expands seeded units fine', async () => {
    // `expandRecipient` passes `rule.organization_id ?? null`, and every
    // materialized sharing rule carries null — so `orgScope` adds nothing and
    // the seeded tree resolves. This is the only path that runs in practice.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, SEEDED_MEMBERS),
      organizationId: null,
    });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
  });

  it('an org-scoped rule expands units belonging to that org', async () => {
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: 'org_a', active: true },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: 'org_a', active: true },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, SEEDED_MEMBERS),
      organizationId: 'org_a',
    });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
  });

  it('an org-scoped rule never reaches another org’s unit', async () => {
    const units: UnitRow[] = [{ id: 'bu_root', organization_id: 'org_b', active: true }];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, SEEDED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
  });

  it('[#14547, was divergence] an org-scoped rule DOES see an env-wide (null-org) unit — as approvals does (#3807)', async () => {
    // The former `[divergence]` pin, flipped. Same inputs #3807 fixed on the
    // approvals side; sharing now reads a null-org unit the same way, so the
    // unit resolves and its ORG-STAMPED members are granted. The unit rows
    // stay seeded (null-org) — that is the whole point — and only the
    // membership rows carry the rule's organization, which is exactly what the
    // reported reproduction had (units from app seed data, memberships POSTed
    // through the REST data API).
    const members: MemberRow[] = SEEDED_MEMBERS.map((m) => ({ ...m, organization_id: 'org_a' }));
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, members),
      organizationId: 'org_a',
    });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
  });
});

/**
 * [#14547] The pair of screens, asserted as a pair.
 *
 * Every case below runs the SAME seeded (null-org) unit tree, because that is
 * the tree the reproduction had and the one the unit screen was widened for.
 * What varies is the MEMBER rows' organization, which is the only tenancy fact
 * a membership carries — so each assertion isolates the member screen from the
 * unit screen instead of moving both at once.
 */
describe('BusinessUnitGraphService — the unit screen widened, the member screen did not (#14547)', () => {
  /** Two tenants' members inside ONE seeded, org-less unit tree. */
  const MIXED_MEMBERS: MemberRow[] = [
    { business_unit_id: 'bu_root', user_id: 'u_a_root', organization_id: 'org_a' },
    { business_unit_id: 'bu_child', user_id: 'u_a_child', organization_id: 'org_a' },
    { business_unit_id: 'bu_root', user_id: 'u_b_root', organization_id: 'org_b' },
    { business_unit_id: 'bu_child', user_id: 'u_b_child', organization_id: 'org_b' },
    { business_unit_id: 'bu_root', user_id: 'u_unstamped' },
  ];

  const graph = (organizationId: string | null, members: MemberRow[] = MIXED_MEMBERS) =>
    new BusinessUnitGraphService({ engine: makeEngine(SEEDED_UNITS, members), organizationId });

  it('(a) an org-NULL unit is USABLE for an org-stamped rule — both widths', async () => {
    // The defect verbatim: `seedIsUsable` read the seeded unit as "does not
    // exist", so both widths returned zero users and the rule granted nobody.
    expect((await graph('org_a').expandUsers('bu_root')).sort()).toEqual(['u_a_child', 'u_a_root']);
    expect(await graph('org_a').expandUnitMembers('bu_root')).toEqual(['u_a_root']);
  });

  it('(b) members of ANOTHER organization are never expanded — both widths', async () => {
    // The leak that widening the unit screen alone would have opened: one
    // seeded unit id, reachable from every tenant, over an unscoped member
    // query. Asserted on the WIDE width too — it is the recipient kind the
    // reported reproduction used.
    const wide = await graph('org_a').expandUsers('bu_root');
    expect(wide).not.toContain('u_b_root');
    expect(wide).not.toContain('u_b_child');
    const narrow = await graph('org_a').expandUnitMembers('bu_root');
    expect(narrow).not.toContain('u_b_root');
    // …and the mirror image, so neither answer is right by accident.
    expect((await graph('org_b').expandUsers('bu_root')).sort()).toEqual(['u_b_child', 'u_b_root']);
  });

  it('(c) a NULL-org member row is NOT a member of an org-stamped rule', async () => {
    // Measured on this tree: seed replay (`seed-loader.ts` withholds its
    // single-org fallback from every `sys_` object) and elevated system writes
    // (`sys_business_unit_member` is `unclassified` in
    // `PLATFORM_OBJECT_TENANCY`) both leave the column NULL. So NULL here is
    // UNKNOWN TENANCY, not "platform-global", and a grant fails closed on it.
    expect(await graph('org_a').expandUsers('bu_root')).not.toContain('u_unstamped');
    expect(await graph('org_b').expandUsers('bu_root')).not.toContain('u_unstamped');
  });

  it('(c control) an org-LESS rule still expands every member, stamped or not', async () => {
    // The dominant path in practice, and the one that must not move: with no
    // organization on the rule there is nothing to screen against, so the
    // member read stays exactly as unscoped as it was before #14547.
    expect((await graph(null).expandUsers('bu_root')).sort()).toEqual(
      ['u_a_child', 'u_a_root', 'u_b_child', 'u_b_root', 'u_unstamped'],
    );
  });

  it('an org-stamped rule still never reaches ANOTHER org’s unit', async () => {
    // The widening admits NULL, and only NULL. A unit belonging to org_b is
    // still invisible to an org_a rule — the null-inclusive screen must not be
    // read as "no screen".
    const units: UnitRow[] = [{ id: 'bu_root', organization_id: 'org_b', active: true }];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, [{ business_unit_id: 'bu_root', user_id: 'u_b', organization_id: 'org_b' }]),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
  });

  it('the descent into a seeded subtree is null-inclusive too, not just the seed', async () => {
    // `descendants()` runs `orgScope` on the CHILD query as well. A screen
    // applied to the seed alone would find the root and then walk into an
    // empty child set — the same zero-grant, one query later.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: 'org_a', active: true },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: null, active: true },
    ];
    const members: MemberRow[] = [
      { business_unit_id: 'bu_child', user_id: 'u_child', organization_id: 'org_a' },
    ];
    const g = new BusinessUnitGraphService({ engine: makeEngine(units, members), organizationId: 'org_a' });
    expect(await g.expandUsers('bu_root')).toEqual(['u_child']);
  });

  it('an inactive seeded unit still contributes nobody', async () => {
    // The widening is about TENANCY only. `active: false` remains a hard stop,
    // on the seed and on the descent.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: null, active: false },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: null, active: true },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, MIXED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
  });
});
