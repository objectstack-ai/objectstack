// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { deriveFieldGroupLayout, readFieldGroupMembership, FIELD_GROUP_SYSTEM_FIELDS, AUDIT_PROVENANCE_FIELDS } from './field-group-layout';
import { ObjectSchema } from './object.zod';

describe('deriveFieldGroupLayout (ADR-0085 §5)', () => {
  const groupedDef = {
    name: 'account',
    fieldGroups: [
      { key: 'basic', label: '基本信息' },
      { key: 'finance', label: '财务', collapse: 'collapsed' },
      { key: 'unused', label: 'Empty group' },
    ],
    fields: {
      name: { label: 'Name', type: 'text', group: 'basic' },
      industry: { label: 'Industry', type: 'select', group: 'basic' },
      revenue: { label: 'Revenue', type: 'currency', group: 'finance' },
      website: { label: 'Website', type: 'url' },
      secret: { label: 'Secret', type: 'text', group: 'basic', hidden: true },
      created_at: { label: 'Created', type: 'datetime' },
      organization_id: { label: 'Org', type: 'text' },
    },
  };

  it('returns sections in declared order, drops empty declared groups', () => {
    const sections = deriveFieldGroupLayout(groupedDef)!;
    expect(sections.map((s) => s.key)).toEqual(['basic', 'finance', undefined]);
    expect(sections[0].label).toBe('基本信息');
    expect(sections[0].fields).toEqual(['name', 'industry']);
    expect(sections.some((s) => s.key === 'unused')).toBe(false);
  });

  it('passes collapse through and defaults it to none', () => {
    const sections = deriveFieldGroupLayout(groupedDef)!;
    expect(sections[0].collapse).toBe('none');
    expect(sections[1].collapse).toBe('collapsed');
  });

  it('honours the deprecated collapse aliases on un-normalized metadata', () => {
    const legacy = (extra: Record<string, unknown>) =>
      deriveFieldGroupLayout({
        fieldGroups: [{ key: 'g', label: 'G', ...extra }],
        fields: { a: { group: 'g' } },
      })![0].collapse;
    expect(legacy({ collapsible: true, collapsed: true })).toBe('collapsed');
    expect(legacy({ collapsible: true })).toBe('expanded');
    expect(legacy({ collapsible: false })).toBe('none');
    expect(legacy({ defaultExpanded: false })).toBe('collapsed');
    expect(legacy({ defaultExpanded: true })).toBe('expanded');
    // Canonical key wins over any alias.
    expect(legacy({ collapse: 'none', collapsed: true })).toBe('none');
  });

  it('collects ungrouped fields into a trailing untitled bucket, skipping system fields', () => {
    const sections = deriveFieldGroupLayout(groupedDef)!;
    const trailing = sections[sections.length - 1];
    expect(trailing.key).toBeUndefined();
    expect(trailing.label).toBeUndefined();
    expect(trailing.fields).toEqual(['website']);
    expect(FIELD_GROUP_SYSTEM_FIELDS.has('created_at')).toBe(true);
  });

  it('keeps system fields an author EXPLICITLY grouped', () => {
    const sections = deriveFieldGroupLayout({
      fieldGroups: [{ key: 'meta', label: 'Meta' }],
      fields: {
        title: { type: 'text' },
        created_at: { type: 'datetime', group: 'meta' },
      },
    })!;
    expect(sections[0].fields).toEqual(['created_at']);
  });

  it('skips hidden fields even when grouped', () => {
    const sections = deriveFieldGroupLayout(groupedDef)!;
    expect(sections.find((s) => s.key === 'basic')!.fields).not.toContain('secret');
  });

  it('carries icon and description through', () => {
    const sections = deriveFieldGroupLayout({
      fieldGroups: [{ key: 'g', label: 'G', icon: 'credit-card', description: 'Money things' }],
      fields: { a: { group: 'g' } },
    })!;
    expect(sections[0]).toMatchObject({ icon: 'credit-card', description: 'Money things' });
  });

  it('returns null when grouping does not apply', () => {
    // No fieldGroups at all.
    expect(deriveFieldGroupLayout({ fields: { a: {} } })).toBeNull();
    // Declared groups but no field references one.
    expect(
      deriveFieldGroupLayout({ fieldGroups: [{ key: 'g1', label: 'G1' }], fields: { a: {}, b: {} } }),
    ).toBeNull();
    // Malformed input.
    expect(deriveFieldGroupLayout(undefined)).toBeNull();
    expect(deriveFieldGroupLayout(null)).toBeNull();
    expect(deriveFieldGroupLayout('nope')).toBeNull();
    expect(deriveFieldGroupLayout([])).toBeNull();
  });

  it('ignores keyless / malformed group entries', () => {
    expect(
      deriveFieldGroupLayout({
        fieldGroups: [{ label: 'No key' }, null, 'junk'],
        fields: { a: { group: 'x' } },
      }),
    ).toBeNull();
  });

  it('defaults label to the group key', () => {
    const sections = deriveFieldGroupLayout({
      fieldGroups: [{ key: 'billing' }],
      fields: { amount: { group: 'billing' } },
    })!;
    expect(sections[0].label).toBe('billing');
  });

  // `visibleWhen` passthrough — the ADR-0049 re-introduction WITH enforcement:
  // the slot only exists because the renderer's section-gating contract now
  // evaluates it, and the derivation's whole job here is to CARRY it, verbatim,
  // in both the shapes real metadata arrives in.
  describe('visibleWhen passthrough (ADR-0085 §5 re-introduction)', () => {
    const derive = (group: Record<string, unknown>) =>
      deriveFieldGroupLayout({
        fieldGroups: [group],
        fields: { a: { group: 'g' } },
      })![0];

    it('carries a bare CEL string through verbatim (author / bare-DB form)', () => {
      expect(derive({ key: 'g', label: 'G', visibleWhen: "record.type == 'invoice'" }).visibleWhen)
        .toBe("record.type == 'invoice'");
    });

    it('carries an Expression envelope through verbatim (post-parse form)', () => {
      const envelope = { dialect: 'cel', source: "record.type == 'invoice'" };
      expect(derive({ key: 'g', label: 'G', visibleWhen: envelope }).visibleWhen).toBe(envelope);
    });

    it('omits the key entirely when the group declares no predicate', () => {
      expect('visibleWhen' in derive({ key: 'g', label: 'G' })).toBe(false);
    });

    it('drops non-predicate shapes instead of forwarding them (fail-closed renderer would hide the group)', () => {
      expect('visibleWhen' in derive({ key: 'g', label: 'G', visibleWhen: 42 })).toBe(false);
      expect('visibleWhen' in derive({ key: 'g', label: 'G', visibleWhen: '' })).toBe(false);
      expect('visibleWhen' in derive({ key: 'g', label: 'G', visibleWhen: ['record.x'] })).toBe(false);
      expect('visibleWhen' in derive({ key: 'g', label: 'G', visibleWhen: null })).toBe(false);
    });

    it('never stamps a predicate on the trailing ungrouped bucket', () => {
      const sections = deriveFieldGroupLayout({
        fieldGroups: [{ key: 'g', label: 'G', visibleWhen: 'record.a > 0' }],
        fields: { a: { group: 'g' }, loose: {} },
      })!;
      const trailing = sections[sections.length - 1];
      expect(trailing.key).toBeUndefined();
      expect('visibleWhen' in trailing).toBe(false);
    });
  });
});

