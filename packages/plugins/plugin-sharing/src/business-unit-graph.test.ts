// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BusinessUnitGraphService — the TWO tenant screens, pinned as a pair.
 *
 * ## What this file used to say, and why it changed
 *
 * Until #14547 `orgScope()` AND-composed a strict `organization_id = <rule
 * org>` equality onto the UNIT read. A unit written with no organization at
 * all (a seeded / file-layer / bootstrap row — a seed cannot know the org id
 * the runtime mints at boot) therefore matched nothing, the seed check failed,
 * and BOTH widths expanded to zero members. #3807 had already fixed exactly
 * that on the approvals side; this file recorded the sharing side's divergence
 * as deliberate on the grounds that it was unreachable, because every
 * materialized `sys_sharing_rule` row carried `organization_id = null`.
 *
 * It was reachable. #14547 is the external report: an org admin creating a
 * rule at runtime gets an org-stamped rule, the seeded unit carries none, and
 * the rule is accepted, stays active, materialises zero `sys_record_share`
 * rows and logs nothing. The `[divergence]` test that pinned the old posture
 * is gone — replaced, not merely flipped, because an assertion that keeps
 * passing while the mechanism under it changes is worse than no assertion.
 *
 * ## The pair this file now pins
 *
 * The fix is ASYMMETRIC and both halves have to be pinned, because each one
 * alone is a defect:
 *
 *   - the UNIT screen (`orgScope`) is NULL-INCLUSIVE — the platform's own
 *     `(organization_id = ? OR organization_id IS NULL)`, the predicate
 *     `SqlDriver.applyTenantScope` writes and `plugin-approvals` already
 *     applies to these very rows;
 *   - the MEMBER screen (`memberScope`) is STRICT. Both member reads used to
 *     carry no organization predicate at all, and the strict unit screen was
 *     the only thing holding an org-stamped rule away from that unscoped
 *     query. Widening the unit screen ALONE turns a silent under-grant into a
 *     silent CROSS-TENANT OVER-GRANT, since a seeded unit id exists
 *     identically in every tenant.
 *
 * So the security half is pinned separately from the functional half below: a
 * change that expands the right members while also expanding another
 * organization's members satisfies the functional pin completely.
 */

import { describe, it, expect } from 'vitest';
import { BusinessUnitGraphService } from './business-unit-graph.js';

interface UnitRow {
  id: string;
  parent_business_unit_id?: string | null;
  organization_id?: string | null;
  active?: boolean;
  manager_user_id?: string | null;
}
interface MemberRow { business_unit_id: string; user_id: string; organization_id?: string | null }

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

  it('the narrow width is org-predicated exactly like the wide one', async () => {
    // [#14547] Same fixture, new mechanism — and the mechanism is spelled out
    // because the ASSERTION did not move. `DIV_MEMBERS` carry no organization,
    // so before #14547 this returned `[]` because the strict UNIT screen hid
    // the seeded unit, and after it returns `[]` because the strict MEMBER
    // screen refuses membership rows of unknown tenancy. An unchanged
    // expectation over a changed cause is exactly the kind of pin that stops
    // guarding anything, so the two causes are separated below: the unit is
    // now visible (`descendants` sees the whole seeded tree), and it is the
    // members that are refused.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(DIV_UNITS, DIV_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_div')).toEqual([]);
    expect((await g.descendants('bu_div')).sort()).toEqual(['bu_dept', 'bu_div', 'bu_office']);
  });

  it('[#14547] both widths reach org-stamped members of a SEEDED unit tree', async () => {
    // The one change that flips the outcome: the membership rows are stamped,
    // exactly as a REST/session write stamps them. The units stay seeded.
    const members: MemberRow[] = DIV_MEMBERS.map((m) => ({ ...m, organization_id: 'org_a' }));
    const g = new BusinessUnitGraphService({
      engine: makeEngine(DIV_UNITS, members),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_div')).toEqual(['u_div']);
    expect((await g.expandUsers('bu_div')).sort()).toEqual(['u_dept', 'u_div', 'u_office']);
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
    // [#14547] The membership rows are stamped now. They used to be org-less
    // here and still expanded, because the member read carried no organization
    // predicate whatever — the gap #14547 closed. Units created through the
    // API by org_a have memberships created the same way, so this is the
    // fixture becoming faithful, not the assertion being relaxed.
    const members: MemberRow[] = SEEDED_MEMBERS.map((m) => ({ ...m, organization_id: 'org_a' }));
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, members),
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

  it('an org-scoped rule never reaches another org’s MEMBER of a unit it can see', async () => {
    // [#14547] The unit is org_a's and visible; the membership row is org_b's.
    // The member screen is the only thing that answers here, so this fails if
    // `memberScope` is dropped even while every unit-level assertion passes.
    const units: UnitRow[] = [{ id: 'bu_root', organization_id: 'org_a', active: true }];
    const members: MemberRow[] = [
      { business_unit_id: 'bu_root', user_id: 'u_a', organization_id: 'org_a' },
      { business_unit_id: 'bu_root', user_id: 'u_b', organization_id: 'org_b' },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, members),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual(['u_a']);
    expect(await g.expandUnitMembers('bu_root')).toEqual(['u_a']);
  });
});

/**
 * [#14547] The UNIT screen is null-inclusive — the divergence from
 * `plugin-approvals` (#3807) is CLOSED.
 *
 * The `[divergence]` test that used to live in the block above pinned the
 * opposite posture on the grounds that it could not fire. It fired: the
 * external report is an org admin creating a rule at runtime against a unit
 * the app seeded.
 */
describe('BusinessUnitGraphService — the UNIT screen (#14547)', () => {
  const STAMPED_MEMBERS: MemberRow[] = SEEDED_MEMBERS.map((m) => ({
    ...m,
    organization_id: 'org_a',
  }));

  it('an org-scoped rule DOES see an env-wide (null-org) seeded unit', async () => {
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
    expect(await g.expandUnitMembers('bu_root')).toEqual(['u_root']);
  });

  it('the seed check and the subtree walk BOTH admit the seeded rows', async () => {
    // `seedIsUsable` and the `descendants` BFS are two separate reads through
    // the same screen; a widening applied to one and not the other would still
    // answer `[]` for the subtree width.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect((await g.descendants('bu_root')).sort()).toEqual(['bu_child', 'bu_root']);
  });

  it('`headOf` resolves the manager of a seeded unit too', async () => {
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: null, active: true, manager_user_id: 'u_head' },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, []),
      organizationId: 'org_a',
    });
    expect(await g.headOf('bu_root')).toBe('u_head');
  });

  it('ONLY the NULL arm widened — another org’s unit is still invisible', async () => {
    // The control that separates "null-inclusive" from "unscoped". Without it
    // a screen that had simply been deleted would pass every assertion above.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: 'org_b', active: true },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: 'org_b', active: true },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
    expect(await g.descendants('bu_root')).toEqual([]);
    expect(await g.headOf('bu_root')).toBeNull();
  });

  it('an INACTIVE seeded unit still contributes nobody', async () => {
    const units: UnitRow[] = SEEDED_UNITS.map((u) =>
      u.id === 'bu_root' ? { ...u, active: false } : u,
    );
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
  });
});

/**
 * [#14547] The MEMBER screen is STRICT — the leak the unit widening would
 * otherwise have opened.
 *
 * ⚠️ These are the SECURITY half and they are pinned apart from the functional
 * half on purpose: a change that expands the right members while also
 * expanding another organization's members passes every assertion in the block
 * above.
 */
describe('BusinessUnitGraphService — the MEMBER screen (#14547)', () => {
  /**
   * One SEEDED unit id with two tenants' memberships hanging off it — the
   * shape that exists on every deployment whose org chart came from a seed,
   * and the one the widened unit screen makes reachable.
   */
  const SHARED_SEED_UNITS: UnitRow[] = [
    { id: 'bu_market', organization_id: null, active: true },
    { id: 'bu_market_west', parent_business_unit_id: 'bu_market', organization_id: null, active: true },
  ];
  const TWO_TENANT_MEMBERS: MemberRow[] = [
    { business_unit_id: 'bu_market', user_id: 'u_a', organization_id: 'org_a' },
    { business_unit_id: 'bu_market', user_id: 'u_b', organization_id: 'org_b' },
    { business_unit_id: 'bu_market_west', user_id: 'u_a_west', organization_id: 'org_a' },
    { business_unit_id: 'bu_market_west', user_id: 'u_b_west', organization_id: 'org_b' },
  ];

  it('WIDE — a subtree expansion never crosses into another organization', async () => {
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SHARED_SEED_UNITS, TWO_TENANT_MEMBERS),
      organizationId: 'org_a',
    });
    const users = await g.expandUsers('bu_market');
    expect(users.sort()).toEqual(['u_a', 'u_a_west']);
    expect(users).not.toContain('u_b');
    expect(users).not.toContain('u_b_west');
  });

  it('NARROW — the single-unit expansion does not cross either', async () => {
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SHARED_SEED_UNITS, TWO_TENANT_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_market')).toEqual(['u_a']);
  });

  it('an org-LESS membership row is NOT a member of an org-scoped rule', async () => {
    // Unknown tenancy, not platform-global: `sys_business_unit_member` is not
    // organization-stamped by seed replay or by an elevated system write, so a
    // NULL here cannot be read the way a NULL on the UNIT row is read. The
    // grant fails closed, and `SharingRuleService` warns rather than staying
    // silent about it.
    const members: MemberRow[] = [
      { business_unit_id: 'bu_market', user_id: 'u_seeded', organization_id: null },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SHARED_SEED_UNITS, members),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_market')).toEqual([]);
    expect(await g.expandUsers('bu_market')).toEqual([]);
  });

  it('an org-LESS rule is unmoved — both screens stay no-ops', async () => {
    // The dominant shape today (declared rules bootstrap org-less). #14547
    // must not change what they expand to, in either direction.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SHARED_SEED_UNITS, TWO_TENANT_MEMBERS),
      organizationId: null,
    });
    expect((await g.expandUsers('bu_market')).sort()).toEqual([
      'u_a', 'u_a_west', 'u_b', 'u_b_west',
    ]);
  });
});
