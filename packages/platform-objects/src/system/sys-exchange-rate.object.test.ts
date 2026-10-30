// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  IndexSchema,
  ObjectSchema,
  resolveCrudAffordances,
  resolveInjectedSystemColumns,
} from '@objectstack/spec/data';
import { isValueDomainMember } from '@objectstack/spec/shared';
import {
  EXCHANGE_RATE_DIRECTION,
  EXCHANGE_RATE_PRECISION,
  EXCHANGE_RATE_SCALE,
  SysExchangeRate,
} from './sys-exchange-rate.object.js';
import { SETUP_NAV_CONTRIBUTIONS } from '../apps/setup-nav.contributions.js';

/**
 * Multi-currency M1-1 (epic #8345): `sys_exchange_rate`'s declaration.
 *
 * The four facts the card asks for — uniqueness, tenant isolation, who may
 * write, audit — are each decided by a mechanism that lives elsewhere and is
 * pinned there: the driver materializes an `'organization'` unique key
 * (`driver-sql` tenant-scoped declared-unique suite), the Layer 0 wall scopes
 * every tenant-columned object (ADR-0095 D1), `organization_admin`'s wildcard
 * reaches every object that is not `access.default: 'private'` while
 * `member_default` names no business object (plugin-security
 * `default-permission-sets.ts`), and the audit writer captures every object
 * not on its skip list (plugin-audit `AUDIT_EXCLUDED_OBJECTS`). What this
 * package owns is the DECLARATION each of those mechanisms reads, so that is
 * what is pinned here — asserted on the BUILT value, never on source text.
 */
