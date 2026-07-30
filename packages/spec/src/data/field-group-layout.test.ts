// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { deriveFieldGroupLayout, FIELD_GROUP_SYSTEM_FIELDS, AUDIT_PROVENANCE_FIELDS } from './field-group-layout';

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
