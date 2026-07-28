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
 * It is NOT reachable today: every materialized `sys_sharing_rule` row carries
 * `organization_id = null` (verified on a live showcase stack), so
 * `expandRecipient` passes `null` and `orgScope` is skipped entirely. The
 * moment rules start carrying an org — a multi-tenant deployment — a BU
 * subtree rule against a seeded unit stops granting, and the symptom is
 * "the right people cannot see the record", which is far quieter than a stuck
 * approval.
 *
 * So this file locks BOTH sides down:
 *   - the reachable paths (null-org rule) keep working, and
 *   - the divergence from approvals is written down as an executable fact
 *     rather than a comment, so flipping it is a deliberate edit to a named
 *     test and never a silent behaviour change.
 *
 * If the platform decides null-org means "env-wide, visible to every org" for
 * sharing too — the way `plugin-approvals` and `sys_metadata` already read it —
 * the test named `[divergence]` below is the one to flip, and `orgScope` grows
 * the same `$or: [{ organization_id }, { organization_id: null }]` predicate.
 */

import { describe, it, expect } from 'vitest';
import { BusinessUnitGraphService } from './business-unit-graph.js';

interface UnitRow {
  id: string;
  parent_business_unit_id?: string | null;
  organization_id?: string | null;
  active?: boolean;
}
interface MemberRow { business_unit_id: string; user_id: string }

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

  it('[divergence] an org-scoped rule does NOT see an env-wide (null-org) unit — approvals does (#3807)', async () => {
    // Same inputs that #3807 fixed on the approvals side. Sharing still reads
    // a null-org unit as "belongs to no org, therefore not mine" and grants
    // nobody. Unreachable today (rules are null-org), deliberate until the
    // platform rules on null-org semantics for AUTHORIZATION paths — widening
    // who can SEE a record is not a change to make on a defect that cannot
    // currently fire.
    const g = new BusinessUnitGraphService({
      engine: makeEngine(SEEDED_UNITS, SEEDED_MEMBERS),
      organizationId: 'org_a',
    });
    expect(await g.expandUsers('bu_root')).toEqual([]);
  });
});