describe('sys_exchange_rate — declaration (multi-currency M1-1)', () => {
  const fields = SysExchangeRate.fields as Record<string, any>;

  it('parses as an ObjectSchema', () => {
    expect(() => ObjectSchema.parse(SysExchangeRate)).not.toThrow();
  });

  it('carries exactly the ruled columns: currency, rate, effective_date, source', () => {
    expect(Object.keys(fields).sort()).toEqual(['currency', 'effective_date', 'id', 'rate', 'source']);
    for (const name of ['currency', 'rate', 'effective_date', 'source']) {
      expect(fields[name].required, name).toBe(true);
    }
  });

  describe('uniqueness', () => {
    const uniqueIndexes = (SysExchangeRate.indexes ?? []).filter((i: any) => i.unique);

    it('declares exactly one unique key, on (currency, effective_date)', () => {
      expect(uniqueIndexes).toHaveLength(1);
      expect((uniqueIndexes[0] as any).fields).toEqual(['currency', 'effective_date']);
    });

    it("spells its scope 'organization' — not bare `true`, which is the installation-wide `'global'`", () => {
      // Asserted by EQUALITY: a truthy check passes on the very spelling that
      // would let one organization's EUR row refuse another organization's.
      expect((uniqueIndexes[0] as any).unique).toBe('organization');
      expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({ unique: 'organization' });
    });
  });

  describe('tenant isolation', () => {
    it('takes no tenancy opt-out, so organization_id is injected and the key has a column to scope by', () => {
      const plan = resolveInjectedSystemColumns(SysExchangeRate);
      expect((SysExchangeRate as any).tenancy).toBeUndefined();
      expect((SysExchangeRate as any).systemFields?.tenant).not.toBe(false);
      expect(plan.tenant).toBe(true);
      expect(plan.names.has('organization_id')).toBe(true);
    });
  });

  describe('who writes', () => {
    it('stays reachable by the organization admin wildcard grant — not private, no extra capability gate', () => {
      // `access.default: 'private'` opts an object OUT of the `'*'` grant
      // organization admins hold; a `requiredPermissions` gate would demand a
      // capability `organization_admin` does not carry. Either one would
      // leave the rate table with no writer below platform admin.
      expect((SysExchangeRate as any).access?.default).not.toBe('private');
      expect((SysExchangeRate as any).requiredPermissions).toBeUndefined();
    });

    it('offers New / Edit / Delete to whoever holds the grant, and no CSV import until #27190 proves it', () => {
      const affordances = resolveCrudAffordances(SysExchangeRate as any);
      expect(SysExchangeRate.managedBy).toBe('system-data');
      expect(affordances).toMatchObject({ create: true, edit: true, delete: true, import: false });
    });

    it('exposes the generic data API, so Setup can list and write it', () => {
      expect(SysExchangeRate.enable?.apiEnabled).toBe(true);
      expect(SysExchangeRate.enable?.apiMethods).toBeUndefined();
    });
  });

  describe('audit', () => {
    it('surfaces the History tab, with every ruled column summarized', () => {
      expect(SysExchangeRate.enable?.trackHistory).toBe(true);
      for (const name of ['currency', 'rate', 'effective_date', 'source']) {
        expect(fields[name].trackHistory, name).toBe(true);
      }
    });
  });

  describe('values', () => {
    it('currency is an ISO 4217 code, checked on write by the value domain', () => {
      expect(fields.currency.type).toBe('text');
      expect(fields.currency.valueDomain).toBe('iso_4217_currency');
      // The predicate the write seam runs: a real code passes, a shape-valid
      // non-member and a lowercase spelling do not.
      expect(isValueDomainMember('iso_4217_currency', 'EUR')).toBe(true);
      expect(isValueDomainMember('iso_4217_currency', 'ZZZ')).toBe(false);
      expect(isValueDomainMember('iso_4217_currency', 'eur')).toBe(false);
    });

    it('rate is an exact decimal, scale 12 and precision 24, strictly positive', () => {
      // `number` takes the platform's exact-decimal column; ⛔ never `float`.
      // Parameter 4 = twelve digits after the point (ruling 6469382727).
      expect(fields.rate.type).toBe('number');
      expect(EXCHANGE_RATE_SCALE).toBe(12);
      expect(EXCHANGE_RATE_PRECISION).toBe(24);
      expect(fields.rate.scale).toBe(EXCHANGE_RATE_SCALE);
      expect(fields.rate.precision).toBe(EXCHANGE_RATE_PRECISION);
      expect(fields.rate.min).toBe(10 ** -EXCHANGE_RATE_SCALE);
    });

    it('effective_date is a date, and source is manual / import / app defaulting to manual', () => {
      expect(fields.effective_date.type).toBe('date');
      expect(fields.source.type).toBe('select');
      expect(fields.source.options.map((o: any) => o.value)).toEqual(['manual', 'import', 'app']);
      expect(fields.source.defaultValue).toBe('manual');
    });
  });

  describe('rate direction', () => {
    it('is one sentence, home → foreign, carried verbatim by the field and the Setup list page', () => {
      expect(EXCHANGE_RATE_DIRECTION).toMatch(/^1 unit of the organization's home currency/);
      expect(fields.rate.description).toBe(EXCHANGE_RATE_DIRECTION);
      expect((SysExchangeRate.listViews as any).all_rates.description).toBe(EXCHANGE_RATE_DIRECTION);
    });
  });

  describe('Setup', () => {
    const configuration = SETUP_NAV_CONTRIBUTIONS.find((c) => c.group === 'group_configuration');
    const items = (configuration?.items ?? []) as any[];

    it('lists the rates directly under Localization, opening the all-rates view', () => {
      const at = items.findIndex((i) => i.id === 'nav_exchange_rates');
      expect(at).toBeGreaterThan(0);
      expect(items[at - 1].id).toBe('nav_settings_localization');
      expect(items[at]).toMatchObject({
        type: 'object',
        objectName: 'sys_exchange_rate',
        viewName: 'all_rates',
      });
    });

    it('names a view the object declares, listing the four ruled columns', () => {
      const view = (SysExchangeRate.listViews as any).all_rates;
      expect(view.data).toEqual({ provider: 'object', object: 'sys_exchange_rate' });
      expect(view.columns).toEqual(['currency', 'rate', 'effective_date', 'source']);
      expect(view.emptyState?.title).toBeTruthy();
    });
  });
});
