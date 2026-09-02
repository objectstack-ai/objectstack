// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14547] A business-unit sharing rule against a SEEDED unit, end to end.
 *
 * `business-unit-graph.test.ts` pins the two screens at the graph service.
 * This file drives the whole rule path — `evaluateRule` → `expandRecipient` →
 * `reconcile` → `sys_record_share` — because that is the layer the defect was
 * reported at and the layer at which it was silent: the rule was accepted, it
 * stayed `active: true`, it materialised zero grants, and nothing was logged.
 * Asserting the graph's return value alone would leave every one of those
 * observable facts unpinned.
 *
 * The fixture is the reported reproduction's shape, not an invented one:
 *
 *   - `sys_business_unit` rows come from app SEED data and carry
 *     `organization_id = NULL` — a seed cannot know the id the runtime mints
 *     at boot;
 *   - `sys_business_unit_member` rows are POSTed through the REST data API and
 *     ARE organization-stamped (the engine threads the caller's tenant and the
 *     SQL driver stamps the injected column);
 *   - the `sys_sharing_rule` row is created by an organization admin and is
 *     org-stamped too (an explicit `organization_id: null` in the payload is
 *     overridden).
 *
 * Two of those three carry an organization and one does not, which is exactly
 * the combination the strict unit screen turned into zero grants.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
const ORG_A = 'org_a';
const ORG_B = 'org_b';

/**
 * Filter matcher over the operators this path actually emits.
 *
 * `organization_id: null` must match a row that OMITS the column, because that
 * is what a NULL column reads back as and the whole `$or` arm exists for it. A
 * fake that answered otherwise would report the widened screen as still broken
 * — or, worse, report a screen that never widened as fixed.
 */
