// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7807] `business_unit` vs `unit_and_subordinates` — two DECLARED widths,
 * pinned as two ENFORCED widths.
 *
 * The defect: `SharingRuleService.expandRecipient` routed both recipient kinds
 * through the identical `BusinessUnitGraphService.expandUsers` call, whose
 * first act is a `descendants()` BFS. So a rule authored as `business_unit` —
 * declared by `ShareRecipientType`, by the lint red-line table and by
 * ADR-0057 D5 as "exactly one business unit's members (no subtree)" — in fact
 * reached that unit **plus every descendant unit's members**. An over-grant,
 * and one that made `unit_and_subordinates` (the "strictly WIDER grant" of the
 * pair) not wider at all.
 *
 * Maintainer ruling 2026-08-12, direction 1: narrow the runtime to match the
 * declaration. The two kinds stay two kinds; neither is retired.
 *
 * ## Why this file asserts a PAIR, not a fix
 *
 * "`business_unit` got narrower" is only half the evidence. A change that
 * narrowed BOTH kinds satisfies that half completely while destroying the
 * distinction the ruling exists to preserve — so the wide kind is asserted on
 * the SAME tree, the SAME fixture and the SAME call, as a control. Each
 * `describe` below names which width it guards, so a regression in either
 * direction fails as the width it actually broke.
 *
 * ## Why three levels
 *
 * A division ⊃ department ⊃ office tree is the floor. On a two-level fixture
 * "exactly one unit" and "unit plus its children" can agree by accident, and
 * the pin cannot tell the fixed behaviour from the defect it was written for.
 * The narrow assertions therefore exclude the DIRECT child as well as the
 * grandchild.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;

const NARROW_RULE = 'share_note_with_division_only';
const WIDE_RULE = 'share_note_with_division_subtree';

function matches(row: Row, f: any): boolean {
  if (!f || typeof f !== 'object') return true;
  // A combinator is CONJOINED with its sibling field keys, never a
  // short-circuit that returns before they are read (#7676): `listRules`
  // composes `{object_name, active, $or:[…org scope…]}`, and a matcher that
  // returned on the `$or` alone would match the whole table here while
  // driver-sql and driver-memory conjoin the two. A fake looser than the
  // contract it stands in for is how a green suite ships a broken filter.
  if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
  if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or' || k === '$and') continue;
    const rv = row[k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const op: any = v;
      if ('$in' in op) { if (!op.$in.includes(rv)) return false; continue; }
      // `descendants()` filters children with `active: { $ne: false }`, so an
      // undefined `active` must PASS — the graph treats absent as active.
      if ('$ne' in op) { if (rv === op.$ne) return false; continue; }
      if ('$gte' in op) { if (!(rv >= op.$gte)) return false; continue; }
    }
    if (rv !== v) return false;
  }
  return true;
}

