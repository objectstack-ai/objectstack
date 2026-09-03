// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * BusinessUnitGraphService — the TWO tenant screens, pinned as a pair.
 *
 * ## Both screens are STRICT equalities, and that is the shipped posture
 *
 *   - the UNIT screen (`orgScope`) AND-composes `organization_id = <rule org>`
 *     onto the `sys_business_unit` read. A unit written with no organization
 *     at all (a seeded / file-layer / bootstrap row — a seed cannot know the
 *     org id the runtime mints at boot) therefore matches nothing for an
 *     org-stamped rule, the seed check fails, and BOTH widths expand to zero
 *     members;
 *   - the MEMBER screen (`memberScope`) AND-composes the same equality onto
 *     the `sys_business_unit_member` reads. Both member reads used to carry no
 *     organization predicate at all — completely unscoped by organization —
 *     which is the cross-tenant hole #14949 closed and this file still pins.
 *
 * ## #14547's symptom STANDS in 17.x, and these tests reproduce it
 *
 * #14547 is the external report of the unit half: an org admin creating a rule
 * at runtime gets an org-stamped rule, the seeded unit carries no
 * organization, and the rule is accepted, stays active and materialises zero
 * `sys_record_share` rows. #14949 briefly closed it by giving the UNIT screen
 * the platform's NULL-inclusive `$or` arm. That was reverted before 17.3 was
 * cut (ADR-0131 D8): it re-implements the predicate
 * `SqlDriver.applyTenantScope` already owns, a second time in a second place —
 * the duplication ADR-0131 exists to retire — and it had not shipped.
 *
 * So 17.3 behaves exactly as 17.2.0 does here, and the cases below name
 * **#14547** as the defect they reproduce. ⚠️ #14547 is CLOSED as completed —
 * closed by #14949, whose unit half this reverts — so its GitHub state no
 * longer matches the 17.x runtime. Whether it is reopened is the maintainer's
 * call, not this file's; what the tests assert is the behaviour, which is
 * 17.2.0's. It is fixed structurally on
 * the v18 line by ADR-0131 C1 (the Default Organization exists before
 * application seed datasets load, and the seed loader stamps
 * `sys_business_unit` seeds), so the row this screen reads carries an
 * organization and no screen has to special-case it. What #14949 left behind —
 * and what keeps the 17.x symptom LOUD rather than silent — is
 * `SharingRuleService.warnOnEmptyUnitExpansion`.
 *
 * ## Why the member screen is pinned on ORG-STAMPED units
 *
 * ⚠️ The member pins below deliberately anchor on a unit stamped with the
 * rule's own organization. With the unit screen strict, a seeded (org-less)
 * unit is invisible to an org-stamped rule, so a member pin written on one
 * would pass no matter what `memberScope` did — the unit screen would answer
 * first and the assertion would never reach the member read. Anchoring on a
 * visible unit is what keeps these assertions about the MEMBER screen.
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
    // [#14547] `DIV_UNITS` are seeded (org-less) and `DIV_MEMBERS` carry no
    // organization either, so BOTH strict screens refuse this fixture. The
    // unit screen answers FIRST and is the one being pinned here: the subtree
    // walk cannot see the seeded tree at all, which is why the expansion is
    // empty. The member screen's own refusal is pinned separately, on a unit
    // the rule can actually see, in the MEMBER screen block below.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(DIV_UNITS, DIV_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_div')).toEqual([]);
    expect(await g.descendants('bu_div')).toEqual([]);
  });

  it('[#14547] NEITHER width reaches a SEEDED unit tree, even with stamped members', async () => {
    // ⚠️ This reproduces the defect #14547 reports — it does not assert a fix.
    // The membership rows are stamped exactly as a REST/session write stamps
    // them, so the MEMBER screen would admit every one of them; the units stay
    // seeded, so the strict UNIT screen hides the tree before the member read
    // is ever issued. Both widths therefore answer nobody, which is precisely
    // the 17.2.0 symptom: rule accepted, active, zero shares.
    // Fixed structurally in v18 by ADR-0131 C1 (seed loader stamps
    // `sys_business_unit`), NOT by widening this screen.
    const members: MemberRow[] = DIV_MEMBERS.map((m) => ({ ...m, organization_id: 'org_a' }));
    const g = new BusinessUnitGraphService({
      engine: makeEngine(DIV_UNITS, members),
      organizationId: 'org_a',
    });
    expect(await g.expandUnitMembers('bu_div')).toEqual([]);
    expect(await g.expandUsers('bu_div')).toEqual([]);
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
 * [#14547] The UNIT screen is STRICT — the divergence from `plugin-approvals`
 * (#3807) STANDS, and 17.3 ships it exactly as 17.2.0 did.
 *
 * ⚠️ Every case in this block reproduces the defect **#14547** reports, which
 * 17.x still has. None of them asserts a fix. #14949 closed the defect by giving this screen the
 * platform's NULL-inclusive arm; that was reverted before the 17.3 tag
 * (ADR-0131 D8) because it wrote `SqlDriver.applyTenantScope`'s own predicate
 * a second time, in a second place, and had not shipped. The structural fix is
 * ADR-0131 C1 on the v18 line: the Default Organization exists before
 * application seed datasets load and the seed loader stamps
 * `sys_business_unit` seeds, so these rows arrive already carrying an
 * organization and this screen needs no NULL arm to find them.
 *
 * ⛔ If a future change makes any assertion here fail, that is a NULL arm
 * coming back — re-read ADR-0131 D8 before "fixing" the test.
 */
describe('BusinessUnitGraphService — the UNIT screen (#14547)', () => {
  const STAMPED_MEMBERS: MemberRow[] = SEEDED_MEMBERS.map((m) => ({
    ...m,
    organization_id: 'org_a',
  }));

  it('an org-scoped rule does NOT see an env-wide (null-org) seeded unit', async () => {
    // The reported reproduction, pinned as the behaviour 17.x ships: the
    // members are stamped and would pass the member screen, so the empty
    // answer is the UNIT screen's alone.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
  });

  it('the seed check and the subtree walk BOTH refuse the seeded rows', async () => {
    // `seedIsUsable` and the `descendants` BFS are two separate reads through
    // the same screen. Pinning the BFS separately keeps a widening applied to
    // only one of them from passing as "unchanged".
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.descendants('bu_root')).toEqual([]);
  });

  it('`headOf` does not resolve the manager of a seeded unit either', async () => {
    // The third read through `orgScope`, pinned so the screen cannot be
    // widened at one call site while the other two stay strict.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: null, active: true, manager_user_id: 'u_head' },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, []),
      organizationId: 'org_a',
    });
    expect(await g.headOf('bu_root')).toBeNull();
  });

  it('an org-stamped unit IS visible — the screen is strict, not broken', async () => {
    // The control that separates "strict" from "refuses everything". Same
    // fixture shape as the seeded case above; only the unit's organization
    // moves, and that single change flips every read to visible.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: 'org_a', active: true, manager_user_id: 'u_head' },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: 'org_a', active: true },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect((await g.expandUsers('bu_root')).sort()).toEqual(['u_child', 'u_root']);
    expect(await g.expandUnitMembers('bu_root')).toEqual(['u_root']);
    expect((await g.descendants('bu_root')).sort()).toEqual(['bu_child', 'bu_root']);
    expect(await g.headOf('bu_root')).toBe('u_head');
  });

  it('another org’s unit is invisible too', async () => {
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

  it('an INACTIVE org-stamped unit still contributes nobody', async () => {
    // `active: false` is a hard filter independent of either screen — pinned
    // on a VISIBLE unit so the empty answer is the active flag's doing and
    // not the tenant screen answering first.
    const units: UnitRow[] = [
      { id: 'bu_root', organization_id: 'org_a', active: false },
      { id: 'bu_child', parent_business_unit_id: 'bu_root', organization_id: 'org_a', active: true },
    ];
    const g = new BusinessUnitGraphService({
      engine: makeEngine(units, STAMPED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
    expect(await g.expandUnitMembers('bu_root')).toEqual([]);
  });
});

/**
 * [#14949, KEPT] The MEMBER screen is STRICT.
 *
 * ⚠️ This is the SECURITY half of #14949 and it is NOT part of the ADR-0131 D8
 * revert. Both `sys_business_unit_member` reads used to carry no organization
 * predicate whatever — completely unscoped by organization — so an org-stamped
 * rule reaching any visible unit collected every tenant's membership rows off
 * it. `memberScope` closed that, and it stays closed.
 *
 * ⚠️ The anchor unit here is stamped with the rule's OWN organization, not
 * seeded. That is load-bearing: with the unit screen strict again, a seeded
 * (org-less) unit is invisible to an org-stamped rule, so a member assertion
 * written on one would be answered by the UNIT screen before the member read
 * ever ran — it would pass with `memberScope` deleted. Anchoring on a visible
 * unit is what keeps every assertion below a pin on the MEMBER screen.
 */
describe('BusinessUnitGraphService — the MEMBER screen (#14547)', () => {
  /**
   * One unit tree the rule's organization owns, with two tenants' membership
   * rows hanging off it — the shape an unscoped member read turns into a
   * cross-tenant over-grant. `sys_business_unit_member` is not
   * organization-stamped on every write path, so mixed tenancy on one visible
   * unit is a real deployment shape, not a contrived one.
   */
  const SHARED_SEED_UNITS: UnitRow[] = [
    { id: 'bu_market', organization_id: 'org_a', active: true },
    { id: 'bu_market_west', parent_business_unit_id: 'bu_market', organization_id: 'org_a', active: true },
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
    // NULL here fails CLOSED. The anchor unit is visible to the rule, so this
    // empty answer is the member screen's own — `SharingRuleService` warns
    // rather than staying silent about it.
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
    // The dominant shape today (declared rules bootstrap org-less). Neither
    // #14949 nor the ADR-0131 D8 revert of its unit half may change what a
    // platform-global rule expands to, in either direction.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SHARED_SEED_UNITS, TWO_TENANT_MEMBERS),
      organizationId: null,
    });
    expect((await g.expandUsers('bu_market')).sort()).toEqual([
      'u_a', 'u_a_west', 'u_b', 'u_b_west',
    ]);
  });
});