function matches(row: Row, f: any): boolean {
  if (!f || typeof f !== 'object') return true;
  for (const [k, v] of Object.entries(f)) {
    if (k === '$or') {
      if (!(v as any[]).some((sub) => matches(row, sub))) return false;
      continue;
    }
    if (k === '$and') {
      if (!(v as any[]).every((sub) => matches(row, sub))) return false;
      continue;
    }
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    const rv = row[k];
    if (v === null) {
      if (rv != null) return false;
      continue;
    }
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
    // The PRODUCER's own dispatch predicates, so a fixture that drifts to a
    // call shape `ObjectQL` would refuse fails here instead of going green.
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

const RULE = 'kpi_sheet_to_market_unit';

describe('#14547 — an org-stamped rule against a SEEDED business unit', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;
  let warn: ReturnType<typeof vi.fn<(msg: any, ...rest: any[]) => void>>;

  /** Who currently holds a rule-materialised grant on `recordId`. */
  const granteesOf = (recordId: string): string[] =>
    (engine._tables.sys_record_share ?? [])
      .filter((r) => r.record_id === recordId && r.source === 'rule')
      .map((r) => String(r.recipient_id))
      .sort();

  /** The warn lines this run emitted, as one searchable string each. */
  const warnLines = (): string[] => warn.mock.calls.map((c) => String(c[0]));
  const emptyExpansionWarns = (): any[][] =>
    warn.mock.calls.filter((c) => String(c[0]).includes('expands to NO recipients'));

  beforeEach(() => {
    engine = makeEngine();
    warn = vi.fn();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } });

    // Seed data: units written before any organization existed.
    engine.seed('sys_business_unit', [
      { id: 'bu_market', name: 'Market', parent_business_unit_id: null, organization_id: null, active: true },
      { id: 'bu_market_west', name: 'Market West', parent_business_unit_id: 'bu_market', organization_id: null, active: true },
    ]);
    engine.seed('kpi_entry_sheet', [{ id: 'kpi_1', subject: 'bu_market', owner_id: 'author' }]);
  });

  /** Create the rule the reproduction created, org-stamped like a real one. */
  const seedRule = (recipientType: 'business_unit' | 'unit_and_subordinates', organizationId: string | null = ORG_A) => {
    engine.seed('sys_sharing_rule', [{
      id: 'srule_kpi', organization_id: organizationId, name: RULE,
      label: 'KPI sheet → Market', object_name: 'kpi_entry_sheet',
      criteria_json: JSON.stringify({ subject: 'bu_market' }),
      recipient_type: recipientType, recipient_id: 'bu_market',
      access_level: 'edit', active: true, managed_by: 'package',
    }]);
  };

  describe('the reported defect: 201, active, zero shares, no log', () => {
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
      expect(emptyExpansionWarns()).toHaveLength(0);
    });

    it('NARROW — `business_unit` materialises the anchor unit only', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
        { id: 'bum_2', business_unit_id: 'bu_market_west', user_id: 'u_2', organization_id: ORG_A },
      ]);
      seedRule('business_unit');
      await rules.evaluateRule(RULE, SYS);
      // The two widths stay two widths (#7807) — the tenant screen moved, the
      // subtree boundary did not.
      expect(granteesOf('kpi_1')).toEqual(['u_1']);
    });
  });

  describe('the leak the same change would have opened', () => {
    it('another organization’s members are never granted through the shared seeded unit', async () => {
      // ONE seeded unit id, two tenants' memberships hanging off it — the
      // shape that exists on any deployment whose org chart came from a seed.
      engine.seed('sys_business_unit_member', [
        { id: 'bum_a', business_unit_id: 'bu_market', user_id: 'u_a', organization_id: ORG_A },
        { id: 'bum_b', business_unit_id: 'bu_market', user_id: 'u_b', organization_id: ORG_B },
      ]);
      seedRule('unit_and_subordinates', ORG_A);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_a']);
      expect(granteesOf('kpi_1')).not.toContain('u_b');
    });
  });

  describe('an active rule that grants nobody is LOUD', () => {
    it('warns naming the rule, the recipient kind and the unit', async () => {
      // Unit and memberships BOTH seeded: the unit resolves now, but org-less
      // membership rows are of unknown tenancy and are not members of an
      // org-stamped rule. The residual empty expansion is the case this warn
      // exists for.
      engine.seed('sys_business_unit_member', [
        { id: 'bum_seeded', business_unit_id: 'bu_market', user_id: 'u_seeded' },
      ]);
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);

      expect(granteesOf('kpi_1')).toEqual([]);
      const calls = emptyExpansionWarns();
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
      expect(emptyExpansionWarns()).toHaveLength(1);
      expect(emptyExpansionWarns()[0][1]).toMatchObject({ recipientType: 'business_unit' });
    });

    it('warns ONCE per rule per process, not once per evaluation', async () => {
      // The reconcilers call `expandRecipient` on every matched write. Without
      // the dedup one misconfigured rule dominates the deployment's log —
      // the same reasoning the inert-criteria warn already carries.
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);
      await rules.evaluateRule(RULE, SYS);
      await rules.evaluateRule(RULE, SYS);
      expect(emptyExpansionWarns()).toHaveLength(1);
      expect(rules.emptyUnitExpansionRuleKeys).toEqual(['srule_kpi::bu_market']);
    });

    it('says nothing when the rule grants somebody', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
      ]);
      seedRule('unit_and_subordinates');
      await rules.evaluateRule(RULE, SYS);
      expect(warnLines().join('\n')).not.toContain('expands to NO recipients');
      expect(rules.emptyUnitExpansionRuleKeys).toEqual([]);
    });

    it('an INACTIVE rule is not warned about — it is meant to grant nobody', async () => {
      engine.seed('sys_sharing_rule', [{
        id: 'srule_off', organization_id: ORG_A, name: 'off_rule',
        label: 'Off', object_name: 'kpi_entry_sheet',
        criteria_json: JSON.stringify({ subject: 'bu_market' }),
        recipient_type: 'unit_and_subordinates', recipient_id: 'bu_market',
        access_level: 'edit', active: false, managed_by: 'package',
      }]);
      await rules.evaluateRule('off_rule', SYS);
      expect(emptyExpansionWarns()).toHaveLength(0);
    });
  });

  describe('the org-less rule — the dominant shape today — is unmoved', () => {
    it('still expands every member of the seeded tree, stamped or not', async () => {
      engine.seed('sys_business_unit_member', [
        { id: 'bum_1', business_unit_id: 'bu_market', user_id: 'u_1', organization_id: ORG_A },
        { id: 'bum_2', business_unit_id: 'bu_market_west', user_id: 'u_2' },
      ]);
      seedRule('unit_and_subordinates', null);
      await rules.evaluateRule(RULE, SYS);
      expect(granteesOf('kpi_1')).toEqual(['u_1', 'u_2']);
    });
  });
});
