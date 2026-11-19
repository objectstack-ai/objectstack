// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { celEngine } from '@objectstack/formula';
import {
  IndexSchema,
  ObjectSchema,
  ORGANIZATION_UNIT_CODE_PATTERN,
  STANDARD_UNITS,
  UNIT_DIMENSIONS,
  apiExposureDenialReason,
  resolveCrudAffordances,
  resolveInjectedSystemColumns,
} from '@objectstack/spec/data';
import {
  SysUnit,
  UNIT_DECIMAL_PLACES_MAX,
  UNIT_RATIO_DIRECTION,
  UNIT_RATIO_EDIT_NOTICE,
  UNIT_RATIO_PRECISION,
  UNIT_RATIO_SCALE,
} from './sys-unit.object.js';
import { SETUP_NAV_CONTRIBUTIONS } from '../apps/setup-nav.contributions.js';
import { PlatformObjectsPlugin } from '../plugin.js';

/**
 * ADR-0158 U3: `sys_unit`'s declaration, with its Open items 2 (owner, fields,
 * grants) and 11 (a deleted code stays retired) as this package settles them.
 *
 * Like `sys_exchange_rate`'s suite, the facts decided by a mechanism that
 * lives elsewhere — the organization-scoped unique key (driver-sql), the
 * Layer 0 tenant wall (ADR-0095 D1), the grants (plugin-security's
 * `default-permission-sets.ts`, whose real-stack suite
 * `default-permission-sets.unit-of-measure.integration.test.ts` drives this
 * object), the audit writer — are pinned here as the DECLARATION each
 * mechanism reads, asserted on the built value. The rules are EVALUATED: the
 * format rule's regex through `RegExp`, the predicates through the canonical
 * CEL engine (`@objectstack/formula`) in the scope the rule validator binds
 * (`record`, and `previous`: null on insert, the prior row on update).
 */