function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const ensure = (n: string) => (tables[n] ??= []);
  let seq = 0;
  return {
    _tables: tables,
    getSchema() { return undefined; },
    seed(object: string, rows: Row[]) { ensure(object).push(...rows.map((r) => ({ ...r }))); },
    async find(o: string, opts?: any) {
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) {
      const row = { id: data.id ?? `${o}_${++seq}`, ...data };
      ensure(o).push(row);
      return row;
    },
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (#4550 / #5480 / #6277) rather than a hand-mirrored guard, so a fixture
    // that drifts to a call shape `ObjectQL` would refuse fails loudly here
    // instead of collecting a green from a check that never ran.
    async update(o: string, data: any, options?: any) {
      const verdict = assertEngineUpdateDispatch(data, options);
      const t = ensure(o);
      const targets = verdict.kind === 'by-id'
        ? t.filter((r) => r.id === verdict.id)
        : t.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return verdict.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(o: string, opts?: any) {
      assertEngineDeleteDispatch(opts);
      const t = ensure(o);
      const where = opts?.where ?? (opts?.id != null ? { id: opts.id } : {});
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
  };
}

describe('#7807 recipient width — business_unit vs unit_and_subordinates', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  /** Who currently holds a rule-materialised grant on `recordId`. */
  const granteesOf = (recordId: string): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule')
      .map((r) => String(r.recipient_id))
      .sort();

  beforeEach(async () => {
    engine = makeEngine();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });

    // Three levels: division ⊃ department ⊃ office, one member each, plus a
    // unit OUTSIDE the division entirely so "narrow" cannot pass merely by
    // granting nobody beyond the tree.
    engine.seed('sys_business_unit', [
      { id: 'bu_div', name: 'Division', parent_business_unit_id: null, active: true },
      { id: 'bu_dept', name: 'Department', parent_business_unit_id: 'bu_div', active: true },
      { id: 'bu_office', name: 'Office', parent_business_unit_id: 'bu_dept', active: true },
      { id: 'bu_other', name: 'Elsewhere', parent_business_unit_id: null, active: true },
    ]);
    engine.seed('sys_business_unit_member', [
      { id: 'bum_div', business_unit_id: 'bu_div', user_id: 'u_div' },
      { id: 'bum_dept', business_unit_id: 'bu_dept', user_id: 'u_dept' },
      { id: 'bum_office', business_unit_id: 'bu_office', user_id: 'u_office' },
      { id: 'bum_other', business_unit_id: 'bu_other', user_id: 'u_other' },
    ]);

    // Two records so the two rules cannot grant into each other's result.
    engine.seed('showcase_private_note', [
      { id: 'note_narrow', tag: 'narrow', owner_id: 'author' },
      { id: 'note_wide', tag: 'wide', owner_id: 'author' },
    ]);

    // The SAME anchor unit for both rules — the whole point of the pair.
    engine.seed('sys_sharing_rule', [
      {
        id: 'srule_narrow', organization_id: null, name: NARROW_RULE,
        label: 'Note → Division only', object_name: 'showcase_private_note',
        criteria_json: JSON.stringify({ tag: 'narrow' }),
        recipient_type: 'business_unit', recipient_id: 'bu_div',
        access_level: 'read', active: true, managed_by: 'package',
      },
      {
        id: 'srule_wide', organization_id: null, name: WIDE_RULE,
        label: 'Note → Division subtree', object_name: 'showcase_private_note',
        criteria_json: JSON.stringify({ tag: 'wide' }),
        recipient_type: 'unit_and_subordinates', recipient_id: 'bu_div',
        access_level: 'read', active: true, managed_by: 'package',
      },
    ]);

    await rules.evaluateRule(NARROW_RULE, SYS);
    await rules.evaluateRule(WIDE_RULE, SYS);
  });

  describe('NARROW — `business_unit` reaches exactly one unit', () => {
    it('grants the anchor unit\'s own members', () => {
      expect(granteesOf('note_narrow')).toEqual(['u_div']);
    });

    it('does NOT reach the direct child unit (the over-grant this closed)', () => {
      expect(granteesOf('note_narrow')).not.toContain('u_dept');
    });

    it('does NOT reach the grandchild unit either', () => {
      expect(granteesOf('note_narrow')).not.toContain('u_office');
    });

    it('never reached outside the tree, before or after', () => {
      expect(granteesOf('note_narrow')).not.toContain('u_other');
    });
  });

  describe('WIDE — `unit_and_subordinates` still reaches the whole subtree (control)', () => {
    it('grants the anchor unit AND every descendant unit, three levels down', () => {
      expect(granteesOf('note_wide')).toEqual(['u_dept', 'u_div', 'u_office']);
    });

    it('stops at the tree boundary', () => {
      expect(granteesOf('note_wide')).not.toContain('u_other');
    });
  });

  describe('the pair, stated as one fact', () => {
    it('the wider kind is STRICTLY wider — same anchor, same tree, same pass', () => {
      const narrow = granteesOf('note_narrow');
      const wide = granteesOf('note_wide');
      // Strictly wider: narrow ⊂ wide, and the containment is proper.
      expect(narrow.every((u) => wide.includes(u))).toBe(true);
      expect(wide.length).toBeGreaterThan(narrow.length);
    });
  });

  describe('the narrowing rides the RECONCILE path too, not just first materialisation', () => {
    it('re-running the narrow rule keeps it narrow (no drift back to the subtree)', async () => {
      await rules.evaluateRule(NARROW_RULE, SYS);
      expect(granteesOf('note_narrow')).toEqual(['u_div']);
    });

    it('a member joining a DESCENDANT unit does not widen the narrow rule', async () => {
      await engine.insert('sys_business_unit_member', {
        id: 'bum_late', business_unit_id: 'bu_dept', user_id: 'u_late',
      });
      await rules.evaluateRule(NARROW_RULE, SYS);
      expect(granteesOf('note_narrow')).toEqual(['u_div']);

      // …and the same join DOES widen the subtree rule, which is what proves
      // the fixture is capable of expressing the difference at all.
      await rules.evaluateRule(WIDE_RULE, SYS);
      expect(granteesOf('note_wide')).toContain('u_late');
    });

    it('a member joining the ANCHOR unit widens the narrow rule (it is not simply frozen)', async () => {
      await engine.insert('sys_business_unit_member', {
        id: 'bum_div2', business_unit_id: 'bu_div', user_id: 'u_div2',
      });
      await rules.evaluateRule(NARROW_RULE, SYS);
      expect(granteesOf('note_narrow')).toEqual(['u_div', 'u_div2']);
    });

    it('re-parenting a descendant OUT never mattered to the narrow rule', async () => {
      await engine.update('sys_business_unit', { id: 'bu_dept', parent_business_unit_id: 'bu_other' });
      await rules.evaluateRule(NARROW_RULE, SYS);
      expect(granteesOf('note_narrow')).toEqual(['u_div']);

      // The wide rule loses the moved subtree — the control moving under the
      // same write, which is how we know the write took effect at all.
      await rules.evaluateRule(WIDE_RULE, SYS);
      expect(granteesOf('note_wide')).toEqual(['u_div']);
    });
  });

  describe('an inactive anchor grants nobody under either width', () => {
    it('narrow: an inactive unit contributes no members', async () => {
      await engine.update('sys_business_unit', { id: 'bu_div', active: false });
      await rules.evaluateRule(NARROW_RULE, SYS);
      expect(granteesOf('note_narrow')).toEqual([]);
    });

    it('wide: an inactive seed still blanks the whole subtree', async () => {
      await engine.update('sys_business_unit', { id: 'bu_div', active: false });
      await rules.evaluateRule(WIDE_RULE, SYS);
      expect(granteesOf('note_wide')).toEqual([]);
    });
  });
});