/**
 * The audit-provenance tuple (#3786) — the canonical four-name declaration the
 * registry's injection table, the rule-validator's preserveAudit allowlist and
 * objectui's AUDIT_FIELD_BY_ROLE all key off. Pinned exactly: this is a wire
 * contract (stored column names), so any edit must be loud.
 */
describe('AUDIT_PROVENANCE_FIELDS', () => {
  it('is exactly the four provenance columns, in injection order', () => {
    expect([...AUDIT_PROVENANCE_FIELDS]).toEqual([
      'created_at', 'created_by', 'updated_at', 'updated_by',
    ]);
    expect(Object.isFrozen(AUDIT_PROVENANCE_FIELDS)).toBe(true);
  });

  it('is a subset of FIELD_GROUP_SYSTEM_FIELDS', () => {
    // Structural today (the superset spreads the tuple), but asserted anyway so
    // a future refactor cannot quietly decouple them.
    for (const f of AUDIT_PROVENANCE_FIELDS) {
      expect(FIELD_GROUP_SYSTEM_FIELDS.has(f), f).toBe(true);
    }
  });
});

describe('fieldGroups[].fields — a group lists its own members and their order', () => {
  // The epic's quote: `fields` declares name before account; the group lists
  // account first.
  const quote = (groups: unknown[], fieldExtras: Record<string, Record<string, unknown>> = {}) => ({
    name: 'quote',
    label: 'Quote',
    fieldGroups: groups,
    fields: {
      name: { type: 'text', label: 'Name', ...fieldExtras.name },
      account: { type: 'text', label: 'Account', ...fieldExtras.account },
      valid_until: { type: 'date', label: 'Valid until', ...fieldExtras.valid_until },
      discount: { type: 'percent', label: 'Discount', ...fieldExtras.discount },
      terms: { type: 'textarea', label: 'Terms', ...fieldExtras.terms },
    },
  });

  it('places the listed fields in list order, not field declaration order', () => {
    const def = quote([{ key: 'basic', label: 'Basic', fields: ['account', 'name'] }]);
    const sections = deriveFieldGroupLayout(def)!;
    expect(sections[0]).toMatchObject({ key: 'basic', fields: ['account', 'name'] });
    // Everything no group lists stays in the trailing untitled bucket, in declaration order.
    expect(sections[1]).toEqual({ collapse: 'none', fields: ['valid_until', 'discount', 'terms'] });
  });

  it('a group without fields keeps the older Field.group rule beside a listing group', () => {
    const def = quote(
      [
        { key: 'basic', label: 'Basic', fields: ['valid_until', 'name'] },
        { key: 'money', label: 'Money' },
      ],
      { discount: { group: 'money' }, account: { group: 'money' } },
    );
    expect(deriveFieldGroupLayout(def)!.map((s) => [s.key, s.fields])).toEqual([
      ['basic', ['valid_until', 'name']],
      ['money', ['account', 'discount']],
      [undefined, ['terms']],
    ]);
  });

  it('a field whose group names a listing group the list leaves out follows the listed ones', () => {
    const def = quote(
      [{ key: 'basic', label: 'Basic', fields: ['account', 'name'] }],
      { terms: { group: 'basic' }, valid_until: { group: 'basic' } },
    );
    expect(deriveFieldGroupLayout(def)![0].fields).toEqual(['account', 'name', 'valid_until', 'terms']);
  });

  it('skips a listed name the object does not declare, and a hidden listed field', () => {
    const def = quote(
      [{ key: 'basic', label: 'Basic', fields: ['tax_id', 'account', 'discount'] }],
      { discount: { hidden: true } },
    );
    expect(deriveFieldGroupLayout(def)![0].fields).toEqual(['account']);
  });

  it('keeps a system field a list names, as the older spelling does', () => {
    const def = { ...quote([{ key: 'basic', label: 'Basic', fields: ['created_at', 'name'] }]) };
    (def.fields as Record<string, unknown>).created_at = { type: 'datetime', label: 'Created' };
    expect(deriveFieldGroupLayout(def)![0].fields).toEqual(['created_at', 'name']);
  });

  it('a group whose list names nothing it can show is dropped, as an empty group is', () => {
    const def = quote([
      { key: 'basic', label: 'Basic', fields: ['name'] },
      { key: 'ghost', label: 'Ghost', fields: ['nowhere'] },
    ]);
    expect(deriveFieldGroupLayout(def)!.map((s) => s.key)).toEqual(['basic', undefined]);
  });

  it('un-parsed input that breaks the agreement rules resolves first-listing-wins', () => {
    const def = quote(
      [
        { key: 'basic', label: 'Basic', fields: ['name', 'account'] },
        { key: 'money', label: 'Money', fields: ['account', 'discount'] },
      ],
      { name: { group: 'money' } },
    );
    const sections = deriveFieldGroupLayout(def)!;
    expect(sections[0].fields).toEqual(['name', 'account']);
    expect(sections[1].fields).toEqual(['discount']);
  });

  it('readFieldGroupMembership answers the same membership, hidden fields included', () => {
    const def = quote(
      [{ key: 'basic', label: 'Basic', fields: ['account', 'name'] }, { key: 'money', label: 'Money' }],
      { discount: { group: 'money', hidden: true }, terms: { group: 'basic' } },
    );
    const { members, groupOf } = readFieldGroupMembership(def);
    expect([...members]).toEqual([
      ['basic', ['account', 'name', 'terms']],
      ['money', ['discount']],
    ]);
    expect(groupOf.get('discount')).toBe('money');
    expect(groupOf.has('valid_until')).toBe(false);
  });
});