describe('sys_unit — declaration (ADR-0158 U3)', () => {
  const fields = SysUnit.fields as Record<string, any>;
  const rules = (SysUnit.validations ?? []) as Array<Record<string, any>>;
  const rule = (name: string): Record<string, any> => {
    const found = rules.find((r) => r.name === name);
    if (!found) throw new Error(`no rule ${name}`);
    return found;
  };

  it('parses as an ObjectSchema', () => {
    expect(() => ObjectSchema.parse(SysUnit)).not.toThrow();
  });

  it('carries exactly the settled columns (Open item 2)', () => {
    expect(Object.keys(fields).sort()).toEqual(['code', 'decimal_places', 'dimension', 'id', 'label', 'ratio', 'retired']);
    for (const name of ['code', 'label', 'dimension']) expect(fields[name].required, name).toBe(true);
    // The ratio is required by dimension (the rules below), never by the column.
    for (const name of ['ratio', 'decimal_places', 'retired']) expect(fields[name].required, name).toBeFalsy();
  });

  it('is labelled a unit of measure, never a bare "unit" beside the business units', () => {
    expect(SysUnit.label).toBe('Unit of Measure');
    expect(SysUnit.pluralLabel).toBe('Units of Measure');
  });

  describe('uniqueness', () => {
    const uniqueIndexes = (SysUnit.indexes ?? []).filter((i: any) => i.unique);

    it("declares exactly one unique key, on code, scoped 'organization'", () => {
      expect(uniqueIndexes).toHaveLength(1);
      expect((uniqueIndexes[0] as any).fields).toEqual(['code']);
      expect((uniqueIndexes[0] as any).unique).toBe('organization');
      expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({ unique: 'organization' });
    });
  });

  describe('tenant isolation (U3)', () => {
    it('takes no tenancy opt-out, so organization_id is injected and the tenant wall scopes it', () => {
      const plan = resolveInjectedSystemColumns(SysUnit);
      expect((SysUnit as any).tenancy).toBeUndefined();
      expect((SysUnit as any).systemFields?.tenant).not.toBe(false);
      expect(plan.tenant).toBe(true);
      expect(plan.names.has('organization_id')).toBe(true);
    });
  });

  describe('zero platform rows (U3)', () => {
    it('ships no record: the manifest that registers it carries no data', async () => {
      const manifests: any[] = [];
      const services: Record<string, unknown> = { manifest: { register: (m: any) => manifests.push(m) } };
      const ctx = {
        getService: (n: string) => services[n],
        registerService: (n: string, s: unknown) => { services[n] = s; },
        hook: () => {},
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      };
      await new PlatformObjectsPlugin().init(ctx as any);
      const owner = manifests.find((m) => (m.objects ?? []).some((o: any) => o.name === 'sys_unit'));
      expect(owner).toBeDefined();
      // No manifest this plugin registers seeds a row of it.
      for (const m of manifests) {
        for (const entry of (m.data ?? []) as Array<{ object?: string }>) expect(entry.object, m.id).not.toBe('sys_unit');
      }
      expect(owner.data ?? []).toEqual([]);
    });
  });

  describe('who writes (Open item 2)', () => {
    it('stays reachable by the organization admin wildcard grant: not private, no extra capability gate', () => {
      expect((SysUnit as any).access?.default).not.toBe('private');
      expect((SysUnit as any).requiredPermissions).toBeUndefined();
      expect(SysUnit.managedBy).toBe('system-data');
    });

    it('offers New and Edit, and no Delete: retiring is the delete (Open item 11)', () => {
      const affordances = resolveCrudAffordances(SysUnit as any);
      expect(SysUnit.userActions).toEqual({ delete: false });
      expect(affordances).toMatchObject({ create: true, edit: true, delete: false });
    });

    it('serves list, read, create and update on the data API, and refuses a delete or a bulk write there', () => {
      // `apiExposureDenialReason` is the function the REST door turns into its 405.
      expect(SysUnit.enable?.apiEnabled).toBe(true);
      expect(SysUnit.enable?.apiMethods).toEqual(['get', 'list', 'create', 'update']);
      for (const op of ['get', 'list', 'create', 'update']) expect(apiExposureDenialReason(SysUnit.enable, op), op).toBeNull();
      for (const op of ['delete', 'bulk']) expect(apiExposureDenialReason(SysUnit.enable, op), op).toBe('method-not-allowed');
    });
  });

  describe('audit (L1)', () => {
    it('surfaces the History tab, with every authored column tracked', () => {
      expect(SysUnit.enable?.trackHistory).toBe(true);
      for (const name of ['code', 'label', 'dimension', 'ratio', 'decimal_places', 'retired']) {
        expect(fields[name].trackHistory, name).toBe(true);
      }
    });
  });

  describe('values', () => {
    it("dimension is the standard table's closed vocabulary, in its order", () => {
      expect(fields.dimension.type).toBe('select');
      expect(fields.dimension.options.map((o: any) => o.value)).toEqual([...UNIT_DIMENSIONS]);
    });

    it('ratio is an exact decimal, scale 12 and precision 24, strictly positive (U7 R2)', () => {
      expect(fields.ratio.type).toBe('number');
      expect(UNIT_RATIO_SCALE).toBe(12);
      expect(UNIT_RATIO_PRECISION).toBe(24);
      expect(fields.ratio.scale).toBe(UNIT_RATIO_SCALE);
      expect(fields.ratio.precision).toBe(UNIT_RATIO_PRECISION);
      expect(fields.ratio.min).toBe(10 ** -UNIT_RATIO_SCALE);
    });

    it('decimal_places is a whole number from 0 to 12, a display default only (U6, L4)', () => {
      expect(fields.decimal_places.type).toBe('number');
      expect(fields.decimal_places.scale).toBe(0);
      expect(fields.decimal_places.min).toBe(0);
      expect(fields.decimal_places.max).toBe(UNIT_DECIMAL_PLACES_MAX);
      expect(UNIT_DECIMAL_PLACES_MAX).toBe(12);
      expect(fields.decimal_places.defaultValue).toBeUndefined();
    });

    it('retired is a boolean defaulting to false', () => {
      expect(fields.retired.type).toBe('boolean');
      expect(fields.retired.defaultValue).toBe(false);
    });

    it('states the ratio direction and the edit notice on the field and on the Setup list page (L1)', () => {
      expect(UNIT_RATIO_DIRECTION).toMatch(/^1 of this unit = Ratio × the base unit of its dimension \(mass KGM, length MTR, area MTK, volume MTQ, time SEC, count H87\)/);
      expect(UNIT_RATIO_EDIT_NOTICE).toMatch(/affects only records saved afterwards/);
      expect(fields.ratio.description).toBe(`${UNIT_RATIO_DIRECTION} ${UNIT_RATIO_EDIT_NOTICE}`);
      expect((SysUnit.listViews as any).all_units.description).toBe(UNIT_RATIO_DIRECTION);
    });
  });

  describe('the organization code namespace (U3)', () => {
    const format = rule('unit_code_organization_namespace');
    const re = new RegExp(format.regex);

    it("is a format rule on code, spelled with the spec's one pattern", () => {
      expect(format).toMatchObject({ type: 'format', field: 'code', severity: 'error' });
      expect(format.regex).toBe(ORGANIZATION_UNIT_CODE_PATTERN);
      expect(fields.code.maxLength).toBe(32);
    });

    it('refuses every standard code, and every other short code with no underscore', () => {
      for (const code of [...Object.keys(STANDARD_UNITS), 'C62', 'EA', 'ABC', 'Q1']) expect(re.test(code), code).toBe(false);
    });

    it('refuses a code that is not exact uppercase', () => {
      for (const code of ['box_12', 'Box12', 'jin1']) expect(re.test(code), code).toBe(false);
    });

    it('admits an organization code: four characters or more, or one with an underscore', () => {
      for (const code of ['BOX_12', 'JIN1', 'BAG_25KG', 'P_1']) expect(re.test(code), code).toBe(true);
    });
  });

  /** The verdict of a rule predicate, or the fault spelled out so a faulting predicate fails loudly. */
  const violates = (name: string, record: Record<string, unknown>, previous: Record<string, unknown> | null): boolean | string => {
    const r = rule(name);
    const scope = previous === null ? { record, extra: { previous: null } } : { record, previous };
    // The built rule carries the lowered expression envelope; its CEL source is what the validator evaluates.
    const source = typeof r.condition === 'string' ? r.condition : r.condition?.source;
    if (typeof source !== 'string') throw new Error(`rule ${name} has no CEL source`);
    const out = celEngine.evaluate({ dialect: 'cel', source }, scope as any);
    if (!out.ok) return `FAULT ${out.error.message.split('\n')[0].trim()}`;
    return out.value as boolean;
  };
  const ROW = { code: 'BOX_12', label: 'Box of 12', dimension: 'count', ratio: 12, decimal_places: 0, retired: false };

  describe('code and dimension are immutable after create (L1)', () => {
    it('are update-only rules attached to the field they guard', () => {
      expect(rule('unit_code_immutable')).toMatchObject({ type: 'cross_field', events: ['update'], fields: ['code'], severity: 'error' });
      expect(rule('unit_dimension_immutable')).toMatchObject({ type: 'cross_field', events: ['update'], fields: ['dimension'], severity: 'error' });
    });

    it('refuse an update that changes the code or the dimension', () => {
      expect(violates('unit_code_immutable', { ...ROW, code: 'BOX_24' }, ROW)).toBe(true);
      expect(violates('unit_dimension_immutable', { ...ROW, dimension: 'package', ratio: null }, ROW)).toBe(true);
    });

    it('admit an update that keeps them, a ratio edit included', () => {
      expect(violates('unit_code_immutable', { ...ROW, ratio: 10, label: 'Box' }, ROW)).toBe(false);
      expect(violates('unit_dimension_immutable', { ...ROW, ratio: 10 }, ROW)).toBe(false);
    });
  });

  describe('a ratio on every dimension but package, none on package (U1 shape)', () => {
    it('refuses a ratio dimension with no ratio, and a package unit with one', () => {
      expect(violates('unit_ratio_required', { ...ROW, ratio: null }, null)).toBe(true);
      expect(violates('unit_package_has_no_ratio', { ...ROW, dimension: 'package', ratio: 12 }, null)).toBe(true);
    });

    it('admits a ratio dimension with a ratio, and a package unit without one', () => {
      expect(violates('unit_ratio_required', ROW, null)).toBe(false);
      expect(violates('unit_package_has_no_ratio', ROW, null)).toBe(false);
      const pallet = { ...ROW, code: 'PALLET_EU', dimension: 'package', ratio: null };
      expect(violates('unit_ratio_required', pallet, null)).toBe(false);
      expect(violates('unit_package_has_no_ratio', pallet, null)).toBe(false);
    });

    it('attach the refusal to the ratio field, on insert and update', () => {
      for (const name of ['unit_ratio_required', 'unit_package_has_no_ratio']) {
        expect(rule(name)).toMatchObject({ type: 'cross_field', fields: ['ratio'], severity: 'error' });
        expect(rule(name).events ?? ['insert', 'update']).toEqual(['insert', 'update']);
      }
    });
  });

  describe('a retired unit stays retired (Open item 11)', () => {
    it('is an update-only rule attached to retired', () => {
      expect(rule('unit_retired_one_way')).toMatchObject({ type: 'cross_field', events: ['update'], fields: ['retired'], severity: 'error' });
    });

    it('refuses bringing a retired unit back, whichever way the flag is cleared', () => {
      const retired = { ...ROW, retired: true };
      expect(violates('unit_retired_one_way', { ...ROW, retired: false }, retired)).toBe(true);
      expect(violates('unit_retired_one_way', { ...ROW, retired: null }, retired)).toBe(true);
    });

    it('admits retiring, and editing a retired unit that stays retired', () => {
      expect(violates('unit_retired_one_way', { ...ROW, retired: true }, ROW)).toBe(false);
      const retired = { ...ROW, retired: true };
      expect(violates('unit_retired_one_way', { ...retired, label: 'Box (old)' }, retired)).toBe(false);
    });
  });

  describe('Setup', () => {
    const configuration = SETUP_NAV_CONTRIBUTIONS.find((c) => c.group === 'group_configuration');
    const items = (configuration?.items ?? []) as any[];

    it('lists the units directly under the exchange rates, opening the all-units view', () => {
      const at = items.findIndex((i) => i.id === 'nav_units_of_measure');
      expect(at).toBeGreaterThan(0);
      expect(items[at - 1].id).toBe('nav_exchange_rates');
      expect(items[at]).toMatchObject({ type: 'object', label: 'Units of Measure', objectName: 'sys_unit', viewName: 'all_units' });
      expect(items[at].requiredPermissions).toBeUndefined();
    });

    it('names a view the object declares', () => {
      const view = (SysUnit.listViews as any).all_units;
      expect(view.data).toEqual({ provider: 'object', object: 'sys_unit' });
      expect(view.columns).toEqual(['code', 'label', 'dimension', 'ratio', 'decimal_places', 'retired']);
      expect(view.emptyState?.title).toBeTruthy();
    });
  });
});
