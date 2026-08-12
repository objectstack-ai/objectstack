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

import { describe, it, expect, beforeEach } from 'vitest';
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