/**
 * [#14547] The same two widths, now against a SEEDED business unit — driven
 * end to end so the observables the report named are the observables asserted.
 *
 * `business-unit-graph.test.ts` pins the two screens at the graph service.
 * This block drives the whole rule path — `evaluateRule` → `expandRecipient`
 * → `reconcile` → `sys_record_share` — because that is the layer the defect
 * was reported at and the layer at which it was silent: the rule was accepted
 * (201), it stayed `active: true`, it materialised zero grants, and nothing
 * was logged. Asserting the graph's return value alone leaves every one of
 * those facts unpinned.
 *
 * The fixture is the reported reproduction's shape, not an invented one, and
 * its three rows carry three DIFFERENT tenancy facts — which is the whole
 * reason the defect existed:
 *
 *   - `sys_business_unit` comes from app SEED data and carries
 *     `organization_id = NULL` — a seed cannot know the id the runtime mints
 *     at boot;
 *   - `sys_business_unit_member` is POSTed through the REST data API and IS
 *     organization-stamped (the engine threads the caller's tenant and
 *     `SqlDriver.injectTenantOnInsert` fills the injected column);
 *   - `sys_sharing_rule` is created by an organization admin and is
 *     org-stamped too (an explicit `organization_id: null` in the payload is
 *     overridden).
 *
 * ⚠️ The security half lives in its own `describe` below and is NOT a
 * corollary of the functional half: a change that expands the right members
 * while also expanding another organization's members passes every functional
 * assertion here.
 */