describe('fieldGroups[].fields — the object parse holds the two spellings in agreement', () => {
  const base = {
    name: 'quote',
    label: 'Quote',
    fields: {
      name: { type: 'text', label: 'Name' },
      account: { type: 'text', label: 'Account' },
      discount: { type: 'percent', label: 'Discount' },
    } as Record<string, Record<string, unknown>>,
  };
  const issues = (def: unknown) => {
    const r = ObjectSchema.safeParse(def);
    return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  };

  it('parses a listing group, and keeps the list on the output', () => {
    const r = ObjectSchema.safeParse({ ...base, fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['account', 'name'] }] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.fieldGroups?.[0].fields).toEqual(['account', 'name']);
  });

  it('parses a listed field whose own group names the same group, and a listed name no field declares', () => {
    expect(issues({
      ...base,
      fields: { ...base.fields, name: { ...base.fields.name, group: 'basic' } },
      fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['name', 'tax_id'] }],
    })).toEqual([]);
  });

  it('refuses a listed field whose own group names another group, at both places', () => {
    const found = issues({
      ...base,
      fields: { ...base.fields, account: { ...base.fields.account, group: 'money' } },
      fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['account'] }, { key: 'money', label: 'Money' }],
    });
    expect(found.map((i) => i.path)).toEqual(['fieldGroups.0.fields.0', 'fields.account.group']);
    expect(found[0].message).toContain("'basic'");
    expect(found[0].message).toContain("'money'");
  });

  it('refuses a field two groups list, at the second listing', () => {
    const found = issues({
      ...base,
      fieldGroups: [
        { key: 'basic', label: 'Basic', fields: ['name', 'account'] },
        { key: 'money', label: 'Money', fields: ['discount', 'account'] },
      ],
    });
    expect(found.map((i) => i.path)).toEqual(['fieldGroups.1.fields.1']);
    expect(found[0].message).toContain("'basic' and 'money'");
  });

  it('refuses a name one list repeats', () => {
    expect(issues({ ...base, fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['name', 'name'] }] })
      .map((i) => i.path)).toEqual(['fieldGroups.0.fields.1']);
  });

  it('refuses fields on a group that places a related list', () => {
    expect(issues({ ...base, fieldGroups: [{ key: 'lines', label: 'Lines', relatedList: 'quote_line', fields: ['name'] }] })
      .map((i) => i.path)).toEqual(['fieldGroups.0.fields']);
  });

  it('refuses a list entry that is not a snake_case field name', () => {
    expect(issues({ ...base, fieldGroups: [{ key: 'basic', label: 'Basic', fields: ['Account'] }] })
      .map((i) => i.path)).toEqual(['fieldGroups.0.fields.0']);
  });
});