describe('#14547 — an org-stamped rule against a SEEDED business unit', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;
  let warn: ReturnType<typeof vi.fn>;

  const ORG_A = 'org_a';
  const ORG_B = 'org_b';
  const RULE = 'kpi_sheet_to_market_unit';

  /** Who currently holds a rule-materialised grant on `recordId`. */
  const granteesOf = (recordId: string): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule')
      .map((r) => String(r.recipient_id))
      .sort();

  /** The empty-expansion warn calls this run emitted. */
  const emptyWarns = (): any[][] =>
    warn.mock.calls.filter((c) => String(c[0]).includes('expands to NO recipients'));

  /** Create the rule the reproduction created, org-stamped like a real one. */
  const seedRule = (
    recipientType: 'business_unit' | 'unit_and_subordinates',
    organizationId: string | null = ORG_A,
  ) => {
    engine.seed('sys_sharing_rule', [{
      id: 'srule_kpi', organization_id: organizationId, name: RULE,
      label: 'KPI sheet → Market', object_name: 'kpi_entry_sheet',
      criteria_json: JSON.stringify({ subject: 'bu_market' }),
      recipient_type: recipientType, recipient_id: 'bu_market',
      access_level: 'edit', active: true, managed_by: 'package',
    }]);
  };

  beforeEach(() => {
    engine = makeEngine();
    warn = vi.fn();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } as any });

    // Seed data: units written before any organization existed. The column is
    // spelled explicitly — a NULL column, not an absent key, is what the
    // widened `$or` arm has to match.
    engine.seed('sys_business_unit', [
      { id: 'bu_market', name: 'Market', parent_business_unit_id: null, organization_id: null, active: true },
      { id: 'bu_market_west', name: 'Market West', parent_business_unit_id: 'bu_market', organization_id: null, active: true },
    ]);
    engine.seed('kpi_entry_sheet', [{ id: 'kpi_1', subject: 'bu_market', owner_id: 'author' }]);
  });

  describe('the reported defect — 201, active, zero shares, no log', () => {
    it('WIDE — `unit_and_subordinates` now materialises the grants', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
        { id: 'bum_2', business_unit_id: 'bu_market_west', user_id: 'u_2', organization_id: ORG_A },
      ]);
      seedRule('unit_and_subordinates');
      const result = await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_1', 'u_2']);
      expect(result.expandedUsers).toBe(2);
      // …and it did so QUIETLY: the new warn is for the empty case only.
      expect(emptyWarns()).toHaveLength(0);
    });

    it('NARROW — `business_unit` materialises the anchor unit only', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
        { id: 'bum_2', business_unit_id: 'bu_market_west', user_id: 'u_2', organization_id: ORG_A },
      ]);
      seedRule('business_unit');
      await rules.evaluateRule(RULE, SYS);
      // The two widths stay two widths (#7807): the tenant screen moved, the
      // subtree boundary did not.
      expect(granteesOf('kpi_1')).toEqual(['u_1']);
    });
  });

  describe('⚠️ the leak the unit widening would otherwise have opened', () => {
    /**
     * ONE seeded unit id, two tenants' memberships hanging off it — the shape
     * that exists on any deployment whose org chart came from a seed, and the
     * one the widened unit screen makes reachable for the first time.
     */
    const twoTenantMembers = () => [
      { id: 'bum_a', business_unit_id: 'bu_market', user_id: 'u_a', organization_id: ORG_A },
      { id: 'bum_b', business_unit_id: 'bu_market', user_id: 'u_b', organization_id: ORG_B },
      { id: 'bum_aw', business_unit_id: 'bu_market_west', user_id: 'u_a_west', organization_id: ORG_A },
      { id: 'bum_bw', business_unit_id: 'bu_market_west', user_id: 'u_b_west', organization_id: ORG_B },
    ];

    it('WIDE — no `sys_record_share` row is ever materialised for another org’s member', async () => {
      engine.seed('sys_business_unit_member', twoTenantMembers());
      seedRule('unit_and_subordinates', ORG_A);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_a', 'u_a_west']);
      expect(granteesOf('kpi_1')).not.toContain('u_b');
      expect(granteesOf('kpi_1')).not.toContain('u_b_west');
    });

    it('NARROW — the single-unit width does not cross either', async () => {
      engine.seed('sys_business_unit_member', twoTenantMembers());
      seedRule('business_unit', ORG_A);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_a']);
    });

    it('an org-LESS membership row is not admitted to an org-stamped rule', async () => {
      // Unknown tenancy, not platform-global: `sys_business_unit_member` is
      // NOT organization-stamped by seed replay or by an elevated system
      // write, so a NULL here cannot be read the way a NULL on the UNIT row
      // is read. The grant fails closed.
      engine.seed('sys_business_unit_member', [
        { id: 'bum_ok', business_unit_id: 'bu_market', user_id: 'u_ok', organization_id: ORG_A },
        { id: 'bum_seeded', business_unit_id: 'bu_market', user_id: 'u_seeded', organization_id: null },
      ]);
      seedRule('unit_and_subordinates', ORG_A);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_ok']);
    });
  });

  describe('an active rule that grants nobody is LOUD', () => {
    it('warns naming the rule, the object, the recipient kind, the unit and the org', async () => {
      // Unit AND memberships both seeded: the unit resolves now, but org-less
      // membership rows are of unknown tenancy. This residual empty expansion
      // is the case the warn exists for — it used to be completely silent.
      engine.seed('sys_business_unit_member', [
        { id: 'bum_seeded', business_unit_id: 'bu_market', user_id: 'u_seeded', organization_id: null },
      ]);
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);

      expect(granteesOf('kpi_1')).toEqual([]);
      const calls = emptyWarns();
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain('organization_id');
      expect(calls[0][1]).toMatchObject({
        rule: RULE,
        object: 'kpi_entry_sheet',
        recipientType: 'unit_and_subordinates',
        businessUnit: 'bu_market',
        organization: ORG_A,
      });
    });

    it('warns for the NARROW width too', async () => {
      seedRule('business_unit');
      await rules.evaluateRule(RULE, SYS);
      expect(emptyWarns()).toHaveLength(1);
      expect(emptyWarns()[0][1]).toMatchObject({ recipientType: 'business_unit' });
    });

    it('warns ONCE per rule per process, not once per evaluation', async () => {
      // The reconcilers call `expandRecipient` on every matched write. Without
      // the dedup one misconfigured rule dominates the deployment's log — the
      // same reasoning the inert-criteria warn already carries.
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);
      await rules.evaluateRule(RULE, SYS);
      await rules.evaluateRule(RULE, SYS);
      expect(emptyWarns()).toHaveLength(1);
    });

    it('says nothing when the rule grants somebody', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
      ]);
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);
      expect(emptyWarns()).toHaveLength(0);
    });

    it('an INACTIVE rule is not warned about — it is meant to grant nobody', async () => {
      // `evaluateRule` short-circuits an inactive rule before `expandRecipient`
      // runs at all; the guard inside the warn covers the reconciler paths that
      // reach the expansion directly. Both roads lead here, so this asserts the
      // observable rather than which of the two answered.
      engine.seed('sys_sharing_rule', [{
        id: 'srule_off', organization_id: ORG_A, name: 'off_rule',
        label: 'Off', object_name: 'kpi_entry_sheet',
        criteria_json: JSON.stringify({ subject: 'bu_market' }),
        recipient_type: 'unit_and_subordinates', recipient_id: 'bu_market',
        access_level: 'edit', active: false, managed_by: 'package',
      }]);
      await rules.evaluateRule('off_rule', SYS);
      expect(emptyWarns()).toHaveLength(0);
    });
  });

  describe('the org-LESS rule — the dominant shape today — is unmoved', () => {
    it('still expands every member of the seeded tree, stamped or not', async () => {
      // A platform-global rule threads no organization, so BOTH screens are
      // no-ops for it, exactly as before #14547. Pinned in both directions so
      // the change cannot silently retire the declared cross-tenant behaviour
      // of a null-org rule.
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
        { id: 'bum_2', business_unit_id: 'bu_market_west', user_id: 'u_2', organization_id: null },
      ]);
      seedRule('unit_and_subordinates', null);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_1', 'u_2']);
    });
  });
});
